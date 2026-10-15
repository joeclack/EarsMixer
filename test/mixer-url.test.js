"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMixerUrl } = require("../lib/mixer-url.js");

test("custom mixer URLs support DNS names, HTTPS, explicit ports and clearing", () => {
  for (const [input, expected] of [
    ["ears.glow.uk", "http://ears.glow.uk"],
    [" http://ears.glow.uk/ ", "http://ears.glow.uk"],
    ["https://EARS.GLOW.UK/", "https://ears.glow.uk"],
    ["ears.glow.uk:8082", "http://ears.glow.uk:8082"],
    ["http://10.0.0.1:8082", "http://10.0.0.1:8082"],
    ["http://[::1]:8082/", "http://[::1]:8082"],
    ["", ""], ["  ", ""],
  ]) assert.equal(normalizeMixerUrl(input), expected);
});

test("custom mixer URLs reject unsafe schemes, credentials, paths and malformed inputs", () => {
  for (const input of [undefined, null, 123, {}, "x".repeat(2049), "javascript:alert(1)",
    "ftp://ears.glow.uk", "https://user:password@ears.glow.uk", "https://ears.glow.uk/mixer",
    "https://ears.glow.uk?aux=1", "https://ears.glow.uk#mix", "ears.glow.uk:99999",
    "https://ears.glow.uk\\other", "ears. glow.uk", "ears.glow.uk\n:8082", "https://",
  ]) assert.throws(() => normalizeMixerUrl(input), undefined, JSON.stringify(input));
});
