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

func requestSpeechAuthorization() -> SFSpeechRecognizerAuthorizationStatus {
  let semaphore = DispatchSemaphore(value: 0)
  var status = SFSpeechRecognizer.authorizationStatus()
  if status != .notDetermined {
    return status
  }
  SFSpeechRecognizer.requestAuthorization { next in
    status = next
    semaphore.signal()
  }
  semaphore.wait()
  return status
}

func requestMicrophoneAccess() -> Bool {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  if #available(macOS 14.0, *) {
    AVAudioApplication.requestRecordPermission { allowed in
      granted = allowed
      semaphore.signal()
    }
  } else {
    AVCaptureDevice.requestAccess(for: .audio) { allowed in
      granted = allowed
      semaphore.signal()
    }
  }
  semaphore.wait()
  return granted
}

switch requestSpeechAuthorization() {
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

if !requestMicrophoneAccess() {
  failAndExit(
    "Microphone access was denied. Allow T3 Pretty in System Settings → Privacy & Security → Microphone."
  )
}

let session = DictationSession(localeIdentifier: parseLocale())

let stdin = FileHandle.standardInput
stdin.readabilityHandler = { handle in
  let data = handle.availableData
  if data.isEmpty {
    DispatchQueue.main.async { session.stop() }
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
      if command == "cancel" {
        session.cancel()
      } else {
        session.stop()
      }
    }
  }
}

DispatchQueue.main.async { session.start() }
RunLoop.main.run()
