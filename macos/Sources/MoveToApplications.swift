// Offers to move EarsMixer into Applications when it is opened from the disk
// image, a temporary (translocated) location or Downloads. From there it can't
// update itself, and opening it from the disk image keeps the disk in use.
// Runs before the server starts, so nothing needs stopping.

import AppKit

enum MoveToApplications {
    enum Place: Equatable { case diskImage, temporary, downloads }

    /// Where the app is running from, when that's somewhere it shouldn't stay.
    static func place(of bundle: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Place? {
        let path = bundle.standardizedFileURL.path
        if path.contains("/AppTranslocation/") { return .temporary }
        if (try? bundle.resourceValues(forKeys: [.volumeIsReadOnlyKey]))?.volumeIsReadOnly == true { return .diskImage }
        let downloads = home.appendingPathComponent("Downloads").standardizedFileURL.path + "/"
        if path.hasPrefix(downloads) { return .downloads }
        return nil
    }

    /// Copies the app into `folder`, replacing (moving to the Trash) any copy already there.
    static func copy(_ source: URL, into folder: URL, fileManager: FileManager = .default) throws -> URL {
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(source.lastPathComponent)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.trashItem(at: destination, resultingItemURL: nil)
        }
        try fileManager.copyItem(at: source, to: destination)
        return destination
    }

    /// Asks to move the app when needed. Returns true when the app is quitting to
    /// reopen from Applications, in which case the caller must not start anything.
    @MainActor
    static func offerIfNeeded() -> Bool {
        let source = Bundle.main.bundleURL
        guard let place = place(of: source) else { return false }

        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Move EarsMixer to Applications?"
        switch place {
        case .diskImage, .temporary:
            alert.informativeText = "EarsMixer is running from the disk image, so it can't install updates and the disk can't be ejected. Move it to the Applications folder and open it from there."
        case .downloads:
            alert.informativeText = "EarsMixer is in your Downloads folder. Move it to the Applications folder so it stays put and can install updates."
        }
        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: "Not Now")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }

        quitOtherCopies()
        let fileManager = FileManager.default
        var destination: URL
        do {
            destination = try copy(source, into: URL(fileURLWithPath: "/Applications", isDirectory: true))
        } catch {
            // Without permission for /Applications, use the Applications folder in the home folder.
            do {
                destination = try copy(source, into: fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true))
            } catch {
                let failure = NSAlert(error: error)
                failure.messageText = "EarsMixer couldn't be moved to Applications"
                failure.runModal()
                return false
            }
        }
        // Moving out of Downloads removes the original; the disk image is read-only and is ejected instead.
        if place == .downloads { try? fileManager.trashItem(at: source, resultingItemURL: nil) }
        relaunch(destination, ejecting: place == .diskImage ? volume(of: source) : nil)
        return true
    }

    /// Asks any other running EarsMixer to quit, which stops its server cleanly.
    @MainActor
    private static func quitOtherCopies() {
        guard let identifier = Bundle.main.bundleIdentifier else { return }
        let me = NSRunningApplication.current.processIdentifier
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).filter { $0.processIdentifier != me }
        others.forEach { $0.terminate() }
        let deadline = Date().addingTimeInterval(10)
        while others.contains(where: { !$0.isTerminated }) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    private static func volume(of url: URL) -> URL? {
        guard let volume = (try? url.resourceValues(forKeys: [.volumeURLKey]))?.volume,
              volume.path.hasPrefix("/Volumes/") else { return nil }
        return volume
    }

    /// Waits for this process to exit, then opens the moved copy and ejects the disk image.
    @MainActor
    private static func relaunch(_ app: URL, ejecting volume: URL?) {
        let pid = ProcessInfo.processInfo.processIdentifier
        let script = """
            while /bin/kill -0 \(pid) 2>/dev/null; do /bin/sleep 0.2; done
            /usr/bin/open "$1"
            if [ -n "$2" ]; then /bin/sleep 1; /usr/bin/hdiutil detach "$2" -quiet || true; fi
            """
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = ["-c", script, "sh", app.path, volume?.path ?? ""]
        try? helper.run()
        NSApp.terminate(nil)
    }
}
