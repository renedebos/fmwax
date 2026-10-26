// THE BIG SLEEVE (the owner, 2026-10-13, design A of docs/design/now-sleeve):
// the now panel draws Spotify's sleeve across its top, the song in two lines
// under it, and a progress line. The bar's answer carries the 640 picture,
// the album's name and where the song was at the read; the panel counts on
// from there. No extra Spotify call: all of it is in the one player read.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { roomPlaying, sleeveOf } from "../now.js";
import { makeEnv, installFetch, buttons } from "./harness.js";

const IMGS = [640, 300, 64].map((w) => ({ url: `https://i.scdn.co/image/s${w}`, width: w, height: w }));
const st = (extra = {}) => ({
  is_playing: true, progress_ms: 172_000, device: { name: "Pro Plus", id: "d" }, context: null,
  item: { name: "Put It On The Line", uri: "spotify:track:x", duration_ms: 217_000, artists: [{ name: "Lyn Collins" }],
    album: { name: "Check Me Out If You Don't Know Me By Now", images: IMGS } },
  ...extra,
});

test("the bar's answer carries the 640 sleeve, the album and where the song was at the read", () => {
  const p = roomPlaying(st({ readAt: 1_000 }));
  assert.equal(p.art, "https://i.scdn.co/image/s64", "the small row's picture is unchanged");
  assert.equal(p.sleeve, "https://i.scdn.co/image/s640", "the big one is the 640");
  assert.equal(p.album, "Check Me Out If You Don't Know Me By Now");
  assert.deepEqual(p.pos, { ms: 172_000, of: 217_000, at: 1_000 });
  // A read with no time on it (a kept answer from before this) has no line.
  assert.ok(!("pos" in roomPlaying(st())), "no read time, no position");
  // A record with only small pictures gives its largest.
  assert.equal(sleeveOf({ album: { images: IMGS.slice(1) } }, 600), "https://i.scdn.co/image/s300");
});

test("the panel has the big sleeve's parts, and the script draws them only while Spotify plays here", async () => {
  const e = makeEnv();
  e.BUTTONS = buttons({ 1: "0000000000000000000001" });
  e.PROGRAM_LIBRARY_KEY = "abcdefabcdefabcdefabcdef";
  const f = installFetch();
  try {
    const html = await (await worker.fetch(new Request("https://x.test/buttons/abcdefabcdefabcdefabcdef/wiim"), e)).text();
    assert.match(html, /<p class="nbs1" id="nbs1"><\/p><p class="nbal" hidden><\/p><p class="nbs2"><\/p>/, "the artist and album line, under the song");
    assert.match(html, /<div class="nbprog" hidden><div class="nbpbar" aria-hidden="true"><i><\/i><\/div><p class="nbptime">/, "the progress line");
    assert.ok(html.includes('var big = w.tone === "live" && o.sleeve ? String(o.sleeve) : ""'), "big only while Spotify plays here");
    assert.ok(html.includes('classList.toggle("big", !!big)'));
    assert.match(html, /\.nbpanel\.big\{max-height:calc\(100% - 40px - env\(safe-area-inset-top\)\)\}/, "the panel may take the screen but 40 px");
  } finally { f.restore(); }
});
