# EarsMixer

A local server connecting DiGiCo SD Series and Quantum consoles to the [EarsMixer mobile app](https://github.com/joeclack/EarsMixerApp) and a browser mixer. Musicians control their AUX send levels and pan; administrators manage the console connection, channels and shared layouts.

## Components

- DiGiCo iPad-protocol OSC/UDP bridge and musician WebSocket API.
- Browser mixer and admin dashboard.
- Bonjour/mDNS server discovery and connection QR codes.
- Windows service, tray manager and installer.
- macOS menu bar app.

## Repository layout

- `index.js`, `lib/` — server, console integration and APIs.
- `web/` — browser mixer and admin dashboard.
- `config/`, `plugins/` — configuration and optional plugins.
- `installer/` — Windows service/tray support and Inno Setup files.
- `macos/` — macOS menu bar app.
- `tools/` — demo console, development and packaging scripts.
- `test/`, `.github/workflows/` — checks and release automation.

## Windows deployment

1. Download the `EarsMixer-<version>-windows-x64-setup.exe` from [Releases](https://github.com/joeclack/EarsMixer/releases/latest) and install as administrator. The runtime is included.
2. Open the admin dashboard from the EarsMixer tray icon.
3. Configure the console IP/ports and available channels/AUXes. Set an admin password before use on a shared network.
4. Connect musicians through the mobile app or the mixer URL/QR code.

The server, console and musician devices need network access to one another. Configure the console's **DiGiCo iPad** external control, with matching OSC ports: server receive **8000/UDP**, console receive **9000/UDP** by default. S-Series consoles are not supported.

The installed web server defaults to port **80**, with administration at `/admin`. Windows settings and data live in `%PROGRAMDATA%\EarsMixer`. Run a newer installer to update an existing installation.

## macOS deployment

Requires macOS 13 or later, on Apple silicon or Intel.

1. Download `EarsMixer-<version>-macos.dmg` from [Releases](https://github.com/joeclack/EarsMixer/releases/latest), open it and drag EarsMixer to Applications.
2. The app is not notarised. On first launch, open it, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
3. Allow incoming connections and local network access when macOS asks.
4. EarsMixer runs from the menu bar. Click its icon for a panel with the server switch, desk and device status, the mixer QR code and links to the admin dashboard and mixer. **Open at Login**, logs and updates are under the gear button.

The server runs while the app is open; quitting the app stops it. Settings, data and logs live in `~/Library/Application Support/EarsMixer`. To update, quit EarsMixer and replace it in Applications with the newer version.

## Run from source

Use Node.js **22.13+**:

```sh
npm ci
npm run dev
```

The network demo runs at `http://localhost:8082` with 20 mock channels and eight AUXes. It uses isolated settings in `config/demo/` and does not connect to a console.

For a console-connected source deployment, configure the server and run `npm start`. Keep it running under your service/process manager. Clients use the server computer's reachable IP or configured DNS name.

## Packaging and releases

- `npm run build` regenerates the browser assets.
- `npm run installer:windows` builds the Windows installer into `dist/`; requires Inno Setup 6.7+ and the Windows .NET Framework C# compiler.
- `npm run installer:macos` builds the macOS dmg into `dist/`; run it on a Mac with the Xcode command line tools.
- GitHub Actions builds release installers from `main`; feature branches remain unpublished until merged. Product metadata and the release tag version come from [installer/version.inc.iss](installer/version.inc.iss).
- Product version (Windows and macOS): **1.11.0**. Node package version: **2.13.0**, maintained in its separate upstream series.

See [CHANGELOG.md](CHANGELOG.md) for release history. Based on [OSCWebMixer2 by Marc Castles](https://github.com/castles/OSCWebMixer2), maintained by Joe Clack under the [MIT licence](LICENSE).
