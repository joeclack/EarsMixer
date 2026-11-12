"use strict";
// Overview, Live mix, Clients and Templates now live in the new dashboard.
// The classic page only keeps Desk settings and System until they are rebuilt.
(function () {
  const classicPages = ["desk-settings", "config"];
  function check() {
    const page = window.location.hash.replace("#", "");
    if (!classicPages.includes(page)) window.location.replace("/admin.html#" + (page || "overview"));
  }
  check();
  window.addEventListener("hashchange", check);
})();
