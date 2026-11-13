// Runs the bundled server (Contents/Resources/server/earsmixer-<arch>) as a
// child process, logs its output and restarts it after an unexpected exit.

import Foundation

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

/// The server's address on this Mac, matching the configured web port.
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

@MainActor
final class Server {
    enum State: Equatable { case stopped, starting, running, failed(String) }

    private(set) var state: State = .stopped { didSet { onChange?() } }
    var onChange: (() -> Void)?
    private var process: Process?
    private var log: FileHandle?
    private var stopping = false
    private var recentCrashes: [Date] = []

    var isRunning: Bool { state == .running || state == .starting }

    func start() {
        guard process == nil else { return }
        do {
            try FileManager.default.createDirectory(at: Paths.logs, withIntermediateDirectories: true)
            rotateLogIfLarge()
            if !FileManager.default.fileExists(atPath: Paths.log.path) {
                FileManager.default.createFile(atPath: Paths.log.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: Paths.log)
            handle.seekToEndOfFile()
            handle.write("\n--- Started \(Date()) (EarsMixer \(ProductInfo.version)) ---\n".data(using: .utf8)!)

            let child = Process()
            child.executableURL = Paths.serverBinary
            var environment = ProcessInfo.processInfo.environment
            environment["OSC_WEBMIXER_HOME"] = Paths.home.path
            environment["OSC_WEBMIXER_SERVICE"] = "1"
            child.environment = environment
            child.currentDirectoryURL = Paths.home
            child.standardOutput = handle
            child.standardError = handle
            child.terminationHandler = { [weak self] finished in
                let status = finished.terminationStatus
                Task { @MainActor [weak self] in self?.exited(status) }
            }
            stopping = false
            state = .starting
            try child.run()
            process = child
            log = handle
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self, self.process === child, self.state == .starting else { return }
                self.state = .running
            }
        } catch {
            process = nil
            state = .failed("Could not start the server: \(error.localizedDescription)")
        }
    }

    /// Stops the server and returns once it has exited.
    func stop() async {
        guard let child = process else { return }
        stopping = true
        child.terminate() // SIGTERM lets the server withdraw its Bonjour advertisement.
        let deadline = Date().addingTimeInterval(5)
        while child.isRunning && Date() < deadline { try? await Task.sleep(nanoseconds: 50_000_000) }
        if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        // Wait for the termination handler to clear the process.
        let cleared = Date().addingTimeInterval(3)
        while process != nil && Date() < cleared { try? await Task.sleep(nanoseconds: 20_000_000) }
    }

    func restart() async {
        await stop()
        start()
    }

    private func exited(_ status: Int32) {
        try? log?.close()
        log = nil
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
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self, self.process == nil, !self.stopping else { return }
            self.start()
        }
    }

    private func rotateLogIfLarge() {
        let files = FileManager.default
        guard let size = (try? files.attributesOfItem(atPath: Paths.log.path))?[.size] as? Int,
              size > 10 * 1024 * 1024 else { return }
        let old = Paths.logs.appendingPathComponent("server.old.log")
        try? files.removeItem(at: old)
        try? files.moveItem(at: Paths.log, to: old)
    }
}
