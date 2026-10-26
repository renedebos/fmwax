// THE INSTALLER'S CHECK (2026-10-19, so a Windows household needs no WSL, and
// a Mac is known to work before anyone tries one). The terminal door,
// install/door.js, run as a newcomer runs it, on whatever computer this is:
// GitHub's Windows, macOS and Linux machines run it on every change to the
// installer (.github/workflows/install-check.yml), and `node dev/door-check.mjs`
// runs it here. Cloudflare's tool is a stand-in (dev/stand-in/), so nothing
// is deployed and no account is used. The app is copied into a folder with a
// space in its name, as "C:\Users\Jane Doe" would be. Five runs: a first
// install, an update, a login that reaches two accounts with no terminal to
// ask in, a new setup key, and a first run signed out of Cloudflare.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "fmwax-door-check";
const ACCOUNT = "f".repeat(32);
// The address the stand-in deploy names. Nothing is there: door.js's waits on
// it are answered in its own process (dev/stand-in/fetch.mjs).
const ADDRESS = "https://fmwax-door-check.door-check.workers.dev";

const root = mkdtempSync(join(tmpdir(), "door-check-"));
const copy = join(root, "Jane Doe", "music-control");
const home = join(root, "home");
const state = join(root, "stand-in");
let failed = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) failed++;
};

try {
  // The app as a newcomer's clone has it: never this computer's keys or a
  // house's files (every name starting with a dot), never node_modules.
  const plain = (src) => !basename(src).startsWith(".") && basename(src) !== "node_modules";
  cpSync(MCP, join(copy, "mcp"), { recursive: true, filter: plain });
  cpSync(join(MCP, "..", "art", "covers"), join(copy, "art", "covers"), { recursive: true });

  const env = { ...process.env, HOME: home, USERPROFILE: home, FMWAX_STANDIN_DIR: state, FMWAX_STANDIN_ADDRESS: ADDRESS };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  // Windows spells it Path; one key, or the child may see the old one.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${join(MCP, "dev", "stand-in")}${delimiter}${env[pathKey] ?? ""}`;
  mkdirSync(state, { recursive: true });

  // The last argument may be more of the environment, for one run.
  const door = (...args) => {
    const more = typeof args.at(-1) === "object" ? args.pop() : {};
    return spawnSync(process.execPath,
      ["--import", pathToFileURL(join(MCP, "dev", "stand-in", "fetch.mjs")).href, join("install", "door.js"), ...args],
      { cwd: join(copy, "mcp"), env: { ...env, ...more }, encoding: "utf8", timeout: 180_000 });
  };
  const calls = () => (existsSync(join(state, "calls.jsonl")) ? readFileSync(join(state, "calls.jsonl"), "utf8") : "")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const what = (c) => c.args.slice(0, c.args[0] === "kv" ? 3 : c.args[0] === "secret" ? 2 : 1).join(" ");
  const keyFile = join(home, ".config", "fmwax-house", ACCOUNT, NAME, "setup-key");
  const said = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

  console.log(`door.js on ${process.platform}, Node ${process.version}, from ${copy}`);

  // 1. A first install.
  let r = door("--name", NAME, "--account", ACCOUNT, "--no-open");
  ok(r.status === 0, `a first install finishes${r.status === 0 ? "" : `:\n${said(r)}`}`);
  const key = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : null;
  ok(/^[A-Za-z0-9_-]{32}$/.test(key ?? ""), "the setup key is kept on this computer");
  ok(said(r).includes(`The house is up, at ${ADDRESS}`) && said(r).includes(`${ADDRESS}/setup#${key}`), "it prints the setup link with the key");
  ok(said(r).includes("Account: Check House\n") || said(r).includes("Account: Check House\r\n"), "it names the account chosen");
  let c = calls();
  ok(c.map(what).join(", ") === "whoami, kv namespace list, kv namespace create, kv namespace create, kv namespace list, deploy, deploy, secret put",
    `Cloudflare's tool asked in order: ${c.map(what).join(", ")}`);
  ok(c.every((x) => x.version === "wrangler@4.129.1" && x.account === ACCOUNT), "every call on the pinned wrangler and the chosen account");
  ok(c.filter((x) => x.title).map((x) => x.title).join(" ") === `${NAME}-TOKENS ${NAME}-PROGRAMS`, "its two stores made by name");
  const deploys = c.filter((x) => x.args[0] === "deploy");
  ok(deploys.length === 2 && deploys.every((d) => d.config?.name === NAME && d.config.main && d.config.covers && d.config.kv.length === 2),
    "each deploy's config names the house, finds worker.js and the covers, and holds both stores");
  ok(deploys.length === 2 && deploys.every((d) => d.cwd.includes("Jane Doe")), "run from inside a folder with a space in its name");
  ok(deploys[1]?.config?.baseUrl === ADDRESS, "the second deploy carries the house's own address");
  ok(c.find((x) => x.secret)?.secret === "SETUP_KEY" && c.find((x) => x.secret)?.value === key, "the setup key is given to the house");
  const asked = existsSync(join(state, "fetches.jsonl")) ? readFileSync(join(state, "fetches.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).path) : [];
  ok(asked.filter((p) => p === "/setup").length === 3, `it waits until the setup page answers, not only /health (asked: ${asked.join(" ")})`);

  // 2. An update: the same command again.
  const before = c.length;
  r = door("--name", NAME, "--account", ACCOUNT, "--no-open");
  c = calls().slice(before);
  ok(r.status === 0, `an update finishes${r.status === 0 ? "" : `:\n${said(r)}`}`);
  ok(said(r).includes(`Found ${NAME}-TOKENS`) && said(r).includes(`Found ${NAME}-PROGRAMS`), "it finds the same stores");
  ok(c.map(what).join(", ") === "whoami, kv namespace list, kv namespace list, deploy, secret put", `and deploys once: ${c.map(what).join(", ")}`);
  ok(readFileSync(keyFile, "utf8").trim() === key, "the setup key stays");

  // 3. Two accounts, and no terminal to ask in: the command for each.
  r = door("--name", NAME, "--no-open");
  ok(r.status === 1 && said(r).includes(`node install/door.js --account ${"f".repeat(32)}`) && said(r).includes(`--account ${"e".repeat(32)}`),
    "with two accounts and no terminal, it prints the command for each");

  // 4. A new setup key, the way back for a lost recovery code.
  r = door("--name", NAME, "--account", ACCOUNT, "--no-open", "--new-key");
  const fresh = readFileSync(keyFile, "utf8").trim();
  ok(r.status === 0 && fresh !== key && said(r).includes("This is a new setup key"), "--new-key makes a new key and says so");
  ok(!said(r).includes("DeprecationWarning"), "Node gives no warning about how Cloudflare's tool is started (Node 24 did, on Windows)");

  // 5. Signed out, as a newcomer's first run: the sign-in said in the
  // house's words, wrangler's long link kept back while a page opened.
  const signin = door("--name", `${NAME}-2`, "--account", ACCOUNT, "--no-open", { FMWAX_STANDIN_SIGNED_OUT: "1" });
  ok(signin.status === 0, `a signed-out first run signs in and finishes${signin.status === 0 ? "" : `:\n${said(signin)}`}`);
  ok(said(signin).includes("The Cloudflare page is open in your browser") && said(signin).includes("Signed in."),
    "it says what to do on Cloudflare's page, then that it is signed in");
  ok(!said(signin).includes("oauth2/auth") && !said(signin).includes("Opening a link"), "wrangler's own link and words stay back");
  ok(!said(signin).includes("DeprecationWarning"), "and no warning from Node there either");
} catch (e) {
  ok(false, `the check itself broke: ${e?.stack ?? e}`);
} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* the temp folder is the computer's to clear */ }
}
console.log(failed ? `\n${failed} failed` : "\nAll well");
process.exit(failed ? 1 : 0);
