// THE LEVELS OF AN INSTALL (MC-40, tasks/mc40-dj-presets.md, *The levels*;
// the canvas "The Install Ladder"). What each level adds, what it needs and
// about how long it takes, in the words every place uses: the setup
// checklist's sections reads them here, and a test holds the README, the
// start page (docs/index.html) and START-HERE.md to them, so the four cannot
// drift. Names chosen by the owner, 2026-11-10. A house can stop at any
// level and it works.
//
// Talk is an extra too (the owner, 2026-11-10): a house is given its OpenAI
// key on the setup page's Talk step, which tests it before keeping it.
export const LEVELS = [
  { key: "core", n: 1, name: "Ask a DJ", title: "Level 1 · Ask a DJ",
    gets: "Ask any of the eleven DJs for a set, in Claude or ChatGPT. It plays on your WiiM and stays on one preset button, Requests. Your house's own app on your phone.",
    short: "Ask for a set in Claude or ChatGPT. It plays on your WiiM and stays on one preset.",
    needs: "Spotify Premium. Free Cloudflare and GitHub accounts. Claude or ChatGPT (a free ChatGPT account worked in our test).",
    needsShort: "About an hour", time: "about an hour",
    sub: "Music from your phone, by text or voice · about an hour" },
  { key: "djpresets", n: 2, name: "DJ presets", title: "Level 2 · DJ presets",
    gets: "A DJ on a preset button of their own, with an hour of their songs on it from the start. For new songs, ask that DJ for a set.",
    short: "A DJ on a button of their own, with an hour of their songs from the start.",
    needs: "Nothing more.", needsShort: "Needs nothing more", time: "a few minutes per added preset",
    sub: "Optional · needs nothing more · a few minutes per added preset" },
  { key: "endless", n: 3, name: "Endless", title: "Level 3 · Endless",
    gets: "Your DJ presets add songs by themselves for as long as you listen. A guest DJ preset for any DJ. Ask from the DJ pages in your house's app.",
    short: "Your DJ presets add songs by themselves for as long as you listen.",
    needs: "A paid plan: Claude Pro or ChatGPT Plus (or higher).", needsShort: "Needs Claude Pro or ChatGPT Plus", time: "30 to 45 minutes",
    sub: "Optional · needs Claude Pro or ChatGPT Plus · 30 to 45 minutes" },
];
export const EXTRAS = [
  { key: "helper", name: "Home helper", title: "Extra · Home helper",
    gets: "A small program on a computer at home. While it runs, your house sees what is saved on each WiiM preset, and can press them for you.",
    needs: "A computer at home (Mac, Windows or Linux). It helps whenever that computer is on; it need not stay on.", time: "15 minutes" },
  { key: "talk", name: "Talk", title: "Extra · Talk",
    gets: "Ask by voice in your house's app: a DJ, a preset, \"more like this\".",
    needs: "Your own OpenAI API key, paid by the minute (about 5 cents). Not part of ChatGPT Plus.", time: "10 to 15 minutes" },
];
export const EXTRA_TALK_TITLE = EXTRAS.find((x) => x.key === "talk").title;
// Where a house is, for the checklist's strip: the level reached, and one
// sentence on the next one. 0 is a house still on Level 1's steps.
export function levelWords(n) {
  if (!n) return { n: 0, title: `Setting up ${LEVELS[0].title}`, next: "Do the steps below in order: each ticks itself when your house sees it done." };
  // "It works as it is" was confusing (the owner, the test house run,
  // 2026-11-10): say the house can stop here, then what more there is.
  const next = n === 1 ? "You can stop here: everything so far works. Or go on to Level 2: a DJ on a button of their own. It needs nothing more."
    : n === 2 ? "You can stop here: everything so far works. Or go on to Level 3: your DJ presets add songs by themselves. It needs a paid Claude or ChatGPT plan."
    : "Everything is set up. The extras below can be added any time.";
  return { n, title: LEVELS[n - 1].title, next };
}

// THE NEXT STEP, the checklist's card at the top: the first row still to do.
// Where the house is on the ladder it follows the strip (the test house run,
// 2026-11-10: with Level 1 done the card said "Next: Curator", Level 3, while
// the strip said Level 2 was next): Level 1's own steps first; at Level 2 its
// presets still to save; then the next level's first step, marked optional,
// since a house can stop at any level. Before Level 1 is done, or past Level
// 3, or off the ladder: the first row to do, as before.
// A house set up at Level 1 or 2 still gets the next level's step, as an
// offer (the owner, 2026-11-10: such a house reads "5 of 5, set up").
export function nextStep(list) {
  const n = list.level?.n;
  if (list.allDone && !(n >= 1 && n < 3)) return null;
  const todo = (r) => r.state === "todo" && !!r.href;
  const rowsOf = (key) => list.sections.find((s) => s.key === key)?.rows ?? [];
  const first = list.sections.flatMap((s) => s.rows).find(todo);
  const plain = first ? { row: first, optional: false } : null;
  if (!n || n >= 3) return plain;
  const own = rowsOf("core").find(todo) ?? (n === 2 ? rowsOf("djpresets").find(todo) : null);
  if (own) return { row: own, optional: false };
  const up = rowsOf(n === 1 ? "djpresets" : "endless").find((r) => (r.state === "todo" || r.state === "offer") && !!r.href);
  return up ? { row: up, optional: true } : plain;
}
