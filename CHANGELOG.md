# Changelog

## Unreleased

## 1.12.0 — 2026-11-13

Product version: **1.12.0**. Node package version: **2.14.0**.

- Musicians can mute a channel in their own mix. The app turns the desk's send on or off (`/Input_Channels/<n>/Aux_Send/<aux>/send_on`, 1 or 0), so the level is kept and the engineer sees the mute on the desk. The server loads each send's state after its level, relays changes to everyone on that AUX, and logs mutes on the Clients page. The mock desk supports it too.
- Musicians can send the engineer a request: More me, Less me, More click, Talk to me or Problem, with an optional short message (up to 140 characters). Requests appear at the top of every admin page, with a count in the tab title, until the engineer taps Got it; the musician's app then shows it was seen. Requests are limited to one every 1.5 seconds and eight a minute per device.

## 1.11.0 — 2026-11-13

Product version: **1.11.0**. Node package version: **2.13.0**.

- Add a signal meter stream for the mobile app. Clients send `{ "meters": true }` to subscribe and receive `{ "meters": { "kind", "levels": [[channel, dB or null], …] } }` about 15 times a second for their visible channels. The config message's new `meters` field says whether meters exist (`"simulated"` or `null`). The stream runs only while a client is subscribed and skips clients that fall behind.
- The demo (`npm run dev`) streams simulated signals: kick and snare on a 120 bpm grid, drifting sustained sources, vocals that rest, and an occasional clip. They are always marked simulated. Set `OSC_WEBMIXER_DEMO_METERS=0` to turn them off.
- Real DiGiCo meters are not requested yet. The console's input-meter addresses must first be confirmed from a real desk, so on a desk `meters` is `null` and the app hides its meters.

## 1.10.4 — 2026-11-13

Product version: **1.10.4**. Node package version: **2.12.4**.

- Fix phones running an old version of the browser mixer after the server was updated. The mixer's page, scripts and styles were requested under the same address in every release, so Safari kept using its saved copies and never loaded fixes. The server now tells browsers to check for a newer copy on every load; an unchanged file is not downloaded again.

## 1.10.3 — 2026-11-13

Product version: **1.10.3**. Node package version: **2.12.3**.

- Fix browser mixer faders looking disabled and ignoring touches in Safari after the mix loaded or after switching AUX, even though the status said Connected. Safari did not restyle a fader's drag handle when the fader became enabled, so it stayed greyed out until the page was redrawn (for example by switching apps). The handle now carries the disabled state itself.
- The recheck added in 1.10.2 now runs only when the page is shown again, not on every tap or focus, and asks only for the levels still missing, so it can no longer disable faders that have already loaded.

## 1.10.2 — 2026-11-13

Product version: **1.10.2**. Node package version: **2.12.2**.

- Fix browser mixer faders staying disabled in Safari until you switched apps and back. Safari freezes a page's timers and WebSocket messages while it is opening or in the background. The mixer now rechecks when the page is shown, focused or touched: it reconnects a closed connection and fetches any levels that have not arrived. A connection that looks open but never answers is replaced, and level queries pause while the page is hidden instead of running out their retries.

## 1.10.1 — 2026-11-13

Product version: **1.10.1**. Node package version: **2.12.1**.

- Fix the macOS panel leaving an empty area above it when the server is off. The panel now resizes to fit its contents.

## 1.10.0 — 2026-11-13

Product version: **1.10.0**. Node package version: **2.12.0**.

- Replace the macOS menu with a panel. It shows the server switch, whether the desk is answering, the number of connected devices and the mixer QR code and link, with buttons for the admin dashboard and mixer. Restart, logs, the settings folder, Open at Login, update checks and Quit are under the gear button.
- Add `/api/local/status` for the menu bar app. It reports the desk connection and device count, and answers only programs on the same computer.

## 1.9.0 — 2026-11-13

Product version: **1.9.0**. Node package version: **2.11.0**.

- Add a macOS version: a menu bar app that runs the server, with the mixer QR code, admin and mixer links, start, stop and restart, logs, settings folder, Open at Login and update notices. Releases include `EarsMixer-<version>-macos.dmg` for Apple silicon and Intel.

## 1.8.0 — 2026-11-12

Windows product version: **1.8.0**. Node package version: **2.10.0**.

- Rebuild the admin dashboard as a Preact app with a new dark layout. A status strip shows the desk, snapshot, devices, access and server address on every page. Live mix shows every AUX mix's sends in one matrix.
- Rebuild Desk settings and System in the new dashboard and remove the old one. Desk settings is split into Connection, AUX mixes, Channels, External devices and Presets, shows whether the desk is answering, and keeps unsaved changes in a bar with Discard and Save. System holds the admin password and version. The sign-in page matches the new look.
- In the template editor, show channel groups inside the channel list. Drag a group to move it with its channels, and reorder channels inside their group.
- Accept OSC only from the desk's address and configured external devices. A desk entered as a hostname is not restricted.
- Require the admin dashboard's live connection to come from the dashboard itself, and ignore floods of more than 300 messages a second from one client.
- Save settings, the current state and presets by writing a temporary file and renaming it, so an interrupted save cannot corrupt them.
- Validate external OSC devices when saving desk settings: each needs a name, an IP address or hostname and a valid port.
- Split the server's single index.js into modules under lib/server, with no change in behaviour.
- Add an optional connection PIN for the mobile app and browser mixer. On the admin Clients page, switch on Require a PIN to connect, share the 6-digit PIN shown there, change it, or sign out every device. A device enters the PIN once and stays signed in until the PIN changes or it is signed out. PIN attempts are rate limited, and access tokens are stored hashed.
- Recognise devices by an ID each client creates, rather than by IP address. The Clients page lists devices with their name, last address and when they were last seen, and can sign out or forget each one.
- Refuse WebSocket messages over 64 KB, and require the admin session for the dashboard's observer connection.
- Simplify the admin template editor: channels on the left and channel groups on the right, with Save at the top. Remove favourites, Saved by and Starting view; a channel is now either shown or hidden. Older templates that showed only favourites keep the same channels visible when edited.
- Let shared templates carry hidden channels and channel groups for the mobile app. In the admin template editor, hide channels per AUX and create groups for one AUX mix or for all AUX mixes; a channel can only be in one group a mix can see, and each group needs at least two channels. The server validates these with the same rules as the app, and templates saved before this keep working.

## 1.7.1 — 2026-11-09

Windows product version: **1.7.1**. Node package version: **2.9.1**.

- Allow browser clients such as Expo web to read connection information and shared templates across origins. Include read-only preflight support; admin APIs and credentialed requests are not enabled for CORS.

## 1.7.0 — 2026-11-08

Windows product version: **1.7.0**. Node package version: **2.9.0**.

- Remove favourites, compact mode and fullscreen controls from the web mixer, including per-channel stars and old favourite filtering.
- Replace Set all to 0 dB with Set all levels to off. After confirmation, set every enabled channel's send on the selected AUX to −∞ (−150 dB), cancel pending drags and leave pan unchanged.

## 1.6.0 — 2026-11-08

Windows product version: **1.6.0**. Node package version: **2.8.0**.

- Keep the browser mixer as a limited alternative with an optional device-local nickname that saves automatically and identifies the live connection.
- Remove template selection, template onboarding and profile wording from the browser mixer. Keep existing browser layouts and nicknames.
- Keep shared template APIs and admin template management for the mobile app.

## 1.5.0 — 2026-11-08

Windows product version: **1.5.0**. Node package version: **2.7.0**.

- Share other connected users and nicknames with clients on the same AUX, updating on join, leave, nickname and AUX changes. Exclude admin observers and all network addresses/activity logs.
- Detect abandoned WebSocket connections with ping/pong so stale presence is removed.

- Remove musician accounts, passwords, account APIs and admin account management.
- Save nicknames automatically on the device; keep mixer layouts in local browser storage.
- Stop opening the legacy musician database. Existing database files are preserved.

- Advertise the installed service and demo using Bonjour/mDNS for discovery by native mobile clients.
- Include the actual HTTP port, refresh advertisements on network changes, and withdraw them on shutdown.
- Exclude common virtual and link-local adapters from automatic mixer links and QR codes.

## 1.4.0 — 2026-11-07

Windows product version: **1.4.0**. Node package version: **2.6.0**.

- Local musician accounts use SQLite in the existing Windows service data folder, without a separate database service or cloud dependency.
- Save and restore display names, selected AUX, channel order, favourites and view preferences across browsers and the native mobile client. Fader levels and pan are never recalled.
- Layout changes save automatically, with explicit conflict resolution when another device changes the saved layout.
- Guest mixing stays available; signing out restores the device's guest settings. Musician sessions survive service restarts.
- Admin Config includes musician account listing and password recovery that preserves layouts and invalidates old sign-ins.

## 1.3.1 — 2026-11-02

Windows product version: **1.3.1**. Node package version: **2.6.0**.

- Unified sidebar and page headers with aligned dividers, consistent Lucide icons and tighter page spacing.
- Apply the saved sidebar state before displaying the layout to prevent an expanded sidebar flashing on reload.
- Desk settings channels use a single column with handle dragging and keyboard reordering.
- Added spacing between the sidebar brand and headphone icon.

## 1.3.0 — 2026-11-01

Windows product version: **1.3.0**. Node package version: **2.6.0**.

- Desk settings channels use a compact two-column layout with drag and keyboard reordering while preserving each channel's settings.
- Reusable text tabs show an animated active underline on a full-width baseline. Admin page content no longer sits inside cards.
- The admin sidebar collapses to icons and remembers the preference. Its footer displays the running release version beside the collapse control.
- Removed the disconnected clients section, sidebar subtitle and back-to-mixer link.

## 1.2.2 — 2026-11-01

Windows product version: **1.2.2**. Node package version: **2.6.0**.

- Fader levels and send pan now require dragging the handle when using a finger, mouse or pen. Tapping or swiping the track leaves the value unchanged and allows vertical scrolling.
- Grabbing the handle preserves the current value without jumping to the contact point. Active drags are cancelled when changing mixes or modes, reloading a snapshot, editing the layout or disconnecting.
- Keyboard and assistive-technology slider controls remain available.

## 1.2.1 — 2026-10-16

Windows product version: **1.2.1**. Node package version: **2.6.0**.

- Full Windows installation and upgrade tests are opt-in for manual workflow runs, so ordinary builds and releases do not wait on installation tests.
- Windows installer upgrade tests report progress and elapsed time for each installation stage, with a five-minute limit on the test step.

## 1.2.0 — 2026-10-16

Windows product version: **1.2.0**. Node package version: **2.6.0**.

- The Windows tray checks GitHub for updates at startup and every six hours, with a manual check, a notification, release notes and an optional installer download. Installation remains manual.
- The tray embeds the Windows product version from installer metadata, so update checks follow release tags independently of the Node package version.
- Windows updates reuse the previous installation folder and preserve settings and custom service configuration. Same-version repairs are supported, and the updated installer refuses to replace a newer installed version.
- Upgrade preparation uses the bundled helper to wait for the tray and service to stop, including when the service is already stopped or its previous wrapper files are missing.

## 1.1.0 — 2026-10-15

Windows product version: **1.1.0**. Node package version: **2.6.0**.

### New

- Mixer controls open from a floating menu, keeping more space available for channels. Fullscreen, compact mode, favourites, layout editing and profile controls are available from the menu.
- Layout editing has a dedicated Done button and visible instructions.
- Admin Live mix uses vertical channel strips and receives streamed level and pan updates as faders move.
- A saved custom URL in Admin Overview lets mixer links and dashboard/tray QR codes use a DNS name such as `ears.glow.uk`. Clearing it restores the server address.
- `npm run dev` accepts connections from other devices on the network and prints links using the computer's LAN IP.

### Improvements

- Improved profile dialog sizing on small screens and prevented automatic zoom when editing profile fields on iPhone.
- Live mix reconnects automatically, retains status polling for recovery, and preserves newer streamed values when an older status response arrives.
- Custom mixer URLs survive server and demo restarts. Status refreshes preserve unfinished URL edits.
- Refreshed demo names, setup documentation and phone/tablet screenshots.
- Windows builds publish installers to versioned GitHub releases, reusing an existing release when rebuilding the same version.
- Local npm installer builds stop before invoking Inno Setup when the Windows account has a saved commercial key, keeping unrelated licence settings separate.
