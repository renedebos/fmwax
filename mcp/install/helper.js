#!/usr/bin/env node
// THE HOME HELPER'S INSTALL (MC-31 stage 5, 2026-10-19; Codex reviewed the
// plan the same night). The house's setup page gives the command; run from
// the downloaded code's mcp folder, on a computer at home on the WiiMs'
// Wi-Fi:
//
//   node install/helper.js --house https://<your house> --pair <code>   set it up, or update it
//   node install/helper.js --remove                        take it away again
//   --pair <code>  the setup page's code for the key (2026-10-21), good for an
//                  hour; without one, it asks for the key itself
//   --no-service   set it up but start nothing (the installer's check)
//   --replace      over a helper this command did not make, or another house's
//
// It asks for the helper's key (never on the command line, which a shell
// keeps), checks it with the house, finds the WiiMs and matches them to the
// names the house uses (asking where it cannot tell), copies the helper to a
// folder of its own, starts it at sign-in, and waits until the house sees
// the line and the WiiMs read. It works while the computer is awake.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { working } from "./working.js";
import { SERVICE_NAME, helperPaths, launchdPlist, manifestOf, systemdUnit, windowsAppsEntry, windowsLauncher } from "./helper-service.js";
import { findWiims, houseUrlOk, matchWiims, searchPlan, statusEx } from "../../helper/fmwax-helper.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OS = platform();
const P = helperPaths({ os: OS, home: homedir(), env: process.env });
const say = (...l) => console.log(...l);
function fail(why, code = 1) { console.error(`\n${why}\n`); process.exit(code); }
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}
const flag = (name) => process.argv.includes(`--${name}`);
const TTY = !!process.stdin.isTTY;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

// ---- Stopping and starting it, per system ----
// Windows: the processes whose own line names one of these, never another
// program's node, and never this PowerShell, whose own line names them too.
function endWindows(likes) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ` +
    `(${likes.map((l) => `$_.CommandLine -like '*${l.replace(/'/g, "''")}*'`).join(" -or ")}) } | ` +
    `ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }`;
  run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
}
function stopService(service) {
  if (service.kind === "linux") run("systemctl", ["--user", "disable", "--now", `${SERVICE_NAME}.service`]);
  else if (service.kind === "mac") run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`]);
  // The hidden start's loop first, then the helper it started.
  else if (service.kind === "windows") endWindows([`${SERVICE_NAME}.vbs`, P.script]);
}
// THE HELPER TAKING ITSELF AWAY (the setup page's Remove, 2026-10-21): never
// started again, but not yet stopped, since stopping it ends this very
// process; that is its last step (stopLast), after its files are gone.
function unhookService(service) {
  if (service.kind === "linux") run("systemctl", ["--user", "disable", `${SERVICE_NAME}.service`]);
  else if (service.kind === "windows") endWindows([`${SERVICE_NAME}.vbs`]);
}
function stopLast(service) {
  if (service.kind === "linux") run("systemctl", ["--user", "stop", `${SERVICE_NAME}.service`]);
  else if (service.kind === "mac") run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`]);
}
function startService(service) {
  if (service.kind === "linux") {
    run("systemctl", ["--user", "daemon-reload"]);
    const r = run("systemctl", ["--user", "enable", "--now", `${SERVICE_NAME}.service`]);
    if (r.status !== 0) return { ok: false, why: (r.stderr || r.stdout).trim().slice(0, 300) };
    run("systemctl", ["--user", "restart", `${SERVICE_NAME}.service`]);
    // From boot, not only from sign-in: linger, which may need the owner's word.
    const user = userInfo().username;
    const linger = run("loginctl", ["show-user", user, "--property=Linger"]).stdout.includes("Linger=yes")
      || run("loginctl", ["enable-linger", user]).status === 0;
    return { ok: true, note: linger ? "It runs from when the computer starts." :
      `It runs while you are signed in. To have it run from when the computer starts, type: sudo loginctl enable-linger ${user}` };
  }
  if (service.kind === "mac") {
    run("launchctl", ["bootout", `gui/${process.getuid()}/${service.label}`]);
    const r = run("launchctl", ["bootstrap", `gui/${process.getuid()}`, service.file]);
    return r.status === 0 ? { ok: true, note: "It starts when you sign in to this Mac, and works while it is awake." }
      : { ok: false, why: (r.stderr || r.stdout).trim().slice(0, 300) };
  }
  const child = spawn("wscript.exe", [service.file], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => { /* said below, by the check that waits for it */ });
  child.unref();
  return { ok: true, note: "It starts when you sign in to Windows, and works while the computer is awake." };
}

// ---- --remove: only what this command made ----
// --self: the running helper, asked by the setup page's Remove, taking itself
// away in its own process. --pause: Windows' Settings, Apps, Uninstall, whose
// window waits for Enter so it can be read.
async function closing() {
  if (flag("pause") && TTY) {
    const r = createInterface({ input: process.stdin, output: process.stdout });
    await r.question("Press Enter to close this window.");
    r.close();
  }
  process.exit(0);
}
if (flag("remove")) {
  const SELF = flag("self");
  const m = readJson(P.manifest);
  if (!m) { say("No home helper made by this command is on this computer: nothing removed."); await closing(); }
  // Its key, read before its settings go, so it can tell the house.
  let secret = "";
  try { secret = (readFileSync(P.envFile, "utf8").match(/^HELPER_SECRET=(.+)$/m)?.[1] ?? "").trim(); } catch { /* none kept */ }
  if (SELF) unhookService(m.service); else stopService(m.service);
  for (const f of m.made ?? []) { try { rmSync(f, { force: true }); } catch { /* gone */ } }
  if (m.envBackup && existsSync(m.envBackup)) { copyFileSync(m.envBackup, P.envFile); rmSync(m.envBackup, { force: true }); }
  if (m.registry) run("reg", ["delete", m.registry, "/f"]);
  if (m.service?.kind === "linux") run("systemctl", ["--user", "daemon-reload"]);
  try { rmSync(P.app, { recursive: true, force: true }); } catch { /* the computer's to clear */ }
  // The house forgets what it last read (2026-10-21), so its pages stop
  // waiting on a helper that is gone. Its silence changes nothing here.
  if (secret && houseUrlOk(String(m.house ?? ""))) {
    await fetch(`${m.house}/helper/forget`, { method: "POST", headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000) }).catch(() => null);
  }
  say(`The home helper for ${m.house} is stopped and removed from this computer.`);
  if (!(m.made ?? []).includes(P.known) && existsSync(P.known)) say(`(${P.known} was there before it, and stays.)`);
  if (SELF) { stopLast(m.service); process.exit(0); }
  await closing();
}

// ---- Install, or update ----
const house = String(arg("house") ?? "").replace(/\/+$/, "");
if (!houseUrlOk(house)) fail("Give the house's address: node install/helper.js --house https://<your house>\n(The setup page's Home helper step shows the whole line.)");
const NO_SERVICE = flag("no-service"), REPLACE = flag("replace");
let rl = null;
const ask = async (q) => { rl ??= createInterface({ input: process.stdin, output: process.stdout }); return (await rl.question(q)).trim(); };

// The key, pasted, shown as a dot a character and then its ends, so a paste
// is seen to land and the key is never on the screen or in the shell's history.
function askKey() {
  if (!TTY) return new Promise((resolve) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (d) => { s += d; }); process.stdin.on("end", () => resolve(s.split(/\r?\n/)[0].trim())); });
  return new Promise((resolve) => {
    process.stdout.write(`   Paste the helper key from the setup page${OS === "win32" ? " (right-click to paste)" : ""}, then press Return: `);
    const stdin = process.stdin;
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write("\n"); resolve(value.replace(/\[20[01]~/g, "").trim()); return; }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        if (ch >= " ") { value += ch; process.stdout.write("•"); }
      }
    };
    stdin.setRawMode(true); stdin.setEncoding("utf8"); stdin.resume(); stdin.on("data", onData);
  });
}

// Never over a helper this command did not make, nor another house's, unless
// asked (Codex, 2026-10-19: the owner's Chromebook); told before anything is asked.
const before = readJson(P.manifest);
const handMade = [...P.handMade, P.service.file].filter((f) => existsSync(f) && !(before?.made ?? []).includes(f));
const strangeEnv = existsSync(P.envFile) && !before;
if (before && before.house !== house && !REPLACE) {
  fail(`This computer's helper serves ${before.house}. Nothing was changed. To make it serve ${house} instead, run the command again with --replace.`, 3);
}
if (!before && (handMade.length || strangeEnv) && !REPLACE) {
  fail(`A home helper is already set up on this computer, not by this command:\n${[...handMade, ...(strangeEnv ? [P.envFile] : [])].map((f) => `  ${f}`).join("\n")}\nNothing was changed. To set this one up instead, run the command again with --replace.`, 3);
}

// THE KEY BY CODE (the first Windows laptop, 2026-10-21: the page's two
// Copy buttons, and a prompt Ctrl+V never filled): the setup page's command
// carries a pairing code, good for an hour, and the house gives the key for
// it. A house without the door (an older one) leaves it to the prompt.
async function pairedKey(code) {
  const stop = working("Asking the house for the helper's key");
  let r = null;
  try {
    r = await fetch(`${house}/helper/pair`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }), signal: AbortSignal.timeout(15_000) });
  } catch { r = null; }
  stop();
  const said = r ? await r.json().catch(() => null) : null;
  if (said?.ok && typeof said.key === "string") return said.key;
  if (said?.code === "expired") fail("This command's code has run out: it works for an hour. Open the setup page's Home helper step again and copy the command from there.");
  if (said?.code === "used") fail("This command's code has been used already: each one works once. Open the setup page's Home helper step again and copy the command from there.");
  if (said?.code === "bad") fail("This command's code is not this house's. Copy the command again from the setup page's Home helper step.");
  if (!r) fail(`The house did not answer at ${house}. Is this computer online? Try again in a minute.`);
  say("   This house does not give the key by code yet: paste it instead (the setup page's Home helper step, If it asks for a key).");
  return null;
}

say(`The home helper, for ${house}`);
say("1. The house");
const PAIR = arg("pair");
const key = (PAIR ? await pairedKey(PAIR) : null) ?? await askKey();
if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) fail("That is not the helper key: it is one long word of letters, digits, - and _. Copy it again from the setup page.");
say(`   Key: ${key.slice(0, 4)}…${key.slice(-4)} (${key.length} characters)`);
const auth = { authorization: `Bearer ${key}` };
let said = null;
{
  const stop = working("Asking the house");
  try {
    const r = await fetch(`${house}/helper/speakers`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    stop();
    if (r.status === 404) fail("The house did not take that key, or that is not the house's address. Copy both again from the setup page's Home helper step.");
    if (!r.ok) fail(`The house answered ${r.status}. Try again in a minute.`);
    said = await r.json();
  } catch (e) { stop(); fail(`Could not reach ${house}: ${String(e?.message ?? e)}`); }
}
say(`   It answers, and names ${said.names?.length ? said.names.join(", ") : "no WiiM yet"}.`);

// 2. The WiiMs: the house's, or found here and matched.
say("2. The WiiMs");
let speakers = said.speakers ?? {};
if (Object.keys(speakers).length) {
  say(`   The house knows where they are: ${Object.entries(speakers).map(([n, ip]) => `${n} (${ip})`).join(", ")}.`);
} else if (!said.learns) {
  fail("The house names no WiiM addresses and does not learn them, so there is nothing for a helper to read.");
} else {
  const names = said.names ?? [];
  const plan = searchPlan(names);
  if (plan.guessed) say("   This computer's own network has no home address it can see (a Chromebook's Linux): trying the usual home networks, about 6 seconds each.");
  const look = async (nets, enough) => {
    let stop = () => {};
    const got = await findWiims(nets, undefined, { enough, onNet: (net) => { stop(); stop = working(`Asking ${net}.1 to ${net}.254`); } });
    stop();
    return got;
  };
  let found = await look(plan.nets, plan.enough);
  while (!found.length && TTY) {
    const typed = await ask("   No WiiM found. Type one WiiM's address (WiiM Home: the device, its settings, Device info), or press Return to stop: ");
    if (!typed) break;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(typed)) { say("   That is not an address like 192.168.1.40."); continue; }
    found = await look([typed.replace(/\.\d+$/, "")], () => false);
  }
  if (!found.length) fail("No WiiM was found on this computer's network. Is it on the same Wi-Fi as the WiiMs?");
  say(`   Found ${found.length}: ${found.map((f, i) => `${i + 1}. ${f.name} (${f.ip})`).join("  ")}`);
  // Matched by each WiiM's own name; where the house's name is another
  // (named at setup), asked (Codex, 2026-10-19).
  const m = matchWiims(names, found);
  speakers = m.speakers;
  for (const n of m.missing) {
    if (!TTY) break;
    const free = found.filter((f) => !Object.values(speakers).includes(f.ip));
    if (!free.length) break;
    for (;;) {
      const a = await ask(`   Which one is "${n}"? Type its number${free.length ? ` (${free.map((f) => found.indexOf(f) + 1).join(", ")})` : ""}, an address, or press Return to skip: `);
      if (!a) break;
      const byNumber = found[Number(a) - 1];
      if (/^\d+$/.test(a) && byNumber && !Object.values(speakers).includes(byNumber.ip)) { speakers[n] = byNumber.ip; break; }
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
        const st = await statusEx(a, 3000);
        if (st?.uuid) { speakers[n] = a; break; }
        say(`   No WiiM answers at ${a}.`); continue;
      }
      say("   Type one of the numbers, an address like 192.168.1.40, or press Return.");
    }
  }
  if (!Object.keys(speakers).length) fail(`None of the WiiMs found is one the house names (${names.join(", ")}).`);
  const r = await fetch(`${house}/helper/speakers`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ speakers }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const kept = r?.ok ? (await r.json())?.speakers : null;
  if (!kept) fail("The house would not keep the WiiMs just now. Run the command again.");
  speakers = kept;
  say(`   The house keeps: ${Object.entries(speakers).map(([n, ip]) => `${n} (${ip})`).join(", ")}.`);
  const left = names.filter((n) => !speakers[n]);
  if (left.length) say(`   Not matched, and not read: ${left.join(", ")}. Run the command again to match them.`);
}
rl?.close();

// 3. On this computer.
say("3. On this computer");
if (before) stopService(before.service);
if (REPLACE && handMade.some((f) => !f.endsWith(`${SERVICE_NAME}.service`) && !f.endsWith(".plist") && !f.endsWith(".vbs"))) {
  say("   The other helper's start file is left as it is: stop it yourself if both should not run.");
}
mkdirSync(P.config, { recursive: true, mode: 0o700 });
mkdirSync(dirname(P.script), { recursive: true });
mkdirSync(dirname(P.keymap), { recursive: true });
const made = [...(before?.made ?? [])];
let envBackup = before?.envBackup ?? null;
if (strangeEnv && !envBackup) { envBackup = `${P.envFile}.before-helper-install`; copyFileSync(P.envFile, envBackup); }
if (!existsSync(P.known) && !made.includes(P.known)) made.push(P.known);
writeFileSync(P.envFile, `HOUSE_URL=${house}\nHELPER_SECRET=${key}\n`, { mode: 0o600 });
if (!strangeEnv || !envBackup) made.push(P.envFile);
// The program, copied, so the downloaded folder can go; and this command
// beside it, so taking it away needs no download (the Mac test, 2026-10-19).
// Never copied onto itself, when run from the helper's own folder.
const remover = OS === "win32" ? `node "$env:LOCALAPPDATA\\fmwax-helper\\remove.mjs"` : "node ~/.fmwax-helper/remove.mjs";
if (resolve(REPO) !== resolve(P.app)) {
  mkdirSync(P.installer, { recursive: true });
  copyFileSync(join(REPO, "helper", "fmwax-helper.mjs"), P.script);
  copyFileSync(join(REPO, "mcp", "keymap.js"), P.keymap);
  for (const f of ["helper.js", "helper-service.js", "working.js"]) {
    copyFileSync(join(HERE, f), join(P.installer, f));
    made.push(join(P.installer, f));
  }
}
writeFileSync(P.remover, `// Takes the fmwax home helper away again, as install/helper.js --remove does.\n` +
  `process.argv.push("--remove");\nawait import("./mcp/install/helper.js");\n`);
made.push(P.script, P.keymap, P.remover);
say(`   The helper is in ${P.app}, its settings in ${P.envFile}.`);

// 4. Its start, at sign-in (and on Linux from boot, with linger).
const node = process.execPath;
let started = null;
if (!NO_SERVICE) {
  mkdirSync(dirname(P.service.file), { recursive: true });
  writeFileSync(P.service.file, P.service.kind === "linux" ? systemdUnit({ node, script: P.script })
    : P.service.kind === "mac" ? launchdPlist({ node, script: P.script, log: P.log })
    : windowsLauncher({ node, script: P.script, log: P.log }));
  made.push(P.service.file);
}
// On Windows, in Settings, Apps, for taking it away (2026-10-21).
let registry = before?.registry ?? null;
if (OS === "win32" && !NO_SERVICE) {
  const entry = windowsAppsEntry({ node, remover: P.remover, app: P.app });
  const added = entry.values.every(([name, type, data]) => run("reg", ["add", entry.key, "/v", name, "/t", type, "/d", data, "/f"]).status === 0);
  if (added) registry = entry.key;
  else say("   (It could not be listed in Settings, Apps. To take it away, use the command at the end.)");
}
writeFileSync(P.manifest, JSON.stringify(manifestOf({ house, made, service: P.service, envBackup, registry }), null, 2) + "\n");
if (NO_SERVICE) {
  say("4. Not started (--no-service). To run it by hand:");
  say(`   "${node}" "${P.script}"`);
  say(`To take it away again: ${remover}`);
  process.exit(0);
}
say("4. Starting it");
// The house's last reading before this one starts, so a fresh one is told by
// the house's own clock, never this computer's.
const lastRead = async () => {
  try {
    const r = await fetch(`${house}/helper/status`, { headers: auth, signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};
const baseAt = Number((await lastRead())?.read?.at) || 0;
started = startService(P.service);
if (!started.ok) fail(`It could not be started in the background:\n${started.why}\nTo run it by hand: "${node}" "${P.script}"`, 4);
say(`   Started. ${started.note}`);
if (OS === "darwin") say(`   Your Mac may now ask: Allow "node" to find devices on local networks? Click Allow.`);

// 5. Connected: the line, and each WiiM read freshly (Codex, 2026-10-19: a
// line is not a WiiM read).
say("5. Waiting for the house to see it (at most a minute)");
let st = null;
const isFresh = (s) => !!s?.read && Number(s.read.at) > baseAt;
{
  const stop = working("Asking the house");
  for (let i = 0; i < 30; i++) {
    st = await lastRead();
    if (st?.hands && isFresh(st) && Object.keys(speakers).every((n) => st.read.speakers?.[n] && st.read.speakers[n] !== "unreachable")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  stop();
}
const fresh = isFresh(st) ? st.read.speakers ?? {} : {};
say(`   The line to the house: ${st?.hands ? "open" : "not open yet"}`);
const silent = [];
for (const n of Object.keys(speakers)) {
  const s = fresh[n];
  if (s && s !== "unreachable") say(`   ${n}: read just now (${s})`);
  else { silent.push(n); say(`   ${n}: not answering`); }
}
if (silent.length && OS === "darwin") {
  say("\n   A Mac asks before a program may reach devices on the home network. Open System Settings,");
  say("   Privacy & Security, Local Network, and turn on node. It reads again within a minute.");
}
if (!st?.hands || silent.length) {
  say(`\n   The setup page's Home helper step ticks when it does. Its log: ${OS === "linux" ? `journalctl --user -u ${SERVICE_NAME}` : P.log}`);
} else {
  say("\nDone: the house sees the helper and its WiiMs. The setup page's Home helper step has ticked.");
}
say(`To take it away again: the setup page's Home helper step has a Remove button${registry ? "; or Settings, Apps, fmwax home helper, Uninstall" : ""}; or ${remover}`);
