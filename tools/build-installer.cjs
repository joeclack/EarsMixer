"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status}).`);
}

async function main() {
    if (process.platform !== "win32") throw new Error("Build the Inno Setup installer on Windows.");
    const candidates = [
        process.env.ISCC_PATH,
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Inno Setup 6", "ISCC.exe"),
    ];
    const compiler = candidates.find(candidate => candidate && fs.existsSync(candidate)) || "ISCC.exe";
    const probe = spawnSync(compiler, ["/?"], { stdio: "ignore" });
    if (probe.error) throw new Error("Install Inno Setup 6, put ISCC.exe on PATH, or set ISCC_PATH to its full path.");
    fs.mkdirSync(path.join(root, "dist", "windows"), { recursive: true });
    // Keep downloaded packaging runtimes with the ignored build outputs.
    process.env.PKG_CACHE_PATH ||= path.join(root, "dist", "pkg-cache");
    await require("./build-windows-support.cjs").buildWindowsSupport();
    const esbuild = require.resolve("esbuild/bin/esbuild");
    run(process.execPath, [esbuild, "web/mixer.js", "--minify", "--outfile=web/mixer.min.js"]);
    run(process.execPath, [esbuild, "web/mixer.css", "--minify", "--outfile=web/mixer.min.css"]);
    run(process.execPath, [require.resolve("@yao-pkg/pkg/lib-es5/bin.js"),
        "tools/windows-launcher.cjs", "--config", "package.json", "--targets", "node22-win-x64",
        "--output", "dist/windows/EarsMixer.exe"]);
    // Both CLI and editor builds use the metadata in installer/version.inc.iss.
    run(compiler, [path.join(root, "installer", "EarsMixer.iss")]);
    console.log(`Installer output directory: ${path.join(root, "dist")}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
