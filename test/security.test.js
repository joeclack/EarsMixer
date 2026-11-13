const test = require("node:test");
const assert = require("node:assert/strict");
const { allowedOscSource, sameOrigin, localRequest, createRateLimit, readExternalDevices } = require("../lib/server/security.js");

test("OSC is accepted only from the desk and configured external devices", () => {
  const config = { desk: { ip: "192.168.1.50" }, externalDevices: [{ ip: "192.168.1.60" }] };
  assert.equal(allowedOscSource("192.168.1.50", config), true);
  assert.equal(allowedOscSource("::ffff:192.168.1.50", config), true);
  assert.equal(allowedOscSource("192.168.1.60", config), true);
  assert.equal(allowedOscSource("192.168.1.99", config), false);
  // A desk entered as a hostname, or not set yet, cannot be compared.
  assert.equal(allowedOscSource("192.168.1.99", { desk: { ip: "desk.local" } }), true);
  assert.equal(allowedOscSource("192.168.1.99", { desk: { ip: "" } }), true);
});

test("dashboard sockets must come from the server's own pages", () => {
  assert.equal(sameOrigin({ headers: { host: "192.168.1.10:8082" } }), true);
  assert.equal(sameOrigin({ headers: { host: "192.168.1.10:8082", origin: "http://192.168.1.10:8082" } }), true);
  assert.equal(sameOrigin({ headers: { host: "192.168.1.10:8082", origin: "http://evil.example" } }), false);
  assert.equal(sameOrigin({ headers: { host: "192.168.1.10:8082", origin: "null" } }), false);
});

test("local status answers only programs on this computer", () => {
  const request = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });
  assert.equal(localRequest(request("127.0.0.1", { host: "127.0.0.1:8082" })), true);
  assert.equal(localRequest(request("::ffff:127.0.0.1", { host: "localhost" })), true);
  assert.equal(localRequest(request("::1", { host: "[::1]:80" })), true);
  assert.equal(localRequest(request("192.168.1.20", { host: "192.168.1.10" })), false);
  // A web page, or a DNS name that resolves to this computer.
  assert.equal(localRequest(request("127.0.0.1", { host: "127.0.0.1", origin: "http://evil.example" })), false);
  assert.equal(localRequest(request("127.0.0.1", { host: "evil.example" })), false);
  assert.equal(localRequest(request("127.0.0.1", {})), false);
});

test("the message rate limit resets each second", () => {
  let time = 1000;
  const accept = createRateLimit(3, () => time);
  assert.deepEqual([accept(), accept(), accept(), accept()], [true, true, true, false]);
  time += 1000;
  assert.equal(accept(), true);
});

test("external devices are validated as a whole", () => {
  assert.deepEqual(readExternalDevices({}), []);
  const body = { externalName: [" Lights "], externalIP: ["192.168.1.70"], externalReceive: ["9001"], externalBroadcast: ["true"], externalLoopback: ["false"] };
  assert.deepEqual(readExternalDevices(body), [{ broadcast: true, name: "Lights", ip: "192.168.1.70", port: 9001, loopback: false }]);
  assert.deepEqual(readExternalDevices({ ...body, externalIP: ["lights.local"] })[0].ip, "lights.local");
  for (const bad of [{ externalIP: ["not an address"] }, { externalReceive: ["70000"] }, { externalName: [""] }, { externalName: "Lights" }, { externalIP: [] }])
    assert.equal(readExternalDevices({ ...body, ...bad }), null);
});
