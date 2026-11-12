import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { api } from "./api.js";
import { parseLiveUpdate } from "./format.mjs";

export function useHashPage(pages, fallback) {
  const read = () => {
    const page = window.location.hash.replace("#", "");
    return pages.includes(page) ? page : fallback;
  };
  const [page, setPage] = useState(read);
  useEffect(() => {
    const change = () => setPage(read());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return page;
}

// Poll an endpoint. Returns the latest data, an error message and a reload function.
export function usePolled(url, interval, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const source = useRef(url);
  source.current = url;
  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const result = await api(typeof source.current === "function" ? source.current() : source.current);
      if (id === latest.current) { setData(result); setError(""); }
      return result;
    } catch (failure) {
      if (id === latest.current) setError(failure.message);
      return null;
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, interval);
    return () => clearInterval(timer);
  }, [load, interval, ...deps]);
  return { data, error, reload: load };
}

// Streamed level and pan changes from the desk, applied over the polled levels.
// A change newer than the last poll wins until the next poll has caught up.
export function useLiveLevels(mixLevels, enabled, onReload) {
  const [overrides, setOverrides] = useState({});
  const reload = useRef(onReload);
  reload.current = onReload;
  useEffect(() => {
    // Drop overrides the poll has had time to include.
    const cutoff = Date.now() - 4000;
    setOverrides(current => {
      const kept = Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.at > cutoff));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
  }, [mixLevels]);
  useEffect(() => {
    if (!enabled) return undefined;
    let socket = null, timer = null, closed = false;
    const connect = () => {
      socket = new WebSocket((window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/?role=observer");
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.address === "/MixReload") { reload.current?.(); return; }
        const update = parseLiveUpdate(message);
        if (!update) return;
        const key = update.aux + ":" + update.channel + ":" + update.field;
        setOverrides(current => ({ ...current, [key]: { value: update.value, at: Date.now() } }));
      };
      socket.onclose = () => { if (!closed) timer = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); socket?.close(); };
  }, [enabled]);
  return useCallback((aux, entry, field) => overrides[aux + ":" + entry.channel + ":" + field]?.value ?? entry[field], [overrides]);
}

// Run an async action with a busy flag and a status message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false });
  const run = useCallback(async (action, success) => {
    setBusy(true); setMessage({ text: "", error: false });
    try { const result = await action(); if (success) setMessage({ text: success, error: false }); return result; }
    catch (failure) { setMessage({ text: failure.message, error: true }); return null; }
    finally { setBusy(false); }
  }, []);
  return { busy, message, run, setMessage };
}
