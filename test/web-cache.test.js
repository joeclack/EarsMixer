"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { revalidateWebFiles } = require("../lib/web-cache");

function cacheHeaderFor(path) {
  const headers = {};
  let nextCalled = false;
  revalidateWebFiles({ path }, { set: (k, v) => { headers[k] = v; } }, () => { nextCalled = true; });
  assert.ok(nextCalled, path);
  return headers["Cache-Control"];
}

test("the mixer page, scripts and styles are rechecked on every load", () => {
  for (const path of ["/", "/index.html", "/mixer.min.js", "/mixer.min.css", "/identity.js", "/icons.css"]) {
    assert.equal(cacheHeaderFor(path), "no-cache", path);
  }
});

test("images keep normal browser caching", () => {
  assert.equal(cacheHeaderFor("/images/favicon.ico"), undefined);
  assert.equal(cacheHeaderFor("/vendor/lucide.svg"), undefined);
});
