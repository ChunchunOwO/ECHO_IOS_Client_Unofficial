import AVFoundation
import AVFAudio
import AudioToolbox
import ExpoModulesCore

private final class DspPlaybackEngine {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let eq = AVAudioUnitEQ(numberOfBands: 5)
  private let dynamics = DspPlaybackEngine.makeDynamicsProcessor()
  private var audioFile: AVAudioFile?
  private var sampleRate: Double = 44_100
  private var durationSeconds: Double = 0
  private var scheduledStartFrame: AVAudioFramePosition = 0
  private var offsetSeconds: Double = 0
  private var playing = false
  private var finished = false
  private var configured = false

  init() {
    configureEqBands([0, 0, 0, 0, 0])
    configureDynamicsProcessor()
  }

  func playFile(uri: String, positionMs: Double, volume: Double, gains: [Double], loudnessEnabled: Bool) throws {
    guard let url = URL(string: uri), url.isFileURL else {
      throw DspError.invalidUri
    }

    try configureAudioSession()
    let file = try AVAudioFile(forReading: url)
    audioFile = file
    sampleRate = file.processingFormat.sampleRate
    durationSeconds = sampleRate > 0 ? Double(file.length) / sampleRate : 0
    offsetSeconds = max(0, min(positionMs / 1000, durationSeconds))
    scheduledStartFrame = AVAudioFramePosition(offsetSeconds * sampleRate)
    finished = false

    configureGraph(format: file.processingFormat)
    configureEqBands(gains)
    dynamics?.bypass = !loudnessEnabled
    player.volume = Float(max(0, min(1, volume)))

    player.stop()
    player.reset()
    scheduleCurrentFile(shouldMarkFinished: true)

    if !engine.isRunning {
      try engine.start()
    }
    player.play()
    playing = true
  }

  func pause() {
    guard playing else { return }
    offsetSeconds = currentTime()
    player.pause()
    playing = false
  }

  func resume() throws {
    guard audioFile != nil else { return }
    if finished {
      try seekTo(seconds: 0)
    }
    if !engine.isRunning {
      try engine.start()
    }
    player.play()
    playing = true
    finished = false
  }

  func stop() {
    player.stop()
    player.reset()
    playing = false
    finished = false
    offsetSeconds = 0
    scheduledStartFrame = 0
  }

  func seekTo(seconds: Double) throws {
    guard audioFile != nil else { return }
    let wasPlaying = playing
    offsetSeconds = max(0, min(seconds, durationSeconds))
    scheduledStartFrame = AVAudioFramePosition(offsetSeconds * sampleRate)
    finished = false
    player.stop()
    player.reset()
    scheduleCurrentFile(shouldMarkFinished: true)
    if wasPlaying {
      if !engine.isRunning {
        try engine.start()
      }
      player.play()
    }
    playing = wasPlaying
  }

  func setVolume(_ volume: Double) {
    player.volume = Float(max(0, min(1, volume)))
  }

  func setEq(gains: [Double]) {
    configureEqBands(gains)
  }

  func setLoudness(_ enabled: Bool) {
    dynamics?.bypass = !enabled
  }

  func status() -> [String: Any] {
    [
      "currentTime": currentTime(),
      "didJustFinish": finished,
      "duration": durationSeconds,
      "playing": playing,
      "volume": Double(player.volume)
    ]
  }

  private func configureAudioSession() throws {
    #if os(iOS) || os(tvOS)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [])
    try session.setActive(true)
    #endif
  }

  private func configureGraph(format: AVAudioFormat) {
    if !configured {
      engine.attach(player)
      engine.attach(eq)
      if let dynamics {
        engine.attach(dynamics)
      }
      configured = true
    }

    engine.disconnectNodeOutput(player)
    engine.disconnectNodeOutput(eq)
    if let dynamics {
      engine.disconnectNodeOutput(dynamics)
    }
    engine.connect(player, to: eq, format: format)
    if let dynamics {
      engine.connect(eq, to: dynamics, format: format)
      engine.connect(dynamics, to: engine.mainMixerNode, format: format)
    } else {
      engine.connect(eq, to: engine.mainMixerNode, format: format)
    }
  }

  private func scheduleCurrentFile(shouldMarkFinished: Bool) {
    guard let audioFile else { return }
    let startFrame = max(0, min(scheduledStartFrame, audioFile.length))
    let remainingFrames = max(0, audioFile.length - startFrame)
    guard remainingFrames > 0 else {
      playing = false
      finished = shouldMarkFinished
      return
    }

    player.scheduleSegment(
      audioFile,
      startingFrame: startFrame,
      frameCount: AVAudioFrameCount(min(Int64(UInt32.max), remainingFrames)),
      at: nil
    ) { [weak self] in
      DispatchQueue.main.async {
        guard let self else { return }
        self.offsetSeconds = self.durationSeconds
        self.playing = false
        self.finished = shouldMarkFinished
      }
    }
  }

  private func currentTime() -> Double {
    guard playing,
          let nodeTime = player.lastRenderTime,
          let playerTime = player.playerTime(forNodeTime: nodeTime),
          sampleRate > 0
    else {
      return max(0, min(offsetSeconds, durationSeconds))
    }

    let frame = scheduledStartFrame + AVAudioFramePosition(playerTime.sampleTime)
    return max(0, min(Double(frame) / sampleRate, durationSeconds))
  }

  private func configureEqBands(_ gains: [Double]) {
    let frequencies: [Float] = [60, 230, 910, 3600, 14_000]
    for (index, band) in eq.bands.enumerated() {
      band.filterType = .parametric
      band.frequency = frequencies[index]
      band.bandwidth = 1.1
      band.gain = Float(index < gains.count ? max(-12, min(12, gains[index])) : 0)
      band.bypass = false
    }
    eq.globalGain = 0
  }

  private static func makeDynamicsProcessor() -> AVAudioUnitEffect? {
    AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
      componentType: kAudioUnitType_Effect,
      componentSubType: kAudioUnitSubType_DynamicsProcessor,
      componentManufacturer: kAudioUnitManufacturer_Apple,
      componentFlags: 0,
      componentFlagsMask: 0
    ))
  }

  private func configureDynamicsProcessor() {
    guard let dynamics else { return }
    dynamics.bypass = true
    setDynamicsParameter(DynamicsParameter.threshold, value: -18)
    setDynamicsParameter(DynamicsParameter.headRoom, value: 5)
    setDynamicsParameter(DynamicsParameter.expansionRatio, value: 1)
    setDynamicsParameter(DynamicsParameter.expansionThreshold, value: -48)
    setDynamicsParameter(DynamicsParameter.attackTime, value: 0.008)
    setDynamicsParameter(DynamicsParameter.releaseTime, value: 0.18)
    setDynamicsParameter(DynamicsParameter.masterGain, value: 2)
  }

  private func setDynamicsParameter(_ parameterID: AudioUnitParameterID, value: Float) {
    guard
      let dynamics,
      let parameter = dynamics.auAudioUnit.parameterTree?.parameter(withAddress: AUParameterAddress(parameterID))
    else {
      return
    }
    parameter.value = value
  }
}

private enum DynamicsParameter {
  static let threshold: AudioUnitParameterID = 0
  static let headRoom: AudioUnitParameterID = 1
  static let expansionRatio: AudioUnitParameterID = 2
  static let expansionThreshold: AudioUnitParameterID = 3
  static let attackTime: AudioUnitParameterID = 4
  static let releaseTime: AudioUnitParameterID = 5
  static let masterGain: AudioUnitParameterID = 6
}

private enum DspError: Error {
  case invalidUri
}

public final class EchoAudioDspModule: Module {
  private let playbackEngine = DspPlaybackEngine()

  public func definition() -> ModuleDefinition {
    Name("EchoAudioDsp")

    AsyncFunction("playFile") { (uri: String, positionMs: Double, volume: Double, gains: [Double], loudnessEnabled: Bool) in
      try self.playbackEngine.playFile(
        uri: uri,
        positionMs: positionMs,
        volume: volume,
        gains: gains,
        loudnessEnabled: loudnessEnabled
      )
    }

    AsyncFunction("pause") {
      self.playbackEngine.pause()
    }

    AsyncFunction("resume") {
      try self.playbackEngine.resume()
    }

    AsyncFunction("stop") {
      self.playbackEngine.stop()
    }

    AsyncFunction("seekTo") { (seconds: Double) in
      try self.playbackEngine.seekTo(seconds: seconds)
    }

    AsyncFunction("setVolume") { (volume: Double) in
      self.playbackEngine.setVolume(volume)
    }

    AsyncFunction("setEq") { (gains: [Double]) in
      self.playbackEngine.setEq(gains: gains)
    }

    AsyncFunction("setLoudness") { (enabled: Bool) in
      self.playbackEngine.setLoudness(enabled)
    }

    AsyncFunction("getStatus") { () -> [String: Any] in
      self.playbackEngine.status()
    }

    OnDestroy {
      self.playbackEngine.stop()
    }
  }
}
