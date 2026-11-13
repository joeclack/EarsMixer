// EarsMixer menu bar app for macOS. Runs the bundled server and shows a panel
// from the menu bar icon with its status, the mixer QR code and controls.

import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        AppModel.shared.start()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let server = AppModel.shared.server
        guard server.isRunning else { return .terminateNow }
        // Let the server shut down cleanly before the app exits.
        Task { @MainActor in
            await server.stop()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

@main
struct EarsMixerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @ObservedObject private var model = AppModel.shared

    var body: some Scene {
        MenuBarExtra("EarsMixer", systemImage: "slider.vertical.3") {
            PanelView().environmentObject(model)
        }
        .menuBarExtraStyle(.window)
    }
}
