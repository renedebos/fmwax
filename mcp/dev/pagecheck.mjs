// THE PAGES IN A BROWSER, AS DEPLOYED (2026-10-12). From a15a3548 the bar's
// script threw over every Spotify answer for a day and a half with every test
// green: the tests run the source, the deploy runs wrangler's bundle, and only
// the bundle wraps an inner function in a __name the page does not have. So
// this builds that bundle (wrangler's dry run, the deploy's own version),
// serves the preview house from it, opens every tab in headless Chromium, and
// hands the bar every kind of answer it draws — with its panel shut and open.
// Any script error, or a page refused by its own CSP, fails the deploy.
//
//   node dev/pagecheck.mjs              the check (npm run deploy runs it first)
//   node dev/pagecheck.mjs --mcp <dir>  bundle another checkout's mcp/ instead
//
// It needs Playwright, which lives in tools/browser/ and is the author's tooling:
// a house without it is told so and not stopped.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { makePreview, serve, KEY, PROGRAMS } from "./preview.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const at = process.argv.indexOf("--mcp");
const MCP = resolve(at > 0 ? process.argv[at + 1] : join(HERE, ".."));
const PLAYWRIGHT = join(HERE, "..", "..", "tools", "browser", "node_modules", "playwright", "index.mjs");
const PORT = Number(process.env.PAGECHECK_PORT) || 8797;
const BASE = `http://localhost:${PORT}`;
const ROOM = `/buttons/${KEY}`;

if (!existsSync(PLAYWRIGHT)) {
  console.log("pagecheck: skipped — Playwright is not installed (npm install in tools/browser/).");
  process.exit(0);
}

// The deploy's bundle: the same wrangler, the same config, nothing uploaded.
const out = mkdtempSync(join(tmpdir(), "pagecheck-"));
process.on("exit", () => rmSync(out, { recursive: true, force: true }));
execFileSync("npx", ["--yes", "wrangler@4.129.1", "deploy", "--dry-run", "--outdir", out],
  { cwd: MCP, stdio: ["ignore", "ignore", "inherit"] });
const mod = await import(pathToFileURL(join(out, "worker.js")).href);

const env = await makePreview({ base: BASE, mod });
const server = serve(env, { port: PORT, base: BASE, mod });
await new Promise((r) => server.once("listening", r));

const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let errors = [];
page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
page.on("console", (m) => {
  // A missing picture or font is not a script error; a refused script is.
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});

// Every tab and every kind of page a phone opens.
const slug = PROGRAMS[4].slug;
const PAGES = [
  ["Loaded", ROOM], ["DJs", `${ROOM}/djs`], ["Which DJ?", `${ROOM}/djs/map`], ["Speakers", `${ROOM}/wiim`],
  ["Talk", `${ROOM}/talk`], ["Use", `${ROOM}/use`], ["Spotify", `${ROOM}/spotify`], ["House rules", `${ROOM}/rules`], ["Readings", `${ROOM}/readings`],
  ["Shelf", `/notes/${KEY}`], ["a programme, keyed", `${ROOM}/programs/${slug}`], ["a programme, public", `/programs/${slug}`],
  // Soul on 8 since the Selector was cut (2026-10-15). The optional words
  // box beside Play endless (the merges, 2026-10-13) had Soul's page; Vibe
  // and Soul both hold a house preset now, where a page draws no box, so
  // Deep Dive's required one is the box checked.
  ["an endless DJ", `${ROOM}/soul`], ["the guest DJ's", `${ROOM}/pub-rock`], ["Deep Dive", `${ROOM}/deep-dive`],
  // Comedy's page (asked sets only) went with Comedy, 2026-10-13; the
  // Professor's, the writer's, with him, 2026-10-15.
  ["a writer", `${ROOM}/the-librarian`], ["the archive", `${ROOM}/archive`],
];

// What the bar can be handed: every state barWords and view() tell apart, on
// top of the house's own answer (its speakers, its picker, the helper's line).
const t = Date.now();
const SAMPLES = {
  "playing, an endless preset": { state: "playing", device: "Pro Plus", track: "Green Onions", artists: "Booker T. & the M.G.'s",
    preset: { btn: 8, name: "Soul", dj: "soul", endless: true }, speakerPreset: { btn: 8, name: "Soul", endless: true },
    who: { dj: "soul", name: "Soul", kind: "house", btn: 8, endless: true }, pausable: "Pro Plus", live: "Pro Plus",
    song: "https://open.spotify.com/track/x", list: "https://open.spotify.com/playlist/y", art: "https://i.scdn.co/image/x" },
  "playing, a request with its DJ": { state: "playing", device: "Pro Plus", track: "Cry Tough", artists: "Alton Ellis", guest: true,
    btn: 1, preset: { btn: 1, name: "Requests · Spotify" }, who: { kind: "request", dj: "hank", name: "Hank", btn: 1 }, pausable: "Pro Plus" },
  "playing, the guest DJ": { state: "playing", device: "Pro Plus", track: "Roxette", artists: "Dr. Feelgood", lane: 3,
    preset: { btn: 3, name: "Guest DJ · Pub Rock", dj: "pub-rock", lane: true, endless: true }, who: { dj: "pub-rock", name: "Pub Rock", kind: "guest", btn: 3, endless: true },
    pausable: "Pro Plus" },
  "playing on another speaker": { state: "playing", device: "Master Bedroom", track: "X", artists: "Y", from: "a playlist",
    pausable: "Master Bedroom", pick: { name: "Pro Plus", slug: "pro-plus", why: "tap" } },
  "playing, no names": { state: "playing", device: null, track: null, artists: null },
  "quiet": { state: "quiet" },
  "quiet, the bar's own pause": { state: "quiet", paused: { track: "Cry Tough", artists: "Alton Ellis", device: "Pro Plus", again: true,
    preset: { btn: 1, name: "Requests · Spotify", dj: "Hank" }, song: "https://open.spotify.com/track/x" } },
  "Tidal, read by the helper": { state: "quiet", lan: { at: t, hands: true, speakers: { "Pro Plus": { state: "play", source: "Tidal",
    track: "Just Like Honey", artists: "The Jesus and Mary Chain" } } }, lanBand: { speaker: "Pro Plus", btn: 2, name: "Requests · Tidal", state: "play" } },
  "the radio, read by the helper": { state: "quiet", lan: { at: t, hands: true, speakers: { "Pro Plus": { state: "play", source: "newTuneIn",
    station: "KQED-FM" } } } },
  "Spotify stopped on a WiiM, its preset known": { state: "quiet", lan: { at: t, hands: true, speakers: { "Pro Plus": { state: "stop",
    source: "Spotify", track: "Cruel to Be Kind", preset: { btn: 3, name: "Guest DJ · Pub Rock", lane: true, endless: true },
    list: "https://open.spotify.com/playlist/SAMPLEPLAYLIST00000002",
    who: { dj: "pub-rock", name: "Pub Rock", kind: "guest", btn: 3, endless: true } } } } },
  "the helper off": { state: "quiet", helper: "off", lan: undefined },
  "throttled": { state: "throttled", mins: 40 },
  "unknown": { state: "unknown" },
  "nothing at all": {},
};

let failed = 0;
for (const [name, path] of PAGES) {
  errors = [];
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  if (!res || res.status() !== 200) errors.push(`answered ${res ? res.status() : "nothing"}`);
  await page.waitForFunction(() => {
    const one = document.querySelector("[data-nowbar] .nb1");
    return !one || one.textContent !== "Reading what is playing…";
  }, null, { timeout: 5000 }).catch(() => errors.push("the bar never filled"));
  // One answer at a time: a pick in an answer can send the Speakers page to
  // that speaker, which is a navigation, not an error — the new page's own
  // errors still arrive through the listeners above.
  const thrown = [];
  for (const panel of ["panel shut", "panel open"]) {
    for (const [k, v] of Object.entries(SAMPLES)) {
      try {
        const e = await page.evaluate(async ({ v, open }) => {
          const bar = document.querySelector("[data-nowbar]");
          if (!bar || typeof window.__nowbar !== "function") return null;
          const house = await (await fetch(bar.getAttribute("data-now"), { cache: "no-store" })).json();
          const sheet = document.getElementById("nbsheet");
          if (open && sheet && sheet.hidden) bar.querySelector(".nbmore")?.click();
          const o = { ...house, ...v };
          const out = [];
          try { window.__nowbar(o); } catch (err) { out.push(`bar: ${err}`); }
          if (typeof window.__housedraw === "function") {
            try { window.__housedraw(o); } catch (err) { out.push(`page: ${err}`); }
          }
          return out;
        }, { v, open: panel === "panel open" });
        for (const x of e ?? []) thrown.push(`${panel}, ${k}: ${x}`);
      } catch (err) {
        if (!/Execution context was destroyed|navigation/i.test(String(err))) throw err;
        await page.waitForLoadState("load");
      }
    }
  }
  await page.waitForTimeout(150);
  const all = [...errors, ...thrown];
  if (all.length) failed += 1;
  console.log(`${all.length ? "FAIL" : "ok  "} ${name.padEnd(22)} ${path.replace(KEY, "KEY")}`);
  for (const e of all) console.log(`       ${String(e).slice(0, 300)}`);
}

await browser.close();
server.close();
if (failed) {
  console.error(`pagecheck: ${failed} of ${PAGES.length} pages had a script error in the deploy's bundle. Not deployed.`);
  process.exit(1);
}
console.log(`pagecheck: ${PAGES.length} pages, the bar handed ${Object.keys(SAMPLES).length} answers on each, no script error.`);
process.exit(0);
