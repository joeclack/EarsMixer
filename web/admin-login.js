"use strict";

const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginPassword = document.getElementById("adminLoginPassword");
const adminLoginSubmit = document.getElementById("adminLoginSubmit");
const adminLoginMessage = document.getElementById("adminLoginMessage");
adminLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (adminLoginSubmit.disabled) return;
  adminLoginSubmit.disabled = true;
  adminLoginMessage.textContent = "";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminLoginPassword.value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not sign in.");
    window.location.replace("/admin.html" + window.location.hash);
  } catch (error) {
    adminLoginMessage.textContent = error.message || "Could not reach the server. Please try again.";
    adminLoginPassword.value = "";
    adminLoginPassword.focus();
    adminLoginSubmit.disabled = false;
  }
});
