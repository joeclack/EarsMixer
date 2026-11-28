const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

// A website that points its own domain at the server (DNS rebinding) must not
// reach the admin, even when no admin password is set.
test("admin pages and API refuse requests addressed to another site's domain", async () => {
  process.env.OSC_WEBMIXER_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "osc-admin-host-"));
  const { createAdminAuth } = require("../lib/admin-session");
  const { trustedHost } = require("../lib/server/security.js");
  const app = express();
  app.use(express.json());
  const auth = await createAdminAuth();
  auth.register(app, { trustedHost: req => trustedHost(req, {}, { computerName: "desk-pc" }) });
  app.get("/api/admin/access", (_req, res) => res.json({ pin: "123456" }));
  app.post("/admin", (_req, res) => res.json({ saved: true }));
  app.get("/config", (_req, res) => res.json({ ok: true }));
  app.get("/api/connection", (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const { port } = server.address();
  const send = (method, url, host, body) => new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: url,
      headers: { host, ...(body ? { "content-type": "application/json", origin: "http://" + host } : {}) } }, response => {
      let text = ""; response.on("data", chunk => { text += chunk; }); response.on("end", () => resolve({ status: response.statusCode, text }));
    });
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const evil = "rebind.evil.example:" + port;
    assert.equal((await send("GET", "/api/admin/access", evil)).status, 403);
    assert.doesNotMatch((await send("GET", "/api/admin/access", evil)).text, /123456/);
    assert.equal((await send("POST", "/admin", evil, { desk_ip: "10.0.0.1" })).status, 403);
    assert.equal((await send("GET", "/config", evil)).status, 403);
    assert.equal((await send("GET", "/admin.html", evil)).status, 403);
    // Musician routes are unaffected.
    assert.equal((await send("GET", "/api/connection", evil)).status, 200);
    for (const host of ["127.0.0.1:" + port, "localhost:" + port, "desk-pc.local:" + port]) {
      assert.equal((await send("GET", "/api/admin/access", host)).status, 200, host);
      assert.equal((await send("POST", "/admin", host, { desk_ip: "10.0.0.1" })).status, 200, host);
    }
  } finally {
    server.close();
  }
});
