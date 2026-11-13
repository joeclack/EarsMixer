// EarsMixer menu bar app for macOS.
// Runs the bundled server (Contents/Resources/server/earsmixer-<arch>) as a child
// process and mirrors the Windows tray: QR window, open mixer/admin, start/stop,
// logs, settings folder, launch at login and an update notice.

import AppKit
import ServiceManagement

enum Paths {
    static let home: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("EarsMixer", isDirectory: true)
    }()
    static let logs = home.appendingPathComponent("logs", isDirectory: true)
    static let log = logs.appendingPathComponent("server.log")

    static var serverBinary: URL {
        #if arch(arm64)
        let name = "earsmixer-arm64"
        #else
        let name = "earsmixer-x64"
        #endif
        return Bundle.main.resourceURL!.appendingPathComponent("server").appendingPathComponent(name)
    }
}

enum ProductInfo {
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
}

// MARK: - Server process

final class Server {
    enum State { case stopped, starting, running, failed(String) }

    private(set) var state: State = .stopped { didSet { onChange?() } }
    var onChange: (() -> Void)?
    private var process: Process?
    private var stopping = false
    private var recentCrashes: [Date] = []

    var isRunning: Bool {
        if case .running = state { return true }
        if case .starting = state { return true }
        return false
    }

    func start() {
        guard process == nil else { return }
        do {
            try FileManager.default.createDirectory(at: Paths.logs, withIntermediateDirectories: true)
            rotateLogIfLarge()
            if !FileManager.default.fileExists(atPath: Paths.log.path) {
                FileManager.default.createFile(atPath: Paths.log.path, contents: nil)
            }
            let log = try FileHandle(forWritingTo: Paths.log)
            log.seekToEndOfFile()
            log.write("\n--- Started \(Date()) (EarsMixer \(ProductInfo.version)) ---\n".data(using: .utf8)!)

            let child = Process()
            child.executableURL = Paths.serverBinary
            var env = ProcessInfo.processInfo.environment
            env["OSC_WEBMIXER_HOME"] = Paths.home.path
            env["OSC_WEBMIXER_SERVICE"] = "1"
            child.environment = env
            child.currentDirectoryURL = Paths.home
            child.standardOutput = log
            child.standardError = log
            child.terminationHandler = { [weak self] finished in
                DispatchQueue.main.async { self?.exited(finished.terminationStatus, log: log) }
            }
            stopping = false
            state = .starting
            try child.run()
            process = child
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, self.process === child, case .starting = self.state else { return }
                self.state = .running
            }
        } catch {
            process = nil
            state = .failed("Could not start the server: \(error.localizedDescription)")
        }
    }

    func stop(then done: (() -> Void)? = nil) {
        guard let child = process else { done?(); return }
        stopping = true
        child.terminate() // SIGTERM lets the server withdraw its Bonjour advertisement.
        DispatchQueue.global().async {
            let deadline = Date().addingTimeInterval(5)
            while child.isRunning && Date() < deadline { usleep(50_000) }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
            DispatchQueue.main.async { done?() }
        }
    }

    func restart() { stop { [weak self] in self?.start() } }

    private func exited(_ status: Int32, log: FileHandle) {
        try? log.close()
        process = nil
        if stopping { state = .stopped; return }
        // Restart after an unexpected exit, but give up if it keeps failing.
        let now = Date()
        recentCrashes = recentCrashes.filter { now.timeIntervalSince($0) < 120 } + [now]
        if recentCrashes.count > 3 {
            state = .failed("The server keeps stopping (exit \(status)). Check the logs.")
            return
        }
        state = .failed("The server stopped (exit \(status)). Restarting...")
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.process == nil, !self.stopping else { return }
            self.start()
        }
    }

    private func rotateLogIfLarge() {
        let fm = FileManager.default
        guard let size = (try? fm.attributesOfItem(atPath: Paths.log.path))?[.size] as? Int,
              size > 10 * 1024 * 1024 else { return }
        let old = Paths.logs.appendingPathComponent("server.old.log")
        try? fm.removeItem(at: old)
        try? fm.moveItem(at: Paths.log, to: old)
    }
}

// MARK: - Local URL (matches the configured web port)

func localURL() -> URL {
    var port = 80
    let config = Paths.home.appendingPathComponent("config/global.json")
    if let data = try? Data(contentsOf: config),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let server = json["server"] as? [String: Any],
       let saved = server["port"] as? Int, (1...65535).contains(saved) {
        port = saved
    }
    return URL(string: "http://127.0.0.1" + (port == 80 ? "" : ":\(port)"))!
}

func openPage(_ path: String) {
    NSWorkspace.shared.open(localURL().appendingPathComponent(path))
}

// MARK: - Updates (notify only)

struct UpdateRelease { let version: String; let downloadURL: URL; let releaseURL: URL }

enum ReleaseChecker {
    static let repository = "https://github.com/joeclack/EarsMixer"
    static let latestAPI = URL(string: "https://api.github.com/repos/joeclack/EarsMixer/releases/latest")!

    static func check(installed: String) async throws -> UpdateRelease? {
        var request = URLRequest(url: latestAPI, timeoutInterval: 15)
        request.setValue("EarsMixer/\(installed) (macOS)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tag_name"] as? String else { return nil }
        if json["draft"] as? Bool == true || json["prerelease"] as? Bool == true { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        guard isNewer(version, than: installed) else { return nil }
        // Only offer releases that include a macOS download.
        let filename = "EarsMixer-\(version)-macos.dmg"
        let assets = json["assets"] as? [[String: Any]] ?? []
        guard let asset = assets.first(where: { $0["name"] as? String == filename && $0["state"] as? String == "uploaded" }),
              let link = asset["browser_download_url"] as? String, let download = URL(string: link),
              download.host == "github.com" else { return nil }
        return UpdateRelease(version: version, downloadURL: download,
                             releaseURL: URL(string: "\(repository)/releases/tag/\(tag)")!)
    }

    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").compactMap { Int($0) }
        let pb = b.split(separator: ".").compactMap { Int($0) }
        guard pa.count == 3, pb.count == 3 else { return false }
        return pb.lexicographicallyPrecedes(pa)
    }
}

// MARK: - Connection (QR) window

final class ConnectionWindow: NSWindowController {
    private let state = NSTextField(labelWithString: "")
    private let qr = NSImageView()
    private let hint = NSTextField(wrappingLabelWithString: "Scan with a phone or tablet on the same network.")
    private let link = NSTextField(labelWithString: "")
    private let copyButton = NSButton(title: "Copy Link", target: nil, action: nil)
    private var timer: Timer?
    private var currentURL: String?
    var isServerRunning: () -> Bool = { false }

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 500),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Connect to EarsMixer"
        window.isReleasedWhenClosed = false
        super.init(window: window)

        let title = NSTextField(labelWithString: "Connect to EarsMixer")
        title.font = .systemFont(ofSize: 20, weight: .bold)
        state.textColor = .secondaryLabelColor
        qr.imageScaling = .scaleProportionallyUpOrDown
        qr.wantsLayer = true
        qr.layer?.backgroundColor = NSColor.white.cgColor
        qr.layer?.cornerRadius = 8
        hint.alignment = .center
        hint.textColor = .secondaryLabelColor
        link.isSelectable = true
        link.alignment = .center
        link.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        copyButton.target = self
        copyButton.action = #selector(copyLink)
        copyButton.isEnabled = false
        let admin = NSButton(title: "Admin Dashboard", target: self, action: #selector(openAdmin))
        let buttons = NSStackView(views: [copyButton, admin])

        let stack = NSStackView(views: [title, state, qr, hint, link, buttons])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = NSView()
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
            qr.widthAnchor.constraint(equalToConstant: 280),
            qr.heightAnchor.constraint(equalToConstant: 280),
            hint.widthAnchor.constraint(equalToConstant: 320),
        ])
        window.center()
    }

    required init?(coder: NSCoder) { fatalError() }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self, self.window?.isVisible == true else { self?.timer?.invalidate(); return }
            self.refresh()
        }
    }

    func setState(_ text: String) { state.stringValue = text }

    private func clear(_ message: String) {
        qr.image = nil; link.stringValue = ""; currentURL = nil
        copyButton.isEnabled = false; hint.stringValue = message
    }

    func refresh() {
        guard window?.isVisible == true else { return }
        guard isServerRunning() else { clear("Start the server from the menu bar to connect."); return }
        var request = URLRequest(url: localURL().appendingPathComponent("api/connection"), timeoutInterval: 4)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let urlText = json["url"] as? String, let url = URL(string: urlText),
                      ["http", "https"].contains(url.scheme ?? ""),
                      let qrText = json["qr"] as? String, let comma = qrText.firstIndex(of: ","),
                      let png = Data(base64Encoded: String(qrText[qrText.index(after: comma)...])),
                      let image = NSImage(data: png) else {
                    self.clear("Waiting for the web server. Check the logs if this continues.")
                    return
                }
                self.qr.image = image
                self.currentURL = url.absoluteString
                self.link.stringValue = url.absoluteString
                self.copyButton.isEnabled = true
                let host = url.host ?? ""
                self.hint.stringValue = (host == "127.0.0.1" || host == "localhost")
                    ? "No network address yet. Connect this Mac to the mixer network."
                    : "Scan with a phone or tablet on the same network."
            }
        }.resume()
    }

    @objc private func copyLink() {
        guard let currentURL else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(currentURL, forType: .string)
    }

    @objc private func openAdmin() { openPage("admin") }
}

// MARK: - Menu bar

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let server = Server()
    private var statusItem: NSStatusItem!
    private let status = NSMenuItem(title: "Starting...", action: nil, keyEquivalent: "")
    private var startItem: NSMenuItem!, stopItem: NSMenuItem!, restartItem: NSMenuItem!
    private var loginItem: NSMenuItem!, checkItem: NSMenuItem!, downloadItem: NSMenuItem!, notesItem: NSMenuItem!
    private let connection = ConnectionWindow()
    private var update: UpdateRelease?
    private var checking = false
    private var updateTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let image = NSImage(systemSymbolName: "slider.vertical.3", accessibilityDescription: "EarsMixer")
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.menu = buildMenu()

        connection.isServerRunning = { [weak self] in self?.server.isRunning ?? false }
        server.onChange = { [weak self] in self?.refresh() }
        server.start()
        refresh()

        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.checkForUpdates(manual: false) }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            self?.checkForUpdates(manual: false)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard server.isRunning else { return .terminateNow }
        server.stop { sender.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        let version = NSMenuItem(title: "EarsMixer \(ProductInfo.version)", action: nil, keyEquivalent: "")
        version.isEnabled = false
        status.isEnabled = false
        menu.addItem(version)
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(item("Show Mixer QR Code", #selector(showConnection)))
        menu.addItem(item("Open Mixer", #selector(openMixer)))
        menu.addItem(item("Open Admin Dashboard", #selector(openAdmin)))
        menu.addItem(.separator())
        startItem = item("Start Server", #selector(startServer))
        stopItem = item("Stop Server", #selector(stopServer))
        restartItem = item("Restart Server", #selector(restartServer))
        [startItem, stopItem, restartItem].forEach { menu.addItem($0) }
        menu.addItem(.separator())
        menu.addItem(item("Open Logs", #selector(openLogs)))
        menu.addItem(item("Open Settings and Plugins", #selector(openSettings)))
        loginItem = item("Open at Login", #selector(toggleLogin))
        menu.addItem(loginItem)
        menu.addItem(.separator())
        checkItem = item("Check for Updates...", #selector(checkUpdatesManually))
        downloadItem = item("Download Update...", #selector(downloadUpdate))
        notesItem = item("View Release Notes", #selector(viewNotes))
        downloadItem.isHidden = true
        notesItem.isHidden = true
        [checkItem, downloadItem, notesItem].forEach { menu.addItem($0) }
        menu.addItem(.separator())
        menu.addItem(item("Quit EarsMixer", #selector(quit), key: "q"))
        return menu
    }

    func menuWillOpen(_ menu: NSMenu) { refresh() }

    private func refresh() {
        let text: String
        switch server.state {
        case .stopped: text = "Server stopped"
        case .starting: text = "Server starting..."
        case .running: text = "Server running"
        case .failed(let message): text = message
        }
        status.title = text
        startItem.isEnabled = !server.isRunning
        stopItem.isEnabled = server.isRunning
        restartItem.isEnabled = server.isRunning
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        connection.setState(text)
        connection.refresh()
    }

    @objc private func showConnection() { connection.present() }
    @objc private func openMixer() { openPage("") }
    @objc private func openAdmin() { openPage("admin") }
    @objc private func startServer() { server.start() }
    @objc private func stopServer() { server.stop() }
    @objc private func restartServer() { server.restart() }

    @objc private func openLogs() {
        try? FileManager.default.createDirectory(at: Paths.logs, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Paths.logs)
    }

    @objc private func openSettings() {
        try? FileManager.default.createDirectory(at: Paths.home, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Paths.home)
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            alert("Could not change Open at Login", error.localizedDescription)
        }
        refresh()
    }

    @objc private func checkUpdatesManually() { checkForUpdates(manual: true) }

    private func checkForUpdates(manual: Bool) {
        guard !checking else { return }
        checking = true
        checkItem.isEnabled = false
        checkItem.title = "Checking for Updates..."
        Task { @MainActor in
            defer {
                checking = false
                checkItem.isEnabled = true
                checkItem.title = "Check for Updates..."
            }
            do {
                update = try await ReleaseChecker.check(installed: ProductInfo.version)
            } catch {
                // An offline mixer network must never interrupt the server or show background errors.
                if manual { alert("Could not check for updates", "Check your internet connection and try again later.") }
                return
            }
            downloadItem.isHidden = update == nil
            notesItem.isHidden = update == nil
            if let update {
                downloadItem.title = "Download EarsMixer \(update.version)..."
                if manual { offerUpdate(update) }
            } else if manual {
                alert("EarsMixer is up to date", "EarsMixer \(ProductInfo.version) is installed. No newer macOS version is available.")
            }
        }
    }

    private func offerUpdate(_ update: UpdateRelease) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "EarsMixer \(update.version) is available"
        alert.informativeText = "You have version \(ProductInfo.version). Download the new version, quit EarsMixer, then replace it in Applications."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(update.downloadURL) }
    }

    @objc private func downloadUpdate() { if let update { NSWorkspace.shared.open(update.downloadURL) } }
    @objc private func viewNotes() { if let update { NSWorkspace.shared.open(update.releaseURL) } }
    @objc private func quit() { NSApp.terminate(nil) }

    private func alert(_ title: String, _ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
