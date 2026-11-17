# EarsMixer server plan

EarsMixer lets musicians adjust their own DiGiCo AUX mixes while engineers manage the desk connection and shared settings.

## Existing capabilities

- [x] Bridge DiGiCo SD Series and Quantum consoles to the browser mixer and mobile app.
- [x] Provide an admin dashboard, discovery, QR connection and shared templates.
- [x] Provide Windows and macOS installers and a mock desk for development.

## Release checks

Use this checklist for the release under review. Record the versions, hardware or mock, and clients exercised.

- [ ] Connect a supported desk and verify channel discovery, AUX routing, level and pan. Confirm that changes target the intended send.
- [ ] Check musician PIN and admin session boundaries, reconnect and behaviour when the desk goes offline.
- [ ] Verify browser and mobile compatibility, discovery, QR and manual connection, and shared templates where affected.
- [ ] Check fresh installs and upgrades on affected operating systems. Confirm settings and data survive and release metadata matches the artifacts.

**Ready when** the affected release checks have evidence, including any cases that require a real desk or installer.
