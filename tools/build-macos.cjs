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

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { productVersion } = require("../lib/product-info.js");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", "macos");
const app = path.join(out, "EarsMixer.app");
const contents = path.join(app, "Contents");

const serverEntitlements = path.join(root, "macos", "server.entitlements");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status}).`);
}

function infoPlist(version) {
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
            ...sources, "-o", slice]);
        slices.push(slice);
    }
    run("lipo", ["-create", ...slices, "-output", path.join(macos, "EarsMixer")]);

    fs.writeFileSync(path.join(contents, "Info.plist"), infoPlist(version));
    buildIcon(resources);
    fs.copyFileSync(path.join(root, "LICENSE"), path.join(resources, "LICENSE"));

    // Sign the nested server binaries first, then the app that contains them.
    const signing = signingOptions();
    for (const arch of ["arm64", "x64"]) {
        run("codesign", [...signing.flags, ...signing.entitlements(serverEntitlements), path.join(serverDir, `earsmixer-${arch}`)]);
    }
    run("codesign", [...signing.flags, app]);
    run("codesign", ["--verify", "--strict", "--deep", "--verbose=2", app]);

    const staging = path.join(out, "dmg");
    fs.mkdirSync(staging, { recursive: true });
    run("ditto", [app, path.join(staging, "EarsMixer.app")]);
    fs.symlinkSync("/Applications", path.join(staging, "Applications"));
    const dmg = path.join(root, "dist", `EarsMixer-${version}-macos.dmg`);
    fs.rmSync(dmg, { force: true });
    // hdiutil sizes the image itself and runs out of space on the large server binaries, so give it room.
    const used = spawnSync("du", ["-sk", staging], { encoding: "utf8" });
    if (used.status !== 0) throw new Error("du failed.");
    const megabytes = Math.ceil(parseInt(used.stdout, 10) / 1024 * 1.3) + 64;
    run("hdiutil", ["create", "-volname", "EarsMixer", "-srcfolder", staging, "-ov", "-format", "UDZO",
        "-fs", "HFS+", "-megabytes", String(megabytes), dmg]);

    if (signing.distribution) {
        run("codesign", ["--force", "--timestamp", "--sign", signing.identity, dmg]);
        notarise(dmg);
    }
    console.log(`macOS app: ${dmg}`);
}

// Developer ID builds use the hardened runtime and a secure timestamp, both required
// for notarisation. Ad-hoc builds can't be timestamped.
function signingOptions(env = process.env) {
    const identity = (env.MACOS_SIGN_IDENTITY || "").trim();
    if (!identity) {
        console.log("MACOS_SIGN_IDENTITY not set: ad-hoc signing without the hardened runtime. macOS will warn when the app is opened.");
        return { identity: "-", distribution: false, flags: ["--force", "--sign", "-"], entitlements: () => [] };
    }
    const distribution = identity !== "-";
    return {
        identity,
        distribution,
        flags: ["--force", "--options", "runtime", ...(distribution ? ["--timestamp"] : []), "--sign", identity],
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

module.exports = { signingOptions };

if (require.main === module) {
    try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
