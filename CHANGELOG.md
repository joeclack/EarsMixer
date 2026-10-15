# Changelog

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
