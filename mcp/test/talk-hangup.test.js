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

function page() {
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
  const main = { getAttribute: (k) => ({ "data-base": "/buttons/k", "data-idle": "30000", "data-beat": "30000", "data-rate": "5" })[k] ?? null };
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
    document, window: { addEventListener() {} }, navigator: { mediaDevices: { getUserMedia: async () => stream }, sendBeacon: () => true },
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
    clock, advance, sent, calls, tools, el, event, backend, callFor, settle,
    async start() {
      await fire("hold", "pointerdown");
      await fire("hold", "pointerup");
      await event({ type: "session.started" });
    },
    hangUp: () => fire("hangup", "click"),
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
