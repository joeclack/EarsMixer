# EarsMixer

This version combines the custom EarsMixer interface and admin dashboard with the native OSC backend from [OSCWebMixer2](https://github.com/castles/OSCWebMixer2). It supports DiGiCo SD Series and Quantum consoles through their built-in DiGiCo iPad connection.

The mixer opens at `/` and the admin dashboard at `/admin`. Desk configuration is built into the dashboard under **Desk settings**.

## Mixer and admin features

- List and grid channel views, compact controls and fullscreen mode.
- Drag ordering and favourites saved per AUX on each browser/device.
- Device usernames and a profile dialog for loading a starting template or starting fresh.
- Admin Overview, read-only Live mix, connected/disconnected clients and activity history.
- Admin template editing with channel ordering, per-AUX favourites, starting AUX and view.
- An optional admin password managed through **Admin → Config**.
- Current snapshot display, progressive loading of the selected AUX and disabled controls while values are unavailable.

Personal templates contain layout preferences, not fader levels. Loading a template or starting fresh does not recall a mix on the desk. Each device can adjust its layout after loading a template.

Native **Desk settings** retains upstream server/desk connection setup, channel and AUX selection, shared desk presets, icons and additional OSC devices. Shared desk presets configure the available channels and AUXes; they are separate from personal starting templates. Open **Admin → Desk settings** to configure everything within the dashboard.

The v2 backend uses the same built-in iPad connection as the DiGiCo apps, allowing web clients and DiGiCo iPad apps to operate alongside one another. It caches desk responses, loads metadata before send values, paces missing-value queries and routes send updates to clients viewing the affected AUX. Custom plugins can be added in `plugins/`, and routing to devices such as TouchOSC or Reaper remains available.

## Requirements

- Node.js 22 or newer, and Git for installing the modified OSC dependency.
- Windows, macOS or Linux.
- A DiGiCo SD Series or Quantum console for a real connection. The offline demo works without a console.
- The server computer, console and mixer devices on the same network for real use.

## Start without a console

Install dependencies once and start the offline demo:

```bash
npm ci
npm run dev
```

Open [the mixer](http://127.0.0.1:8082/) or [the admin dashboard](http://127.0.0.1:8082/admin). The demo runs the real v2 server and its mock desk together, with 20 channels and eight AUXes. Its snapshot stays fixed by default. Press Ctrl+C to stop both processes.

Normal settings are saved in `config/`, and templates/admin password data in `data/`. The demo uses its own `config/demo/` and `config/demo/data/`. On each start, it resets its connection settings to the mock and preserves its channel/AUX settings, shared presets, templates and admin password.

The local demo binds HTTP and UDP to loopback and does not contact a physical console. Its default ports are TCP 8082 and UDP 8012/9012. Optional environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `OSC_WEBMIXER_DEV_WEB_PORT` | Demo web port | `8082` |
| `OSC_WEBMIXER_DEV_OSC_PORT` | Server OSC listener | `8012` |
| `OSC_WEBMIXER_DEV_DESK_PORT` | Mock desk OSC listener | `9012` |
| `OSC_WEBMIXER_DEV_CONFIG_DIR` | Isolated demo settings directory | `config/demo` |
| `OSC_WEBMIXER_DEV_BIND_ADDRESS` | Demo HTTP bind address | `127.0.0.1` |
| `OSC_WEBMIXER_DEV_VERBOSE` | Set to `1` to print every mock OSC message | Off |
| `OSC_WEBMIXER_DEV_LIVE_SNAPSHOTS` | Set to `1` to simulate a snapshot change every 15 seconds | Off |

On snapshot changes, the mixer keeps the last known fader positions visible while querying fresh values. Controls are temporarily disabled until their replies arrive. Initial loading and switching AUXes still clear unavailable values.

The mock can validate discovery, browser controls, multi-client updates, queries, writes and snapshot handling. Console numbering, firmware behaviour, fader/pan response and simultaneous DiGiCo iPad operation still need checking with the actual desk before live use.

## Connect a real console

1. Run `npm ci`, then `npm start`.
2. Open `http://<server-ip>/admin` and choose **Desk settings**. The server prints its URL on startup.
3. On the console, open **Setup → External Control → DiGiCo iPad** and configure the connection to the server computer. Use the computer's network IP address, the server's OSC receive port and the desk's receive port. The default server listener is UDP 8000; the default desk listener is UDP 9000.
4. In **Desk settings → Connection**, enter the console IP and its receive port. Set the server OSC receive port to match the console's outgoing destination port, then save.
5. Select the channels and AUXes that mixer clients should see. Save any shared desk presets you need.
6. Return to `/admin` for the mixer URL/QR code, then open that URL on phones or tablets and select an AUX.

<img width="538" height="529" alt="DiGiCo iPad external control setup" src="https://github.com/user-attachments/assets/c8c01ec9-e153-4555-a19f-ef87dcff3ee5" />

The custom mixer uses v2's native OSC addresses and dB conversion. The dashboard combines desk configuration, client oversight, personal templates and password management.

## Admin password

Open **Admin → Config**, set a password of at least eight characters and confirm it. The same sign-in protects the custom dashboard, native desk settings, shared preset operations and admin API routes. Mixer clients continue to open the mixer without the admin password.

You can change or remove the password from the same page by entering the current password. Password records persist in `data/admin-password.json`; browser sign-in sessions expire after 12 hours and are cleared when the server restarts. Demo password data is isolated under `config/demo/data/`.

## Windows installer

On Windows, install dependencies with `npm ci`, install [Inno Setup 6](https://jrsoftware.org/isinfo.php), then run:

```powershell
npm run installer:windows
```

The build minifies the web assets, packages a Windows x64 executable with Node.js 22 included, compiles a native Windows tray app and compiles `installer/EarsMixer.iss`. Product name, installer version, publisher, URL and output basename are defined in `installer/version.inc.iss`. The default output is `dist/EarsMixer-<version>-windows-x64-setup.exe`. Update the installer version in the include file for releases. If Inno Setup is installed elsewhere, set `ISCC_PATH` to the full path of `ISCC.exe`. The tray compiler uses the Windows .NET Framework compiler; `CSC_PATH` can override its path. The first build downloads the packaging runtime and the official WinSW 2.12.0 service wrapper, whose SHA-256 is checked before packaging. Its MIT license is included in the installation.

After building the executable once, you can also open `installer/EarsMixer.iss` in the Inno Setup editor and choose **Compile**. Both editor and command-line builds read `installer/version.inc.iss`. Use `npm run installer:windows` again after application changes to rebuild the executable before compiling the installer.

GitHub Actions also builds the installer in the **Windows installer** job of `.github/workflows/build.yml`, on pushes and pull requests to `main`. To build manually, open **Actions → build-and-package → Run workflow**. The Windows job installs dependencies, runs the tests and calls `npm run installer:windows` on a Windows runner. Download **EarsMixer-windows-installer** from the completed run's Artifacts section; the ZIP contains the setup executable. Artifacts are retained for 30 days. The installer name and version follow `installer/version.inc.iss`.

After both build jobs succeed, pushes to `main` and manual runs on `main` also publish a GitHub Release. The tag comes from `AppVersion` in `installer/version.inc.iss`, for example `1.0.0` becomes `v1.0.0`. The workflow creates a draft for a new version, attaches the installer, publishes it and marks it as latest. Builds with the same version update the existing release's installer, even when the build commit differs from the tag's original commit; existing Git tags are retained. Bump `AppVersion` when you want a separate versioned release. Pull requests and manual runs on other branches build artifacts only. Share [the latest EarsMixer release](https://github.com/joeclack/EarsMixer/releases/latest) with users.

The installer supports Windows 10 version 1607 or later and Windows 11 on x64-compatible systems. It requires administrator permission, installs into Program Files and registers **EarsMixer** (`EarsMixer`) as an automatic Windows service with delayed startup. The service runs as the limited LocalService account, starts before sign-in and restarts after a process failure. Installed users do not need Node.js or Git, and no command prompt needs to stay open. Upgrades stop the service before replacing files and start it again afterwards; uninstall removes the service while retaining saved data.

The **EarsMixer tray** shortcut opens an icon in the notification area at the right of the taskbar (it may be in Windows' hidden-icons menu). By default the installer also adds it to sign-in startup; that option can be turned off. Double-click the icon for the mixer QR code and a copyable link. Right-click for service status, Start/Stop/Restart, the mixer, admin dashboard, logs and settings. Service changes request administrator permission through UAC. Exiting the tray or closing its QR window leaves the service running. The QR code works even when an admin password is set, and follows the current network address and configured web port.

Settings, presets, templates, the admin password and plugins now live under `%PROGRAMDATA%\EarsMixer` (in `config/`, `data/` and `plugins/`). Rotating server logs are in `logs/`. These files are preserved across upgrades and uninstall. On the first EarsMixer installation, the installer copies settings, plugins and logs from `%PROGRAMDATA%\OSCWebMixer2` first, then the installing user's `%LOCALAPPDATA%\OSCWebMixer2` and `%LOCALAPPDATA%\EarsMixer`. Existing files in the new folder take precedence and the original files are retained. Custom service options are preserved when upgrading from the old installation folder. Stop an old console-based server with Ctrl+C before installing. If the old per-user installation remains in Installed Apps, it can be uninstalled after migration. When elevating with a different administrator account, manually copy the original user's saved folders instead. To migrate a source installation, stop the service, copy its `config/`, `data/` and any `plugins/` to the ProgramData folder as an administrator, then start the service again.

The installed service explicitly sets its settings/data paths in `{installation folder}\EarsMixerService.xml`; shell-specific environment overrides do not change them. Administrators can edit that XML for custom paths or a fixed `OSC_WEBMIXER_PUBLIC_URL`, then restart the service. Custom directories need LocalService read/write access. The XML is preserved across upgrades. Source and demo launches retain their existing environment-variable behaviour.

HTTP defaults to port 80 and incoming OSC to UDP 8000. The installer adds a Windows Firewall rule for the installed `EarsMixer.exe`, allowing incoming connections from the local subnet on Private networks, and removes that rule on uninstall. Set your mixer network to Private in Windows. If you change the HTTP port in Desk settings, the tray's browser links automatically use the saved port. A QR link that shows `127.0.0.1` means the computer has no network address yet; connect it to the mixer network and the tray will refresh.

## Development checks

```bash
npm test
npm run build
```

Tests exercise offline discovery, updates and UDP writes, query scheduling/value conversion, templates and admin authentication. The build regenerates the minified mixer JavaScript/CSS used by the production page after source changes.

For a separately launched mock desk:

```bash
npm run mock-desk
```

Start the server with `npm start`, then point **Desk settings → Connection → Mixing Desk** at the mock (`127.0.0.1` when it is on the same computer).

```bash
node tools/mock-desk.js --channels 32 --auxes 8
node tools/mock-desk.js --live
node tools/mock-desk.js --port 9000 --reply-port 8000 --host 127.0.0.1
```

With no flags, the mock reads port numbers from `config.json` when present. `npm run dev` configures the mock automatically and is the easiest offline option.

## FAQs

<details>
  <summary>My external devices won't connect</summary>
  Check that the server and devices share a network and that their send/receive ports match the configuration in Desk settings.
</details>
<details>
  <summary>What devices work?</summary>
  Devices with a recent browser, including iOS, Android, Windows, macOS and Linux.
</details>
<details>
  <summary>How many mixer clients can I connect?</summary>
  There is no configured client limit. Practical capacity depends on the console, server and network; verify the expected number of clients before live use.
</details>
<details>
  <summary>Can I connect multiple iPads with the DiGiCo app?</summary>
  The upstream v2 protocol supports simultaneous DiGiCo iPad apps alongside browser clients. Check the intended setup with your console.
</details>
<details>
  <summary>How do I enable a plugin?</summary>
  Add a JavaScript file to <code>plugins/</code> whose filename does not start with an underscore, then restart the server.
</details>
<details>
  <summary>Does v2 support DiGiCo S-Series consoles?</summary>
  S-Series consoles are not supported by v2. See <a href="https://github.com/castles/OSCWebMixer">OSCWebMixer v1</a> and the <a href="https://github.com/castles/OSCWebMixer2/issues/4">upstream issue</a>.
</details>

## Upstream project

OSCWebMixer2 was created by Marc Castles. Its native protocol, configuration and mock desk form the basis of this version. The original project is available at [castles/OSCWebMixer2](https://github.com/castles/OSCWebMixer2) under the MIT license.
