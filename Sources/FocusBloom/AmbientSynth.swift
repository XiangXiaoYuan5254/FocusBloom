import Foundation

// 棕噪音在本机实时合成（它本来就是“生成”出来的声音）；其他环境音都是真实录音，见 AmbientPlayer。
// 这里的代码运行在音频线程上，只做数值计算，不加锁、不分配内存。

/// xorshift32 随机数，足够快，适合每个采样都调用。
struct NoiseSource {
    private var state: UInt32

    init(seed: UInt32 = UInt32.random(in: 1...UInt32.max)) {
        state = seed
    }

    /// -1...1 的白噪声。
    mutating func white() -> Float {
        step()
        return Float(Int32(bitPattern: state)) * (1 / 2_147_483_648)
    }

    /// 0..<1 的均匀随机数。
    mutating func unit() -> Float {
        step()
        return Float(state >> 8) * (1 / 16_777_216)
    }

    mutating func range(_ lower: Float, _ upper: Float) -> Float {
        lower + (upper - lower) * unit()
    }

    private mutating func step() {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
    }
}

/// 棕噪声：白噪声的漏积分，低频饱满。
struct BrownNoise {
    private var last: Float = 0

    mutating func next(_ noise: inout NoiseSource) -> Float {
        last = (last + 0.02 * noise.white()) / 1.02
        return last * 3.5
    }
}

/// RBJ 双二阶滤波器（转置直接 II 型）。
struct Biquad {
    private var b0: Float, b1: Float, b2: Float, a1: Float, a2: Float
    private var z1: Float = 0, z2: Float = 0

    static func lowpass(_ frequency: Float, q: Float = 0.707, sampleRate: Float) -> Biquad {
        let (cosW, alpha) = prepare(frequency, q: q, sampleRate: sampleRate)
        return Biquad(b0: (1 - cosW) / 2, b1: 1 - cosW, b2: (1 - cosW) / 2, a0: 1 + alpha, a1: -2 * cosW, a2: 1 - alpha)
    }

    static func highpass(_ frequency: Float, q: Float = 0.707, sampleRate: Float) -> Biquad {
        let (cosW, alpha) = prepare(frequency, q: q, sampleRate: sampleRate)
        return Biquad(b0: (1 + cosW) / 2, b1: -(1 + cosW), b2: (1 + cosW) / 2, a0: 1 + alpha, a1: -2 * cosW, a2: 1 - alpha)
    }

    private init(b0: Float, b1: Float, b2: Float, a0: Float, a1: Float, a2: Float) {
        self.b0 = b0 / a0
        self.b1 = b1 / a0
        self.b2 = b2 / a0
        self.a1 = a1 / a0
        self.a2 = a2 / a0
    }

    mutating func process(_ input: Float) -> Float {
        let output = b0 * input + z1
        z1 = b1 * input - a1 * output + z2
        z2 = b2 * input - a2 * output
        return output
    }

    private static func prepare(_ frequency: Float, q: Float, sampleRate: Float) -> (Float, Float) {
        let omega = 2 * Float.pi * min(frequency, sampleRate * 0.45) / sampleRate
        return (cos(omega), sin(omega) / (2 * q))
    }
}

/// 缓慢漂移的随机量：隔一段随机时间换一个目标值，再平滑地靠过去。
struct Drift {
    private(set) var value: Float
    private var intermediate: Float
    private var target: Float
    private var countdown = 0
    private let lower: Float
    private let upper: Float
    private let minimumHold: Float
    private let maximumHold: Float
    private let coefficient: Float

    init(_ lower: Float, _ upper: Float, hold: ClosedRange<Float>, smoothing: Float, sampleRate: Float, noise: inout NoiseSource) {
        self.lower = lower
        self.upper = upper
        minimumHold = hold.lowerBound * sampleRate
        maximumHold = hold.upperBound * sampleRate
        coefficient = 1 - exp(-1 / (max(0.001, smoothing) * sampleRate))
        let start = noise.range(lower, upper)
        value = start
        intermediate = start
        target = start
    }

    mutating func next(_ noise: inout NoiseSource) -> Float {
        countdown -= 1
        if countdown <= 0 {
            target = noise.range(lower, upper)
            countdown = Int(noise.range(minimumHold, maximumHold))
        }
        // 两级平滑，起伏更圆润，不会出现折角。
        intermediate += (target - intermediate) * coefficient
        value += (intermediate - value) * coefficient
        return value
    }
}

/// 棕噪音：左右声道共享大部分成分，耳机里不会有“压耳”的感觉；700 Hz 以上再滚降一次，只留低沉的底，
/// 再带一点很慢的起伏。音量按目标值逐采样平滑过渡，拖动滑块不会有爆音。
final class BrownNoiseGenerator {
    private let level: UnsafePointer<Float>
    private let gainCoefficient: Float
    private var gain: Float = 0
    private var noise = NoiseSource()
    private var shared = BrownNoise()
    private var sideLeft = BrownNoise()
    private var sideRight = BrownNoise()
    private var highpassLeft: Biquad
    private var highpassRight: Biquad
    private var lowpassLeft: Biquad
    private var lowpassRight: Biquad
    private var breath: Drift

    /// `level` 指向目标音量，由主线程写入。
    init(sampleRate: Float, level: UnsafePointer<Float>) {
        self.level = level
        gainCoefficient = 1 - exp(-1 / (0.3 * sampleRate))
        highpassLeft = .highpass(30, sampleRate: sampleRate)
        highpassRight = .highpass(30, sampleRate: sampleRate)
        lowpassLeft = .lowpass(700, q: 0.6, sampleRate: sampleRate)
        lowpassRight = .lowpass(700, q: 0.6, sampleRate: sampleRate)
        breath = Drift(0.82, 1, hold: 5...12, smoothing: 3, sampleRate: sampleRate, noise: &noise)
    }

    func render(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
        let target = level.pointee
        if target == 0 && gain < 0.0001 {
            gain = 0
            left.update(repeating: 0, count: frames)
            right.update(repeating: 0, count: frames)
            return
        }
        for frame in 0..<frames {
            gain += (target - gain) * gainCoefficient
            let swell = breath.next(&noise) * gain * 0.95
            let common = shared.next(&noise) * 0.8
            left[frame] = lowpassLeft.process(highpassLeft.process(common + sideLeft.next(&noise) * 0.6)) * swell
            right[frame] = lowpassRight.process(highpassRight.process(common + sideRight.next(&noise) * 0.6)) * swell
        }
    }
}
