const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

test("password setup, protected pages and native routes, sessions, and persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osc-admin-test-"));
  process.env.OSC_WEBMIXER_DATA_DIR = directory;
  const { createAdminAuth } = require("../lib/admin-session");
  const { useTemplateRoutes } = require("../lib/templates");
  let server;
  let base;
  async function start() {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    const auth = await createAdminAuth();
    auth.register(app);
    useTemplateRoutes(app);
    app.get("/api/admin/status", (_req, res) => res.json({ adminPasswordEnabled: auth.isEnabled() }));
    app.get(["/config", "/aux", "/channels", "/api/presets", "/api/presets/example/download"], (_req, res) => res.json({ ok: true }));
    app.post("/admin", (req, res) => res.json({ saved: true, port: req.body.server_port }));
    app.post("/api/presets/save-current-state", (_req, res) => res.json({ saved: true }));
    app.post("/api/presets/example/load", (_req, res) => res.json({ loaded: true }));
    app.delete("/api/presets/example", (_req, res) => res.json({ deleted: true }));
    app.use(express.static(path.join(__dirname, "..", "web")));
    server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = "http://127.0.0.1:" + server.address().port;
  }
  const cookie = response => response.headers.get("set-cookie").split(";")[0];
  const request = (route, method = "GET", body, session, headers = {}) => fetch(base + route, {
    method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(session ? { Cookie: session } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const login = password => request("/api/admin/login", "POST", { password });
  async function rawStatus(route) {
    return new Promise((resolve, reject) => {
      const req = http.get(base + route, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject);
    });
  }
  try {
    await start();
    assert.equal((await request("/admin.html")).status, 200);
    assert.equal((await request("/api/admin/status")).status, 200);
    assert.equal((await request("/admin-login.html")).status, 302);
    assert.equal((await request("/api/admin/password", "PUT", { password: "strong-pass-1" }, null, { Origin: "http://other-site.example" })).status, 403);
    assert.equal((await request("/api/admin/password", "PUT", { password: "strong-pass-1" }, null, { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await request("/api/admin/password", "PUT", { password: "strong-pass-1" }, null, { "Content-Type": "text/plain" })).status, 415);
    for (const password of ["short", "        ", 12345678, "x".repeat(257)]) {
      assert.equal((await request("/api/admin/password", "PUT", { password })).status, 400);
    }
    let response = await request("/api/admin/password", "PUT", { password: "strong-pass-1" }, null, { Origin: base });
    assert.equal(response.status, 200);
    const firstSession = cookie(response);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
    const passwordFile = path.join(directory, "admin-password.json");
    const savedText = await fs.readFile(passwordFile, "utf8");
    assert(!savedText.includes("strong-pass-1"));
    assert.match(JSON.parse(savedText).hash, /^[a-f0-9]{128}$/);
    for (const route of ["/admin.html", "/admin", "/admin/", "/ADMIN.HTML", "/%61dmin.html", "/desk-settings.html", "/DESK-SETTINGS.HTML", "/%64esk-settings.html"]) {
      response = await request(route);
      assert.equal(response.status, 302, route);
      assert.equal(response.headers.get("location"), "/admin-login.html");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    for (const route of ["//admin.html", "/%2e/admin.html", "/%5cadmin.html"]) assert.equal(await rawStatus(route), 302, route);
    assert.equal((await request("/admin-login.html")).status, 200);
    assert.equal((await request("/api/admin/status")).status, 401);
    assert.equal((await request("/api/admin/status", "GET", undefined, "osc_admin_session=forged")).status, 401);
    assert.equal((await request("/api/admin/status", "GET", undefined, firstSession)).status, 200);
    for (const route of ["/config", "/aux", "/channels", "/api/presets", "/api/presets/example/download", "/%63onfig", "/%61pi/presets"]) {
      assert.equal((await request(route)).status, 401, route);
      assert.equal((await request(route)).headers.get("cache-control"), "no-store", route);
    }
    for (const route of ["/config", "/aux", "/channels", "/api/presets", "/api/presets/example/download"]) {
      assert.equal((await request(route, "GET", undefined, firstSession)).status, 200, route);
    }
    for (const [route, method] of [["/api/presets/save-current-state", "POST"], ["/api/presets/example/load", "POST"], ["/api/presets/example", "DELETE"]]) {
      assert.equal((await request(route, method, {})).status, 401, route);
      assert.equal((await request(route, method, {}, firstSession, { Origin: "http://other-site.example" })).status, 403, route);
      assert.equal((await request(route, method, {}, firstSession, { Origin: base })).status, 200, route);
    }
    const form = (session, origin = base) => fetch(base + "/admin", {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...(session ? { Cookie: session } : {}) },
      body: "server_port=8082",
    });
    assert.equal((await form()).status, 302);
    assert.equal((await form(firstSession, "http://other-site.example")).status, 403);
    assert.deepEqual(await (await form(firstSession)).json(), { saved: true, port: "8082" });
    assert.equal((await request("/admin/", "GET", undefined, firstSession)).headers.get("location"), "/admin.html");
    assert.equal((await request("/data/admin-password.json")).status, 404);
    const templateConfig = { selectedAux: 1, channelOrder: [1], favouritesByAux: {}, view: "list" };
    assert.equal((await request("/api/admin/templates", "PUT", { name: "Protected template", config: templateConfig }, firstSession)).status, 200);
    assert.equal((await request("/api/admin/templates", "PUT", {})).status, 401);
    const protectedTemplate = (await (await request("/api/templates")).json()).templates.find(template => template.name === "Protected template");
    const deleteRoute = "/api/admin/templates/" + protectedTemplate.id;
    assert.equal((await request(deleteRoute, "DELETE", {})).status, 401);
    assert.equal((await request(deleteRoute, "DELETE", {}, firstSession, { Origin: "http://other-site.example" })).status, 403);
    assert.equal((await request("/api/templates/" + protectedTemplate.id)).status, 200);
    assert.equal((await request(deleteRoute, "DELETE", {}, firstSession)).status, 200);
    assert.equal((await request("/api/templates/" + protectedTemplate.id)).status, 404);
    assert.equal((await request("/api/admin/password", "DELETE", {})).status, 401);
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/api/templates")).status, 200);
    assert.equal((await login("incorrect")).status, 401);
    assert.equal((await login({ password: "strong-pass-1" })).status, 401);
    response = await login("strong-pass-1"); assert.equal(response.status, 200);
    const secondSession = cookie(response);
    assert.equal((await request("/api/admin/password", "PUT", { currentPassword: "wrong", password: "strong-pass-2" }, secondSession)).status, 400);
    assert.equal(await fs.readFile(passwordFile, "utf8"), savedText);
    // A failed disk write preserves the original password and sessions.
    await fs.rename(passwordFile, passwordFile + ".backup");
    await fs.mkdir(passwordFile);
    response = await request("/api/admin/password", "PUT", { currentPassword: "strong-pass-1", password: "strong-pass-2" }, secondSession);
    assert.equal(response.status, 500);
    assert.equal((await request("/api/admin/status", "GET", undefined, secondSession)).status, 200);
    await fs.rmdir(passwordFile);
    await fs.rename(passwordFile + ".backup", passwordFile);
    response = await request("/api/admin/password", "PUT", { currentPassword: "strong-pass-1", password: "strong-pass-2" }, secondSession);
    assert.equal(response.status, 200);
    const changedSession = cookie(response);
    assert.equal((await request("/api/admin/status", "GET", undefined, firstSession)).status, 401);
    assert.equal((await request("/api/admin/status", "GET", undefined, secondSession)).status, 401);
    assert.equal((await request("/api/admin/status", "GET", undefined, changedSession)).status, 200);
    assert.equal((await login("strong-pass-1")).status, 401);
    assert.equal((await login("strong-pass-2")).status, 200);

    await new Promise(resolve => server.close(resolve));
    await start();
    assert.equal((await request("/api/admin/status")).status, 401);
    assert.equal((await request("/api/admin/status", "GET", undefined, changedSession)).status, 401);
    response = await login("strong-pass-2"); assert.equal(response.status, 200);
    const expiredSession = cookie(response);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 13 * 60 * 60 * 1000;
      assert.equal((await request("/api/admin/status", "GET", undefined, expiredSession)).status, 401);
    } finally { Date.now = realNow; }
    response = await login("strong-pass-2");
    const restartSession = cookie(response);
    assert.equal((await request("/api/admin/logout", "POST", {}, restartSession)).status, 200);
    assert.equal((await request("/api/admin/status", "GET", undefined, restartSession)).status, 401);
    response = await login("strong-pass-2"); const finalSession = cookie(response);
    assert.equal((await request("/api/admin/password", "DELETE", { currentPassword: "wrong" }, finalSession)).status, 400);
    assert.equal((await request("/api/admin/password", "DELETE", { currentPassword: "strong-pass-2" }, finalSession)).status, 200);
    await assert.rejects(fs.readFile(passwordFile), { code: "ENOENT" });
    assert.equal((await request("/api/admin/status")).status, 200);
    assert.equal((await request("/admin.html")).status, 200);
    await new Promise(resolve => server.close(resolve));
    await start();
    assert.equal((await request("/api/admin/status")).status, 200);

    // Simultaneous initial setup cannot overwrite the password just enabled.
    const competing = await Promise.all([request("/api/admin/password", "PUT", { password: "strong-pass-3" }), request("/api/admin/password", "PUT", { password: "strong-pass-4" })]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 401]);
    const currentPassword = competing[0].status === 200 ? "strong-pass-3" : "strong-pass-4";
    await new Promise(resolve => server.close(resolve));
    await start();
    for (let index = 0; index < 10; index++) assert.equal((await login("bad-password")).status, 401);
    response = await login(currentPassword);
    assert.equal(response.status, 429);
    assert(Number(response.headers.get("retry-after")) > 0);
    await fs.writeFile(passwordFile, "invalid password file");
    await assert.rejects(createAdminAuth());
    console.log("Admin auth tests passed: setup, guarded pages/APIs, hashed storage, login, password changes, session invalidation, restart persistence, removal, rate limiting, cross-site requests and failed-write preservation.");
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("osc-admin-test-")) throw Error("Unsafe test cleanup path");
    await fs.rm(target, { recursive: true, force: true });
  }
});
