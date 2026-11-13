// State shown by the menu bar panel: the server process, the desk and device
// status it reports, the connection QR code and any available update.

import AppKit
import ServiceManagement

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    let server = Server()
    @Published private(set) var serverState: Server.State = .stopped
    /// nil until the server has answered.
    @Published private(set) var deskConnected: Bool?
    @Published private(set) var deskAddress = ""
    @Published private(set) var devices = 0
    @Published private(set) var qr: NSImage?
    @Published private(set) var link: String?
    @Published private(set) var linkIsLocalOnly = false
    @Published private(set) var update: UpdateRelease?
    @Published private(set) var checkingUpdates = false
    @Published private(set) var notice: String?
    @Published private(set) var openAtLogin = false

    private var pollTimer: Timer?
    private var updateTimer: Timer?
    private var panelVisible = false
    private var polling = false

    func start() {
        server.onChange = { [weak self] in self?.serverChanged() }
        server.start()
        openAtLogin = SMAppService.mainApp.status == .enabled
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.poll() }
        }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.checkForUpdates(manual: false) }
        }
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            await self?.checkForUpdates(manual: false)
        }
    }

    private func serverChanged() {
        serverState = server.state
        if !server.isRunning { clearStatus() }
    }

    private func clearStatus() {
        deskConnected = nil
        deskAddress = ""
        devices = 0
        qr = nil
        link = nil
    }

    // MARK: Panel

    func setPanelVisible(_ visible: Bool) {
        panelVisible = visible
        if visible {
            notice = nil
            openAtLogin = SMAppService.mainApp.status == .enabled
            Task { @MainActor [weak self] in await self?.poll() }
        }
    }

    private func poll() async {
        guard server.isRunning, !polling else { return }
        polling = true
        defer { polling = false }
        let base = localURL()
        if let json = await fetchJSON(base.appendingPathComponent("api/local/status")) {
            let desk = json["desk"] as? [String: Any]
            deskConnected = desk?["connected"] as? Bool ?? false
            deskAddress = desk?["address"] as? String ?? ""
            devices = json["devices"] as? Int ?? 0
        } else if server.isRunning {
            deskConnected = nil
        }
        // The QR code only changes with the network, so fetch it when it is needed.
        guard panelVisible || qr == nil else { return }
        guard let json = await fetchJSON(base.appendingPathComponent("api/connection")),
              let text = json["url"] as? String, let url = URL(string: text),
              ["http", "https"].contains(url.scheme ?? ""),
              let encoded = json["qr"] as? String, let comma = encoded.firstIndex(of: ","),
              let png = Data(base64Encoded: String(encoded[encoded.index(after: comma)...])),
              let image = NSImage(data: png) else { return }
        guard server.isRunning else { return }
        qr = image
        link = url.absoluteString
        linkIsLocalOnly = url.host == "127.0.0.1" || url.host == "localhost"
    }

    private func fetchJSON(_ url: URL) async -> [String: Any]? {
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    // MARK: Actions

    func setServerRunning(_ run: Bool) {
        if run { server.start() } else { Task { @MainActor [weak self] in await self?.server.stop() } }
    }

    func restartServer() { Task { @MainActor [weak self] in await self?.server.restart() } }

    func openPage(_ path: String) {
        NSWorkspace.shared.open(path.isEmpty ? localURL() : localURL().appendingPathComponent(path))
    }

    func openFolder(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    func copyLink() {
        guard let link else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        notice = "Link copied."
    }

    func setOpenAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            notice = "Could not change Open at Login: \(error.localizedDescription)"
        }
        openAtLogin = SMAppService.mainApp.status == .enabled
    }

    func checkForUpdates(manual: Bool) async {
        guard !checkingUpdates else { return }
        checkingUpdates = true
        defer { checkingUpdates = false }
        do {
            update = try await ReleaseChecker.check(installed: ProductInfo.version)
            if manual && update == nil { notice = "EarsMixer \(ProductInfo.version) is the latest version." }
        } catch {
            // An offline mixer network must never interrupt the server or show background errors.
            if manual { notice = "Could not check for updates. Check your internet connection." }
        }
    }

    func openUpdate(notes: Bool) {
        guard let update else { return }
        NSWorkspace.shared.open(notes ? update.releaseURL : update.downloadURL)
    }
}
