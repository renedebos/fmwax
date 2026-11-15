// THE LONG READ, COUNTED (2026-11-13; the owner: "yes to long read fix").
//
// Release 1 of the long read (2026-11-12, toollist.js keep_request_set) told
// the writer to research first, keep notes, and write as long as the notes
// carry, with no lower bound. The house's ChatGPT curator then wrote 730
// words from five sources on Light and 1,010 from six on Medium, where the
// trial's best page ran 3,755 words from 62 notes: wording alone does not
// make a curator research. So the house counts what it can count, and a thin
// long read is SENT BACK ONCE, as a set that breaks a rule is: the notes the
// page was written from (sent in `research`), how many different sources
// they came from, and the page's words.
//
// A nudge, never a lock. The second call for the same request is published
// as it comes, because a subject with little written about it is a true
// case and padding is worse than a short page. What a page weighed is kept
// on its record (`weighed`, never rendered), so the next thin page can be
// told from a subject that was thin.
//
// No style is counted here on purpose: the trial's version written to a page
// of style rules, with a quota of quotes, read worst.

export const LONG_READ = {
  notes: 20,      // "Twenty to forty notes carry a long read" (the method's own low end)
  sources: 6,     // different SITES since 2026-11-14 (the two thin pages rested on five and six sources)
  words: 1500,    // well under the trial's 3,600 to 5,300; over the 730 and 1,010
  noteChars: 30,  // a note says something: a fact, a scene, a person's words
};

const fold = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const textOf = (blocks) => (Array.isArray(blocks) ? blocks : []).map((b) => String(b?.text ?? "")).join(" ");
export function countWords(text) {
  return (String(text ?? "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

// SOURCES ARE COUNTED BY SITE (2026-11-14; the owner: "do 1 and 2"). Counted
// by their own words, 21 pages of Wikipedia were 21 sources: the house's
// ChatGPT curator passed with eight that were three sites, and the Claude
// routine's first page with 23 that were three. So a source is the site it
// was read on: the host of its address (its own, or the one the page's
// `sources` gives for its id), without www and the like, every Wikipedia one
// site. A source with no address (a book, a sleeve) is its own words, and
// the encyclopedias are known by name.
const TWO_PART = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;
const NAMED = [[/wikipedia/, "wikipedia.org"], [/musicbrainz/, "musicbrainz.org"], [/discogs/, "discogs.com"],
  [/allmusic/, "allmusic.com"]];
export function siteOf(source, byId = null) {
  const said = fold(source);
  if (!said) return "";
  const known = byId?.get(said);
  const text = known ? fold(`${known.url ?? ""} ${known.title ?? ""}`) : said;
  const host = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/:?#\s]|$)/.exec(text)?.[1];
  if (host) {
    const parts = host.split(".");
    const keep = TWO_PART.test(host) ? 3 : 2;
    return parts.slice(-keep).join(".");
  }
  for (const [re, site] of NAMED) if (re.test(text)) return site;
  return text.slice(0, 200);
}

// What a long read weighs. `research`: [{ note, source }], as the tool asks;
// a bare string counts as a note with no source. A note is counted once,
// however often it is sent; a source by its site (siteOf), with the page's
// own `sources` to say what an id stands for.
export function weighLongRead({ research, sources: cited, thesis, sections, complications, coda } = {}) {
  const byId = new Map();
  for (const c of Array.isArray(cited) ? cited.slice(0, 400) : []) {
    const id = fold(c?.id);
    if (id) byId.set(id, { title: c?.title, url: c?.url });
  }
  const notes = new Set(), sources = new Set();
  for (const r of Array.isArray(research) ? research.slice(0, 400) : []) {
    const note = fold(typeof r === "string" ? r : r?.note);
    if (note.length < LONG_READ.noteChars || notes.has(note)) continue;
    notes.add(note);
    const site = siteOf(typeof r === "string" ? "" : r?.source, byId);
    if (site) sources.add(site);
  }
  const words = countWords([thesis, ...(Array.isArray(sections) ? sections : []).map((s) => textOf(s?.prose)),
    textOf(complications), textOf(coda)].join(" "));
  const short = [
    ...(notes.size < LONG_READ.notes ? ["notes"] : []),
    ...(sources.size < LONG_READ.sources ? ["sources"] : []),
    ...(words < LONG_READ.words ? ["words"] : []),
  ];
  return { notes: notes.size, sources: sources.size, words, short };
}

// What the writer is told, once. Says what was counted, what a long read
// rests on, what to do, and the way out for a subject with little written.
export function longReadSentBack(djName, w) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `${djName}'s long read is thin, so it is sent back once. Nothing was written. It came with ` +
    `${n(w.notes, "note", "notes")} in \`research\` from ${n(w.sources, "site", "different sites")}, and runs to ` +
    `${n(w.words, "word", "words")}. A long read rests on at least ${LONG_READ.notes} notes from at least ` +
    `${LONG_READ.sources} different sites and runs to at least ${LONG_READ.words} words. A site is where a note was ` +
    "read: every page of Wikipedia together is one site, so is every page of one magazine; a book or a sleeve " +
    "is one each. Go back to step 2 of " +
    "keep_request_set's description: read more (the people who were there, what was written at the time, the " +
    "record's own notes), add what you find to your notes, write the page out from them, check it against them, " +
    "and call again with every note in `research`, each with where it came from (the address, or the id of a " +
    "source that has its address). Do not pad and do not invent: " +
    "if little has been written about this subject, call again with what you have and say on the page that the " +
    "record is thin. The second call is published as it comes.";
}
