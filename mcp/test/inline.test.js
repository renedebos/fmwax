// THE BAR'S CRASH IN THE DEPLOYED BUNDLE (2026-10-12). From 2026-10-10 the
// bar said "Can't reach Spotify right now" over every Spotify answer: the
// deploy bundles with esbuild's keepNames (wrangler's default), barWords's
// inner asDj became __name(…, "asDj"), and a page has no __name. These tests
// bundle programs.js as the deploy does, because the other tests run the
// unbundled source, where the fault does not exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = new URL("..", import.meta.url).pathname;
const SRC = readFileSync(join(HERE, "programs.js"), "utf8");

async function bundled() {
  const out = await build({ entryPoints: [join(HERE, "programs.js")], bundle: true, format: "esm", platform: "neutral",
    keepNames: true, write: false, external: ["cloudflare:*", "node:*"], logLevel: "error" });
  const dir = mkdtempSync(join(tmpdir(), "inline-"));
  const file = join(dir, "programs.mjs");
  writeFileSync(file, out.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { rmSync(dir, { recursive: true, force: true }); }
}
// Run inlined source as a page would: its own realm, no __name in it.
const inPage = (code) => vm.runInNewContext(`(${code})`);

test("every function a page inlines goes through inlineFn, never a bare toString()", () => {
  // (inlineFn's own body is the one place a function's source is taken.)
  assert.deepEqual([...SRC.matchAll(/\$\{(\w+)\.toString\(\)\}/g)].map((x) => x[1]), ["fn"]);
  assert.ok((SRC.match(/\$\{inlineFn\(\w+\)\}/g) ?? []).length >= 9, "the bar's and the pages' inlined functions");
});

test("bundled as the deploy bundles, each inlined function runs in a page; barWords says what plays", async () => {
  const m = await bundled();
  assert.match(m.barWords.toString(), /__name\(/, "the bundle does wrap barWords's inner function — else this test proves nothing");
  assert.throws(() => inPage(m.barWords.toString())({ state: "playing", track: "X", device: "Pro Plus" }), /__name is not defined/,
    "inlined bare, as before the fix, it throws");
  const names = [...new Set([...SRC.matchAll(/\$\{inlineFn\((\w+)\)\}/g)].map((x) => x[1]))];
  for (const n of names) assert.equal(typeof inPage(m.inlineFn(m[n])), "function", `${n} inlines to a function`);
  const words = inPage(m.inlineFn(m.barWords));
  for (const o of [
    { state: "playing", track: "Bam Bam", artists: "Sister Nancy", device: "Pro Plus",
      preset: { btn: 8, name: "The Selector" } },
    { state: "playing", track: "Cry Tough", device: "Pro Plus", guest: true, preset: { btn: 1, name: "Requests · Spotify" },
      who: { kind: "request", name: "Hank" } },
    { state: "quiet", paused: { track: "Cry Tough", device: "Ultra", preset: { btn: 1, name: "Requests · Spotify", dj: "Hank" } } },
    // Endless, said (2026-10-13), playing and paused.
    { state: "playing", track: "Bam Bam", device: "Pro Plus", preset: { btn: 8, name: "The Selector", dj: "the-selector", endless: true } },
    { state: "quiet", paused: { track: "Bam Bam", device: "Pro Plus", preset: { btn: 8, name: "The Selector", dj: "the-selector", endless: true } } },
  ]) assert.deepEqual(JSON.parse(JSON.stringify(words(o))), m.barWords(o), `the page's words for ${JSON.stringify(o)}`);
  assert.equal(words({ state: "playing", track: "Bam Bam", device: "Pro Plus",
    preset: { btn: 8, name: "The Selector", endless: true } }).two, "Pro Plus · preset 8, The Selector · endless");
  assert.equal(inPage(m.inlineFn(m.spotifyRest))({ state: "stop", source: "Spotify", preset: { btn: 8, name: "The Selector", endless: true } }, "Ultra").lanFrom,
    "preset 8, The Selector · endless");
  assert.equal(words({ state: "playing", track: "Bam Bam", artists: "Sister Nancy", device: "Pro Plus",
    preset: { btn: 8, name: "The Selector" } }).one, "Bam Bam · Sister Nancy");
  // The panel's quality line (2026-10-25): qualityFor has an inner function too.
  const q = inPage(m.inlineFn(m.qualityFor))({ state: "playing", device: "Pro Plus" },
    { lan: { speakers: { "Pro Plus": { state: "play", source: "Spotify", quality: { rate: 44100, bits: 16, kbps: 912 } } } } });
  assert.equal(inPage(m.inlineFn(m.qualityWords))(q), "Lossless · 16-bit / 44.1 kHz · 912 kbps");
});
