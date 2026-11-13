"use strict";

// The mixer page, its scripts and its styles must be checked with the server on
// every load. Without this, Safari keeps serving copies saved before an update
// (the asset URLs never change), so phones run old code after the server is updated.
// "no-cache" still lets the browser reuse its copy when the server says it is unchanged.
const PAGE_FILES = /(^\/$|\.(html|js|css)$)/;

function revalidateWebFiles(req, res, next) {
  if (PAGE_FILES.test(req.path)) res.set("Cache-Control", "no-cache");
  next();
}

module.exports = { revalidateWebFiles };
