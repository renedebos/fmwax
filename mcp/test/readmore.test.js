// READ MORE (readmore.js; the owner, 2026-11-22): the Guardian's pieces about
// an artist for the TV's About this song, and a piece's text to read.
import { test } from "node:test";
import assert from "node:assert/strict";

import { guardianId, guardianOn, parasOf, pickPieces, pieceOf, readName } from "../readmore.js";
import { renderTvPiece, renderTvRead } from "../tvpages.js";
import { aboutView, askLink } from "../about.js";

const hit = (id, title, tone, words, section = "music") => ({ id, type: "article", sectionId: section, webTitle: title,
  webPublicationDate: "2016-04-24T08:00:00Z", fields: { wordcount: String(words) }, tags: [{ id: tone }] });

test("a house with no Guardian key has no Read more", () => {
  assert.equal(guardianOn({}), false);
  assert.equal(guardianOn({ GUARDIAN_KEY: "short" }), false);
  assert.equal(guardianOn({ GUARDIAN_KEY: "0123456789abcdef0123" }), true);
});

test("a piece is kept only as an interview, feature, profile or obituary of some length, naming the artist", () => {
  assert.equal(pieceOf(hit("music/2016/apr/24/a", "Prince: ‘People hear the sex in my songs’", "tone/interview", 1843), "prince").kind, "Interview");
  assert.equal(pieceOf(hit("music/2016/apr/24/b", "Prince review – a night of hits", "tone/reviews", 900), "prince"), null);
  assert.equal(pieceOf(hit("music/2016/apr/24/c", "Prince obituary", "tone/obituaries", 300), "prince"), null);
  assert.equal(pieceOf(hit("music/2016/apr/24/d", "The princess of pop speaks", "tone/features", 2000), "prince"), null);
  assert.equal(pieceOf(hit("fashion/2026/nov/06/e", "Prince, the pope and purple", "tone/features", 900, "fashion"), "prince"), null);
  assert.equal(pieceOf(hit("music/2016/apr/24/f", "Prince obituary", "tone/obituaries", 2600), "prince").min, 12);
});

test("the list: interviews first, a headline that opens with the name ahead, four interviews at most, six in all", () => {
  const rs = [
    hit("music/2016/a/1/o", "Prince obituary", "tone/obituaries", 2600),
    hit("music/2016/a/1/f", "How Sign o’ the Times captured Prince", "tone/features", 1069),
    ...[1, 2, 3, 4, 5].map((n) => hit(`music/2016/a/1/i${n}`, `Sheila E on Prince, part ${n}`, "tone/interview", 1000 + n)),
    hit("music/2016/a/1/own", "Prince: ‘I am music’", "tone/interview", 900),
    hit("music/2016/a/1/own", "Prince: ‘I am music’", "tone/interview", 900),
  ];
  const got = pickPieces(rs, "Prince");
  assert.equal(got.length, 6);
  assert.equal(got[0].id, "music/2016/a/1/own");
  assert.deepEqual(got.map((p) => p.kind), ["Interview", "Interview", "Interview", "Interview", "Obituary", "Feature"]);
  assert.deepEqual(Object.keys(got[0]).sort(), ["id", "kind", "min", "title", "year"]);
  assert.equal(pickPieces(rs, "The Prince")[0].id, "music/2016/a/1/own");
});

test("a song's first artist is the one asked; a piece's address is the Guardian's own shape", () => {
  assert.equal(readName("Orgone, Fanny Franklin"), "Orgone");
  assert.equal(guardianId("music/2016/apr/24/prince-interview-1997"), "music/2016/apr/24/prince-interview-1997");
  for (const bad of ["https://example.com/x", "../search", "search", "music/2016/apr/24/x?api-key=1", ""]) assert.equal(guardianId(bad), null);
});

test("a piece's body: its paragraphs and headings as plain words, pictures and embeds left out", () => {
  const body = parasOf(`<p>One <a href="x">linked</a> &amp; two.</p><figure><p>caption</p></figure><h2>Then</h2><aside><p>pull quote</p></aside><p>‘Three.’</p><script>alert(1)</script>`);
  assert.deepEqual(body, [{ p: "One linked & two." }, { h: "Then" }, { p: "‘Three.’" }]);
});

test("the TV pages: the list links each piece through the artist, and the piece is drawn as text with its credit", () => {
  const room = { name: "Pro Plus", slug: "pro-plus" };
  const list = renderTvRead({ base: "/buttons/k", room, name: "Booker T & the MGs", items: [{ id: "music/2012/a/1/x", kind: "Interview", title: "A <b>title</b>", year: "2012", min: 18 }] });
  assert.match(list, /href="\/buttons\/k\/tv\/read\?room=pro-plus&amp;a=Booker%20T%20%26%20the%20MGs&amp;id=music%2F2012%2Fa%2F1%2Fx"/);
  assert.doesNotMatch(list, /On other sites/);
  assert.match(list, /A &lt;b&gt;title&lt;\/b&gt;/);
  assert.match(list, /The Guardian · 2012 · 18 min/);
  const page = renderTvPiece({ back: "/buttons/k/tv/read?room=pro-plus&a=Prince", piece: { id: "music/2016/a/1/x", title: "T", by: "Susie Boone", stand: "S",
    year: "2016", min: 8, url: "https://www.theguardian.com/music/2016/a/1/x", body: [{ p: "<script>x</script>" }, { h: "H" }] } });
  assert.match(page, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(page, /Courtesy of Guardian News &amp; Media Ltd/);
  assert.match(page, /href="\/buttons\/k\/tv\/read\?room=pro-plus&amp;a=Prince"/);
});

test("the phone's About this song lists the pieces as links to the Guardian's own site, and nothing when there are none", () => {
  const ask = askLink("claude", "Kiss", "Prince");
  const html = aboutView({ title: "Kiss", artist: "Prince", ask, read: { name: "Prince", items: [
    { id: "music/2011/jun/23/prince-interview", kind: "Interview", title: "Prince: 'I am <music>'", year: "2011", min: 9 },
    { id: "https://evil.example/x", kind: "Feature", title: "Not the Guardian's", year: "2020", min: 3 }] } });
  assert.match(html, /Read more about Prince/);
  assert.match(html, /href="https:\/\/www\.theguardian\.com\/music\/2011\/jun\/23\/prince-interview" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Prince: &#39;I am &lt;music&gt;&#39;|Prince: 'I am &lt;music&gt;'/);
  assert.match(html, /Interview · The Guardian · 2011 · 9 min/);
  assert.doesNotMatch(html, /evil\.example|Not the Guardian/);
  assert.doesNotMatch(aboutView({ title: "Kiss", artist: "Prince", ask }), /Read more/);
});
