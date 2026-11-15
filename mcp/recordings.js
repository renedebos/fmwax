// THE RECORDING FINDER (MC-41 stage 0, 2026-11-12; the plan in
// tasks/mc41-classical-dj.md, the measured trial in
// tasks/classical-finder-trial.md). Someone who knows the music names a work
// and its players ("Beethoven's Fifth, Kleiber, Vienna") and wants THAT
// recording, every movement, in order, from one album. Spotify's search alone
// got 21 of 25 such asks right in the trial, and its one error was silent:
// asked for Anner Bylsma's 1979 Bach suites it gave his 1992 ones, and nothing
// on Spotify said so. So the house does what the trial found works:
//
//   1. one search for candidates (two when a year was given and is needed);
//   2. the candidates filtered, grouped and ranked here, by rule;
//   3. the chosen album's own track list, for the work complete and in order;
//   4. MusicBrainz, by the recording's code, for when and where it was made.
//
// Every rule below is a pure function, so each obstacle the trial met is a
// test with no network (test/recordings.test.js). findRecording, at the
// bottom, is the one that calls Spotify, MusicBrainz and the store.
//
// No DJ yet, and nothing on a page: a tool of the house, for the curator and
// the Claude app. Opus, the classical DJ, comes at stage 1.
import { RESEARCH_TTL_S, researchSlug } from "./endless.js";
import { checkRecording } from "./musicbrainz.js";
import { clock, waitWords } from "./programs.js";
import { catalogFor, houseCatalogNames, minutesLeft, programsKV, throttledUntil } from "./services.js";

// ------------------------------------------------------------ names, folded

// Folded for comparing: lower case, no accents, "ß" as "ss". German writes an
// umlaut two ways, so a name on a record is also folded the second way:
// "Furtwängler" and "Furtwaengler" are one conductor.
const LETTER = { "ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ı": "i" };
const UMLAUT = { "ä": "ae", "ö": "oe", "ü": "ue" };
export function fold(s) {
  return String(s ?? "").normalize("NFC").toLowerCase().replace(/[ßøæœłđı]/g, (c) => LETTER[c])
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
const foldUmlauts = (s) => fold(String(s ?? "").normalize("NFC").toLowerCase().replace(/[äöü]/g, (c) => UMLAUT[c]));
// The words alone, single-spaced: "Symphony No.5 In C Minor, Op.67" is
// "symphony no 5 in c minor op 67". "N°" and "#" are the word "no".
const wordsOf = (folded) => folded.replace(/\bn\s*[°º]/g, "no ").replace(/#/g, " no ")
  .replace(/[^a-z0-9]+/g, " ").trim();
export const words = (s) => wordsOf(fold(s));
// Whole words only, so "Kleiber" is found in "Carlos Kleiber" and "Bach" is
// not found in "Offenbach".
const hasWord = (name, word) => !!word &&
  (` ${words(name)} `.includes(` ${word} `) || ` ${wordsOf(foldUmlauts(name))} `.includes(` ${word} `));

// ---------------------------------------------------------- people and bands

// The same family name spelled from another alphabet. SMALL ON PURPOSE: the
// common Russian composers and players whose names reach records in two or
// three spellings, and Händel. Anything not here is matched as written.
const SPELLINGS = [
  ["rachmaninoff", "rachmaninov", "rakhmaninov", "rachmaninow"],
  ["tchaikovsky", "tschaikowsky", "tchaikowsky", "chaikovsky", "tschaikovsky"],
  ["stravinsky", "strawinsky"],
  ["prokofiev", "prokofieff", "prokofjew"],
  ["mussorgsky", "moussorgsky", "musorgsky"],
  ["shostakovich", "schostakowitsch", "chostakovitch"],
  ["scriabin", "skryabin", "scriabine"],
  ["korsakov", "korsakoff"],
  ["rostropovich", "rostropowitsch"],
  ["oistrakh", "oistrach"],
  ["handel", "haendel"],
];
// The orchestras whose names are translated on records: Deutsche Grammophon
// credits the Wiener Philharmoniker, a listener says the Vienna Philharmonic.
// SMALL ON PURPOSE, as SPELLINGS: the ensembles a classical listener names
// most, each group one ensemble under its names, Spotify's credit first (that
// one goes into the search). An ensemble not here is matched by its own words.
const ENSEMBLES = [
  ["Wiener Philharmoniker", "Vienna Philharmonic", "Vienna Philharmonic Orchestra"],
  ["Berliner Philharmoniker", "Berlin Philharmonic", "Berlin Philharmonic Orchestra"],
  ["Wiener Symphoniker", "Vienna Symphony", "Vienna Symphony Orchestra"],
  ["Symphonieorchester des Bayerischen Rundfunks", "Bavarian Radio Symphony Orchestra", "Bavarian Radio Symphony"],
  ["Bayerisches Staatsorchester", "Bavarian State Orchestra"],
  ["Gewandhausorchester", "Leipzig Gewandhaus Orchestra", "Gewandhausorchester Leipzig"],
  ["Royal Concertgebouw Orchestra", "Koninklijk Concertgebouworkest", "Concertgebouworkest", "Concertgebouw Orchestra"],
  ["Staatskapelle Dresden", "Sächsische Staatskapelle Dresden", "Dresden Staatskapelle"],
  ["Czech Philharmonic", "Česká filharmonie", "Czech Philharmonic Orchestra"],
  ["Orchester der Bayreuther Festspiele", "Bayreuth Festival Orchestra", "Bayreuther Festspielorchester"],
  ["Orchester der Wiener Staatsoper", "Vienna State Opera Orchestra"],
  ["Wiener Sängerknaben", "Vienna Boys' Choir", "Vienna Boys Choir"],
  ["Orchestre National de France", "French National Orchestra"],
];
// A word that makes a name a band rather than a person.
const ENSEMBLE_WORDS = new Set(("orchestra orchester orchestre orquesta orquestra orkest orchestr philharmonic " +
  "philharmoniker philharmonie philharmonia filharmonie filarmonica symphony symphoniker sinfonie " +
  "sinfonieorchester sinfonia sinfonietta ensemble quartet quartett quatuor quartetto trio quintet choir chorus " +
  "chor coro choeur consort concert concerto academy akademie academie players soloists solisti staatskapelle " +
  "kapelle capella cappella camerata collegium band singers scholars musici kammerorchester kammerphilharmonie " +
  "gewandhausorchester concertgebouworkest festspielorchester staatsorchester sangerknaben").split(" "));
// The words that say nothing about WHICH band: "of the", and "orchestra" in
// its languages ("the London Symphony" and "the London Symphony Orchestra"
// are one). "Symphony" and "Philharmonic" stay: the Vienna Philharmonic and
// the Vienna Symphony are two orchestras.
const GENERIC = new Set(("the of and et und y e de der des du di del della la le les das die in " +
  "orchestra orchester orchestre orquesta orquestra orkest").split(" "));
const distinctive = (name) => {
  const all = words(name).split(" ").filter(Boolean);
  const own = all.filter((w) => !GENERIC.has(w));
  return own.length ? own : all;
};
const sameSet = (a, b) => a.length === b.length && a.every((w) => b.includes(w));
const SUFFIXES = new Set(["jr", "sr", "ii", "iii"]);

// A NAME, TAKEN APART (the namesakes, 2026-11-12): the family name is the
// last word, and the given names are the words before it. A title is not a
// given name (Sir John Barbirolli is John Barbirolli), nor is a particle
// (Ludwig van Beethoven's is Ludwig), nor an article, so a band with no band
// word in its name ("Il Giardino Armonico") reads the same with or without
// its "Il". Hyphens part words: "Nézet-Séguin" is two. "Bach, J.S." is J.S.
// Bach; "J.S." and "JS" are two initials.
const TITLES = new Set("sir dame lord dr prof maestro".split(" "));
const PARTICLES = new Set("von van de du di della le la der den il les the el".split(" "));
export function nameParts(name) {
  let s = String(name ?? "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  if (s.includes(",")) { const [fam, ...rest] = s.split(","); s = `${rest.join(" ")} ${fam}`; }
  const tokens = (folding) => folding(s).split(" ").filter((w) => w && !SUFFIXES.has(w) && !TITLES.has(w) && !PARTICLES.has(w));
  const plain = tokens(words), umlauts = tokens((x) => wordsOf(foldUmlauts(x)));
  const family = plain.at(-1) ?? "";
  const given = plain.slice(0, -1).flatMap((w) => (w.length <= 3 && !/[aeiouy]/.test(w) ? [...w] : [w]));
  // Both foldings, so an asked "Furtwängler" finds a credit spelled
  // "Furtwaengler" as well as the other way round.
  return { family, families: [...new Set([family, umlauts.at(-1)])].filter(Boolean), given };
}
export const familyName = (name) => nameParts(name).family;

// Whether two people's given names agree, BY THEIR FIRST LETTERS, one name
// against the next: "Pau" and "Pablo", "J.S." and "Johann Sebastian",
// "Sergei" and "Serge", "Pyotr" and "Peter". First letters and not whole
// names, because a given name crosses languages and alphabets: one Russian
// conductor is Yuri on one label and Juri on another, one pianist Evgeny and
// Yevgeny, one violinist Jascha and Yascha. So y, j and i count as one letter,
// and so do e and y. Carlos and Erich Kleiber, Neeme and Paavo Järvi,
// Wolfgang Amadeus and Leopold Mozart do not agree; nor do J.S. and J.C. Bach,
// at the second name. A name with none ("Kleiber") agrees with any. And the
// shorter list standing inside the longer agrees too: that is a double family
// name written apart ("Vaughan Williams", for Ralph Vaughan Williams;
// "Rimsky-Korsakov", for Nikolai Rimsky-Korsakov).
const LETTER_KIN = ["yji", "ey"];
const sameLetter = (a, b) => a === b || LETTER_KIN.some((k) => k.includes(a) && k.includes(b));
export function givenAgree(a, b) {
  if (!a?.length || !b?.length) return true;
  const n = Math.min(a.length, b.length);
  if (a.slice(0, n).every((w, i) => sameLetter(w[0], b[i][0]))) return true;
  const inside = (xs, ys) => xs.every((w) => ys.includes(w));
  return inside(a, b) || inside(b, a);
}
// The family name a credit is under, as the credit writes it: "Kleiber" for
// "Erich Kleiber", for a refusal in words.
const surnameOf = (credit) => String(credit ?? "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/).at(-1) ?? "";
// What the kept answer is filed under for a person: the initials and the
// family name, so Carlos's Fifth and Erich's are kept apart.
const personId = (parts, family) => {
  const initials = parts.given.map((w) => ("yji".includes(w[0]) ? "j" : w[0])).join("");
  return initials ? `${initials}-${family}` : family;
};

// One named performer (or the composer), as a test on a credit. A person: the
// credit's family name in any spelling, and given names that agree (Pau
// Casals is the Pablo Casals of older records; Carlos Kleiber is never
// Erich). A band: its distinctive words, all of them in one credit, under any
// of its names. `namesake` is a credit with the family name and other given
// names; `given` the credit's given names, which tell one Kleiber's recordings
// from another's; `mentioned` whether the name stands in an album's title.
// `id` is what the kept answer is filed by.
export function matcher(name) {
  const said = String(name ?? "").replace(/\s+/g, " ").trim();
  const own = distinctive(said);
  const group = ENSEMBLES.find((g) => g.some((n) => sameSet(distinctive(n), own)));
  if (group || words(said).split(" ").some((w) => ENSEMBLE_WORDS.has(w))) {
    const needs = (group ?? [said]).map(distinctive);
    const on = (credit) => needs.some((need) => need.every((w) => hasWord(credit, w)));
    return {
      name: said, kind: "ensemble", id: researchSlug(group ? group[0] : said), spotifyName: group ? group[0] : said,
      on, namesake: () => false, given: () => [], mentioned: on,
    };
  }
  const asked = nameParts(said);
  const spellings = SPELLINGS.find((g) => asked.families.some((f) => g.includes(f))) ?? asked.families;
  const sameFamily = (c) => c.families.some((f) => spellings.includes(f));
  return {
    name: said, kind: "person", id: personId(asked, spellings[0] ?? ""), spotifyName: said,
    on: (credit) => { const c = nameParts(credit); return sameFamily(c) && givenAgree(asked.given, c.given); },
    namesake: (credit) => { const c = nameParts(credit); return sameFamily(c) && !givenAgree(asked.given, c.given); },
    given: (credit) => nameParts(credit).given,
    mentioned: (text) => spellings.some((f) => hasWord(text, f)),
  };
}

// ------------------------------------------------------------------ the work

// A catalogue number as a listener writes one: Op. 67, BWV 1048, K. 466,
// KV 466, Hob. I:104, D. 944, RV 269, Op. 10 No. 3. The single letters
// (D, S, L, H, Z, B) count only before a number, so "in D minor" is not one.
const CATALOGUE = /(^|[^\p{L}\p{N}])((?:op(?:us)?|bwv|kv|k|hob|woo|wwv|hwv|rv|sz|bb|trv|wq|fs|jw|d|s|l|h|z|b)\.?\s*(?:[ivxlc]+\s*:\s*)?\d+[a-z]?(?:\s*,?\s*(?:no|nr)\.?\s*\d+[a-z]?)?)(?!\d)/iu;
// The work's own number: No. 5, No.5, Nr. 5, N° 5, #5.
const NUMBER = /(^|[^\p{L}\p{N}])(?:no|nr|n|#)\s*[.°º]*\s*(\d{1,4}[a-z]?)(?!\d)/iu;
// Where a bare title ends: the key ("in C minor", "in E-flat major", "in C,"),
// a comma, a colon, a bracket, a dash.
const KEY = /\s+in\s+[a-g](?:[\s-]?(?:flat|sharp|♭|♯))?(?:[\s-]+(?:major|minor)(?!\p{L})|(?=\s*(?:$|[,;:(])))/iu;

// A work's nickname, as a listener writes one: in quotes ("Gaelic",
// 'Enigma'), or the words after its catalogue number ("Op. 32 Gaelic"). Not
// a key ("Op. 32 in E minor"), a year or a bracket ("(arr. for guitar)").
const QUOTED = /["“„«]([^"“”„«»]{2,60})["”“»]|(?:^|[\s,(])['‘]([^'‘’]{2,60})['’](?=$|[\s,).;:])/u;
function nicknameOf(raw, said, cat) {
  const q = raw.match(QUOTED);
  if (q) return (q[1] ?? q[2]).trim();
  if (!cat) return null;
  const rest = said.slice(cat.index + cat[0].length).replace(/^[\s,;:–—-]+/, "");
  if (!rest || /^[([]/.test(rest) || /^in\s+[a-g](?![\p{L}])/iu.test(rest)) return null;
  const nick = rest.split(/[,;(]/)[0].replace(/[\s,;:–—.-]+$/, "").trim();
  return /\p{L}{2}/u.test(nick) ? nick : null;
}
// The words a form is named by, in the languages its titles come in. A bare
// title made of these alone ("Symphony", "Cello Concerto", "String
// Quartet", "Requiem") names a hundred works, and searched as it is it drowns
// in ten results; a title with one word of its own ("Goldberg Variations",
// "Das Lied von der Erde", "Tabula Rasa", "Ein deutsches Requiem") is the
// work's own name.
const FORM_WORDS = new Set(("symphony symphonie sinfonia sinfonie symphonies concerto concertos concerti konzert concert " +
  "sonata sonatas sonate sonaten sonatina suite suites partita partitas quartet quartets quartett quartetto quatuor " +
  "quintet quintett trio trios sextet septet octet mass messe missa requiem overture ouverture prelude preludes " +
  "fugue fugues toccata fantasia fantasy fantasie variations variation etude etudes study studies nocturne nocturnes " +
  "ballade ballades scherzo scherzi impromptu impromptus waltz waltzes valse mazurka mazurkas polonaise rhapsody " +
  "serenade divertimento cantata cantatas motet motets magnificat piece pieces " +
  "piano violin cello violoncello viola flute oboe clarinet bassoon horn trumpet trombone organ harpsichord guitar " +
  "harp keyboard lute string strings orchestra chamber double solo two three four for and with of the a in op " +
  "fur pour per et und no grand grande great little small").split(" "));
const ownWords = (title) => words(title).split(" ").some((w) => w && !FORM_WORDS.has(w) && !/^\d+$/.test(w));

// The work as asked, taken apart: `key` is what the search names, `number` the
// work's number, `catalogue` its catalogue number as written. A number after
// the catalogue number belongs to it ("Op. 10 No. 3"), not to the work.
//
// The key, for a work WITH a number: the title up to and including it,
// "Symphony No. 5" (a nickname changes nothing: "Symphony No. 6 'Pastoral'"
// is searched as "Symphony No. 6"). For a work WITHOUT one (the coordinator's
// order, 2026-11-12, after "Symphony" alone was found to drown):
//   1. its nickname, "Gaelic" for "Symphony in E minor, Op. 32, 'Gaelic'";
//   2. its own title, when it has one: "Das Lied von der Erde";
//   3. its catalogue number as a phrase, "Op. 85" for "Cello Concerto in E
//      minor, Op. 85";
//   4. the form with its key, "Symphony in E minor";
//   5. the title as it is.
// Only the search's words change: what comes back is filtered as strictly on
// the composer, every player and the catalogue number, whatever was searched.
export function parseWork(work) {
  const raw = String(work ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  const said = raw.replace(/["“”„«»]/g, "").replace(/\s+/g, " ").trim();
  const cat = said.match(CATALOGUE);
  const catalogue = cat ? cat[2].trim() : null;
  const catAt = cat ? cat.index + cat[1].length : Infinity;
  const num = said.match(NUMBER);
  const numAt = num ? num.index + num[1].length : Infinity;
  const tidy = (s) => s.replace(/[\s,;:–—'‘’-]+$/, "").trim();
  if (num && numAt < catAt) {
    const before = tidy(said.slice(0, numAt));
    return { said, key: `${before ? `${before} ` : ""}No. ${num[2]}`, number: num[2].toLowerCase(), catalogue };
  }
  const keyAt = said.search(KEY);
  const ends = [catAt, said.search(/[,:(]|\s[–—-]\s|\s['‘]/), keyAt].filter((i) => i >= 0);
  const title = tidy(said.slice(0, Math.min(...ends, said.length))) || said;
  // "Symphony 5", with no "No.": the bare number is the work's.
  const bare = title.match(/^(.*\p{L})\s+(\d{1,3})$/u);
  if (bare) return { said, key: `${bare[1]} No. ${bare[2]}`, number: bare[2], catalogue };
  const nickname = nicknameOf(raw, said, cat);
  const key = nickname ?? (ownWords(title) ? title
    : catalogue ?? (keyAt >= 0 ? tidy(said.slice(0, keyAt + said.match(KEY)[0].length)) : title));
  return { said, key, number: null, catalogue, ...(nickname ? { nickname } : {}) };
}

// Whether a title holds the work's number as a whole token, however it is
// spaced: "No.5" and "No. 5" hold 5; "No. 50" does not.
export function holdsNumber(title, number) {
  if (!number) return true;
  return new RegExp(`(?:^| )(?:no|nr|n) ?${number}(?![0-9a-z])`).test(words(title));
}
// The catalogue number as a test on a title's words. Its prefix in any of the
// ways labels write it (Op/Opus, K/KV), and the rest whatever the spacing:
// "K. 466", "K.466" and "KV 466" are one.
function catalogueTest(catalogue) {
  const runs = words(catalogue).split(" ").filter(Boolean);
  if (!runs.length) return null;
  const prefix = /^op(us)?$/.test(runs[0]) ? "(?:op|opus)" : /^kv?$/.test(runs[0]) ? "(?:kv|k)" : runs[0];
  const rest = runs.slice(1).map((r) => (r === "no" || r === "nr" ? "(?:no|nr|n)" : r));
  return {
    whole: new RegExp(`(?:^| )${[prefix, ...rest].join(" ?")}(?![0-9])`),
    system: new RegExp(`(?:^| )${prefix} ?[0-9]`),
  };
}
// A title CONTRADICTS the catalogue number when it carries another number of
// the same system (BWV 826 where BWV 1004 was asked: the keyboard partita,
// not the violin one). A title with none at all does not: plenty of labels
// leave it off, and the composer, the players and the work's number have
// already been checked.
export function catalogueClash(title, catalogue) {
  const t = catalogue ? catalogueTest(catalogue) : null;
  if (!t) return false;
  const w = words(title);
  return !t.whole.test(w) && t.system.test(w);
}

// ------------------------------------------------------- a track's title

// A movement's number at the start of its name: "I. Allegro", "IV - Finale",
// "1. Allegro con brio".
const MARK = /^([ivxlc]+|\d{1,3})\s*(?:[.):]|\s[–—-]\s)/i;
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  return n;
}
// A version said after the title ("- Remastered 2015", "(Live)") is not part
// of the movement's name.
const VERSION = /\s+[–—-]\s+(?:remaster|live|recorded|mono|stereo|\d{4}).*$|\s*[([][^)\]]*(?:remaster|live|version|recorded|mono|stereo)[^)\]]*[)\]]\s*$/i;

// A title as the work and the movement: "Symphony No. 5 in C Minor, Op. 67: I.
// Allegro con brio". The colon is where they part, the first one followed by a
// movement's number ("Tabula Rasa: I. Ludus: Con moto"), else the last one
// ("Goldberg Variations, BWV 988: Variation 1"). A label's composer in front
// ("Bach, JS: Brandenburg Concerto No. 3...") is not part of the work, when
// the composer's family name is given. A title that is only a movement ("II.
// Andante con moto", on a label that names the work on the first movement
// alone) has no work. `workKey` and `key` are the two as words, for comparing;
// `num` is the movement's number when it has one.
export function splitTitle(title, composerFamily = null) {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (composerFamily) {
    const lead = t.match(/^([^:\d]{1,40}):\s+/);
    if (lead && hasWord(lead[1], composerFamily)) t = t.slice(lead[0].length);
  }
  let work = null, movement = null;
  const cuts = [...t.matchAll(/:\s+/g)].map((m) => [m.index, m.index + m[0].length]);
  const cut = cuts.find(([, after]) => MARK.test(t.slice(after))) ?? cuts.at(-1);
  if (cut) {
    work = t.slice(0, cut[0]).trim();
    movement = t.slice(cut[1]).trim();
  } else {
    const dash = t.match(/^(.*\S)\s+[–—-]\s+((?:[ivxlc]+|\d{1,3})\s*[.)].*)$/i);
    if (dash) { work = dash[1]; movement = dash[2]; } else if (MARK.test(t)) movement = t; else work = t;
  }
  const bare = (movement ?? "").replace(VERSION, "").trim();
  const mark = bare.match(MARK);
  const num = mark ? (/^\d/.test(mark[1]) ? Number(mark[1]) : romanValue(mark[1].toLowerCase())) : null;
  return {
    work, movement,
    workKey: work === null ? null : words(work),
    key: num !== null ? `#${num}` : words(bare),
    num,
  };
}

// ------------------------------------------------------- the albums

// A compilation is never the source (the plan: "the work comes from an album
// made of that recording"). Spotify's own type, or a name that says so.
const COMPILATION_NAME = /\b(?:best of|very best|greatest|great recordings|essentials?|for (?:relaxation|relaxing|studying|study|sleep|sleeping))\b|\b(?:100|50)\b.*\bpieces\b/;
// A box of one artist's recordings ("The Complete Orchestral Recordings on
// Deutsche Grammophon") is not a compilation in that sense: the recording is
// the artist's own, in a set of them. It is kept, and used only when no
// album of its own holds the recording.
const BOX_NAME = /\b(?:complete|collection|edition|box|recordings)\b/;
const BOX_MIN_TRACKS = 40;
export function albumKind(album, ask) {
  const name = words(album?.name);
  if (COMPILATION_NAME.test(name)) return "compilation";
  const big = Number(album?.total_tracks) >= BOX_MIN_TRACKS;
  const boxy = BOX_NAME.test(name) && big;
  if (album?.album_type === "compilation") {
    const own = (album.artists ?? []).some((a) => ask.performers.some((p) => p.on(a?.name)));
    return boxy && own ? "box" : "compilation";
  }
  return boxy ? "box" : "album";
}
// An album named for the work or the composer: "Beethoven: Symphonies Nos. 5
// & 7" is the Fifth's; "Kleiber Conducts" is somebody's evening.
export function namedFor(album, ask) {
  const name = words(album?.name);
  return ask.composerMatch.mentioned(album?.name) || (!!words(ask.key) && name.includes(words(ask.key)));
}
const yearOf = (album) => (/^\d{4}/.test(String(album?.release_date ?? "")) ? Number(String(album.release_date).slice(0, 4)) : null);
// The order albums of one recording are preferred in: an album of its own
// before a box; named for the work or the composer first; then the fewest
// tracks (the record made of it, not the anthology); then the earliest date
// (the first issue, not the reissue); then the search's own order.
export function albumOrder(a, b) {
  return ((a.kind === "box") - (b.kind === "box")) ||
    ((b.named ? 1 : 0) - (a.named ? 1 : 0)) ||
    ((Number(a.album.total_tracks) || 9999) - (Number(b.album.total_tracks) || 9999)) ||
    ((yearOf(a.album) ?? 9999) - (yearOf(b.album) ?? 9999)) ||
    String(a.album.release_date ?? "").localeCompare(String(b.album.release_date ?? "")) ||
    (a.first - b.first);
}

// ---------------------------------------------------- weighing what came back

// Why a track is not the one asked for, in words, or null when it may be.
// The composer: a family name among the credits, and not merely inside a named
// band's name (Bach Collegium Japan is not Bach). Every named performer among
// the credits: this turns away a remake with another band (Pinnock's 2007
// Brandenburgs with the European Brandenburg Ensemble, when the English
// Concert was asked), and a namesake (Erich Kleiber's Fifth when Carlos's was
// asked), said as one. The work's number, and no other catalogue number.
const creditsOf = (track) => (track?.artists ?? []).map((a) => String(a?.name ?? "")).filter(Boolean);
export function whyNot(track, ask) {
  const credits = creditsOf(track);
  const list = credits.join(", ") || "no one";
  // A composer who plays (Rachmaninoff at the piano) is one credit for both.
  const composerSelf = ask.performers.some((p) => p.on(ask.composer) || ask.composerMatch.on(p.name));
  const byComposer = credits.some((c) => ask.composerMatch.on(c) && (composerSelf || !ask.performers.some((p) => p.on(c))));
  if (!byComposer) {
    const other = credits.find((c) => ask.composerMatch.namesake(c));
    return other ? `not by ${ask.composer}: ${other} is another ${surnameOf(other)}` : `not by ${ask.composer}: it credits ${list}`;
  }
  const missing = ask.performers.find((p) => !credits.some((c) => p.on(c)));
  if (missing) {
    const other = credits.find((c) => missing.namesake(c));
    return other ? `${missing.name} is not in its credits: ${other} is another ${surnameOf(other)} (${list})`
      : `${missing.name} is not in its credits (${list})`;
  }
  if (!holdsNumber(track?.name, ask.number)) return `its title is not No. ${ask.number}`;
  if (catalogueClash(track?.name, ask.catalogue)) return `its catalogue number is not ${ask.catalogue}`;
  return null;
}

// Two takes are the same recording when the same movement is within this of
// each other (the brief, from the trial's lengths: Bylsma's two Preludes are
// 2:11 and 2:25; a remaster of one take moves by a second or two).
export const SAME_MS = 4000;

// The hits that are one recording. Two hits of the same movement within four
// seconds are one; two hits of one album's run of the work are one (the same
// disc and work, and as far apart in tracks as in movements). Never joined: a
// group that would hold the same movement twice, more than four seconds apart
// (two recordings, whatever the chain of evidence says), nor one that would
// hold two people of one family name (Carlos and Erich Kleiber, asked only as
// "Kleiber"), however alike their lengths. An album can hold two
// (Rachmaninoff's two takes of his own Second Concerto in one box).
export function sameRecording(hits) {
  const group = hits.map((_, i) => i);
  const top = (i) => (group[i] === i ? i : (group[i] = top(group[i])));
  const members = (g) => hits.filter((_, i) => top(i) === g);
  const join = (i, j) => {
    const a = top(i), b = top(j);
    if (a === b) return;
    const clash = members(a).some((x) => members(b).some((y) =>
      (x.part.key === y.part.key && Math.abs(x.ms - y.ms) > SAME_MS) || otherPeople(x.who, y.who)));
    if (!clash) group[a] = b;
  };
  const pairs = [];
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) pairs.push([i, j]);
  // The strongest evidence first: the same movement, the same length.
  for (const [i, j] of pairs) {
    if (hits[i].part.key === hits[j].part.key && Math.abs(hits[i].ms - hits[j].ms) <= SAME_MS) join(i, j);
  }
  for (const [i, j] of pairs) {
    const a = hits[i], b = hits[j];
    if (a.track.album.id !== b.track.album.id || a.part.key === b.part.key) continue;
    if ((a.track.disc_number ?? 1) !== (b.track.disc_number ?? 1) || !a.part.workKey || a.part.workKey !== b.part.workKey) continue;
    const apart = Math.abs((a.track.track_number ?? 0) - (b.track.track_number ?? 0));
    if (a.part.num !== null && b.part.num !== null && apart !== Math.abs(a.part.num - b.part.num)) continue;
    join(i, j);
  }
  const out = new Map();
  hits.forEach((h, i) => { const g = top(i); if (!out.has(g)) out.set(g, []); out.get(g).push(h); });
  return [...out.values()];
}

// A RELEASE THAT ADDS AN ARTIST (the trial: three 2025-26 "New DSD Mastering"
// albums of Kleiber's Brahms Fourth, from a label nobody knows). Within one
// recording, an album whose credit for a movement carries someone that the
// other albums' credits for that same movement do not — beyond the composer
// and the players named — is turned away, as long as another album of the
// recording is left. Compared movement by movement, because a label may
// credit the soloists on the finale alone.
export function addedCredits(albums, ask) {
  const known = (c) => ask.composerMatch.on(c) || ask.performers.some((p) => p.on(c));
  const out = new Map();
  for (const a of albums) {
    for (const h of a.hits) {
      const others = albums.filter((o) => o !== a).flatMap((o) => o.hits.filter((x) => x.part.key === h.part.key));
      if (!others.length) continue;
      for (const c of (h.track.artists ?? []).map((x) => String(x?.name ?? "")).filter(Boolean)) {
        if (known(c) || others.some((x) => (x.track.artists ?? []).some((y) => words(y?.name) === words(c)))) continue;
        if (!out.has(a.album.id)) out.set(a.album.id, c);
      }
    }
  }
  return out.size >= albums.length ? new Map() : out;
}

// WHO, ON A TRACK: for the composer and each named player, the credit that
// answered to them, with its given names. Asked with a given name, every
// credit that answers agrees with it; asked with the family name alone
// ("Kleiber", "Bach"), credits of several people can, and this is how they are
// told apart. A credit with no given name ("Kleiber") is anyone's.
const whoOf = (track, ask) => {
  const credits = creditsOf(track);
  return [ask.composerMatch, ...ask.performers].map((m) => {
    const c = credits.find((x) => m.on(x));
    return c ? { name: c, given: m.given(c) } : null;
  });
};
const otherPeople = (a, b) => !!a && !!b &&
  a.some((x, k) => x?.given.length && b[k]?.given.length && !givenAgree(x.given, b[k].given));
// The people of one family name the recordings hold, when there are more
// than one ("Carlos Kleiber", "Erich Kleiber"), else null: never a pick, the
// listener chooses.
export function namesakesIn(recordings) {
  const whos = recordings.map((r) => r.albums.flatMap((a) => a.hits.map((h) => h.who)).filter(Boolean));
  for (let i = 0; i < whos.length; i++) {
    for (let j = i + 1; j < whos.length; j++) {
      for (const a of whos[i]) {
        for (const b of whos[j]) {
          const k = a.findIndex((x, n) => x?.given.length && b[n]?.given.length && !givenAgree(x.given, b[n].given));
          if (k >= 0) {
            const names = [...new Set(whos.flat().map((w) => w[k]?.name).filter(Boolean))]
              .filter((n) => nameParts(n).given.length);
            return { names, family: surnameOf(names[0]) };
          }
        }
      }
    }
  }
  return null;
}

// Everything one search (or two) returned, weighed: the recordings that fit,
// each with its albums in the order they are preferred; the tracks turned
// away and why; the albums turned away and why.
export function weigh(items, ask) {
  const misses = [], turned = [], hits = [];
  const seen = new Set();
  let order = 0;
  for (const t of items ?? []) {
    if (!t?.uri || !t.album?.id || seen.has(t.uri)) continue;
    seen.add(t.uri);
    const why = whyNot(t, ask);
    if (why) { misses.push({ track: t, why }); continue; }
    hits.push({ track: t, part: splitTitle(t.name, ask.composerFamily), ms: Number(t.duration_ms) || 0, first: order++,
      who: whoOf(t, ask) });
  }
  const kinds = new Map();
  const kept = hits.filter((h) => {
    const a = h.track.album;
    if (!kinds.has(a.id)) kinds.set(a.id, albumKind(a, ask));
    if (kinds.get(a.id) !== "compilation") return true;
    if (!turned.some((x) => x.album.id === a.id)) turned.push({ album: a, track: h.track, why: "a compilation" });
    return false;
  });
  const recordings = [];
  for (const g of sameRecording(kept)) {
    const byAlbum = new Map();
    for (const h of g) {
      const a = h.track.album;
      if (!byAlbum.has(a.id)) byAlbum.set(a.id, { album: a, kind: kinds.get(a.id), named: namedFor(a, ask), hits: [], first: h.first });
      byAlbum.get(a.id).hits.push(h);
    }
    let albums = [...byAlbum.values()];
    const added = addedCredits(albums, ask);
    for (const [id, who] of added) {
      const a = byAlbum.get(id);
      turned.push({ album: a.album, track: a.hits[0].track,
        why: `a release of the same recording that also credits ${who}, which its other releases do not` });
    }
    albums = albums.filter((a) => !added.has(a.album.id)).sort(albumOrder);
    for (const a of albums) a.hits.sort(byPlace);
    recordings.push({ albums, keys: new Set(g.map((h) => h.part.key)) });
  }
  recordings.sort((a, b) => albumOrder(a.albums[0], b.albums[0]));
  return { recordings, misses, turned };
}
const byPlace = (a, b) => ((a.track.disc_number ?? 1) - (b.track.disc_number ?? 1)) || ((a.track.track_number ?? 0) - (b.track.track_number ?? 0));

// Which recording, and which album of it. A year narrows to the recordings
// with an album dated from the year before to two years after (an LP came out
// a year or two after its sessions); one such recording is the one. With no
// year, one recording is the one and several are a question for the listener.
// `outside`: the one recording there is, with no album dated near the year.
// Recordings by more than one person of an asked family name are a choice,
// whatever the year says.
export const yearSpan = (year) => [year - 1, year + 2];
export function choose(recordings, year = null) {
  if (!recordings.length) return { none: true };
  const namesakes = namesakesIn(recordings);
  if (namesakes) return { choices: recordings, namesakes };
  if (year) {
    const [lo, hi] = yearSpan(year);
    const near = recordings.map((r) => ({ r, albums: r.albums.filter((a) => yearOf(a.album) !== null && yearOf(a.album) >= lo && yearOf(a.album) <= hi) }))
      .filter((x) => x.albums.length);
    if (near.length === 1) return { recording: near[0].r, album: near[0].albums[0] };
    if (recordings.length === 1) return { recording: recordings[0], album: recordings[0].albums[0], outside: true };
    return { choices: recordings, unsettled: true };
  }
  if (recordings.length === 1) return { recording: recordings[0], album: recordings[0].albums[0] };
  return { choices: recordings };
}

// ------------------------------------------------------- the album's run

// The work, complete and in order, from the album's own list. First the
// block: the found track and its neighbours that carry the same work in
// their title, in disc and track order, both ways until the title changes;
// forward, a track titled with its movement alone ("II. Andante con moto", on
// a label that names the work on the first movement only) goes on when it is
// the next number. Then the block is cut into performances, from its start: a
// movement that comes round again starts the next one (the Goldberg
// Variations of 1955 and 1981 back to back in one box: the second Aria starts
// the second), and so does a movement number that goes back. The run is the
// performance that holds the found track. `atStart`/`atEnd`: it touches the
// list's ends, so a longer album may hold more of it than was read.
export function takeRun(tracks, found, composerFamily = null) {
  const list = (tracks ?? []).filter((t) => t?.uri)
    .slice().sort((a, b) => ((a.disc_number ?? 1) - (b.disc_number ?? 1)) || ((a.track_number ?? 0) - (b.track_number ?? 0)));
  let at = list.findIndex((t) => t.id === found?.id || t.uri === found?.uri);
  // A track Spotify relinked has another id on the album: its place is the same.
  if (at < 0) at = list.findIndex((t) => (t.disc_number ?? 1) === (found?.disc_number ?? 1) && t.track_number === found?.track_number);
  if (at < 0) return null;
  const parts = list.map((t) => splitTitle(t.name, composerFamily));
  const work = parts[at].workKey;
  const carried = (p, q) => p.workKey === null && p.num !== null && q.num !== null && p.num === q.num + 1;
  let first = at, last = at;
  while (first > 0 && parts[first - 1].workKey === work) first--;
  while (last < list.length - 1 && (parts[last + 1].workKey === work || carried(parts[last + 1], parts[last]))) last++;
  let lo = first, hi = last;
  let heard = new Set();
  for (let i = first; i <= last; i++) {
    const p = parts[i], q = parts[i - 1];
    const again = i > lo && (heard.has(p.key) || (p.num !== null && q?.num !== null && q?.num !== undefined && p.num <= q.num));
    if (again) {
      if (i > at) { hi = i - 1; break; }
      lo = i;
      heard = new Set();
    }
    heard.add(p.key);
  }
  return { run: list.slice(lo, hi + 1), parts: parts.slice(lo, hi + 1), atStart: lo === 0, atEnd: hi === list.length - 1 };
}

// Where in a long album (a box of a hundred tracks and more) a track sits,
// from the first page of its list: exact on a disc that page reaches, else
// guessed from the discs it holds whole. The offset to read fifty from, a
// little before the track so the work's start is in the same page.
export function pageOffset(firstPage, track, total) {
  const starts = new Map();
  firstPage.forEach((t, i) => { const d = t.disc_number ?? 1; if (!starts.has(d)) starts.set(d, i); });
  const d = Number(track?.disc_number) || 1, n = Number(track?.track_number) || 1;
  let at;
  if (starts.has(d)) at = starts.get(d) + n - 1;
  else {
    const discs = [...starts.keys()].sort((a, b) => a - b);
    const last = discs.at(-1) ?? 1;
    const whole = discs.slice(0, -1).map((x, i) => starts.get(discs[i + 1]) - starts.get(x));
    const size = whole.length ? whole.reduce((a, b) => a + b, 0) / whole.length : firstPage.length - (starts.get(last) ?? 0);
    at = (starts.get(last) ?? 0) + Math.round(size * (d - last)) + n - 1;
  }
  return Math.max(firstPage.length, Math.min(Number(total) - 50, at - 20));
}

// One movement asked for on its own: "IV" or "4" by its number, "Adagietto"
// by its name. Its place in the run, or -1 when none answers to it.
export function pickMovement(parts, asked) {
  const said = String(asked ?? "").trim();
  if (!said) return null;
  const w = words(said);
  const num = /^\d{1,3}$/.test(w) ? Number(w) : /^[ivxlc]+$/.test(w) ? romanValue(w) : null;
  if (num !== null) {
    const i = parts.findIndex((p) => p.num === num);
    if (i >= 0) return i;
  }
  return parts.findIndex((p) => ` ${words(p.movement ?? p.work ?? "")} `.includes(` ${w} `));
}

// ----------------------------------------------------- the ask, and its file

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const MAX_YEAR = () => new Date().getUTCFullYear() + 1;
// The arguments, checked, and turned into what the rules read. A blank or a 0
// is "not given": some clients send every field (the test house, 2026-11-08).
export function askOf(args) {
  const composer = clip(args?.composer, 120);
  if (!composer) throw new Error("composer is required: the composer's name, as plainly as you know it");
  const work = clip(args?.work, 200);
  if (!work) throw new Error("work is required: its title with its number and catalogue number where it has them, e.g. \"Symphony No. 5 in C minor, Op. 67\"");
  const given = Array.isArray(args?.performers) ? args.performers : typeof args?.performers === "string" ? [args.performers] : [];
  const names = [...new Set(given.map((p) => clip(p, 120)).filter(Boolean))];
  if (!names.length) throw new Error("performers is required: one to four names (the conductor, the orchestra or ensemble, a soloist)");
  if (names.length > 4) throw new Error("performers takes four names at most: the ones that tell this recording apart");
  let year = null;
  if (args?.year !== undefined && args?.year !== null && args?.year !== "" && Number(args.year) !== 0) {
    year = Number(args.year);
    if (!Number.isInteger(year) || year < 1890 || year > MAX_YEAR()) {
      throw new Error(`year is the year the recording was made, 1890 to ${MAX_YEAR()}: "${clip(args.year, 12)}" is not one`);
    }
  }
  const movement = clip(args?.movement, 60) || null;
  const parsed = parseWork(work);
  const composerMatch = matcher(composer);
  return { composer, work, ...parsed, composerFamily: familyName(composer), composerMatch,
    performers: names.map(matcher), year, movement };
}

// The kept answer's key: the composer, the work, the players (in any order,
// under any of their names) and the year. A movement is not in it: the whole
// work is kept, and a movement is taken from it on the way out.
export function recordingKey(ask) {
  const work = [ask.key, ask.catalogue].filter(Boolean).map((s) => researchSlug(s)).join("-");
  const players = ask.performers.map((p) => researchSlug(p.id)).sort().join("+");
  return `recording:${researchSlug(ask.composerMatch.id)}:${work}:${players}:${ask.year ?? "any"}`.slice(0, 480);
}
// The kept answer's shape. A version, so a kept answer from older rules is
// looked up again rather than trusted.
const KEPT_VERSION = 1;

// The search: the work's key in the title, the first named performer among
// the artists, and nothing else. Never the composer as a second artist (the
// trial: a second artist filter returned nothing). A band whose name is
// translated goes in as Spotify credits it.
export function searchQuery(ask, year = null) {
  const q = (s) => String(s).replace(/"/g, "").trim();
  const span = year ? ` year:${yearSpan(year).join("-")}` : "";
  return `track:"${q(ask.key)}" artist:"${q(ask.performers[0].spotifyName)}"${span}`;
}

// ----------------------------------------------------------- the answers

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstOf = (rec) => {
  const h = rec.albums[0].hits[0];
  return { title: h.part.movement ?? h.track.name, duration: clock(h.ms) };
};
// One recording as a choice to put to the listener.
function choiceRow(rec, recordings) {
  const a = rec.albums[0];
  const alone = !recordings.some((o) => o !== rec && [...o.keys].some((k) => rec.keys.has(k)));
  const notes = [
    a.kind === "box" ? "in a box set" : null,
    alone && recordings.length > 1 ? "the search showed no movement it shares with the others, so it may be the same recording as one of them" : null,
  ].filter(Boolean);
  // The players, as the album credits them: everyone but the composer (unless
  // the composer plays), so the listener can tell one Kleiber from another.
  const h = a.hits[0];
  const composer = h.who?.[0]?.name ?? null;
  const players = creditsOf(h.track).filter((c) => c !== composer || (h.who ?? []).slice(1).some((w) => w?.name === c));
  return {
    album: a.album.name, album_id: a.album.id, released: a.album.release_date ?? null, players,
    first_movement: firstOf(rec),
    ...(rec.albums.length > 1 ? { also_on: rec.albums.length - 1 } : {}),
    ...(notes.length ? { note: notes.join("; ") } : {}),
  };
}
const nearMiss = (track, why) => ({
  title: track?.name ?? null, artists: (track?.artists ?? []).map((a) => a?.name).filter(Boolean).join(", "),
  album: track?.album?.name ?? null, why,
});
function notFound(ask, weighed, searched, calls) {
  const near = [...weighed.misses.map((m) => nearMiss(m.track, m.why)), ...weighed.turned.map((t) => nearMiss(t.track, t.why))].slice(0, 5);
  return {
    status: "not-found", searched, near,
    note: `Nothing Spotify returned is ${ask.composer}'s ${ask.work} played by ${ask.performers.map((p) => p.name).join(", ")}` +
      `${near.length ? ": the nearest are in `near`, with why each was turned away" : ""}. It may not be on Spotify.`,
    spotify_calls: calls,
  };
}
function choicesAnswer(ask, recordings, calls, { unsettled = false, namesakes = null } = {}) {
  return {
    status: "choices", composer: ask.composer, work: ask.work, performers: ask.performers.map((p) => p.name),
    choices: recordings.map((r) => choiceRow(r, recordings)),
    note: namesakes
      ? `More than one ${namesakes.family} is on these recordings (${namesakes.names.join(", ")}), and only the family ` +
        "name was given. Put the choices to the listener, or ask again with the full name."
      : (unsettled
      ? `These players have ${recordings.length} recordings of this work on Spotify, and the year ${ask.year} does not settle ` +
        `which: no single one of them is on an album dated ${yearSpan(ask.year).join(" to ")}. Put the choices to the listener.`
      : `These players have ${recordings.length} recordings of this work on Spotify, and nothing given says which is meant. ` +
        "Put the choices to the listener, or ask again with `year`, the year it was recorded."),
    spotify_calls: calls,
  };
}

// The found answer, finished with what MusicBrainz said (or did not). A year
// asked that MusicBrainz contradicts by more than one makes it a choice, not
// a find: the trial's silent error was exactly a player's other recording.
export function finish(kept, check, ask) {
  const { answer, others = [], outside = false } = kept;
  const facts = check?.state === "checked" ? check.facts : null;
  const years = facts?.years;
  if (ask.year && years && (ask.year < years[0] - 1 || ask.year > years[1] + 1)) {
    const said = facts.recorded;
    return {
      status: "choices", composer: ask.composer, work: ask.work, performers: ask.performers.map((p) => p.name),
      choices: [{ album: answer.album, album_id: answer.album_id, released: answer.released, players: answer.players,
        first_movement: { title: answer.tracks[0]?.movement ?? null, duration: answer.tracks[0]?.duration ?? null },
        note: `MusicBrainz says this one was recorded ${said}` }, ...others],
      note: `MusicBrainz says the recording found was made ${said}, not in ${ask.year}: it is likely another of their ` +
        "recordings. Put this to the listener, or ask again with another year.",
    };
  }
  const notes = [...answer.notes];
  const unsure = {
    none: "MusicBrainz has no entry for this code: the year recorded is not confirmed.",
    unanswered: "MusicBrainz did not answer just now: the year recorded is not confirmed.",
    off: "This house does not ask MusicBrainz: the year recorded is not confirmed.",
    "no-code": "Spotify gave no recording code (ISRC) for it, so MusicBrainz was not asked: the year recorded is not confirmed.",
  }[check?.state];
  if (unsure) notes.push(unsure);
  else if (facts && !facts.recorded) notes.push("MusicBrainz knows the recording but not when it was made: the year recorded is not confirmed.");
  if (outside && !(ask.year && years)) {
    notes.push(`No album of this recording on Spotify is dated ${yearSpan(ask.year).join(" to ")}, and the year recorded is not ` +
      `confirmed: it may not be the ${ask.year} recording. Say so, or put it to the listener.`);
  }
  const checked = facts ? { source: "musicbrainz", recorded: facts.recorded, place: facts.place, work: facts.work,
    ...(facts.live ? { live: true } : {}) } : null;
  return { ...answer, checked, notes };
}

// One movement out of a found answer, when one was asked for.
function onlyMovement(out, ask) {
  if (out.status !== "found" || !ask.movement) return out;
  const parts = out.tracks.map((t) => ({ ...splitTitle(t.title, ask.composerFamily), movement: t.movement }));
  const i = pickMovement(parts, ask.movement);
  if (i < 0) {
    return { ...out, notes: [...out.notes, `No movement answers to "${ask.movement}": the whole work is given, to choose from.`] };
  }
  const t = out.tracks[i];
  return { ...out, tracks: [{ ...t, n: 1 }], duration: t.duration,
    notes: [`Only the movement asked for: ${t.movement} (movement ${i + 1} of the ${out.tracks.length} in the work).`, ...out.notes] };
}

// ----------------------------------------------------------- the one that calls

// The caps, per call (the brief): two searches, two album reads; MusicBrainz's
// three are counted in musicbrainz.js. With a sign-in, five of the
// invocation's subrequests at most on Spotify's side.
const MAX_SEARCHES = 2;
const MAX_ALBUM_READS = 2;
const SPOTIFY_MOST = MAX_SEARCHES + MAX_ALBUM_READS + 1;
// Spotify's search answers ten at most (capped February 2026).
const SEARCH_LIMIT = 10;
const QUOTA_WORDS = (until) => `Spotify is limiting this account's requests (quota exceeded) for about ` +
  `${waitWords(minutesLeft(until))} more. Nothing was searched. Do not retry now.`;

export async function findRecording(env, args) {
  const ask = askOf(args);
  if (!houseCatalogNames(env).includes("spotify")) {
    throw new Error("find_recording reads Spotify, and this house's presets are all on Tidal. Use search_tracks.");
  }
  const kv = programsKV(env);
  const key = recordingKey(ask);

  // A KEPT ANSWER costs no Spotify call, and is served even while Spotify is
  // refusing this account: nothing is asked of it. MusicBrainz is asked again
  // only if it did not answer the first time (or the house has since turned
  // it on), and a year it then contradicts is a choice, and is not kept.
  let kept = null;
  try { kept = await kv.get(key, { type: "json" }); } catch { kept = null; }
  if (kept?.v === KEPT_VERSION && kept.answer?.status === "found") {
    let check = kept.check;
    if (check?.state === "unanswered" || check?.state === "off") {
      const again = await checkRecording(env, kept.answer.isrc, kept.answer.tracks.find((t) => t.n === kept.answer.isrc_track)?.duration_ms);
      if (again.state !== check.state) {
        check = again;
        const out = finish(kept, check, ask);
        try {
          if (out.status === "found") await kv.put(key, JSON.stringify({ ...kept, check }), { expirationTtl: RESEARCH_TTL_S });
          else await kv.delete(key);
        } catch { /* asked again next time, then */ }
        if (out.status !== "found") return { ...out, spotify_calls: 0 };
      }
    }
    return { ...onlyMovement(finish(kept, check, ask), ask), spotify_calls: 0, kept: true };
  }

  // THE QUOTA LOCKOUT, as search_tracks keeps it: the same words, nothing spent.
  const until = await throttledUntil(env);
  if (until) throw new Error(QUOTA_WORDS(until));
  const b = env.__budget;
  if (b && !b.critical && b.remaining < SPOTIFY_MOST) {
    throw new Error(`finding a recording needs up to ${SPOTIFY_MOST} lookups (two searches, two album reads and a ` +
      `sign-in) but only ${b.remaining} are left in this request — make this call on its own`);
  }
  const cat = catalogFor(env, "spotify");
  let searches = 0, reads = 0;
  const failed = (what, e) => {
    if (e?.budgetExhausted) return e;
    if (e?.status === 429) return new Error(`Spotify is limiting this account's requests (quota exceeded). Nothing was found or kept. Do not retry now.`);
    return new Error(`Spotify did not answer the ${what} (${clip(e?.message, 200)}). This is not a wording problem: nothing was found or kept.`);
  };
  const search = async (q) => {
    if (searches >= MAX_SEARCHES) return [];
    searches++;
    try { return await cat.search(q, SEARCH_LIMIT); } catch (e) { throw failed("search", e); }
  };

  const searched = [searchQuery(ask)];
  const first = await search(searched[0]);
  let weighed = weigh(first, ask);
  let pick = choose(weighed.recordings, ask.year);
  // A YEAR, WHEN IT IS NEEDED (the trial: Karajan's 1963 Fifth and Bylsma's
  // 1979 suites were found this way): one more search, with Spotify's year
  // filter on the album's date, when the first left several recordings, or
  // none, or one with no album near the year. Not when two people of one
  // family name are already among them: that is a choice whatever the year.
  if (ask.year && !pick.namesakes && (weighed.recordings.length !== 1 || pick.outside)) {
    searched.push(searchQuery(ask, ask.year));
    weighed = weigh([...first, ...await search(searched[1])], ask);
    pick = choose(weighed.recordings, ask.year);
  }
  const calls = () => searches + reads;
  const say = (status) => console.log(`recording: status=${status} searches=${searches} albums=${reads} found=${weighed.recordings.length}`);
  if (pick.none) { say("not-found"); return notFound(ask, weighed, searched, calls()); }
  if (pick.choices) {
    say("choices");
    return choicesAnswer(ask, pick.choices, calls(), { unsettled: pick.unsettled, namesakes: pick.namesakes });
  }

  // THE ALBUM'S OWN LIST: one read; one more page only for a long album
  // whose first fifty do not hold the whole work.
  const { recording, album: chosen } = pick;
  const hit = chosen.hits[0];
  const read = async (fn) => {
    reads++;
    try { return await fn(); } catch (e) { throw failed("album read", e); }
  };
  const full = await read(() => cat.album(chosen.album.id));
  const page1 = full?.tracks?.items ?? [];
  const total = Number(full?.tracks?.total) || page1.length;
  let list = page1, from = 0;
  let got = takeRun(list, hit.track, ask.composerFamily);
  if (!got && total > page1.length && reads < MAX_ALBUM_READS) {
    const offset = pageOffset(page1, hit.track, total);
    const more = await read(() => cat.albumTracks(chosen.album.id, offset, 50));
    if (offset === page1.length) list = [...page1, ...more.tracks]; else { list = more.tracks; from = offset; }
    got = takeRun(list, hit.track, ask.composerFamily);
  } else if (got?.atEnd && total > page1.length && reads < MAX_ALBUM_READS) {
    const more = await read(() => cat.albumTracks(chosen.album.id, page1.length, 50));
    list = [...page1, ...more.tracks];
    got = takeRun(list, hit.track, ask.composerFamily);
  }
  // Not in the list at all (a track Spotify moved, say): the search's own
  // tracks of this recording on the album, in their places, and said so.
  const partial = !got || (got.atStart && from > 0) || (got.atEnd && from + list.length < total);
  const run = got ? got.run : chosen.hits.map((h) => h.track);

  const credits = (run[0]?.artists ?? hit.track.artists ?? []).map((a) => String(a?.name ?? "")).filter(Boolean);
  const tracks = run.map((t, i) => ({
    n: i + 1, uri: t.uri, title: t.name,
    movement: splitTitle(t.name, ask.composerFamily).movement ?? t.name,
    duration: clock(t.duration_ms), duration_ms: Number(t.duration_ms) || 0,
  }));
  // The code MusicBrainz is asked by: the first track's when the search
  // returned it (the album's list carries no codes), else the first of the
  // work's tracks the search did return.
  const coded = chosen.hits.find((h) => h.track.external_ids?.isrc && tracks.some((t) => t.uri === h.track.uri));
  const isrcTrack = coded ? tracks.find((t) => t.uri === coded.track.uri) : null;
  const others = weighed.recordings.filter((r) => r !== recording);
  const notes = [];
  if (recording.albums.length > 1) notes.push(`The same recording is also on ${plural(recording.albums.length - 1, "other album")} on Spotify.`);
  if (chosen.kind === "box") notes.push("Taken from a box set: no album of its own with this recording came back from the search.");
  for (const t of weighed.turned.filter((x) => x.why !== "a compilation").slice(0, 2)) notes.push(`Turned away "${t.album.name}": ${t.why}.`);
  if (weighed.turned.some((x) => x.why === "a compilation")) notes.push("Compilations holding it were not used.");
  if (others.length) notes.push(`These players have ${plural(others.length, "other recording")} of it on Spotify; this is the one the year given points to.`);
  if (!got) notes.push("The album's own track list did not hold the track the search found: these are the search's own tracks of it, and the work may be incomplete.");
  else if (partial) notes.push(`The album is long and its track list was read in part: the work may go on past what is given here.`);
  const answer = {
    status: "found",
    work: (got?.parts[0]?.work ?? splitTitle(hit.track.name, ask.composerFamily).work) ?? ask.work,
    composer: credits.find((c) => ask.composerMatch.on(c)) ?? ask.composer,
    players: credits.filter((c) => !ask.composerMatch.on(c) || ask.performers.some((p) => p.on(c))),
    album: full?.name ?? chosen.album.name, album_id: chosen.album.id,
    released: full?.release_date ?? chosen.album.release_date ?? null,
    label: full?.label ? clip(full.label, 120) : null,
    ...(copyrightOf(full) ? { copyright: copyrightOf(full) } : {}),
    tracks, duration: clock(tracks.reduce((n, t) => n + t.duration_ms, 0)),
    isrc: coded ? String(coded.track.external_ids.isrc) : null,
    ...(isrcTrack ? { isrc_track: isrcTrack.n } : {}),
    ...(partial ? { complete: false } : {}),
    notes,
  };
  const keep = { v: KEPT_VERSION, at: new Date().toISOString(), answer,
    others: others.map((r) => choiceRow(r, weighed.recordings)), outside: !!pick.outside };

  // MUSICBRAINZ, best effort: never in the way of the answer.
  const check = await checkRecording(env, answer.isrc, isrcTrack?.duration_ms);
  keep.check = check;
  const out = finish(keep, check, ask);
  say(out.status);
  if (out.status !== "found") return { ...out, spotify_calls: calls() };
  // Kept only whole: a work read in part is looked up again next time rather
  // than handed out short for half a year.
  if (!partial) {
    try { await kv.put(key, JSON.stringify(keep), { expirationTtl: RESEARCH_TTL_S }); } catch { /* found again next time, then */ }
  }
  return { ...onlyMovement(out, ask), spotify_calls: calls() };
}

// Who issued it, from the album's ℗ line (the sound recording's copyright),
// else its © line: what Spotify still says of a label since it stopped
// sending `label` to an app like the house's (February 2026).
function copyrightOf(album) {
  const all = Array.isArray(album?.copyrights) ? album.copyrights : [];
  const line = all.find((c) => c?.type === "P") ?? all.find((c) => c?.type === "C");
  return line?.text ? clip(line.text, 160) : null;
}
