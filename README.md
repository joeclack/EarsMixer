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
- Product version (Windows and macOS): **1.14.3**. Node package version: **2.16.3**, maintained in its separate upstream series.

### Signing the macOS app

Release builds of the macOS app are signed with a Developer ID certificate, run with the hardened runtime and are notarised by Apple, so the dmg opens without Gatekeeper warnings. GitHub Actions does this on `main` and manual runs when these repository secrets are set. Without them, and on pull requests, the app is signed ad hoc and macOS warns when it's opened.

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | The Developer ID Application certificate and private key, exported from Keychain Access as a `.p12`, base64 encoded (`base64 -i certificate.p12 \| pbcopy`) |
| `MACOS_CERTIFICATE_PASSWORD` | The password set when exporting the `.p12` |
| `APPLE_API_KEY_P8` | The contents of an App Store Connect API key (`AuthKey_….p8`) with the Developer role, used by `notarytool` |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER_ID` | The issuer ID shown above the keys in App Store Connect |

To create them:

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list), add a **Developer ID Application** certificate (Account Holder only). Use Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority for the CSR, then double-click the downloaded certificate to install it.
2. In Keychain Access → login → My Certificates, export **Developer ID Application: …** with its private key as a `.p12` with a strong password.
3. In App Store Connect → Users and Access → Integrations → App Store Connect API, generate a team key with the **Developer** role and download the `.p8`.
4. Add the five secrets under the repository's Settings → Secrets and variables → Actions, then delete the exported `.p12` and the `.p8` from your Mac or store them in a password manager.

To sign locally, install the certificate in your login keychain and run `npm run installer:macos` with `MACOS_SIGN_IDENTITY` set to the certificate's name (`security find-identity -v -p codesigning`). Add `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER_ID` to notarise too. `MACOS_SIGN_IDENTITY=-` signs ad hoc with the hardened runtime to test the [server entitlements](macos/server.entitlements). Building the Intel server binary on Apple silicon needs Rosetta.

See [CHANGELOG.md](CHANGELOG.md) for release history. Based on [OSCWebMixer2 by Marc Castles](https://github.com/castles/OSCWebMixer2), maintained by Joe Clack under the [MIT licence](LICENSE).

## Development checks

Run `npm test` from this repository. For browser or admin changes, run `npm run build` and exercise the affected flow against the mock desk with `npm run dev`.

See [contributor guidance](AGENTS.md), the [design system](DESIGN_SYSTEM.md), the [release plan](PLAN.md) and the [security policy](SECURITY.md). The [public website](https://github.com/joeclack/EarsMixer-Site) lives in a separate repository.
