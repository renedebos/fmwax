#!/usr/bin/env node
// THE HOME HELPER (MC-25, tasks/done/mc25-home-helper.md). Runs on the house's
// Chromebook, inside the home network, and does the one thing the house on
// Cloudflare cannot: ask each WiiM what it is playing. It posts what it
// read to the house, which shows it on the bar and the Speakers page while
// the reading is fresh.
//
// It reads each speaker with `getPlayerStatus`, and a radio station's name
// (2026-10-03) and a stream's quality (2026-10-25) with `getMetaInfo`. Since stage 2 it also keeps
// one line open to the house (a WebSocket, its secret in the header) and
// takes three commands down it, "pause", "resume" and (stage 3) "key" with
// a preset number 1-12, for a speaker the house names. Nothing else is ever sent to a speaker, and nothing but the house
// can send it a command: the line goes out from here, never in. One more
// since 2026-10-21, for itself and never a speaker: "remove", the setup
// page's Remove, which a helper the install made obeys by taking itself off
// this computer (the owner's word: the first command that changes anything
// here, and only ever the helper's own files).
//
//   node helper/fmwax-helper.mjs          run, reading every 10 s
//   node helper/fmwax-helper.mjs --once   one reading, printed and posted
//
// Its settings are in ~/.config/fmwax-helper/env, never in the repo:
//   HELPER_SECRET=...        the house's HELPER_SECRET
//   HOUSE_URL=https://...    this house's own address; required, no default
// The speakers come from the house (/helper/speakers): the owner's house
// names them with their addresses (house.json `devices.speakers`); a house
// set up on its page knows only their names, and the helper finds them on
// the home network and tells it where they are (MC-31 stage 5, 2026-10-19).
//
//   node helper/fmwax-helper.mjs --find   which WiiMs are on this network
//
// A SPEAKER THAT MOVES (2026-10-19, the owner: both WiiMs had new addresses
// since September). The router lends each device its address, and after a
// restart or a power cut it may lend another. So the helper learns each
// speaker's fixed id (`getStatusEx`'s uuid, kept in
// ~/.config/fmwax-helper/speakers.json), and when one stops answering for
// half a minute it asks every address beside the old one which WiiM is
// there, and follows the one with that id. Asked one by one, never by a
// network-wide search, so it works on a Chromebook too, whose Linux cannot
// search the Wi-Fi but can reach any address on it.

import https from "node:https";
import http from "node:http";
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readingFrom } from "../mcp/keymap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const READ_EVERY_MS = 10_000;
// Posted when anything changed, and at least this often, so the house can
// tell a helper that is on from one that stopped (it trusts 150 s).
const POST_AT_LEAST_MS = 60_000;
// THE PRESET TABLES (MC-25): each speaker's GetKeyMapping — the same read the
// phone's Read WiiM Presets shortcut makes, never the write — every 15
// minutes, sent when it changed and at least hourly, so the Speakers page and
// its badge are never days old.
const PRESETS_EVERY_MS = 15 * 60_000;
// A speaker missing this many reads in a row is looked for; at most this
// often, so one switched off at the wall is not asked after all evening.
const MISSES_BEFORE_SEARCH = 3;
const SEARCH_AT_MOST_MS = 5 * 60_000;
const KNOWN_FILE = join(homedir(), ".config/fmwax-helper/speakers.json");
const PRESETS_AT_LEAST_MS = 60 * 60_000;
const PLAYQUEUE_NS = "urn:schemas-wiimu-com:service:PlayQueue:1";
const READ_ENVELOPE = `<?xml version="1.0" encoding="utf-8"?>` +
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
  `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
  `<u:GetKeyMapping xmlns:u="${PLAYQUEUE_NS}"></u:GetKeyMapping>` +
  `</s:Body></s:Envelope>`;
function keyMapping(ip) {
  return new Promise((resolve) => {
    const req = http.request({ host: ip, port: 49152, path: "/upnp/control/PlayQueue1", method: "POST", timeout: 6000,
      headers: { "content-type": "text/xml", soapaction: `"${PLAYQUEUE_NS}#GetKeyMapping"` } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.statusCode === 200 && body.includes("KeyList") ? body : null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(READ_ENVELOPE);
  });
}
const slugOf = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "speaker";
async function presetsLoop(cfg) {
  const sent = {};
  for (;;) {
    // A speaker that did not answer, or a house that did not keep it, is
    // tried again in a minute rather than in fifteen (2026-09-24: the Pro
    // Plus missed the first read at start-up).
    let missed = false;
    for (const [name, ip] of Object.entries(cfg.speakers)) {
      try {
        const table = await keyMapping(ip);
        if (!table) { missed = true; console.error(new Date().toISOString(), "presets", name, "no answer"); continue; }
        try { TABLES[name] = readingFrom(table); } catch { /* kept as it was */ }
        const was = sent[name];
        if (was && was.table === table && Date.now() - was.at < PRESETS_AT_LEAST_MS) continue;
        const r = await fetch(`${cfg.url}/helper/presets/${slugOf(name)}`, { method: "POST",
          headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "text/xml" }, body: table,
          signal: AbortSignal.timeout(10_000) });
        if (r.ok) { sent[name] = { table, at: Date.now() }; console.log(new Date().toISOString(), "presets", name, "kept"); }
        else { missed = true; console.error(new Date().toISOString(), "presets", name, "house said", r.status); }
      } catch (e) {
        missed = true;
        console.error(new Date().toISOString(), "presets", name, String(e?.message ?? e));
      }
    }
    await new Promise((r) => setTimeout(r, missed ? 60_000 : PRESETS_EVERY_MS));
  }
}

// The WiiM's `mode` numbers, as skills/wiim/wiim_cli.py names them.
const MODES = {
  1: "AirPlay", 2: "DLNA", 11: "USB", 31: "Spotify", 32: "Tidal", 36: "Qobuz",
  40: "Line-In", 41: "Bluetooth", 43: "Optical", 47: "Line-In 2", 51: "HDMI",
};

// Pandora's titles come XML-escaped inside the hex ("Stayin&apos; Alive",
// 2026-10-03); the pages escape for themselves.
const ENTITIES = { apos: "'", quot: '"', lt: "<", gt: ">", amp: "&" };
function unhex(h) {
  const s = String(h ?? "");
  if (!s || !/^[0-9a-f]+$/i.test(s) || s.length % 2) return s || null;
  try {
    return Buffer.from(s, "hex").toString("utf8").replace(/&(apos|quot|lt|gt|amp);/g, (_, e) => ENTITIES[e]).trim() || null;
  } catch { return null; }
}

// A RADIO STATION'S NAME (2026-10-03, the bar's move for the radio):
// getPlayerStatus gives the programme ("The Sam Sanders Show-…"), and
// getMetaInfo's subtitle the station as its preset is named ("KQED-FM",
// measured on the Pro Plus playing preset 10). WiiM's own radio leaves the
// subtitle "unknow" and names the station as the title ("Radio Paradise",
// the Pro Plus on 12, the same morning). Asked of a radio source only, and
// carried on the status as `meta`.
const RADIO = /tunein|radio|iheart/i;
// PANDORA NAMES NO STATION (2026-10-03, the Ultra on 11: only the song,
// "Respect", Aretha Franklin). With exactly one Pandora preset on the
// speaker, that preset is taken to be the station — the owner's choice,
// knowing a Pandora station started from an app would move as the preset's.
// Two Pandora presets, or none, and it names nothing. Each speaker's presets
// as presetsLoop last read them.
const PANDORA = /^pandora/i;
const TABLES = {};
// THE STREAM'S QUALITY (2026-10-25, the owner: "show the streaming quality
// (bitrate etc)"): getMetaInfo's sampleRate, bitDepth and bitRate, asked of
// a streaming service while it plays or is paused. Measured on the Pro Plus
// the same day, each the same all through a song: Spotify 16-bit/44.1 kHz at
// 912-1010 kbps (lossless; 320 in August), Tidal 505-916, TuneIn and Pandora
// 128, Radio Paradise 16/44.1 with a bitRate of 0. Not the archive (the
// owner: "skip it for the archive"): a CustomRadio m3u, whose getMetaInfo
// runs a song ahead (skills/wiim/SKILL.md). Not an input, AirPlay or DLNA:
// unmeasured.
const STREAMS = new Set([31, 32, 36]);
function streaming(st) {
  const mode = Number(st?.mode), vendor = String(st?.vendor ?? "");
  return STREAMS.has(mode) || (mode >= 10 && mode <= 19 && !!vendor && !/^custom/i.test(vendor));
}
const PLAYING = /^(play|load|pause)$/;
async function readSpeaker(ip) {
  const st = await status(ip);
  if (st && (RADIO.test(String(st.vendor ?? "")) || streaming(st)) && PLAYING.test(String(st.status ?? ""))) {
    st.meta = await wiim(ip, "getMetaInfo", true, 2000);
  }
  return st;
}
// The speaker's own numbers: sample rate in Hz, bit depth, kilobits a second
// (0 where the speaker does not say). The house has the words for them.
function qualityOf(st, meta) {
  if (!streaming(st) || !PLAYING.test(String(st.status ?? ""))) return null;
  const n = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };
  const rate = n(meta.sampleRate), bits = n(meta.bitDepth), kbps = n(meta.bitRate);
  return rate ? { rate, ...(bits ? { bits } : {}), kbps } : null;
}

// One speaker's getPlayerStatus, in the words the house takes.
export function readingOf(name, st, presets = null) {
  if (!st) return { name, state: "unreachable" };
  const mode = Number(st.mode);
  const vendor = String(st.vendor ?? "");
  const source = mode === 31 || /^spotify/i.test(vendor) ? "Spotify"
    : vendor && !vendor.includes(":") ? vendor.slice(0, 24)
    : MODES[mode] ?? (mode === 10 ? "Web stream" : null);
  const status = String(st.status ?? "");
  const state = mode === 0 ? "idle"
    : status === "play" || status === "load" ? "play"
    : status === "pause" ? "pause" : "stop";
  // The Spotify playlist it is on (2026-09-29): the house names the preset by
  // it when Spotify has let go of a stopped speaker and says nothing.
  const playlist = source === "Spotify" ? vendor.match(/^spotify:playlist:([A-Za-z0-9]{10,40})$/)?.[1] : null;
  const known = (v) => { const t = String(v ?? "").trim(); return t && !/^unknown?$/i.test(t) ? t : null; };
  const meta = st.meta?.metaData ?? {};
  const pandora = PANDORA.test(vendor) && Array.isArray(presets) ? presets.filter((p) => PANDORA.test(String(p?.source ?? ""))) : [];
  const station = RADIO.test(vendor)
    ? (known(meta.subtitle) ?? (/^wiimradio$/i.test(vendor) ? known(meta.title) : null))?.slice(0, 80) ?? null
    : pandora.length === 1 ? known(pandora[0].name)?.slice(0, 80) ?? null : null;
  const quality = qualityOf(st, meta);
  return { name, state, ...(source ? { source } : {}), ...(playlist ? { playlist } : {}),
    ...(station ? { station } : {}),
    ...(unhex(st.Title) ? { track: unhex(st.Title) } : {}),
    ...(unhex(st.Artist) ? { artists: unhex(st.Artist) } : {}),
    ...(quality ? { quality } : {}) };
}

// The only speaker commands this helper sends. A command from the house not
// in this list is refused without touching a speaker.
const COMMANDS = {
  pause: () => "setPlayerCmd:pause",
  resume: () => "setPlayerCmd:resume",
  // A preset key, as the remote presses it. Only a whole number 1-12.
  key: (m) => (Number.isInteger(m?.n) && m.n >= 1 && m.n <= 12 ? `MCUKeyShortClick:${m.n}` : null),
};
// A key takes a moment to start what it holds before the read-back says so.
const SETTLE_MS = { pause: 600, resume: 600, key: 3000 };

function status(ip) { return wiim(ip, "getPlayerStatus", true); }
// The read that names a WiiM and gives its fixed id; null from anything else.
export function statusEx(ip, timeout = 1500) { return wiim(ip, "getStatusEx", true, timeout); }
function wiim(ip, command, json, timeout = 4000) {
  return new Promise((resolve) => {
    const req = https.get({ host: ip, path: `/httpapi.asp?command=${command}`,
      rejectUnauthorized: false, timeout }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (!json) { resolve(body.trim() || null); return; }
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function settings() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(join(homedir(), ".config/fmwax-helper/env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* the environment alone, then */ }
  const url = (out.HOUSE_URL || "").replace(/\/+$/, "");
  // The owner's own checkout: its house.json names this house's WiiMs, for a
  // house that does not answer for them. Only when it is this house's file:
  // the ZIP every household downloads carries the owner's.
  let file = {};
  try { file = JSON.parse(readFileSync(join(HERE, "../mcp/house.json"), "utf8")); } catch { file = {}; }
  const ours = String(file.site?.baseUrl ?? "").replace(/\/+$/, "") === url;
  return { secret: out.HELPER_SECRET, url, speakers: {}, fileSpeakers: ours ? file.devices?.speakers ?? {} : {} };
}

// THE HOUSE'S WIIMS, as { name: address }, or null for none yet. The house
// says them; one that knows only their names (set up on its page) is told
// where they are, once found here. A house that does not answer: the owner's
// file, when it is this house's.
export async function houseSpeakers(cfg, { get = fetch, log = console.log, match = matchWiims,
  find = (names) => { const plan = searchPlan(names); return findWiims(plan.nets, undefined, { enough: plan.enough }); } } = {}) {
  const auth = { authorization: `Bearer ${cfg.secret}` };
  let said = null;
  try {
    const r = await get(`${cfg.url}/helper/speakers`, { headers: auth, signal: AbortSignal.timeout(10_000) });
    said = r.ok ? await r.json() : null;
  } catch { said = null; }
  if (!said) return Object.keys(cfg.fileSpeakers ?? {}).length ? { ...cfg.fileSpeakers } : null;
  cfg.learns = !!said.learns;
  if (Object.keys(said.speakers ?? {}).length) return said.speakers;
  if (!said.learns) return null;
  log(new Date().toISOString(), "finding the WiiMs on this network");
  const { speakers, unmatched, missing } = await match(said.names ?? [], await find(said.names ?? []));
  for (const f of unmatched) log(new Date().toISOString(), "found", f.name, f.ip, "- a WiiM the house does not name");
  for (const n of missing) log(new Date().toISOString(), "the house names", n, "- not found on this network");
  if (!Object.keys(speakers).length) return null;
  try {
    const r = await get(`${cfg.url}/helper/speakers`, { method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ speakers }), signal: AbortSignal.timeout(10_000) });
    const kept = r.ok ? (await r.json())?.speakers : null;
    if (kept && Object.keys(kept).length) { log(new Date().toISOString(), "the house keeps", Object.keys(kept).join(", ")); return kept; }
  } catch { /* the house is told next time */ }
  return speakers;
}

// FINDING A SPEAKER THAT MOVED. `known` is what the helper has learned of
// each speaker: { uuid, deviceName, ip }.
function loadKnown() {
  try { return JSON.parse(readFileSync(KNOWN_FILE, "utf8")) ?? {}; } catch { return {}; }
}
function saveKnown(known) {
  try { writeFileSync(KNOWN_FILE, JSON.stringify(known, null, 2) + "\n", { mode: 0o600 }); } catch { /* learned again next run */ }
}
// The addresses to ask, the last one remembered first, then every other on
// the old address's own network (its first three numbers), nearest first.
export function searchOrder(lastIp, rememberedIp = null) {
  const m = String(lastIp ?? "").match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}.`, last = Number(m[4]);
  const rest = Array.from({ length: 254 }, (_, i) => i + 1).filter((n) => n !== last)
    .sort((a, b) => Math.abs(a - last) - Math.abs(b - last)).map((n) => base + n);
  const first = rememberedIp && rememberedIp !== lastIp && rest.includes(rememberedIp) ? [rememberedIp] : [];
  return [...first, ...rest.filter((ip) => !first.includes(ip))];
}
// The address where this speaker now answers, or null. A WiiM is this
// speaker by its fixed id; with none learned yet, by its own name.
export async function findSpeaker(name, lastIp, known = {}, probe = (ip) => wiim(ip, "getStatusEx", true, 1500), batch = 32) {
  const want = known[name] ?? {};
  const order = searchOrder(lastIp, want.ip);
  const same = (st) => !!st && (want.uuid ? st.uuid === want.uuid
    : String(st.DeviceName ?? "").trim().toLowerCase() === String(want.deviceName ?? name).trim().toLowerCase());
  for (let i = 0; i < order.length; i += batch) {
    const slice = order.slice(i, i + batch);
    const got = await Promise.all(slice.map(async (ip) => (same(await probe(ip)) ? ip : null)));
    const hit = got.find(Boolean);
    if (hit) return hit;
  }
  return null;
}
// FINDING THE WIIMS THE FIRST TIME (MC-31 stage 5, 2026-10-19: a forum
// household's helper is told no addresses). Every address on the home
// network is asked getStatusEx, the read that names a WiiM and gives its
// fixed id; a WiiM (or another LinkPlay speaker) answers it, nothing else
// does. The home network is the computer's own: its private address's first
// three numbers. A Chromebook's Linux sits behind ChromeOS's own small
// network (100.115.92.x) and has no such address, so there the networks home
// routers hand out by default are tried in turn until one has WiiMs on it.
export const HOME_NETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.4", "192.168.86", "192.168.68", "10.0.1",
  "192.168.50", "192.168.2", "192.168.178", "192.168.31", "192.168.10", "192.168.100", "192.168.88", "10.1.1",
  "192.168.3", "192.168.8", "192.168.15"];
const PRIVATE = /^(10\.\d+\.\d+|192\.168\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)\.\d+$/;
export function ownNets(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces ?? {}).flat()
    .filter((a) => a && (a.family === "IPv4" || a.family === 4) && !a.internal && PRIVATE.test(a.address))
    .map((a) => a.address.replace(/\.\d+$/, "")))];
}
export function homeNets(interfaces = networkInterfaces()) {
  const own = ownNets(interfaces);
  return own.length ? own : HOME_NETS;
}
// Where to look, and when to stop (Codex, 2026-10-19: not at the first
// network with any WiiM, which may not be the house's). The computer's own
// networks: every one, they are few. Guessed ones: until as many WiiMs are
// found as the house names, or any when it names none.
export function searchPlan(names = [], interfaces = networkInterfaces()) {
  const own = ownNets(interfaces);
  if (own.length) return { nets: own, guessed: false, enough: () => false };
  return { nets: HOME_NETS, guessed: true, enough: (found) => found.length >= Math.max(1, names.length) };
}
// Every WiiM on `nets` (each its first three numbers: all 254 addresses), as
// { ip, uuid, name }, one per WiiM; `enough(found)` ends the search after a
// network.
export async function findWiims(nets = homeNets(), probe = (ip) => statusEx(ip),
  { batch = 64, onNet = () => {}, enough = () => false } = {}) {
  const found = [];
  for (const net of nets) {
    onNet(net);
    const ips = Array.from({ length: 254 }, (_, i) => `${net}.${i + 1}`);
    for (let i = 0; i < ips.length; i += batch) {
      const got = await Promise.all(ips.slice(i, i + batch).map(async (ip) => {
        const st = await probe(ip);
        return st?.uuid ? { ip, uuid: String(st.uuid), name: String(st.DeviceName ?? "").trim() || ip } : null;
      }));
      // One WiiM on two networks (wired and Wi-Fi) is one WiiM.
      for (const f of got) if (f && !found.some((x) => x.uuid === f.uuid)) found.push(f);
    }
    if (found.length && enough(found)) break;
  }
  return found;
}
// The house's WiiMs, by the names it knows them by, matched to the ones found
// by each WiiM's own name, the one WiiM Home shows and Spotify is told. A
// house that names none takes every one found, by its own name.
export function matchWiims(names, found) {
  const key = (s) => String(s ?? "").trim().toLowerCase();
  const speakers = {}, used = new Set();
  for (const n of names ?? []) {
    const hit = found.find((f) => !used.has(f.ip) && key(f.name) === key(n));
    if (hit) { speakers[n] = hit.ip; used.add(hit.ip); }
  }
  if (!names?.length) for (const f of found) { speakers[f.name] = f.ip; used.add(f.ip); }
  return { speakers, unmatched: found.filter((f) => !used.has(f.ip)), missing: (names ?? []).filter((n) => !speakers[n]) };
}

const MISSES = {}, LAST_SEARCH = {}, SEARCHING = new Set();
// After each read: learn a speaker's id the first time it answers, and look
// for one that has stopped answering. `cfg.speakers` is changed in place, so
// the reads, the preset tables and the commands all follow a move.
async function keepTrack(cfg, name, answered) {
  const known = cfg.known ?? (cfg.known = loadKnown());
  const ip = cfg.speakers[name];
  if (answered) {
    MISSES[name] = 0;
    if (!known[name]?.uuid || known[name].ip !== ip) {
      const st = await wiim(ip, "getStatusEx", true, 2000);
      if (st?.uuid) { known[name] = { uuid: st.uuid, deviceName: st.DeviceName ?? name, ip }; saveKnown(known); }
    }
    return;
  }
  MISSES[name] = (MISSES[name] ?? 0) + 1;
  if (MISSES[name] < MISSES_BEFORE_SEARCH || SEARCHING.has(name)) return;
  if (Date.now() - (LAST_SEARCH[name] ?? 0) < SEARCH_AT_MOST_MS) return;
  LAST_SEARCH[name] = Date.now();
  SEARCHING.add(name);
  try {
    const now = await findSpeaker(name, ip, known);
    if (now && now !== ip) {
      cfg.speakers[name] = now;
      known[name] = { ...(known[name] ?? {}), ip: now };
      saveKnown(known);
      MISSES[name] = 0;
      console.log(new Date().toISOString(), "moved", name, ip, "->", now,
        cfg.learns ? "(the house is told)" : "(the helper follows it; mcp/house.json still says the old address)");
      // A house that learned its WiiMs from the helper learns the new address.
      if (cfg.learns) {
        fetch(`${cfg.url}/helper/speakers`, { method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "application/json" },
          body: JSON.stringify({ speakers: cfg.speakers }) }).catch(() => { /* told after the next move */ });
      }
    } else {
      console.error(new Date().toISOString(), "looked for", name, "and it is not on", ip.replace(/\.\d+$/, ".*"), "- off, or asleep");
    }
  } finally { SEARCHING.delete(name); }
}

async function readAll(speakers, cfg = null) {
  return Promise.all(Object.entries(speakers).map(async ([name, ip]) => {
    const st = await readSpeaker(ip);
    if (cfg) keepTrack(cfg, name, !!st).catch(() => { /* tried again on the next read */ });
    return readingOf(name, st, TABLES[name]);
  }));
}

// TAKING ITSELF AWAY (the owner, 2026-10-21: "an easy button for removing
// the helper"). Only a helper the install made can: its record and its
// remover sit in the folder above this file (install/helper.js). One set up
// by hand, as the owner's on the Chromebook, answers so and stays. The
// remover runs in this process, last of all stopping it; until then nothing
// more is posted and no line is opened again.
let LEAVING = false;
export function removerBeside(script = fileURLToPath(import.meta.url)) {
  const app = dirname(dirname(script));
  return existsSync(join(app, "installed.json")) && existsSync(join(app, "remove.mjs")) ? join(app, "remove.mjs") : null;
}
async function leave(remover) {
  LEAVING = true;
  process.argv.push("--remove", "--self");
  await import(pathToFileURL(remover).href);
}

async function post(cfg, readings) {
  if (LEAVING) return false;
  const r = await fetch(`${cfg.url}/helper/reading`, { method: "POST",
    headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ speakers: readings }), signal: AbortSignal.timeout(10_000) });
  return r.ok;
}

// A command from the house: the allow-list, a speaker this house names,
// then the speaker's own read-back for the answer.
export async function obey(speakers, m, send = wiim, read = readSpeaker) {
  const ip = speakers[m?.speaker];
  const cmd = Object.hasOwn(COMMANDS, m?.cmd) ? COMMANDS[m.cmd](m) : null;
  if (!ip || !cmd) return { id: m?.id, ok: false, code: "refused" };
  const said = await send(ip, cmd, false);
  if (said !== "OK") return { id: m.id, ok: false, code: said == null ? "unreachable" : "failed" };
  await new Promise((r) => setTimeout(r, SETTLE_MS[m.cmd] ?? 600));
  return { id: m.id, ok: true, reading: readingOf(m.speaker, await read(ip), TABLES[m.speaker]) };
}

// The line to the house: reconnects on its own, pings every 30 s (the house
// answers "pong" without waking), and gives up on a line that goes quiet.
export function line(cfg, WS = WebSocket, get = fetch) {
  const url = cfg.url.replace(/^http/, "ws") + "/helper/socket";
  // ONE LINE, EVER (2026-10-11, 22:27): a second one beside it and the house,
  // which keeps one, closes each in turn as the other opens, and both reopen.
  // So a line's close reopens only while it is still the line, and an open
  // cancels a reopen already set.
  let ws = null, lastPong = 0, wait = 2000, opened = 0, retry = null;
  const open = () => {
    clearTimeout(retry); retry = null;
    if (LEAVING) return;
    opened = Date.now();
    const s = ws = new WS(url, { headers: { authorization: `Bearer ${cfg.secret}` } });
    s.onopen = () => { wait = 2000; lastPong = Date.now(); console.log(new Date().toISOString(), "line open"); };
    s.onmessage = async (ev) => {
      const text = String(ev.data);
      if (text === "pong") { lastPong = Date.now(); return; }
      let m = null;
      try { m = JSON.parse(text); } catch { return; }
      if (m?.cmd === "remove") {
        const remover = removerBeside();
        try { ws.send(JSON.stringify({ id: m.id, ok: !!remover, code: remover ? "removing" : "not-installed" })); } catch { /* the house times out */ }
        console.log(new Date().toISOString(), "remove", remover ? "asked: taking itself away" : "refused: not set up by the install");
        if (remover) setTimeout(() => leave(remover).catch((e) => console.error(new Date().toISOString(), "remove failed:", String(e?.message ?? e))), 500);
        return;
      }
      const reply = await obey(cfg.speakers, m).catch(() => ({ id: m?.id, ok: false, code: "failed" }));
      try { ws.send(JSON.stringify(reply)); } catch { /* the line went; the house times out */ }
      console.log(new Date().toISOString(), m?.cmd, m?.speaker, reply.ok ? "ok" : reply.code);
    };
    // WHY IT CLOSED (2026-10-13): the line reopens about once an hour awake,
    // and the log said only "line open". 1006 is the network, 1001 the house
    // going away, "replaced" a second line.
    s.onclose = (ev) => {
      if (ws !== s || LEAVING) return;
      console.log(new Date().toISOString(), "line closed", ev?.code ?? "?", ev?.reason || "-",
        `after ${Math.round((Date.now() - opened) / 60_000)} min`);
      ws = null; retry = setTimeout(open, wait); wait = Math.min(wait * 2, 60_000);
    };
    s.onerror = () => { /* onclose follows */ };
  };
  open();
  // THE WATCHDOG (2026-09-24, 22:30: after a deploy the line died without a
  // close event, sat half-closed, and the helper went on believing it was
  // connected while the house said "helper off"). A line that has not been
  // answered for 75 s, or is stuck anywhere but open, is dropped and a new
  // one opened here — not left to an onclose that may never come.
  const renew = (why) => {
    console.error(new Date().toISOString(), "line", why, "- reopening");
    const old = ws; ws = null;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch { /* gone */ } }
    open();
  };
  setInterval(() => {
    if (!ws) return;                     // onclose has a reopen scheduled
    if (ws.readyState === 0 && Date.now() - opened > 30_000) return renew("stuck connecting");
    if (ws.readyState !== 1) { if (Date.now() - opened > 30_000) renew("not open"); return; }
    if (Date.now() - lastPong > 75_000) return renew("unanswered");
    try { ws.send("ping"); } catch { renew("send failed"); }
  }, 30_000);
  // And the house's own word, once a minute: a line it does not see is no
  // line, however open this end thinks it is.
  // The answer is about the line it asked after: if that one closed while the
  // house was answering, its own reopen is set, and a renew would be a second.
  setInterval(async () => {
    const asked = ws;
    if (!asked || asked.readyState !== 1 || Date.now() - opened < 20_000) return;
    try {
      const r = await get(`${cfg.url}/helper/status`, { headers: { authorization: `Bearer ${cfg.secret}` },
        signal: AbortSignal.timeout(10_000) });
      if (r.ok && (await r.json()).hands === false && ws === asked) renew("not seen by the house");
    } catch { /* the house unreachable: the socket's own checks decide */ }
  }, 60_000);
}

// WHERE IT WRITES (MC-31 stage 5): a computer with no journal (a Mac's
// LaunchAgent has its own log; Windows' hidden start has none) gives
// `--log <file>`, kept under a megabyte by moving the old one aside.
function logTo(file) {
  try { if (statSync(file).size > 1_000_000) renameSync(file, `${file}.old`); } catch { /* a new file */ }
  const write = (...a) => { try { appendFileSync(file, `${a.map(String).join(" ")}\n`); } catch { /* nowhere to say it */ } };
  console.log = write;
  console.error = write;
}
// The house's address: https, or this computer itself for a house run here
// to try it (wrangler dev).
export const houseUrlOk = (u) => /^https:\/\/[^/\s]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);

async function main() {
  const logAt = process.argv.indexOf("--log");
  if (logAt > 0 && process.argv[logAt + 1]) logTo(process.argv[logAt + 1]);
  // Which WiiMs are on this network, and nothing else: no house, no secret.
  if (process.argv.includes("--find")) {
    const t0 = Date.now();
    const plan = searchPlan();
    const found = await findWiims(plan.nets, undefined, { enough: plan.enough, onNet: (net) => console.log(`asking ${net}.1 to ${net}.254…`) });
    for (const f of found) console.log(`  ${f.name}  ${f.ip}  (${f.uuid})`);
    console.log(found.length ? `${found.length} found in ${Math.round((Date.now() - t0) / 1000)} s` : "no WiiM found");
    return;
  }
  const cfg = settings();
  if (!cfg.secret) { console.error("No HELPER_SECRET in ~/.config/fmwax-helper/env"); process.exit(2); }
  // NO DEFAULT HOUSE (2026-09-27): it used to fall back to the author's own
  // house, so another household's helper missing this line would have sent
  // its secret to that house's address.
  if (!houseUrlOk(cfg.url)) { console.error("No HOUSE_URL (https://…) in ~/.config/fmwax-helper/env"); process.exit(2); }
  // Its WiiMs, from the house: until there are some, asked again each minute.
  for (;;) {
    const s = await houseSpeakers(cfg).catch(() => null);
    if (s && Object.keys(s).length) { cfg.speakers = s; break; }
    console.error(new Date().toISOString(), "no WiiMs to read yet; asking again in a minute");
    await new Promise((r) => setTimeout(r, 60_000));
  }
  console.log(new Date().toISOString(), "reading", Object.entries(cfg.speakers).map(([n, ip]) => `${n} (${ip})`).join(", "));
  if (process.argv.includes("--once")) {
    // The tables first, as the running helper has them, so a Pandora station is named.
    for (const [name, ip] of Object.entries(cfg.speakers)) {
      const table = await keyMapping(ip);
      try { if (table) TABLES[name] = readingFrom(table); } catch { /* none, then */ }
    }
    const readings = await readAll(cfg.speakers);
    console.log(JSON.stringify(readings, null, 2));
    console.log((await post(cfg, readings)) ? "posted" : "the house refused it");
    return;
  }
  line(cfg);
  presetsLoop(cfg);
  let sent = "", sentAt = 0;
  for (;;) {
    try {
      const readings = await readAll(cfg.speakers, cfg);
      const said = JSON.stringify(readings);
      if (said !== sent || Date.now() - sentAt >= POST_AT_LEAST_MS) {
        if (await post(cfg, readings)) { sent = said; sentAt = Date.now(); }
      }
    } catch (e) {
      console.error(new Date().toISOString(), String(e?.message ?? e));
    }
    await new Promise((r) => setTimeout(r, READ_EVERY_MS));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
