const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createClientAccess } = require("../lib/client-access");

test("PIN pairing admits paired devices until the PIN changes or access is revoked", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osc-access-test-"));
  let access = await createClientAccess(directory);
  const phone = "a1b2c3d4-0000-4000-8000-000000000001", tablet = "a1b2c3d4-0000-4000-8000-000000000002";

  // Off by default: anyone connects, and identified devices are listed.
  assert.equal(access.required(), false);
  assert.ok(access.identify({}, "10.0.0.5"));
  assert.equal(access.identify({ device: phone, name: "Joe" }, "10.0.0.5").name, "Joe");
  assert.deepEqual((await access.pair({ device: phone, pin: "000000" }, "10.0.0.5")).body, { paired: true, token: null });

  let changes = 0; access.onChange(() => changes++);
  await access.setEnabled(true);
  assert.equal(changes, 1);
  const { pin } = access.summary(); assert.match(pin, /^\d{6}$/);

  // Unpaired devices and bad tokens are refused.
  assert.equal(access.identify({ device: phone }, "10.0.0.5"), null);
  assert.equal(access.identify({ device: phone, token: "f".repeat(64) }, "10.0.0.5"), null);
  assert.equal((await access.pair({ device: "bad id", pin }, "10.0.0.5")).status, 400);
  const wrong = pin === "123456" ? "654321" : "123456";
  assert.equal((await access.pair({ device: phone, pin: wrong }, "10.0.0.5")).status, 401);

  // Pairing returns a token that admits the device from any address.
  const paired = await access.pair({ device: phone, pin: " " + pin.slice(0, 3) + " " + pin.slice(3), name: "Joe's phone" }, "10.0.0.5");
  assert.equal(paired.status, 200); assert.match(paired.body.token, /^[a-f0-9]{64}$/);
  const token = paired.body.token;
  assert.equal(access.identify({ device: phone, token }, "10.0.0.99").lastAddress, "10.0.0.99");
  assert.equal(access.identify({ device: tablet, token }, "10.0.0.6"), null, "a token only works for its own device");
  assert.equal(access.isAuthorized(phone), true);

  // The PIN, device list and tokens survive a restart; tokens are stored hashed.
  const saved = await fs.readFile(path.join(directory, "client-access.json"), "utf8");
  assert.ok(!saved.includes(token));
  access = await createClientAccess(directory);
  assert.ok(access.identify({ device: phone, token }, "10.0.0.5"));
  const listed = access.summary().devices.find(device => device.id === phone);
  assert.equal(listed.paired, true); assert.equal(listed.name, "Joe's phone"); assert.equal(listed.tokenHash, undefined);

  // Revoking one device, signing everyone out and changing the PIN all remove access.
  await access.revoke(phone); assert.equal(access.identify({ device: phone, token }, "10.0.0.5"), null);
  const again = (await access.pair({ device: phone, pin, name: "Joe" }, "10.0.0.7")).body.token;
  await access.revokeAll(); assert.equal(access.identify({ device: phone, token: again }, "10.0.0.7"), null);
  const third = (await access.pair({ device: phone, pin }, "10.0.0.8")).body.token;
  await access.changePin(); assert.equal(access.identify({ device: phone, token: third }, "10.0.0.8"), null);
  assert.notEqual(access.summary().pin, pin);
  assert.equal(await access.forget(phone), true); assert.equal(access.summary().devices.some(device => device.id === phone), false);
});

test("PIN attempts are rate limited per address and per device", async () => {
  const access = await createClientAccess(await fs.mkdtemp(path.join(os.tmpdir(), "osc-access-test-")));
  await access.setEnabled(true);
  const wrong = access.summary().pin === "111111" ? "222222" : "111111";
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await access.pair({ device: "device-0001", pin: wrong }, "10.0.0.9")).status, 401);
  const limited = await access.pair({ device: "device-0002", pin: access.summary().pin }, "10.0.0.9");
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers["Retry-After"]) > 0);
  // Another address can still pair.
  assert.equal((await access.pair({ device: "device-0003", pin: access.summary().pin }, "10.0.0.10")).status, 200);
});

test("a damaged access file never switches the PIN off", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osc-access-test-"));
  await fs.writeFile(path.join(directory, "client-access.json"), "{ not json");
  await assert.rejects(createClientAccess(directory));
});
