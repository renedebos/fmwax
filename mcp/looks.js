// THE LOOKS: what plays, for the now bar on every phone page (…/playing) and
// for the TV page (…/tv/now), every few seconds while a page is open.
//
// Lifted out of routes.js (2026-11-23, the owner: "make the tv check lighter
// first"). That evening every look from the TV was cut off at Cloudflare's
// free-plan limit of 10 ms CPU a request ("exceededCpu", seen with wrangler
// tail), while the helper's posts and the ledger's calls were fine. Measured
// on the Chromebook, the first request an isolate serves costs about 65 ms
// CPU whatever its path, most of it compiling routes.js's one very large
// request function, and a look made before that function is warm about 4 ms
// more. A look is the one request that comes every few seconds from a TV left
// on, so it no longer passes through that function: worker.js answers it from
// here, and only what a look needs is compiled for it.
//
// The rules are the route's own, unchanged: KV and the ledger first, Spotify
// only when the helper says something changed or a cap ran out (MC-29).
import { sameSecret } from "./claim.js";
import { guestAsks, guestHolders, newestOn } from "./house.js";
import { helperGot, helperViewOf, housePlayer, nowAnswer, pauseNoteBeside, roomPlaying } from "./now.js";
import { parseRoomDevices, parseSpeakers, readReadings, speakerSlug } from "./room.js";
import { PLAYER_DEADLINE_MS, throttledUntil, withBudget } from "./services.js";
import { tvAnswer, tvReadSig } from "./tv.js";

export const LOOK_PATH = /^\/buttons\/([A-Za-z0-9_-]{8,128})\/(playing|tv\/now)$/;

const say = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" } });

// One look: `m` is LOOK_PATH's match.
export async function answerLook(request, env, url, m) {
  const key = env.PROGRAM_LIBRARY_KEY;
  if (!key || !sameSecret(m[1], key)) return new Response("not found", { status: 404 });
  if (request.method !== "GET") return say(405, { error: "This answers GET only." });
  // Who is on the guests, as one time (2026-09-13): a page left open
  // reloads when this is newer than what it drew. So does the newest
  // reading of the speakers, which is how Read again comes back to a page
  // that shows it. KV only, never Spotify.
  const [holders, recs] = await Promise.all([guestHolders(env), readReadings(env, parseSpeakers(env))]);
  env.__watch?.lap("guests");
  const newest = newestOn(Object.values(holders).filter((h) => !h.failed).map((h) => h.on));
  const readAt = newestOn(Object.values(recs).filter(Boolean));
  // And the asks under the guests' bands, only for a page showing one in
  // flight (?asks=1): a ledger read a poll is worth it only then.
  const askSig = url.searchParams.get("asks") === "1" ? (await guestAsks(env, holders)).sig : null;
  if (askSig !== null) env.__watch?.lap("asks");
  const extra = { ...(newest ? { guestsAt: newest } : {}), ...(readAt ? { readAt } : {}),
    ...(askSig !== null ? { asks: askSig } : {}) };
  const throttle = await throttledUntil(env);
  env.__watch?.lap("throttle");
  // THE HOUSE'S KEPT ANSWER FIRST (MC-29): one ledger call brings the
  // helper's reading and the kept Spotify answer, and a read happens only
  // when the helper says something changed or a cap ran out. ?fresh=1 is
  // the now bar's re-check after its own pause, and always reads.
  const got = await helperGot(env);
  env.__watch?.lap("helper");
  const p = throttle ? null : await housePlayer(withBudget(env, { remaining: 4 }),
    { fresh: url.searchParams.get("fresh") === "1", deadlineMs: PLAYER_DEADLINE_MS, got })
    .then(roomPlaying).catch(() => ({ unknown: true }));
  env.__watch?.lap("player");
  const answer = await nowAnswer(env, request, p, { recs, holders, throttle, hv: helperViewOf(env, got),
    note: throttle ? null : await pauseNoteBeside(env, p) });
  env.__watch?.lap("answer");
  if (m[2] !== "playing") {
    const names = [...new Set([...(answer.speakers ?? []).map((sp) => sp.name), ...parseRoomDevices(env)])];
    const name = names.find((n) => speakerSlug(n) === String(url.searchParams.get("room") ?? "")) ?? null;
    if (!name) return say(400, { error: "That is not one of this house's rooms." });
    const wiim = (answer.speakers ?? []).some((sp) => sp.name === name);
    return say(200, tvAnswer(answer, { name, slug: speakerSlug(name), wiim, other: !wiim },
      { readAt, readSig: tvReadSig(recs), canTune: !!env.HOUSE, tz: env.HOUSE_TZ ?? null }));
  }
  return say(200, { ...extra, ...answer });
}
