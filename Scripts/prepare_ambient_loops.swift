// 把下载的环境音录音处理成 App 内置的无缝循环：
//   swift Scripts/prepare_ambient_loops.swift <原始录音目录> <输出目录>
// 原始目录里放 rain.mp3、waves.mp3 … 等文件（来源见 Resources/Ambient/CREDITS.md）。
// 对每段录音：取指定的一段（没指定时自动挑音量最平稳的一段），首尾交叉淡化成无缝循环，
// 按 A 计权响度统一音量，用前瞻峰值限制器压住个别特别尖的瞬间，最后用 afconvert 压成 AAC（.m4a）。

import Accelerate
import AVFoundation
import Foundation

struct LoopSpec {
    let name: String
    let seconds: Double
    let crossfade: Double
    /// 手动指定的起点（秒）。这些位置是逐秒检查响度后挑的，避开了车声、雷声、特别响的水花等。
    var start: Double? = nil
    /// 爆裂声这类尖峰很多的录音目标响度放低一点，少压一些，保留原本的力度。
    var loudness: Float = -28
}

let specs = [
    LoopSpec(name: "rain", seconds: 80, crossfade: 4, start: 19),        // 避开 153–183s 的骤雨和 221s 的尖响
    LoopSpec(name: "waves", seconds: 180, crossfade: 8, start: 10),
    LoopSpec(name: "stream", seconds: 45, crossfade: 4, start: 5),       // 避开 55s 的水花
    LoopSpec(name: "wind", seconds: 70, crossfade: 8, start: 3),
    LoopSpec(name: "fire", seconds: 80, crossfade: 5, start: 4, loudness: -29.5),
    LoopSpec(name: "birds", seconds: 115, crossfade: 6, start: 5),       // 130s 之后鸟叫变密变响，只取前面舒缓的部分
    LoopSpec(name: "crickets", seconds: 150, crossfade: 6, start: 55),   // 前 51s 有雷声
]

let peakCeiling: Float = 0.89
let lookahead: Double = 0.005
let release: Double = 0.04
let edgeMargin: Double = 3        // 避开录音开头和（可能被截断的）结尾

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("用法: swift prepare_ambient_loops.swift <原始录音目录> <输出目录>")
    exit(1)
}
let inputDirectory = URL(fileURLWithPath: arguments[1])
let outputDirectory = URL(fileURLWithPath: arguments[2])
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

func readStereo(_ url: URL) throws -> (channels: [[Float]], sampleRate: Double) {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    let capacity = AVAudioFrameCount(file.length)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw CocoaError(.fileReadUnknown) }
    // 只下载了开头一部分的 MP3，末尾那一帧可能不完整；读到哪算哪。
    do { try file.read(into: buffer) } catch { if buffer.frameLength == 0 { throw error } }
    let frames = Int(buffer.frameLength)
    var channels: [[Float]] = []
    for channel in 0..<Int(format.channelCount) {
        channels.append(Array(UnsafeBufferPointer(start: buffer.floatChannelData![channel], count: frames)))
    }
    if channels.count == 1 { channels.append(channels[0]) }
    return (Array(channels.prefix(2)), format.sampleRate)
}

/// 每 100ms 一个点的短时响度（400ms 窗口，先滤掉 150Hz 以下，避免被风噪和低频隆隆声主导）。
func shortTermLoudness(_ channels: [[Float]], sampleRate: Double) -> (values: [Float], hop: Int) {
    let hop = Int(sampleRate * 0.1)
    let window = hop * 4
    let coefficient = Float(exp(-2 * Double.pi * 150 / sampleRate))
    var filtered = [Float](repeating: 0, count: channels[0].count)
    for channel in channels {
        var low: Float = 0
        for index in channel.indices {
            low = channel[index] + (low - channel[index]) * coefficient
            let high = channel[index] - low
            filtered[index] += high * high * 0.5
        }
    }
    var values: [Float] = []
    var start = 0
    while start + window <= filtered.count {
        var sum: Float = 0
        vDSP_sve(Array(filtered[start..<(start + window)]), 1, &sum, vDSP_Length(window))
        values.append(10 * log10(sum / Float(window) + 1e-12))
        start += hop
    }
    return (values, hop)
}

/// A 计权 RMS（dBFS），用 FFT 功率谱加权计算。
func aWeightedLoudness(_ channels: [[Float]], sampleRate: Double) -> Float {
    let size = 8192
    let log2n = vDSP_Length(13)
    let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
    defer { vDSP_destroy_fftsetup(setup) }
    var window = [Float](repeating: 0, count: size)
    vDSP_hann_window(&window, vDSP_Length(size), Int32(vDSP_HANN_NORM))
    var weights = [Float](repeating: 0, count: size / 2)
    for bin in 1..<(size / 2) {
        let f = Float(bin) * Float(sampleRate) / Float(size)
        let f2 = f * f
        let r = 12194 * 12194 * f2 * f2 / ((f2 + 20.6 * 20.6) * sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194))
        weights[bin] = r * r * pow(10, 0.2)
    }
    let mono = zip(channels[0], channels[1]).map { ($0 + $1) * 0.5 }
    var weighted: Double = 0
    var total: Double = 0
    var real = [Float](repeating: 0, count: size / 2)
    var imaginary = [Float](repeating: 0, count: size / 2)
    var start = 0
    while start + size <= mono.count {
        var segment = Array(mono[start..<(start + size)])
        vDSP_vmul(segment, 1, window, 1, &segment, 1, vDSP_Length(size))
        real.withUnsafeMutableBufferPointer { realPointer in
            imaginary.withUnsafeMutableBufferPointer { imaginaryPointer in
                var split = DSPSplitComplex(realp: realPointer.baseAddress!, imagp: imaginaryPointer.baseAddress!)
                segment.withUnsafeBytes {
                    vDSP_ctoz($0.bindMemory(to: DSPComplex.self).baseAddress!, 2, &split, 1, vDSP_Length(size / 2))
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                for bin in 1..<(size / 2) {
                    let power = Double(realPointer[bin] * realPointer[bin] + imaginaryPointer[bin] * imaginaryPointer[bin])
                    total += power
                    weighted += power * Double(weights[bin])
                }
            }
        }
        start += size / 2
    }
    var squares: Float = 0
    vDSP_svesq(mono, 1, &squares, vDSP_Length(mono.count))
    let rms = 10 * log10(squares / Float(mono.count) + 1e-12)
    return rms + Float(10 * log10(weighted / max(total, 1e-12)))
}

func percentile(_ values: ArraySlice<Float>, _ fraction: Double) -> Float {
    let sorted = values.sorted()
    return sorted[min(sorted.count - 1, Int(Double(sorted.count) * fraction))]
}

/// 前瞻峰值限制器：提前 5ms 把增益降到刚好不超过上限，再用 40ms 恢复（短释放只压尖峰本身，底噪不会跟着“一吸一放”）。返回最大压缩量（dB）。
/// 循环首尾相接，所以前瞻和恢复都按环形处理，接缝处不会出现增益跳变。
func limitPeaks(_ channels: inout [[Float]], sampleRate: Double) -> Float {
    let count = channels[0].count
    let ahead = Int(lookahead * sampleRate)
    var required = [Float](repeating: 1, count: count)
    for index in 0..<count {
        let level = max(abs(channels[0][index]), abs(channels[1][index]))
        if level > peakCeiling { required[index] = peakCeiling / level }
    }
    // 向前看：每个位置取未来 5ms 内最小的需求增益，并线性过渡过去，保证峰值到来时增益已经降好。
    var envelope = [Float](repeating: 1, count: count)
    for index in 0..<count where required[index] < 1 {
        for offset in 0...ahead {
            let position = (index - offset + count) % count
            let ramp = 1 - (1 - required[index]) * Float(ahead - offset) / Float(ahead)
            envelope[position] = min(envelope[position], ramp)
        }
    }
    // 释放：压完之后按释放时间常数回到 1；绕两圈让循环接缝处的状态也一致。
    let coefficient = Float(1 - exp(-1 / (release * sampleRate)))
    var gain: Float = 1
    var smoothed = envelope
    for pass in 0..<2 {
        for index in 0..<count {
            gain = min(envelope[index], gain + (1 - gain) * coefficient)
            if pass == 1 { smoothed[index] = gain }
        }
    }
    var deepest: Float = 1
    for index in 0..<count {
        deepest = min(deepest, smoothed[index])
        channels[0][index] *= smoothed[index]
        channels[1][index] *= smoothed[index]
    }
    let active = smoothed.filter { $0 < 0.708 }.count
    limiterActivity = Double(active) / Double(count) * 100
    return -20 * log10(deepest)
}

/// 最近一次限幅时，增益被压低 3 dB 以上的时间占比（%）。
var limiterActivity: Double = 0

func writeWave(_ channels: [[Float]], sampleRate: Double, to url: URL) throws {
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(channels[0].count))!
    buffer.frameLength = AVAudioFrameCount(channels[0].count)
    for channel in 0..<2 {
        channels[channel].withUnsafeBufferPointer {
            buffer.floatChannelData![channel].update(from: $0.baseAddress!, count: channels[channel].count)
        }
    }
    let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    try file.write(from: buffer)
}

for spec in specs {
    let source = inputDirectory.appendingPathComponent("\(spec.name).mp3")
    guard FileManager.default.fileExists(atPath: source.path) else {
        print("跳过 \(spec.name)：没有找到 \(source.lastPathComponent)")
        continue
    }
    let (channels, sampleRate) = try readStereo(source)
    let total = channels[0].count
    let margin = Int(edgeMargin * sampleRate)
    let crossfade = Int(spec.crossfade * sampleRate)
    let available = total - 2 * margin
    let loopLength = min(Int(spec.seconds * sampleRate), available - crossfade)
    let needed = loopLength + crossfade

    // 在所有可选起点里，挑“最响的瞬间”相对整体最不突出、且首尾响度最接近的一段。
    let (loudness, hop) = shortTermLoudness(channels, sampleRate: sampleRate)
    let windowPoints = needed / hop
    let fadePoints = max(1, crossfade / hop)
    var best = (score: Float.infinity, start: margin, spike: Float(0), seam: Float(0))
    var candidate = margin
    if let start = spec.start {
        candidate = Int(start * sampleRate)
    }
    while candidate + needed <= total - margin {
        let first = candidate / hop
        let slice = loudness[first..<min(loudness.count, first + windowPoints)]
        let spike = percentile(slice, 0.999) - percentile(slice, 0.5)
        let head = loudness[first..<(first + fadePoints)].reduce(0, +) / Float(fadePoints)
        let tailStart = first + windowPoints - fadePoints
        let tail = loudness[tailStart..<(tailStart + fadePoints)].reduce(0, +) / Float(fadePoints)
        let seam = abs(head - tail)
        let score = spike + seam * 0.5
        if score < best.score { best = (score, candidate, spike, seam) }
        if spec.start != nil { break }
        candidate += Int(sampleRate)
    }

    // 等功率交叉淡化：循环开头的一段与末尾之后的一段混合，播到结尾时正好接回开头。
    var loop = [[Float]](repeating: [Float](repeating: 0, count: loopLength), count: 2)
    for channel in 0..<2 {
        let segment = channels[channel][best.start..<(best.start + needed)]
        let base = segment.startIndex
        for index in 0..<loopLength {
            if index < crossfade {
                let position = Float(index) / Float(crossfade) * Float.pi / 2
                loop[channel][index] = segment[base + index] * sin(position) + segment[base + loopLength + index] * cos(position)
            } else {
                loop[channel][index] = segment[base + index]
            }
        }
    }

    var gain = pow(10, (spec.loudness - aWeightedLoudness(loop, sampleRate: sampleRate)) / 20)
    for channel in 0..<2 { vDSP_vsmul(loop[channel], 1, &gain, &loop[channel], 1, vDSP_Length(loopLength)) }
    let reduction = limitPeaks(&loop, sampleRate: sampleRate)
    let finalLoudness = aWeightedLoudness(loop, sampleRate: sampleRate)
    var peak: Float = 0
    for channel in loop { var channelPeak: Float = 0; vDSP_maxmgv(channel, 1, &channelPeak, vDSP_Length(channel.count)); peak = max(peak, channelPeak) }

    let wave = FileManager.default.temporaryDirectory.appendingPathComponent("\(spec.name)-loop.wav")
    try writeWave(loop, sampleRate: sampleRate, to: wave)
    let output = outputDirectory.appendingPathComponent("\(spec.name).m4a")
    try? FileManager.default.removeItem(at: output)
    let convert = Process()
    convert.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
    convert.arguments = ["-f", "m4af", "-d", "aac", "-b", "160000", wave.path, output.path]
    try convert.run()
    convert.waitUntilExit()
    try? FileManager.default.removeItem(at: wave)

    print(String(
        format: "%-9@ 起点 %5.1fs  循环 %5.1fs  突出度 %4.1f dB  首尾差 %4.1f dB  增益 %+5.1f dB  限幅最多 %4.1f dB（>3dB 占 %4.2f%%）  响度 %5.1f dBA  峰值 %.2f  → %@",
        spec.name as NSString,
        Double(best.start) / sampleRate,
        Double(loopLength) / sampleRate,
        best.spike,
        best.seam,
        20 * log10(gain),
        reduction,
        limiterActivity,
        finalLoudness,
        peak,
        output.lastPathComponent as NSString
    ))
}
