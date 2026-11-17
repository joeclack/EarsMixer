# EarsMixer API and console integration

- Keep HTTP and WebSocket handling thin. Validate request bodies, parameters and messages at the boundary. Keep mix rules and protocol conversions in independently testable modules.
- Enforce admin sessions, musician access and AUX permissions on the server. For access changes, verify that unauthorised clients cannot read protected data or change another mix. Reuse the existing guards in `adminAuth.js`, `admin-session.js`, `client-access.js` and `server/security.js` where applicable.
- Keep OSC address and value conversions consistent with the DiGiCo iPad protocol. Exercise routing and reconnect behaviour with the mock desk before hardware checks. Use a test desk or isolated session when verifying writes.
- Keep existing settings and saved templates readable after updates. Exercise older data and interrupted operations when changing persistence.
- Keep credentials, PINs, session tokens and real user data out of logs and fixtures. Use local ignored configuration for development and sanitise captured protocol data.
