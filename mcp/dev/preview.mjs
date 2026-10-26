// A LOCAL PREVIEW OF EVERY PAGE (2026-09-28, for the design audit). The
// Worker runs in Node on the test harness's fakes, with this house's own
// config (house.json and the rendered wrangler.toml) and made-up programs,
// a set on preset 1 and a player, so every page can be opened and
// screenshotted at phone size: no key, no Spotify, no Cloudflare.
//
//   node dev/preview.mjs            → http://localhost:8799/buttons/preview-key-0000/wiim
//
// Nothing here is deployed or reachable from outside this machine.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../worker.js";
import { TEMPLATE_VERSION } from "../programs.js";
import { makeEnv, installFetch, track } from "../test/harness.js";
import { ARCHIVE } from "../archive-identity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, "..");
const PORT = Number(process.env.PORT) || 8799;
export const KEY = "preview-key-0000";
const BASE = `http://localhost:${PORT}`;

// The house's own config: every simple string var the deploy renders, and
// the buttons from house.json (a TOML array there, an array here too).
export function houseVars() {
  const toml = readFileSync(join(MCP, "wrangler.toml"), "utf8");
  const vars = toml.slice(toml.indexOf("[vars]"), toml.indexOf("[triggers]"));
  const out = {};
  for (const line of vars.split("\n")) {
    const m = line.match(/^([A-Z_]+) = ("(?:[^"\\]|\\.)*"|'[^']*')\s*$/);
    if (m) out[m[1]] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2].slice(1, -1);
  }
  out.BUTTONS = JSON.parse(readFileSync(join(MCP, "house.json"), "utf8")).buttons;
  return out;
}

// The covers, from the repo's art/covers, as the COVERS assets binding serves them.
const COVERS_DIR = join(MCP, "..", "art", "covers");
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
export const covers = {
  fetch: async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = join(COVERS_DIR, path);
    if (!file.startsWith(COVERS_DIR) || !existsSync(file)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" } });
  },
};

// The requests presets' playlists, as this house's config names them (a copy
// of the app has a sample house, so no id is written here).
const GUESTS = houseVars().BUTTONS.filter((b) => b.guest);
export const REQUESTS_PL = GUESTS.find((b) => b.catalog === "spotify")?.playlist ?? "SAMPLEPLAYLIST00000001";
const TIDAL_PL = GUESTS.find((b) => b.catalog === "tidal")?.playlist ?? "00000000-0000-4000-8000-000000000001";
export const t = (uri, title, artist, album, year, secs) =>
  ({ uri: `spotify:track:${uri.padEnd(22, "x")}`, title, artist, album, year, duration: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, duration_ms: secs * 1000 });
// The Professor's three and the Selector's one went to the DJs who stay when
// the owner cut them, 2026-10-15; the records and the slugs are as they were,
// so the player and the presets below still match.
export const PROGRAMS = [
  { slug: "spirit-of-eden-p1a2b3", dj: "Gatefold", shape: "essay", catalog: "tidal", title: "Spirit of Eden: The Beginning of the End",
    thesis: "Talk Talk did not make a record in 1988; they removed one. What is left is the argument.",
    tracks: [t("a1", "The Rainbow", "Talk Talk", "Spirit of Eden", "1988", 543), t("a2", "Eden", "Talk Talk", "Spirit of Eden", "1988", 457),
      t("a3", "Desire", "Talk Talk", "Spirit of Eden", "1988", 429), t("a4", "New Grass", "Talk Talk", "Laughing Stock", "1991", 581)] },
  { slug: "soft-pedal-deep-pocket-q4r5", dj: "The Librarian", shape: "essay", title: "Soft Pedal, Deep Pocket: Okonski and the New Piano Trio",
    thesis: "The piano trio went quiet on purpose. Three records say why.",
    tracks: [t("b1", "Still Point", "Christian Okonski", "Still", "2024", 312), t("b2", "Hollow", "Tigran Hamasyan", "StandArt", "2022", 401)] },
  { slug: "cold-sweat-hank-s6t7", dj: "Hank", shape: "setlist", title: "Colemine, Front to Back",
    thesis: "One label, one hour, no filler.",
    tracks: [t("c1", "Dumpster Diving", "Durand Jones & The Indications", "Durand Jones", "2016", 208), t("c2", "Loose Ends", "Monophonics", "Sage Motel", "2021", 243)] },
  // Sunny's until the merges (2026-10-13); the speakers' reading below still
  // calls 9 "Sunny", as the WiiMs do until it is saved again.
  { slug: "easy-end-of-day-u8v9", dj: "Vibe", shape: "setlist", title: "An Easy End-of-Day Hour",
    thesis: "For relaxing after a long day.", tracks: [t("d1", "Pink + White", "Frank Ocean", "Blonde", "2016", 184)] },
  // Baddie's chain until 2026-10-13, when she was cut (the owner); the same
  // records as the Professor's argument after that, and the Librarian's
  // since he went too, so the player below still matches.
  { slug: "aint-nobody-every-woman-w1x2", dj: "The Librarian", shape: "argument", title: "Ain't Nobody, Every Woman",
    thesis: "A song is finished by whoever sings it next: one leads to its cover, the cover to its writer.",
    tracks: [t("e1", "Ain't Nobody", "Rufus, Chaka Khan", "Stompin' at the Savoy", "1983", 285), t("e2", "I'm Every Woman", "Whitney Houston", "The Bodyguard", "1992", 285),
      t("e3", "I Will Always Love You", "Dolly Parton", "Jolene", "1974", 177), t("e4", "Jolene", "Dolly Parton", "Jolene", "1973", 163)] },
  { slug: "riddim-survey-y3z4", dj: "Genre", shape: "setlist", title: "Stalag, Three Ways",
    thesis: "One riddim, three decades.", tracks: [t("f1", "Ring the Alarm", "Tenor Saw", "Ring the Alarm", "1985", 186)] },
  { slug: "sleeve-notes-blue-a5b6", dj: "Gatefold", shape: "essay", title: "Kind of Blue, Side Two",
    thesis: "Two tracks and a sleeve note that got the modes wrong.", tracks: [t("g1", "All Blues", "Miles Davis", "Kind of Blue", "1959", 693)] },
  { slug: "librarian-fence-c7d8", dj: "The Librarian", shape: "essay", title: "Stax Singles, 1967: A Survey with a Fence",
    thesis: "Every A-side Stax released in one year, minus what you know.", tracks: [t("h1", "Tramp", "Otis Redding & Carla Thomas", "King & Queen", "1967", 180)] },
];

// `mod` is a Worker module other than ../worker.js — dev/pagecheck.mjs hands
// in the deploy's own bundle.
export async function seed(env, mod = null) {
  for (const [i, p] of PROGRAMS.entries()) {
    const created = new Date(Date.now() - (i + 1) * 26 * 3600e3).toISOString();
    const secs = p.tracks.reduce((a, x) => a + x.duration_ms / 1000, 0);
    const runtime = `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;
    const rec = { slug: p.slug, dj: p.dj, shape: p.shape, title: p.title, thesis: p.thesis,
      sections: [{ label: null, years: null, heading: null, prose: [p.thesis], tracks: p.tracks }],
      complications: [], coda: [], sources: [], notes: [], playlistId: REQUESTS_PL, playlistName: "Requests - Spotify",
      created, loaded: false, templateVersion: TEMPLATE_VERSION, tracks: p.tracks.length, runtime, catalog: p.catalog ?? "spotify" };
    await env.PROGRAMS.put(`program:${p.slug}`, JSON.stringify(rec), { metadata: { title: p.title, dj: p.dj, shape: p.shape,
      created, tracks: p.tracks.length, runtime, catalog: p.catalog ?? "spotify" } });
  }
  // The Librarian's covers set on 1, asked for twenty minutes ago.
  await env.PROGRAMS.put(`on:${REQUESTS_PL}`, JSON.stringify({ dj: "the-librarian", ref: "aint-nobody-every-woman-w1x2", at: new Date(Date.now() - 20 * 60e3).toISOString() }));
  await env.PROGRAMS.put(`current:${REQUESTS_PL}`, "aint-nobody-every-woman-w1x2");
  // Gatefold's Spirit of Eden set on 2, Tidal.
  await env.PROGRAMS.put(`on:${TIDAL_PL}`, JSON.stringify({ dj: "gatefold", ref: "spirit-of-eden-p1a2b3", at: new Date(Date.now() - 90 * 60e3).toISOString() }));
  // Pub Rock as the guest DJ (Dr. Funkenstein was, until he took preset 4
  // when Monk was cut, 2026-10-15).
  const { __test } = mod ?? await import("../worker.js");
  await __test.endlessUpdate(env, (st) => { st.lane = { btn: 7, dj: "pub-rock", tenancy: 8, program: null, since: Date.now() - 3 * 3600e3, head: 0 }; return {}; });
  // What the speakers hold, as the helper last read them: 4 and 8 still say
  // Monk and The Selector, as the WiiMs do until they are saved again.
  const presets = [[1, "Requests - Spotify", "Spotify"], [2, "Requests - Tidal", "Tidal"], [3, "Novato", "Prime"],
    [4, "Monk", "Spotify"], [5, "Hank", "Spotify"], [6, ARCHIVE.name, "Web stream"], [7, "Guest DJ", "Spotify"],
    [8, "The Selector", "Spotify"], [9, "Sunny", "Spotify"], [10, "Pub Rock", "Spotify"], [11, "Americana", "Spotify"], [12, "The Librarian", "Spotify"]]
    .map(([btn, name, source]) => ({ btn, name, source, saved: null }));
  for (const [slug, speaker] of [["pro-plus", "Pro Plus"], ["ultra", "Ultra"]]) {
    await env.PROGRAMS.put(`reading:${slug}`, JSON.stringify({ at: new Date().toISOString(), speaker, presets }));
  }
}

// Spotify's player: the Librarian's covers set on 1, playing on the Pro
// Plus. `player.now` is what /me/player answers (null: nothing, a 204); a
// screenshot script may swap it between shots.
export const player = {
  now: { is_playing: true, progress_ms: 61_000, device: { name: "Pro Plus", id: "pro-plus-id", type: "Speaker" },
    context: { uri: `spotify:playlist:${REQUESTS_PL}` },
    item: { name: "Ain't Nobody", uri: "spotify:track:e1xxxxxxxxxxxxxxxxxxxx", duration_ms: 285_000,
      artists: [{ name: "Rufus" }, { name: "Chaka Khan" }], album: { name: "Stompin' at the Savoy",
        // Spotify's three sizes (the now panel's big sleeve, 2026-10-13); a
        // screenshot script serves them, offline they draw nothing.
        images: [640, 300, 64].map((w) => ({ url: `https://i.scdn.co/image/preview-${w}`, width: w, height: w })) } } },
};
export function fakeSpotify() {
  installFetch({ contents: PROGRAMS[4].tracks.map((x, i) => ({ ...track(`e${i + 1}`, x.title, x.artist), duration_ms: x.duration_ms })) });
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.spotify.com" && url.pathname === "/v1/me/player" && (init.method ?? "GET") === "GET") {
      return player.now ? Response.json(player.now) : new Response(null, { status: 204 });
    }
    if (url.hostname === "api.spotify.com" && url.pathname.startsWith("/v1/me/player") && init.method && init.method !== "GET") {
      return new Response(null, { status: 204 });
    }
    return inner(u, init);
  };
}

// The whole preview house: config, programs, the player, the helper's word.
// `vars` overrides the house's config (a screenshot may rename speakers).
export async function makePreview({ vars = {}, base = BASE, helper = null, mod = null } = {}) {
  const w = mod?.default ?? worker;
  const env = Object.assign(makeEnv(), houseVars(), {
    PROGRAM_LIBRARY_KEY: KEY, PROGRAM_BASE_URL: base, HELPER_SECRET: "preview", OPENAI_API_KEY: "preview", COVERS: covers,
  }, vars);
  fakeSpotify();
  await seed(env, mod);
  // The helper, reading the Pro Plus on Spotify and the Ultra idle.
  await w.fetch(new Request(`${base}/helper/reading`, { method: "POST", headers: { authorization: "Bearer preview", "content-type": "application/json" },
    body: JSON.stringify({ speakers: helper ?? [{ name: "Pro Plus", state: "play", source: "Spotify", track: "Ain't Nobody", artists: "Rufus, Chaka Khan" },
      { name: "Ultra", state: "idle" }] }) }), env);
  return env;
}

// Serves the Worker; `extra(req, url)` may answer a request first (the stage's
// scene switch), or return null to let the Worker have it.
export function serve(env, { port = PORT, base = BASE, extra = null, mod = null } = {}) {
  const w = mod?.default ?? worker;
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    try {
      const own = extra ? await extra(req, new URL(base + req.url)) : null;
      const r = own ?? await w.fetch(new Request(base + req.url, { method: req.method, headers: req.headers,
        ...(body && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}) }), env, { waitUntil: () => {} });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e?.stack ?? e));
    }
  }).listen(port, () => console.log(`preview on ${base}/buttons/${KEY}/wiim`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serve(await makePreview());
