import AVFoundation

/// 环境音播放。录音类声音各用一个 AVAudioPlayerNode 从文件流式循环播放，棕噪音由 BrownNoiseGenerator 实时生成；
/// 所有声音先汇到一个子混音器，再经过系统的峰值限制器，几种声音叠在一起也不会破音。
/// 音量变化和淡入淡出按 60Hz 平滑过渡；停止后等淡出结束再关掉引擎，避免空转耗电。
final class AmbientPlayer {
    private let engine = AVAudioEngine()
    private let bus = AVAudioMixerNode()
    private let limiter = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
        componentType: kAudioUnitType_Effect,
        componentSubType: kAudioUnitSubType_PeakLimiter,
        componentManufacturer: kAudioUnitManufacturer_Apple,
        componentFlags: 0,
        componentFlagsMask: 0
    ))
    private var tracks: [AmbientSound: LoopingTrack] = [:]
    private var noiseNode: AVAudioSourceNode?
    // 棕噪音的目标音量：主线程写、音频线程读；单个对齐 Float 的读写本身是原子的，不需要加锁。
    private let noiseLevel: UnsafeMutablePointer<Float>
    private var targets: [AmbientSound: Float] = [:]
    private var volumes: [AmbientSound: Float] = [:]
    private var masterSetting: Float = 0
    private var masterVolume: Float = 0
    private var rampTimer: Timer?
    private var configurationObserver: NSObjectProtocol?
    private(set) var isPlaying = false

    init() {
        noiseLevel = .allocate(capacity: 1)
        noiseLevel.initialize(to: 0)
        engine.attach(bus)
        engine.attach(limiter)
        connectOutput()
        bus.outputVolume = 0
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            self?.recoverFromConfigurationChange()
        }
    }

    deinit {
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
        }
        rampTimer?.invalidate()
        engine.stop()
        noiseLevel.deallocate()
    }

    func setLevels(_ levels: AmbientLevels) {
        targets = levels.sounds
        masterSetting = levels.master
        noiseLevel.pointee = levels.sounds[.brownNoise] ?? 0
        guard isPlaying else { return }
        startSelectedSources()
        startRamp()
    }

    @discardableResult
    func play() -> Bool {
        isPlaying = true
        if !engine.isRunning {
            do {
                try engine.start()
            } catch {
                NSLog("FocusBloom ambient engine failed: \(error.localizedDescription)")
                isPlaying = false
                return false
            }
        }
        startSelectedSources()
        startRamp()
        return true
    }

    func stop() {
        isPlaying = false
        startRamp()
    }

    private func outputFormat() -> AVAudioFormat {
        let hardwareRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        return AVAudioFormat(standardFormatWithSampleRate: hardwareRate > 0 ? hardwareRate : 48_000, channels: 2)!
    }

    private func connectOutput() {
        let format = outputFormat()
        engine.connect(bus, to: limiter, format: format)
        engine.connect(limiter, to: engine.mainMixerNode, format: format)
    }

    /// 选中但还没在播的声音接上并开始：录音从随机位置开始循环，棕噪音接上实时生成节点。
    private func startSelectedSources() {
        guard engine.isRunning else { return }
        for sound in AmbientSound.allCases where (targets[sound] ?? 0) > 0 {
            if sound.isRecording {
                guard let track = tracks[sound] ?? makeTrack(for: sound), !track.isPlaying else { continue }
                volumes[sound] = 0
                track.node.volume = 0
                track.start()
            } else if noiseNode == nil {
                attachNoise()
            }
        }
    }

    private func makeTrack(for sound: AmbientSound) -> LoopingTrack? {
        guard let url = Bundle.main.url(forResource: sound.rawValue, withExtension: "m4a", subdirectory: "Ambient"),
              let track = LoopingTrack(url: url)
        else {
            NSLog("FocusBloom ambient recording missing: \(sound.rawValue)")
            return nil
        }
        engine.attach(track.node)
        engine.connect(track.node, to: bus, format: track.format)
        tracks[sound] = track
        return track
    }

    private func attachNoise() {
        let format = outputFormat()
        let generator = BrownNoiseGenerator(sampleRate: Float(format.sampleRate), level: UnsafePointer(noiseLevel))
        let node = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard buffers.count >= 2,
                  let left = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                  let right = buffers[1].mData?.assumingMemoryBound(to: Float.self)
            else { return noErr }
            generator.render(left: left, right: right, frames: Int(frameCount))
            return noErr
        }
        engine.attach(node)
        engine.connect(node, to: bus, format: format)
        noiseNode = node
    }

    private func startRamp() {
        guard rampTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            self?.stepVolumes()
        }
        // .common 模式：拖动滑块等界面交互期间也照常过渡。
        RunLoop.main.add(timer, forMode: .common)
        rampTimer = timer
    }

    private func stepVolumes() {
        let step: Float = 1.0 / 60
        let masterGoal = isPlaying ? masterSetting : 0
        let masterTime: Float = masterGoal > masterVolume ? 0.8 : 0.45
        masterVolume += (masterGoal - masterVolume) * (1 - exp(-step / masterTime))
        bus.outputVolume = masterVolume
        var settled = abs(masterGoal - masterVolume) < 0.0005

        for (sound, track) in tracks where track.isPlaying {
            let goal = targets[sound] ?? 0
            var volume = volumes[sound] ?? 0
            volume += (goal - volume) * (1 - exp(-step / 0.3))
            volumes[sound] = volume
            track.node.volume = volume
            if goal == 0 && volume < 0.001 {
                // 淡出后停掉，不再读文件。
                track.stop()
            } else if abs(goal - volume) >= 0.0005 {
                settled = false
            }
        }

        if !isPlaying && masterVolume < 0.001 {
            masterVolume = 0
            bus.outputVolume = 0
            tracks.values.forEach { $0.stop() }
            engine.stop()
            stopRamp()
        } else if settled {
            stopRamp()
        }
    }

    private func stopRamp() {
        rampTimer?.invalidate()
        rampTimer = nil
    }

    /// 输出设备变化（比如连上耳机）后系统会停掉引擎，采样率也可能变了：重接输出和棕噪音，再把正在播的声音重新排上。
    private func recoverFromConfigurationChange() {
        tracks.values.forEach { $0.stop() }
        if let noiseNode {
            engine.detach(noiseNode)
            self.noiseNode = nil
        }
        connectOutput()
        guard isPlaying else { return }
        do {
            try engine.start()
        } catch {
            NSLog("FocusBloom ambient engine restart failed: \(error.localizedDescription)")
            return
        }
        startSelectedSources()
        startRamp()
    }
}

/// 一段内置录音的无缝循环：从文件流式读取，播放队列里始终多排一遍，前一遍读完就再补一遍。
/// 录音首尾已经交叉淡化过（见 Scripts/prepare_ambient_loops.swift），前后两遍直接相接听不出接缝。
private final class LoopingTrack {
    let node = AVAudioPlayerNode()
    let format: AVAudioFormat
    private let url: URL
    private let length: AVAudioFramePosition
    private var generation = 0
    private(set) var isPlaying = false

    init?(url: URL) {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return nil }
        self.url = url
        format = file.processingFormat
        length = file.length
    }

    func start() {
        generation += 1
        isPlaying = true
        // 每次从随机位置开始，不会总是听到同一个开头。
        let offset = AVAudioFramePosition(Double(length) * Double.random(in: 0..<0.95))
        schedule(from: offset, generation: generation)
        schedule(from: 0, generation: generation)
        node.play()
    }

    func stop() {
        generation += 1
        isPlaying = false
        node.stop()
    }

    private func schedule(from offset: AVAudioFramePosition, generation: Int) {
        guard let file = try? AVAudioFile(forReading: url) else { return }
        node.scheduleSegment(
            file,
            startingFrame: offset,
            frameCount: AVAudioFrameCount(length - offset),
            at: nil,
            completionCallbackType: .dataConsumed
        ) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.generation == generation else { return }
                self.schedule(from: 0, generation: generation)
            }
        }
    }
}
