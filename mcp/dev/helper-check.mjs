// THE HELPER INSTALL'S CHECK (MC-31 stage 5, 2026-10-19). install/helper.js
// run as a household runs it, on whatever computer this is: GitHub's
// Windows, macOS and Linux machines run it whenever the installer or the
// helper changes (.github/workflows/install-check.yml). The house is a
// stand-in (dev/stand-in/house.mjs), and the key goes in on standard input,
// never the command line. The home folders are temporary ones.
//
// The background start is made where it cannot touch anything real: on
// GitHub's Mac and Windows machines. On Linux, and on any computer that is
// not GitHub's, --no-service, because a systemd user service is shared with
// the real user (the owner's own helper runs as one on the Chromebook).
//
// It proves the files, the record of what was made, the start's
// registration, a repeat that updates, a refusal over another house's or a
// hand-made helper, and --remove. Not the home network: that is a real
// computer's test.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WINDOWS_APPS_KEY, helperPaths } from "../install/helper-service.js";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOUSE = "https://helper-check.check-house.workers.dev";
const KEY = "check-key-0123456789abcdefghij";
const SERVICE = !!process.env.GITHUB_ACTIONS && process.platform !== "linux";

const root = mkdtempSync(join(tmpdir(), "helper-check-"));
const home = join(root, "home");
mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, "AppData", "Local"),
  APPDATA: join(home, "AppData", "Roaming"), FMWAX_STANDIN_HOUSE: HOUSE, FMWAX_STANDIN_KEY: KEY };
const P = helperPaths({ os: process.platform, home, env });
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? "ok  " : "FAIL"} ${what}`); if (!cond) failed++; };
const install = (args, input = KEY) => spawnSync(process.execPath,
  ["--import", pathToFileURL(join(MCP, "dev", "stand-in", "house.mjs")).href, join(MCP, "install", "helper.js"), ...args],
  { cwd: MCP, env, input: `${input}\n`, encoding: "utf8", timeout: 180_000 });
const said = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
const service = SERVICE ? [] : ["--no-service"];

try {
  console.log(`install/helper.js on ${process.platform}, Node ${process.version}${SERVICE ? ", with its background start" : ", --no-service"}`);
  // A wrong key: nothing written.
  let r = install(["--house", HOUSE, ...service], "not-the-key-0123456789");
  ok(r.status === 1 && said(r).includes("did not take that key") && !existsSync(P.envFile), "a wrong key is refused, and nothing is written");

  // 1. A first install.
  r = install(["--house", HOUSE, ...service]);
  ok(r.status === 0, `a first install finishes${r.status === 0 ? "" : `:\n${said(r)}`}`);
  ok(said(r).includes("The house knows where they are: Check WiiM (127.0.0.1)"), "it takes the house's WiiMs");
  ok(said(r).includes("To take it away again: ") && said(r).includes("remove.mjs") &&
    (!SERVICE || said(r).includes("the setup page's Home helper step has a Remove button")), "it says how to take it away again");
  ok(!said(r).includes(KEY), "the key is never printed whole");
  ok(read(P.envFile) === `HOUSE_URL=${HOUSE}\nHELPER_SECRET=${KEY}\n`, "its settings are kept");
  ok(existsSync(P.script) && existsSync(P.keymap), "the helper is copied to a folder of its own");
  const m = JSON.parse(read(P.manifest) ?? "{}");
  ok(m.house === HOUSE && m.made.includes(P.envFile) && m.made.includes(P.script), "the record lists what it made");
  if (SERVICE) {
    ok(existsSync(P.service.file) && m.made.includes(P.service.file), `its start is made (${P.service.kind})`);
    ok(said(r).includes("Check WiiM: read just now (play)") && said(r).includes("The line to the house: open"), "it waits for the line and a fresh reading");
  }

  if (SERVICE && process.platform === "win32") {
    const q = spawnSync("reg", ["query", WINDOWS_APPS_KEY, "/v", "UninstallString"], { encoding: "utf8" });
    ok(q.status === 0 && q.stdout.includes(`"${P.remover}" --pause`) && m.registry === WINDOWS_APPS_KEY,
      `it is listed in Settings, Apps, its Uninstall the remover${q.status === 0 ? "" : `:\n${q.stdout}${q.stderr}`}`);
  }

  // 2. Again: an update, with the setup page's pairing code and no key typed
  // (2026-10-21).
  r = install(["--house", HOUSE, "--pair", "good-code", ...service], "");
  ok(r.status === 0 && JSON.parse(read(P.manifest)).house === HOUSE && !said(r).includes("Paste the helper key"),
    `run again with the page's code, it updates and asks for no key${r.status === 0 ? "" : `:\n${said(r)}`}`);
  r = install(["--house", HOUSE, "--pair", "old-code", ...service], "");
  ok(r.status === 1 && said(r).includes("has run out"), "a code past its hour is refused, and says to copy the command again");

  // 3. Another house: refused, nothing changed.
  r = install(["--house", "https://another.check-house.workers.dev", ...service]);
  ok(r.status === 3 && said(r).includes("serves") && read(P.envFile).includes(HOUSE), "another house is refused without --replace");

  // 4. Removed with the remover kept beside it, no download needed (the
  // Mac test, 2026-10-19): only what it made.
  ok(existsSync(P.remover) && existsSync(join(P.installer, "helper.js")), "the remover is kept with the helper");
  r = spawnSync(process.execPath, [P.remover], { cwd: home, env, encoding: "utf8", timeout: 60_000 });
  ok(r.status === 0 && !existsSync(P.app) && !existsSync(P.envFile) && !existsSync(P.service.file), `its own remover takes away what it made${r.status === 0 ? "" : `:\n${said(r)}`}`);
  if (SERVICE && process.platform === "win32") {
    ok(spawnSync("reg", ["query", WINDOWS_APPS_KEY], { encoding: "utf8" }).status !== 0, "and its line in Settings, Apps");
  }

  // 5. A helper it did not make (the owner's): refused; with --replace, set
  // up, and on --remove the old settings come back.
  mkdirSync(P.config, { recursive: true });
  writeFileSync(P.envFile, "HOUSE_URL=https://fmwax.example\nHELPER_SECRET=the-owners-own\n");
  r = install(["--house", HOUSE, ...service]);
  ok(r.status === 3 && said(r).includes("not by this command") && read(P.envFile).includes("the-owners-own"), "a helper it did not make is left alone");
  r = install(["--house", HOUSE, "--replace", ...service]);
  ok(r.status === 0 && read(P.envFile).includes(KEY), "--replace sets it up over that one");
  r = install(["--remove"]);
  ok(r.status === 0 && read(P.envFile)?.includes("the-owners-own"), "and --remove puts the old settings back");
} catch (e) {
  ok(false, `the check itself broke: ${e?.stack ?? e}`);
} finally {
  try { spawnSync(process.execPath, [join(MCP, "install", "helper.js"), "--remove"], { env, encoding: "utf8" }); } catch { /* best effort */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* the temp folder is the computer's to clear */ }
}
console.log(failed ? `\n${failed} failed` : "\nAll well");
process.exit(failed ? 1 : 0);
