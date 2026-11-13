// EarsMixer menu bar app for macOS. Runs the bundled server and shows a panel
// from the menu bar icon with its status, the mixer QR code and controls.

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = AppModel.shared
        model.start()

        // A popover resizes with its content. The SwiftUI menu bar window does
        // not shrink, which left an empty area when the server was off.
        let host = NSHostingController(rootView: PanelView().environmentObject(model))
        host.sizingOptions = [.preferredContentSize]
        popover.contentViewController = host
        popover.behavior = .transient
        popover.delegate = self

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let image = NSImage(systemSymbolName: "slider.vertical.3", accessibilityDescription: "EarsMixer")
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
    }

    @objc private func togglePanel() {
        guard let button = statusItem.button else { return }
        if popover.isShown { popover.performClose(nil); return }
        AppModel.shared.setPanelVisible(true)
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    func popoverDidClose(_ notification: Notification) {
        AppModel.shared.setPanelVisible(false)
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
enum EarsMixerApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
