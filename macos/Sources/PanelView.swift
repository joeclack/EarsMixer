// The panel that opens from the menu bar icon. Standard controls only, so it
// follows the system appearance.

import SwiftUI

struct PanelView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            serverRow
            if model.server.isRunning {
                statusRows
                connection
                HStack {
                    Button("Open Admin") { model.openPage("admin") }
                    Button("Open Mixer") { model.openPage("") }
                }
                .frame(maxWidth: .infinity)
            }
            if let update = model.update { updateBanner(update) }
            if let notice = model.notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(width: 300)
        .onAppear { model.setPanelVisible(true) }
        .onDisappear { model.setPanelVisible(false) }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text("EarsMixer").font(.headline)
                Text("Version \(ProductInfo.version)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                Button("Restart Server") { model.restartServer() }
                    .disabled(!model.server.isRunning)
                Divider()
                Button("Open Logs") { model.openFolder(Paths.logs) }
                Button("Open Settings Folder") { model.openFolder(Paths.home) }
                Toggle("Open at Login", isOn: Binding(
                    get: { model.openAtLogin },
                    set: { model.setOpenAtLogin($0) }))
                Divider()
                Button(model.checkingUpdates ? "Checking for Updates..." : "Check for Updates...") {
                    Task { await model.checkForUpdates(manual: true) }
                }
                .disabled(model.checkingUpdates)
                Divider()
                Button("Quit EarsMixer") { NSApp.terminate(nil) }
            } label: {
                Image(systemName: "gearshape")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Options")
        }
    }

    private var serverRow: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Server")
                HStack(spacing: 5) {
                    Circle().fill(serverColour).frame(width: 8, height: 8)
                    Text(serverText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer()
            Toggle("Server", isOn: Binding(
                get: { model.server.isRunning },
                set: { model.setServerRunning($0) }))
                .toggleStyle(.switch)
                .labelsHidden()
        }
    }

    private var serverText: String {
        switch model.serverState {
        case .stopped: return "Stopped"
        case .starting: return "Starting..."
        case .running: return "Running"
        case .failed(let message): return message
        }
    }

    private var serverColour: Color {
        switch model.serverState {
        case .running: return .green
        case .starting: return .yellow
        case .stopped: return .secondary
        case .failed: return .red
        }
    }

    private var statusRows: some View {
        VStack(spacing: 6) {
            row("Desk", deskText)
            row("Devices", model.deskConnected == nil ? "—" : String(model.devices))
        }
    }

    private var deskText: String {
        guard let connected = model.deskConnected else { return "—" }
        let address = model.deskAddress.isEmpty ? "" : " (\(model.deskAddress))"
        return (connected ? "Connected" : "Not answering") + address
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary)
        }
    }

    private var connection: some View {
        VStack(spacing: 8) {
            if let qr = model.qr {
                Image(nsImage: qr)
                    .resizable()
                    .interpolation(.none)
                    .frame(width: 180, height: 180)
                    .padding(6)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("Mixer QR code")
            } else {
                ProgressView()
                    .frame(width: 192, height: 192)
            }
            if let link = model.link {
                HStack(spacing: 6) {
                    Text(link)
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button {
                        model.copyLink()
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                    .help("Copy link")
                    .accessibilityLabel("Copy link")
                }
                Text(model.linkIsLocalOnly
                     ? "No network address yet. Connect this Mac to the mixer network."
                     : "Scan with a phone or tablet on the same network.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func updateBanner(_ update: UpdateRelease) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                Text("EarsMixer \(update.version) is available")
                    .font(.callout.weight(.semibold))
                HStack {
                    Button("Download") { model.openUpdate(notes: false) }
                    Button("Release Notes") { model.openUpdate(notes: true) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
