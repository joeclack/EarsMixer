"use strict";

function normalizeMixerUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a hostname or an HTTP/HTTPS URL.");
  const input = value.trim();
  if (!input) return "";
  let url;
  try {
    if (/[\s\\]/.test(input)) throw new Error();
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  } catch {
    throw new Error("Enter a valid hostname or HTTP/HTTPS URL, including a port if needed.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use an HTTP/HTTPS address without a path, query, fragment or sign-in details.");
  }
  return url.origin;
}

module.exports = { normalizeMixerUrl };
