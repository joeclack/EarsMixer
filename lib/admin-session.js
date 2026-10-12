"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const deriveKey = promisify(scrypt);
const cookieName = "osc_admin_session";
const sessionLifetime = 12 * 60 * 60 * 1000;
async function createAdminAuth() {
    const directory = process.env.OSC_WEBMIXER_DATA_DIR || path.join(__dirname, "..", "data");
    const passwordFile = path.join(directory, "admin-password.json");
    let passwordRecord = null;
    try {
        const saved = JSON.parse(await fs.readFile(passwordFile, "utf8"));
        if (saved?.version !== 1 || typeof saved.salt !== "string" || !/^[a-f0-9]{32}$/.test(saved.salt)
            || typeof saved.hash !== "string" || !/^[a-f0-9]{128}$/.test(saved.hash)) {
            throw new Error("Invalid admin password file.");
        }
        passwordRecord = saved;
    }
    catch (error) {
        // An unreadable password must never silently disable protection.
        if (error.code !== "ENOENT")
            throw error;
    }
    const sessions = new Map();
    const attempts = new Map();
    let writes = Promise.resolve();
    function sessionToken(req) {
        return req.headers.cookie?.split(";").map(part => part.trim())
            .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    }
    function authenticated(req) {
        if (!passwordRecord)
            return true;
        const token = sessionToken(req);
        const expires = token ? sessions.get(token) : undefined;
        if (!expires || expires <= Date.now()) {
            if (token)
                sessions.delete(token);
            return false;
        }
        return true;
    }
    function setSession(req, res) {
        for (const [token, expires] of sessions)
            if (expires <= Date.now())
                sessions.delete(token);
        const previous = sessionToken(req);
        if (previous)
            sessions.delete(previous);
        const token = randomBytes(32).toString("hex");
        sessions.set(token, Date.now() + sessionLifetime);
        res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/", maxAge: sessionLifetime });
    }
    function clearSession(req, res) {
        const token = sessionToken(req);
        if (token)
            sessions.delete(token);
        res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
    }
    function allowAttempt(req, res) {
        const now = Date.now();
        for (const [address, attempt] of attempts)
            if (attempt.expires <= now)
                attempts.delete(address);
        const address = attempts.size < 1000 ? req.socket.remoteAddress || "unknown" : "overflow";
        const attempt = attempts.get(address) || { count: 0, expires: now + 60000 };
        attempts.set(address, attempt);
        if (attempt.count >= 10) {
            res.set("Retry-After", String(Math.ceil((attempt.expires - now) / 1000)));
            res.status(429).json({ error: "Too many password attempts. Try again in a minute." });
            return false;
        }
        attempt.count++;
        return true;
    }
    async function matches(password, record) {
        if (typeof password !== "string" || password.length > 256)
            return false;
        const key = await deriveKey(password, Buffer.from(record.salt, "hex"), 64);
        return timingSafeEqual(key, Buffer.from(record.hash, "hex"));
    }
    async function persist(record) {
        if (!record) {
            await fs.unlink(passwordFile);
            return;
        }
        await fs.mkdir(directory, { recursive: true });
        const temporary = passwordFile + "." + randomBytes(8).toString("hex") + ".tmp";
        try {
            await fs.writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            await fs.rename(temporary, passwordFile);
        }
        finally {
            await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT")
                throw error; });
        }
    }
    function register(app) {
        app.use((req, res, next) => {
            let pathname;
            try {
                pathname = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, "/")).toLowerCase();
            }
            catch {
                res.status(400).end();
                return;
            }
            const adminApi = /^\/api\/admin(?:\/|$)/.test(pathname);
            const adminPage = /^\/admin(?:\.html)?[. ]*\/?$/.test(pathname);
            const deskPage = /^\/desk-settings\.html[. ]*\/?$/.test(pathname);
            const nativeApi = /^\/api\/presets(?:\/|$)/.test(pathname)
                || /^\/(?:config|aux|channels)[. ]*\/?$/.test(pathname);
            if (!adminApi && !adminPage && !deskPage && !nativeApi) {
                next();
                return;
            }
            res.set("Cache-Control", "no-store");
            if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
                const origin = req.get("Origin");
                if ((origin && origin !== `${req.protocol}://${req.get("Host")}`) || req.get("Sec-Fetch-Site") === "cross-site") {
                    res.status(403).json({ error: "Admin requests must come from this site." });
                    return;
                }
                // The native /admin settings form uses URL-encoded data.
                if (adminApi && !req.is("application/json")) {
                    res.status(415).json({ error: "Send admin requests as JSON." });
                    return;
                }
            }
            if (adminApi && pathname === "/api/admin/login" && req.method === "POST") {
                next();
                return;
            }
            if (!authenticated(req)) {
                if (adminApi || nativeApi)
                    res.status(401).json({ error: "Enter the admin password to continue." });
                else
                    res.redirect("/admin-login.html");
                return;
            }
            // Serve the page explicitly so encoded paths and /admin aliases share the guard.
            if (adminPage && ["GET", "HEAD"].includes(req.method)) {
                if (pathname !== "/admin.html") {
                    res.redirect("/admin.html");
                    return;
                }
                res.sendFile(path.join(__dirname, "..", "web", "admin.html"));
                return;
            }
            if (deskPage && ["GET", "HEAD"].includes(req.method)) {
                res.redirect("/admin.html#desk-settings");
                return;
            }
            next();
        });
        app.get("/admin-login.html", (req, res) => {
            res.set("Cache-Control", "no-store");
            if (authenticated(req)) {
                res.redirect("/admin.html");
                return;
            }
            res.sendFile(path.join(__dirname, "..", "web", "admin-login.html"));
        });
        app.post("/api/admin/login", async (req, res) => {
            const record = passwordRecord;
            if (!record) {
                res.json({ ok: true });
                return;
            }
            if (!allowAttempt(req, res))
                return;
            try {
                if (!await matches(req.body?.password, record) || record !== passwordRecord) {
                    res.status(401).json({ error: "Incorrect admin password." });
                    return;
                }
                setSession(req, res);
                res.json({ ok: true });
            }
            catch (error) {
                console.error("Admin login failed", error);
                res.status(500).json({ error: "Could not sign in. Please try again." });
            }
        });
        app.post("/api/admin/logout", (req, res) => {
            clearSession(req, res);
            res.json({ ok: true });
        });
        async function updatePassword(req, res, remove) {
            const update = async () => {
                // Recheck after queued writes: enabling/changing a password invalidates old access.
                if (!authenticated(req)) {
                    res.status(401).json({ error: "Enter the admin password to continue." });
                    return;
                }
                if (passwordRecord) {
                    if (!allowAttempt(req, res))
                        return;
                    if (!await matches(req.body?.currentPassword, passwordRecord)) {
                        res.status(400).json({ error: "Current password is incorrect." });
                        return;
                    }
                }
                const password = req.body?.password;
                if (!remove && (typeof password !== "string" || password.length < 8 || password.length > 256 || !password.trim())) {
                    res.status(400).json({ error: "Use a password between 8 and 256 characters." });
                    return;
                }
                if (remove && !passwordRecord) {
                    res.json({ enabled: false });
                    return;
                }
                const salt = randomBytes(16);
                const record = remove ? null : {
                    version: 1, salt: salt.toString("hex"),
                    hash: (await deriveKey(password, salt, 64)).toString("hex"),
                };
                await persist(record);
                passwordRecord = record;
                sessions.clear();
                if (record)
                    setSession(req, res);
                else
                    clearSession(req, res);
                res.json({ enabled: !!record });
            };
            const result = writes.then(update);
            writes = result.catch(() => { });
            try {
                await result;
            }
            catch (error) {
                console.error("Admin password save failed", error);
                res.status(500).json({ error: "Could not save the admin password. The previous setting is unchanged." });
            }
        }
        app.put("/api/admin/password", (req, res) => { void updatePassword(req, res, false); });
        app.delete("/api/admin/password", (req, res) => { void updatePassword(req, res, true); });
    }
    return { register, isEnabled: () => passwordRecord !== null };
}
module.exports = { createAdminAuth };
