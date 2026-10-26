#!/usr/bin/env node
// THE TERMINAL DOOR (MC-31 stage 6, door 2; the owner chose it for the trial,
// 2026-10-17). One command puts a blank house on a Cloudflare account and
// opens its setup page, where everything else is done:
//
//   node install/door.js [--name fmwax-house] [--account <id>] [--no-open] [--new-key]
//
// It signs in to Cloudflare if wrangler is not signed in, finds or makes the
// house's two stores, renders a blank config (config.js renderBlankHouse:
// none of the owner's house), deploys, keeps a one-use setup key as the
// house's one secret, waits for the house to answer, and opens
// <address>/setup#<key>. Run again, it finds the same house and updates its
// code, keeping everything the setup page chose: the config is rendered anew
// each time, so an update that adds a binding or a migration arrives too.
// --new-key makes a new setup key, the way back for an owner who has lost the
// recovery code and every signed-in browser: the house can be claimed again.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { MCP, renderBlankHouse } from "./config.js";
import { working } from "./working.js";

const WRANGLER = "wrangler@4.129.1";
// The app's own date, the one the owner's house runs on (a property of the
// code, not of a house).
const COMPATIBILITY_DATE = "2025-06-01";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const NAME = arg("name", "fmwax-house");
const ACCOUNT = arg("account", process.env.CLOUDFLARE_ACCOUNT_ID ?? null);
// The account the house goes on: given, or chosen below.
let accountId = ACCOUNT;
const OPEN = !process.argv.includes("--no-open");
const NEW_KEY = process.argv.includes("--new-key");
const say = (...l) => console.log(...l);
function fail(why) { console.error(`\n${why}\n`); process.exit(1); }

if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(NAME)) {
  fail(`"${NAME}" cannot be a Worker's name: lower-case letters, digits and dashes, starting and ending with a letter or digit.`);
}

// wrangler, on the chosen account. `cwd` matters: inside mcp/ wrangler reads
// the owner's wrangler.toml, so anything that must not see it runs from an
// empty folder.
const EMPTY = mkdtempSync(join(tmpdir(), "fmwax-door-"));
// ON WINDOWS (2026-10-19, so a Windows household needs no WSL): npx is a
// .cmd script, which Node starts only through the shell, cmd.exe; there an
// argument with a space (a folder such as "C:\Users\Jane Doe") is quoted.
// The line is made whole here and handed over as one string: Node 24 warns
// of "security vulnerabilities" when a list of arguments goes to a shell, and
// on the first Windows laptop (2026-10-21) that warning landed on the
// download's seconds count and stopped it at "0 s".
// The installer's check runs this on Windows, macOS and Linux
// (dev/door-check.mjs, .github/workflows/install-check.yml).
const WINDOWS = platform() === "win32";
const shellArg = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
// `heard` sees everything said so far, each time more comes (the sign-in).
function wrangler(args, { cwd = EMPTY, input = undefined, busy = null, heard = null } = {}) {
  const env = { ...process.env, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) };
  const all = ["--yes", WRANGLER, ...args];
  return new Promise((resolve) => {
    const child = WINDOWS
      ? spawn(["npx.cmd", ...all].map(shellArg).join(" "), { cwd, env, shell: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn("npx", all, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => { stdout += d; heard?.(`${stdout}${stderr}`); });
    child.stderr.setEncoding("utf8").on("data", (d) => { stderr += d; heard?.(`${stdout}${stderr}`); });
    child.stdin.end(input ?? "");
    const stop = working(busy);
    // What a command answers is on stdout; a warning on stderr (an update
    // notice, say) must not spoil it (Codex, 2026-10-17).
    const done = (ok) => { stop(); resolve({ ok, stdout, out: `${stdout}${stderr}` }); };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

// 1. Signed in to Cloudflare, on one account.
say("1. Cloudflare");
// Measured 2026-10-19: wrangler's first download is about 400 MB (17 s on the
// owner's line; minutes on a slow one), with nothing on the screen before.
say("   Getting wrangler, Cloudflare's own tool. The first time it downloads about 400 MB: a minute or two,");
say("   longer on an older computer.");
let who = await wrangler(["whoami"], { busy: "Getting it, then asking Cloudflare who you are" });
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) {
  say("   Next, signing in to Cloudflare in your browser. Its page can take a minute to open on an older computer.");
  if (!(await signIn())) fail("Signing in to Cloudflare did not finish. Run the command again.");
  say("   Signed in.");
  who = await wrangler(["whoami"], { busy: "Asking Cloudflare who you are" });
}
// SIGNING IN, SEEN (the first Windows laptop, 2026-10-21: about a minute with
// nothing moving before Cloudflare's page opened, then wrangler's link filling
// half the screen). Wrangler's own words are kept back: a count until the page
// opens, then what to do there and a count while it waits; its link only if
// no page came, or none opened after a minute.
async function signIn() {
  let stop = working("Opening the Cloudflare page"), link = null, later = null;
  const waiting = () => { stop = working("Waiting for you to finish in the browser"); };
  const r = await wrangler(["login"], { heard: (said) => {
    if (link) return;
    const m = said.match(/(?:Opening a link in your default browser|Visit this link to authenticate): (\S+)/);
    if (!m) return;
    link = m[1];
    stop();
    if (/Failed to open a browser/i.test(said)) {
      say(`   No browser opened. Open this link in one, on this computer:\n   ${link}`);
    } else {
      say("   The Cloudflare page is open in your browser. Sign in, tick the account the house goes on,");
      say("   then Review permissions and Allow. This window carries on by itself.");
      later = setTimeout(() => {
        stop();
        say(`   No Cloudflare page? Open this link in your browser:\n   ${link}`);
        waiting();
      }, 60_000);
    }
    waiting();
  } });
  clearTimeout(later);
  stop();
  return r.ok;
}
// One row at a time: never a match that runs on from the row before.
const accounts = [...who.out.matchAll(/│[ \t]*([^│\r\n]+?)[ \t]*│[ \t]*([0-9a-f]{32})[ \t]*│/g)].map((m) => ({ name: m[1], id: m[2] }));
// MORE THAN ONE ACCOUNT: asked by number in a terminal (the owner's second
// run, 2026-10-17: "add --account … to the end" lost its space and failed).
// Without a terminal to ask in, the whole command for each, to copy.
if (!accountId && accounts.length > 1) {
  if (!process.stdin.isTTY) {
    fail(`This Cloudflare login reaches ${accounts.length} accounts. Run the command for the one the house goes on:\n` +
      accounts.map((a) => `  node install/door.js --account ${a.id}   (${a.name})`).join("\n"));
  }
  say(`   This Cloudflare login reaches ${accounts.length} accounts:`);
  accounts.forEach((a, i) => say(`     ${i + 1}. ${a.name}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`   Which one does the house go on? Type 1 to ${accounts.length}, then Enter: `)).trim();
  rl.close();
  const pick = accounts[Number(answer) - 1];
  if (!/^\d+$/.test(answer) || !pick) fail(`"${answer}" is not one of the numbers. Run the command again.`);
  accountId = pick.id;
}
const account = accountId ?? accounts[0]?.id;
accountId = account;
if (!account) fail("Could not tell which Cloudflare account to use. Run the command again with --account <the account's id>.");
say(`   Account: ${accounts.find((a) => a.id === account)?.name ?? account}`);

// 2. The house's two stores, found by their names or made.
say("2. Storage");
async function namespaces() {
  const r = await wrangler(["kv", "namespace", "list"], { busy: "Looking at the account's storage" });
  if (!r.ok) fail(`Could not list the account's storage:\n${r.out.slice(0, 400)}`);
  try { return JSON.parse(r.stdout.slice(r.stdout.indexOf("["))); } catch { fail("Could not read the account's storage list."); }
}
let list = await namespaces();
for (const b of ["TOKENS", "PROGRAMS"]) {
  if (!list.some((n) => n.title === `${NAME}-${b}`)) {
    const r = await wrangler(["kv", "namespace", "create", `${NAME}-${b}`], { busy: `Making ${NAME}-${b}` });
    if (!r.ok) fail(`Could not make the store ${NAME}-${b}:\n${r.out.slice(0, 400)}`);
    say(`   Made ${NAME}-${b}`);
  } else say(`   Found ${NAME}-${b}`);
}
list = await namespaces();
const idOf = (b) => list.find((n) => n.title === `${NAME}-${b}`)?.id;
const tokensId = idOf("TOKENS"), programsId = idOf("PROGRAMS");
if (!tokensId || !programsId) fail("The house's stores were made but cannot be found. Run the command again.");

// 3. The setup key: the house's one secret, kept on this computer too, per
// account and name (Codex, 2026-10-17: the same name on two accounts shared
// one key and one address).
const keep = join(homedir(), ".config", "fmwax-house", account, NAME);
mkdirSync(keep, { recursive: true, mode: 0o700 });
const keyFile = join(keep, "setup-key");
if (!existsSync(keyFile) || NEW_KEY) {
  writeFileSync(keyFile, randomBytes(24).toString("base64url"), { mode: 0o600 });
}
chmodSync(keyFile, 0o600);
const setupKey = readFileSync(keyFile, "utf8").trim();

// 4. The code, deployed with a blank house's config; again with its real
// address once wrangler has said it.
say("3. The house");
say("   Putting the house on Cloudflare: two uploads, about a minute together.");
const configFile = join(MCP, `.door-${NAME}-${account.slice(0, 8)}.toml`);
const addressFile = join(keep, "address");
// Until wrangler has said the address, a placeholder that cannot be taken
// for one (the first run printed its own placeholder back, 2026-10-17).
let baseUrl = existsSync(addressFile) ? readFileSync(addressFile, "utf8").trim() : "https://address-not-known-yet.invalid";
async function deploy(busy) {
  writeFileSync(configFile, renderBlankHouse({ name: NAME, baseUrl, tokensId, programsId, compatibilityDate: COMPATIBILITY_DATE }));
  const r = await wrangler(["deploy", "--config", configFile], { cwd: MCP, busy });
  if (!r.ok) fail(`The deploy did not go through:\n${r.out.slice(-800)}`);
  // The address wrangler deployed to, on a line of its own after "Deployed",
  // never one quoted among the bindings it lists before.
  return r.out.match(/^\s+(https:\/\/[a-z0-9.-]+\.workers\.dev)\s*$/m)?.[1] ?? null;
}
let said = await deploy("Uploading the house");
if (!said) fail("The house was deployed but wrangler named no workers.dev address. Is the account's workers.dev subdomain set up (Workers & Pages, in Cloudflare's dashboard)?");
if (said !== baseUrl) {
  baseUrl = said;
  writeFileSync(addressFile, baseUrl, { mode: 0o600 });
  await deploy("Uploading it again, with its own address");
}
say(`   ${baseUrl}`);

// 5. The setup key as the Worker's secret.
const sec = await wrangler(["secret", "put", "SETUP_KEY", "--config", configFile], { cwd: MCP, input: setupKey, busy: "Keeping the setup key with it" });
if (!sec.ok) fail(`The setup key could not be kept as the house's secret:\n${sec.out.slice(-400)}`);

// 6. The house answering, then its setup page. The setup page answers only
// once the setup key has reached the house, a few seconds after /health
// (the owner's Mac, 2026-10-19: the browser opened on "not found").
say("4. Waiting for the house to answer (usually a few seconds, at most a minute)");
let up = false;
const stopWaiting = working("Asking it");
for (let i = 0; i < 45 && !up; i++) {
  try { up = (await fetch(`${baseUrl}/health`)).ok && (await fetch(`${baseUrl}/setup`)).ok; } catch { up = false; }
  if (!up) await new Promise((r) => setTimeout(r, 2000));
}
stopWaiting();
if (!up) fail(`The house does not answer yet at ${baseUrl}. Give it a minute, then open ${baseUrl}/setup.`);

const setupUrl = `${baseUrl}/setup#${setupKey}`;
writeFileSync(join(keep, "setup-url"), setupUrl, { mode: 0o600 });
// The link with the key, always printed (Codex, 2026-10-17): a browser that
// did not open left only a path to a hidden file.
let opened = false;
if (OPEN) {
  // Windows: `start` through cmd.exe ("" is its window title); explorer
  // answers 1 even when the browser opened.
  const [opener, how] = platform() === "darwin" ? ["open", [setupUrl]] : WINDOWS ? ["cmd", ["/c", "start", "", setupUrl]] : ["xdg-open", [setupUrl]];
  opened = spawnSync(opener, how, { stdio: "ignore" }).status === 0;
}
say(`\nThe house is up, at ${baseUrl}`);
say(opened ? "Its setup page is opening in your browser. If it does not, open this link:" : "Open this link in a browser to set it up:");
say(`  ${setupUrl}`);
if (NEW_KEY) say("This is a new setup key: the setup page offers to claim the house again with it.");
say(`(The link is also kept in ${join(keep, "setup-url")}.)`);
// THE PROMPT BACK (the first Windows laptop, 2026-10-21: twice everything
// was said and PowerShell gave no prompt until Ctrl+C; with --no-open, on
// GitHub's Windows machine, it never stuck, so the browser's start is the
// likely holder). All said, then gone.
await new Promise((r) => process.stdout.write("", r));
process.exit(0);
