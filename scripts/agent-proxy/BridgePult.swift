// «Пульт моста» — окно для Димы: видно, работает ли мост ИИ и через какой путь,
// и можно переключить путь, починить, выключить/вернуть мост, позвать запасного агента.
// Вся логика — в ~/.local/share/neo3-agent-proxy/bridge.py; окно только вызывает его.
// Работает без ИИ, без терминала и без Happ.
import AppKit

private let home = FileManager.default.homeDirectoryForCurrentUser.path
private let supportDir = home + "/.local/share/neo3-agent-proxy"
private let bridgeScript = supportDir + "/bridge.py"
private let rescueCommand = home + "/.local/share/rescue-agent/Запасной агент.command"

struct BridgeStatus {
    var level = "red"
    var text = "Проверяю…"
    var mode = "auto"
    var installed = true
    var routeTitle: String?
    var routeSince: Double?
    var blocked = 0

    init() {}
    init?(json: String) {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        level = obj["level"] as? String ?? "red"
        text = obj["text"] as? String ?? ""
        mode = obj["mode"] as? String ?? "auto"
        installed = obj["installed"] as? Bool ?? false
        routeTitle = obj["route_title"] as? String
        routeSince = obj["route_since"] as? Double
        blocked = obj["blocked_last_hour"] as? Int ?? 0
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var dot: NSView!
    private var headline: NSTextField!
    private var detail: NSTextField!
    private var output: NSTextField!
    private var modeButtons: [String: NSButton] = [:]
    private var actionButtons: [NSButton] = []
    private var powerButton: NSButton!
    private var timer: Timer?
    private var busy = false
    private var last = BridgeStatus()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Завершить", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = menu

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 470),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Пульт моста"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 16
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
        ])

        // Статус: цветная точка + крупная строка + подробности.
        dot = NSView()
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 11
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.widthAnchor.constraint(equalToConstant: 22).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 22).isActive = true
        headline = NSTextField(wrappingLabelWithString: "Проверяю мост…")
        headline.font = .systemFont(ofSize: 19, weight: .semibold)
        headline.preferredMaxLayoutWidth = 500
        let statusRow = NSStackView(views: [dot, headline])
        statusRow.alignment = .centerY
        statusRow.spacing = 12
        root.addArrangedSubview(statusRow)

        detail = NSTextField(wrappingLabelWithString: "")
        detail.font = .systemFont(ofSize: 13)
        detail.textColor = .secondaryLabelColor
        detail.preferredMaxLayoutWidth = 540
        root.addArrangedSubview(detail)

        root.addArrangedSubview(sectionTitle("Путь до общего IP"))
        let modes = NSStackView()
        modes.spacing = 10
        for (key, title) in [("auto", "Авто"), ("mitya", "Через Митю"), ("vps", "Через мой VPS")] {
            let button = makeButton(title, #selector(chooseMode(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(key)
            button.setButtonType(.pushOnPushOff)
            modeButtons[key] = button
            modes.addArrangedSubview(button)
        }
        root.addArrangedSubview(modes)

        root.addArrangedSubview(sectionTitle("Если что-то не так"))
        let fixRow = NSStackView()
        fixRow.spacing = 10
        let fix = makeButton("Починить", #selector(fix))
        fix.keyEquivalent = "\r"
        fixRow.addArrangedSubview(fix)
        fixRow.addArrangedSubview(makeButton("Проверить подробно", #selector(checkFull)))
        fixRow.addArrangedSubview(makeButton("Запасной агент", #selector(rescue), tracked: false))
        fixRow.addArrangedSubview(makeButton("Что делать, если…", #selector(help), tracked: false))
        root.addArrangedSubview(fixRow)

        output = NSTextField(wrappingLabelWithString: "")
        output.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        output.preferredMaxLayoutWidth = 540
        output.isSelectable = true
        root.addArrangedSubview(output)

        let spacer = NSView()
        spacer.heightAnchor.constraint(equalToConstant: 4).isActive = true
        root.addArrangedSubview(spacer)
        powerButton = makeButton("Аварийно выключить мост", #selector(togglePower))
        powerButton.contentTintColor = .systemRed
        root.addArrangedSubview(powerButton)
        let note = NSTextField(wrappingLabelWithString:
            "Выключенный мост = агенты выходят с IP мака. Это риск для общей с Митей подписки — только на время.")
        note.font = .systemFont(ofSize: 11)
        note.textColor = .tertiaryLabelColor
        note.preferredMaxLayoutWidth = 540
        root.addArrangedSubview(note)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func sectionTitle(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text.uppercased())
        label.font = .systemFont(ofSize: 11, weight: .semibold)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func makeButton(_ title: String, _ action: Selector, tracked: Bool = true) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .large
        if tracked { actionButtons.append(button) }
        return button
    }

    // MARK: bridge.py

    private func runBridge(_ args: [String], completion: @escaping (Int32, String) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [bridgeScript] + args
            var env = ProcessInfo.processInfo.environment
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            process.environment = env
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            var text = ""
            var code: Int32 = 1
            do {
                try process.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                text = String(data: data, encoding: .utf8) ?? ""
                code = process.terminationStatus
            } catch {
                text = "Не нашёл bridge.py (\(bridgeScript)). Запусти on.sh из папки моста."
            }
            DispatchQueue.main.async { completion(code, text.trimmingCharacters(in: .whitespacesAndNewlines)) }
        }
    }

    private func refresh() {
        guard !busy else { return }
        runBridge(["json", "--quick"]) { [weak self] _, text in
            guard let self = self, !self.busy else { return }
            if let status = BridgeStatus(json: text) { self.show(status) }
            else { self.headline.stringValue = "Пульт не может прочитать статус"; self.detail.stringValue = text }
        }
    }

    private func show(_ status: BridgeStatus) {
        last = status
        let colors: [String: NSColor] = ["green": .systemGreen, "yellow": .systemOrange, "red": .systemRed]
        dot.layer?.backgroundColor = (colors[status.level] ?? .systemRed).cgColor
        headline.stringValue = status.text
        var lines: [String] = []
        let modeTitle = ["auto": "авто — сам выбирает путь, сначала Митя", "mitya": "закреплён сервер Мити",
                         "vps": "закреплён мой VPS"][status.mode] ?? status.mode
        lines.append("Режим: \(modeTitle).")
        if let title = status.routeTitle, let since = status.routeSince {
            let f = DateFormatter()
            f.dateFormat = "dd.MM HH:mm"
            lines.append("Сейчас: \(title), с \(f.string(from: Date(timeIntervalSince1970: since))).")
        }
        if status.blocked > 0 { lines.append("Агентов заблокировано за час: \(status.blocked).") }
        detail.stringValue = lines.joined(separator: "  ")
        for (key, button) in modeButtons { button.state = (key == status.mode && status.installed) ? .on : .off }
        powerButton.title = status.installed ? "Аварийно выключить мост" : "Вернуть мост"
        powerButton.contentTintColor = status.installed ? .systemRed : .systemGreen
        for (_, button) in modeButtons { button.isEnabled = status.installed && !busy }
    }

    private func perform(_ args: [String], waiting: String) {
        guard !busy else { return }
        busy = true
        actionButtons.forEach { $0.isEnabled = false }
        output.stringValue = waiting
        runBridge(args) { [weak self] _, text in
            guard let self = self else { return }
            self.busy = false
            self.actionButtons.forEach { $0.isEnabled = true }
            self.output.stringValue = text
            self.refresh()
        }
    }

    // MARK: кнопки

    @objc private func chooseMode(_ sender: NSButton) {
        guard let key = sender.identifier?.rawValue else { return }
        sender.state = key == last.mode ? .on : .off
        let args = key == "auto" ? ["auto"] : ["use", key]
        perform(args, waiting: "Переключаю… (до минуты; ответы агентов на секунды прервутся)")
    }

    @objc private func fix() {
        perform(["fix"], waiting: "Чиню мост… (до двух минут)")
    }

    @objc private func checkFull() {
        perform(["status"], waiting: "Проверяю оба сервера и claude.neo3.ru…")
    }

    @objc private func togglePower() {
        if last.installed {
            let alert = NSAlert()
            alert.messageText = "Выключить мост?"
            alert.informativeText = "Агенты пойдут в интернет с IP мака, а не с общего 45.86.61.144. "
                + "Для общей с Митей подписки это риск. Делай так, только если оба сервера лежат и Claude нужен срочно. "
                + "Без риска можно позвать «Запасного агента»."
            alert.alertStyle = .critical
            alert.addButton(withTitle: "Отмена")
            alert.addButton(withTitle: "Выключить")
            guard alert.runModal() == .alertSecondButtonReturn else { return }
            perform(["off"], waiting: "Выключаю мост…")
        } else {
            perform(["on"], waiting: "Включаю мост… (до двух минут)")
        }
    }

    @objc private func rescue() {
        guard FileManager.default.fileExists(atPath: rescueCommand) else {
            output.stringValue = "Запасной агент ещё не установлен (\(rescueCommand))."
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: rescueCommand))
    }

    @objc private func help() {
        let text = (try? String(contentsOfFile: supportDir + "/HELP.txt", encoding: .utf8))
            ?? "Справка не найдена: \(supportDir)/HELP.txt"
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 560),
                             styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.title = "Мост — что делать, если…"
        panel.isReleasedWhenClosed = false
        let scroll = NSTextView.scrollableTextView()
        let view = scroll.documentView as! NSTextView
        view.isEditable = false
        view.font = .systemFont(ofSize: 14)
        view.textContainerInset = NSSize(width: 16, height: 16)
        view.string = text
        panel.contentView = scroll
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        helpWindows.append(panel)
    }
    private var helpWindows: [NSWindow] = []
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
