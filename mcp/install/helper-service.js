// THE HOME HELPER'S PLACES ON A COMPUTER (MC-31 stage 5, 2026-10-19): where
// install/helper.js keeps the program, its settings and its background start
// on each system, and the text of each start file. Pure, so the tests can
// read them without installing anything.
//
// It starts when its person signs in and works while the computer is awake
// (Codex, 2026-10-19: never "starts by itself"). A Mac's LaunchAgent and
// Windows' Startup folder run at sign-in; a Linux box's systemd user service
// can run from boot with linger. Its names are its own, apart from the
// owner's hand-made `fmwax-helper.service`, which this command never touches.
import { join } from "node:path";

export const SERVICE_NAME = "fmwax-home-helper";
export const MAC_LABEL = "com.fmwax.home-helper";

export function helperPaths({ os = process.platform, home, env = {} }) {
  const windows = os === "win32", mac = os === "darwin";
  const config = join(home, ".config", "fmwax-helper");
  const app = windows ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "fmwax-helper") : join(home, ".fmwax-helper");
  const service = windows
    ? { kind: "windows", file: join(env.APPDATA || join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${SERVICE_NAME}.vbs`) }
    : mac
      ? { kind: "mac", file: join(home, "Library", "LaunchAgents", `${MAC_LABEL}.plist`), label: MAC_LABEL }
      : { kind: "linux", file: join(home, ".config", "systemd", "user", `${SERVICE_NAME}.service`), name: SERVICE_NAME };
  return {
    config, envFile: join(config, "env"), known: join(config, "speakers.json"),
    app, manifest: join(app, "installed.json"),
    script: join(app, "helper", "fmwax-helper.mjs"), keymap: join(app, "mcp", "keymap.js"),
    // The remover kept with the helper (the Mac test, 2026-10-19: --remove
    // needed the download, binned by then): `node <app>/remove.mjs`.
    installer: join(app, "mcp", "install"), remover: join(app, "remove.mjs"),
    log: mac ? join(home, "Library", "Logs", `${SERVICE_NAME}.log`) : join(app, "helper.log"),
    service,
    // The owner's hand-made helper (MC-25), and any start file of ours that
    // no record of this command's explains: never replaced unasked.
    handMade: windows || mac ? [] : [join(home, ".config", "systemd", "user", "fmwax-helper.service")],
  };
}

// Linux, a Pi, a Chromebook's Linux: a systemd user service.
export function systemdUnit({ node, script }) {
  return `[Unit]
Description=fmwax home helper: reads the WiiMs on this network for the house
After=network-online.target

[Service]
ExecStart="${node}" "${script}"
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
`;
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// A Mac: a LaunchAgent, run at sign-in and again whenever it stops.
export function launchdPlist({ node, script, log, label = MAC_LABEL }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(script)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

// Windows: a hidden start in the Startup folder (no admin rights), which
// starts the helper again 15 s after it stops, as systemd and launchd do. In
// a VBScript string a quote is written twice.
export function windowsLauncher({ node, script, log }) {
  const cmd = `"${node}" "${script}" --log "${log}"`;
  return `' fmwax home helper: started hidden at sign-in, and again 15 s after it stops.
Set sh = CreateObject("WScript.Shell")
Do
  sh.Run "${cmd.replace(/"/g, '""')}", 0, True
  WScript.Sleep 15000
Loop
`;
}

// WINDOWS' OWN LIST OF PROGRAMS (the owner, 2026-10-21): the helper in
// Settings, Apps, where a Windows person looks to take a program away. One
// key under the person's own part of the registry (no admin rights), whose
// Uninstall runs the remover kept with the helper and waits for Enter, so
// its window says what it did.
export const WINDOWS_APPS_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${SERVICE_NAME}`;
export function windowsAppsEntry({ node, remover, app }) {
  const uninstall = `"${node}" "${remover}" --pause`;
  return { key: WINDOWS_APPS_KEY, values: [
    ["DisplayName", "REG_SZ", "fmwax home helper"],
    ["Publisher", "REG_SZ", "fmwax"],
    ["DisplayIcon", "REG_SZ", node],
    ["InstallLocation", "REG_SZ", app],
    ["UninstallString", "REG_SZ", uninstall],
    ["QuietUninstallString", "REG_SZ", `"${node}" "${remover}"`],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
  ] };
}

// What the record of an install says this command made, for --remove: only
// what is listed goes.
export function manifestOf({ house, made, service, envBackup = null, registry = null, at = new Date().toISOString() }) {
  return { version: 1, house, at, made: [...new Set(made)], service, ...(envBackup ? { envBackup } : {}), ...(registry ? { registry } : {}) };
}
