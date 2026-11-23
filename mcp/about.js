// ABOUT THIS SONG (MC-43, tasks/mc43-about-this-song.md; the owner chose C on
// the canvas "About This Song", 2026-11-14). A chip in the now bar's panel
// opens a view in the panel: what the DJ wrote about the playing song, when
// it comes from a Shelf page, and a link that opens the house's assistant
// with the question typed.
//
// Measured before it was built: `claude.ai/new?q=` opens signed in with the
// question typed and NOT sent, under Claude's red caution note (shown for
// every link that types a question in; it cannot be turned off). On the
// owner's iPhone it opened in Safari, signed in.
//
// Nothing here calls Spotify. The DJ's words are one read of the program
// record, made only when the chip is tapped, never on the bar's poll.
import { esc } from "./programs.js";

// A Spotify title without its suffixes: " - 2010 Remaster", " - 1977
// Version", " - The John Peel Session 27/08/1979", "(Remastered 2009)". Kept
// for the question and for finding the song in the page's words.
export function cleanSongTitle(title) {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s+-\s+.*$/, "");
  t = t.replace(/\s*[([][^)\]]*\b(remaster(ed)?|mono|stereo|version|mix|edit|live|demo|session|bonus)\b[^)\]]*[)\]]\s*$/i, "");
  return t.trim().slice(0, 200);
}

// For matching only: lower case, straight quotes, one space.
const fold = (s) => String(s ?? "").toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, " ").trim();

// The stop of a page that holds the track, and its paragraph that names the
// song (else the stop's first paragraph). Null for a page with no words for
// that stop (a setlist), or a track not on the page.
export function aboutStop(rec, uri, title) {
  const sections = Array.isArray(rec?.sections) ? rec.sections : [];
  const want = String(uri ?? "");
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(want)) return null;
  const i = sections.findIndex((s) => (Array.isArray(s?.tracks) ? s.tracks : []).some((t) => t?.uri === want));
  if (i < 0) return null;
  const sec = sections[i];
  const paras = (Array.isArray(sec?.prose) ? sec.prose : []).map((b) => String(typeof b === "string" ? b : b?.text ?? "").trim()).filter(Boolean);
  if (!paras.length) return null;
  const name = fold(cleanSongTitle(title));
  const named = name.length >= 2 ? paras.find((p) => fold(p).includes(name)) : null;
  return {
    index: i,
    label: String(sec?.label ?? "").trim() || `Part ${i + 1}`,
    years: String(sec?.years ?? "").trim() || null,
    heading: String(sec?.heading ?? "").trim() || null,
    text: (named ?? paras[0]).slice(0, 4000),
  };
}

// WHICH ASSISTANT A HOUSE USES, when it has no curator to say (2026-11-14,
// the owner: "will this work for the forum user when they only run
// chatgpt?"). A house at the first two levels has no curator, but it keeps
// which app fetched its tools at the owner's door (settings.js, the setup
// page's "ChatGPT holds today's tools" line): the newer of Claude's and
// ChatGPT's fetches names it. Null when neither has fetched them.
export function assistantOf(lists) {
  const f = lists?.connector?.fetched ?? {};
  const at = (c) => Date.parse(f?.[c]?.at ?? "") || 0;
  const claude = at("claude"), chatgpt = at("chatgpt");
  if (!claude && !chatgpt) return null;
  return chatgpt > claude ? "chatgpt" : "claude";
}

// The house's one assistant (one engine per house, 2026-11-14): its curator's,
// else the app that talks to it (assistantOf), else Claude. Measured: both
// links open the app with the question typed and wait to be sent (Claude's
// 2026-11-14 on the owner's iPhone, from the house's app; ChatGPT's the same
// night), and only Claude's shows a caution note first.
export function askLink(kind, title, artist) {
  const t = cleanSongTitle(title);
  const a = String(artist ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const q = `Tell me about the song “${t}”${a ? ` by ${a}` : ""}.`;
  return kind === "chatgpt"
    ? { name: "ChatGPT", href: `https://chatgpt.com/?q=${encodeURIComponent(q)}` }
    : { name: "Claude", href: `https://claude.ai/new?q=${encodeURIComponent(q)}` };
}

const BACK = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
const ASK = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>`;
const OUT = `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16L16 8M9 8h7v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
const ON = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

// The view the panel shows, as HTML for the bar's script to put in the panel
// (as Tune's form is). `stop` from aboutStop, or null; `page` the Shelf
// page's address with the stop's anchor; `dj` the writer's name.
// `read` (readmore.js, 2026-11-22): the Guardian's pieces about the artist,
// { name, items }. On a phone each opens on the Guardian's own site, which is
// free to read and built for a phone; the TV reads them in place.
// `find` (readfind.js): where the song stands with the curator's web search:
// its pieces (each with its `line`), a search waiting, or the button.
export function aboutView({ title, artist, stop = null, page = null, dj = null, ask, read = null, find = null }) {
  const song = cleanSongTitle(title) || "This song";
  const words = stop ? `
  <section class="nbabw">
    <p class="nbablbl">${esc(dj ? `${dj} · ${stop.label}` : stop.label)}</p>${stop.heading ? `
    <h3 class="nbabh">${esc(stop.heading)}</h3>` : ""}
    <p class="nbabp">${esc(stop.text)}</p>${page ? `
    <a class="nbabpage" href="${esc(page)}">Read the whole page on the Shelf${ON}</a>` : ""}
  </section>` : "";
  const items = Array.isArray(read?.items) ? read.items.filter((it) => /^[a-z0-9-]+(\/[a-z0-9-]+){2,8}$/.test(String(it?.id ?? ""))) : [];
  const more = items.length ? `
  <section class="nbabr">
    <p class="nbablbl">Read more about ${esc(read.name)}</p>
    <ul class="nbabrl">${items.map((it) => `
      <li><a class="nbabri" href="https://www.theguardian.com/${esc(it.id)}" target="_blank" rel="noopener noreferrer">` +
    `<span class="nbabrt">${esc(it.title)}</span>` +
    `<span class="nbabrm">${esc([it.kind, "The Guardian", it.year, it.min ? `${it.min} min` : ""].filter(Boolean).join(" · "))}</span></a></li>`).join("")}
    </ul>
  </section>` : "";
  const pieces = find?.state === "found" ? (find.items ?? []).filter((it) => /^https:\/\/[a-z0-9.-]+\//i.test(String(it?.url ?? ""))) : [];
  const web = pieces.length ? `
  <section class="nbabr">
    <p class="nbablbl">More on the web</p>
    <ul class="nbabrl">${pieces.map((it) => `
      <li><a class="nbabri" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">` +
    `<span class="nbabrt">${esc(it.title)}</span><span class="nbabrm">${esc(it.line ?? it.source ?? "")}</span></a></li>`).join("")}
    </ul>
    <p class="nbabnote">Found by the house's curator searching the web. Each opens on its own site.</p>
  </section>` : find?.state === "asked" ? `
  <section class="nbabr">
    <p class="nbablbl">More on the web</p>
    <p class="nbabnote" role="status">The curator is searching the web for this song. A few minutes: open About this song again.</p>
  </section>` : find?.state === "none" ? `
  <section class="nbabr">
    <p class="nbablbl">More on the web</p>
    <p class="nbabnote">The curator searched the web for this song and found nothing more worth listing.</p>
  </section>` : find?.state === "ask" ? `
  <section class="nbabr">
    <p class="nbablbl">More on the web</p>
    <button type="button" class="nbabfind" data-readfind data-t="${esc(title)}" data-a="${esc(artist)}" data-al="${esc(find.album ?? "")}">Find articles and interviews</button>
    <p class="nbabnote" data-readfind-say role="status">The curator searches the web for this song. It takes a few minutes, once.</p>
  </section>` : "";
  // The song's key for the web search rides the view, so the panel knows
  // which search this view has shown (the dot, readfind.js).
  const mark = /^[a-z0-9][a-z0-9-]{2,79}$/.test(String(find?.slug ?? "")) ? `<span hidden data-find-slug="${esc(find.slug)}"></span>` : "";
  return `${mark}<div class="nbabhead"><button type="button" class="nbabback" data-ab-back aria-label="Back to the song">${BACK}</button>` +
    `<h2 class="nbabt">About this song</h2></div>
  <div class="nbabsong"><p class="nbabs1">${esc(song)}</p>${artist ? `<p class="nbabs2">${esc(artist)}</p>` : ""}</div>${words}${more}${web}
  <div class="nbabask">
    <a class="nbabgo" href="${esc(ask.href)}" target="_blank" rel="noopener noreferrer">${ASK}Ask ${esc(ask.name)} about this song${OUT}</a>
    <p class="nbabnote">${esc(ask.name)} opens with the question typed, for you to send.${ask.name === "Claude"
      ? " It shows a caution note first: that is expected." : ""}</p>
  </div>`;
}
