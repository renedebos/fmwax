// PLAY NOW READS AN ASK (MC-47 stage 1, tasks/mc47-build.md; the why and
// stage 0's measurements in tasks/mc47-play-now.md). "Play the Beatles on the
// Ultra" is read here: what was asked for (an artist, a song, an album, a
// genre, an era), who carries it on (the DJ), the first songs, and the one
// sentence the house would say. Nothing here plays, writes or files: stage 3
// hands the result to playEndless. When the answer disagrees with itself the
// result is "unsure", with the readings it found, and the house asks.
//
// The rule, from stage 0 (classify.py there, scored 22 of 22 on the asks it
// was shaped on and 9 of 14 on a fresh set) with its three fixes:
// 1. An ask made only of genre, era and mood words is read before any
//    search, from the word table below. A word a DJ owns ("acoustic",
//    "Stax", "pub rock") names that DJ whatever else is said.
// 2. Otherwise ONE search for artists, albums and tracks together. Spotify
//    gives no popularity in Development Mode, and there are artists called
//    "Hey Jude" and "Abbey Road", so a name that matches tells nothing by
//    itself: what tells is the answer agreeing with itself. The first
//    artist is the ask when most of the ten tracks are theirs; when their
//    name matches but the tracks are other people's ("yes", "america"), when
//    their albums agree, with one more search for their own tracks.
// 3. A title: the song or the album of that name. An album by the first
//    artist beats a song by somebody else ("blood on the tracks"), and the
//    other way round ("here comes the sun"); a song whose album is among the
//    top albums is the song ("so what"). A title that is both a song and an
//    album by the same artist (a title track: "pet sounds", "purple rain"),
//    or a song and an album by two others ("blue"), is unsure.
// 4. The first artist's name found inside a longer ask ("prince parade"):
//    that artist, with the whole ask kept for the DJ; the other words a
//    song or an album of theirs when they are its exact title.
// 5. Nothing agrees: "none", and today's ask.
//
// "The album …", "the song …", "the band …" said first settle the kind;
// "X by Y" names the artist. Pure but for the catalog it is handed.

import { cut, lastSpeaker, squash, takeLength } from "./alexa-read.js";
import { onWords } from "./asks.js";
import { ROSTER } from "./djs.js";

// The songs a bridge starts with (the build: five, written to the DJ's
// playlist). Fewer than ENOUGH of an artist's own and their tracks are asked
// for once more.
export const BRIDGE_SONGS = 5;
const ENOUGH = 3;

// A title or a name as compared: no accents, "&" as "and", no edition in
// brackets, nothing after " - ", no punctuation, no leading "the".
// The short forms said for long ones, read the same either way: "main st"
// is "Main Street" (the gate's "exile on main st").
const SHORT = { st: "street", pt: "part", vol: "volume", mt: "mount", n: "and", vs: "versus" };
export function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ")
    .replace(/\s*[([](?:feat|ft|with|remaster|live|mono|stereo|deluxe|super|expanded|legacy|anniversary|bonus|\d{4})[^)\]]*[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().replace(/^the /, "")
    .split(" ").map((w) => SHORT[w] ?? w).join(" ");
}
const wordsOf = (s) => fold(s).split(" ").filter(Boolean);
// `inner` as whole words somewhere in `outer` (both folded): its span, or null.
function wordsAt(outer, inner) {
  const o = outer.split(" "), i = inner.split(" ");
  if (!inner || i.length > o.length) return null;
  for (let at = 0; at + i.length <= o.length; at++) {
    if (i.every((w, k) => o[at + k] === w)) return { at, end: at + i.length, rest: [...o.slice(0, at), ...o.slice(at + i.length)].join(" ") };
  }
  return null;
}

// --------------------------------------------------------------- the words

// Words a DJ owns: an ask holding one goes to that DJ, whatever else it says
// (the stage 0 table, `mcp/djs.js` WHICH). Longest first when read.
const MARKERS = {
  "sessions": ["unplugged", "acoustic", "live session", "live sessions", "tiny desk", "peel session", "peel sessions",
    "radio session", "radio sessions", "bbc session", "bbc sessions", "in session", "live in the studio"],
  "soul": ["stax", "motown", "tamla", "tamla motown", "hi records", "fame studios", "muscle shoals", "chess records",
    "philly soul", "philadelphia soul", "southern soul", "northern soul", "memphis soul", "deep soul", "atlantic soul"],
  // The labels of the revival are Hank's by name (the owner, 2026-11-19:
  // "the Ubiquity label" with no DJ named went to Soul, whose years end in
  // 1979; Ubiquity began in 1990).
  "hank": ["daptone", "colemine", "big crown", "ubiquity", "ubiquity records", "now again", "truth and soul", "truth soul", "timmion",
    "penrose", "record kicks", "dunham", "soul revival", "revival soul", "new soul", "modern soul", "retro soul",
    "modern funk", "new funk"],
  "americana": ["americana", "alt country", "alternative country", "no depression", "cosmic country"],
  "pub-rock": ["pub rock"],
  "dr-funkenstein": ["deep funk", "rare groove", "rare funk", "p funk", "pfunk"],
};
// Genres and scenes. Each is a fence for Genre unless a DJ owns it above,
// or it is funk or soul in their years (genreOwner).
const GENRES = `rock|pop|jazz|blues|soul|funk|disco|punk|folk|country|reggae|dub|ska|rocksteady|metal|heavy metal|hard rock|
soft rock|yacht rock|classic rock|prog|prog rock|progressive rock|psych|psychedelic|psychedelia|psychedelic rock|garage|
garage rock|surf|surf rock|rockabilly|doo wop|gospel|r and b|rnb|rhythm and blues|hip hop|hiphop|rap|trap|grime|drill|
house music|deep house|acid house|chicago house|techno|detroit techno|trance|electronic|electronica|edm|ambient|
drum and bass|drum n bass|jungle|breakbeat|trip hop|downtempo|lo fi|lofi|synth pop|synthpop|synthwave|new wave|post punk|
no wave|krautrock|shoegaze|grunge|britpop|indie|indie rock|indie pop|alternative|alt rock|alternative rock|emo|hardcore|
swing|big band|bebop|bop|hard bop|cool jazz|free jazz|spiritual jazz|fusion|jazz fusion|latin|latin jazz|salsa|
bossa nova|samba|tropicalia|afrobeat|afro beat|highlife|cumbia|flamenco|fado|chanson|k pop|j pop|city pop|bluegrass|
honky tonk|outlaw country|western swing|cajun|zydeco|delta blues|chicago blues|electric blues|country blues|
piedmont blues|soul jazz|neo soul|quiet storm|new jack swing|boogie|g funk|go go|gogo|new orleans|dancehall|
roots reggae|lovers rock|calypso|soca|exotica|lounge|easy listening|singer songwriter|singer songwriters|roots|
roots rock|heartland rock|power pop|glam|glam rock|art rock|baroque pop|sunshine pop|bubblegum|folk rock|country rock|
southern rock|jam band|stoner rock|doom|black metal|death metal|thrash|nu metal|industrial|goth|gothic rock|darkwave|
cold wave|minimal wave|italo disco|hi nrg|eurodance|chillwave|vaporwave|dream pop|noise rock|math rock|post rock|
slowcore|dance|dance music|vocal jazz|crooners|standards|rocknroll|rock n roll|rock and roll|instrumental|
world music|celtic|bollywood|reggaeton|motown sound|blue eyed soul|dub reggae|two tone|2 tone|mod|
modern jazz|west coast jazz|smooth jazz|jazz funk|acid jazz|nu jazz|broken beat|uk garage|dubstep|footwork|
psychedelic soul|psych rock|space rock|kosmische|minimal|minimalism|electro|electropop|freestyle|miami bass|
crunk|boom bap|conscious hip hop|gangsta rap|west coast hip hop|east coast hip hop|underground hip hop`
  .split("|").map((s) => s.trim()).filter(Boolean);
// Not on the quick path (the plan): every recording of a classical work is
// someone else's, and the house has no charts.
const CLASSICAL = `classical|classical music|opera|operas|aria|arias|symphony|symphonies|concerto|concertos|sonata|sonatas|
chamber music|string quartet|string quartets|orchestral|baroque|choral|requiem|bach|mozart|beethoven|brahms|chopin|
debussy|handel|haydn|mahler|schubert|schumann|tchaikovsky|vivaldi|verdi|wagner|puccini|stravinsky|rachmaninoff|
rachmaninov|ravel|satie|liszt|dvorak|elgar|sibelius|shostakovich|prokofiev|mendelssohn|bruckner|monteverdi|purcell|
telemann|grieg|holst|vaughan williams|arvo part`.split("|").map((s) => s.trim()).filter(Boolean);
const CHARTS = ["new music", "new releases", "the charts", "charts", "top 40", "top forty", "top 100", "latest hits",
  "the latest", "whats new", "what's new", "number ones", "number one hits", "this week", "this year"];
// Moods and occasions: with an era they are Vibe's; alone there is nothing
// to search, and today's ask stands (the plan, "a direct ask").
const MOODS = `mellow|chill|chilled|chill out|relaxing|relaxed|calm|quiet|soft|gentle|upbeat|happy|sad|melancholy|
moody|dark|party|dinner|dinner party|cooking|sunday|saturday|friday|sunday morning|morning|mornings|evening|night|
late night|late night|midnight|small hours|rainy|rainy day|rain|summer|summery|winter|autumn|fall|spring|workout|
running|study|studying|focus|sleep|sleepy|romantic|love songs|dancing|background|cozy|cosy|lazy|slow|fun|feel good|
feelgood|groovy|energetic|loud|driving|road trip|beach|sunshine|sunny|christmas|holiday|bbq|barbecue|wedding|
breakfast|coffee|wine|cocktail|cocktails`.split("|").map((s) => s.trim()).filter(Boolean);
// Words that only join; "hits" and its kin say "the famous ones" (Vibe's).
const HITS = ["hits", "greatest hits", "big hits", "classics", "oldies", "the best", "best", "popular", "famous",
  "favourites", "favorites", "anthems", "bangers", "smash hits", "top hits"];
const FILLER = `music|songs|tunes|tracks|records|stuff|some|something|anything|a|an|the|of|from|and|or|with|for|in|to|era|
style|type|kind|sort|bit|little|lots|more|good|great|nice|me|us|my|our|any|all|kinds|mix|sound|sounds|scene|years|
period|decade|vibe|vibes|era's|tune|jams|grooves|cuts|deep cuts|songs from|by|on|at|ish|style of|time`
  .split("|").map((s) => s.trim()).filter(Boolean);

const TABLE = new Map();
const put = (list, what) => { for (const p of list) if (!TABLE.has(p)) TABLE.set(p, what); };
for (const [dj, list] of Object.entries(MARKERS)) put(list, { cat: "marker", dj });
put(CLASSICAL, { cat: "classical" });
put(CHARTS, { cat: "charts" });
put(GENRES, { cat: "genre" });
put(MOODS, { cat: "mood" });
put(HITS, { cat: "hits" });
put(FILLER, { cat: "filler" });
const LONGEST = Math.max(...[...TABLE.keys()].map((p) => p.split(" ").length));

// THE YEARS SAID. "70s", "1970s", "'70s", "the seventies", "early 80s", "1983",
// "1965 to 1975", "60s and 70s": every span said, joined into one fence.
const DECADE_WORDS = { twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970,
  eighties: 1980, nineties: 1990, noughties: 2000, aughts: 2000 };
function decadeOf(tok) {
  if (DECADE_WORDS[tok]) return DECADE_WORDS[tok];
  const m = tok.match(/^'?(?:(19|20)?(\d)0)'?s$/);
  if (!m) return null;
  const d = Number(m[2]);
  const century = m[1] ? Number(m[1]) * 100 : d <= 1 ? 2000 : 1900;
  return century + d * 10;
}
const SHADES = { early: [0, 3], mid: [3, 6], late: [6, 9] };
function eraAt(toks, i) {
  const shade = SHADES[toks[i]];
  const j = shade ? i + 1 : i;
  const dec = j < toks.length ? decadeOf(toks[j]) : null;
  if (dec != null) return { n: j - i + 1, from: dec + (shade?.[0] ?? 0), to: dec + (shade?.[1] ?? 9) };
  if (!shade && /^(?:19[2-9]\d|20[0-2]\d)$/.test(toks[i] ?? "")) return { n: 1, from: Number(toks[i]), to: Number(toks[i]) };
  return null;
}

// The ask's words against the table: what each word is, and whether every
// word was known. { covered, markers, genres, moods, hits, classical, charts,
// years }.
export function wordTable(words) {
  const toks = String(words ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/).filter(Boolean).map((t) => (/^'?\d0'?s$/.test(t) ? t : t.replace(/'/g, "")));
  const out = { covered: true, markers: [], genres: [], moods: [], hits: false, classical: false, charts: false,
    years: null, unknown: [], joins: 0, bareYear: toks.length === 1 && /^\d{4}$/.test(toks[0]) };
  const spans = [];
  for (let i = 0; i < toks.length;) {
    const era = eraAt(toks, i);
    if (era) { spans.push(era); i += era.n; continue; }
    let hit = null;
    for (let n = Math.min(LONGEST, toks.length - i); n >= 1 && !hit; n--) {
      const p = toks.slice(i, i + n).join(" ");
      if (TABLE.has(p)) hit = { p, n, ...TABLE.get(p) };
    }
    if (!hit) { out.covered = false; out.unknown.push(toks[i]); i += 1; continue; }
    if (hit.cat === "marker") out.markers.push({ dj: hit.dj, word: hit.p });
    else if (hit.cat === "genre") out.genres.push(hit.p);
    else if (hit.cat === "mood") out.moods.push(hit.p);
    else if (hit.cat === "hits") out.hits = true;
    else if (hit.cat === "classical") out.classical = true;
    else if (hit.cat === "charts") out.charts = true;
    else if (hit.cat === "filler") out.joins += 1;
    i += hit.n;
  }
  if (spans.length) out.years = { from: Math.min(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) };
  return out;
}

// Funk and soul in their years are the house DJs' (Funkenstein: deep 60s and
// 70s funk and soul; Soul: 1959-79); after 1979 they are Genre's.
function genreOwner(genres, years) {
  const before80 = !years || years.from <= 1979;
  const has = (re) => genres.some((g) => re.test(g));
  if (has(/^funk$|^jazz funk$/) && before80) return "dr-funkenstein";
  if (has(/^soul$|^r and b$|^rnb$|^rhythm and blues$|^psychedelic soul$|^blue eyed soul$|^motown sound$/) && before80) return "soul";
  return "genre";
}

// The bridge's search for a genre: the plain words with their years
// (stage 0: `genre:` gives library music, plain words with `year:` are
// good). A genre said without years is searched in its classic years, so
// "jazz" is not A Tribe Called Quest's "Jazz (We've Got)" (stage 0's
// answer): a guess for the bridge's few songs only, never told to the DJ.
const CLASSIC_YEARS = { "jazz": [1955, 1969], "soul": [1962, 1975], "funk": [1968, 1979], "disco": [1975, 1981],
  "reggae": [1968, 1985], "punk": [1976, 1982], "new wave": [1978, 1986], "post punk": [1978, 1984],
  "hip hop": [1986, 1999], "rap": [1986, 1999], "grunge": [1989, 1996], "britpop": [1993, 1998],
  "shoegaze": [1988, 1996], "blues": [1950, 1975], "country": [1955, 1985], "folk": [1960, 1975],
  "psychedelic": [1965, 1972], "psychedelic rock": [1965, 1972], "krautrock": [1969, 1978], "bossa nova": [1958, 1968],
  "afrobeat": [1968, 1985], "trip hop": [1991, 1999], "yacht rock": [1976, 1984], "soft rock": [1970, 1985],
  "classic rock": [1965, 1985], "synth pop": [1979, 1986], "synthpop": [1979, 1986], "new jack swing": [1987, 1994],
  "g funk": [1992, 1997], "neo soul": [1995, 2005], "rock and roll": [1955, 1965], "rock n roll": [1955, 1965],
  "glam rock": [1971, 1976], "power pop": [1972, 1985], "southern rock": [1970, 1980], "pub rock": [1972, 1978] };
function bridgeQuery(t) {
  const words = [...t.markers.map((m) => m.word), ...t.genres].filter((w) => !["acoustic", "unplugged"].includes(w));
  const y = t.years ?? (words.length === 1 && CLASSIC_YEARS[words[0]]
    ? { from: CLASSIC_YEARS[words[0]][0], to: CLASSIC_YEARS[words[0]][1] } : null);
  const fence = y ? `year:${y.from}-${y.to}` : "";
  return [words.join(" "), fence].filter(Boolean).join(" ") || null;
}

// --------------------------------------------------------------- reading

const LEAD = /^(?:(?:please|alexa|hey|can you|could you|would you|will you)\s+)*(?:play|put on|start|spin|throw on|queue up|give me|i want to hear|i'd like to hear|i would like to hear|let's hear|let me hear|let's have)\s+/;
const SOME = /^(?:me\s+)?(?:some|a bit of|a little bit of|a little|a few|a couple of|any)\s+/;
const BY_LEAD = /^(?:something|anything|stuff|music|songs|tunes|tracks) by\s+/;
// Only after "the": "Song 2", "Single Ladies" and "Band of Horses" are names.
const FORCED = /^(?:the|that)\s+(album|record|lp|song|track|tune|single|band|group|artist|singer)\s+(?:called\s+|named\s+)?(.+)$/;
const FORCED_KIND = { album: "album", record: "album", lp: "album", song: "song", track: "song", tune: "song",
  single: "song", band: "artist", group: "artist", artist: "artist", singer: "artist" };
const LIKE = /(?:^| )(?:something|stuff|music|songs?|more) like |(?:^| )sounds? like |(?:^| )similar to /;
const NOW = /(?:^| )(?:right )?now$/;

// The words of a play-now ask: the speaker, a length and "now" taken out,
// the leading "play some" too, and what was said first about the kind.
// { said, words, forced, by, like, table, device, deviceFrom, minutes,
// lengthSaid }. `words` is the ask as the DJ is told it.
export function readPlayNow(words, { rooms = [], fallback = null } = {}) {
  const said = squash(words);
  let text = said.replace(LEAD, "");
  let device = null;
  const where = lastSpeaker(text, rooms);
  // "everywhere by fleetwood mac" is a song, not a speaker.
  if (where && !/^by /.test(cut(text, where.at, where.end))) { device = where.room; text = cut(text, where.at, where.end); }
  const len = takeLength(text);
  text = len.text.replace(NOW, "").replace(/(?:^| )please$/, "").trim();
  if (!device) {
    const late = lastSpeaker(text, rooms, { bareOnly: true });
    if (late) { device = late.room; text = cut(text, late.at, late.end); }
  }
  text = text.replace(SOME, "").replace(/^(?:of|for|about) /, "").replace(SOME, "").replace(/[.,]+$/, "").trim();
  let forced = null;
  if (BY_LEAD.test(text)) { forced = "artist"; text = text.replace(BY_LEAD, ""); }
  const f = !forced && text.match(FORCED);
  if (f) forced = FORCED_KIND[f[1]];
  const body = f ? f[2] : text;
  const b = body.match(/^(.+?) by (.+)$/);
  const by = b && forced !== "artist" ? { title: b[1].trim(), artist: b[2].trim() } : null;
  return { said, words: text, forced, body, by, like: LIKE.test(` ${text}`), table: wordTable(text),
    device: device ?? fallback, deviceFrom: device ? "words" : "default", minutes: len.minutes, lengthSaid: len.lengthSaid };
}

// A DJ's name as the whole ask ("play Hank"): that DJ put on, today's way.
function djNamed(words) {
  const w = fold(words);
  if (!w) return null;
  for (const [key, p] of Object.entries(ROSTER)) {
    if ([key, p.name, ...(p.aliases ?? [])].some((n) => fold(n) === w)) return key;
  }
  return null;
}

// What the words alone settle, before any search: a DJ's name, a word a DJ
// owns, genre and era words, a mood, the classical and chart asks the quick
// path does not take. Null when only a search can say.
export function beforeSearch(r) {
  const t = r.table;
  if (!r.words) return { kind: "none", why: "nothing" };
  const named = djNamed(r.words);
  if (named) return { kind: "dj", dj: named };
  if (r.like) return { kind: "like", why: "like" };
  if (r.forced || r.by) return null;
  if (t.markers.length) return { kind: "genre", dj: t.markers[0].dj };
  if (t.classical) return { kind: "classical", why: "classical" };
  if (!t.covered) return null;
  if (t.charts) return { kind: "charts", why: "charts" };
  if (t.genres.length) return { kind: "genre", dj: genreOwner(t.genres, t.years) };
  // A year alone, or moods alone with no joining word, may be a title:
  // "1999", "Happy", "Sunday Morning". Searched first; this reading only if
  // the search finds nothing.
  const bare = !t.joins && !t.hits && (t.moods.length ? !t.years : t.bareYear);
  if (t.years) return { kind: "era", dj: "vibe", ...(bare ? { titleFirst: true } : {}) };
  if (t.moods.length) return { kind: "mood", why: "mood", ...(bare ? { titleFirst: true } : {}) };
  return { kind: "none", why: "nothing" };
}

// --------------------------------------------------------------- the answer

// Takes that are not the record: last in a bridge, after every released one
// (the gate's "early bowie" matched three "Early Version" demos by title).
const LIVE = /\b(?:live|demo|remix|instrumental|karaoke|commentary|interview|rehearsal|take \d|alternate|outtake|early (?:version|mix)|session take|work in progress|rough mix)\b/i;
const various = (l) => /^various artists$/i.test(l?.artists?.[0]?.name ?? "");
const by = (t, id) => !!t?.artists?.some((a) => a.id === id);
const lead = (t) => t?.artists?.[0] ?? null;
const song = (t) => ({ uri: t.uri ?? `spotify:track:${t.id}`, name: t.name, artist: lead(t)?.name ?? null });
const albumOf = (l) => ({ id: l.id, uri: l.uri ?? `spotify:album:${l.id}`, name: l.name, artist: lead(l)?.name ?? null,
  year: String(l.release_date ?? "").slice(0, 4) || null });
// Of an album's editions, the plainest: not the super deluxe one.
const plain = (ls) => ls.find((l) => !/deluxe|super|expanded|anniversary|legacy|edition|remix/i.test(l.name)) ?? ls[0] ?? null;

// An artist's own songs out of a list of tracks: theirs as the lead first,
// then where they play, no title twice, a live take or a remix only when
// nothing else is there. `first` leads.
export function ownSongs(tracks, artistId, { first = null, max = BRIDGE_SONGS } = {}) {
  const theirs = (tracks ?? []).filter((t) => t && by(t, artistId));
  const ordered = [...theirs.filter((t) => lead(t)?.id === artistId), ...theirs.filter((t) => lead(t)?.id !== artistId)];
  const pool = [...ordered.filter((t) => !LIVE.test(t.name)), ...ordered.filter((t) => LIVE.test(t.name))];
  const out = first ? [first] : [];
  const seen = new Set(out.map((t) => fold(t.name)));
  for (const t of pool) {
    if (out.length >= max) break;
    const k = fold(t.name);
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}
// A genre's or an era's songs: no title twice and no artist twice.
export function spreadSongs(tracks, max = BRIDGE_SONGS) {
  const out = [], titles = new Set(), acts = new Set();
  for (const t of tracks ?? []) {
    if (!t || out.length >= max) continue;
    const k = fold(t.name), a = lead(t)?.id ?? lead(t)?.name;
    if (titles.has(k) || acts.has(a)) continue;
    titles.add(k); acts.add(a); out.push(t);
  }
  return out;
}

// The song of that title in the answer, when one is among the first three
// tracks or is the first artist's. Whose recording: the artist with the
// most versions of it in the answer, the first track and the first artist
// a vote each ("the weight": Aretha Franklin's came first, The Band has four;
// the gate's "strange fruit": Nina Simone the first artist, Billie Holiday
// five versions and the first track). A live take only if nothing else.
function songTitled(T, title, a0, { anywhere = false, artist = null } = {}) {
  const all = T.filter((t) => fold(t.name) === title)
    .filter((t) => !artist || t.artists.some((x) => sameName(x.name, artist)));
  if (!all.some((t) => anywhere || artist || T.indexOf(t) < 3 || (a0 && by(t, a0.id)))) return null;
  const votes = new Map();
  for (const t of all) {
    const id = lead(t)?.id;
    votes.set(id, (votes.get(id) ?? 0) + 1 + (t === T[0] ? 1 : 0));
  }
  if (a0 && votes.has(a0.id)) votes.set(a0.id, votes.get(a0.id) + 1);
  let best = null;
  for (const [id, n] of votes) if (best === null || n > votes.get(best)) best = id;
  const theirs = all.filter((t) => lead(t)?.id === best);
  return theirs.find((t) => !LIVE.test(t.name)) ?? theirs[0] ?? null;
}
// The album of that title among the top albums: a real album (no single, no
// various artists, and no compilation unless "the album …" or "… by …" was
// said: the gate's "bohemian rhapsody" found Queen's compilation of that
// name), the first artist's when they have one.
function albumTitled(L, title, a0, { top = 4, artist = null, any = false } = {}) {
  const hits = L.slice(0, top).filter((l) => fold(l.name) === title && !various(l) &&
    (l.album_type === "album" || (any && l.album_type === "compilation")))
    .filter((l) => !artist || l.artists.some((x) => sameName(x.name, artist)));
  const mine = a0 ? hits.filter((l) => by(l, a0.id)) : [];
  return plain(mine.length ? mine : hits.filter((l) => lead(l)?.id === lead(hits[0])?.id));
}
// A name said against a name in the catalog: the same, or every word said
// is in it ("coltrane" is John Coltrane, "sharon jones" Sharon Jones & The
// Dap-Kings).
function sameName(catalogName, said) {
  const c = fold(catalogName), s = fold(said);
  if (!s) return false;
  if (c === s) return true;
  const cw = new Set(c.split(" "));
  return s.split(" ").every((w) => cw.has(w));
}

const title = (t) => ({ kind: "song", title: t.name, by: lead(t)?.name ?? null });
const albumReading = (l) => ({ kind: "album", title: l.name, by: lead(l)?.name ?? null });

// The song's own album, in any edition ("Kind Of Blue (Legacy Edition)" is
// Kind Of Blue): the same id, or the same title by the song's artist.
const sameAlbum = (l, t) => l.id === t.album?.id ||
  (!!t.album?.name && fold(l.name) === fold(t.album.name) && lead(l)?.id === lead(t)?.id);

// A song and an album of the same title: which, or unsure.
function songOrAlbum(s, al, a0, L) {
  if (s && al) {
    const sameAct = lead(s)?.id && lead(s)?.id === lead(al)?.id;
    if (sameAct) return { kind: "unsure", readings: [albumReading(al), title(s)] };
    if (a0 && by(s, a0.id) && !by(al, a0.id)) return { kind: "song", track: s };
    if (a0 && by(al, a0.id) && !by(s, a0.id)) return { kind: "album", album: al };
    if (L.slice(0, 3).some((l) => sameAlbum(l, s))) return { kind: "song", track: s };
    return { kind: "unsure", readings: [albumReading(al), title(s)] };
  }
  if (s) return { kind: "song", track: s };
  if (al) return { kind: "album", album: al };
  return null;
}

// What one combined search says the ask is: { kind, artist?, track?, album?,
// readings?, words? }. `r` is readPlayNow's reading.
export function classify(r, answer) {
  const A = (answer?.artists ?? []).filter(Boolean);
  const L = (answer?.albums ?? []).filter(Boolean);
  const T = (answer?.tracks ?? []).filter(Boolean);
  const fq = fold(r.body ?? r.words);
  const a0 = A[0] ?? null;
  const tracksBy = (a) => T.filter((t) => by(t, a.id)).length;
  const albumsBy = (a, n = 4) => L.slice(0, n).filter((l) => by(l, a.id)).length;

  // "X by Y": the song or album X of the artist Y.
  if (r.by) {
    const t = fold(r.by.title);
    const s = r.forced === "album" ? null : songTitled(T, t, null, { artist: r.by.artist });
    const al = r.forced === "song" ? null : albumTitled(L, t, null, { top: 10, artist: r.by.artist, any: true });
    const hit = songOrAlbum(s, al, null, L);
    if (hit) return hit;
  }
  if (r.forced === "album") {
    const al = albumTitled(L, fq, a0, { top: 10, any: true });
    if (al) return { kind: "album", album: al };
  }
  if (r.forced === "song") {
    const s = songTitled(T, fq, a0, { anywhere: true });
    if (s) return { kind: "song", track: s };
  }
  if (r.forced === "artist") {
    const hit = A.slice(0, 3).find((a) => sameName(a.name, fq) && (tracksBy(a) || albumsBy(a)));
    if (hit) return { kind: "artist", artist: hit };
  }
  if (r.forced || r.by) return classify({ ...r, forced: null, by: null, body: r.words }, answer);

  const s = songTitled(T, fq, a0);
  const al = albumTitled(L, fq, a0);
  if (a0 && sameName(a0.name, fq)) {
    // Most of the tracks theirs: the artist, whatever titles match.
    if (tracksBy(a0) >= 5) return { kind: "artist", artist: a0 };
    // Their name, and their albums or some tracks agree: the artist, unless
    // a song or an album of that title by somebody else says otherwise.
    if (tracksBy(a0) >= ENOUGH || albumsBy(a0) >= 2) {
      const other = (s && !by(s, a0.id)) ? title(s) : (al && !by(al, a0.id)) ? albumReading(al) : null;
      if (other) return { kind: "unsure", readings: [{ kind: "artist", title: a0.name, by: null }, other] };
      return { kind: "artist", artist: a0 };
    }
  }
  const named = songOrAlbum(s, al, a0, L);
  if (named) return named;
  // An artist's name inside a longer ask: theirs, with the words. Any of the
  // first three artists, whole, when the answer agrees ("neil young harvest":
  // Neil Young International Harvesters came first, Neil Young second); or
  // only the last word of the first artist's name when most of the tracks
  // are theirs ("early bowie").
  let inside = null;
  for (const a of A.slice(0, 3)) {
    const at = fold(a.name).length >= 3 ? wordsAt(fq, fold(a.name)) : null;
    if (at?.rest && (tracksBy(a) >= ENOUGH || albumsBy(a) >= 1)) { inside = { a, rest: at.rest }; break; }
  }
  const surname = a0 ? wordsOf(a0.name).at(-1) : null;
  if (!inside && surname?.length >= 4 && wordsOf(a0.name).length > 1 && tracksBy(a0) >= 5) {
    const at = wordsAt(fq, surname);
    if (at?.rest) inside = { a: a0, rest: at.rest };
  }
  if (inside) {
    const { a } = inside;
    const rest = inside.rest.replace(/^(?:of|by|from) /, "");
    const second = A.filter((x) => x !== a).slice(0, 4)
      .find((x) => /^(?:and|with|or|plus|vs) /.test(rest) && sameName(x.name, rest.replace(/^\w+ /, "")));
    if (second) return { kind: "several", why: "several", artists: [a.name, second.name] };
    const s2 = songTitled(T, rest, a, { anywhere: true });
    const al2 = albumTitled(L, rest, a, { top: 10 });
    const mine = songOrAlbum(s2 && by(s2, a.id) ? s2 : null, al2 && by(al2, a.id) ? al2 : null, a, L);
    if (mine) return mine;
    return { kind: "artist", artist: a, withWords: true };
  }
  return { kind: "none", why: "no-match" };
}

// --------------------------------------------------------------- the whole ask

// Who carries each kind on (the owner, 2026-11-18: by the kind of ask).
const CARRIER = { artist: "deep-dive", song: "deep-dive", era: "vibe" };

// The house's switch (house.json `playNow`, rendered PLAY_NOW): "off" (the
// default, and every forum house's), "dry" (stage 2: a door reads and
// searches the ask and says what it would play, starting nothing), "on"
// (stage 3: it plays, through playnow-start.js).
export const PLAY_NOW_MODES = ["off", "dry", "on"];
export const playNowMode = (env) => (PLAY_NOW_MODES.includes(env?.PLAY_NOW) ? env.PLAY_NOW : "off");

// Where a DJ plays from in this house: their own endless preset, else the
// guest DJ's (the lane), from the config alone, as Alexa's put-on reads it
// (alexa.js putOnSays). { lane, own: { dj: button } } or null.
export function playNowPlaces(cfg) {
  if (!cfg || cfg.mode !== "live") return null;
  const lane = cfg.presets.find((p) => p.lane)?.button ?? null;
  const own = Object.fromEntries(cfg.presets.filter((p) => p.dj && !p.lane).map((p) => [p.dj, p.button]));
  return { lane, own };
}
function placeOf(places, dj) {
  if (!dj || !places) return null;
  if (places.own?.[dj]) return { button: places.own[dj], own: true };
  if (places.lane) return { button: places.lane, own: false };
  return null;
}

// READ A PLAY-NOW ASK, searching as needed. `catalog` is the Spotify
// catalog (spotify.js: searchAll, search); `places` from playNowPlaces.
// → { kind, dj, place, words, title, by, songs, album, readings, why, say,
//     device, deviceFrom, minutes, lengthSaid, searches }
// A DJ on their own preset gets no bridge and no search: the preset starts
// and the words steer it (the build, "what the first build leaves out").
export async function playNow(words, { catalog, rooms = [], fallback = null, places = null } = {}) {
  const r = readPlayNow(words, { rooms, fallback });
  let searches = 0;
  const ask = async (fn) => { searches += 1; return fn(); };
  let c = beforeSearch(r);
  let songs = [];
  let answer = null;
  if (c?.titleFirst) {
    answer = await ask(() => catalog.searchAll(r.words, 10));
    const named = classify(r, answer);
    if (named.kind !== "none") c = named;
  }
  if (c && (c.kind === "genre" || c.kind === "era")) {
    const place = placeOf(places, c.dj);
    const q = c.kind === "era" ? (r.table.years ? `year:${r.table.years.from}-${r.table.years.to}` : null) : bridgeQuery(r.table);
    if (place && !place.own && q) songs = spreadSongs(await ask(() => catalog.search(q, 10)));
  } else if (!c || answer) {
    if (!answer) answer = await ask(() => catalog.searchAll(r.forced ? r.body : r.words, 10));
    if (!c) c = classify(r, answer);
    const T = (answer?.tracks ?? []).filter(Boolean);
    if (c.kind === "artist") songs = ownSongs(T, c.artist.id);
    if (c.kind === "song") songs = ownSongs(T, lead(c.track)?.id, { first: c.track });
    const who = c.kind === "artist" ? c.artist : c.kind === "song" ? lead(c.track) : null;
    if (who && songs.length < ENOUGH) {
      const more = await ask(() => catalog.search(`artist:"${who.name}"`, 10));
      songs = ownSongs([...songs, ...more], who.id, { first: c.kind === "song" ? c.track : null });
    }
  }
  const dj = c.dj ?? CARRIER[c.kind] ?? null;
  const place = placeOf(places, dj);
  const out = {
    kind: c.kind, dj, place, words: r.words,
    title: c.kind === "artist" ? c.artist.name : c.kind === "song" ? c.track.name : c.kind === "album" ? c.album.name : r.words,
    by: c.kind === "song" ? lead(c.track)?.name ?? null : c.kind === "album" ? lead(c.album)?.name ?? null : null,
    songs: (place?.own ? [] : songs).map(song),
    album: c.kind === "album" ? albumOf(c.album) : null,
    readings: c.readings ?? null, why: c.why ?? null, withWords: !!c.withWords,
    device: r.device, deviceFrom: r.deviceFrom, minutes: r.minutes, lengthSaid: r.lengthSaid, searches,
  };
  out.say = sayFor(out);
  return out;
}

// --------------------------------------------------------------- the sentence

const djName = (key) => ROSTER[key]?.name ?? key;
const owns = (name) => (/s$/.test(name) ? `${name}'` : `${name}'s`);
// A title as said aloud: no edition, no featured players, nothing after " - ".
export const spoken = (name) => String(name ?? "")
  .replace(/\s*[([](?:feat|ft|with|remaster|live|mono|stereo|deluxe|super|expanded|legacy|anniversary|bonus|\d{4})[^)\]]*[)\]]/gi, "")
  .replace(/\s+-\s+.*$/, "").trim();
const at = (device) => (device ? ` ${onWords(device)}` : "");
const quoteFirst = (songs) => (songs[0] ? `, ${spoken(songs[0].name)} first` : "");
function readingWords(x) {
  if (x.kind === "album") return `the album${x.by ? ` by ${x.by}` : ""}`;
  if (x.kind === "song") return `the song${x.by ? ` by ${x.by}` : ""}`;
  return "the artist";
}
const WHY = {
  nothing: "I didn't hear what to play.",
  mood: "That's a mood, not something I can look up; ask a DJ for it, Vibe for one.",
  like: "\"Something like\" can't start at once yet; ask Genre or Deep Dive for it.",
  classical: "Classical can't start at once yet; ask a DJ for a set.",
  charts: "The house can't see the charts, so the newest music can't start at once.",
  several: "Several artists at once can't start at once yet; ask Vibe for a set.",
  "no-match": null,
};

// The first songs as listed in a dry run (MC-47 stage 2): three, the last
// after "then"; with their artists when they are not all one's.
function songList(songs, { artists = false } = {}) {
  const names = songs.slice(0, 3).map((s) => `${spoken(s.name)}${artists && s.artist ? ` by ${s.artist}` : ""}`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")}, then ${names.at(-1)}` : names[0] ?? "";
}

// What the house says, in one breath. The doors (Alexa, Talk, the TV) may
// add their own words after it. `dry` says what it WOULD do, naming the
// first songs, for stage 2's dry run (MC-47); `open` asks an unsure question
// without the "say … first", for a door that keeps listening for the answer
// (Alexa, the owner's stage 2).
export function sayFor(x, { dry = false, open = false } = {}) {
  const where = at(x.device);
  if (x.kind === "unsure") {
    const [a, b] = x.readings;
    const name = fold(a.title) === fold(b.title) ? spoken(a.title) : x.words;
    // A title track: one artist, two things.
    if (a.by && a.by === b.by) return `${name} by ${a.by}: the album, or the song?${open ? "" : ` Say "the album …" or "the song …" first.`}`;
    return `${name}: ${x.readings.map(readingWords).join(", or ")}?${open ? "" : ` Say "the album …", "the song …" or "the band …" first.`}`;
  }
  if (x.kind === "dj") return `I'd put ${djName(x.dj)} on${where ? `,${where}` : ""}.`;
  if (x.kind === "album") {
    return dry ? `I'd play ${spoken(x.album.name)}, the album by ${x.album.artist}, in order${where ? `,${where}` : ""}.`
      : `Starting ${spoken(x.album.name)}, the album by ${x.album.artist}${where ? `,${where}` : ""}.`;
  }
  if (["none", "mood", "like", "classical", "charts", "several"].includes(x.kind)) {
    return WHY[x.why] ?? `I couldn't find "${x.words}" on Spotify.`;
  }
  if (!x.place) return `${x.title}: no DJ can carry it on in this house, so I couldn't start it.`;
  const who = djName(x.dj);
  if (x.place.own) {
    return dry ? `I'd start ${who}${where}, on preset ${x.place.button}, ${owns(who)} own, and steer it toward ${x.words}.`
      : `Starting ${who}${where}, on preset ${x.place.button}, ${owns(who)} own; the songs turn to ${x.words} after this one.`;
  }
  if (!x.songs.length) {
    return dry ? `I'd ask ${who} for an opening of ${x.words}; it would start${where} on preset ${x.place.button} in about four minutes.`
      : `${who} makes an opening for ${x.words}, about four minutes, then it starts${where} on preset ${x.place.button}.`;
  }
  const what = x.kind === "song" ? `${spoken(x.title)} by ${x.by}` : x.kind === "artist" ? x.title : x.words;
  if (dry) {
    const rest = x.kind === "song" ? x.songs.slice(1, 3) : x.songs;
    const list = songList(rest, { artists: x.kind !== "artist" && x.kind !== "song" });
    const songs = !list ? "" : x.kind === "song" ? `, then ${list.replace(/, then /, " and ")}` : `: ${list}`;
    return `I'd start ${what}${where}${songs}. ${who} takes it from there, on preset ${x.place.button}.`;
  }
  const first = x.kind === "song" ? "" : quoteFirst(x.songs);
  return `Starting ${what}${where}${first}. ${who} takes it from there, on preset ${x.place.button}.`;
}
