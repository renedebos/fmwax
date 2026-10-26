// THE HOUSE COUNTS THE RULES IT CAN (2026-10-18, step 3 of the plan the owner
// approved: "Go with next step"). Measured first, on the 160 sets the house
// had backed up: the rules mostly hold, but Genre's Pub Rock set of
// 2026-10-17 put the same act back to back four times in 37 songs, and Hank
// put a Lee Fields song beside its own instrumental. A set that breaks a rule
// a machine can count is sent back once, with the songs named; the next call
// is written as sent, so the music never waits on a rule.
//
// What a song is comes from what search_tracks showed the curator (the
// ledger's seen_tracks, kept two days): one Spotify call per track before a
// write would double a set's calls, and the URIs come from that search anyway.
// A song the ledger never saw is not counted, never guessed.

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
// A song's title without its version: "Will I Get Off Easy (Instrumental)"
// and "Theme From Shaft - Remastered 2009" are those songs.
export const titleBase = (t) => fold(t).replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s+-\s+.*$/, "")
  .replace(/[^a-z0-9]+/g, "");
const HOUR_MS = 60 * 60 * 1000;

// `tracks`: the set in playing order, each { uri, lead, title, album, ms } or
// null for one the ledger never saw. `before`: the song already last on the
// list, for a top-up. `spacing`: the DJ's countable rules (djs.js). The
// breaks, in words, at most six.
export function setBreaks(tracks, spacing = null, { before = null } = {}) {
  const out = [];
  const list = tracks.map((t) => (t ? { ...t, base: titleBase(t.title), who: fold(t.lead), disc: fold(t.album) } : null));
  const known = list.filter(Boolean);
  const most = (key) => {
    const n = new Map();
    for (const t of known) if (t[key]) n.set(t[key], (n.get(t[key]) ?? 0) + 1);
    return Math.max(0, ...n.values());
  };
  // A set of one song's versions ("seven Nardis") was asked for that way:
  // its titles are not counted against it. Nor are a one-artist set's artists
  // ("an hour of Ray Charles"), but only for a DJ whose rules allow such a
  // set (Soul's do; Genre's and Vibe's never: Codex's review, 2026-10-18,
  // found four of six by one act passing Vibe's one-song-an-act rule).
  const versions = most("base") >= 3 && most("base") > known.length / 2;
  const oneArtist = !!spacing?.oneArtistSets && most("who") >= 3 && most("who") > known.length * 0.6;

  // The same recording twice, anywhere in the set.
  const at = new Map();
  list.forEach((t, i) => {
    if (!t) return;
    if (at.has(t.uri)) out.push(`songs ${at.get(t.uri) + 1} and ${i + 1} are the same recording ("${list[at.get(t.uri)].title}")`);
    else at.set(t.uri, i);
  });
  const prev = before ? { ...before, base: titleBase(before.title), who: fold(before.lead), disc: fold(before.album) } : null;
  // The same song back to back, in any version, by anyone (the house's rule
  // for every DJ: a listener hearing it twice in a row assumes a mistake).
  if (!versions) {
    list.forEach((t, i) => {
      const p = i ? list[i - 1] : prev;
      if (t?.base && p?.base && t.base === p.base) {
        out.push(i ? `songs ${i} and ${i + 1} are both "${p.title}"` : `song 1 is "${p.title}" again, right after the list's last song`);
      }
    });
    // And one act's song twice anywhere in the set: a remaster, an edit or
    // another take of a record already on it is that record (Codex's review,
    // 2026-10-18: an original and its remaster five songs apart passed).
    const first = new Map();
    list.forEach((t, i) => {
      if (!t?.base || !t.who) return;
      const k = `${t.who}|${t.base}`;
      const j = first.get(k);
      if (j === undefined) { first.set(k, i); return; }
      if (j < i - 1 && list[j].uri !== t.uri) out.push(`songs ${j + 1} and ${i + 1} are both ${t.lead}'s "${list[j].title}"`);
    });
  }
  if (spacing && !oneArtist) {
    // Too many in a row by one act, counting the list's last song.
    if (spacing.artistRun) {
      const off = prev?.who ? 1 : 0;
      const seq = off ? [prev, ...list] : list;
      let from = 0;
      for (let i = 1; i <= seq.length; i++) {
        if (i < seq.length && seq[i]?.who && seq[i].who === seq[from]?.who) continue;
        const len = i - from, a = from - off, b = i - 1 - off, who = seq[from]?.lead;
        if (seq[from]?.who && len > spacing.artistRun) {
          out.push(a < 0 ? `${b === 0 ? "song 1 follows" : `songs 1 to ${b + 1} follow`} the list's last song by the same act (${who})`
            : len === 2 ? `songs ${a + 1} and ${b + 1} are both ${who}` : `songs ${a + 1} to ${b + 1} are all ${who}`);
        }
        from = i;
      }
    }
    // One act more than once a set.
    if (spacing.artistPerSet) {
      const n = new Map();
      list.forEach((t, i) => { if (t?.who) n.set(t.who, [...(n.get(t.who) ?? []), i]); });
      for (const idx of n.values()) {
        if (idx.length > spacing.artistPerSet) out.push(`${list[idx[0]].lead} is on ${idx.length} songs (${idx.map((i) => i + 1).join(", ")})`);
      }
    }
    // One act more than so many times in any hour.
    if (spacing.artistPerHour) {
      const starts = [];
      let clock = 0;
      for (const t of list) { starts.push(clock); clock += Number(t?.ms) || 4 * 60 * 1000; }
      const n = new Map();
      list.forEach((t, i) => { if (t?.who) n.set(t.who, [...(n.get(t.who) ?? []), i]); });
      for (const idx of n.values()) {
        const lim = spacing.artistPerHour;
        for (let k = 0; k + lim < idx.length; k++) {
          if (starts[idx[k + lim]] - starts[idx[k]] < HOUR_MS) {
            out.push(`${list[idx[k]].lead} is on ${lim + 1} songs inside an hour (${idx.slice(k, k + lim + 1).map((i) => i + 1).join(", ")})`);
            break;
          }
        }
      }
    }
  }
  // Two from one album in a row (Deep Dive): true of a one-artist set too.
  if (spacing?.albumRun) {
    list.forEach((t, i) => {
      const p = i ? list[i - 1] : prev;
      if (t?.disc && p?.disc && t.disc === p.disc && t.who === p.who) {
        out.push(i ? `songs ${i} and ${i + 1} are both from ${t.album}` : `song 1 is from ${t.album}, like the list's last song`);
      }
    });
  }
  return out.slice(0, 6);
}

// The song an endless list ends on, from the watch's own record of it
// ([uri, ms, "Artists — Title"]) when the ledger never saw it.
export function fromRecord(rec) {
  if (!Array.isArray(rec)) return null;
  const [uri, ms, line] = rec;
  const [artists, title] = String(line ?? "").split(" — ");
  return { uri, ms, lead: String(artists ?? "").split(", ")[0], title: title ?? "", album: "" };
}

export function sendBackWords(djName, spacing, breaks) {
  return `Not written: this set breaks rules the house counts for ${djName}` +
    `${spacing?.say ? ` (${spacing.say}; and never the same song twice in a row)` : " (never the same song twice in a row, never the same recording twice)"}: ` +
    // Without asking: Talk and the Claude app read this too since MC-33, and a
    // listener who asked for a set has no part in its spacing.
    `${breaks.join("; ")}. Reorder or swap those songs and call again, without asking the listener. The house sends a set back once: the next ` +
    "call is written as sent, whatever it holds. Nothing was added.";
}
