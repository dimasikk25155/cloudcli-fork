import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var status: NSTextField!
    private var controls: [NSButton] = []
    private var busy = false
    private let home = FileManager.default.homeDirectoryForCurrentUser

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Завершить", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 650, height: 370),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Мост ИИ — Нидерланды / Финляндия"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 25)
        ])
        let title = NSTextField(labelWithString: "Мост ИИ")
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        stack.addArrangedSubview(title)
        let detail = NSTextField(wrappingLabelWithString:
            "Выбери страну — Mac и VPS переключатся вместе.\nРаботает без Happ и без доступа к ИИ.")
        detail.font = .systemFont(ofSize: 15)
        stack.addArrangedSubview(detail)
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 12
        row.addArrangedSubview(button("Нидерланды · основной", #selector(switchPrimary)))
        row.addArrangedSubview(button("Финляндия · резерв", #selector(switchReserve)))
        row.addArrangedSubview(button("Проверить статус", #selector(refresh)))
        stack.addArrangedSubview(row)
        status = NSTextField(wrappingLabelWithString: "Проверяю фактический IP…")
        status.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        status.setAccessibilityIdentifier("proxy-switch-status")
        stack.addArrangedSubview(status)
        status.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        let footer = NSTextField(wrappingLabelWithString:
            "Перед сменой страны дождись окончания текущих ответов ИИ. При сбое соединение не переходит на обычный IP ноутбука. Выбранная страна сохраняется после перезагрузки.")
        footer.font = .systemFont(ofSize: 12)
        footer.textColor = .secondaryLabelColor
        stack.addArrangedSubview(footer)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refresh()
    }

    private func button(_ title: String, _ selector: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: selector)
        b.bezelStyle = .rounded
        controls.append(b)
        return b
    }
    @objc private func refresh() { run(["status"]) }
    @objc private func switchReserve() { run(["switch", "reserve"]) }
    @objc private func switchPrimary() { run(["switch", "primary"]) }

    private func run(_ arguments: [String]) {
        guard !busy else { return }
        busy = true
        controls.forEach { $0.isEnabled = false }
        status.stringValue = arguments.first == "switch"
            ? "Проверяю выбранный мост и переключаю Mac / VPS…\nОкно можно оставить открытым; ИИ не требуется."
            : "Проверяю фактические IP Mac и VPS…"
        let script = home.appendingPathComponent(".local/share/neo3-agent-proxy/switch.py").path
        DispatchQueue.global(qos: .userInitiated).async {
            var message = "Не удалось запустить проверку."
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/python3")
            task.arguments = [script] + arguments
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            task.environment = environment
            let output = Pipe()
            task.standardOutput = output
            task.standardError = FileHandle.nullDevice
            do {
                try task.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                task.waitUntilExit()
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    message = json["ok"] as? Bool == true
                        ? ((json["result"] as? [String: Any])?["message"] as? String ?? "Готово.")
                        : (json["error"] as? String ?? "Проверка не завершена.")
                }
            } catch { message = "Не удалось запустить локальный переключатель." }
            let resultMessage = message
            DispatchQueue.main.async {
                self.status.stringValue = resultMessage
                self.controls.forEach { $0.isEnabled = true }
                self.busy = false
            }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { !busy }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        busy ? .terminateCancel : .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let delegate = AppDelegate()
let application = NSApplication.shared
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
