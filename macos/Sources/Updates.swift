// One-click updates with Sparkle (https://sparkle-project.org).
//
// Sparkle reads the appcast published with each GitHub release (SUFeedURL in
// Info.plist), checks the download against the EdDSA public key built into the
// app (SUPublicEDKey), and installs it only when someone clicks Install: an
// update restarts the server, which drops every phone's mix. Sparkle quits the
// app to install, which stops the server cleanly, then relaunches it.

import AppKit
import Sparkle

@MainActor
final class Updates: NSObject, SPUUpdaterDelegate, SPUStandardUserDriverDelegate {
    /// Called with the version of an update waiting to be installed, or nil when there is none.
    var onAvailable: ((String?) -> Void)?
    private var controller: SPUStandardUpdaterController?

    func start() {
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: self)
    }

    /// Opens Sparkle's window: checks now, or brings a waiting update forward to install.
    func checkNow() {
        NSApp.activate(ignoringOtherApps: true)
        controller?.checkForUpdates(nil)
    }

    // MARK: SPUUpdaterDelegate

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        onAvailable?(item.displayVersionString)
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        onAvailable?(nil)
    }

    // MARK: SPUStandardUserDriverDelegate (gentle reminders)

    // A menu bar app has no window for a background check to appear over, so a
    // scheduled update is announced in the panel instead of interrupting the user.
    nonisolated var supportsGentleScheduledUpdateReminders: Bool { true }

    nonisolated func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
        immediateFocus
    }

    nonisolated func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        let version = update.displayVersionString
        MainActor.assumeIsolated { onAvailable?(version) }
    }
}
