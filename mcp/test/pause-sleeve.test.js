// THE SLEEVE STAYS WITH A PAUSE (the owner, 2026-11-02, a few minutes into a
// pause: "why does the bar not recognize or show the cover page?"). Spotify's
// own paused state is not believed, so the bar draws a pause from the note the
// pause itself keeps (now.js, the pause note). The note kept the song, the
// speaker and the list but not the picture: now it keeps the sleeve and the
// album from the same read, and the panel draws them while paused.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { pausedFor } from "../now.js";
import { makeEnv, installFetch, track, buttons } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
const SLEEVE = "https://i.scdn.co/image/ab67616d00004851plateau";
const get = (path) => new Request(`https://x.test${path}`);

function env() {
  const e = makeEnv();
  e.BUTTONS = buttons({ 1: P(1), 2: P(2), 3: P(3), 4: P(4), 5: P(5), 6: true, 7: P(7), 8: P(8) });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus", "Ultra"]);
  return e;
}
// Spotify playing Hank's list on the Pro Plus with a sleeve, until a pause; quiet after it.
function player() {
  const inner = globalThis.fetch;
  const state = { playing: true };
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/me/player" && (init?.method ?? "GET") === "GET") {
      if (!state.playing) return new Response(null, { status: 204 });
      return Response.json({ is_playing: true, progress_ms: 10, device: { id: "d1", name: "Pro Plus" },
        context: { uri: `spotify:playlist:${P(2)}` }, shuffle_state: false, repeat_state: "off",
        item: { name: "Plateau - Live", uri: "spotify:track:pl", type: "track", duration_ms: 214000, artists: [{ name: "Nirvana" }],
          album: { name: "MTV Unplugged in New York", images: [{ url: SLEEVE, width: 64 }, { url: `${SLEEVE}-640`, width: 640 }] } } });
    }
    if (u.pathname === "/v1/me/player/pause") { state.playing = false; return new Response(null, { status: 204 }); }
    if (u.pathname === "/v1/me/player/devices") return Response.json({ devices: [{ id: "d1", name: "Pro Plus" }] });
    return inner(url, init);
  };
  return { state, restore: () => { globalThis.fetch = inner; } };
}

test("a pause from the app keeps the sleeve and the album, and the bar is told them while paused", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  const p = player();
  try {
    const res = await worker.fetch(new Request(`https://x.test/buttons/${KEY}/hank/play`, { method: "POST",
      body: new URLSearchParams({ device: "Pro Plus", pause: "1" }) }), e);
    assert.equal(res.status, 303);
    const note = JSON.parse(await e.PROGRAMS.get("pause:last"));
    assert.equal(note.art, SLEEVE, "the small sleeve, as the panel draws it");
    assert.equal(note.album, "MTV Unplugged in New York");
    const o = await (await worker.fetch(get(`/buttons/${KEY}/playing`), e)).json();
    assert.equal(o.state, "quiet");
    assert.equal(o.paused.track, "Plateau - Live");
    assert.equal(o.paused.art, SLEEVE);
    assert.equal(o.paused.album, "MTV Unplugged in New York");
  } finally { p.restore(); f.restore(); }
});

test("only Spotify's own picture host, and a note from before has none", () => {
  const base = { at: Date.now(), device: "Pro Plus", track: "T", artists: "A", pid: P(2) };
  assert.equal(pausedFor({ ROOM_DEVICES: JSON.stringify(["Pro Plus"]) }, { ...base, art: "https://evil.example/x.jpg" }).art, undefined);
  assert.equal(pausedFor({ ROOM_DEVICES: JSON.stringify(["Pro Plus"]) }, { ...base, art: SLEEVE }).art, SLEEVE);
  const old = pausedFor({ ROOM_DEVICES: JSON.stringify(["Pro Plus"]) }, base);
  assert.equal(old.art, undefined);
  assert.equal(old.album, undefined);
});

test("the panel draws a pause's sleeve and its artist and album line", async () => {
  const e = env();
  const f = installFetch({ contents: [track("aaa")] });
  try {
    const html = await (await worker.fetch(get(`/buttons/${KEY}/wiim`), e)).text();
    assert.ok(html.includes('var held = w.tone === "held" && o.paused ? o.paused : null;'));
    assert.ok(html.includes(': held ? [held.artists, held.album].filter(Boolean).join(" \\u00b7 ") : ""'), "artist and album under the paused song");
    assert.ok(html.includes('held && held.art ? String(held.art) : ""'), "the sleeve in place of the note");
    assert.ok(html.includes('var big = w.tone === "live" && o.sleeve ? String(o.sleeve) : ""'), "the big sleeve still only while Spotify plays here");
  } finally { f.restore(); }
});
