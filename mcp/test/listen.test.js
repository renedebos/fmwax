// A PLAYLIST OF ITS OWN FOR A SHELF PAGE (listen.js, 2026-11-14): made from
// the page's fold in the app, linked from the page for good, taken out of the
// library when the page goes.
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { renderProgram } from "../programs.js";
import { dropListen, listenId, listenable, makeListen, syncListen } from "../listen.js";
import { THROTTLE_KEY } from "../services.js";
import { makeEnv, installFetch, PID, buttons } from "./harness.js";

const { callTool } = __test;
const KEY = "abcdefabcdefabcdefabcdef";
const OWN = "OwnPlaylist00000000001";
const uri = (n) => `spotify:track:${String(n).padStart(22, "0")}`;
const SLUG = "the-cramps-1q5j4r";
const RECORD = {
  slug: SLUG, title: "The Cramps on Record, 1977–2002", dj: "The Librarian", shape: "setlist",
  thesis: "Two sides of a single.", created: "2026-11-15T04:14:00Z", tracks: 3, runtime: "9:00",
  playlistId: PID, playlistName: "Requests", loaded: true,
  sections: [{ tracks: [1, 2, 3].map((n) => ({ uri: uri(n), title: `Song ${n}`, artist: "The Cramps", duration: "3:00" })) }],
};
const META = { title: RECORD.title, dj: RECORD.dj, shape: "setlist", created: RECORD.created, tracks: 3, runtime: "9:00",
  catalog: "spotify", image: "https://i.scdn.co/image/abc" };

// Spotify as the harness fakes it, plus the two calls it does not know: the
// create (which must answer an id) and the unfollow.
function fakeSpotify({ fail = {}, noUnfollow = false } = {}) {
  const f = installFetch({ fail });
  const inner = globalThis.fetch;
  const made = [], dropped = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    const path = u.pathname.replace(/^\/v1/, "");
    if (method === "POST" && path === "/me/playlists") {
      f.calls.push(`${method} ${path}`);
      const body = JSON.parse(init.body);
      made.push(body);
      return new Response(JSON.stringify({ id: OWN, name: body.name }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (method === "DELETE" && /^\/playlists\/[^/]+\/followers$/.test(path)) {
      f.calls.push(`${method} ${path}`);
      if (noUnfollow) return new Response("no", { status: 500 });
      dropped.push(path.split("/")[2]);
      return new Response("", { status: 200 });
    }
    return inner(url, init);
  };
  return { ...f, made, dropped };
}

async function shelfEnv(rec = RECORD) {
  const e = makeEnv();
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = buttons({ 3: PID });
  await e.PROGRAMS.put(`program:${rec.slug}`, JSON.stringify(rec), { metadata: META });
  return e;
}
const record = async (e, slug = SLUG) => e.PROGRAMS.get(`program:${slug}`, { type: "json" });
const withOwn = { ...RECORD, listen: { catalog: "spotify", id: OWN, at: "2026-11-15T07:00:00Z" } };

test("making it: a public playlist named as the page, its songs in order, read back, and kept on the record", async () => {
  const e = await shelfEnv();
  const f = fakeSpotify();
  try {
    const out = await makeListen(e, SLUG, { remaining: 6 });
    assert.deepEqual(out, { code: "ok", id: OWN });
    assert.equal(f.made.length, 1);
    assert.equal(f.made[0].name, RECORD.title);
    assert.equal(f.made[0].public, true, "Spotify has no unlisted: a private one opens for nobody else");
    assert.match(f.made[0].description, /The Librarian’s set, with its notes: https:\/\/example\.test\/programs\/the-cramps-1q5j4r/);
    assert.deepEqual(f.state.contents.map((t) => t.uri), [uri(1), uri(2), uri(3)]);
    assert.deepEqual(f.calls.filter((c) => !c.includes("token")), [
      "POST /me/playlists", `PUT /playlists/${OWN}/items`, `GET /playlists/${OWN}/items`]);
    const rec = await record(e);
    assert.equal(listenId(rec), OWN);
    assert.equal(rec.title, RECORD.title, "the rest of the record as it was");
    // The Shelf's row (the record's metadata) survives the rewrite, cover and all.
    const meta = (await e.PROGRAMS.getWithMetadata(`program:${SLUG}`)).metadata;
    assert.equal(meta.image, META.image);
    assert.equal(meta.title, RECORD.title);
    assert.equal(await e.PROGRAMS.get(`listen-making:${SLUG}`), null, "the mark is cleared");

    // Asked again: it has one, and Spotify is not asked.
    const n = f.calls.length;
    assert.deepEqual(await makeListen(e, SLUG, { remaining: 6 }), { code: "had", id: OWN });
    assert.equal(f.calls.length, n);
  } finally { f.restore(); }
});

test("a making that fails leaves nothing behind: the new playlist is taken out again, the record untouched", async () => {
  const e = await shelfEnv();
  const f = fakeSpotify({ fail: { [`PUT /playlists/${OWN}/items`]: "boom" } });
  try {
    const out = await makeListen(e, SLUG, { remaining: 6 });
    assert.equal(out.code, "failed");
    assert.deepEqual(f.dropped, [OWN], "not left on the profile half made");
    assert.equal(listenId(await record(e)), null);
    assert.equal(await e.PROGRAMS.get(`listen-making:${SLUG}`), null);
  } finally { f.restore(); }
});

test("it is not made for a page that cannot have one, in Spotify's stop, or twice at once", async () => {
  const f = fakeSpotify();
  try {
    // No such page.
    assert.equal((await makeListen(await shelfEnv(), "nope", { remaining: 6 })).code, "gone");
    // A Tidal set, an archive set, a set with a song from elsewhere, an empty one.
    const tidal = { ...RECORD, sections: [{ tracks: [{ uri: "tidal:track:123" }] }] };
    assert.equal(listenable(tidal), false);
    assert.equal((await makeListen(await shelfEnv(tidal), SLUG, { remaining: 6 })).code, "no");
    assert.equal(listenable({ ...RECORD, archive: { key: "k" } }), false);
    assert.equal(listenable({ ...RECORD, sections: [{ tracks: [{ uri: uri(1) }, { uri: "tidal:track:9" }] }] }), false);
    assert.equal(listenable({ ...RECORD, sections: [{ tracks: [] }] }), false);
    assert.equal(listenable(RECORD), true);
    // Spotify's quota stop: said, nothing sent.
    const stopped = await shelfEnv();
    const until = Date.now() + 20 * 60000;
    await stopped.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until }));
    assert.deepEqual(await makeListen(stopped, SLUG, { remaining: 6 }), { code: "quota", until });
    // Another press is making it.
    const busy = await shelfEnv();
    await busy.PROGRAMS.put(`listen-making:${SLUG}`, "1");
    assert.equal((await makeListen(busy, SLUG, { remaining: 6 })).code, "busy");
    assert.equal(f.made.length, 0, "Spotify was asked for none of these");
  } finally { f.restore(); }
});

test("the id is read off the record only in Spotify's shape", () => {
  assert.equal(listenId(withOwn), OWN);
  assert.equal(listenId(RECORD), null);
  assert.equal(listenId({ listen: { catalog: "spotify", id: "short" } }), null);
  assert.equal(listenId({ listen: { catalog: "tidal", id: OWN } }), null);
  assert.equal(listenId({ listen: { catalog: "spotify", id: `${OWN}"><script>` } }), null);
});

test("the page offers its own playlist whether or not a preset holds the set", () => {
  const link = `<span class="listen"><a href="https://open.spotify.com/playlist/${OWN}" rel="noopener noreferrer">Open in Spotify ↗</a></span>`;
  // Off the preset: the link, and the footer says what it is.
  const off = renderProgram(withOwn, { onAir: false });
  assert.ok(off.includes(link));
  assert.match(off, /Not on a preset right now<\/span> — it was, when it was published, and the preset has moved on since\. The link at the top opens the whole set in Spotify, as a playlist of its own\. Every track above links to the record itself\./);
  assert.ok(!off.includes("<span>on Requests</span>"), "which preset holds it is said only while one does");
  // On the preset: the page's own, not the preset's, which the next set replaces.
  const on = renderProgram(withOwn, { onAir: true });
  assert.ok(on.includes(link));
  assert.ok(on.includes("<span>on Requests</span>"));
  assert.ok(!on.includes(`open.spotify.com/playlist/${PID}`));
  // A page with none reads as it always did.
  const plainOff = renderProgram(RECORD, { onAir: false });
  assert.ok(!plainOff.includes('class="listen"'));
  assert.ok(!plainOff.includes("a playlist of its own"));
  assert.ok(renderProgram(RECORD, { onAir: true }).includes(`open.spotify.com/playlist/${PID}`));
  // A record whose id is not a Spotify id draws no link.
  assert.ok(!renderProgram({ ...RECORD, listen: { catalog: "spotify", id: "x" } }, { onAir: false }).includes('class="listen"'));
  // The public page never carries the fold: it has no way to make anything.
  assert.ok(!off.includes("plisten") && !plainOff.includes("Make a Spotify playlist"));
});

const page = async (e, q = "") => (await worker.fetch(new Request(`https://x/buttons/${KEY}/programs/${SLUG}${q}`), e)).text();
const press = (e, path, body, init = {}) => worker.fetch(new Request(`https://x/notes/${KEY}/${path}`,
  { method: "POST", body: new URLSearchParams(body), ...init }), e);

test("the page's fold in the app makes it, and the page then carries the link in place of the fold", async () => {
  const e = await shelfEnv();
  const f = fakeSpotify();
  try {
    const before = await page(e);
    assert.match(before, new RegExp(`<details class="plisten"><summary>Make a Spotify playlist of this set…</summary><form method="post" action="/notes/${KEY}/listen"><input type="hidden" name="slug" value="${SLUG}">`));
    assert.match(before, /The playlist is public\. Anyone with the link can open it, and it shows on your Spotify profile\./);
    assert.ok(!before.includes('class="listen"'));

    const r = await press(e, "listen", { slug: SLUG, from: "the-librarian", dj: "the-librarian" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}/programs/${SLUG}?listen=ok&from=the-librarian&dj=the-librarian`,
      "back to the page as it was opened: from its DJ, the Shelf's filter kept");
    assert.equal(f.made.length, 1);

    const after = await page(e, "?listen=ok");
    assert.ok(after.includes(`href="https://open.spotify.com/playlist/${OWN}"`));
    assert.match(after, /<p class="plsaid" role="status">A playlist of this set is on Spotify now\./);
    assert.ok(!after.includes('class="plisten"'), "one playlist a page");
    assert.match(after, /Its own Spotify playlist leaves your library and profile too\. There is no undo\./);
    // The words only for a state of ours.
    assert.ok(!(await page(e, "?listen=%3Cscript%3E")).includes('class="plsaid"'));

    // The public page: the link, no fold, and a tag that a browser holding the old page does not match.
    const pub = await worker.fetch(new Request(`https://x/programs/${SLUG}`), e);
    assert.match(pub.headers.get("etag"), /-own"$/);
    const html = await pub.text();
    assert.ok(html.includes(`href="https://open.spotify.com/playlist/${OWN}"`));
    assert.ok(!html.includes("plisten"));

    // Pressed again (an old page): nothing second is made. A way back that
    // is not one of the house's DJs is dropped, never echoed into the address.
    const again = await press(e, "listen", { slug: SLUG, from: "//evil.test" });
    assert.match(again.headers.get("location"), /\?listen=had$/);
    assert.equal(f.made.length, 1);
  } finally { f.restore(); }
});

test("the form's target keeps the chooser's discipline: the key, a POST, the same origin, a slug of ours", async () => {
  const e = await shelfEnv();
  const f = fakeSpotify();
  try {
    assert.equal((await worker.fetch(new Request(`https://x/notes/wrongkey12345/listen`, { method: "POST", body: new URLSearchParams({ slug: SLUG }) }), e)).status, 404);
    assert.equal((await worker.fetch(new Request(`https://x/notes/${KEY}/listen`), e)).status, 405);
    assert.equal((await press(e, "listen", { slug: SLUG }, { headers: { origin: "https://evil.test" } })).status, 403);
    assert.equal((await press(e, "listen", { slug: "../x" })).status, 400);
    assert.equal((await press(e, "listen", { slug: "not-on-the-shelf" })).status, 404);
    assert.equal(f.made.length, 0);
    // What went wrong is said on the page, in a line.
    await e.PROGRAMS.put(THROTTLE_KEY, JSON.stringify({ until: Date.now() + 600000 }));
    const r = await press(e, "listen", { slug: SLUG });
    assert.match(r.headers.get("location"), /\?listen=quota$/);
    assert.match(await page(e, "?listen=quota"), /Spotify is limiting this account’s requests just now, so the playlist was not made\./);
  } finally { f.restore(); }
});

test("deleting the page takes its playlist out of the library first, and keeps the page when Spotify will not", async () => {
  // The Shelf's Delete.
  const e = await shelfEnv(withOwn);
  const f = fakeSpotify();
  try {
    const r = await press(e, "unkeep", { slug: SLUG });
    assert.match(r.headers.get("location"), /put=removed/);
    assert.deepEqual(f.dropped, [OWN]);
    assert.equal(await record(e), null);
  } finally { f.restore(); }

  const kept = await shelfEnv(withOwn);
  const g = fakeSpotify({ noUnfollow: true });
  try {
    const r = await press(kept, "unkeep", { slug: SLUG });
    assert.match(r.headers.get("location"), /put=removefail/);
    assert.equal(listenId(await record(kept)), OWN, "the page and its id are still there for the next press");
    // The tool, the same: refused in words, nothing deleted.
    await assert.rejects(() => callTool(kept, "unpublish_program", { id: SLUG, confirm: true }, { remaining: 40 }),
      /NOTHING WAS CHANGED: the page is still up/);
    assert.ok(await record(kept));
  } finally { g.restore(); }

  const viaTool = await shelfEnv(withOwn);
  const h = fakeSpotify();
  try {
    const out = await callTool(viaTool, "unpublish_program", { id: SLUG, confirm: true }, { remaining: 40 });
    assert.deepEqual(h.dropped, [OWN]);
    assert.match(out.note, /own Spotify playlist was taken out of the account's library/);
    assert.equal(await record(viaTool), null);
    // A page with none: no call, and the old words.
    const plain = await shelfEnv();
    const n = h.calls.length;
    const o = await callTool(plain, "unpublish_program", { id: SLUG, confirm: true }, { remaining: 40 });
    assert.ok(!/own Spotify playlist/.test(o.note));
    assert.equal(h.calls.filter((c) => c.startsWith("DELETE")).length, 1);
    assert.ok(h.calls.length >= n);
    // A page with none is clean already; a house no longer on Spotify cannot
    // ask, and its page must still be deletable.
    assert.equal(await dropListen(plain, RECORD, { remaining: 4 }), true);
    const before = h.calls.length;
    assert.equal(await dropListen({ ...plain, SPOTIFY_CLIENT_ID: "" }, withOwn, { remaining: 4 }), true);
    assert.equal(h.calls.length, before, "nothing was asked");
  } finally { h.restore(); }
});

test("a revised set's own playlist follows the page, and says so when it could not", async () => {
  const revised = { ...withOwn, sections: [{ tracks: [3, 1].map((n) => ({ uri: uri(n) })) }] };
  const e = await shelfEnv(revised);
  const f = fakeSpotify();
  try {
    assert.equal(await syncListen(e, revised, { title: "A New Name" }, { remaining: 6 }), null);
    assert.deepEqual(f.state.contents.map((t) => t.uri), [uri(3), uri(1)]);
    assert.deepEqual(f.nameWrites, [{ id: OWN, name: "A New Name" }]);
    // No playlist of its own: nothing is asked.
    const n = f.calls.length;
    assert.equal(await syncListen(e, RECORD, {}, { remaining: 6 }), null);
    assert.equal(f.calls.length, n);
  } finally { f.restore(); }
  const g = fakeSpotify({ fail: { [`PUT /playlists/${OWN}/items`]: "boom" } });
  try {
    assert.match(await syncListen(e, revised, {}, { remaining: 6 }), /could NOT be brought up to date[\s\S]*still plays the set as it was/);
  } finally { g.restore(); }
});

// ITS UNDO (the owner, 2026-11-14: "build it"): the fold at the page's foot.
test("the page's foot removes the playlist and the page goes back to having none", async () => {
  const e = await shelfEnv(withOwn);
  const f = fakeSpotify();
  try {
    const before = await page(e);
    assert.match(before, new RegExp(`<div class="pdel punl"><details><summary>Remove its Spotify playlist…</summary><form method="post" action="/notes/${KEY}/unlisten"><input type="hidden" name="slug" value="${SLUG}">`));
    assert.match(before, /Someone who already has the link can still open it: Spotify itself deletes nothing\./);
    assert.ok(before.indexOf("Remove its Spotify playlist") > before.indexOf('class="endmatter"'), "at the foot, never beside Play");
    assert.ok(before.indexOf("Remove its Spotify playlist") < before.indexOf("Delete this program"), "above Delete");

    const r = await press(e, "unlisten", { slug: SLUG, from: "the-librarian" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `/buttons/${KEY}/programs/${SLUG}?listen=removed&from=the-librarian`);
    assert.deepEqual(f.dropped, [OWN]);
    const rec = await record(e);
    assert.equal(listenId(rec), null);
    assert.ok(!("listen" in rec), "the record forgets it");
    assert.equal(rec.title, RECORD.title);
    assert.equal((await e.PROGRAMS.getWithMetadata(`program:${SLUG}`)).metadata.image, META.image, "the Shelf's row as it was");

    const after = await page(e, "?listen=removed");
    assert.match(after, /<p class="plsaid" role="status">The playlist is out of your Spotify library and off your profile\./);
    assert.ok(after.includes('<details class="plisten">'), "it can have one made again");
    assert.ok(!after.includes("Remove its Spotify playlist"));
    assert.ok(!after.includes(`open.spotify.com/playlist/${OWN}`));
    // The public page: no link any more, and its tag moved back.
    const pub = await worker.fetch(new Request(`https://x/programs/${SLUG}`), e);
    assert.ok(!/-own"$/.test(pub.headers.get("etag")));
    assert.ok(!(await pub.text()).includes(OWN));

    // Pressed again (an old page): it has none, nothing is asked.
    const n = f.calls.length;
    assert.match((await press(e, "unlisten", { slug: SLUG })).headers.get("location"), /\?listen=none$/);
    assert.equal(f.calls.length, n);
    assert.equal((await press(e, "unlisten", { slug: "not-on-the-shelf" })).status, 404);
    assert.equal((await worker.fetch(new Request(`https://x/notes/${KEY}/unlisten`), e)).status, 405);
  } finally { f.restore(); }

  // Spotify will not: nothing changes, and the page says so.
  const kept = await shelfEnv(withOwn);
  const g = fakeSpotify({ noUnfollow: true });
  try {
    assert.match((await press(kept, "unlisten", { slug: SLUG })).headers.get("location"), /\?listen=stays$/);
    assert.equal(listenId(await record(kept)), OWN);
    const html = await page(kept, "?listen=stays");
    assert.match(html, /Spotify would not remove the playlist just now\. Nothing was changed\./);
    assert.ok(html.includes("Remove its Spotify playlist"), "the fold is still there for the next press");
  } finally { g.restore(); }

  // The public page never carries the fold.
  assert.ok(!renderProgram(withOwn, { onAir: false }).includes("Remove its Spotify playlist"));
});
