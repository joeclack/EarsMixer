// Requests to the admin API. A 401 means the admin password is needed.
export async function api(url, { method = "GET", body } = {}) {
  const json = method !== "GET";
  const response = await fetch(url, {
    method, cache: "no-store",
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body: json ? JSON.stringify(body ?? {}) : undefined,
  });
  if (response.status === 401) {
    window.location.replace("/admin-login.html" + window.location.hash);
    throw new Error("Enter the admin password to continue.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "The request failed. Try again.");
  return data;
}
