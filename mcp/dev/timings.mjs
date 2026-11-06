// THE STOPWATCH, READ (MC-37, 2026-11-02): loads the owner's pages a few
// times and prints, per page, the median time to the first byte and the
// median of each phase and wait the Worker reported in Server-Timing
// (timing.js). Run it before and after a change and compare the medians.
//
//   FMWAX_BASE=https://<the house's address> FMWAX_KEY_FILE=/path/to/key node dev/timings.mjs [runs]
//
// The page key is the Shelf's (list_programs' program_notes_page); it is
// never printed. The address is the house's own, so there is no default: a
// copy for another house must not time this one.
import fs from "node:fs";

const key = (process.env.FMWAX_KEY ?? (process.env.FMWAX_KEY_FILE ? fs.readFileSync(process.env.FMWAX_KEY_FILE, "utf8") : "")).trim();
if (!key) { console.error("Set FMWAX_KEY or FMWAX_KEY_FILE."); process.exit(2); }
const base = String(process.env.FMWAX_BASE ?? "").trim().replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) { console.error("Set FMWAX_BASE to the house's address, https://…"); process.exit(2); }
const runs = Math.max(1, Number(process.argv[2]) || 5);
const PAGES = [["Loaded", `/buttons/${key}`], ["poll", `/buttons/${key}/playing`], ["DJs", `/buttons/${key}/djs`],
  ["Speakers", `/buttons/${key}/wiim`], ["Talk", `/buttons/${key}/talk`], ["Sessions", `/buttons/${key}/sessions`], ["Shelf", `/notes/${key}`]];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const parse = (h) => String(h ?? "").split(/,\s*/).filter(Boolean).map((part) => {
  const [name, ...fields] = part.split(";");
  const f = Object.fromEntries(fields.map((x) => x.split("=")));
  return { name, dur: Number(f.dur), desc: f.desc?.replace(/"/g, "") ?? "" };
});

for (const [label, path] of PAGES) {
  const ttfb = [], phases = new Map(), descs = new Map();
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(base + path);
    ttfb.push(performance.now() - t0);
    await res.arrayBuffer();
    for (const { name, dur, desc } of parse(res.headers.get("server-timing"))) {
      if (!phases.has(name)) phases.set(name, []);
      phases.get(name).push(dur);
      if (desc) descs.set(name, desc);
    }
  }
  console.log(`\n${label}: first byte ${Math.round(median(ttfb))} ms (median of ${runs}; all ${ttfb.map(Math.round).join(" ")})`);
  for (const [name, ds] of phases) {
    console.log(`  ${name.padEnd(16)} ${String(median(ds)).padStart(5)} ms${descs.has(name) ? `  (${descs.get(name)})` : ""}${
      name === "total" || Math.max(...ds) - Math.min(...ds) > 100 ? `   runs: ${ds.join(" ")}` : ""}`);
  }
}
