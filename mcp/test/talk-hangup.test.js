// HANG UP FINISHES WHAT IS ON ITS WAY (2026-11-05). The owner asked Talk for a
// Pub Rock set, heard "Pub Rock's on it, starting on the Ultra" and hung up 30
// seconds in; the house never got the ask. On the next try the backend first
// asked get_dj for "DJ Pup Rock" (refused), then filed ask_dj at 31 seconds.
// The page now holds a hang-up while the backend or a tool is working, until
// the work is in (thirty seconds at most), and says the ask's own line.
//
// These run the Talk page's own script, in a small fake of the browser: the
// line, the data channel, the doors, and a clock the test moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { renderTalk } from "../programs.js";

const SAID = "Pub Rock's on it: an hour, starting on the Ultra in about five minutes, unless something else is started before then. " +
  "It goes on preset 1, in place of the set there. You can hang up.";

function page({ window: win = { addEventListener() {} }, data = {} } = {}) {
  const html = renderTalk({ base: "/buttons/k", devices: ["Pro Plus", "Ultra"], defaultDevice: "Ultra",
    asks: [{ btn: 1, label: "Spotify" }] });
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    .find((s) => s.includes('document.querySelector("main.talk")'));
  assert.ok(script, "the Talk script");

  // The clock and the timers, moved by the test.
  const clock = { t: 1_000_000 };
  let timers = [], tid = 0;
  const at = (fn, ms, every) => { const id = ++tid; timers.push({ id, due: clock.t + (Number(ms) || 0), fn, every }); return id; };
  const cancel = (id) => { timers = timers.filter((x) => x.id !== id); };
  async function advance(ms) {
    const end = clock.t + ms;
    for (;;) {
      const next = timers.filter((x) => x.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      clock.t = next.due;
      if (next.every) next.due += next.every; else cancel(next.id);
      next.fn();
      await settle();
    }
    clock.t = end;
  }

  // The elements the script reads by id, and the main block's settings.
  const els = {};
  const el = (id) => els[id] ?? (els[id] = {
    id, textContent: id === "hangup" ? "Hang up" : "", hidden: id === "hangup", innerHTML: "", value: "Ultra", listeners: {},
    classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    getAttribute: () => null, closest: () => null, setPointerCapture() {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
  });
  const attrs = { "data-base": "/buttons/k", "data-idle": "30000", "data-beat": "30000", "data-rate": "5", ...data };
  const main = { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } };
  const docListeners = {};
  const document = {
    hidden: false, cookie: "",
    querySelector: (q) => (q === "main.talk" ? main : null),
    getElementById: el,
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    dispatchEvent() {},
  };

  // The line: one peer connection and its data channel; what the page sends on it is kept.
  const sent = [];
  const dc = { readyState: "open", send: (s) => sent.push(JSON.parse(s)), onmessage: null, onclose: null, onerror: null };
  class RTCPeerConnection {
    constructor() { this.iceGatheringState = "complete"; this.localDescription = { sdp: "offer" }; }
    addTrack() {} createDataChannel() { return dc; } async createOffer() { return { sdp: "offer" }; }
    async setLocalDescription() {} async setRemoteDescription() {} addEventListener() {} close() {}
  }
  const track = { enabled: false, stop() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };

  // The doors. A tool call waits until the test answers it.
  const calls = [], tools = [];
  async function fetch(url, init = {}) {
    const path = String(url).replace("/buttons/k", "");
    calls.push({ path, body: init.body });
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (path === "/talk/session") return reply(201, { cap: "cap1", sdp: "answer", used: 0, cap_minutes: 60 });
    if (path === "/talk/tool") {
      return new Promise((resolve) => tools.push({ name: JSON.parse(init.body).name, answer: (body) => resolve(reply(200, body)) }));
    }
    return reply(200, { ok: true, used: 1, cap_minutes: 60, remaining: 59 });
  }

  vm.runInNewContext(script, {
    document, window: win, navigator: { mediaDevices: { getUserMedia: async () => stream }, sendBeacon: () => true },
    RTCPeerConnection, fetch, CustomEvent: class { constructor(t) { this.type = t; } }, Blob: class {},
    setTimeout: at, clearTimeout: cancel, setInterval: (fn, ms) => at(fn, ms, ms), clearInterval: cancel,
    Date: { now: () => clock.t }, console,
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const event = async (ev) => { dc.onmessage({ data: JSON.stringify(ev) }); await settle(); };
  const backend = (type, extra = {}) => event({ type: "response.event", delegation_id: "d1", event: { type, ...extra } });
  const callFor = (name) => backend("response.output_item.done",
    { item: { type: "function_call", name, call_id: `c_${name}`, arguments: "{}" } });
  const fire = async (id, type) => { for (const fn of el(id).listeners[type] ?? []) fn({ preventDefault() {}, pointerId: null }); await settle(); };

  return {
    clock, advance, sent, calls, tools, el, event, backend, callFor, settle, phase: () => attrs["data-phase"],
    async start() {
      await fire("hold", "pointerdown");
      await fire("hold", "pointerup");
      await event({ type: "session.started" });
    },
    hangUp: () => fire("hangup", "click"),
    async seen(shown) { document.hidden = !shown; for (const fn of docListeners.visibilitychange ?? []) fn(); await settle(); },
    talk: () => fire("hold", "pointerdown"),
    closed: () => calls.some((c) => c.path === "/talk/closed") || sent.some((m) => m.type === "session.close"),
    state: () => el("tstate").textContent,
  };
}

test("a hang-up while the ask is on its way waits for it, through a refused name and the ask after it, then hangs up with its line", async () => {
  const p = page();
  await p.start();
  // The backend looks the misheard name up first, and the person hangs up while it does.
  await p.backend("response.created");
  await p.callFor("get_dj");
  await p.backend("response.completed");
  await p.hangUp();
  assert.equal(p.closed(), false, "not closed: the backend is still working");
  assert.equal(p.state(), "Finishing what you asked, then hanging up…");
  assert.equal(p.el("hangup").textContent, "Hang up now");
  // get_dj answers with its refusal: the outputs go back, the backend goes on, the line stays.
  p.tools.shift().answer({ error: 'no DJ called "DJ Pup Rock".' });
  await p.settle();
  assert.equal(p.closed(), false, "the continuation is coming");
  assert.ok(p.sent.some((m) => m.type === "response.create"));
  // The second step: the ask itself.
  await p.backend("response.created");
  await p.callFor("ask_dj");
  await p.backend("response.completed");
  assert.equal(p.closed(), false, "the ask is in flight");
  p.tools.shift().answer({ output: JSON.stringify({ status: "sent", dj: "Pub Rock", preset: 1, said: SAID }) });
  await p.settle();
  assert.equal(p.closed(), false, "the backend says it next");
  await p.backend("response.created");
  await p.backend("response.completed");
  // Now nothing is in flight: the line closes, and the ask went in before it did.
  assert.equal(p.closed(), true);
  const toolAt = p.calls.findLastIndex((c) => c.path === "/talk/tool");
  assert.ok(toolAt < p.calls.findIndex((c) => c.path === "/talk/closed"), "the ask before the hang-up");
  await p.advance(2600);
  assert.equal(p.state(), "Pub Rock's on it: an hour, starting on the Ultra in about five minutes, unless something else is " +
    "started before then. It goes on preset 1, in place of the set there. Hung up.");
  assert.equal(p.el("hangup").textContent, "Hang up", "the button's own name again");
});

test("with nothing in flight Hang up hangs up at once, and a second press during the wait does too", async () => {
  const quiet = page();
  await quiet.start();
  await quiet.hangUp();
  assert.equal(quiet.closed(), true, "nothing to wait for");
  await quiet.advance(2600);
  assert.equal(quiet.state(), "Hung up.");

  const twice = page();
  await twice.start();
  await twice.backend("response.created");
  await twice.hangUp();
  assert.equal(twice.closed(), false);
  await twice.hangUp();
  assert.equal(twice.closed(), true, "Hang up now means now");
});

test("the wait is thirty seconds at most, and holding the button to talk again ends it", async () => {
  const p = page();
  await p.start();
  await p.backend("response.created");
  await p.callFor("ask_dj");
  await p.hangUp();
  await p.advance(29_000);
  assert.equal(p.closed(), false);
  await p.advance(2_000);
  assert.equal(p.closed(), true, "a tool that never answers does not hold the line open");

  const back = page();
  await back.start();
  await back.backend("response.created");
  await back.hangUp();
  await back.talk();
  assert.equal(back.el("hangup").textContent, "Hang up", "talking again is not hanging up");
  await back.backend("response.completed");
  assert.equal(back.closed(), false, "the wait is over: nothing hangs up when the work ends");
});

// TALK ON THE TV (2026-11-19): in the fmwax TV app the page tells the app a
// line opened and closed, so the room's receiver plays the TV's sound only
// while Talk is on. In a browser there is no fmwaxTV, and nothing happens.
test("in the TV app the page tells the app when a line opens and when it closes", async () => {
  const said = [];
  const p = page({ window: { addEventListener() {}, fmwaxTV: { sound: () => true, talk: (on) => said.push(on) } } });
  await p.start();
  assert.deepEqual(said.filter((x) => x === true), [true], "on once the line is live");
  await p.hangUp();
  await p.advance(2600);
  assert.equal(said.at(-1), false, "off when it closes");
  const html = renderTalk({ base: "/buttons/k", devices: ["Pro Plus"], defaultDevice: "Pro Plus" });
  assert.match(html, /<p class="vsum tvsound" hidden>On this TV the music goes quiet while you talk, and comes back when you hang up\.<\/p>/);
  const plain = page();
  await plain.start();
  await plain.hangUp();
  assert.equal(plain.closed(), true, "a browser without the app: Talk as before");
});

// OFF THE SCREEN AND BACK (Codex, 2026-11-19, before the app's download):
// the app tells the page it is hidden and puts the receiver back; a line
// still open when the page is shown again asks for TV again, a closed one not.
test("in the TV app a line still open when the page is shown again asks for TV again; a line that closed does not", async () => {
  const said = [];
  const p = page({ window: { addEventListener() {}, fmwaxTV: { sound: () => true, talk: (on) => said.push(on) } } });
  await p.start();
  assert.deepEqual(said, [true]);
  // The desk is busy, so hidden does not close at once.
  await p.backend("response.created");
  await p.seen(false);
  assert.equal(p.closed(), false, "busy: not closed yet");
  await p.seen(true);
  assert.deepEqual(said, [true, true], "shown again with the line open: TV again");
  await p.backend("response.completed");
  await p.seen(false);
  await p.advance(2600);
  assert.equal(p.closed(), true, "hidden and not busy: closed");
  assert.equal(said.at(-1), false);
  const n = said.length;
  await p.seen(true);
  assert.equal(said.length, n, "shown again after it closed: nothing asked");
});

// GUIDE HELD TO TALK (MC-48): the TV app hands the remote's Guide key to
// window.fmwaxGuide, down and up; it is the hold's own press and release.
test("Guide held in the TV app is the hold: down opens the line, up lets go", async () => {
  const keys = [];
  const win = { addEventListener() {}, fmwaxTV: { sound: () => true, talk() {}, talkKeys: (on) => keys.push(on) } };
  const p = page({ window: win });
  assert.deepEqual(keys, [true], "the page says it takes Guide");
  win.fmwaxGuide(true);
  await p.settle();
  assert.ok(p.calls.some((c) => c.path === "/talk/session"), "the first press opens the line");
  win.fmwaxGuide(false);
  await p.settle();
  await p.event({ type: "session.started" });
  win.fmwaxGuide(true);
  await p.settle();
  assert.ok(p.sent.some((m) => m.type === "session.input_audio.unmute"), "a press on an open line unmutes");
  win.fmwaxGuide(false);
  await p.settle();
  assert.ok(p.sent.some((m) => m.type === "session.input_audio.mute"), "the release mutes");
});

// THE TV OPENS THE LINE WITH THE SCREEN, AND THE BUTTON SAYS THE PHASE (MC-48,
// measured 2026-11-19: press to listening 2.1 s on a new line, 0.05 s on an
// open one).
test("on the TV the line opens with the screen, muted, and the phase goes opening, ready, listening, thinking", async () => {
  const p = page({ data: { "data-preopen": "1" } });
  await p.settle();
  assert.ok(p.calls.some((c) => c.path === "/talk/session"), "opened with no press");
  assert.equal(p.phase(), "opening");
  await p.event({ type: "session.started" });
  assert.ok(p.sent.some((m) => m.type === "session.input_audio.mute"), "muted: nobody is holding");
  assert.equal(p.phase(), "ready");
  await p.talk();
  assert.equal(p.phase(), "opening", "asked to unmute: not yet");
  await p.event({ type: "session.input_audio.unmuted" });
  assert.equal(p.phase(), "listening");
  const phone = page();
  await phone.settle();
  assert.ok(!phone.calls.some((c) => c.path === "/talk/session"), "the phone opens on the first press, as before");
});

// MUSIC STARTED IN THIS ROOM HANGS UP AFTER THE ANSWER (the owner,
// 2026-11-19): on the TV the receiver was on Talk's sound until 30 seconds
// after the desk's last word, so music asked for "right away" was heard late.
async function musicCall(startedOn, { tv = true, room = "Pro Plus" } = {}) {
  const p = page({ window: { addEventListener() {}, ...(tv ? { fmwaxTV: { sound: () => true, talk() {} } } : {}) },
    data: room ? { "data-room": room } : {} });
  await p.start();
  await p.backend("response.created");
  await p.callFor("play_endless");
  await p.backend("response.completed");
  p.tools[0].answer({ output: JSON.stringify({ status: "own-preset" }), ...(startedOn ? { started: startedOn } : {}) });
  await p.settle();
  // The backend says it: the continuation's own response.
  await p.backend("response.created");
  await p.backend("response.completed");
  await p.event({ type: "session.output_transcript.delta", delta: "Hank's on." });
  await p.event({ type: "session.output_transcript.done" });
  return p;
}
test("on the TV, music started in the TV's own room: the line hangs up a moment after the desk's answer", async () => {
  const p = await musicCall("Pro Plus");
  await p.advance(1000);
  assert.equal(p.closed(), false, "the desk's last words play out first");
  await p.advance(2000);
  assert.equal(p.closed(), true, "then it hangs up, and the receiver goes back to the music");
});
test("music started in another room, on the phone, or nothing started: the line stays for its usual quiet time", async () => {
  for (const [why, p] of [["another room", await musicCall("Ultra")], ["the phone", await musicCall("Pro Plus", { tv: false })],
    ["no room on the page", await musicCall("Pro Plus", { room: null })], ["nothing started", await musicCall(null)]]) {
    await p.advance(5000);
    assert.equal(p.closed(), false, why);
    await p.advance(30000);
    assert.equal(p.closed(), true, `${why}: after the quiet time, as before`);
  }
});
