// THE RECORDING FINDER (MC-41 stage 0, 2026-11-12; recordings.js). One test
// for each obstacle the trial met (tasks/classical-finder-trial.md) and each
// rule of the finder, on answers shaped as Spotify and MusicBrainz give them:
// the albums are the trial's, the ids and some lengths made up. Nothing here
// reaches either service.
import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";
import { AGENT_TOOLS, TOOLS, TOOL_META, VOICE_TOOLS, toolsWithMeta, voiceFunctions } from "../toollist.js";
import {
  albumKind, askOf, catalogueClash, holdsNumber, matcher, parseWork, pickMovement, recordingKey, splitTitle, takeRun, whyNot,
} from "../recordings.js";
import { MB_UA, recordingFacts } from "../musicbrainz.js";
import { RESEARCH_TTL_S } from "../endless.js";

const { callTool } = __test;
const BUDGET = () => ({ remaining: 40 });

// ------------------------------------------------------------- the fakes

// One album as Spotify has it: `album` is what GET /albums/{id} answers
// (with its tracks added by the fake), `tracks` the album's own list, and
// `hit(n)` the full track a search returns for its n-th track, with its
// album and, where the row says so, its recording code.
function pressing(alb, rows, more = {}) {
  const perDisc = new Map();
  const full = rows.map(([name, artists, ms, o = {}], i) => {
    const disc = o.disc ?? 1;
    const no = (perDisc.get(disc) ?? 0) + 1;
    perDisc.set(disc, no);
    return { id: `${alb.id}t${i + 1}`, uri: `spotify:track:${alb.id}t${i + 1}`, name, duration_ms: ms,
      disc_number: disc, track_number: no, artists: artists.map((n) => ({ name: n })), isrc: o.isrc ?? null };
  });
  const head = { ...alb, total_tracks: full.length };
  return {
    id: alb.id, album: { ...head, ...more },
    tracks: full.map(({ isrc: _i, ...t }) => t),
    hit: (n) => {
      const { isrc, ...t } = full[n - 1];
      return { ...t, type: "track", album: head, external_ids: isrc ? { isrc } : {} };
    },
  };
}
const album = (id, name, { type = "album", date = "1975-01-01", artists = [] } = {}) =>
  ({ id, name, album_type: type, release_date: date, artists: artists.map((n) => ({ name: n })) });

// Spotify, faked over the harness's (which answers the sign-in): the search
// answers what `search(q)` gives, the album reads what `albums` hold. Every
// search's words, every album read and every call are kept.
function spotifyFake({ search = () => [], albums = [] } = {}) {
  const base = installFetch();
  const below = globalThis.fetch;
  const asked = [], limits = [], reads = [], heard = [];
  const byId = new Map(albums.map((p) => [p.id, p]));
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.spotify.com") {
      heard.push(url.pathname);
      if (url.pathname === "/v1/search") {
        const q = url.searchParams.get("q");
        asked.push(q);
        limits.push(url.searchParams.get("limit"));
        const got = search(q);
        if (got instanceof Response) return got;
        return Response.json({ tracks: { items: got.slice(0, Number(url.searchParams.get("limit")) || 10) } });
      }
      const m = url.pathname.match(/^\/v1\/albums\/([^/]+)(\/tracks)?$/);
      if (m) {
        reads.push(`${url.pathname}${url.search}`);
        const p = byId.get(m[1]);
        if (!p) return new Response("no such album", { status: 404 });
        if (!m[2]) {
          return Response.json({ ...p.album, tracks: { items: p.tracks.slice(0, 50), total: p.tracks.length, limit: 50, offset: 0,
            next: p.tracks.length > 50 ? "more" : null } });
        }
        const off = Number(url.searchParams.get("offset")) || 0, lim = Number(url.searchParams.get("limit")) || 20;
        return Response.json({ items: p.tracks.slice(off, off + lim), total: p.tracks.length, limit: lim, offset: off });
      }
    }
    return below(u, init);
  };
  return { asked, limits, reads, heard, restore() { globalThis.fetch = below; base.restore(); } };
}

// MusicBrainz, faked: what each address answers (a 404 for any other), and
// every request it heard. `busy`: that many 503s first.
function musicbrainz(routes = {}, { busy = 0 } = {}) {
  const heard = [];
  const below = globalThis.fetch;
  let left = busy;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname !== "musicbrainz.org") return below(u, init);
    heard.push({ path: url.pathname, search: url.search, ua: new Headers(init.headers).get("user-agent") });
    if (left > 0) { left--; return Response.json({ error: "busy" }, { status: 503 }); }
    let r = routes[url.pathname];
    if (typeof r === "function") r = r(url);
    if (r instanceof Response) return r;
    return r ? Response.json(r) : Response.json({ error: "Not Found" }, { status: 404 });
  };
  return { heard, restore() { globalThis.fetch = below; } };
}
// A house that asks MusicBrainz, whose waits cost the tests nothing.
const mbHouse = () => {
  const e = makeEnv();
  e.ARTIST_LOOKUP = "on";
  e.__mbSleep = async (ms) => { (e.__naps ??= []).push(ms); };
  return e;
};

// ------------------------------------------------------------- the records

const BEETHOVEN = "Ludwig van Beethoven", BACH = "Johann Sebastian Bach";
const KLEIBER = [BEETHOVEN, "Wiener Philharmoniker", "Carlos Kleiber"];
const B5 = ["I. Allegro con brio", "II. Andante con moto", "III. Scherzo. Allegro", "IV. Allegro"]
  .map((m) => `Symphony No. 5 in C Minor, Op. 67: ${m}`);
const B5_MS = [442000, 596000, 313000, 662000];
const B7 = ["I. Poco sostenuto - Vivace", "II. Allegretto", "III. Presto", "IV. Allegro con brio"]
  .map((m) => `Symphony No. 7 in A Major, Op. 92: ${m}`);
const B7_MS = [813000, 485000, 467000, 432000];
const BRAHMS4 = ["I. Allegro non troppo", "II. Andante moderato", "III. Allegro giocoso", "IV. Allegro energico e passionato"]
  .map((m) => `Symphony No. 4 in E Minor, Op. 98: ${m}`);
const BRAHMS4_MS = [764000, 692000, 371000, 579000];
const rowsOf = (titles, credits, lengths, o = () => ({})) => titles.map((t, i) => [t, credits, lengths[i], o(i)]);

// Kleiber's Fifth, on five albums (the trial's first obstacle): the 1975 LP,
// its 1995 reissue, his box, a "Very Best Of" and a "Great Recordings".
const KLEIBER_DG = pressing(album("kleiberDG75", "Beethoven: Symphonies Nos. 5 & 7", { date: "1975-01-01" }),
  [...rowsOf(B5, KLEIBER, B5_MS, (i) => (i === 0 ? { isrc: "DEF057400101" } : {})), ...rowsOf(B7, KLEIBER, B7_MS)],
  { copyrights: [{ text: "© 1975 Deutsche Grammophon GmbH, Berlin", type: "C" }, { text: "℗ 1975 Deutsche Grammophon GmbH, Berlin", type: "P" }] });
const KLEIBER_ORIGINALS = pressing(album("kleiberOR95", "Beethoven: Symphonies Nos. 5 & 7 (DG The Originals)", { date: "1995-05-01" }),
  [...rowsOf(B5, KLEIBER, B5_MS.map((ms) => ms + 1000)), ...rowsOf(B7, KLEIBER, B7_MS)]);
const FILLER = Array.from({ length: 24 }, (_, i) => [`Overture No. ${i + 1}`, ["Carlos Kleiber", "Wiener Philharmoniker"], 400000]);
const BAVARIAN = [BEETHOVEN, "Bayerisches Staatsorchester", "Carlos Kleiber"];
const KLEIBER_BOX = pressing(album("kleiberBOX", "Carlos Kleiber: The Complete Orchestral Recordings on Deutsche Grammophon",
  { type: "compilation", date: "2014-10-01", artists: ["Carlos Kleiber"] }),
[...rowsOf(B5, KLEIBER, B5_MS), ...rowsOf(B7, KLEIBER, B7_MS), ...rowsOf(BRAHMS4, ["Johannes Brahms", "Wiener Philharmoniker", "Carlos Kleiber"], BRAHMS4_MS),
  ...FILLER, ...rowsOf(B7, BAVARIAN, [790000, 470000, 455000, 420000])]);
const VERY_BEST = pressing(album("beetVeryBest", "Beethoven: The Very Best Of", { type: "compilation", date: "2010-01-01", artists: ["Various Artists"] }),
  [[B5[0], KLEIBER, 442000], ["Für Elise", [BEETHOVEN, "Alfred Brendel"], 180000]]);
const GREAT = pressing(album("greatRecs", "Beethoven: Symphony No. 5 - Great Recordings", { date: "2003-01-01" }), rowsOf(B5, KLEIBER, B5_MS));
const ERICH = pressing(album("erich1953", "Beethoven: Symphony No. 5 (1953)", { date: "1953-01-01" }),
  rowsOf(B5, [BEETHOVEN, "Concertgebouworkest", "Erich Kleiber"], [430000, 600000, 320000, 650000]));
const KLEIBER_HITS = () => [VERY_BEST.hit(1), KLEIBER_DG.hit(1), KLEIBER_DG.hit(2), KLEIBER_BOX.hit(1), GREAT.hit(1),
  KLEIBER_DG.hit(4), KLEIBER_ORIGINALS.hit(1), KLEIBER_ORIGINALS.hit(3), ERICH.hit(1)];
const KLEIBER_ALBUMS = [KLEIBER_DG, KLEIBER_ORIGINALS, KLEIBER_BOX, VERY_BEST, GREAT, ERICH];
const KLEIBER_ASK = { composer: "Beethoven", work: "Symphony No. 5 in C minor, Op. 67", performers: ["Carlos Kleiber", "Vienna Philharmonic"] };

// ---------------------------------------------------------- the pure rules

test("a work is taken apart as a listener writes it: the search's key, its number, its catalogue number", () => {
  const p = (w) => { const { key, number, catalogue } = parseWork(w); return { key, number, catalogue }; };
  assert.deepEqual(p("Symphony No. 5 in C minor, Op. 67"), { key: "Symphony No. 5", number: "5", catalogue: "Op. 67" });
  assert.deepEqual(p("Symphony No.5"), { key: "Symphony No. 5", number: "5", catalogue: null }, "no space, and the key says it one way");
  assert.deepEqual(p("Piano Concerto No. 20 in D minor, K. 466"), { key: "Piano Concerto No. 20", number: "20", catalogue: "K. 466" });
  assert.deepEqual(p("Brandenburg Concerto No. 3, BWV 1048"), { key: "Brandenburg Concerto No. 3", number: "3", catalogue: "BWV 1048" });
  assert.deepEqual(p("Das Lied von der Erde"), { key: "Das Lied von der Erde", number: null, catalogue: null }, "a bare title");
  assert.deepEqual(p("Tabula Rasa"), { key: "Tabula Rasa", number: null, catalogue: null });
  assert.deepEqual(p("Goldberg Variations, BWV 988"), { key: "Goldberg Variations", number: null, catalogue: "BWV 988" });
  assert.deepEqual(p("Cello Concerto in E minor, Op. 85"), { key: "Op. 85", number: null, catalogue: "Op. 85" },
    "a form's name alone would drown: its catalogue number is searched (the coordinator, 2026-11-12)");
  assert.deepEqual(p("Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2"),
    { key: "Piano Sonata No. 14", number: "14", catalogue: "Op. 27 No. 2" }, "a number after the opus is the opus's");
  assert.deepEqual(p("Symphony No. 104 in D, Hob. I:104"), { key: "Symphony No. 104", number: "104", catalogue: "Hob. I:104" });
  assert.deepEqual(p("Symphony 5"), { key: "Symphony No. 5", number: "5", catalogue: null });
});

test("the number and the catalogue number are whole tokens whatever the spacing; a missing catalogue number is no contradiction", () => {
  assert.equal(holdsNumber("Symphony No.5 In C Minor, Op.67: 1. Allegro con brio", "5"), true);
  assert.equal(holdsNumber("Symphony No. 5 in C Minor", "5"), true);
  assert.equal(holdsNumber("Symphony N° 5", "5"), true);
  assert.equal(holdsNumber("Symphony No. 50 in C Major", "5"), false, "50 is not 5");
  assert.equal(catalogueClash("Symphony No.5 In C Minor, Op.67: 1. Allegro con brio", "Op. 67"), false);
  assert.equal(catalogueClash("Piano Concerto No. 20 in D Minor, KV 466: I. Allegro", "K. 466"), false, "K and KV are one");
  assert.equal(catalogueClash("Piano Concerto No. 20 in D Minor, K.466: I. Allegro", "K. 466"), false);
  assert.equal(catalogueClash("Partita No. 2 in C Minor, BWV 826: I. Sinfonia", "BWV 1004"), true, "the keyboard partita, not the violin one");
  assert.equal(catalogueClash("Symphony No. 5 in C Minor: I. Allegro con brio", "Op. 67"), false, "a label that leaves it off");
});

test("a performer is matched on the family name or the band's own words, under its translated names", () => {
  assert.equal(matcher("Pau Casals").on("Pablo Casals"), true, "Pau is Pablo");
  const vienna = matcher("Vienna Philharmonic");
  assert.equal(vienna.on("Wiener Philharmoniker"), true);
  assert.equal(vienna.on("Wiener Symphoniker"), false, "another orchestra of the same city");
  assert.equal(vienna.spotifyName, "Wiener Philharmoniker", "searched as Spotify credits it");
  const concert = matcher("The English Concert");
  assert.equal(concert.on("The English Concert"), true);
  assert.equal(concert.on("European Brandenburg Ensemble"), false);
  assert.equal(matcher("Furtwaengler").on("Wilhelm Furtwängler"), true, "an umlaut written out");
  assert.equal(matcher("Wilhelm Furtwängler").on("Wilhelm Furtwaengler"), true);
  assert.equal(matcher("Rachmaninov").on("Sergei Rachmaninoff"), true, "a Russian name in two spellings");
  assert.equal(matcher("Gardiner").on("Orchestre Révolutionnaire et Romantique"), false);
  assert.equal(matcher("Orchestre Revolutionnaire et Romantique").on("Orchestre Révolutionnaire et Romantique"), true, "accents");
  // The composer is a credit of its own, not a word inside a band's name.
  const ask = askOf({ composer: "Bach", work: "Cantata No. 140", performers: ["Bach Collegium Japan"] });
  assert.match(whyNot({ name: "Cantata No. 140: I.", artists: [{ name: "Georg Philipp Telemann" }, { name: "Bach Collegium Japan" }] }, ask), /not by Bach/);
  assert.equal(whyNot({ name: "Cantata No. 140: I.", artists: [{ name: BACH }, { name: "Bach Collegium Japan" }] }, ask), null);
});

// THE NAMESAKES (the coordinator, 2026-11-12): a family name alone let Erich
// Kleiber's Fifth stand for Carlos's.
test("a person's given names must agree, by their first letters: a namesake is turned away, in words", () => {
  const on = (asked, credit) => matcher(asked).on(credit);
  assert.equal(on("Carlos Kleiber", "Erich Kleiber"), false);
  const kleiber = askOf({ composer: "Beethoven", work: "Symphony No. 5", performers: ["Carlos Kleiber"] });
  assert.equal(whyNot({ name: B5[0], artists: [{ name: BEETHOVEN }, { name: "Concertgebouworkest" }, { name: "Erich Kleiber" }] }, kleiber),
    "Carlos Kleiber is not in its credits: Erich Kleiber is another Kleiber (Ludwig van Beethoven, Concertgebouworkest, Erich Kleiber)");
  assert.equal(on("Neeme Järvi", "Paavo Järvi"), false);
  assert.equal(on("Neeme Järvi", "Neeme Jarvi"), true);
  const mozart = askOf({ composer: "Wolfgang Amadeus Mozart", work: "Trumpet Concerto", performers: ["Maurice André"] });
  assert.equal(whyNot({ name: "Trumpet Concerto in D Major: I. Allegro moderato", artists: [{ name: "Leopold Mozart" }, { name: "Maurice André" }] }, mozart),
    "not by Wolfgang Amadeus Mozart: Leopold Mozart is another Mozart", "as composer too");
  assert.equal(on("J.S. Bach", "Johann Sebastian Bach"), true);
  assert.equal(on("Bach, J.S.", "Johann Sebastian Bach"), true);
  assert.equal(on("J.S. Bach", "Carl Philipp Emanuel Bach"), false);
  assert.equal(on("J.S. Bach", "Johann Christian Bach"), false, "the second given name counts as well");
  assert.equal(on("Sir John Barbirolli", "John Barbirolli"), true, "a title is not a given name");
  assert.equal(on("John Barbirolli", "Sir John Barbirolli"), true);
  assert.equal(on("Yuri Temirkanov", "Juri Temirkanov"), true, "y and j are one letter");
  assert.equal(on("Juri Temirkanov", "Yuri Temirkanov"), true);
  assert.equal(on("Evgeny Kissin", "Yevgeny Kissin"), true, "e and y are one letter");
  assert.equal(on("Yevgeny Kissin", "Evgeny Kissin"), true);
  assert.equal(on("Sergei Rachmaninov", "Serge Rachmaninoff"), true);
  assert.equal(on("Kleiber", "Erich Kleiber"), true, "a family name alone is anyone of that family");
  assert.equal(on("Carlos Kleiber", "Kleiber"), true, "and a credit of the family name alone is anyone's");
  assert.equal(on("Herbert von Karajan", "Herbert von Karajan"), true, "a particle is not a given name");
  assert.equal(on("Vaughan Williams", "Ralph Vaughan Williams"), true, "a double family name written apart");
  assert.equal(on("Vaughan Williams", "John Williams"), false);
  assert.equal(on("Rimsky-Korsakov", "Nikolai Rimsky-Korsakov"), true);
  assert.equal(on("Bruno Walter", "Walter Gieseking"), false, "the family name is the credit's own last word");
  assert.notEqual(recordingKey(askOf({ ...KLEIBER_ASK, performers: ["Carlos Kleiber"] })),
    recordingKey(askOf({ ...KLEIBER_ASK, performers: ["Erich Kleiber"] })), "kept apart, too");
});

// WORKS WITHOUT A NUMBER (the coordinator, 2026-11-12): "Symphony" alone
// drowns in ten results.
test("a work without a number is searched by its nickname, else its own title, else its catalogue number, else its form and key", () => {
  const key = (w) => parseWork(w).key;
  assert.equal(key("Symphony in E minor, Op. 32, 'Gaelic'"), "Gaelic");
  assert.equal(key("Symphony in E minor, Op. 32 \"Gaelic\""), "Gaelic");
  assert.equal(key("Symphony in E minor, Op. 32 Gaelic"), "Gaelic", "the words after the catalogue number");
  assert.equal(key("Variations on an Original Theme, Op. 36 'Enigma'"), "Enigma");
  assert.equal(key("Requiem in D minor, K. 626"), "K. 626");
  assert.equal(key("Piano Sonata in B-flat major, D. 960"), "D. 960");
  assert.equal(key("Symphony in E minor"), "Symphony in E minor", "no catalogue number: the form with its key");
  assert.equal(key("Das Lied von der Erde"), "Das Lied von der Erde");
  assert.equal(key("Tabula Rasa"), "Tabula Rasa");
  assert.equal(key("Goldberg Variations, BWV 988"), "Goldberg Variations", "a title of its own stays the title");
  assert.equal(key("Ein deutsches Requiem, Op. 45"), "Ein deutsches Requiem");
  assert.equal(key("Symphony No. 6 in F major, Op. 68 'Pastoral'"), "Symphony No. 6", "a number is still searched by the number");
  assert.equal(parseWork("Symphony in E minor, Op. 32, 'Gaelic'").catalogue, "Op. 32", "and still checked on what comes back");
});

test("compilations are named for what they are; a box of one artist's recordings is not one", () => {
  const ask = askOf(KLEIBER_ASK);
  assert.equal(albumKind(VERY_BEST.album, ask), "compilation");
  assert.equal(albumKind(GREAT.album, ask), "compilation", "by its name, whatever Spotify files it as");
  for (const name of ["The Essential Beethoven", "Greatest Classical Hits", "Beethoven for Relaxation", "Bach for Studying",
    "100 Must-Have Classical Pieces", "Classical Music for Sleep"]) {
    assert.equal(albumKind({ name, album_type: "album", total_tracks: 20 }, ask), "compilation", name);
  }
  assert.equal(albumKind(KLEIBER_BOX.album, ask), "box");
  assert.equal(albumKind({ ...KLEIBER_BOX.album, artists: [{ name: "Various Artists" }] }, ask), "compilation", "a box of everyone's");
  assert.equal(albumKind(KLEIBER_DG.album, ask), "album");
});

test("a title is the work and the movement, however the label writes it", () => {
  const s = (t) => { const { work, movement, key } = splitTitle(t, "bach"); return { work, movement, key }; };
  assert.deepEqual(s("Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio"), { work: "Symphony No. 5 in C Minor, Op. 67", movement: "I. Allegro con brio", key: "#1" });
  assert.deepEqual(s("Bach, JS: Brandenburg Concerto No. 3 in G Major, BWV 1048: I. Allegro"),
    { work: "Brandenburg Concerto No. 3 in G Major, BWV 1048", movement: "I. Allegro", key: "#1" }, "the label's composer in front");
  assert.deepEqual(s("Tabula Rasa: I. Ludus: Con moto"), { work: "Tabula Rasa", movement: "I. Ludus: Con moto", key: "#1" });
  assert.deepEqual(s("Symphony No. 5 in C Minor, Op. 67 - IV. Allegro"), { work: "Symphony No. 5 in C Minor, Op. 67", movement: "IV. Allegro", key: "#4" });
  assert.deepEqual(s("Symphony No.5 In C Minor, Op.67: 1. Allegro con brio - Remastered 2015").key, "#1");
  assert.deepEqual(s("Goldberg Variations, BWV 988: Variation 1 a 1 Clav.").key, "variation 1 a 1 clav");
  assert.deepEqual(s("II. Andante con moto"), { work: null, movement: "II. Andante con moto", key: "#2" }, "a movement alone");
});

// Tracks as GET /albums/{id} lists them.
const listed = (titles, { disc = 1, from = 1, ms = 100000 } = {}) => titles.map((name, i) =>
  ({ id: `d${disc}t${from + i}`, uri: `spotify:track:d${disc}t${from + i}`, name, duration_ms: ms, disc_number: disc, track_number: from + i, artists: [] }));

test("the run: the work's tracks in order, never a second performance of it, and a movement that names itself alone goes on", () => {
  // Gould's two Goldbergs back to back in one box: the second Aria starts the second.
  const g = (v) => [`Goldberg Variations, BWV 988: Aria`, ...Array.from({ length: 30 }, (_, i) => `Goldberg Variations, BWV 988: Variation ${i + 1}`),
    "Goldberg Variations, BWV 988: Aria da capo"];
  const box = [...listed(g(1955), { disc: 1 }), ...listed(g(1981), { disc: 2 })];
  const second = takeRun(box, box[40], "bach");
  assert.equal(second.run.length, 32);
  assert.equal(second.run[0].id, "d2t1");
  assert.equal(second.run.at(-1).id, "d2t32");
  const first = takeRun(box, box[5], "bach");
  assert.deepEqual([first.run[0].id, first.run.at(-1).id], ["d1t1", "d1t32"]);
  // The Fifth twice in a row, a symphony on either side.
  const twice = listed([B7[3], ...B5, ...B5, BRAHMS4[0]]);
  assert.deepEqual(takeRun(twice, twice[6]).run.map((t) => t.id), ["d1t6", "d1t7", "d1t8", "d1t9"]);
  // A label that names the work on the first movement alone.
  const bare = listed(["Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio", "II. Andante con moto", "III. Scherzo", "IV. Allegro", "I. Allegro (Symphony No. 6)"]);
  assert.equal(takeRun(bare, bare[0]).run.length, 4);
  assert.equal(takeRun(bare, { id: "nowhere", disc_number: 3, track_number: 9 }), null);
});

test("one movement is picked by its number or its name", () => {
  const parts = ["I. Trauermarsch", "II. Stürmisch bewegt", "III. Scherzo", "IV. Adagietto. Sehr langsam", "V. Rondo-Finale"]
    .map((m) => splitTitle(`Symphony No. 5 in C-Sharp Minor: ${m}`));
  assert.equal(pickMovement(parts, "IV"), 3);
  assert.equal(pickMovement(parts, "4"), 3);
  assert.equal(pickMovement(parts, "Adagietto"), 3);
  assert.equal(pickMovement(parts, "adagietto"), 3);
  assert.equal(pickMovement(parts, "Largo"), -1);
});

// ------------------------------------------------------------- the tool

test("the plain success: Kleiber's Fifth, held by five albums, comes from the original LP, four movements in order", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  try {
    const out = await callTool(makeEnv(), "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.album, "Beethoven: Symphonies Nos. 5 & 7");
    assert.equal(out.album_id, "kleiberDG75");
    assert.deepEqual(out.tracks.map((t) => [t.n, t.uri, t.movement]), [
      [1, "spotify:track:kleiberDG75t1", "I. Allegro con brio"], [2, "spotify:track:kleiberDG75t2", "II. Andante con moto"],
      [3, "spotify:track:kleiberDG75t3", "III. Scherzo. Allegro"], [4, "spotify:track:kleiberDG75t4", "IV. Allegro"]],
    "the third movement came from the album's own list, not the search; the Seventh is left out");
    assert.equal(out.tracks[0].duration, "7:22");
    assert.equal(out.duration, "33:33");
    assert.equal(out.work, "Symphony No. 5 in C Minor, Op. 67");
    assert.equal(out.composer, BEETHOVEN);
    assert.deepEqual(out.players, ["Wiener Philharmoniker", "Carlos Kleiber"]);
    assert.equal(out.released, "1975-01-01");
    assert.equal(out.label, null, "Spotify sends no label to this app");
    assert.equal(out.copyright, "℗ 1975 Deutsche Grammophon GmbH, Berlin");
    assert.equal(out.isrc, "DEF057400101");
    assert.equal(out.isrc_track, 1);
    assert.equal(out.checked, null);
    assert.ok(out.notes.includes("The same recording is also on 2 other albums on Spotify."), out.notes.join(" | "));
    assert.ok(out.notes.includes("Compilations holding it were not used."));
    assert.ok(out.notes.some((n) => /does not ask MusicBrainz: the year recorded is not confirmed/.test(n)));
    assert.equal(out.spotify_calls, 2);
    assert.deepEqual(sp.asked, ['track:"Symphony No. 5" artist:"Carlos Kleiber"'], "one search, no composer in it");
    assert.deepEqual(sp.limits, ["10"]);
    assert.deepEqual(sp.reads, ["/v1/albums/kleiberDG75"], "one album read");
  } finally { sp.restore(); }
});

test("\"No.5\" without the space, and \"Op.67\", are the work asked for", async () => {
  const ORR = [BEETHOVEN, "Orchestre Révolutionnaire et Romantique", "John Eliot Gardiner"];
  const titles = ["1. Allegro con brio", "2. Andante con moto", "3. Allegro", "4. Allegro"].map((m) => `Symphony No.5 In C Minor, Op.67: ${m}`);
  const six = ["1. Allegro ma non troppo", "2. Andante molto mosso", "3. Allegro", "4. Allegro", "5. Allegretto"].map((m) => `Symphony No.6 In F, Op.68 "Pastoral": ${m}`);
  const ARCHIV = pressing(album("gardiner94", "Beethoven: Symphonies Nos. 5 & 6", { date: "1994-01-01" }),
    [...rowsOf(titles, ORR, [440000, 520000, 300000, 600000]), ...rowsOf(six, ORR, [600000, 700000, 300000, 200000, 500000])]);
  const sp = spotifyFake({ search: () => [ARCHIV.hit(4), ARCHIV.hit(1)], albums: [ARCHIV] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Ludwig van Beethoven", work: "Symphony No. 5 in C minor, Op. 67",
      performers: ["John Eliot Gardiner", "Orchestre Revolutionnaire et Romantique"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.deepEqual(out.tracks.map((t) => t.movement), ["1. Allegro con brio", "2. Andante con moto", "3. Allegro", "4. Allegro"]);
  } finally { sp.restore(); }
});

test("the wrong composer for the same title is turned away: Haydn's 40th for Mozart's, explained, and it may not be on Spotify", async () => {
  const AAM = ["Joseph Haydn", "Academy of Ancient Music", "Christopher Hogwood"];
  const HAYDN = pressing(album("haydn40", "Haydn: Symphonies Nos. 39-41", { date: "1995-01-01" }),
    rowsOf(["Symphony No. 40 in F Major, Hob. I:40: I. Allegro", "Symphony No. 40 in F Major, Hob. I:40: II. Andante più tosto allegretto"], AAM, [300000, 280000]));
  const sp = spotifyFake({ search: () => [HAYDN.hit(1), HAYDN.hit(2)], albums: [HAYDN] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Wolfgang Amadeus Mozart", work: "Symphony No. 40 in G minor, K. 550",
      performers: ["Christopher Hogwood", "Academy of Ancient Music"] }, BUDGET());
    assert.equal(out.status, "not-found");
    assert.deepEqual(out.searched, ['track:"Symphony No. 40" artist:"Christopher Hogwood"']);
    assert.equal(out.near.length, 2);
    assert.equal(out.near[0].title, "Symphony No. 40 in F Major, Hob. I:40: I. Allegro");
    assert.equal(out.near[0].album, "Haydn: Symphonies Nos. 39-41");
    assert.match(out.near[0].why, /^not by Wolfgang Amadeus Mozart: it credits Joseph Haydn, Academy of Ancient Music, Christopher Hogwood$/);
    assert.match(out.note, /It may not be on Spotify\.$/);
    assert.equal(out.spotify_calls, 1);
    assert.deepEqual(sp.reads, [], "nothing found, no album read");
  } finally { sp.restore(); }
});

// Pinnock's Brandenburgs: The English Concert in 1982, and his 2007 remake
// with another band, which Spotify ranks first.
const BRANDENBURG = [
  [1, "F Major", 1046, ["I. Allegro", "II. Adagio", "III. Allegro", "IV. Menuetto - Trio I - Polacca - Trio II"]],
  [2, "F Major", 1047, ["I. Allegro", "II. Andante", "III. Allegro assai"]],
  [3, "G Major", 1048, ["I. Allegro", "II. Adagio", "III. Allegro"]],
  [4, "G Major", 1049, ["I. Allegro", "II. Andante", "III. Presto"]],
  [5, "D Major", 1050, ["I. Allegro", "II. Affettuoso", "III. Allegro"]],
  [6, "B-Flat Major", 1051, ["I. Allegro", "II. Adagio ma non tanto", "III. Allegro"]],
];
const brandenburgs = (credits, third) => BRANDENBURG.flatMap(([n, key, bwv, ms]) =>
  ms.map((m, i) => [`Brandenburg Concerto No. ${n} in ${key}, BWV ${bwv}: ${m}`, credits, n === 3 ? third[i] : 200000 + n * 1000 + i]));
const PINNOCK_82 = pressing(album("pinnock82", "Bach: Brandenburg Concertos Nos. 1-6", { date: "1982-01-01" }),
  brandenburgs([BACH, "The English Concert", "Trevor Pinnock"], [300000, 14000, 260000]));
const PINNOCK_07 = pressing(album("pinnock07", "Bach: Brandenburg Concertos", { date: "2007-01-01" }),
  brandenburgs([BACH, "European Brandenburg Ensemble", "Trevor Pinnock"], [344000, 20000, 282000]));
// No. 3 is tracks 8 to 10.
const PINNOCK_HITS = () => [PINNOCK_07.hit(8), PINNOCK_07.hit(10), PINNOCK_82.hit(8), PINNOCK_82.hit(10)];

test("a remake with another band is turned away when the band is named, and is a choice when it is not", async () => {
  let sp = spotifyFake({ search: PINNOCK_HITS, albums: [PINNOCK_82, PINNOCK_07] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "J.S. Bach", work: "Brandenburg Concerto No. 3 in G major, BWV 1048",
      performers: ["Trevor Pinnock", "The English Concert"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.album_id, "pinnock82");
    assert.deepEqual(out.tracks.map((t) => t.uri), ["spotify:track:pinnock82t8", "spotify:track:pinnock82t9", "spotify:track:pinnock82t10"],
      "No. 3 whole, its Adagio from the album's list, and Nos. 2 and 4 left out");
    assert.deepEqual(out.players, ["The English Concert", "Trevor Pinnock"]);
  } finally { sp.restore(); }
  sp = spotifyFake({ search: PINNOCK_HITS, albums: [PINNOCK_82, PINNOCK_07] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Bach", work: "Brandenburg Concerto No. 3",
      performers: ["Trevor Pinnock"] }, BUDGET());
    assert.equal(out.status, "choices");
    assert.deepEqual(out.choices.map((c) => [c.album_id, c.released, c.first_movement.duration]),
      [["pinnock82", "1982-01-01", "5:00"], ["pinnock07", "2007-01-01", "5:44"]]);
    assert.match(out.note, /more than one|2 recordings/);
    assert.match(out.note, /Put the choices to the listener, or ask again with `year`/);
    assert.equal(out.spotify_calls, 1, "no year: one search, and no album read for a question");
    assert.deepEqual(sp.reads, []);
  } finally { sp.restore(); }
});

// Bylsma's two recordings of the suites (the trial's silent error): 1979 on
// Seon, 1992 on Sony; the Preludes are 2:11 and 2:25.
const DANCES = ["I. Prélude", "II. Allemande", "III. Courante", "IV. Sarabande", "V. Menuet I & II", "VI. Gigue"];
const SUITE_KEYS = ["G Major", "D Minor", "C Major", "E-Flat Major", "C Minor", "D Major"];
const suites = (credits, prelude, o = () => ({})) => SUITE_KEYS.flatMap((key, s) => DANCES.map((d, i) =>
  [`Cello Suite No. ${s + 1} in ${key}, BWV ${1007 + s}: ${d}`, credits, s === 0 && i === 0 ? prelude : 150000 + s * 7000 + i * 1000, o(s, i)]));
const BYLSMA_79 = pressing(album("bylsma79", "Bach: 6 Suites for Violoncello Solo", { date: "1979" }), suites([BACH, "Anner Bylsma"], 131000));
const BYLSMA_92 = pressing(album("bylsma92", "Bach: Suites for Violoncello Solo", { date: "1992-03-01" }), suites([BACH, "Anner Bylsma"], 145000)
  .map((r, i) => (i ? [r[0], r[1], r[2] + 9000] : r)));
const BYLSMA_SEARCH = (q) => (q.includes("year:") ? [BYLSMA_79.hit(1), BYLSMA_79.hit(2)]
  : [BYLSMA_92.hit(1), BYLSMA_92.hit(2), BYLSMA_79.hit(1), BYLSMA_79.hit(3)]);
const BYLSMA_ASK = { composer: "Bach", work: "Cello Suite No. 1 in G major, BWV 1007", performers: ["Anner Bylsma"] };

test("one player's two recordings: a choice with no year, never one picked silently; the year asked finds the 1979 one", async () => {
  let sp = spotifyFake({ search: BYLSMA_SEARCH, albums: [BYLSMA_79, BYLSMA_92] });
  try {
    const out = await callTool(makeEnv(), "find_recording", BYLSMA_ASK, BUDGET());
    assert.equal(out.status, "choices");
    assert.deepEqual(out.choices.map((c) => [c.album, c.first_movement.title, c.first_movement.duration]),
      [["Bach: 6 Suites for Violoncello Solo", "I. Prélude", "2:11"], ["Bach: Suites for Violoncello Solo", "I. Prélude", "2:25"]]);
    assert.equal(out.spotify_calls, 1);
  } finally { sp.restore(); }
  sp = spotifyFake({ search: BYLSMA_SEARCH, albums: [BYLSMA_79, BYLSMA_92] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { ...BYLSMA_ASK, year: 1979 }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.album_id, "bylsma79");
    assert.equal(out.tracks.length, 6, "the first suite, all six dances");
    assert.equal(out.tracks[0].duration, "2:11");
    assert.deepEqual(sp.asked, ['track:"Cello Suite No. 1" artist:"Anner Bylsma"', 'track:"Cello Suite No. 1" artist:"Anner Bylsma" year:1978-1981']);
    assert.equal(out.spotify_calls, 3, "two searches and one album read");
    assert.ok(out.notes.some((n) => /1 other recording of it on Spotify; this is the one the year given points to/.test(n)));
  } finally { sp.restore(); }
});

test("the family name alone with two Kleibers among the results is a choice, even with a year; the full name finds the one", async () => {
  // Erich's Fifth with lengths so near Carlos's that, by length alone, the two would be one recording.
  const ERICH_NEAR = pressing(album("erichNear", "Beethoven: Symphony No. 5", { date: "1953-01-01" }),
    rowsOf(B5, [BEETHOVEN, "Concertgebouworkest", "Erich Kleiber"], [440000, 594000, 312000, 660000]));
  const search = () => [KLEIBER_DG.hit(1), KLEIBER_DG.hit(2), ERICH_NEAR.hit(1), ERICH_NEAR.hit(2)];
  let sp = spotifyFake({ search, albums: [KLEIBER_DG, ERICH_NEAR] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Beethoven", work: "Symphony No. 5", performers: ["Kleiber"] }, BUDGET());
    assert.equal(out.status, "choices");
    assert.deepEqual(out.choices.map((c) => c.players).sort(),
      [["Concertgebouworkest", "Erich Kleiber"], ["Wiener Philharmoniker", "Carlos Kleiber"]], "each choice says who plays");
    assert.match(out.note, /^More than one Kleiber is on these recordings \((Carlos Kleiber, Erich Kleiber|Erich Kleiber, Carlos Kleiber)\)/);
    assert.match(out.note, /ask again with the full name/);
    assert.deepEqual(sp.reads, []);
  } finally { sp.restore(); }
  sp = spotifyFake({ search, albums: [KLEIBER_DG, ERICH_NEAR] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Beethoven", work: "Symphony No. 5", performers: ["Kleiber"], year: 1975 }, BUDGET());
    assert.equal(out.status, "choices", "never a pick, whatever the year");
    assert.equal(sp.asked.length, 1, "and no second search: a year cannot settle it");
  } finally { sp.restore(); }
  sp = spotifyFake({ search, albums: [KLEIBER_DG, ERICH_NEAR] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Beethoven", work: "Symphony No. 5", performers: ["Carlos Kleiber"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.album_id, "kleiberDG75");
  } finally { sp.restore(); }
});

test("Beach's \"Gaelic\" Symphony is searched by its nickname, and Paavo Järvi is not Neeme", async () => {
  const GAELIC = ["I. Allegro con fuoco", "II. Alla siciliana - Allegro vivace", "III. Lento con molta espressione", "IV. Allegro di molto"]
    .map((m) => `Symphony in E Minor, Op. 32 "Gaelic": ${m}`);
  const NEEME = pressing(album("beachChandos", "Beach: Symphony in E Minor 'Gaelic' / Bal masqué", { date: "1991-01-01" }),
    [...rowsOf(GAELIC, ["Amy Beach", "Detroit Symphony Orchestra", "Neeme Järvi"], [720000, 500000, 640000, 620000]),
      ["Bal masqué, Op. 22", ["Amy Beach", "Detroit Symphony Orchestra", "Neeme Järvi"], 300000]]);
  const PAAVO = pressing(album("beachPaavo", "Beach: Gaelic Symphony", { date: "2022-01-01" }),
    rowsOf(GAELIC, ["Amy Beach", "Frankfurt Radio Symphony", "Paavo Järvi"], [700000, 480000, 600000, 590000]));
  const ask = { composer: "Amy Beach", work: "Symphony in E minor, Op. 32, 'Gaelic'", performers: ["Neeme Järvi"] };
  let sp = spotifyFake({ search: () => [PAAVO.hit(1), NEEME.hit(1), NEEME.hit(3)], albums: [NEEME, PAAVO] });
  try {
    const out = await callTool(makeEnv(), "find_recording", ask, BUDGET());
    assert.deepEqual(sp.asked, ['track:"Gaelic" artist:"Neeme Järvi"']);
    assert.equal(out.status, "found");
    assert.equal(out.album_id, "beachChandos");
    assert.deepEqual(out.tracks.map((t) => t.movement), GAELIC.map((t) => t.split(": ")[1]), "Bal masqué after it is not the symphony");
  } finally { sp.restore(); }
  sp = spotifyFake({ search: () => [PAAVO.hit(1), PAAVO.hit(2)], albums: [PAAVO] });
  try {
    const out = await callTool(makeEnv(), "find_recording", ask, BUDGET());
    assert.equal(out.status, "not-found");
    assert.match(out.near[0].why, /^Neeme Järvi is not in its credits: Paavo Järvi is another Järvi/);
  } finally { sp.restore(); }
});

test("a work with a catalogue number and no nickname is searched by the number: du Pré's Elgar, with Sir John as the album credits him", async () => {
  const ELGAR = ["I. Adagio - Moderato", "II. Lento - Allegro molto", "III. Adagio", "IV. Allegro - Moderato - Allegro, ma non troppo"]
    .map((m) => `Cello Concerto in E Minor, Op. 85: ${m}`);
  const EMI = pressing(album("dupre65", "Elgar: Cello Concerto - Sea Pictures", { date: "1965-01-01" }),
    [...rowsOf(ELGAR, ["Edward Elgar", "Jacqueline du Pré", "London Symphony Orchestra", "John Barbirolli"], [480000, 270000, 290000, 690000]),
      ["Sea Pictures, Op. 37: I. Sea Slumber Song", ["Edward Elgar", "Janet Baker", "London Symphony Orchestra", "John Barbirolli"], 330000]]);
  const sp = spotifyFake({ search: () => [EMI.hit(1), EMI.hit(4)], albums: [EMI] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Elgar", work: "Cello Concerto in E minor, Op. 85",
      performers: ["Jacqueline du Pré", "Sir John Barbirolli"] }, BUDGET());
    assert.deepEqual(sp.asked, ['track:"Op. 85" artist:"Jacqueline du Pré"']);
    assert.equal(out.status, "found");
    assert.equal(out.tracks.length, 4);
    assert.deepEqual(out.players, ["Jacqueline du Pré", "London Symphony Orchestra", "John Barbirolli"]);
  } finally { sp.restore(); }
});

test("\"Pau\" is \"Pablo\": Casals's suite is found under either name", async () => {
  const CASALS = pressing(album("casals39", "Bach: Cello Suites", { date: "1988-01-01" }), suites([BACH, "Pablo Casals"], 152000));
  const sp = spotifyFake({ search: () => [CASALS.hit(1), CASALS.hit(4)], albums: [CASALS] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { ...BYLSMA_ASK, performers: ["Pau Casals"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.deepEqual(out.players, ["Pablo Casals"], "as the album credits him");
    assert.equal(out.tracks.length, 6);
    assert.deepEqual(sp.asked, ['track:"Cello Suite No. 1" artist:"Pau Casals"']);
  } finally { sp.restore(); }
});

test("a long work comes complete from the album's list: the 32 tracks of Gould's 1955 Goldbergs, from six the search returned", async () => {
  const titles = ["Aria", ...Array.from({ length: 30 }, (_, i) => `Variation ${i + 1} a ${(i + 1) % 3 ? 1 : 2} Clav.`), "Aria da capo"]
    .map((m) => `Goldberg Variations, BWV 988: ${m}`);
  const GOULD = pressing(album("gould55", "Bach: The Goldberg Variations, BWV 988 (1955 Recording)", { date: "1956" }),
    [...rowsOf(titles, [BACH, "Glenn Gould"], titles.map((_, i) => 60000 + i * 1000)),
      ["Glenn Gould in Conversation with Tim Page", ["Glenn Gould", "Tim Page"], 1800000]]);
  const sp = spotifyFake({ search: () => [1, 2, 6, 14, 26, 32].map((n) => GOULD.hit(n)), albums: [GOULD] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Bach", work: "Goldberg Variations, BWV 988", performers: ["Glenn Gould"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.tracks.length, 32);
    assert.deepEqual(out.tracks.map((t) => t.n), Array.from({ length: 32 }, (_, i) => i + 1));
    assert.equal(out.tracks[0].movement, "Aria");
    assert.equal(out.tracks[1].movement, "Variation 1 a 1 Clav.");
    assert.equal(out.tracks[31].movement, "Aria da capo");
    assert.ok(!out.tracks.some((t) => /Conversation/.test(t.title)), "the interview after it is not the work");
    assert.equal(out.complete, undefined);
  } finally { sp.restore(); }
});

test("a work in the middle of a box: the works around it left out, the same title elsewhere on it not swallowed", async () => {
  const sp = spotifyFake({ search: () => [KLEIBER_BOX.hit(5), KLEIBER_BOX.hit(37), KLEIBER_BOX.hit(7)], albums: [KLEIBER_BOX] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Beethoven", work: "Symphony No. 7 in A major, Op. 92",
      performers: ["Carlos Kleiber", "Wiener Philharmoniker"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.deepEqual(out.tracks.map((t) => t.uri), [5, 6, 7, 8].map((n) => `spotify:track:kleiberBOXt${n}`),
      "the Fifth before it and the Brahms after it are not in it, nor the Bavarian Seventh at the end of the box");
    assert.ok(out.notes.some((n) => /^Taken from a box set/.test(n)));
  } finally { sp.restore(); }
});

// Bernstein's Mahler Fifth: the search returned four of its five movements,
// the Adagietto not among them.
const MAHLER = ["I. Trauermarsch. In gemessenem Schritt", "II. Stürmisch bewegt, mit größter Vehemenz", "III. Scherzo. Kräftig, nicht zu schnell",
  "IV. Adagietto. Sehr langsam", "V. Rondo-Finale. Allegro"].map((m) => `Symphony No. 5 in C-Sharp Minor: ${m}`);
const BERNSTEIN = pressing(album("bernstein88", "Mahler: Symphony No. 5", { date: "1988-01-01" }),
  rowsOf(MAHLER, ["Gustav Mahler", "Wiener Philharmoniker", "Leonard Bernstein"], [800000, 880000, 1100000, 660000, 900000]));
const MAHLER_ASK = { composer: "Gustav Mahler", work: "Symphony No. 5 in C-sharp minor", performers: ["Leonard Bernstein", "Vienna Philharmonic"] };

test("the work complete from four of five movements; `movement` gives the one asked for, and says so", async () => {
  const sp = spotifyFake({ search: () => [1, 2, 3, 5].map((n) => BERNSTEIN.hit(n)), albums: [BERNSTEIN] });
  try {
    const e = makeEnv();
    const whole = await callTool(e, "find_recording", MAHLER_ASK, BUDGET());
    assert.equal(whole.status, "found");
    assert.equal(whole.tracks.length, 5);
    assert.equal(whole.tracks[3].movement, "IV. Adagietto. Sehr langsam", "the movement the search never showed");
    const one = await callTool(makeEnv(), "find_recording", { ...MAHLER_ASK, movement: "Adagietto" }, BUDGET());
    assert.equal(one.status, "found");
    assert.deepEqual(one.tracks, [{ n: 1, uri: "spotify:track:bernstein88t4", title: MAHLER[3], movement: "IV. Adagietto. Sehr langsam",
      duration: "11:00", duration_ms: 660000 }]);
    assert.equal(one.duration, "11:00");
    assert.match(one.notes[0], /^Only the movement asked for: IV\. Adagietto\. Sehr langsam \(movement 4 of the 5 in the work\)\.$/);
    const four = await callTool(e, "find_recording", { ...MAHLER_ASK, movement: "IV" }, BUDGET());
    assert.equal(four.kept, true, "a movement is taken from the kept work");
    assert.equal(four.tracks[0].uri, "spotify:track:bernstein88t4");
  } finally { sp.restore(); }
});

test("a release that adds an unknown artist to the same recording is turned away, whatever its date says", async () => {
  const CREDIT = ["Johannes Brahms", "Wiener Philharmoniker", "Carlos Kleiber"];
  const DG = pressing(album("brahms4dg", "Brahms: Symphony No. 4", { date: "1981-01-01" }), rowsOf(BRAHMS4, CREDIT, BRAHMS4_MS));
  // Dated earlier than the real one, so the ranking alone would have chosen it.
  const GREY = pressing(album("brahms4dsd", "Brahms: Symphony No. 4 in E Minor, Op. 98 (New DSD Mastering)", { date: "1980" }),
    rowsOf(BRAHMS4, [...CREDIT, "Marco Ventura"], BRAHMS4_MS));
  const sp = spotifyFake({ search: () => [GREY.hit(1), GREY.hit(2), DG.hit(1), DG.hit(2)], albums: [DG, GREY] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Brahms", work: "Symphony No. 4 in E minor, Op. 98",
      performers: ["Carlos Kleiber", "Wiener Philharmoniker"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.album_id, "brahms4dg");
    assert.ok(out.notes.includes('Turned away "Brahms: Symphony No. 4 in E Minor, Op. 98 (New DSD Mastering)": a release of the same ' +
      "recording that also credits Marco Ventura, which its other releases do not."), out.notes.join(" | "));
    assert.ok(!out.notes.some((n) => /also on/.test(n)), "the grey release is not counted as another album of it");
  } finally { sp.restore(); }
});

// ------------------------------------------------------------- MusicBrainz

const REC = "a1b2c3d4-0000-4000-8000-000000000501", OTHER = "a1b2c3d4-0000-4000-8000-000000000502";
const KLEIBER_MB = {
  "/ws/2/isrc/DEF057400101": { isrc: "DEF057400101", recordings: [{ id: OTHER, title: "Symphony no. 5: I.", length: 300000 },
    { id: REC, title: "Symphony no. 5 in C minor, op. 67: I. Allegro con brio", length: 442400 }] },
  [`/ws/2/recording/${REC}`]: { id: REC, title: "Symphony no. 5 in C minor, op. 67: I. Allegro con brio", relations: [
    { type: "conductor", "target-type": "artist", direction: "backward", artist: { name: "Carlos Kleiber" } },
    { type: "performance", "target-type": "work", direction: "forward", begin: "1974-03", end: "1974-04", attributes: [],
      work: { title: "Symphony no. 5 in C minor, op. 67: I. Allegro con brio",
        relations: [{ type: "parts", direction: "backward", work: { title: "Symphony no. 5 in C minor, op. 67" } }] } },
    { type: "recorded at", "target-type": "place", direction: "forward", begin: "1974-03", end: "1974-04",
      place: { name: "Musikverein, Großer Saal", area: { name: "Wien" } } }] },
};

test("MusicBrainz, by the recording's code, adds when and where it was recorded and the whole work; never asked by the composer", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  const mb = musicbrainz(KLEIBER_MB);
  try {
    const e = mbHouse();
    const out = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(out.status, "found");
    assert.deepEqual(out.checked, { source: "musicbrainz", recorded: "1974-03 to 1974-04", place: "Musikverein, Großer Saal, Wien",
      work: "Symphony no. 5 in C minor, op. 67" });
    assert.ok(!out.notes.some((n) => /not confirmed/.test(n)), out.notes.join(" | "));
    assert.deepEqual(mb.heard.map((h) => h.path), ["/ws/2/isrc/DEF057400101", `/ws/2/recording/${REC}`],
      "the code, then the recording nearest the track's length");
    assert.ok(mb.heard.every((h) => h.ua === MB_UA), "the house names itself, as MusicBrainz asks");
    assert.ok(!mb.heard.some((h) => /query=|beethoven/i.test(h.search)), "never a search, never the composer");
    assert.deepEqual(e.__naps, [0, 1100], "a second apart");
    assert.equal(out.spotify_calls, 2, "MusicBrainz is not Spotify");
  } finally { mb.restore(); sp.restore(); }
});

test("a MusicBrainz that refuses the work's own relations is asked once more without them, inside the three requests", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  const path = `/ws/2/recording/${REC}`;
  const mb = musicbrainz({ ...KLEIBER_MB, [path]: (url) => (url.searchParams.get("inc").includes("work-level-rels")
    ? Response.json({ error: "work-level-rels is not a valid inc parameter for the recording resource." }, { status: 400 })
    : KLEIBER_MB[path]) });
  try {
    const out = await callTool(mbHouse(), "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(out.checked.recorded, "1974-03 to 1974-04");
    assert.equal(mb.heard.length, 3);
    assert.ok(!mb.heard[2].search.includes("work-level-rels"));
  } finally { mb.restore(); sp.restore(); }
});

test("MusicBrainz down: still found, `checked` null and said so, three requests at most, and not asked again within the hour", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  const mb = musicbrainz(KLEIBER_MB, { busy: 99 });
  try {
    const e = mbHouse();
    const out = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.checked, null);
    assert.ok(out.notes.includes("MusicBrainz did not answer just now: the year recorded is not confirmed."));
    assert.equal(mb.heard.length, 3, "busy every time: the tries stop at three");
    const spotifyBefore = sp.heard.length;
    const again = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(again.kept, true);
    assert.equal(again.checked, null);
    assert.equal(mb.heard.length, 3, "remembered for an hour");
    assert.equal(sp.heard.length, spotifyBefore);
  } finally { mb.restore(); sp.restore(); }
});

test("MusicBrainz with no entry for the code says so, and it is kept without asking again", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  const mb = musicbrainz({});
  try {
    const e = mbHouse();
    const out = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(out.checked, null);
    assert.ok(out.notes.includes("MusicBrainz has no entry for this code: the year recorded is not confirmed."));
    assert.equal(mb.heard.length, 1);
    await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(mb.heard.length, 1, "no entry is an answer: not asked again");
  } finally { mb.restore(); sp.restore(); }
});

test("a year MusicBrainz contradicts makes a choice, not a find, and nothing is kept", async () => {
  const KARAJAN = pressing(album("karajan63", "Beethoven: Symphony No. 5", { date: "1963" }),
    rowsOf(B5, [BEETHOVEN, "Berliner Philharmoniker", "Herbert von Karajan"], [430000, 560000, 300000, 520000], (i) => (i ? {} : { isrc: "DEF057700201" })));
  const sp = spotifyFake({ search: () => [KARAJAN.hit(1), KARAJAN.hit(2)], albums: [KARAJAN] });
  const mb = musicbrainz({
    "/ws/2/isrc/DEF057700201": { recordings: [{ id: REC, length: 430000 }] },
    [`/ws/2/recording/${REC}`]: { relations: [{ type: "performance", "target-type": "work", begin: "1977-01", end: "1977-01",
      work: { title: "Symphony no. 5 in C minor, op. 67: I. Allegro con brio" } }] },
  });
  try {
    const e = mbHouse();
    const out = await callTool(e, "find_recording", { composer: "Beethoven", work: "Symphony No. 5", year: 1963,
      performers: ["Herbert von Karajan", "Berlin Philharmonic"] }, BUDGET());
    assert.equal(out.status, "choices");
    assert.equal(out.choices[0].album_id, "karajan63");
    assert.match(out.choices[0].note, /MusicBrainz says this one was recorded 1977-01/);
    assert.match(out.note, /made 1977-01, not in 1963/);
    assert.equal(out.spotify_calls, 2, "one album near the year: no second search");
    assert.deepEqual((await e.PROGRAMS.list({ prefix: "recording:" })).keys, []);
  } finally { mb.restore(); sp.restore(); }
});

test("MusicBrainz's facts are read by rule: the dated relationship, the city when there is no hall, live when it says so", () => {
  assert.deepEqual(recordingFacts({ relations: [
    { type: "recorded in", "target-type": "area", area: { name: "Bayreuth" } },
    { type: "performance", "target-type": "work", attributes: ["live"], work: { title: "Symphony no. 9 in D minor, op. 125" } },
    { type: "conductor", "target-type": "artist", begin: "1951-07-29", end: "1951-07-29" }] }),
  { recorded: "1951-07-29", years: [1951, 1951], place: "Bayreuth", work: "Symphony no. 9 in D minor, op. 125", live: true });
  assert.deepEqual(recordingFacts({}), { recorded: null, years: null, place: null, work: null, live: false });
});

// ---------------------------------------------------- what it keeps and spends

test("a kept answer costs no Spotify call, whatever order or language the players are named in", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  try {
    const e = makeEnv();
    const puts = [];
    const put = e.PROGRAMS.put.bind(e.PROGRAMS);
    e.PROGRAMS.put = async (k, v, o) => { puts.push([k, o]); return put(k, v, o); };
    const first = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET());
    assert.equal(first.kept, undefined);
    const kept = puts.find(([k]) => k.startsWith("recording:"));
    assert.equal(kept[0], recordingKey(askOf(KLEIBER_ASK)));
    assert.equal(kept[1].expirationTtl, RESEARCH_TTL_S, "as long as the house keeps an artist's folder");
    const before = sp.heard.length;
    const again = await callTool(e, "find_recording", { ...KLEIBER_ASK, performers: ["Wiener Philharmoniker", "Carlos Kleiber"] }, BUDGET());
    assert.equal(again.kept, true);
    assert.equal(again.spotify_calls, 0);
    assert.equal(sp.heard.length, before, "not one call");
    assert.deepEqual(again.tracks, first.tracks);
  } finally { sp.restore(); }
});

test("the caps: two searches and two album reads at most, a long box read in part and said so", async () => {
  // A year that settles nothing: two searches, then a question.
  let sp = spotifyFake({ search: PINNOCK_HITS, albums: [PINNOCK_82, PINNOCK_07] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Bach", work: "Brandenburg Concerto No. 3",
      performers: ["Trevor Pinnock"], year: 2010 }, BUDGET());
    assert.equal(out.status, "choices");
    assert.match(out.note, /the year 2010 does not settle which/);
    assert.equal(sp.asked.length, 2);
    assert.deepEqual(sp.reads, []);
  } finally { sp.restore(); }
  // A box of 150: the work on its fourth disc, found with one page more.
  const RICHTER = [BACH, "Münchener Bach-Orchester", "Karl Richter"];
  const disc = (d, n, f) => Array.from({ length: n }, (_, i) => f(i) ?? [`Cantata BWV ${d * 100 + i}: Aria`, RICHTER, 200000, { disc: d }]);
  const BOX150 = pressing(album("richterBOX", "Karl Richter: The Complete Archiv Recordings", { date: "2020-01-01", artists: ["Karl Richter"] }),
    [1, 2, 3, 4, 5].flatMap((d) => disc(d, 30, (i) => (d === 4 && i < 3
      ? [`Brandenburg Concerto No. 3 in G Major, BWV 1048: ${["I. Allegro", "II. Adagio", "III. Allegro"][i]}`, RICHTER, 330000, { disc: 4 }] : null))));
  sp = spotifyFake({ search: () => [BOX150.hit(91)], albums: [BOX150] });
  try {
    const out = await callTool(makeEnv(), "find_recording", { composer: "Bach", work: "Brandenburg Concerto No. 3", performers: ["Karl Richter"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.deepEqual(out.tracks.map((t) => t.uri), [91, 92, 93].map((n) => `spotify:track:richterBOXt${n}`));
    assert.equal(out.complete, undefined);
    assert.deepEqual(sp.reads, ["/v1/albums/richterBOX", "/v1/albums/richterBOX/tracks?limit=50&offset=70"]);
  } finally { sp.restore(); }
  // A Passion of 68 numbers in a box of 200: more than two reads would hold.
  const PASSION = Array.from({ length: 68 }, (_, i) => `Matthäus-Passion, BWV 244: ${i + 1}. ${i % 2 ? "Rezitativ" : "Chor"}`);
  const BOX200 = pressing(album("richter200", "Karl Richter: The Complete Recordings", { date: "2021-01-01", artists: ["Karl Richter"] }),
    Array.from({ length: 200 }, (_, i) => (i >= 40 && i < 108 ? [PASSION[i - 40], RICHTER, 180000, { disc: Math.floor(i / 40) + 1 }]
      : [`Cantata BWV ${i}: Aria`, RICHTER, 200000, { disc: Math.floor(i / 40) + 1 }])));
  sp = spotifyFake({ search: () => [BOX200.hit(43)], albums: [BOX200] });
  try {
    const e2 = makeEnv();
    const out = await callTool(e2, "find_recording", { composer: "Bach", work: "Matthäus-Passion, BWV 244", performers: ["Karl Richter"] }, BUDGET());
    assert.equal(out.status, "found");
    assert.equal(out.tracks.length, 60, "tracks 41 to 100: as far as two reads reach");
    assert.equal(out.tracks[0].movement, "1. Chor");
    assert.equal(out.complete, false);
    assert.ok(out.notes.some((n) => /read in part: the work may go on/.test(n)));
    assert.equal(sp.reads.length, 2, "never a third");
    assert.equal(out.spotify_calls, 3);
    assert.deepEqual((await e2.PROGRAMS.list({ prefix: "recording:" })).keys, [], "a work read in part is not kept");
  } finally { sp.restore(); }
});

test("the quota lockout: refused in search_tracks's own words, nothing spent; a budget too small is refused first too", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  const mb = musicbrainz(KLEIBER_MB);
  try {
    const e = mbHouse();
    await e.PROGRAMS.put("spotify:throttled", JSON.stringify({ until: Date.now() + 2 * 3600 * 1000 }));
    const said = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET()).catch((err) => err.message);
    assert.equal(said, "Spotify is limiting this account's requests (quota exceeded) for about 2 hours more. Nothing was searched. Do not retry now.");
    const theirs = await callTool(e, "search_tracks", { queries: [{ title: "x" }] }, BUDGET()).catch((err) => err.message);
    assert.equal(said, theirs, "the same words as search_tracks");
    assert.deepEqual(sp.heard, []);
    assert.deepEqual(mb.heard, []);
    await e.PROGRAMS.delete("spotify:throttled");
    const short = await callTool(e, "find_recording", KLEIBER_ASK, { remaining: 3 }).catch((err) => err.message);
    assert.match(short, /needs up to 5 lookups .* only 3 are left/);
    assert.deepEqual(sp.heard, []);
  } finally { mb.restore(); sp.restore(); }
  // Spotify refusing the search for quota mid-call: said as a quota, and stamped.
  const refused = spotifyFake({ search: () => new Response(JSON.stringify({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }),
    { status: 429, headers: { "retry-after": "3600" } }) });
  try {
    const e = makeEnv();
    const said = await callTool(e, "find_recording", KLEIBER_ASK, BUDGET()).catch((err) => err.message);
    assert.match(said, /^Spotify is limiting this account's requests \(quota exceeded\)\. Nothing was found or kept\. Do not retry now\.$/);
    assert.ok(await e.PROGRAMS.get("spotify:throttled"), "the lockout is stamped for every tool");
  } finally { refused.restore(); }
});

test("the arguments are checked in words, and a 0 or a blank is not given", async () => {
  const sp = spotifyFake({ search: KLEIBER_HITS, albums: KLEIBER_ALBUMS });
  try {
    const e = makeEnv();
    const said = (a) => callTool(e, "find_recording", a, BUDGET()).catch((err) => err.message);
    assert.match(await said({ work: "Symphony No. 5", performers: ["Kleiber"] }), /composer is required/);
    assert.match(await said({ composer: "Beethoven", performers: ["Kleiber"] }), /work is required/);
    assert.match(await said({ composer: "Beethoven", work: "Symphony No. 5", performers: [] }), /performers is required/);
    assert.match(await said({ composer: "Beethoven", work: "Symphony No. 5", performers: ["a", "b", "c", "d", "e"] }), /four names at most/);
    assert.match(await said({ ...KLEIBER_ASK, year: 1066 }), /year is the year the recording was made/);
    assert.deepEqual(sp.heard, []);
    const blank = await callTool(e, "find_recording", { ...KLEIBER_ASK, year: 0, movement: "" }, BUDGET());
    assert.equal(blank.status, "found");
    assert.equal(blank.tracks.length, 4);
  } finally { sp.restore(); }
});

// ------------------------------------------------------- where it is offered

test("offered where search_tracks is: the owner's list and the curator's, never Talk's; a read, said calmly", () => {
  const e = makeEnv();
  assert.ok(toolsWithMeta(e).some((t) => t.name === "find_recording"));
  assert.ok(AGENT_TOOLS.has("find_recording") && AGENT_TOOLS.has("search_tracks"));
  assert.ok(!VOICE_TOOLS.has("find_recording"));
  assert.ok(!voiceFunctions(e).some((f) => f.name === "find_recording"));
  const [title, hints] = TOOL_META.find_recording;
  assert.equal(title, "Find a Classical Recording");
  assert.deepEqual(hints, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  const at = TOOLS.findIndex((t) => t.name === "find_recording");
  assert.equal(TOOLS[at - 1].name, "search_tracks", "beside the search it is the alternative to");
  const schema = TOOLS[at].inputSchema;
  assert.deepEqual(schema.required, ["composer", "work", "performers"]);
  assert.equal(schema.properties.performers.maxItems, 4);
  assert.equal(schema.properties.year.type, "integer");
});
