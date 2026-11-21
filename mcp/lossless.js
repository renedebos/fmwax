// A COLD WIIM, LIFTED TO LOSSLESS (MC-44, tasks/mc44-play-presses-the-key.md).
//
// Measured 2026-11-14 and 15 on the Pro Plus and the Ultra: a WiiM that has
// sat idle for hours plays whatever the house starts through Spotify at
// 320 kbps, whichever way Spotify is asked (ten ways tried), and stays there
// for every song after. A press of the speaker's own preset key, on its
// remote or over the LAN as the home helper presses it, makes that speaker
// lossless (about 970 kbps), and from then on everything the house asks of
// it stays lossless until it has sat idle for hours again.
//
// So after the house has started a playlist on a WiiM that reads as cold,
// the helper presses the key that holds that playlist. The press starts the
// song the set is on again, from that song's start: the set has only just
// begun, so the first song begins twice, a second or two apart.
//
// HOW COLD IS KNOWN, with no extra call: Spotify shows a cold WiiM under its
// 40-character device id instead of its name, in the same player answer the
// start already reads back; once its key has been pressed it is "Pro Plus"
// again. Seen on both speakers on two days: a clue the room test and the
// panel's quality line keep honest, not yet a proof.
//
// Never for a start that names where in the set to begin (the bar's
// play-again): a press would send that song back to its start. Never a
// failure of the start: the music is already playing, and a press that does
// not happen leaves it as it was before this file existed.
import { speakerPresetFor } from "./house.js";
import { helperCommand, helperView } from "./now.js";
import { parseSpeakers, readReadings } from "./room.js";
import { playerState, withBudget } from "./services.js";
import { station } from "./station.js";

const HEX_ID = /^[0-9a-f]{40}$/i;

// The speaker the player answer names is under its id, not its name.
// (`published` is the name as Spotify gave it: playerState shows the house's
// own name in its place, services.js.)
export function coldSession(st, deviceId) {
  const name = String(st?.device?.published ?? st?.device?.name ?? "").trim();
  if (!name) return false;
  return name === String(deviceId ?? "") || HEX_ID.test(name);
}

// Null when there is nothing to lift (not a WiiM of this house, or already
// lossless by the sign above). Else what happened, for the start's answer:
// { cold: true, pressed: n, code } or { cold: true, pressed: null, why }.
export async function liftToLossless(env, pl, deviceName, st, deviceId) {
  if (pl?.catalog && pl.catalog !== "spotify") return null;
  const box = parseSpeakers(env).find((b) => b.name === deviceName) ?? null;
  if (!box || !coldSession(st, deviceId)) return null;
  try {
    const hv = await helperView(env);
    if (!hv.lan?.hands) return { cold: true, pressed: null, why: "the home helper is off" };
    const key = speakerPresetFor(env, await readReadings(env, [box]), { pid: pl.id, device: deviceName });
    if (!key) return { cold: true, pressed: null, why: "the set is on none of this speaker's presets" };
    const out = await helperCommand(env, { cmd: "key", n: key.btn, speaker: box.name });
    return { cold: true, pressed: key.btn, code: out.code };
  } catch (e) {
    return { cold: true, pressed: null, why: String(e?.message ?? e).slice(0, 80) };
  }
}

// A SET THAT FELL TO 320 (2026-11-20, measured on the Pro Plus with a watch
// on its own numbers). A speaker playing lossless (963 kbps) had its song
// started again through Spotify, by nothing this file knew of and with no
// key pressed, and read 320 from that second on; the evening before, a
// steer's jump did the same. A press of the playing list's own key through
// the helper lifted it (320 to 929, the same song). The house cannot know
// every call that starts a song again, but the helper reads the speaker's
// bitrate every few seconds. So the reading is the watch:
//
//   a WiiM playing a Spotify playlist that sits on one of its keys reads
//   320 or less, on a reading where the song or the bitrate has just
//   changed, and Spotify says the song is in its first seconds: the helper
//   presses that key. The song begins again, lossless.
//
// Kept honest by three marks a speaker (the helper's document, `marks`):
// `lossless`, the last time it read above 320 on Spotify, since a house or a
// speaker that never plays lossless must never be pressed for it; `tried`,
// so two readings a second apart make one look; `pressed`, so a press is
// not repeated within ten minutes, nor for six hours when the speaker has
// not read lossless since the last one (a press that does not help).
export const LIFT = { kbps: 320, knownMs: 7 * 24 * 3600e3, triedMs: 30e3, pressedMs: 600e3, noHelpMs: 6 * 3600e3, earlyMs: 25e3 };

// Pure: the marks as they stand after this reading, and the speakers to
// look at. `prev` is the helper's document before the reading.
export function fallenToLossy(prev, speakers, now) {
  const marks = { ...(prev?.marks ?? {}) };
  const look = [];
  for (const [name, r] of Object.entries(speakers ?? {})) {
    const m = { ...(marks[name] ?? {}) };
    const kbps = r?.source === "Spotify" && r.state === "play" ? Number(r.quality?.kbps) || 0 : 0;
    if (kbps > LIFT.kbps) { m.lossless = now; marks[name] = m; continue; }
    const was = prev?.speakers?.[name] ?? null;
    const changed = !!was && (was.track !== r?.track || (Number(was.quality?.kbps) || 0) > LIFT.kbps);
    const known = now - (Number(m.lossless) || 0) < LIFT.knownMs;
    const pressed = Number(m.pressed) || 0;
    const rested = now - pressed >= ((Number(m.lossless) || 0) > pressed ? LIFT.pressedMs : LIFT.noHelpMs);
    if (kbps > 0 && r.playlist && changed && known && rested && now - (Number(m.tried) || 0) >= LIFT.triedMs) {
      m.tried = now;
      look.push({ name, playlist: r.playlist, kbps });
    }
    if (Object.keys(m).length) marks[name] = m;
  }
  return { marks, look };
}

// The look and the press, for one speaker `fallenToLossy` named. Answers
// what happened in a word, for the log; never throws.
export async function liftFallen(env, { name, playlist, kbps }, now = Date.now()) {
  try {
    const box = parseSpeakers(env).find((b) => b.name === name) ?? null;
    if (!box) return "not-a-wiim";
    const hv = await helperView(env);
    if (!hv.lan?.hands) return "helper-off";
    const key = speakerPresetFor(env, await readReadings(env, [box]), { pid: playlist, device: name });
    if (!key) return "on-no-key";
    // Spotify's word on where the song is: a press sends it back to its
    // start, which is only nothing to lose in its first seconds.
    const st = await playerState(withBudget(env, { remaining: 4 }));
    const here = st?.is_playing === true && String(st?.context?.uri ?? "") === `spotify:playlist:${playlist}`
      && String(st?.device?.name ?? "") === name;
    if (!here) return "not-seen-by-spotify";
    if ((Number(st.progress_ms) || 0) > LIFT.earlyMs) return "mid-song";
    const out = await helperCommand(env, { cmd: "key", n: key.btn, speaker: name });
    if (out.code === "ok" || out.code === "timeout") {
      await station(env, "helper-mark", { speaker: name, mark: { pressed: now } }).catch(() => {});
    }
    try {
      await station(env, "endless-log", { events: [{ at: now, btn: key.btn, event: "lift",
        detail: `${name} read ${kbps} kbps at a song's start: key ${key.btn} pressed for lossless (${out.code})` }] });
    } catch { /* a lost line */ }
    return `pressed-${out.code}`;
  } catch (e) {
    return `failed: ${String(e?.message ?? e).slice(0, 60)}`;
  }
}

// THE RIGHT SONGS (2026-11-14, 23:16: Genre's fresh set landed, the house
// started its playlist in the same second, and the speaker played the
// playlist as it was BEFORE the write, Sam Cooke under the right playlist,
// until the ten-minute look caught it). A caller that has just written the
// set hands its songs over; the song playing is one of them, or not.
export function playingOneOf(st, uris) {
  if (!Array.isArray(uris) || !uris.length) return true;
  const mine = [st?.item?.uri, st?.item?.linked_from?.uri].filter(Boolean);
  return mine.length === 0 || mine.some((u) => uris.includes(u));
}
// How long to wait before asking again, and again: Spotify's player caught
// up within five minutes that night; how soon is not known.
export const STALE_WAITS_MS = [2500, 4000];
