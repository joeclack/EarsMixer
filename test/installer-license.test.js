"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertNoSavedInnoLicense } = require("../tools/build-installer.cjs");

test("installer builds proceed only after confirming the account has no saved Inno key", () => {
  assert.doesNotThrow(() => assertNoSavedInnoLicense((command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.match(args.at(-1), /GetValueNames\(\)/);
    assert.doesNotMatch(args.at(-1), /GetValue\(|Remove-|Set-|Delete/);
    assert.equal(options.stdio, "ignore");
    return { status: 0 };
  }));
});

test("a saved commercial key blocks the build without exposing credentials", () => {
  assert.throws(() => assertNoSavedInnoLicense(() => ({ status: 10, stdout: "private-key" })), error => {
    assert.match(error.message, /will not use it/);
    assert.match(error.message, /GitHub Actions or a separate Windows account/);
    assert(!error.message.includes("private-key"));
    return true;
  });
});

test("an unavailable or failed licence check blocks the installer build", () => {
  for (const result of [{ error: new Error("unavailable"), status: null }, { status: 1 }, { status: null }]) {
    assert.throws(() => assertNoSavedInnoLicense(() => result), /Could not check/);
  }
});
