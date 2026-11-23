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

// THE SHELF'S READING (readindex.js): every piece the house holds, one page.
import { indexGuardian, readingCount, readingIndex } from "../readindex.js";

test("the Shelf's Reading: the web's pieces by song and the Guardian's by artist, one artist together, newest first, mended from the store", async () => {
  const e = house();
  await withFetch(() => 200, async () => {
    // A song kept before the list existed is found by the mend.
    await e.PROGRAMS.put("readfound:the-budos-band-up-from-the-south", JSON.stringify({ at: "2026-11-23T07:43:40.047Z", song: "Up From the South",
      artist: "The Budos Band", items: [piece({ about: "artist", source: "KEXP", title: "Sound & Vision", url: "https://www.kexp.org/read/x/" })] }));
    assert.equal(await readingCount(e), null, "no list yet");
    const { slug } = await fileFind(e, { title: "October", artist: "Okonski, Someone", album: "Magnolia" });
    await saveFind(e, { job_id: slug, items: [piece(), piece({ url: "https://a.example.org/2", about: "song" })] });
    await indexGuardian(e, "Okonski, Someone", "Okonski", [{ id: "music/2024/jan/01/okonski-interview", kind: "Interview", title: "Okonski: 'Quiet'", year: "2024", min: 6 }]);
    await indexGuardian(e, "Old Act", "Old Act", [{ id: "music/2020/jan/01/old", kind: "Feature", title: "Old", year: "2020", min: 3 }], "2026-09-01T00:00:00.000Z");
    const ix = await readingIndex(e);
    assert.deepEqual(ix.groups.map((g) => [g.artist, g.blocks.map((b) => [b.kind, b.song ?? null, b.items.length])]),
      [["Okonski", [["guardian", null, 1], ["web", "October", 2]]], ["The Budos Band", [["web", "Up From the South", 1]]]]);
    assert.equal(ix.n, 4); assert.equal(await readingCount(e), 4);
    const page = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}/reading`), e, { waitUntil() {} })).text();
    assert.match(page, /<span class="chip" aria-current="page">Reading<b class="n">4<\/b><\/span>/);
    assert.match(page, /<a class="chip" href="\/notes\/abcdefabcdefabcdefabcdef">Programs<\/a>/);
    assert.match(page, /Okonski · The Guardian/); assert.match(page, /Okonski · October/);
    assert.match(page, /href="https:\/\/www\.theguardian\.com\/music\/2024\/jan\/01\/okonski-interview" target="_blank" rel="noopener noreferrer"/);
    assert.match(page, /About the song · Interview · Glide Magazine/);
    assert.match(page, /Sound &amp; Vision/); assert.doesNotMatch(page, /<script|Old Act/);
    const shelf = await (await worker.fetch(new Request(`https://x.test/notes/${KEY}`), e, { waitUntil() {} })).text();
    assert.match(shelf, /<a class="chip" href="\/notes\/abcdefabcdefabcdefabcdef\/reading">Reading<b class="n">4<\/b><\/a>/);
    // A song the store let go leaves the list; a search that found nothing is not listed.
    await e.PROGRAMS.delete("readfound:the-budos-band-up-from-the-south");
    assert.deepEqual((await readingIndex(e)).groups.map((g) => g.artist), ["Okonski"]);
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
    for (let look = 0; look < 8; look++) seen = (await readingIndex(m)).groups.map((x) => x.artist);
    assert.equal(seen.length, 60); assert.equal(seen[0], "Act 74"); assert.equal(seen[59], "Act 15");
    const gets = []; const realGet = m.PROGRAMS.get.bind(m.PROGRAMS);
    m.PROGRAMS.get = async (k, o) => { gets.push(k); return realGet(k, o); };
    await readingIndex(m);
    assert.deepEqual(gets.filter((k) => k.startsWith("readfound:")), [], "a full list reads no older song again");
  });
});
