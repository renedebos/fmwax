// AT A GLANCE (2026-09-30, the owner: "A+B on the DJ page … put the C2 map as
// a link in the '?' pill"). The card every DJ's page draws under its header
// (the sleeves under it went on 2026-10-02), and Which DJ? behind the DJs
// tab's help (in place of the map since 2026-10-01).
import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { ROSTER, GLANCE, GLANCE_NOW, WHICH, WHICH_NEEDS, WHICH_SCRIPTS, DJ_ASKS } from "../djs.js";
import { makeEnv, installFetch, track, buttons } from "./harness.js";

const KEY = "abcdefabcdefabcdefabcdef";
const P = (n) => `00000000000000000000${String(n).padStart(2, "0")}`;
// Sixteen alphanumerics: an album-art URL the pages will draw.
const S = (n) => `sleeve${String(n).padStart(10, "0")}`;
const get = (e, path) => worker.fetch(new Request(`https://x.test${path}`), e);

function house() {
  const e = makeEnv();
  e.PLAYLIST_ALIASES = JSON.stringify({ replay: P(9) });
  e.BUTTONS = buttons({ 1: P(1), 2: P(2), 3: P(3), 4: P(4), 5: P(5), 6: true, 7: P(7), 8: P(8) });
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.ROOM_DEVICES = JSON.stringify(["Pro Plus"]);
  return e;
}

test("every DJ on the roster has a glance row the page can draw", () => {
  for (const k of Object.keys(ROSTER)) {
    const g = GLANCE[k];
    assert.ok(g, `${k} has no GLANCE row`);
    assert.ok(g.years === null || (Array.isArray(g.years) && g.years.length === 2 &&
      g.years[0] >= 1900 && g.years[0] <= g.years[1] && g.years[1] <= GLANCE_NOW), `${k}: years`);
    assert.ok(Number.isFinite(g.fame) && g.fame >= 0 && g.fame <= 1, `${k}: fame`);
    assert.ok(typeof g.hits === "string" && g.hits.length > 3, `${k}: hits`);
    assert.ok(typeof g.set === "string" && g.set.length > 3, `${k}: set`);
    if (g.where !== undefined) assert.ok(Array.isArray(g.where) && g.where.every((w) => typeof w === "string" && w), `${k}: where`);
  }
});

// The card left the DJ's page on 2026-10-24 (the owner: a tuned DJ's page
// showed the old settings beside "Tuned: …"); Which DJ? keeps the cards.
test("a DJ's page has no At a glance card any more, and no cover art", async () => {
  const e = house();
  const f = installFetch({ contents: [1, 2, 3, 4, 5, 6, 7].map((n) => track(S(n))) });
  try {
    const html = await (await get(e, `/buttons/${KEY}/hank`)).text();
    assert.doesNotMatch(html, /class="block glance"|>At a glance</);
    assert.ok(!/class="gsl"|class="gcap"/.test(html), "and no sleeves section anywhere");
  } finally { f.restore(); }
});

test("every DJ on the roster has a Which DJ card: a way of choosing, the words, a length and an ask", () => {
  const ids = new Set(WHICH_SCRIPTS.map((x) => x.id));
  // Six since 2026-10-13: "the sound" went with the Engineer, the
  // Bootlegger and the Projectionist, and "the place" with Dutch and Chanson.
  // Seven since 2026-10-26: "the sound" is back with Sessions.
  assert.equal(ids.size, 7);
  for (const sc of WHICH_SCRIPTS) assert.ok(sc.colour.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)), `${sc.id}: colours`);
  for (const k of Object.keys(ROSTER)) {
    const w = WHICH[k];
    assert.ok(w, `${k} has no WHICH row`);
    assert.ok(ids.has(w.script), `${k}: script`);
    for (const f of ["by", "field", "pick", "skip"]) assert.ok(typeof w[f] === "string" && w[f].length > 3, `${k}: ${f}`);
    assert.ok(Number.isFinite(w.minutes) && w.minutes > 0, `${k}: minutes`);
    assert.ok(DJ_ASKS[k]?.asks?.[0], `${k}: an ask`);
  }
  assert.deepEqual(Object.keys(WHICH).filter((k) => !ROSTER[k]), [], "no row for a DJ who is not on the roster");
  for (const [want, keys] of WHICH_NEEDS) for (const k of keys) assert.ok(ROSTER[k], `${want}: ${k}`);
});

test("Which DJ? behind the DJs tab's help: every DJ's card by the rule they pick by, each a link to their page", async () => {
  const e = house();
  e.BUTTONS = JSON.stringify([
    { button: 1, guest: true, live: true, name: "Requests · Spotify", playlist: P(1), catalog: "spotify" },
    { button: 2, guest: true, live: true, name: "Requests · Tidal", playlist: "0b6c1f5e-2a7d-4c3b-9e8f-1a2b3c4d5e6f", catalog: "tidal" },
    ...JSON.parse(buttons({ 6: true, 7: P(7) }))]);
  e.ENDLESS = JSON.stringify({ mode: "live", dailyRuns: 12, presets: [
    { button: 3, lane: true, playlist: P(3) }, { button: 4, dj: "dr-funkenstein", playlist: P(4) }, { button: 5, dj: "hank", playlist: P(5) }] });
  const f = installFetch();
  try {
    const tab = await (await get(e, `/buttons/${KEY}/djs`)).text();
    const help = tab.slice(tab.indexOf('<div class="helptext">'), tab.indexOf("</details>"));
    assert.match(help, new RegExp(`<a href="/buttons/${KEY}/djs/map">Which DJ\\?</a>`));
    const res = await get(e, `/buttons/${KEY}/djs/map`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>Which DJ\?<\/h1>/);
    for (const [k, p] of Object.entries(ROSTER)) {
      assert.ok(html.includes(`<h3><a href="/buttons/${KEY}/${k}">${p.name.replace("&", "&amp;")}</a></h3>`), `${p.name} has a card`);
      assert.ok(html.includes(`id="dj-${k}"`), `${p.name}'s card can be jumped to`);
    }
    for (const sc of WHICH_SCRIPTS) assert.ok(html.includes(`<section class="wgroup" id="g-${sc.id}"`), sc.name);
    // The card's numbers are the DJ page's: GLANCE's years and set, DJ_ASKS's ask.
    const hank = html.slice(html.indexOf('id="dj-hank"'), html.indexOf("</article>", html.indexOf('id="dj-hank"')));
    assert.match(hank, /<div class="wyr">1990–now<\/div>/);
    assert.match(hank, /an hour · like a box of singles/);
    assert.match(hank, /<q>Hank, an hour of Daptone and its neighbours\.<\/q>/);
    // The Professor's badge until he was cut (2026-10-15); the Librarian's.
    assert.match(html, /id="dj-the-librarian"[^]*?<span class="wbadge">Writes programs<\/span>/);
    // Where a set goes, from this house's own config.
    assert.match(html, /A set you ask any of them for goes to Requests: preset 1 on Spotify, 2 on Tidal\./);
    assert.match(html, /guest DJ on 3, unless they are a house DJ with a preset of their own \(4, 5\)\./);
    // Comedy was the one DJ never endless, until the cut (2026-10-13).
    assert.ok(!/never endless/.test(html), "nobody is asked-sets-only now");
    assert.ok(!/class="gmap"/.test(html), "the 2026-09-30 map is gone");
    assert.equal((await get(e, `/buttons/wrongwrongwrong1/djs/map`)).status, 404);
  } finally { f.restore(); }
});
