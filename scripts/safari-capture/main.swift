// neo3-safari-capture — «Safari вживую» helper for Neo3 (protocol: README.md).
//
//   list                                   → one JSON line with Safari windows
//   stream <windowId> [--fps 3] [--max-width 1280] [--quality 0.6]
//                                          → [UInt32 BE length][JPEG]… on stdout
//   display [--width 1920 --height 1200]   → invisible «Neo3 Safari» monitor, ready line, lives until stdin EOF
//   place <windowId> --x X --y Y --width W --height H
//                                          → moves that Safari window, unhides Safari without activating it
//
// Never activates Safari (no `activate`, no frontmost, no NSRunningApplication.activate)
// and touches no Safari window other than the one passed by id.
// Built from probes /tmp/neo3-safari-probe{,2} (05.11.2026).

import AppKit
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

signal(SIGPIPE, SIG_IGN)
setvbuf(stdout, nil, _IONBF, 0)
// SCK/CGS need a WindowServer connection; .prohibited = no Dock icon, never activates.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let safariBundle = "com.apple.Safari"

// MARK: - output helpers

func json(_ object: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return "{}" }
    return text
}

/// Writes all bytes to a file descriptor; false when the reader is gone.
func writeAll(_ fd: Int32, _ data: Data) -> Bool {
    return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
        guard var pointer = raw.baseAddress else { return true }
        var left = raw.count
        while left > 0 {
            let written = write(fd, pointer, left)
            if written < 0 {
                if errno == EINTR { continue }
                return false
            }
            left -= written
            pointer = pointer.advanced(by: written)
        }
        return true
    }
}

func printLine(_ text: String) { _ = writeAll(1, Data((text + "\n").utf8)) }

enum ExitCode: Int32 { case ok = 0, other = 1, badArgs = 2, noPermission = 3, windowGone = 4, displayFailed = 5 }

func fail(_ error: String, _ message: String, _ code: ExitCode) -> Never {
    _ = writeAll(2, Data((json(["error": error, "message": message]) + "\n").utf8))
    exit(code.rawValue)
}

func errText(_ error: Error) -> String {
    let ns = error as NSError
    return "\(ns.domain) code=\(ns.code) \(ns.localizedDescription)"
}

/// SCStreamError.userDeclined (-3801): the screen-recording grant is missing.
func isPermissionError(_ error: Error) -> Bool {
    let ns = error as NSError
    return ns.domain == SCStreamErrorDomain && ns.code == SCStreamError.Code.userDeclined.rawValue
}

let args = CommandLine.arguments
func option(_ name: String) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}
func intOption(_ name: String, _ fallback: Int) -> Int {
    guard let raw = option(name) else { return fallback }
    guard let value = Int(raw) else { fail("bad_args", "\(name) must be an integer", .badArgs) }
    return value
}
func doubleOption(_ name: String, _ fallback: Double) -> Double {
    guard let raw = option(name) else { return fallback }
    guard let value = Double(raw) else { fail("bad_args", "\(name) must be a number", .badArgs) }
    return value
}
func windowIdArgument() -> UInt32 {
    guard args.count >= 3, let id = UInt32(args[2]), id > 0 else { fail("bad_args", "window id required", .badArgs) }
    return id
}

/// Exits cleanly (code 0) on stdin EOF and on SIGTERM/SIGINT/SIGHUP, after `cleanup` on the main queue.
var signalSources: [DispatchSourceSignal] = []
func exitOnLifelineEnd(_ cleanup: @escaping () -> Void) {
    var done = false
    let finish = {
        if done { return }
        done = true
        cleanup()
        exit(0)
    }
    for sig in [SIGTERM, SIGINT, SIGHUP] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        source.setEventHandler { finish() }
        source.resume()
        signalSources.append(source)
    }
    Thread.detachNewThread {
        var buffer = [UInt8](repeating: 0, count: 256)
        while true {
            let count = read(0, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 && errno != EINTR { break }
        }
        DispatchQueue.main.async { finish() }
    }
}

func safariApps() -> [NSRunningApplication] {
    NSRunningApplication.runningApplications(withBundleIdentifier: safariBundle)
}

/// CGWindowList entry of a Safari window (hidden/off-screen windows too).
/// `.optionIncludingWindow` alone returns nothing for a hidden Safari (05.11), so scan `.optionAll`.
func safariWindowInfo(_ id: UInt32) -> [String: Any]? {
    guard let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]],
          let info = list.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == id }) else { return nil }
    guard let pid = info[kCGWindowOwnerPID as String] as? pid_t,
          NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == safariBundle else { return nil }
    return info
}

func shareableContent() async throws -> SCShareableContent {
    try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
}

// MARK: - list

func runList() async {
    if !CGPreflightScreenCaptureAccess() {
        printLine(json(["permission": false, "windows": [Any]()]))
        exit(ExitCode.noPermission.rawValue)
    }
    do {
        let content = try await shareableContent()
        let windows: [[String: Any]] = content.windows
            .filter { $0.owningApplication?.bundleIdentifier == safariBundle && $0.windowLayer == 0
                && $0.frame.width >= 100 && $0.frame.height >= 100 }
            .sorted { $0.windowID < $1.windowID }
            .map { ["windowId": $0.windowID, "title": $0.title ?? "", "onScreen": $0.isOnScreen,
                    "width": Int($0.frame.width), "height": Int($0.frame.height)] }
        printLine(json(["permission": true, "windows": windows]))
        exit(0)
    } catch {
        if isPermissionError(error) {
            printLine(json(["permission": false, "windows": [Any]()]))
            exit(ExitCode.noPermission.rawValue)
        }
        fail("capture_failed", errText(error), .other)
    }
}

// MARK: - stream

final class FrameSink: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let quality: Double
    let ciContext = CIContext()
    let queue = DispatchQueue(label: "neo3.safari.frames")
    var lastFingerprint: [UInt8]? = nil
    var lastJPEG: Data? = nil
    var lastSentAt = Date.distantPast
    var onStop: ((Error) -> Void)? = nil

    init(quality: Double) { self.quality = quality }

    func fingerprint(_ image: CGImage) -> [UInt8] {
        let size = 32
        var buffer = [UInt8](repeating: 0, count: size * size * 4)
        if let context = CGContext(data: &buffer, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                                   space: CGColorSpaceCreateDeviceRGB(),
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
            context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        }
        return buffer
    }

    func jpeg(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    /// Runs on `queue`.
    func send(_ frame: Data) {
        var head = UInt32(frame.count).bigEndian
        var packet = Data(bytes: &head, count: 4)
        packet.append(frame)
        if !writeAll(1, packet) { exit(0) } // Neo3 went away
        lastSentAt = Date()
    }

    /// Liveness: the same picture again at least every 2 s. Runs on `queue`.
    func resendIfQuiet() {
        if let frame = lastJPEG, Date().timeIntervalSince(lastSentAt) >= 2 { send(frame) }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let ci = CIImage(cvPixelBuffer: pixels)
        guard let image = ciContext.createCGImage(ci, from: ci.extent) else { return }
        let currentFingerprint = fingerprint(image)
        if let last = lastFingerprint, last == currentFingerprint { resendIfQuiet(); return }
        lastFingerprint = currentFingerprint
        guard let frame = jpeg(image) else { return }
        lastJPEG = frame
        send(frame)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { onStop?(error) }
}

func streamConfiguration(width: CGFloat, height: CGFloat, fps: Int, maxWidth: Int) -> SCStreamConfiguration {
    let config = SCStreamConfiguration()
    let scale = min(1.0, CGFloat(maxWidth) / max(width, 1))
    config.width = max(2, Int(width * scale))
    config.height = max(2, Int(height * scale))
    config.showsCursor = false
    config.capturesAudio = false
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(1, fps)))
    config.queueDepth = 3
    return config
}

var activeStream: SCStream? = nil
var activeSink: FrameSink? = nil
var watchTimer: DispatchSourceTimer? = nil

func runStream() async {
    let id = windowIdArgument()
    let fps = intOption("--fps", 3)
    let maxWidth = intOption("--max-width", 1280)
    let quality = doubleOption("--quality", 0.6)
    guard (1...30).contains(fps), (100...4096).contains(maxWidth), quality > 0, quality <= 1 else {
        fail("bad_args", "fps 1–30, max-width 100–4096, quality 0–1", .badArgs)
    }
    if !CGPreflightScreenCaptureAccess() { fail("no_permission", "Screen Recording is not granted", .noPermission) }

    do {
        let content = try await shareableContent()
        guard let window = content.windows.first(where: { $0.windowID == id && $0.owningApplication?.bundleIdentifier == safariBundle }) else {
            fail("window_gone", "Safari window \(id) not found", .windowGone)
        }
        let sink = FrameSink(quality: quality)
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window),
                              configuration: streamConfiguration(width: window.frame.width, height: window.frame.height, fps: fps, maxWidth: maxWidth),
                              delegate: sink)
        sink.onStop = { error in
            if safariWindowInfo(id) == nil { fail("window_gone", "Safari window \(id) closed", .windowGone) }
            if isPermissionError(error) { fail("no_permission", errText(error), .noPermission) }
            fail("capture_failed", errText(error), .other)
        }
        try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: sink.queue)
        try await stream.startCapture()
        activeStream = stream
        activeSink = sink

        // Every second: window still there? resized? quiet stream → resend for liveness.
        var size = CGSize(width: window.frame.width, height: window.frame.height)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler {
            guard let info = safariWindowInfo(id) else { fail("window_gone", "Safari window \(id) closed", .windowGone) }
            if let boundsDict = info[kCGWindowBounds as String], let bounds = CGRect(dictionaryRepresentation: boundsDict as! CFDictionary),
               abs(bounds.width - size.width) >= 1 || abs(bounds.height - size.height) >= 1 {
                size = bounds.size
                stream.updateConfiguration(streamConfiguration(width: size.width, height: size.height, fps: fps, maxWidth: maxWidth)) { _ in }
            }
            sink.queue.async { sink.resendIfQuiet() }
        }
        timer.resume()
        watchTimer = timer

        exitOnLifelineEnd {
            let done = DispatchSemaphore(value: 0)
            stream.stopCapture { _ in done.signal() }
            _ = done.wait(timeout: .now() + 1)
        }
    } catch {
        if isPermissionError(error) { fail("no_permission", errText(error), .noPermission) }
        if safariWindowInfo(id) == nil { fail("window_gone", "Safari window \(id) not found", .windowGone) }
        fail("capture_failed", errText(error), .other)
    }
}

// MARK: - display

var virtualDisplay: CGVirtualDisplay? = nil // the display lives exactly as long as this reference

/// Hide Safari before the display goes away: its windows would jump onto Dima's screen.
func hideSafari() {
    for safari in safariApps() where !safari.isHidden { _ = safari.hide() }
    RunLoop.main.run(until: Date().addingTimeInterval(0.4))
}

/// Where the virtual display is and where its Safari windows go back to (set once ready).
var virtualBounds: CGRect? = nil
var homeBounds: CGRect? = nil

/// Runs one AppleScript line through osascript; never when Safari is not running (it would launch it).
@discardableResult
func safariScript(_ line: String) -> Bool {
    guard !safariApps().isEmpty else { return false }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", line]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return false }
    process.waitUntilExit()
    return process.terminationStatus == 0
}

/// Safari windows still on the virtual display go back to the main display while Safari is
/// hidden: a window left on a display that disappears was lost in the 05.11 live check.
func bringWindowsHome() {
    guard let away = virtualBounds, let home = homeBounds, !safariApps().isEmpty,
          let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return }
    for info in list {
        guard (info[kCGWindowLayer as String] as? Int) == 0,
              let pid = info[kCGWindowOwnerPID as String] as? pid_t,
              NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == safariBundle,
              let id = info[kCGWindowNumber as String] as? UInt32,
              let raw = info[kCGWindowBounds as String], let frame = CGRect(dictionaryRepresentation: raw as! CFDictionary),
              frame.width >= 100, frame.height >= 100, away.intersects(frame) else { continue }
        let width = min(frame.width, home.width - 120), height = min(frame.height, home.height - 120)
        let x = Int(home.minX + 60), y = Int(home.minY + 60)
        safariScript("tell application \"Safari\" to set bounds of window id \(id) to {\(x), \(y), \(x + Int(width)), \(y + Int(height))}")
    }
}

func destroyDisplay() {
    guard virtualDisplay != nil else { return }
    hideSafari()
    bringWindowsHome()
    virtualDisplay = nil
    RunLoop.main.run(until: Date().addingTimeInterval(0.3))
}

func runDisplay() {
    let width = intOption("--width", 1920)
    let height = intOption("--height", 1200)
    guard (640...4096).contains(width), (480...4096).contains(height) else { fail("bad_args", "width 640–4096, height 480–4096", .badArgs) }

    let descriptor = CGVirtualDisplayDescriptor()
    descriptor.queue = DispatchQueue.main
    descriptor.name = "Neo3 Safari"
    descriptor.maxPixelsWide = UInt32(width)
    descriptor.maxPixelsHigh = UInt32(height)
    descriptor.sizeInMillimeters = CGSize(width: Double(width) * 0.27, height: Double(height) * 0.27)
    descriptor.vendorID = 0x3456
    descriptor.productID = 0x1234
    descriptor.serialNum = 0x0001
    descriptor.terminationHandler = { _, _ in
        DispatchQueue.main.async {
            hideSafari()
            fail("display_failed", "the system removed the virtual display", .displayFailed)
        }
    }

    // Snapshot of the user's arrangement: on a mirrored Mac the new display joins the
    // mirror set as master and becomes main (probe 05.11) — everything goes back in one
    // session-only transaction (never a permanent setting).
    struct Snapshot { let id: CGDirectDisplayID; let bounds: CGRect; let mirrorOf: CGDirectDisplayID }
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetOnlineDisplayList(16, &ids, &count)
    let snapshot = ids[0..<Int(count)].map { Snapshot(id: $0, bounds: CGDisplayBounds($0), mirrorOf: CGDisplayMirrorsDisplay($0)) }
    let oldMain = CGMainDisplayID()
    let main = CGDisplayBounds(oldMain)

    guard let display = CGVirtualDisplay(descriptor: descriptor) else { fail("display_failed", "CGVirtualDisplay init failed", .displayFailed) }
    let settings = CGVirtualDisplaySettings()
    settings.hiDPI = 0
    settings.modes = [CGVirtualDisplayMode(width: UInt(width), height: UInt(height), refreshRate: 60)]
    guard display.apply(settings) else { fail("display_failed", "CGVirtualDisplay apply failed", .displayFailed) }
    virtualDisplay = display
    let vid = display.displayID

    var online = false
    for _ in 0..<300 {
        var list = [CGDirectDisplayID](repeating: 0, count: 16)
        var listCount: UInt32 = 0
        CGGetOnlineDisplayList(16, &list, &listCount)
        if list[0..<Int(listCount)].contains(vid) { online = true; break }
        RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    }
    if !online {
        destroyDisplay()
        fail("display_failed", "virtual display did not come online", .displayFailed)
    }

    // Far corner: origin = bottom-right corner of the main display; touches it in one point.
    let origin = (Int32(main.maxX), Int32(main.maxY))
    var config: CGDisplayConfigRef? = nil
    var errors: [Int32] = []
    errors.append(CGBeginDisplayConfiguration(&config).rawValue)
    errors.append(CGConfigureDisplayMirrorOfDisplay(config, vid, kCGNullDirectDisplay).rawValue)
    for item in snapshot {
        errors.append(CGConfigureDisplayMirrorOfDisplay(config, item.id, item.mirrorOf).rawValue)
        if item.mirrorOf == 0 {
            errors.append(CGConfigureDisplayOrigin(config, item.id, Int32(item.bounds.minX), Int32(item.bounds.minY)).rawValue)
        }
    }
    errors.append(CGConfigureDisplayOrigin(config, vid, origin.0, origin.1).rawValue)
    errors.append(CGCompleteDisplayConfiguration(config, .forSession).rawValue)
    RunLoop.main.run(until: Date().addingTimeInterval(1.5))

    // The user's arrangement must be exactly as before, else remove the display (that restores it).
    let restored = CGMainDisplayID() == oldMain
        && snapshot.allSatisfy { CGDisplayBounds($0.id) == $0.bounds && CGDisplayMirrorsDisplay($0.id) == $0.mirrorOf }
        && CGDisplayIsInMirrorSet(vid) == 0
    if !restored || errors.contains(where: { $0 != 0 }) {
        destroyDisplay()
        RunLoop.main.run(until: Date().addingTimeInterval(0.7))
        fail("display_failed", "monitor layout was not restored (errors \(errors)); virtual display removed", .displayFailed)
    }

    let bounds = CGDisplayBounds(vid)
    virtualBounds = bounds
    homeBounds = main
    printLine(json(["ready": true, "displayId": vid,
                    "bounds": ["x": Int(bounds.minX), "y": Int(bounds.minY), "width": Int(bounds.width), "height": Int(bounds.height)]]))
    exitOnLifelineEnd { destroyDisplay() }
    RunLoop.main.run()
}

// MARK: - place

func runPlace() {
    let id = windowIdArgument()
    guard let xRaw = option("--x"), let yRaw = option("--y"), let wRaw = option("--width"), let hRaw = option("--height"),
          let x = Int(xRaw), let y = Int(yRaw), let width = Int(wRaw), let height = Int(hRaw), width >= 100, height >= 100 else {
        fail("bad_args", "--x --y --width --height required (size ≥ 100)", .badArgs)
    }
    // AppleScript to a Safari that is not running would launch it.
    guard let safari = safariApps().first else { fail("window_gone", "Safari is not running", .windowGone) }
    guard safariWindowInfo(id) != nil else { fail("window_gone", "Safari window \(id) not found", .windowGone) }

    let script = "tell application \"Safari\" to set bounds of window id \(id) to {\(x), \(y), \(x + width), \(y + height)}"
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", script]
    let errorPipe = Pipe()
    process.standardError = errorPipe
    process.standardOutput = FileHandle.nullDevice
    do {
        try process.run()
    } catch {
        fail("capture_failed", "osascript: \(errText(error))", .other)
    }
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        let text = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if safariWindowInfo(id) == nil { fail("window_gone", "Safari window \(id) closed", .windowGone) }
        fail("capture_failed", "set bounds failed: \(text)", .other)
    }
    // Shown, not activated: Safari stays behind whatever Dima is using.
    if safari.isHidden { _ = safari.unhide() }
    RunLoop.main.run(until: Date().addingTimeInterval(0.2))
    printLine(json(["ok": true]))
    exit(0)
}

// MARK: - main

guard args.count >= 2 else { fail("bad_args", "usage: neo3-safari-capture list | stream <id> | display | place <id> …", .badArgs) }

switch args[1] {
case "display":
    runDisplay()
case "place":
    runPlace()
case "list":
    Task { await runList() }
case "stream":
    Task { await runStream() }
default:
    fail("bad_args", "unknown command \(args[1])", .badArgs)
}
RunLoop.main.run()
