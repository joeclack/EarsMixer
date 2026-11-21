"use strict";

// Builds the macOS menu bar app and dmg (dist/EarsMixer-<version>-macos.dmg).
// Run on a Mac with the Xcode command line tools: npm run installer:macos
// The app is universal (Apple silicon and Intel).
//
// Signing is controlled by environment variables:
//   MACOS_SIGN_IDENTITY  "Developer ID Application: …" (or its SHA-1 hash) to sign for
//                        distribution with the hardened runtime. "-" signs ad hoc with the
//                        hardened runtime, which checks the entitlements without a certificate.
//                        Unset: ad-hoc signature without the hardened runtime (local builds).
//   APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID
//                        App Store Connect API key (.p8 path, key ID, issuer ID). When set with a
//                        Developer ID identity, the dmg is notarised by Apple and the ticket stapled.
//   SPARKLE_PRIVATE_KEY_PATH
//                        Sparkle EdDSA private key file. When set, the build signs the dmg for Sparkle and
//                        writes dist/appcast.xml, which the release publishes for one-click updates.
//
// Sparkle (https://sparkle-project.org) is downloaded once into dist/sparkle-cache and checked
// against a pinned SHA-256. The app checks SPARKLE_FEED and only installs updates signed with the
// private key matching macos/sparkle-public-key.txt.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { productVersion } = require("../lib/product-info.js");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", "macos");
const app = path.join(out, "EarsMixer.app");
const contents = path.join(app, "Contents");

const serverEntitlements = path.join(root, "macos", "server.entitlements");
const crypto = require("node:crypto");

const SPARKLE_VERSION = "2.10.1";
const SPARKLE_SHA256 = "1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27";
const SPARKLE_FEED = "https://github.com/joeclack/EarsMixer/releases/latest/download/appcast.xml";
const RELEASES = "https://github.com/joeclack/EarsMixer/releases";
const sparklePublicKeyFile = path.join(root, "macos", "sparkle-public-key.txt");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status}).`);
}

/** Downloads and unpacks Sparkle once, verifying the archive. Returns its folder. */
function sparkleDirectory() {
    const directory = path.join(root, "dist", "sparkle-cache", SPARKLE_VERSION);
    if (fs.existsSync(path.join(directory, "Sparkle.framework"))) return directory;
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    const archive = directory + ".tar.xz";
    if (!fs.existsSync(archive)) {
        run("curl", ["-fsSL", "--retry", "3", "-o", archive + ".part",
            `https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz`]);
        fs.renameSync(archive + ".part", archive);
    }
    const digest = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (digest !== SPARKLE_SHA256) {
        fs.rmSync(archive, { force: true });
        throw new Error(`Sparkle ${SPARKLE_VERSION} download did not match its checksum (got ${digest}).`);
    }
    const staging = directory + ".tmp";
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    run("tar", ["-xJf", archive, "-C", staging]);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.renameSync(staging, directory);
    return directory;
}

function sparklePublicKey() {
    if (!fs.existsSync(sparklePublicKeyFile)) return "";
    return fs.readFileSync(sparklePublicKeyFile, "utf8").split("\n").map(line => line.trim()).find(line => line && !line.startsWith("#")) || "";
}

function escapeXml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

/** The CHANGELOG section for this version as simple HTML for Sparkle's update window. */
function releaseNotesHtml(version) {
    const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split("\n");
    const start = changelog.findIndex(line => line.startsWith(`## ${version} `) || line === `## ${version}`);
    if (start < 0) return `<p>EarsMixer ${escapeXml(version)}</p>`;
    const items = [];
    for (const line of changelog.slice(start + 1)) {
        if (line.startsWith("## ")) break;
        if (!line.startsWith("- ")) continue;
        const html = escapeXml(line.slice(2))
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        items.push(`<li>${html}</li>`);
    }
    return items.length ? `<ul>${items.join("")}</ul>` : `<p>EarsMixer ${escapeXml(version)}</p>`;
}

/** Signs the dmg for Sparkle and writes dist/appcast.xml describing this release. */
function writeAppcast(dmg, version, sparkle, keyFile) {
    const result = spawnSync(path.join(sparkle, "bin", "sign_update"), ["--ed-key-file", keyFile, dmg], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error("sign_update failed: " + (result.stderr || result.stdout).trim());
    const signature = /sparkle:edSignature="([^"]+)"/.exec(result.stdout)?.[1];
    const length = /length="(\d+)"/.exec(result.stdout)?.[1];
    if (!signature || !length) throw new Error("sign_update gave no signature: " + result.stdout.trim());
    const url = `${RELEASES}/download/v${version}/${path.basename(dmg)}`;
    const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>EarsMixer</title>
    <link>${RELEASES}</link>
    <item>
      <title>EarsMixer ${escapeXml(version)}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <sparkle:version>${escapeXml(version)}</sparkle:version>
      <sparkle:shortVersionString>${escapeXml(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>${RELEASES}/tag/v${escapeXml(version)}</sparkle:fullReleaseNotesLink>
      <description><![CDATA[${releaseNotesHtml(version).replace(/]]>/g, "]]&gt;")}]]></description>
      <enclosure url="${escapeXml(url)}" length="${length}" type="application/octet-stream" sparkle:edSignature="${escapeXml(signature)}"/>
    </item>
  </channel>
</rss>
`;
    const feed = path.join(root, "dist", "appcast.xml");
    fs.writeFileSync(feed, appcast);
    // Sign the feed too (SURequireSignedFeed), so its release notes and links can't be altered.
    run(path.join(sparkle, "bin", "sign_update"), ["--ed-key-file", keyFile, feed]);
    console.log("Sparkle appcast: dist/appcast.xml");
}

/**
 * Installs the pinned dmgbuild (macos/dmg-requirements.txt) into dist/dmgbuild-venv
 * and returns its command. Reinstalls when the requirements change.
 */
function dmgbuildCommand() {
    const venv = path.join(root, "dist", "dmgbuild-venv");
    const requirements = path.join(root, "macos", "dmg-requirements.txt");
    const stamp = path.join(venv, "requirements.sha256");
    const wanted = crypto.createHash("sha256").update(fs.readFileSync(requirements)).digest("hex");
    const command = path.join(venv, "bin", "dmgbuild");
    if (fs.existsSync(command) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === wanted) return command;
    fs.rmSync(venv, { recursive: true, force: true });
    run("python3", ["-m", "venv", venv]);
    run(path.join(venv, "bin", "python3"), ["-m", "pip", "install", "--quiet", "--disable-pip-version-check",
        "--require-hashes", "--no-deps", "-r", requirements]);
    fs.writeFileSync(stamp, wanted);
    return command;
}

/**
 * Builds the disk image as an installer window: a background with an arrow and
 * "Drag EarsMixer onto the Applications folder", the app on the left and an
 * Applications shortcut on the right (macos/dmg-settings.py).
 */
function makeDmg(appPath, dmg) {
    const background = path.join(out, "dmg-background");
    fs.rmSync(background, { recursive: true, force: true });
    fs.mkdirSync(background, { recursive: true });
    const drawing = path.join(root, "macos", "dmg-background.swift");
    run("xcrun", ["swift", drawing, path.join(background, "background.png"), "1"]);
    run("xcrun", ["swift", drawing, path.join(background, "background@2x.png"), "2"]);
    // One TIFF with both resolutions, so the window is sharp on Retina screens.
    const tiff = path.join(background, "background.tiff");
    run("tiffutil", ["-cathidpicheck", path.join(background, "background.png"), path.join(background, "background@2x.png"), "-out", tiff]);

    // Size the image with room to spare: the server binaries are large and compress well.
    const used = spawnSync("du", ["-sk", appPath], { encoding: "utf8" });
    if (used.status !== 0) throw new Error("du failed.");
    const megabytes = Math.ceil(parseInt(used.stdout, 10) / 1024 * 1.3) + 64;
    fs.rmSync(dmg, { force: true });
    run(dmgbuildCommand(), ["-s", path.join(root, "macos", "dmg-settings.py"),
        "-D", `app=${appPath}`, "-D", `background=${tiff}`, "-D", `size=${megabytes}M`, "EarsMixer", dmg]);
}

function infoPlist(version, publicKey) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>EarsMixer</string>
    <key>CFBundleDisplayName</key><string>EarsMixer</string>
    <key>CFBundleIdentifier</key><string>com.joeclack.earsmixer.server</string>
    <key>CFBundleExecutable</key><string>EarsMixer</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${version}</string>
    <key>CFBundleVersion</key><string>${version}</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSUIElement</key><true/>
    <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
    <key>NSHumanReadableCopyright</key><string>MIT License</string>
    <key>NSLocalNetworkUsageDescription</key>
    <string>EarsMixer talks to your DiGiCo desk and to phones running the EarsMixer app on your local network.</string>
    <key>NSBonjourServices</key>
    <array><string>_earsmixer._tcp</string></array>
    <key>SUFeedURL</key><string>${SPARKLE_FEED}</string>
    <key>SUEnableAutomaticChecks</key><true/>
    <!-- Never install in the background: an update restarts the server and drops every mix. -->
    <key>SUAllowsAutomaticUpdates</key><false/>
    <key>SUAutomaticallyUpdate</key><false/>
    <!-- Signed feeds (SURequireSignedFeed) require verifying the download's EdDSA signature
         before it is unpacked; Sparkle refuses to start without both. -->
    <key>SURequireSignedFeed</key><true/>
    <key>SUVerifyUpdateBeforeExtraction</key><true/>${publicKey ? `
    <key>SUPublicEDKey</key><string>${publicKey}</string>` : ""}
</dict>
</plist>
`;
}

function buildIcon(resources) {
    const iconset = path.join(out, "AppIcon.iconset");
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset, { recursive: true });
    const source = path.join(root, "web", "images", "512.png");
    for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
            const pixels = Math.min(size * scale, 512);
            const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
            run("sips", ["-s", "format", "png", "-z", String(pixels), String(pixels), source,
                "--out", path.join(iconset, name)], { stdio: "ignore" });
        }
    }
    run("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "AppIcon.icns")]);
}

function main() {
    if (process.platform !== "darwin") throw new Error("Build the macOS app on a Mac.");
    const version = productVersion();
    fs.rmSync(out, { recursive: true, force: true });
    const macos = path.join(contents, "MacOS");
    const resources = path.join(contents, "Resources");
    const serverDir = path.join(resources, "server");
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });
    fs.rmSync(path.join(root, "dist", "appcast.xml"), { force: true });

    const signing = signingOptions();
    const publicKey = sparklePublicKey();
    if (signing.distribution && !publicKey) {
        throw new Error("macos/sparkle-public-key.txt has no Sparkle public key. Release builds need it so the app can verify updates (see README).");
    }
    const sparkle = sparkleDirectory();

    // Keep downloaded packaging runtimes with the ignored build outputs.
    process.env.PKG_CACHE_PATH ||= path.join(root, "dist", "pkg-cache");
    const esbuild = require.resolve("esbuild/bin/esbuild");
    // On macOS this is the native esbuild binary, not a Node script.
    run(esbuild, ["web/mixer.js", "--minify", "--outfile=web/mixer.min.js"]);
    run(esbuild, ["web/mixer.css", "--minify", "--outfile=web/mixer.min.css"]);

    // One server binary per architecture; the app starts the one that matches.
    const pkg = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
    for (const arch of ["arm64", "x64"]) {
        run(process.execPath, [pkg, "tools/macos-launcher.cjs", "--config", "package.json",
            "--targets", `node22-macos-${arch}`, "--output", path.join(serverDir, `earsmixer-${arch}`)]);
    }

    // Universal menu bar app.
    const sourceDirectory = path.join(root, "macos", "Sources");
    const sources = fs.readdirSync(sourceDirectory).filter(name => name.endsWith(".swift")).sort()
        .map(name => path.join(sourceDirectory, name));
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
        const slice = path.join(out, `EarsMixer-${arch}`);
        run("xcrun", ["swiftc", "-O", "-parse-as-library", "-target", `${arch}-apple-macos13.0`,
            "-F", sparkle, "-framework", "Sparkle", "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
            ...sources, "-o", slice]);
        slices.push(slice);
    }
    run("lipo", ["-create", ...slices, "-output", path.join(macos, "EarsMixer")]);

    // Embed Sparkle. Its XPC services are only for sandboxed apps, so they are left out.
    const frameworks = path.join(contents, "Frameworks");
    const framework = path.join(frameworks, "Sparkle.framework");
    fs.mkdirSync(frameworks, { recursive: true });
    run("ditto", [path.join(sparkle, "Sparkle.framework"), framework]);
    fs.rmSync(path.join(framework, "XPCServices"), { force: true });
    fs.rmSync(path.join(framework, "Versions", "B", "XPCServices"), { recursive: true, force: true });

    fs.writeFileSync(path.join(contents, "Info.plist"), infoPlist(version, publicKey));
    buildIcon(resources);
    fs.copyFileSync(path.join(root, "LICENSE"), path.join(resources, "LICENSE"));

    // Sign from the inside out: server binaries, Sparkle's helpers and framework, then the app.
    for (const arch of ["arm64", "x64"]) {
        run("codesign", [...signing.flags, ...signing.entitlements(serverEntitlements), path.join(serverDir, `earsmixer-${arch}`)]);
    }
    for (const part of ["Versions/B/Autoupdate", "Versions/B/Updater.app", ""]) {
        run("codesign", [...signing.appFlags, path.join(framework, part)]);
    }
    run("codesign", [...signing.appFlags, app]);
    run("codesign", ["--verify", "--strict", "--deep", "--verbose=2", app]);

    const dmg = path.join(root, "dist", `EarsMixer-${version}-macos.dmg`);
    makeDmg(app, dmg);

    if (signing.distribution) {
        run("codesign", ["--force", "--timestamp", "--sign", signing.identity, dmg]);
        notarise(dmg);
        // Sign the final, stapled dmg: Sparkle checks the exact bytes it downloads.
        if (process.env.SPARKLE_PRIVATE_KEY_PATH) writeAppcast(dmg, version, sparkle, process.env.SPARKLE_PRIVATE_KEY_PATH);
        else console.log("SPARKLE_PRIVATE_KEY_PATH not set: no appcast, so installed apps won't be offered this update.");
    }
    console.log(`macOS app: ${dmg}`);
}

// Developer ID builds use the hardened runtime and a secure timestamp, both required
// for notarisation. Ad-hoc builds can't be timestamped.
function signingOptions(env = process.env) {
    const identity = (env.MACOS_SIGN_IDENTITY || "").trim();
    if (!identity) {
        console.log("MACOS_SIGN_IDENTITY not set: ad-hoc signing without the hardened runtime. macOS will warn when the app is opened.");
        const plain = ["--force", "--sign", "-"];
        return { identity: "-", distribution: false, flags: plain, appFlags: plain, entitlements: () => [] };
    }
    const distribution = identity !== "-";
    const flags = ["--force", "--options", "runtime", ...(distribution ? ["--timestamp"] : []), "--sign", identity];
    return {
        identity,
        distribution,
        // Server binaries: hardened runtime with their entitlements.
        flags,
        // The app and Sparkle. Under the hardened runtime, library validation only loads a
        // framework signed by the same team, and ad-hoc signatures have no team, so ad-hoc
        // builds sign these without it. Developer ID builds share a team and keep it.
        appFlags: distribution ? flags : ["--force", "--sign", "-"],
        entitlements: file => ["--entitlements", file],
    };
}

// Submits the signed dmg to Apple's notary service, waits for the result and staples
// the ticket so Gatekeeper accepts it offline.
function notarise(dmg, env = process.env) {
    const key = env.APPLE_API_KEY_PATH, keyId = env.APPLE_API_KEY_ID, issuer = env.APPLE_API_ISSUER_ID;
    if (!key || !keyId || !issuer) {
        console.log("APPLE_API_KEY_PATH, APPLE_API_KEY_ID or APPLE_API_ISSUER_ID not set: signed but not notarised.");
        return;
    }
    run("xcrun", ["notarytool", "submit", dmg, "--key", key, "--key-id", keyId, "--issuer", issuer, "--wait", "--timeout", "30m"]);
    run("xcrun", ["stapler", "staple", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
    run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]);
}

module.exports = { signingOptions, releaseNotesHtml, sparklePublicKey, sparkleDirectory, writeAppcast, infoPlist, makeDmg };

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
