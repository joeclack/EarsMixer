# OSCWebMixer2 · Ears Mixer

This version combines the custom Ears Mixer interface and admin dashboard with the native OSC backend from [OSCWebMixer2](https://github.com/castles/OSCWebMixer2). It supports DiGiCo SD Series and Quantum consoles through their built-in DiGiCo iPad connection.

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
- Windows, macOS or Linux, or Docker with Docker Compose.
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

## Docker

For a real desk, copy `.env.example` to `.env` and set the URL that phones/tablets will use to reach the server computer:

```dotenv
OSC_WEBMIXER_PUBLIC_URL=http://192.168.6.7
WEB_PORT=80
OSC_PORT=8000
```

Include the published web port in `OSC_WEBMIXER_PUBLIC_URL` when it is not 80, for example `http://192.168.6.7:8082`. This URL is used for the dashboard link and QR code.

Build and start:

```bash
docker compose up --build -d
docker compose logs -f webmixer
```

The production container listens for HTTP on 8080 and publishes it on `WEB_PORT` (default 80). It publishes UDP `OSC_PORT` (default 8000), which must match the console's outgoing iPad destination port. Change these published ports through `.env` and recreate the container with `docker compose up -d`.

The `config/` and `data/` bind mounts preserve desk settings, shared presets, personal templates and the admin password across container replacement. In the console's iPad configuration, use the Docker host computer's network IP address and published UDP port.

To run the offline mock demo in Docker:

```bash
docker compose -f compose.demo.yaml up --build -d
docker compose -f compose.demo.yaml logs -f webmixer
```

Open [localhost:8082](http://localhost:8082/) or [its admin dashboard](http://localhost:8082/admin). The demo uses the same launcher as `npm run dev`, binds HTTP to `0.0.0.0`, publishes container HTTP 8080 on host 8082 and keeps UDP 8012/9012 between the server and mock inside the container. Its settings and password/templates remain isolated under `config/demo/` and `config/demo/data/`.

Stop production with `docker compose down`, or stop the offline demo with `docker compose -f compose.demo.yaml down`. Saved files remain in the mounted directories.

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
  Check that the server and devices share a network and that their send/receive ports match the configuration in Desk settings. For Docker, use the host computer's network IP and published UDP port.
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
