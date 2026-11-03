import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
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

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 660, height: 490),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Резервный мост ИИ"
        window.isReleasedWhenClosed = false
        window.center()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 15
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 25)
        ])

        let title = NSTextField(labelWithString: "Один IP для Mac и VPS")
        title.font = .systemFont(ofSize: 23, weight: .semibold)
        stack.addArrangedSubview(title)
        let detail = NSTextField(wrappingLabelWithString:
            "Работает без ИИ. Основной: 45.86.61.144 · Резерв: 45.86.63.89\n\nЕсли основной перестал работать:\n1. В Happ выберите «NL-Hysteria2» двойным щелчком.\n2. Здесь нажмите «Включить резерв».\n3. После успеха откройте новый сеанс ИИ.")
        detail.font = .systemFont(ofSize: 14)
        stack.addArrangedSubview(detail)

        let firstRow = NSStackView()
        firstRow.orientation = .horizontal
        firstRow.spacing = 10
        firstRow.addArrangedSubview(button("Открыть Happ", #selector(openHapp)))
        firstRow.addArrangedSubview(button("Скопировать резерв для Happ", #selector(copyReserve)))
        firstRow.addArrangedSubview(button("Проверить резерв", #selector(probeReserve)))
        stack.addArrangedSubview(firstRow)

        let secondRow = NSStackView()
        secondRow.orientation = .horizontal
        secondRow.spacing = 10
        secondRow.addArrangedSubview(button("Включить резерв", #selector(switchReserve)))
        secondRow.addArrangedSubview(button("Вернуть основной", #selector(switchPrimary)))
        secondRow.addArrangedSubview(button("Статус", #selector(refresh)))
        stack.addArrangedSubview(secondRow)

        status = NSTextField(wrappingLabelWithString: "Готово. Проверка резерва не меняет текущий маршрут.")
        status.font = .systemFont(ofSize: 13)
        status.textColor = .secondaryLabelColor
        status.setAccessibilityIdentifier("proxy-switch-status")
        stack.addArrangedSubview(status)
        status.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let footer = NSTextField(wrappingLabelWithString:
            "При ошибке программа не разрешает новые запуски ИИ с другим IP. Если переход прервался, восстановите интернет и нажмите ту же кнопку повторно.")
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = .secondaryLabelColor
        stack.addArrangedSubview(footer)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func button(_ title: String, _ selector: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: selector)
        b.bezelStyle = .rounded
        controls.append(b)
        return b
    }

    @objc private func openHapp() {
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: "/Applications/Happ.app"),
            configuration: NSWorkspace.OpenConfiguration())
    }
    @objc private func probeReserve() { run(["probe", "reserve"]) }
    @objc private func copyReserve() {
        do {
            let file = home.appendingPathComponent("Antigravity Project/.secrets.d/neo3-agent-profiles/reserve.json")
            let data = try Data(contentsOf: file)
            guard let config = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let auth = config["auth"] as? String,
                  let tls = config["tls"] as? [String: Any],
                  let pin = tls["pinSHA256"] as? String else { throw CocoaError(.fileReadCorruptFile) }
            var url = URLComponents()
            url.scheme = "hysteria2"
            url.user = auth
            url.host = "45.86.63.89"
            url.port = 8443
            url.path = "/"
            // Happ uses a pinned self-signed server certificate for this profile.
            url.queryItems = [URLQueryItem(name: "insecure", value: "1"), URLQueryItem(name: "pinSHA256", value: pin)]
            url.fragment = "NL-Hysteria2"
            guard let link = url.string else { throw CocoaError(.fileReadCorruptFile) }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(link, forType: .string)
            status.stringValue = "Резерв скопирован. В Happ: плюс → конфигурация → вставить → добавить. Ключ из буфера никому не отправляйте."
        } catch { status.stringValue = "Не удалось прочитать сохранённый резервный профиль." }
    }
    @objc private func refresh() { run(["status"]) }
    @objc private func switchReserve() { confirm("reserve", "NL-Hysteria2", "45.86.63.89") }
    @objc private func switchPrimary() { confirm("primary", "Happ Fast QUIC", "45.86.61.144") }

    private func confirm(_ profile: String, _ happ: String, _ ip: String) {
        let alert = NSAlert()
        alert.messageText = "Переключить Mac и VPS на \(ip)?"
        alert.informativeText = "Сначала выберите «\(happ)» в Happ. Завершите текущие ответы ИИ. Программа проверит оба подключения и применит единый IP."
        alert.addButton(withTitle: "Переключить")
        alert.addButton(withTitle: "Отмена")
        if alert.runModal() == .alertFirstButtonReturn { run(["switch", profile]) }
    }

    private func run(_ arguments: [String]) {
        guard !busy else { return }
        busy = true
        controls.forEach { $0.isEnabled = false }
        status.stringValue = "Проверяю Mac и VPS… Обычно это занимает до минуты."
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
                    if json["ok"] as? Bool == true {
                        message = (json["result"] as? [String: Any])?["message"] as? String ?? "Готово."
                    } else {
                        message = json["error"] as? String ?? "Проверка не завершена."
                    }
                }
            } catch { message = "Не удалось запустить локальный переключатель. ИИ для его работы не требуется." }
            let resultMessage = message
            DispatchQueue.main.async {
                self.status.stringValue = resultMessage
                self.controls.forEach { $0.isEnabled = true }
                self.busy = false
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let delegate = AppDelegate()
let application = NSApplication.shared
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
