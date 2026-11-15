// ABOUT THIS SONG (MC-43, tasks/mc43-about-this-song.md): the chip in the
// bar's panel, its view, and the link that opens the house's assistant with
// the question typed.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { aboutStop, aboutView, askLink, assistantOf, cleanSongTitle } from "../about.js";
import { renderProgram } from "../programs.js";
import { makeEnv, makeHouseStore } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const uri = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
const RECORD = {
  title: "The Cramps on Record, 1977–2002", dj: "the-librarian",
  sections: [
    { label: "Stop one", years: "recorded October 1977", heading: "Memphis, October 1977",
      tracks: [{ uri: uri(1), title: "TV Set - 1977 Version" }, { uri: uri(2), title: "Human Fly" }],
      prose: [
        { text: "Start with the people. Lux Interior was born Erick Lee Purkhiser in Akron, Ohio, in 1946." },
        { text: "Then the landmark. ‘Human Fly’ is a Lux and Ivy original. It was the A-side of the 1978 single." },
      ] },
    { label: "Stop two", heading: "Phillips, 1979", tracks: [{ uri: uri(3), title: "Garbageman" }],
      prose: [{ text: "Alex Chilton produced the first album at Phillips Recording in Memphis." }] },
    { tracks: [{ uri: uri(4), title: "Goo Goo Muck" }] },
  ],
};

test("a Spotify title loses its suffixes, and keeps the rest", () => {
  assert.equal(cleanSongTitle("Grey Day - 2010 Remaster"), "Grey Day");
  assert.equal(cleanSongTitle("TV Set - 1977 Version"), "TV Set");
  assert.equal(cleanSongTitle("Stepping Into Line - The John Peel Session 27/08/1979"), "Stepping Into Line");
  assert.equal(cleanSongTitle("Something (Remastered 2009)"), "Something");
  assert.equal(cleanSongTitle("Something in the Water (Does Not Compute)"), "Something in the Water (Does Not Compute)");
  assert.equal(cleanSongTitle("  Human   Fly "), "Human Fly");
});

test("the DJ's words: the stop that holds the track, and its paragraph that names the song", () => {
  const fly = aboutStop(RECORD, uri(2), "Human Fly");
  assert.equal(fly.index, 0);
  assert.equal(fly.label, "Stop one");
  assert.equal(fly.heading, "Memphis, October 1977");
  assert.match(fly.text, /^Then the landmark\./, "the paragraph that names it, quotes and all");
  // A song the stop's words never name: its first paragraph.
  assert.match(aboutStop(RECORD, uri(1), "TV Set - 1977 Version").text, /^Start with the people\./);
  assert.match(aboutStop(RECORD, uri(3), "Garbageman").text, /^Alex Chilton/);
  // A stop with no words, a track not on the page, a bad id: nothing.
  assert.equal(aboutStop(RECORD, uri(4), "Goo Goo Muck"), null);
  assert.equal(aboutStop(RECORD, uri(9), "Surfin' Bird"), null);
  assert.equal(aboutStop(RECORD, "spotify:track:short", "Human Fly"), null);
  assert.equal(aboutStop(null, uri(2), "Human Fly"), null);
  // A paragraph kept as plain text counts too.
  assert.equal(aboutStop({ sections: [{ tracks: [{ uri: uri(5) }], prose: ["Plain words about Fever."] }] }, uri(5), "Fever").text,
    "Plain words about Fever.");
});

test("the question: title and artist only, encoded; Claude unless the house's assistant is ChatGPT", () => {
  const c = askLink("claude", "Grey Day - 2010 Remaster", "Madness");
  assert.equal(c.name, "Claude");
  assert.equal(c.href, "https://claude.ai/new?q=" + encodeURIComponent("Tell me about the song “Grey Day” by Madness."));
  assert.equal(askLink(null, "Human Fly", "The Cramps").name, "Claude", "a house with no curator yet");
  const g = askLink("chatgpt", "Dames, Booze, Chains & Boots", "The Cramps");
  assert.equal(g.name, "ChatGPT");
  assert.ok(g.href.startsWith("https://chatgpt.com/?q="));
  assert.ok(g.href.includes("%26"), "an ampersand cannot end the question");
  assert.ok(!/[\s"<>]/.test(g.href));
  assert.equal(askLink("claude", "Free", "").href, "https://claude.ai/new?q=" + encodeURIComponent("Tell me about the song “Free”."));
});

test("the view escapes what it is handed", () => {
  const html = aboutView({ title: "<script>x</script>", artist: "A & B", ask: askLink("claude", "<b>", "A & B") });
  assert.ok(!html.includes("<script>x"));
  assert.match(html, /A &amp; B/);
  assert.match(html, /It shows a caution note first: that is expected\./);
  assert.ok(!html.includes("nbabw"), "no DJ's words without a stop");
});

async function claimedHouse(extra = {}) {
  const store = await makeHouseStore();
  const e = { ...makeEnv(), HOUSE: store.binding, PROGRAM_LIBRARY_KEY: KEY, ...extra };
  await e.PROGRAMS.put("house:claimed", "2026-10-23T00:00:00Z");
  await e.PROGRAMS.put("program:cramps-1q5j4r", JSON.stringify(RECORD));
  return e;
}
const get = (e, path, init) => worker.fetch(new Request(`https://x.test/buttons/${path}`, init), e, { waitUntil() {} });

test("the view's route: the stop's words, a link to the page at that stop, and the question", async () => {
  const e = await claimedHouse();
  const q = `?t=${encodeURIComponent("Human Fly")}&a=${encodeURIComponent("The Cramps")}&uri=${encodeURIComponent(uri(2))}&slug=cramps-1q5j4r`;
  const r = await get(e, `${KEY}/about${q}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const html = await r.text();
  assert.match(html, /The Librarian · Stop one/);
  assert.match(html, /Memphis, October 1977/);
  assert.match(html, /Then the landmark\./);
  assert.match(html, new RegExp(`href="/buttons/${KEY}/programs/cramps-1q5j4r\\?from=the-librarian#stop-1"`));
  assert.match(html, /href="https:\/\/claude\.ai\/new\?q=Tell%20me%20about%20the%20song%20%E2%80%9CHuman%20Fly%E2%80%9D%20by%20The%20Cramps\./);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);

  // A song from no page: only the question. A bad slug reads nothing.
  const bare = await (await get(e, `${KEY}/about?t=Mr.%20Big%20Stuff&a=Jean%20Knight&uri=${encodeURIComponent(uri(7))}`)).text();
  assert.ok(!bare.includes("nbabw"));
  assert.match(bare, /Ask Claude about this song/);
  assert.ok(!(await (await get(e, `${KEY}/about?t=x&slug=..%2Fhouse`)).text()).includes("nbabw"));

  // A ChatGPT house asks ChatGPT.
  const g = await (await get(await claimedHouse({ CURATOR: "chatgpt" }), `${KEY}/about${q}`)).text();
  assert.match(g, /href="https:\/\/chatgpt\.com\/\?q=/);
  assert.match(g, /Ask ChatGPT about this song/);

  // The page's key, and a GET only.
  assert.equal((await get(e, `wrongkey123456/about${q}`)).status, 404);
  assert.equal((await get(e, `${KEY}/about${q}`, { method: "POST", body: new FormData() })).status, 405);
});

test("the Shelf page anchors each stop, and the bar's panel carries the chip, hidden until Spotify plays", async () => {
  const html = renderProgram({ ...RECORD, slug: "cramps-1q5j4r", created: "2026-11-15T04:14:00Z", tracks: 4,
    sections: RECORD.sections.map((s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, artist: "The Cramps", duration: "2:16" })) })) });
  assert.match(html, /<section class="mvt mvt-1" id="stop-1">/);
  assert.match(html, /<section class="mvt mvt-3 bare" id="stop-3">/);
  const e = await claimedHouse();
  const page = await (await get(e, `${KEY}/soul`)).text();
  assert.match(page, /<button type="button" class="nbabout" data-about hidden>/);
  assert.match(page, /About this song<\/button>/);
});

// A request set kept as a page afterwards: its holder names the request, and
// the page is the preset's `current:` pointer. The bar found no page for the
// Cramps set on the night MC-43 went live; the DJ row and the About view
// both rest on this.
test("a request set kept as a page is found through the preset's pointer", async () => {
  const { playingWho } = await import("../now.js");
  const e = makeEnv();
  await e.PROGRAMS.put("program:cramps-1q5j4r", JSON.stringify(RECORD));
  const band = { guest: true, catalog: "spotify", btn: 1 };
  const holders = (ref) => ({ spotify: { guest: { playlist: "REQ" }, on: { dj: "the-librarian", ref } } });
  assert.equal((await playingWho(e, null, null, band, holders("request 1df0"))).program, undefined, "no pointer yet: no page");
  await e.PROGRAMS.put("current:REQ", "cramps-1q5j4r");
  const who = await playingWho(e, null, null, band, holders("request 1df0"));
  assert.deepEqual(who.program, { slug: "cramps-1q5j4r", title: RECORD.title });
  assert.equal(who.name, "The Librarian");
  // A holder that names its page keeps it; one that names neither reads no pointer.
  assert.equal((await playingWho(e, null, null, band, holders("cramps-1q5j4r"))).program.slug, "cramps-1q5j4r");
  assert.equal((await playingWho(e, null, null, band, holders("talk"))).program, undefined);
});

// A house with no curator (the first two levels, a forum user on ChatGPT):
// the link follows the app that fetched the house's tools at its door.
test("with no curator, the link asks the app that talks to the house", async () => {
  assert.equal(assistantOf({}), null);
  assert.equal(assistantOf({ connector: { fetched: { chatgpt: { at: "2026-11-14T20:00:00Z" } } } }), "chatgpt");
  assert.equal(assistantOf({ connector: { fetched: { chatgpt: { at: "2026-11-14T20:00:00Z" }, claude: { at: "2026-11-14T21:00:00Z" } } } }), "claude");
  assert.equal(assistantOf({ curator: { fetched: { chatgpt: { at: "2026-11-14T20:00:00Z" } } } }), null, "the curator's door is not the owner's app");
  const e = await claimedHouse();
  e.CURATOR = undefined; e.REQUEST_ROUTINE_ID = undefined;
  // ChatGPT fetched the tools at the owner's door, as a plugin's Refresh tools does.
  const { houseFetch } = await import("../settings.js");
  await houseFetch(e, "/tool-fetch", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ door: "connector", client: "chatgpt", stamp: "abc123", ua: "openai-mcp/1.0" }) });
  const html = await (await get(e, `${KEY}/about?t=Human%20Fly&a=The%20Cramps`)).text();
  assert.match(html, /Ask ChatGPT about this song/);
  assert.ok(!/caution note/.test(html), "ChatGPT shows none");
});
