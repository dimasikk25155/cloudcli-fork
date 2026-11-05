// neo3-browser — the invisible WebKit browser of Neo3 (contract: interfaces.md, part 2 §A).
//
// `neo3-browser serve`: one long-lived process. stdin — one JSON command per line,
// stdout — one JSON reply or event per line, stderr — diagnostics only (never the
// content of a command: typed text, scripts and addresses are not logged).
//
// Invisible by construction (probe 3, notes.md):
//   - activation policy `.prohibited` (+ LSBackgroundOnly in the embedded Info.plist):
//     no Dock icon, no menu bar, never the active app;
//   - every page is a borderless 1280×800 window far off every screen (-20000,-20000),
//     ordered with `orderFrontRegardless` (never `activate`), plus the WebKit SPI
//     `_setWindowOcclusionDetectionEnabled:` = false called through its IMP — without it
//     the page counts as hidden and stops drawing;
//   - no virtual displays, no screen changes, no other app is touched.
// Input is synthetic `NSEvent`s sent straight to the WKWebView: the page sees real events,
// the Mac focus never moves. Logins live in the persistent WebKit store of the bundle id
// `ru.neo3.browser` and survive restarts.
// Closing stdin or SIGTERM closes the pages and exits 0. The process never exits on a timer:
// the Neo3 server unloads it.

import AppKit
import CryptoKit
import WebKit

let PAGE_WIDTH: CGFloat = 1280
let PAGE_HEIGHT: CGFloat = 800
let OPEN_TIMEOUT_SEC = 20.0
let MAX_WAIT_MS = 30_000
let DEFAULT_MAX_CHARS = 20_000
let KEEPALIVE_SEC = 2.0

// MARK: - Output (one JSON object per line)

signal(SIGPIPE, SIG_IGN)
let outputLock = NSLock()

func writeLine(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          var data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else {
        diag("reply is not JSON-serialisable")
        return
    }
    data.append(0x0A)
    outputLock.lock()
    defer { outputLock.unlock() }
    data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
        var offset = 0
        while offset < buffer.count {
            let written = write(STDOUT_FILENO, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if written <= 0 {
                if errno == EINTR { continue }
                // The server is gone: nobody reads us any more.
                exit(0)
            }
            offset += written
        }
    }
}

/// Diagnostics only: never pass page content, typed text, scripts or addresses here.
func diag(_ text: String) {
    FileHandle.standardError.write(("neo3-browser: " + text + "\n").data(using: .utf8)!)
}

struct HelperError: Error {
    let code: String
    let message: String
}

func badArgs(_ message: String) -> HelperError { HelperError(code: "bad_args", message: message) }

// MARK: - Argument helpers

func str(_ args: [String: Any], _ key: String) -> String? {
    if let value = args[key] as? String { return value }
    return nil
}

func num(_ args: [String: Any], _ key: String) -> Double? {
    if let value = args[key] as? NSNumber, !(value === kCFBooleanTrue || value === kCFBooleanFalse) {
        let double = value.doubleValue
        return double.isFinite ? double : nil
    }
    return nil
}

func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double { min(max(value, low), high) }

/// JSON-safe copy of a JavaScript result (dates → ISO strings, unknown → description).
func jsonSafe(_ value: Any?) -> Any {
    guard let value else { return NSNull() }
    switch value {
    case is NSNull: return NSNull()
    case let string as String: return string
    case let number as NSNumber: return number.doubleValue.isFinite ? number : NSNull()
    case let date as Date: return ISO8601DateFormatter().string(from: date)
    case let array as [Any]: return array.map { jsonSafe($0) }
    case let dictionary as [String: Any]: return dictionary.mapValues { jsonSafe($0) }
    default: return String(describing: value)
    }
}

// MARK: - Keys

struct KeySpec {
    let characters: String
    let keyCode: UInt16
    let function: Bool
}

func scalar(_ value: Int) -> String { String(UnicodeScalar(UInt32(value))!) }

let KEYS: [String: KeySpec] = [
    "Enter": KeySpec(characters: "\r", keyCode: 36, function: false),
    "Tab": KeySpec(characters: "\t", keyCode: 48, function: false),
    "Backspace": KeySpec(characters: "\u{7f}", keyCode: 51, function: false),
    "Escape": KeySpec(characters: "\u{1b}", keyCode: 53, function: false),
    "ArrowUp": KeySpec(characters: scalar(NSUpArrowFunctionKey), keyCode: 126, function: true),
    "ArrowDown": KeySpec(characters: scalar(NSDownArrowFunctionKey), keyCode: 125, function: true),
    "ArrowLeft": KeySpec(characters: scalar(NSLeftArrowFunctionKey), keyCode: 123, function: true),
    "ArrowRight": KeySpec(characters: scalar(NSRightArrowFunctionKey), keyCode: 124, function: true),
    "PageDown": KeySpec(characters: scalar(NSPageDownFunctionKey), keyCode: 121, function: true),
    "PageUp": KeySpec(characters: scalar(NSPageUpFunctionKey), keyCode: 116, function: true),
]

// MARK: - Page scripts (run in the isolated client world: the page cannot tamper with them)

/// Centre of the first visible element by selector or by text; scrolled into view first.
let FIND_ELEMENT_JS = """
const visible = (el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
};
const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
let el = null;
if (selector) {
  el = [...document.querySelectorAll(selector)].find(visible) || null;
} else {
  const wanted = String(text).trim().toLowerCase();
  const clickable = [...document.querySelectorAll('a,button,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label,summary,[onclick]')].filter(visible);
  el = clickable.find((e) => label(e) === wanted) || clickable.find((e) => label(e).includes(wanted)) || null;
  if (!el && document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.toLowerCase().includes(wanted) && node.parentElement && visible(node.parentElement)) { el = node.parentElement; break; }
    }
  }
}
if (!el) return null;
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
const r = el.getBoundingClientRect();
return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
"""

let READ_JS = """
const root = selector ? document.querySelector(selector) : (format === 'html' ? document.documentElement : document.body);
if (!root) return null;
if (format === 'html') return root.outerHTML;
if (format === 'links') {
  const seen = new Set(); const lines = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.href; if (!href || href.startsWith('javascript:')) continue;
    const name = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\\s+/g, ' ');
    const line = (name ? name + ' — ' : '') + href;
    if (seen.has(line)) continue; seen.add(line); lines.push(line);
  }
  return lines.join('\\n');
}
return root.innerText || '';
"""

let EXISTS_JS = "return !!document.querySelector(selector);"

/// Scroll positions under a point: window + every scrollable ancestor (to see whether a wheel moved anything).
let SCROLL_STATE_JS = """
const parts = [window.scrollX, window.scrollY];
for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) parts.push(el.scrollTop, el.scrollLeft);
return parts.join(',');
"""

/// Fallback when WebKit swallowed the wheel (right after a load): scroll the nearest scrollable box under the point.
let SCROLL_BY_JS = """
let el = document.elementFromPoint(x, y);
while (el && el !== document.body && el !== document.documentElement) {
  const s = getComputedStyle(el);
  if (/(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) break;
  el = el.parentElement;
}
(el && el !== document.body && el !== document.documentElement ? el : (document.scrollingElement || document.documentElement)).scrollBy(0, dy);
return true;
"""

// MARK: - Page

final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class Page: NSObject, WKNavigationDelegate, WKUIDelegate {
    let id: String
    let window: KeyableWindow
    let webView: WKWebView
    var loading = false
    var loadWaiters: [(HelperError?) -> Void] = []
    var watchTimer: DispatchSourceTimer?
    var watchFps = 3.0
    var snapshotInFlight = false
    var lastFrameHash = ""
    var lastFrameAt = 0.0
    var mouseIsDown = false
    var observers: [NSKeyValueObservation] = []
    var lastNavigated = ""
    var navigatedScheduled = false
    var closed = false
    weak var browser: Browser?

    init(id: String, browser: Browser) {
        self.id = id
        self.browser = browser
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT), configuration: configuration)
        // Without this SPI an off-screen window is "occluded": the page goes hidden and stops drawing.
        let selector = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if webView.responds(to: selector), let method = class_getInstanceMethod(Swift.type(of: webView), selector) {
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(method_getImplementation(method), to: Setter.self)(webView, selector, false)
        } else {
            diag("occlusion SPI is missing: the picture may not update")
        }
        let window = KeyableWindow(
            contentRect: NSRect(x: -20000, y: -20000, width: PAGE_WIDTH, height: PAGE_HEIGHT),
            styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.hasShadow = false
        window.collectionBehavior = [.transient, .ignoresCycle, .stationary, .fullScreenNone, .canJoinAllSpaces]
        window.isExcludedFromWindowsMenu = true
        window.contentView = webView
        self.window = window
        self.webView = webView
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.orderFrontRegardless()
        observers.append(webView.observe(\.url, options: []) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.scheduleNavigated() }
        })
        observers.append(webView.observe(\.title, options: []) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.scheduleNavigated() }
        })
    }

    var url: String { webView.url?.absoluteString ?? "" }
    var title: String { webView.title ?? "" }

    /// `webView.title` can lag the end of the load by a moment: ask the document then.
    func currentTitle() async -> String {
        if !title.isEmpty { return title }
        return ((try? await callJS("return document.title || '';", [:])) as? String) ?? ""
    }

    func info() -> [String: Any] { ["page": id, "url": url, "title": title, "loading": loading || webView.isLoading] }

    func scheduleNavigated() {
        if navigatedScheduled || closed { return }
        navigatedScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.navigatedScheduled = false
                if self.closed { return }
                let key = self.url + "\u{0}" + self.title
                if key == self.lastNavigated || self.url.isEmpty { return }
                self.lastNavigated = key
                writeLine(["event": "navigated", "page": self.id, "url": self.url, "title": self.title])
            }
        }
    }

    // Navigation

    func finishLoad(_ error: HelperError?) {
        loading = false
        let waiters = loadWaiters
        loadWaiters = []
        for waiter in waiters { waiter(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            finishLoad(nil)
            scheduleNavigated()
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failLoad(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failLoad(error) }
    }

    func failLoad(_ error: Error) {
        let nsError = error as NSError
        // A newer navigation replaced this one: its own finish resolves the waiters.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        finishLoad(HelperError(code: "navigation_failed", message: nsError.localizedDescription))
    }

    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        MainActor.assumeIsolated {
            diag("web content process ended; reloading the page")
            webView.reload()
        }
    }

    // `target=_blank` and window.open: one page per chat — open in this page.
    nonisolated func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                             for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        MainActor.assumeIsolated {
            if let target = navigationAction.request.url { webView.load(URLRequest(url: target)) }
        }
        return nil
    }

    nonisolated func webViewDidClose(_ webView: WKWebView) {
        MainActor.assumeIsolated { browser?.closePage(id, reason: "page") }
    }

    func load(_ target: URL) async -> HelperError? {
        loading = true
        // A previous `open` still waiting is answered by this navigation's end.
        return await withCheckedContinuation { (continuation: CheckedContinuation<HelperError?, Never>) in
            var settled = false
            let settle: (HelperError?) -> Void = { error in
                if settled { return }
                settled = true
                continuation.resume(returning: error)
            }
            loadWaiters.append(settle)
            webView.load(URLRequest(url: target))
            DispatchQueue.main.asyncAfter(deadline: .now() + OPEN_TIMEOUT_SEC) {
                settle(HelperError(code: "timeout", message: "still loading"))
            }
        }
    }

    // Scripts

    func callJS(_ body: String, _ arguments: [String: Any], world: WKContentWorld? = nil) async throws -> Any? {
        do {
            return try await webView.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: world ?? .defaultClient)
        } catch {
            throw HelperError(code: "js_error", message: (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)
        }
    }

    /// Agent's own script in the page world: an expression or statements; a promise is awaited.
    func evaluate(_ source: String) async throws -> Any? {
        do {
            return try await webView.evaluateJavaScript(source)
        } catch {
            let nsError = error as NSError
            if nsError.domain == WKError.errorDomain && nsError.code == WKError.javaScriptResultTypeIsUnsupported.rawValue {
                return try await callJS("return await (\n" + source + "\n);", [:], world: .page)
            }
            throw HelperError(code: "js_error", message: nsError.userInfo["WKJavaScriptExceptionMessage"] as? String ?? nsError.localizedDescription)
        }
    }

    // Input: synthetic events straight into the web view (page coordinates, top-left origin).

    func windowPoint(_ x: Double, _ y: Double) -> NSPoint {
        NSPoint(x: clamp(x, 0, Double(PAGE_WIDTH) - 1), y: Double(PAGE_HEIGHT) - clamp(y, 0, Double(PAGE_HEIGHT) - 1))
    }

    func mouse(_ type: NSEvent.EventType, _ x: Double, _ y: Double) {
        guard let event = NSEvent.mouseEvent(
            with: type, location: windowPoint(x, y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
            pressure: type == .leftMouseDown || type == .leftMouseDragged ? 1 : 0) else { return }
        switch type {
        case .leftMouseDown: mouseIsDown = true; webView.mouseDown(with: event)
        case .leftMouseUp: mouseIsDown = false; webView.mouseUp(with: event)
        case .leftMouseDragged: webView.mouseDragged(with: event)
        default: webView.mouseMoved(with: event)
        }
    }

    func click(_ x: Double, _ y: Double) {
        mouse(.leftMouseDown, x, y)
        mouse(.leftMouseUp, x, y)
    }

    func scroll(dy: Double, x: Double, y: Double) {
        let delta = Int32(clamp(-dy, -100_000, 100_000))
        // An event without a window carries its location as is: give it the point in window coordinates.
        let point = windowPoint(x, y)
        let mainHeight = NSScreen.screens.first?.frame.height ?? 0
        // A whole trackpad-like gesture (began → changed → ended): a lone legacy wheel event
        // after a pause is swallowed by WebKit's scroll latching.
        let phases: [(Int64, Int32)] = [(1, 0), (2, delta), (4, 0)]  // kCGScrollPhaseBegan / Changed / Ended
        for (phase, value) in phases {
            guard let cgEvent = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: value, wheel2: 0, wheel3: 0) else { continue }
            cgEvent.location = CGPoint(x: point.x, y: mainHeight - point.y)
            cgEvent.setIntegerValueField(CGEventField(rawValue: 99)!, value: phase)  // kCGScrollWheelEventScrollPhase
            guard let event = NSEvent(cgEvent: cgEvent) else { continue }
            webView.scrollWheel(with: event)
        }
    }

    /// Wheel first (the page sees real wheel events); if nothing moved, scroll by script.
    func scrollAndCheck(dy: Double, x: Double, y: Double) async {
        let point: [String: Any] = ["x": clamp(x, 0, Double(PAGE_WIDTH) - 1), "y": clamp(y, 0, Double(PAGE_HEIGHT) - 1)]
        let before = try? await callJS(SCROLL_STATE_JS, point) as? String
        scroll(dy: dy, x: x, y: y)
        try? await Task.sleep(nanoseconds: 180_000_000)
        let after = try? await callJS(SCROLL_STATE_JS, point) as? String
        if before != nil && before == after {
            _ = try? await callJS(SCROLL_BY_JS, point.merging(["dy": dy]) { current, _ in current })
        }
    }

    func key(_ spec: KeySpec) {
        let flags: NSEvent.ModifierFlags = spec.function ? [.function, .numericPad] : []
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: spec.characters,
                charactersIgnoringModifiers: spec.characters, isARepeat: false, keyCode: spec.keyCode) else { continue }
            if type == .keyDown { webView.keyDown(with: event) } else { webView.keyUp(with: event) }
        }
    }

    func typeText(_ text: String) {
        for character in text {
            if character == "\n" || character == "\r" { key(KEYS["Enter"]!); continue }
            if character == "\t" { key(KEYS["Tab"]!); continue }
            key(KeySpec(characters: String(character), keyCode: 0, function: false))
        }
    }

    // Pictures

    func snapshot(maxWidth: Double, quality: Double) async -> (Data, Int, Int)? {
        let configuration = WKSnapshotConfiguration()
        configuration.rect = NSRect(x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT)
        let width = clamp(maxWidth, 160, Double(PAGE_WIDTH))
        configuration.snapshotWidth = NSNumber(value: width)
        let image: NSImage? = await withCheckedContinuation { continuation in
            webView.takeSnapshot(with: configuration) { image, _ in continuation.resume(returning: image) }
        }
        guard let image, var cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        if Double(cgImage.width) > width + 0.5 {
            // A Retina backing gives twice the pixels: scale down to the asked width.
            let targetWidth = Int(width)
            let targetHeight = Int((Double(cgImage.height) * width / Double(cgImage.width)).rounded())
            guard let context = CGContext(data: nil, width: targetWidth, height: targetHeight, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
            context.interpolationQuality = .medium
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))
            guard let scaled = context.makeImage() else { return nil }
            cgImage = scaled
        }
        let representation = NSBitmapImageRep(cgImage: cgImage)
        guard let jpeg = representation.representation(using: .jpeg, properties: [.compressionFactor: clamp(quality, 0.1, 1)]) else { return nil }
        return (jpeg, cgImage.width, cgImage.height)
    }

    func startWatch(fps: Double) {
        watchFps = clamp(fps, 1, 10)
        watchTimer?.cancel()
        lastFrameHash = ""
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: 1.0 / watchFps, leeway: .milliseconds(20))
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.tick() }
        }
        watchTimer = timer
        timer.resume()
    }

    func stopWatch() {
        watchTimer?.cancel()
        watchTimer = nil
    }

    func tick() {
        if snapshotInFlight || closed { return }
        snapshotInFlight = true
        Task { @MainActor in
            defer { snapshotInFlight = false }
            guard watchTimer != nil, !closed, let (jpeg, _, _) = await snapshot(maxWidth: Double(PAGE_WIDTH), quality: 0.6) else { return }
            let hash = SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined()
            let now = ProcessInfo.processInfo.systemUptime
            // Same picture: skip it, but still send one every 2 s (the viewer sees the stream is alive).
            if hash == lastFrameHash && now - lastFrameAt < KEEPALIVE_SEC { return }
            lastFrameHash = hash
            lastFrameAt = now
            writeLine(["event": "frame", "page": id, "jpeg": jpeg.base64EncodedString()])
        }
    }

    func close() {
        if closed { return }
        closed = true
        stopWatch()
        observers.removeAll()
        finishLoad(HelperError(code: "no_page", message: "page closed"))
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        window.orderOut(nil)
        window.contentView = nil
        window.close()
    }
}

// MARK: - Browser (all pages, command dispatch)

@MainActor
final class Browser {
    var pages: [String: Page] = [:]
    var shuttingDown = false

    func page(_ args: [String: Any]) throws -> Page {
        guard let id = str(args, "page"), !id.isEmpty else { throw badArgs("page is required") }
        guard let page = pages[id] else { throw HelperError(code: "no_page", message: "no such page") }
        return page
    }

    func closePage(_ id: String, reason: String) {
        guard let page = pages.removeValue(forKey: id) else { return }
        page.close()
        writeLine(["event": "closed", "page": id])
        _ = reason
    }

    func point(_ args: [String: Any]) -> (Double, Double)? {
        guard let x = num(args, "x"), let y = num(args, "y") else { return nil }
        return (x, y)
    }

    /// Centre of an element by selector/text (page coordinates), else `no_element`.
    func locate(_ page: Page, selector: String?, text: String?) async throws -> (Double, Double) {
        let found = try await page.callJS(FIND_ELEMENT_JS, ["selector": selector ?? "", "text": text ?? ""])
        guard let box = found as? [String: Any], let x = box["x"] as? NSNumber, let y = box["y"] as? NSNumber else {
            throw HelperError(code: "no_element", message: "element not found")
        }
        return (x.doubleValue, y.doubleValue)
    }

    func settle(_ ms: Double) async { try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000)) }

    func handle(_ op: String, _ args: [String: Any]) async throws -> [String: Any] {
        switch op {
        case "open":
            guard let id = str(args, "page"), !id.isEmpty, id.count <= 200 else { throw badArgs("page is required") }
            guard let raw = str(args, "url"), let target = URL(string: raw),
                  let scheme = target.scheme?.lowercased(), ["http", "https", "about"].contains(scheme) else {
                throw badArgs("url must be http(s)")
            }
            let page = pages[id] ?? {
                let created = Page(id: id, browser: self)
                pages[id] = created
                return created
            }()
            let error = await page.load(target)
            if page.closed { throw HelperError(code: "no_page", message: "page closed") }
            if let error, error.code == "timeout" { return ["url": page.url.isEmpty ? raw : page.url, "title": page.title, "loading": true] }
            if let error { throw error }
            return ["url": page.url, "title": await page.currentTitle()]

        case "close":
            guard let id = str(args, "page"), !id.isEmpty else { throw badArgs("page is required") }
            closePage(id, reason: "command")
            return ["pages": pages.count]

        case "list":
            return ["pages": pages.keys.sorted().map { pages[$0]!.info() }]

        case "click":
            let page = try page(args)
            let target: (Double, Double)
            if let point = point(args) {
                target = point
            } else if let selector = str(args, "selector"), !selector.isEmpty {
                target = try await locate(page, selector: selector, text: nil)
            } else if let text = str(args, "text"), !text.trimmingCharacters(in: .whitespaces).isEmpty {
                target = try await locate(page, selector: nil, text: text)
            } else {
                throw badArgs("x,y or selector or text is required")
            }
            page.click(target.0, target.1)
            await settle(150)
            return ["x": target.0, "y": target.1, "url": page.url, "title": page.title]

        case "type":
            let page = try page(args)
            guard let text = str(args, "text") else { throw badArgs("text is required") }
            if let selector = str(args, "selector"), !selector.isEmpty {
                let target = try await locate(page, selector: selector, text: nil)
                page.click(target.0, target.1)
                await settle(80)
            }
            page.typeText(text)
            await settle(50)
            return ["url": page.url, "title": page.title]

        case "press":
            let page = try page(args)
            guard let name = str(args, "key"), let spec = KEYS[name] else { throw badArgs("unknown key") }
            page.key(spec)
            await settle(100)
            return ["url": page.url, "title": page.title]

        case "scroll":
            let page = try page(args)
            guard let dy = num(args, "dy") else { throw badArgs("dy is required") }
            await page.scrollAndCheck(dy: dy, x: num(args, "x") ?? Double(PAGE_WIDTH) / 2, y: num(args, "y") ?? Double(PAGE_HEIGHT) / 2)
            return ["url": page.url, "title": page.title]

        case "read":
            let page = try page(args)
            let format = str(args, "format") ?? "text"
            guard ["text", "html", "links"].contains(format) else { throw badArgs("format is text, html or links") }
            let max = Int(clamp(num(args, "max") ?? Double(DEFAULT_MAX_CHARS), 100, 2_000_000))
            let selector = str(args, "selector") ?? ""
            let result = try await page.callJS(READ_JS, ["selector": selector, "format": format])
            guard let content = result as? String else {
                if selector.isEmpty { return ["url": page.url, "title": page.title, "content": "", "truncated": false] }
                throw HelperError(code: "no_element", message: "element not found")
            }
            let truncated = content.count > max
            return ["url": page.url, "title": page.title, "content": truncated ? String(content.prefix(max)) : content, "truncated": truncated]

        case "eval":
            let page = try page(args)
            guard let source = str(args, "js"), !source.isEmpty else { throw badArgs("js is required") }
            let value = jsonSafe(try await page.evaluate(source))
            if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), data.count > DEFAULT_MAX_CHARS {
                let text = String(decoding: data, as: UTF8.self)
                return ["result": String(text.prefix(DEFAULT_MAX_CHARS)), "truncated": true]
            }
            return ["result": value]

        case "wait":
            let page = try page(args)
            let ms = clamp(num(args, "ms") ?? 10_000, 0, Double(MAX_WAIT_MS))
            if let selector = str(args, "selector"), !selector.isEmpty {
                let until = ProcessInfo.processInfo.systemUptime + ms / 1000
                while true {
                    if page.closed { throw HelperError(code: "no_page", message: "page closed") }
                    if (try? await page.callJS(EXISTS_JS, ["selector": selector])) as? Bool == true {
                        return ["url": page.url, "title": page.title, "found": true]
                    }
                    if ProcessInfo.processInfo.systemUptime >= until { throw HelperError(code: "timeout", message: "selector did not appear") }
                    await settle(100)
                }
            }
            if num(args, "ms") != nil {
                await settle(ms)
            } else {
                // No selector, no time: until the page finishes loading.
                let until = ProcessInfo.processInfo.systemUptime + Double(MAX_WAIT_MS) / 1000
                while page.webView.isLoading && !page.closed && ProcessInfo.processInfo.systemUptime < until { await settle(100) }
            }
            return ["url": page.url, "title": page.title, "loading": page.webView.isLoading]

        case "snapshot":
            let page = try page(args)
            guard let (jpeg, width, height) = await page.snapshot(maxWidth: num(args, "maxWidth") ?? Double(PAGE_WIDTH), quality: num(args, "quality") ?? 0.7) else {
                throw HelperError(code: "snapshot_failed", message: "no picture")
            }
            return ["jpeg": jpeg.base64EncodedString(), "width": width, "height": height]

        case "watch":
            let page = try page(args)
            page.startWatch(fps: num(args, "fps") ?? 3)
            return [:]

        case "unwatch":
            if let id = str(args, "page"), let page = pages[id] { page.stopWatch() }
            return [:]

        case "input":
            // The user's own input: its content is never logged or echoed.
            let page = try page(args)
            let kind = str(args, "kind") ?? ""
            let x = num(args, "x") ?? Double(PAGE_WIDTH) / 2
            let y = num(args, "y") ?? Double(PAGE_HEIGHT) / 2
            switch kind {
            case "click": page.click(x, y)
            case "down": page.mouse(.leftMouseDown, x, y)
            case "up": page.mouse(.leftMouseUp, x, y)
            case "move": page.mouse(page.mouseIsDown ? .leftMouseDragged : .mouseMoved, x, y)
            case "scroll":
                guard let dy = num(args, "dy") else { throw badArgs("dy is required") }
                await page.scrollAndCheck(dy: dy, x: x, y: y)
            case "key":
                guard let name = str(args, "key"), let spec = KEYS[name] else { throw badArgs("unknown key") }
                page.key(spec)
            case "text":
                guard let text = str(args, "text") else { throw badArgs("text is required") }
                page.typeText(text)
            default: throw badArgs("unknown input kind")
            }
            return [:]

        default:
            throw badArgs("unknown op")
        }
    }

    func dispatch(_ line: String) {
        guard let data = line.data(using: .utf8),
              let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            diag("a line that is not a JSON command was ignored")
            return
        }
        let id = command["id"] ?? NSNull()
        let op = str(command, "op") ?? ""
        Task { @MainActor in
            do {
                var reply = try await self.handle(op, command)
                reply["id"] = id
                reply["ok"] = true
                writeLine(reply)
            } catch let error as HelperError {
                writeLine(["id": id, "ok": false, "error": error.code, "message": error.message])
            } catch {
                writeLine(["id": id, "ok": false, "error": "js_error", "message": error.localizedDescription])
            }
        }
    }

    func shutdown() {
        if shuttingDown { return }
        shuttingDown = true
        for id in pages.keys.sorted() { closePage(id, reason: "shutdown") }
        // Give the WebKit network process a moment to write cookies to disk.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { exit(0) }
    }
}

// MARK: - Main

let arguments = CommandLine.arguments.dropFirst()
guard arguments.first == "serve" else {
    diag("usage: neo3-browser serve")
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
// Frames come on a timer: keep App Nap from slowing it down.
let activity = ProcessInfo.processInfo.beginActivity(
    options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical], reason: "neo3 browser pages")
let browser = MainActor.assumeIsolated { Browser() }

signal(SIGTERM, SIG_IGN)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSource.setEventHandler { MainActor.assumeIsolated { browser.shutdown() } }
termSource.resume()

Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }
        DispatchQueue.main.async { MainActor.assumeIsolated { browser.dispatch(line) } }
    }
    DispatchQueue.main.async { MainActor.assumeIsolated { browser.shutdown() } }
}

app.run()
_ = activity
