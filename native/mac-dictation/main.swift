import AVFoundation
import Darwin
import Foundation
import Speech

func emit(_ payload: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(payload),
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let line = String(data: data, encoding: .utf8)
  else { return }
  fputs(line + "\n", stdout)
  fflush(stdout)
}

func failAndExit(_ message: String) -> Never {
  emit(["type": "error", "message": message])
  emit(["type": "ended"])
  exit(1)
}

final class DictationSession {
  private let recognizer: SFSpeechRecognizer
  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var stopping = false
  private var finished = false

  init(localeIdentifier: String) {
    let requested = Locale(identifier: localeIdentifier)
    if let recognizer = SFSpeechRecognizer(locale: requested), recognizer.isAvailable {
      self.recognizer = recognizer
      return
    }
    if let recognizer = SFSpeechRecognizer(), recognizer.isAvailable {
      self.recognizer = recognizer
      return
    }
    failAndExit("macOS speech recognition is not available for this language.")
  }

  func start() {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
    self.request = request

    let input = engine.inputNode
    let format = input.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      failAndExit("No microphone input is available.")
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, !self.finished else { return }
      if let result {
        let text = result.bestTranscription.formattedString.trimmingCharacters(
          in: .whitespacesAndNewlines)
        emit(["type": "transcript", "text": text])
        if result.isFinal {
          self.finish()
          return
        }
      }
      if let error, (error as NSError).code != 301 {
        if !self.stopping {
          emit(["type": "error", "message": error.localizedDescription])
        }
        self.finish()
      }
    }

    do {
      engine.prepare()
      try engine.start()
    } catch {
      failAndExit("Could not start the microphone. \(error.localizedDescription)")
    }
    emit(["type": "ready"])
  }

  func stop() {
    guard !stopping else { return }
    stopping = true
    if engine.isRunning {
      engine.stop()
    }
    request?.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) { [weak self] in
      self?.finish()
    }
  }

  func cancel() {
    guard !stopping else { return }
    stopping = true
    task?.cancel()
    finish()
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    stopping = true
    task = nil
    request = nil
    if engine.isRunning {
      engine.stop()
    }
    engine.inputNode.removeTap(onBus: 0)
    emit(["type": "ended"])
    exit(0)
  }
}

func parseLocale() -> String {
  let args = CommandLine.arguments
  if let index = args.firstIndex(of: "--locale"), args.index(after: index) < args.endIndex {
    let value = args[args.index(after: index)].trimmingCharacters(in: .whitespacesAndNewlines)
    if !value.isEmpty { return value }
  }
  return Locale.current.identifier
}

var session: DictationSession?
var pendingCommand: String?

func stopActiveSession(command: String) {
  guard let session else {
    // Permission prompts are still in flight. Remember the command and leave
    // before the microphone starts, once those prompts settle.
    pendingCommand = command
    return
  }
  if command == "cancel" {
    session.cancel()
  } else {
    session.stop()
  }
}

func abortIfStoppedBeforeStart() {
  guard pendingCommand != nil else { return }
  emit(["type": "error", "message": "Dictation stopped before recording started."])
  emit(["type": "ended"])
  exit(0)
}

func requestSpeechAuthorization(
  _ completion: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void
) {
  let status = SFSpeechRecognizer.authorizationStatus()
  if status != .notDetermined {
    completion(status)
    return
  }
  // The completion can arrive on any queue. Hop to the main run loop so the
  // system speech-recognition dialog can be presented and answered.
  SFSpeechRecognizer.requestAuthorization { next in
    DispatchQueue.main.async {
      completion(next)
    }
  }
}

func requestMicrophoneAccess(_ completion: @escaping (Bool) -> Void) {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized:
    completion(true)
  case .denied, .restricted:
    completion(false)
  case .notDetermined:
    // AVAudioApplication.requestRecordPermission does not present a dialog for
    // this helper. AVCaptureDevice.requestAccess is the prompt macOS shows.
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      DispatchQueue.main.async {
        completion(granted)
      }
    }
  @unknown default:
    completion(false)
  }
}

func beginDictation() {
  requestSpeechAuthorization { status in
    abortIfStoppedBeforeStart()
    switch status {
    case .authorized:
      break
    case .denied:
      failAndExit(
        "Speech recognition was denied. Allow T3 Pretty in System Settings → Privacy & Security → Speech Recognition."
      )
    case .restricted:
      failAndExit("Speech recognition is restricted on this Mac.")
    case .notDetermined:
      failAndExit("Speech recognition permission was not granted.")
    @unknown default:
      failAndExit("Speech recognition is unavailable.")
    }

    requestMicrophoneAccess { granted in
      abortIfStoppedBeforeStart()
      if !granted {
        failAndExit(
          "Microphone access was denied. Allow T3 Pretty in System Settings → Privacy & Security → Microphone."
        )
      }
      let created = DictationSession(localeIdentifier: parseLocale())
      session = created
      created.start()
    }
  }
}

let stdin = FileHandle.standardInput
stdin.readabilityHandler = { handle in
  let data = handle.availableData
  if data.isEmpty {
    DispatchQueue.main.async { stopActiveSession(command: "stop") }
    return
  }
  guard let text = String(data: data, encoding: .utf8) else { return }
  for line in text.split(whereSeparator: \.isNewline) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let payload = trimmed.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
          let command = json["cmd"] as? String
    else { continue }
    DispatchQueue.main.async {
      stopActiveSession(command: command)
    }
  }
}

DispatchQueue.main.async { beginDictation() }
RunLoop.main.run()
