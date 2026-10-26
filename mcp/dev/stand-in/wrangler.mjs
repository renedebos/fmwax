// A STAND-IN FOR `npx wrangler` (the installer's check, dev/door-check.mjs,
// 2026-10-19). door.js runs Cloudflare's tool through npx; the check puts
// this folder first on PATH, so its npx (npx.cmd on Windows) runs this
// instead: wrangler's answers in wrangler's shapes, nothing sent anywhere,
// no account used. Each call is written down for the check to read, with
// what it can see of the house door.js would deploy.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const DIR = process.env.FMWAX_STANDIN_DIR;
if (!DIR) { console.error("stand-in: FMWAX_STANDIN_DIR is not set"); process.exit(2); }
const STATE = join(DIR, "state.json");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { namespaces: [] };
const save = () => writeFileSync(STATE, JSON.stringify(state));

// npx's own words first: --yes, then wrangler@<version>.
const args = process.argv.slice(2);
while (args[0]?.startsWith("--")) args.shift();
const version = /^wrangler@/.test(args[0] ?? "") ? args.shift() : null;
const call = { args, version, cwd: process.cwd(), account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null };
const note = () => appendFileSync(join(DIR, "calls.jsonl"), `${JSON.stringify(call)}\n`);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const stdin = () => { try { return readFileSync(0, "utf8"); } catch { return ""; } };

const [a, b, c] = args;
// Signed out (FMWAX_STANDIN_SIGNED_OUT=1) until a login: what a newcomer's
// first run meets, with wrangler's own words for the sign-in.
const signedOut = process.env.FMWAX_STANDIN_SIGNED_OUT === "1" && !state.signedIn;
if (a === "whoami" && signedOut) {
  note();
  console.log(" ⛅️ wrangler (stand-in)\nYou are not authenticated. Please run `wrangler login`.");
} else if (a === "whoami") {
  note();
  console.log(" ⛅️ wrangler (stand-in)\n👋 You are logged in with an OAuth Token.");
  // wrangler 4.129's table, a rule between rows.
  console.log("┌──────────────┬──────────────────────────────────┐");
  console.log("│ Account Name │ Account ID                       │");
  console.log("├──────────────┼──────────────────────────────────┤");
  console.log(`│ Check House  │ ${"f".repeat(32)} │`);
  console.log("├──────────────┼──────────────────────────────────┤");
  console.log(`│ Other        │ ${"e".repeat(32)} │`);
  console.log("└──────────────┴──────────────────────────────────┘");
} else if (a === "kv" && b === "namespace" && c === "list") {
  note();
  console.log(JSON.stringify(state.namespaces, null, 2));
} else if (a === "kv" && b === "namespace" && c === "create") {
  const title = args[3];
  call.title = title;
  note();
  const id = randomBytes(16).toString("hex");
  state.namespaces.push({ id, title });
  save();
  console.log(`🌀 Creating namespace with title "${title}"\n✨ Success!`);
} else if (a === "deploy") {
  // What door.js handed over: the config file, where it was run from, and
  // whether the house it describes is whole from there.
  const file = flag("--config");
  const toml = file && existsSync(file) ? readFileSync(file, "utf8") : null;
  const at = file ? dirname(resolve(file)) : null;
  call.config = toml ? {
    file,
    name: toml.match(/^name = "([^"]+)"/m)?.[1] ?? null,
    baseUrl: toml.match(/^PROGRAM_BASE_URL = "([^"]+)"/m)?.[1] ?? null,
    kv: [...toml.matchAll(/^id = "([^"]+)"/gm)].map((m) => m[1]),
    main: existsSync(join(at, toml.match(/^main = "([^"]+)"/m)?.[1] ?? "-")),
    covers: existsSync(join(at, toml.match(/^directory = "([^"]+)"/m)?.[1] ?? "-")),
  } : null;
  note();
  if (!toml) { console.error(`✘ [ERROR] No config file at ${file}`); process.exit(1); }
  console.log(`Total Upload: 1234.56 KiB / gzip: 234.56 KiB\nUploaded ${call.config.name} (1.23 sec)`);
  console.log(`Deployed ${call.config.name} triggers (0.45 sec)\n  ${process.env.FMWAX_STANDIN_ADDRESS}\n  schedule: */10 * * * *`);
  console.log("Current Version ID: 00000000-0000-4000-8000-000000000000");
} else if (a === "secret" && b === "put") {
  call.secret = c;
  call.value = stdin().trim();
  call.config = flag("--config");
  note();
  console.log(`✨ Success! Uploaded secret ${c}`);
} else if (a === "login") {
  note();
  console.log(" ⛅️ wrangler 4.129.1 (stand-in)\nAttempting to login via OAuth...");
  console.log(`Opening a link in your default browser: https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=stand-in&${"scope=x%20".repeat(40)}`);
  state.signedIn = true;
  save();
  console.log("Successfully logged in.");
} else {
  note();
  console.error(`stand-in: wrangler ${args.join(" ")} is not something door.js should ask`);
  process.exit(1);
}
