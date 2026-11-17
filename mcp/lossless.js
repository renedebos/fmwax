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
