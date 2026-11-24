// FIND MORE (readfind.js, qr.js; the owner, 2026-11-22): a press asks the
// curator to search the web for the song playing; save_reading hands the
// pieces in; the house checks each address and keeps them by song.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { FIND_DAY_MAX, FIND_OPEN_MAX, checkLink, fileFind, findNews, findItems, findJobs, findLine, findSlug, findState, findUrl, saveFind } from "../readfind.js";
import { qrMatrix, qrSvg } from "../qr.js";
import { AGENT_TOOLS, toolsWithMeta } from "../toollist.js";
import { aboutView, askLink } from "../about.js";
import { renderTvCode, renderTvRead } from "../tvpages.js";

function kvOf() {
  const m = new Map();
  return { m, get: async (k, o) => (m.has(k) ? (o?.type === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix, limit = 1000 }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) }) };
}
const envOf = (extra = {}) => ({ PROGRAMS: kvOf(), REQUEST_ROUTINE_ID: "trig_x", HOUSE_TZ: "America/Los_Angeles", ...extra });
const SONG = { title: "October - 2023 Remaster", artist: "Okonski, Someone Else", album: "Magnolia" };
const piece = (over = {}) => ({ about: "album", kind: "interview", lang: "en", source: "Glide Magazine", title: "Steve Okonski Talks", url: "https://glidemagazine.com/310508/steve-okonski-talks/", ...over });

// The house's own look at an address, answered here.
function withFetch(answers, run) {
  const real = globalThis.fetch, asked = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input); asked.push({ url, redirect: init?.redirect, method: init?.method });
    const a = answers(url);
    if (a === "throw") throw new TypeError("fetch failed");
    return new Response("", { status: a });
  };
  return run(asked).finally(() => { globalThis.fetch = real; });
}

test("a song's key is its first artist and its plain title; a house with no curator offers nothing", async () => {
  assert.equal(findSlug(SONG), findSlug({ title: "October", artist: "Okonski" }));
  assert.equal(findSlug({ title: "", artist: "Okonski" }), null);
  assert.deepEqual(await findState(envOf(), SONG), { slug: findSlug(SONG), state: "ask" });
  assert.equal(await findState({ PROGRAMS: kvOf() }, SONG), null);
  assert.equal((await fileFind({ PROGRAMS: kvOf() }, SONG)).code, "no-curator");
});

test("an address the house will show: https, an ordinary site, not a reference page, a shop or the house itself", () => {
  assert.equal(findUrl("https://glidemagazine.com/310508/x/#top"), "https://glidemagazine.com/310508/x/");
  for (const bad of ["http://glidemagazine.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://user:pw@site.com/x", "https://site.com:8443/x",
    "https://en.wikipedia.org/wiki/X", "https://www.discogs.com/x", "https://genius.com/x", "https://open.spotify.com/track/1", "https://myhouse.org/buttons/k",
    "https://x.workers.dev/y", "javascript:alert(1)", "https://router.lan/x", "not a url", `https://site.com/${"a".repeat(260)}`]) {
    assert.equal(findUrl(bad, "myhouse.org"), null, bad);
  }
});

test("what the curator hands in is held to known labels and plain words, the song's pieces first, six at most", () => {
  const got = findItems([
    piece({ about: "artist", title: "An <b>artist</b> piece\u0007" }), piece({ about: "song", url: "https://a.example.org/1", kind: "FEATURE", lang: "NL" }),
    piece({ about: "everything", url: "https://a.example.org/2" }), piece({ kind: "review", url: "https://a.example.org/3" }),
    piece({ url: "https://en.wikipedia.org/wiki/Okonski" }), piece(), piece({ url: "https://a.example.org/4", title: "" }),
    ...[5, 6, 7, 8, 9, 10].map((n) => piece({ url: `https://a.example.org/${n}`, paywalled: n === 5 })),
  ]);
  assert.equal(got.length, 6);
  assert.deepEqual(got[0], { about: "song", kind: "feature", lang: "nl", source: "Glide Magazine", title: "Steve Okonski Talks", url: "https://a.example.org/1" });
  assert.equal(got.find((p) => p.about === "artist").title, "An artist piece");
  assert.ok(got.every((p) => !/wikipedia|example\.org\/[234]$/.test(p.url)));
  assert.equal(findLine(got[0]), "About the song · Feature · Glide Magazine · Dutch");
  assert.equal(findLine(piece({ paywalled: true })), "About the album · Interview · Glide Magazine · may ask for a subscription");
  assert.deepEqual(findItems("nonsense"), []);
});

test("a press files one job, rings the curator, and is not filed twice; three wait at most, twelve a day", async () => {
  const env = envOf(), rung = [];
  const ring = async (id) => { rung.push(id); return true; };
  const a = await fileFind(env, SONG, { ring });
  assert.equal(a.code, "asked"); assert.deepEqual(rung, [`reading-${a.slug}`]);
  assert.equal((await fileFind(env, SONG, { ring })).code, "already");
  assert.equal((await findState(env, SONG)).state, "asked");
  assert.deepEqual((await findJobs(env)).map((j) => [j.job_id, j.song, j.artist, j.album]), [[a.slug, "October", "Okonski, Someone Else", "Magnolia"]]);
  for (let i = 1; i < FIND_OPEN_MAX; i++) assert.equal((await fileFind(env, { title: `Song ${i}`, artist: "Act" }, { ring })).code, "asked");
  assert.equal((await fileFind(env, { title: "One more", artist: "Act" }, { ring })).code, "full");
  // A ring that fails still leaves the job for the hourly look.
  const env2 = envOf();
  assert.deepEqual(await fileFind(env2, SONG, { ring: async () => { throw new Error("no"); } }), { code: "asked", slug: a.slug, rung: false });
  await env2.PROGRAMS.put("readfind:day", JSON.stringify({ day: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()), n: FIND_DAY_MAX }));
  assert.equal((await fileFind(env2, { title: "Another", artist: "Act" })).code, "cap");
});

test("save_reading keeps what answers, drops what is gone, follows nothing, and settles the job once", async () => {
  const env = envOf();
  const { slug } = await fileFind(env, SONG);
  await withFetch((u) => (/gone/.test(u) ? 404 : /nosite/.test(u) ? "throw" : /refuses/.test(u) ? 403 : /moved/.test(u) ? 301 : 200), async (asked) => {
    const out = await saveFind(env, { job_id: slug, items: [piece(), piece({ url: "https://a.example.org/gone" }), piece({ url: "https://nosite.example.org/x" }),
      piece({ url: "https://refuses.example.org/x", about: "song" }), piece({ url: "https://moved.example.org/x" }), piece({ url: "https://en.wikipedia.org/wiki/X" })] });
    assert.equal(out.ok, true); assert.equal(out.kept, 3); assert.equal(out.left_out, 1);
    assert.deepEqual(out.gone, ["https://a.example.org/gone", "https://nosite.example.org/x"]);
    assert.ok(asked.length === 5 && asked.every((a) => a.redirect === "manual" && a.method === "GET"));
  });
  const st = await findState(env, SONG);
  assert.equal(st.state, "found");
  assert.deepEqual(st.items.map((p) => [p.about, p.url, !!p.checked]), [["song", "https://refuses.example.org/x", false],
    ["album", "https://glidemagazine.com/310508/steve-okonski-talks/", true], ["album", "https://moved.example.org/x", true]]);
  assert.deepEqual(await findJobs(env), []);
  await assert.rejects(() => saveFind(env, { job_id: slug, items: [] }), /No reading job/);
  await assert.rejects(() => saveFind(env, { job_id: "../x", items: [] }), /job_id/);
  assert.equal((await fileFind(env, SONG)).code, "found");
});

test("every piece gone leaves the job open; an empty list is 'nothing found', kept and said", async () => {
  const env = envOf();
  const { slug } = await fileFind(env, SONG);
  await withFetch(() => 404, async () => {
    const out = await saveFind(env, { job_id: slug, items: [piece()] });
    assert.equal(out.ok, false); assert.match(out.note, /still open/);
    assert.equal(await checkLink(env, "https://a.example.org/x"), "gone");
  });
  assert.equal((await findState(env, SONG)).state, "asked");
  assert.equal((await saveFind(env, { job_id: slug, items: [] })).kept, 0);
  assert.equal((await findState(env, SONG)).state, "none");
});

test("save_reading is the curator's only in a house with a curator", () => {
  assert.ok(AGENT_TOOLS.has("save_reading"));
  assert.ok(!toolsWithMeta({}).some((t) => t.name === "save_reading"));
  const t = toolsWithMeta({ REQUEST_ROUTINE_ID: "trig_x" }).find((x) => x.name === "save_reading");
  assert.deepEqual(t.inputSchema.required, ["job_id", "items"]);
});

test("the phone's About this song: the button, the wait, the pieces as links, every word as text", () => {
  const ask = askLink("claude", "October", "Okonski");
  const btn = aboutView({ title: 'Oct"ober', artist: "Okonski", ask, find: { slug: "okonski-october", state: "ask", album: "Magnolia" } });
  assert.match(btn, /^<span hidden data-find-slug="okonski-october"><\/span>/, "the view names its song's search, for the dot");
  assert.match(btn, /<button type="button" class="nbabfind" data-readfind data-t="Oct&quot;ober" data-a="Okonski" data-al="Magnolia">/);
  assert.match(aboutView({ title: "October", artist: "Okonski", ask, find: { state: "asked" } }), /The curator is searching the web/);
  const got = aboutView({ title: "October", artist: "Okonski", ask, find: { state: "found", items: [
    { ...piece({ title: "<img src=x>" }), line: "About the album · Interview · Glide Magazine" }, { ...piece({ url: "javascript:alert(1)" }), line: "x" }] } });
  assert.match(got, /href="https:\/\/glidemagazine\.com\/310508\/steve-okonski-talks\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(got, /&lt;img src=x&gt;/);
  assert.doesNotMatch(got, /javascript:|data-readfind/);
  assert.doesNotMatch(aboutView({ title: "October", artist: "Okonski", ask }), /More on the web/);
});

test("the TV's list: the web's pieces open as a code, the button is a form to the house, the wait says so", () => {
  const room = { name: "Pro Plus", slug: "pro-plus" }, song = { title: "October", artist: "Okonski", album: "Magnolia" };
  const args = { base: "/buttons/k", room, name: "Okonski", items: [], song, songQ: "a=Okonski&t=October&al=Magnolia" };
  const found = renderTvRead({ ...args, find: { slug: "okonski-october", state: "found", items: [{ ...piece(), line: "About the album · Interview · Glide Magazine" }] } });
  assert.match(found, /href="\/buttons\/k\/tv\/read\?room=pro-plus&amp;a=Okonski&amp;t=October&amp;al=Magnolia&amp;s=okonski-october&amp;x=0"/);
  assert.match(found, /On other sites · opens on your phone/);
  assert.doesNotMatch(found, /<a [^>]*href="https:/, "the TV never links out");
  const askPage = renderTvRead({ ...args, find: { slug: "okonski-october", state: "ask" } });
  assert.match(askPage, /<form class="rask" method="post" action="\/buttons\/k\/readfind">/);
  assert.match(askPage, /name="t" value="October"/);
  assert.match(renderTvRead({ ...args, find: { state: "asked" }, said: "Asked." }), /data-wait>The curator is searching the web for “October”/);
  const code = renderTvCode({ back: "/buttons/k/tv/read?a=Okonski", item: piece(), line: "About the album", svg: qrSvg(piece().url) });
  assert.match(code, /<svg xmlns=/); assert.match(code, /glidemagazine\.com/); assert.doesNotMatch(code, /<a [^>]*href="https:/);
});

test("the code: the standard's sizes and fixed marks, the same bits every time, nothing for words too long", () => {
  const m = qrMatrix("https://glidemagazine.com/310508/steve-okonski-talks/");
  assert.equal(m.length, 17 + 4 * 3, "53 bytes fit version 3");
  // The three corner squares, and the one dark cell beside the bottom-left one.
  for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) {
    assert.deepEqual(m[r].slice(c, c + 7), [1, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(m[r + 3].slice(c, c + 7), [1, 0, 1, 1, 1, 0, 1]);
  }
  assert.equal(m[m.length - 8][8], 1);
  // Level L with mask 0 is the standard's format word 111011111000100, read along row 8.
  assert.deepEqual([m[8][0], m[8][1], m[8][2], m[8][3], m[8][4], m[8][5], m[8][7], m[8][8]], [1, 1, 1, 0, 1, 1, 1, 1]);
  // Checked 2026-11-22 by reading 47 of these codes back with a QR reader
  // (lengths 1 to 271, every version): this pins those bits.
  assert.equal(createHash("sha256").update(m.map((r) => r.join("")).join("\n")).digest("hex").slice(0, 16), HASH);
  assert.equal(qrMatrix("x".repeat(271)).length, 57);
  assert.equal(qrMatrix("x".repeat(272)), null);
  assert.equal(qrSvg("x".repeat(272)), "");
  assert.match(qrSvg("hi", { label: 'a "code"' }), /aria-label="a &quot;code&quot;"/);
});
const HASH = "5029e2a20950a97a";

// THE ROUTES, through the worker.
import worker from "../worker.js";
import { makeEnv } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
function house() {
  const e = makeEnv();
  if (typeof e.PROGRAMS.list !== "function" || typeof e.PROGRAMS.delete !== "function") e.PROGRAMS = kvOf();
  return Object.assign(e, { PROGRAM_LIBRARY_KEY: KEY, HOUSE_TZ: "America/Los_Angeles", ROOM_DEVICES: JSON.stringify(["Pro Plus"]),
    WIIM_SPEAKERS: JSON.stringify({ "Pro Plus": "192.168.4.45" }), REQUEST_ROUTINE_ID: "trig_x", REQUEST_ROUTINE_TOKEN: "t".repeat(40) });
}
const call = (e, path, init) => worker.fetch(new Request(`https://x.test/buttons/${KEY}${path}`, init), e, { waitUntil() {} });

test("the press: from the phone as JSON and from the TV as a form, only from the house's own pages; then the pages say so", async () => {
  const e = house();
  await withFetch(() => 200, async (asked) => {
    const body = () => new URLSearchParams({ t: "October", a: "Okonski", al: "Magnolia", room: "pro-plus" });
    assert.equal((await call(e, "/readfind")).status, 405);
    assert.equal((await call(e, "/readfind", { method: "POST", body: body(), headers: { accept: "application/json" } })).status, 403);
    assert.equal((await call(e, "/readfind", { method: "POST", body: body(), headers: { origin: "https://evil.example" } })).status, 403);
    const a = await (await call(e, "/readfind", { method: "POST", body: body(), headers: { accept: "application/json", origin: "https://x.test" } })).json();
    assert.equal(a.code, "asked"); assert.match(a.say, /searching the web/);
    assert.ok(asked.some((x) => /routines\/trig_x\/fire$/.test(x.url)), "the curator was rung");
    const again = await call(e, "/readfind", { method: "POST", body: body(), redirect: "manual" });
    assert.equal(again.status, 303);
    assert.equal(again.headers.get("location"), `/buttons/${KEY}/tv/read?room=pro-plus&a=Okonski&t=October&al=Magnolia&fc=already`);
    const page = await (await call(e, "/tv/read?room=pro-plus&a=Okonski&t=October&al=Magnolia&fc=already")).text();
    assert.match(page, /Already asked/); assert.match(page, /data-wait>/);
    assert.match(await (await call(e, "/about?t=October&a=Okonski")).text(), /The curator is searching the web/);
    assert.deepEqual((await (await call(e, "/tv/song?uri=x&t=October&a=Okonski")).json()).find, { state: "asked", n: 0, slug: "okonski-october" });
    // Handed in: the list shows it, and its place opens as a code.
    await saveFind(e, { job_id: findSlug({ title: "October", artist: "Okonski" }), items: [piece()] });
    const list = await (await call(e, "/tv/read?room=pro-plus&a=Okonski&t=October")).text();
    assert.match(list, /Steve Okonski Talks/); assert.match(list, /&amp;s=okonski-october&amp;x=0/);
    const code = await (await call(e, "/tv/read?room=pro-plus&a=Okonski&t=October&s=okonski-october&x=0")).text();
    assert.match(code, /Read it on your phone/); assert.match(code, /<svg xmlns=/);
    assert.equal((await call(e, "/tv/read?room=pro-plus&a=Okonski&t=October&s=okonski-october&x=3", { redirect: "manual" })).status, 303);
    assert.match(await (await call(e, "/about?t=October&a=Okonski")).text(), /href="https:\/\/glidemagazine\.com\/310508\/steve-okonski-talks\/"/);
    // THE RESULTS ARE IN: every page's look carries the search that came back.
    const news = await findNews(e, Date.now() + 11_000);
    assert.deepEqual([news.slug, news.title, news.artist, news.album, news.n], ["okonski-october", "October", "Okonski", "Magnolia", 1]);
    const tvNow = await (await call(e, "/tv/now?room=pro-plus")).json();
    assert.equal(tvNow.news?.slug, "okonski-october");
    assert.equal(await findNews(e, Date.now() + 31 * 60_000), null, "gone after half an hour");
  });
});

// THE SHELF'S READING, BY DJ (readindex.js): every piece the house holds,
// under the DJs who played each artist, with keep, remove and search.
import { HIDDEN_MAX, KEPT_MAX, indexGuardian, readingAct, readingCount, readingIndex, readingView } from "../readindex.js";
import { logHeard } from "../week.js";

test("the Shelf's Reading by DJ: who played whom from the week, an artist under two DJs, Not from a DJ, keep, remove, a search, the TV", async () => {
  const e = house();
  const post = (fields) => worker.fetch(new Request(`https://x.test/notes/${KEY}/reading/act`, { method: "POST", body: new URLSearchParams(fields),
    headers: { origin: "https://x.test" }, redirect: "manual" }), e, { waitUntil() {} });
  const get = async (p) => (await worker.fetch(new Request(`https://x.test/notes/${KEY}/reading${p}`), e, { waitUntil() {} })).text();
  await withFetch(() => 200, async () => {
    // The week: Hank played The Budos Band and Sharon Jones; Sessions played Sharon Jones.
    await logHeard(e, [{ dj: "hank", btn: 5, tracks: [["spotify:track:budos1", "The Budos Band — Up From the South"], ["spotify:track:sj1", "Sharon Jones & The Dap-Kings — Tell Me"]] },
      { dj: "sessions", btn: 6, tracks: [["spotify:track:sj2", "Sharon Jones & The Dap-Kings — 100 Days"]] }]);
    // A song searched before the list existed is found by the mend.
    await e.PROGRAMS.put("readfound:the-budos-band-up-from-the-south", JSON.stringify({ at: "2026-11-23T07:43:40.047Z", song: "Up From the South", artist: "The Budos Band",
      items: [piece({ about: "album", kind: "feature", source: "PopMatters", title: "The Budos Band: The Budos Band", url: "https://popmatters.com/budos" }),
        piece({ about: "artist", source: "KEXP", title: "Sound & Vision", url: "https://www.kexp.org/read/x/" })] }));
    assert.equal(await readingCount(e), null, "no list yet");
    // Okonski: searched, and played from an album (no DJ).
    const { slug } = await fileFind(e, { title: "October", artist: "Okonski, Someone", album: "Magnolia" });
    await saveFind(e, { job_id: slug, items: [piece(), piece({ url: "https://a.example.org/2", about: "song" })] });
    await indexGuardian(e, "Sharon Jones & The Dap-Kings", "Sharon Jones", [
      { id: "music/2016/jul/27/sharon-jones-interview", kind: "Interview", title: "Sharon Jones: 'Before I get on stage'", year: "2016", min: 4 },
      { id: "music/2016/nov/20/sharon-jones-obituary", kind: "Obituary", title: "Sharon Jones obituary", year: "2016", min: 5 }]);
    await indexGuardian(e, "Old Act", "Old Act", [{ id: "music/2020/jan/01/old", kind: "Feature", title: "Old", year: "2020", min: 3 }], "2026-09-01T00:00:00.000Z");
    const ix = await readingIndex(e);
    assert.deepEqual(ix.artists.map((a) => [a.name, a.djs.sort(), a.blocks.map((b) => [b.source, b.items.length])]),
      [["Sharon Jones & The Dap-Kings", ["hank", "sessions"], [["guardian", 2]]], ["Okonski", [], [["web", 2]]], ["The Budos Band", ["hank"], [["web", 2]]]]);
    assert.equal(ix.n, 6); assert.equal(await readingCount(e), 6);
    const v = readingView(ix, { dj: "hank" });
    assert.deepEqual([v.all, v.none, v.chips], [6, 2, [{ key: "hank", n: 4 }, { key: "sessions", n: 2 }]]);
    assert.deepEqual(v.artists.map((a) => a.name), ["Sharon Jones & The Dap-Kings", "The Budos Band"]);
    assert.deepEqual(readingView(ix, { dj: "none" }).artists.map((a) => a.name), ["Okonski"]);
    // THE PHONE: the chips, the rows, the switch.
    const list = await get("?dj=hank");
    assert.match(list, /<span class="chip" aria-current="page">Reading<b class="n">6<\/b><\/span>/);
    assert.match(list, /href="\/notes\/abcdefabcdefabcdefabcdef\/reading\?dj=sessions">Sessions<b class="n">2<\/b><\/a>/);
    assert.match(list, /<span class="chip" aria-current="page">Hank<b class="n">4<\/b><\/span>/);
    assert.match(list, /Not from a DJ<b class="n">2<\/b>/);
    assert.match(list, /2 pieces · 1 interview · The Guardian<\/span><span class="rdm2">Also played by Sessions/);
    assert.match(list, /2 pieces · 1 interview · your search<\/span><span class="rdm2">Up From the South · /);
    assert.doesNotMatch(list, /Okonski|Old Act|<script/);
    // An artist: its pieces, each with its menu; keep one, remove one, and the search.
    const budos = await get("?a=budosband&dj=hank");
    assert.match(budos, /<h2 class="rdh">The Budos Band<\/h2>/); assert.match(budos, /Played by<\/span><a class="chip" href="\/notes\/abcdefabcdefabcdefabcdef\/reading\?dj=hank">Hank<\/a>/);
    assert.match(budos, /Up From the South · your search/);
    assert.match(budos, /<input type="hidden" name="pk" value="w:https:\/\/www\.kexp\.org\/read\/x\/">/);
    const kept = await post({ do: "keep", pk: "w:https://www.kexp.org/read/x/", a: "budosband", dj: "hank" });
    assert.equal(kept.status, 303); assert.equal(kept.headers.get("location"), `/notes/${KEY}/reading?a=budosband&dj=hank&said=kept`);
    assert.match(await get("?a=budosband&dj=hank&said=kept"), /Kept: it stays after its source runs out/);
    assert.equal((await post({ do: "remove", pk: "w:https://popmatters.com/budos", a: "budosband" })).headers.get("location"), `/notes/${KEY}/reading?a=budosband&said=removed`);
    assert.equal(await readingCount(e), 5);
    const about = await (await call(e, "/about?t=Up%20From%20the%20South&a=The%20Budos%20Band")).text();
    assert.match(about, /kexp\.org/); assert.doesNotMatch(about, /popmatters/, "a removed piece is gone from About this song too");
    assert.equal((await worker.fetch(new Request(`https://x.test/notes/${KEY}/reading/act`, { method: "POST", body: new URLSearchParams({ do: "remove", pk: "w:https://www.kexp.org/read/x/" }),
      headers: { origin: "https://evil.example" } }), e, { waitUntil() {} })).status, 403);
    // The whole search removed: the song may be searched again; the kept piece stays, under Kept.
    await post({ do: "unsearch", slug: "the-budos-band-up-from-the-south", a: "budosband" });
    assert.equal((await findState(e, { title: "Up From the South", artist: "The Budos Band" })).state, "ask");
    const after = await get("?a=budosband");
    assert.match(after, /<p class="rdlbl">Kept<\/p>/); assert.match(after, /About the artist · Interview · KEXP · kept/);
    assert.match(after, /Stop keeping it/);
    // A search, across every DJ.
    const found = await get("?q=obituary");
    assert.match(found, /<b>1 piece<\/b> match “obituary”/); assert.match(found, /Sharon Jones &amp; The Dap-Kings · Hank, Sessions/);
    assert.doesNotMatch(found, /KEXP/);
    // The Guardian is searched by its name too (Codex).
    assert.match(await get("?q=guardian"), /<b>2 pieces<\/b> match “guardian”/);
    // A missing artist goes back to the list.
    assert.equal((await worker.fetch(new Request(`https://x.test/notes/${KEY}/reading?a=nobody&dj=hank`), e, { waitUntil() {} })).status, 303);
    // THE TV: the same list read only; a web piece opens as a code, back to its artist.
    const tvShelf = await (await call(e, "/tv/shelf?room=pro-plus")).text();
    assert.match(tvShelf, /href="\/buttons\/abcdefabcdefabcdefabcdef\/tv\/reading\?room=pro-plus">Reading · 5<\/a>/);
    const tvList = await (await call(e, "/tv/reading?room=pro-plus&dj=hank")).text();
    assert.match(tvList, /class="pill rchip on" data-f="c:hank"[^>]*aria-current="page">Hank <b>3<\/b>/);
    assert.match(tvList, /href="\/buttons\/abcdefabcdefabcdefabcdef\/tv\/reading\?room=pro-plus&amp;dj=hank&amp;a=budosband"/);
    const tvArt = await (await call(e, "/tv/reading?room=pro-plus&dj=hank&a=budosband")).text();
    assert.match(tvArt, /href="\/buttons\/abcdefabcdefabcdefabcdef\/tv\/read\?room=pro-plus&amp;from=reading&amp;rd=hank&amp;ra=budosband&amp;k=w%3Ahttps%3A%2F%2Fwww\.kexp\.org%2Fread%2Fx%2F"/);
    assert.doesNotMatch(tvArt, /<a [^>]*href="https:/, "the TV never links out");
    const tvCode = await (await call(e, "/tv/read?room=pro-plus&from=reading&rd=hank&ra=budosband&k=w%3Ahttps%3A%2F%2Fwww.kexp.org%2Fread%2Fx%2F")).text();
    assert.match(tvCode, /<svg xmlns=/); assert.match(tvCode, /data-home href="\/buttons\/abcdefabcdefabcdefabcdef\/tv\/reading\?room=pro-plus&amp;dj=hank&amp;a=budosband"/);
    const removed = await call(e, "/tv/read?room=pro-plus&from=reading&ra=budosband&k=w%3Ahttps%3A%2F%2Fpopmatters.com%2Fbudos", { redirect: "manual" });
    assert.equal(removed.status, 303, "a removed piece does not open");
    assert.equal((await worker.fetch(new Request(`https://x.test/notes/wrongwrongwrong/reading`), e, { waitUntil() {} })).status, 404);
    // A list the Guardian alone has filled is counted (Codex).
    const g = house();
    await indexGuardian(g, "Okonski", "Okonski", [{ id: "music/2024/jan/01/okonski-interview", kind: "Interview", title: "T", year: "2024", min: 6 }]);
    assert.equal(await readingCount(g), 1);
    // The mend takes the NEWEST missing songs by the time their keys carry, never "nothing found", and reads
    // nothing older than a full list's oldest row.
    const m = house(), row = (i, at) => ({ at, song: `Song ${i}`, artist: `Act ${i}`, items: [piece({ url: `https://a.example.org/${i}` })] });
    for (let i = 0; i < 75; i++) {
      const at = new Date(Date.UTC(2026, 9, 1 + i)).toISOString();
      await m.PROGRAMS.put(`readfound:act-${String(i).padStart(2, "0")}-song`, JSON.stringify(row(i, at)), { metadata: { at, n: 1 } });
    }
    await m.PROGRAMS.put("readfound:zz-nothing", JSON.stringify({ at: "2026-12-30T00:00:00.000Z", song: "N", artist: "Z", items: [] }), { metadata: { at: "2026-12-30T00:00:00.000Z", n: 0 } });
    let seen = [];
    for (let look = 0; look < 8; look++) seen = (await readingIndex(m)).artists.map((x) => x.name);
    assert.equal(seen.length, 60); assert.equal(seen[0], "Act 74"); assert.equal(seen[59], "Act 15");
    const gets = []; const realGet = m.PROGRAMS.get.bind(m.PROGRAMS);
    m.PROGRAMS.get = async (k, o) => { gets.push(k); return realGet(k, o); };
    await readingIndex(m);
    assert.deepEqual(gets.filter((k) => k.startsWith("readfound:")), [], "a full list reads no older song again");
  });
});

test("kept and removed are never cut short: past the end, a keep or a removal is refused and said (Codex)", async () => {
  const e = house();
  await e.PROGRAMS.put("readindex:kept", JSON.stringify(Array.from({ length: KEPT_MAX }, (_, i) => ({ pk: `w:https://a.example.org/${i}`, at: "2026-11-01T00:00:00.000Z" }))));
  assert.equal(await readingAct(e, { act: "keep", pk: "w:https://b.example.org/x" }), "full");
  assert.equal(JSON.parse(await e.PROGRAMS.get("readindex:kept")).length, KEPT_MAX);
  await e.PROGRAMS.put("readindex:hidden", JSON.stringify(Array.from({ length: HIDDEN_MAX }, (_, i) => `w:https://a.example.org/h${i}`)));
  assert.equal(await readingAct(e, { act: "remove", pk: "w:https://b.example.org/y" }), "full");
  assert.equal(JSON.parse(await e.PROGRAMS.get("readindex:hidden")).at(-1), `w:https://a.example.org/h${HIDDEN_MAX - 1}`, "the oldest removal is still there");
});
