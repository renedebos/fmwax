// THE SETUP CHECKLIST (MC-31 stage 6, first part, 2026-10-16; the canvas
// "Setup checklist", approved by the owner): the setup page, for the owner,
// lists the steps of a house's setup and ticks each one by looking at the
// house itself. Nobody ticks a box. This first part only reads; the actions
// a new house needs on each step come step by step after it.
//
// A row is { title, state, detail, href?, label? }. state: "done", "due" (done, but
// something wants doing: a sign-in near its end, a preset to save again),
// "todo", or "unknown" (the house cannot see it from here).
import { talkMinutes } from "./voice.js";
import { endlessLoad, endlessPresets, endlessSlots, endlessOwed, parseEndless, waiting as presetsWait } from "./endless.js";
import { atWords, findDj, houseClockWords, liveGuests } from "./house.js";
import { EXTRAS, EXTRA_TALK_TITLE, LEVELS, levelWords, nextStep } from "./levels.js";
import { STARTER_DJS } from "./starters.js";
import { parseSpeakers, readReadings } from "./room.js";
import { CURATOR_QUIET_MS, CURATOR_SEEN_KEY, programsKV, spotifyLogin } from "./services.js";
import { station } from "./station.js";
import { LIMIT_HINT, waitingWords, workWaiting } from "./waiting.js";
import { curatorKind, hourlySeen, workSubscriptions } from "./curator-events.js";
import { readSeen } from "./settings.js";
import { sameName } from "./programs.js";
import { helperSaw } from "./setup-watch.js";
import { updateFacts } from "./updates.js";

const when = (env, iso) => atWords(houseClockWords(env, iso)) ?? "at a time not known";
function dateWords(env, ms) {
  try {
    return new Date(ms).toLocaleDateString("en-US", { timeZone: env.HOUSE_TZ || "UTC", year: "numeric", month: "short", day: "numeric" });
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}
function zoneWords(tz) {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date());
    return p.find((x) => x.type === "timeZoneName")?.value ?? tz;
  } catch { return tz; }
}
export function zoneValid(tz) {
  try { return typeof tz === "string" && !!tz && !!new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return false; }
}
const listWords = (xs) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// Which speakers, by the home helper's last reading, hold `btn` as the house
// saved it: the service, and the name where one is given. null when no
// speaker has a reading (no helper): the house cannot see the remote.
function savedOn(boxes, recs, btn, service, name = null) {
  const read = boxes.filter((b) => recs[b.slug]);
  if (!read.length) return null;
  const ok = (b) => {
    const row = recs[b.slug].presets.find((r) => r.btn === btn);
    return !!row && String(row.source ?? "").toLowerCase().startsWith(service.toLowerCase()) &&
      (name == null || sameName(row.name, name));
  };
  return { saved: read.filter(ok).map((b) => b.name), missing: read.filter((b) => !ok(b)).map((b) => b.name),
    unread: boxes.filter((b) => !recs[b.slug]).map((b) => b.name) };
}
// A speaker the helper has not read is not counted as saved (Codex,
// 2026-10-17: one read and one not had read as done).
const unreadWords = (names) => names.length ? ` · ${listWords(names)} not read yet` : "";

export async function setupChecklist(env, owner, { base = null, origin = null, now = Date.now() } = {}) {
  const boxes = parseSpeakers(env);
  const cfg = parseEndless(env);
  const [login, seen, curatorAt, hands, recs, state, waiting, subs, hourly] = await Promise.all([
    spotifyLogin(env, now).catch(() => ({})),
    readSeen(env),
    programsKV(env).get(CURATOR_SEEN_KEY, { type: "json" }).then((r) => Number(r?.at) || null).catch(() => null),
    env.HELPER_SECRET ? station(env, "helper-get", {}).catch(() => null) : null,
    boxes.length ? readReadings(env, boxes).catch(() => ({})) : {},
    cfg ? endlessLoad(env).catch(() => null) : null,
    workWaiting(env, now).catch(() => null),
    workSubscriptions(env).catch(() => null),
    curatorKind(env) === "chatgpt" ? hourlySeen(env, now) : null,
  ]);

  // CORE
  const core = [];
  core.push({ title: "Claimed", state: "done", detail: `Yours since ${dateWords(env, Date.parse(owner.claimed_at))}` });
  const spotifyPage = base ? `${base}/spotify` : null;
  // From the checklist, straight to Spotify's page and back to the checklist.
  const signIn = base ? `${base}/spotify/connect?from=setup` : null;
  // The Spotify app comes first: without its Client ID nothing can sign in.
  // Its page stays a link from the sign-in rows (Codex, 2026-10-17: a wrong
  // Client ID otherwise sent the owner round the same refused sign-in).
  const SPOTIFY_APP = { href: "/setup/spotify-app", label: "The Spotify app's details" };
  core.push(!env.SPOTIFY_CLIENT_ID
    ? { title: "Spotify", state: "todo", detail: "First, the house's Spotify app: make one in Spotify's dashboard, then give the house its Client ID",
      href: "/setup/spotify-app", label: "Set up the Spotify app" }
    : login.unread
    ? { title: "Spotify", state: "unknown", detail: "The house could not read its Spotify sign-in just now" }
    : !login.present
    ? { title: "Spotify", state: "todo", detail: "Not signed in to Spotify yet. If Spotify refuses the app or its return address, check the Spotify app's details",
      href: signIn, label: "Sign in to Spotify", also: SPOTIFY_APP }
    : login.out
    ? { title: "Spotify", state: "todo", detail: "Spotify signed the house out: reconnect it", href: signIn, label: "Reconnect Spotify", also: SPOTIFY_APP }
    : login.signedInAt
      // WAY BACK FROM A DONE STEP (the owner's second run, 2026-10-17: "we
      // can move forward in the checklist but not backwards").
      ? { title: "Spotify", state: login.due ? "due" : "done", href: spotifyPage, label: login.due ? "Reconnect Spotify" : "Open", always: true,
        detail: `Signed in${login.account?.name ? ` as ${login.account.name}` : ""} · ends ${dateWords(env, login.ends)}, ` +
          `${login.daysLeft} ${login.daysLeft === 1 ? "day" : "days"} from now${login.due ? ": reconnect before then" : ""}` }
      : { title: "Spotify", state: "due", href: spotifyPage, label: "Reconnect Spotify",
        detail: "Signed in, but the house does not know since when: reconnect once, and it will" });
  // Chosen on the page since stage 6's first action (2026-10-17): a link on
  // the row whether or not it is done.
  // Found through Spotify on a new house (the forum road, 2026-10-17), then
  // one chosen as the default.
  let rooms = [];
  try { rooms = env.ROOM_DEVICES ? JSON.parse(env.ROOM_DEVICES) : []; } catch { rooms = []; }
  rooms = Array.isArray(rooms) ? rooms : [];
  core.push(env.DEFAULT_DEVICE
    ? { title: "Speakers", state: "done", href: "/setup/speaker", label: "Change", always: true,
      detail: `${env.DEFAULT_DEVICE} is the default${rooms.length > 1 ? ` · ${rooms.length} speakers on the list` : ""}` }
    : rooms.length
    ? { title: "Speakers", state: "todo", href: "/setup/speaker", label: "Choose the default speaker",
      detail: `${rooms.length === 1 ? "One speaker" : `${rooms.length} speakers`} on the list, no default yet` }
    : { title: "Speakers", state: "todo", href: "/setup/speaker?find=1", label: "Find speakers",
      detail: "No speakers yet: the house finds them through Spotify" });
  // The time zone, its own row with its own page (Codex, 2026-10-17: it had
  // been part of Speakers, whose page could not set it).
  core.push(zoneValid(env.HOUSE_TZ)
    ? { title: "Time zone", state: "done", href: "/setup/timezone", label: "Change", always: true, detail: zoneWords(env.HOUSE_TZ) }
    : { title: "Time zone", state: "todo", href: "/setup/timezone", label: "Set the time zone", detail: "No time zone yet" });
  // The house's address, for the signed-in owner only (this page is
  // theirs), to add or re-add it in Claude or ChatGPT. The steps for both are
  // on their own page (the practice install, 2026-10-19: this row was
  // Claude's alone, so a ChatGPT household found no steps on the page).
  const address = env.MCP_SECRET && origin ? `${origin}/mcp/${env.MCP_SECRET}` : null;
  const copy = address ? { label: "The house's address", value: address } : null;
  core.push(seen.connector
    ? { title: "Claude or ChatGPT", state: "done", href: "/setup/app", label: "Open", always: true, copy,
      detail: `Added · last call ${when(env, seen.connector)}` }
    : { title: "Claude or ChatGPT", state: "todo", href: "/setup/app", label: "Connect Claude or ChatGPT", copy,
      // The page ticks it by itself once the first call comes (setup-watch.js).
      wait: { app: false },
      detail: "Not heard from yet: connect the one you use, then ask it what is playing in a new chat" });
  // THE HOUSE ON THE PHONE (the owner, 2026-10-17): its pages install like an
  // app. Not seen from here, so a "?" that counts neither way.
  if (base) {
    // How it reaches the phone (Codex, 2026-10-17: the link opened another
    // tab on the computer): this page's address, signed in with the code.
    core.push({ title: "On your phone", state: "unknown", href: `${base}/wiim`, label: "Open the house", newTab: true, always: true,
      ...(origin ? { copy: { label: "This page's address, for your phone", value: `${origin}/setup` } } : {}),
      detail: "On your phone, open this page's address (below) and sign in with your recovery code. Then tap Open the house " +
        "there and add it to the home screen, so it opens like an app. iPhone: in Safari, tap Share (the square with the " +
        "arrow), then Add to Home Screen. Android: in Chrome, tap ⋮, then Add to Home screen or Install app." });
  }
  const guests = liveGuests(env).sort((a, b) => a.btn - b.btn);
  if (!guests.length) {
    // Always a row (Codex, 2026-10-17: with no requests preset, Core had
    // passed without one).
    core.push({ title: "Requests preset", state: "todo", href: "/setup/requests", label: "Make the Requests preset",
      detail: "Not made yet: the set a DJ is asked for has nowhere to go" });
  } else {
    const title = guests.length === 1 ? `Preset ${guests[0].btn}` : `Presets ${listWords(guests.map((g) => String(g.btn)))}`;
    const what = `Requests on ${listWords(guests.map((g) => g.label))}`;
    const each = guests.map((g) => savedOn(boxes, recs, g.btn, g.label));
    if (each.some((x) => x === null)) {
      core.push({ title, state: "unknown", href: "/setup/requests", label: "How to fill and save it", always: true,
        detail: `${what}. Saved on your WiiM? The house cannot see that without the home helper: press ${guests[0].btn} on the remote to check` });
    } else {
      const missing = [...new Set(each.flatMap((x) => x.missing))];
      const unread = each[0].unread;
      core.push(missing.length
        ? { title, state: "todo", detail: `${what} · not saved yet on ${listWords(missing)}${unreadWords(unread)}` }
        : { title, state: unread.length ? "unknown" : "done", href: "/setup/requests", label: "How to fill and save it", always: true,
          detail: `${what} · saved on ${listWords(boxes.filter((b) => recs[b.slug]).map((b) => b.name))}${unreadWords(unread)}` });
    }
  }

  // DJ PRESETS THAT WAIT FOR A CURATOR (MC-40, tasks/mc40-dj-presets.md): a
  // section of their own, between Core and Endless. Each was made with an
  // hour of its DJ's songs, so it is done once it is saved on the WiiMs;
  // none of it is the curator's work, so nothing here waits on one.
  const waits = presetsWait(env);
  const djPresets = [];
  // The section is the setup page's (MC-40 stage 4): where the presets are
  // the page's to make, once the Requests preset exists. A house whose
  // ENDLESS comes from its file keeps the checklist it had.
  const pageMakes = !!env.SETUP_KEY && (!cfg || (!!env.__page && Object.hasOwn(env.__page, "ENDLESS")));
  if (waits || (pageMakes && guests.length)) {
    for (const p of (cfg?.presets ?? []).filter((x) => !x.lane && x.dj).sort((a, b) => a.button - b.button)) {
      const name = findDj(env, p.dj)?.name ?? p.dj;
      const on = savedOn(boxes, recs, p.button, "Spotify");
      const made = waits ? "Made, with its starter set" : "Endless: adds songs while it plays";
      djPresets.push(on === null
        ? { title: `${name} · preset ${p.button}`, state: "unknown", detail: `${made}. Saved on your WiiM? The house cannot see that without the home helper: press ${p.button} on the remote to check` }
        : on.missing.length
          ? { title: `${name} · preset ${p.button}`, state: "todo", detail: `${made} · not saved yet on ${listWords(on.missing)}${unreadWords(on.unread)}` }
          : { title: `${name} · preset ${p.button}`, state: on.unread.length ? "unknown" : "done",
            detail: `${made} · saved on ${listWords(on.saved)}${unreadWords(on.unread)}` });
    }
    // The DJs still free for one, named (the test house run, 2026-11-10:
    // "Another DJ" did not say that more DJs can be added).
    const have = new Set((cfg?.presets ?? []).filter((x) => !x.lane && x.dj).map((x) => x.dj));
    const open = STARTER_DJS.filter((k) => !have.has(k)).map((k) => findDj(env, k)?.name).filter(Boolean);
    if (env.SETUP_KEY && open.length) {
      const many = djPresets.length;
      djPresets.push(many
        ? { title: "Add another DJ preset", state: "offer", href: "/setup/dj-preset", label: "Add a DJ preset",
          detail: `${listWords(open)} can have a preset of their own too, each with an hour of their songs. ${
            many < 3 ? "Three is a good number to stop at." : "You have three or more: a good number to stop at."}` }
        : { title: "A DJ on a button of their own", state: "offer", href: "/setup/dj-preset", label: "Add a DJ preset",
          detail: "A DJ on a button of their own, with an hour of their songs. Each takes a few minutes to save on every WiiM; three is a good number to stop at." });
    }
  }

  // ENDLESS: only where the house has it. Without it, an empty section that
  // says what it is.
  const endless = [];
  // Claude's task or ChatGPT's Work chat (MC-31 6b): the one the house rings.
  const kind = curatorKind(env);
  const curatorOn = !!env.AGENT_SECRET && !!kind;
  // A house set up on the page (a setup key) gets the Endless step offered:
  // the curator first (the forum road, 2026-10-17).
  // Offered too while DJ presets wait (MC-40): the curator is what makes
  // them endless.
  // An offer, not a step owed (the owner, 2026-11-10, in the test house run:
  // a house that stops at Level 1 or 2 reads as set up, "5 of 5").
  if (!curatorOn && (!cfg || waits) && env.SETUP_KEY && env.AGENT_SECRET) {
    endless.push({ title: "Curator", state: "offer", href: "/setup/curator", label: "Set up the curator",
      detail: waits ? "Claude or ChatGPT: it adds songs to your DJ presets while they play, and writes the sets asked for on the DJ pages. Needs a paid Claude plan or ChatGPT Plus."
        : "Claude or ChatGPT: it writes the DJs' sets for the DJ pages and keeps endless DJs going. Needs a paid Claude plan or ChatGPT Plus." });
  }
  // Waiting presets are not the curator's yet: its row only once one is
  // set up, and the presets' own rows stay in their section above.
  if (curatorOn || (cfg && !waits)) {
    const who = kind === "chatgpt" ? `ChatGPT, woken by event${subs?.count ? "" : " (no Work chat is listening)"}`
      : `The curator task${env.REQUEST_ROUTINE_ID ? ", rung by web call" : ""}`;
    const lookAt = kind === "chatgpt" ? "its Work chat (chatgpt.com)" : "its task (claude.ai/code, Scheduled)";
    endless.push(!curatorAt
      ? { title: "Curator", state: "todo", href: env.SETUP_KEY ? "/setup/curator" : null,
        label: kind === "chatgpt" ? "Send it a test" : "Wake it to check",
        wait: { curator: 0, ...(kind === "chatgpt" ? { listening: subs?.count ?? 0 } : {}) },
        detail: kind === "chatgpt" ? `${who} · not checked in yet: send it a test from its page, or wait for its hourly check`
          : "Not checked in yet: wake it from its page, or wait for its hourly check" }
      : { title: "Curator", state: now - curatorAt > CURATOR_QUIET_MS || waiting || (kind === "chatgpt" && !subs?.count) ? "due" : "done",
        ...(env.SETUP_KEY ? { href: "/setup/curator", label: "Open", always: true } : {}),
        detail: `${who} · checked in ${when(env, new Date(curatorAt).toISOString())}` +
          (now - curatorAt > CURATOR_QUIET_MS ? `: over an hour ago, so look at ${lookAt}` : "") +
          // Work nobody answered (MC-31 6b): a plan's limit run out looks like this.
          (waiting ? ` · ${waitingWords(waiting)} waiting over 20 minutes: ${LIMIT_HINT}` : "") });
    // THE WORK CHAT'S HOURLY CHECK, ITS OWN ROW (the test house run, finding
    // 17, 2026-11-11: the hourly note was missed and nothing said so). Ticked
    // by the house from a check-in it did not ring for; to do until then, so
    // a house whose curator has no hourly check never reads as set up.
    if (kind === "chatgpt" && curatorAt) {
      endless.push({ title: "Curator's hourly check", state: hourly?.fresh ? "done" : "todo",
        ...(env.SETUP_KEY ? { href: "/setup/curator", label: "Open" } : {}),
        wait: { hourly: hourly?.at ?? 0 },
        detail: hourly?.fresh ? `Ran ${when(env, new Date(hourly.at).toISOString())}: it catches anything the signal missed`
          : hourly ? `Last ran ${when(env, new Date(hourly.at).toISOString())}, over two hours ago: look under Scheduled at chatgpt.com`
          : "Not seen yet: it shows within the hour, once the hourly note is pasted in the Work chat (step 3 on the curator's page)" });
    }
    if (!cfg?.presets?.length && curatorOn && env.SETUP_KEY) {
      endless.push({ title: "DJ presets", state: "todo", href: "/setup/endless", label: "Choose the house DJ",
        detail: "Not made yet: a house DJ who plays for as long as you listen, and a guest DJ preset for any other DJ" });
    }
    if (cfg?.presets?.length && !waits) {
      const all = endlessPresets(env, cfg, state).filter((p) => !p.program).sort((a, b) => a.button - b.button);
      const named = (cfg.presets ?? []).filter((p) => !p.program).sort((a, b) => a.button - b.button).map((p) => {
        const on = all.find((x) => x.button === p.button);
        const who = on?.dj ? findDj(env, on.dj)?.name ?? on.dj : null;
        return `${p.button} ${p.lane ? `guest DJ${who ? ` (${who})` : ""}` : who ?? "nobody yet"}`;
      });
      // A way back from a done step (the owner, 2026-10-19): presets the
      // setup page made open there; a house whose presets came from its file
      // changes who is on each from a DJ's page, on the DJs tab.
      endless.push({ title: "DJ presets", state: cfg.mode === "live" ? "done" : "due",
        ...(env.__page?.ENDLESS ? { href: "/setup/endless", label: "Open", always: true }
          : base ? { href: `${base}/djs`, label: "Change on the DJs tab", always: true } : {}),
        detail: named.join(" · ") + (cfg.mode === "live" ? "" : " · watching only, not playing yet") });
      // DJ presets made on their own page have no guest DJ preset yet
      // (MC-40): offered here, the Endless step's second half.
      if (pageMakes && curatorOn && !(cfg.presets ?? []).some((p) => p.lane)) {
        endless.push({ title: "Guest DJ preset", state: "offer", href: "/setup/endless", label: "Make the guest DJ preset",
          detail: "One more preset, for any DJ you play endless: press ▶ on a DJ on the DJs tab and they play there" });
      }
      const slots = endlessSlots(env, cfg, state);
      const read = boxes.filter((b) => recs[b.slug]);
      if (!read.length) {
        endless.push({ title: "Saved on the WiiM devices", state: "unknown", detail: "Not seen from here without the home helper" });
      } else {
        const btns = (cfg.presets ?? []).map((p) => p.button);
        const missing = btns.filter((n) => read.some((b) => !recs[b.slug].presets.some((r) => r.btn === n && /^spotify/i.test(String(r.source ?? "")))));
        const owed = endlessOwed(env, slots, recs);
        const unread = boxes.filter((b) => !recs[b.slug]).map((b) => b.name);
        endless.push(missing.length || owed.length
          ? { title: "Saved on the WiiM devices", state: missing.length ? "todo" : "due", href: base ? `${base}/wiim` : null, label: "Open Speakers",
            detail: [missing.length ? `Not saved yet: ${listWords(missing.map(String))}` : null,
              owed.length ? `Save again for the new name: ${listWords(owed.map((o) => `${o.btn} on ${listWords(o.speakers.map((s) => s.name))}`))}` : null]
              .filter(Boolean).join(" · ") + unreadWords(unread) }
          : { title: "Saved on the WiiM devices", state: unread.length ? "unknown" : "done",
            // Speakers says which need saving again, and how.
            ...(base ? { href: `${base}/wiim`, label: "Open Speakers", always: true } : {}),
            detail: `All ${btns.length === 2 ? "both" : btns.length}, on ${listWords(read.map((b) => b.name))}${unreadWords(unread)}` });
      }
    }
  }

  // THE HOME HELPER and TALK: optional, rows only where they are set up.
  // Only a helper that has ever reported is missed when it is away: every
  // claimed house has the helper's key, and one that never ran one was told
  // its computer "may be asleep" (the trial, 2026-10-17).
  // CONNECTED IS WHAT IT READ (Codex, 2026-10-19): the WiiMs read freshly,
  // and the ones not answering, said apart from the line being open. A
  // page-made house whose helper never reported is offered one (MC-31 stage
  // 5): optional, so it counts neither way and is never the Next step.
  const saw = helperSaw(hands?.doc, now);
  const helperPage = env.SETUP_KEY ? { href: "/setup/helper", label: "Open", always: true } : {};
  const helper = hands?.hands
    ? [saw?.read.length
      ? { title: "Connected", state: saw.silent.length ? "due" : "done", ...helperPage,
        detail: `Sees and presses ${listWords(saw.read)}${saw.silent.length ? ` · not answering: ${listWords(saw.silent)}` : ""}` }
      : { title: "Connected", state: "due", ...helperPage, detail: "Its line is open, but no WiiM has answered it yet" }]
    : hands?.doc
      // Its computer off is no fault: it need not stay on (the owner, 2026-11-10).
      ? [{ title: "Connected", state: "done", ...helperPage, detail: "Not connected right now: its computer is off or asleep. It helps again once that computer is on" }]
      : env.SETUP_KEY && env.HELPER_SECRET
        // No watch here: most houses never run one, and its own page watches.
        ? [{ title: "Home helper", state: "offer", href: "/setup/helper", label: "Set up the home helper",
          detail: "Not set up: a small program on a computer at home. While it runs, you see the preset names on your WiiMs and the radio on the bar, and can press presets from the app" }]
        : [];
  // TALK, AN EXTRA (MC-40): on with a key, the owner's own; offered on the
  // setup page where there is none.
  const talk = env.OPENAI_API_KEY ? [{ title: "OpenAI", state: "done", detail: `On · ${talkMinutes(env)} minutes a day`,
      ...(env.SETUP_KEY ? { href: "/setup/talk", label: "Open", always: true } : {}) }]
    : env.SETUP_KEY ? [{ title: "Talk", state: "offer", href: "/setup/talk", label: "Set up Talk",
      detail: "Ask by voice in your house's app. Needs your own OpenAI key, paid by the minute: about 5 cents a minute of talking" }]
    : [];
  // UPDATES (MC-34 stage 2): only a house made by the Deploy button has a
  // source to update from; turned on from its owner's own GitHub copy.
  const up = await updateFacts(env, now).catch(() => null);
  const updates = !up ? [] : !up.on
    ? [{ title: "Updates", state: "offer", href: "/setup/updates", label: "Turn on updates",
      detail: "New versions with a click, from your own GitHub copy of the house" }]
    : [{ title: "Updates", state: up.newer ? "due" : "done", href: "/setup/updates", label: up.newer ? "Get the latest version" : "Open", always: true,
      detail: up.newer ? `A newer version is out${up.latestWhen ? `, of ${up.latestWhen}` : ""}`
        : up.latest && up.current ? `This house has the latest version${up.currentWhen ? `, of ${up.currentWhen}` : ""}` : `From ${up.ownSlug}` }];

  // ONE RULE FOR DONE (Codex, 2026-10-17: a section said 5 of 5 while Core
  // said 4 of 5): "due" is done, with something to look at, counted apart.
  const complete = (r) => r.state === "done" || r.state === "due";
  const counts = (r) => r.state !== "unknown" && r.state !== "offer";
  const section = (key, title, sub, rows, optional = false) => ({
    key, title, sub, rows, optional,
    count: rows.filter(counts).length ? `${rows.filter(complete).length} of ${rows.filter(counts).length}` : (optional ? "Optional" : "Off"),
  });
  // THE LEVELS (MC-40, levels.js): where the setup page makes the presets,
  // the sections carry the ladder's names and say what each needs. A house
  // whose presets come from its file keeps the names it had.
  const lv = (key) => LEVELS.find((l) => l.key === key);
  const sections = [
    section("core", pageMakes ? lv("core").title : "Core", pageMakes ? lv("core").sub : "Music from your phone, by text or voice", core),
    ...(djPresets.length ? [section("djpresets", pageMakes ? lv("djpresets").title : "DJ presets",
      pageMakes ? lv("djpresets").sub : "Optional: a DJ on a button of their own, with an hour of their songs", djPresets, true)] : []),
    section("endless", pageMakes ? lv("endless").title : "Endless", pageMakes ? lv("endless").sub
      : endless.length ? "DJs that keep playing, and requests from the DJ pages"
      : "DJs that keep playing, and requests from the DJ pages: after Core", endless),
    section("helper", pageMakes ? EXTRAS[0].title : "Home helper", "Optional: a small program on a computer at home, which adds more while that computer is on", helper, true),
    section("talk", pageMakes ? EXTRA_TALK_TITLE : "Talk", "Optional: voice in the house's app, with OpenAI", talk, true),
    ...(updates.length ? [section("updates", "Updates", "New versions of the house, from your GitHub copy", updates, true)] : []),
  ];
  // A row the house cannot see from here (a preset with no home helper) is
  // shown with its "?" but neither counts for nor against (Codex,
  // 2026-10-17: a Core-only house could never finish).
  const visible = (r) => r.state !== "unknown";
  const rows = sections.flatMap((s) => s.rows).filter(counts);
  const done = rows.filter(complete).length;
  const list = { sections, done, total: rows.length, due: rows.filter((r) => r.state === "due").length,
    unseen: sections.flatMap((s) => s.rows).filter((r) => !visible(r)).length,
    unseenTitles: sections.flatMap((s) => s.rows).filter((r) => !visible(r)).map((r) => r.title),
    allDone: rows.length > 0 && done === rows.length,
    coreDone: core.filter(visible).filter(complete).length, coreTotal: core.filter(visible).length, home: base,
    // WHERE THE HOUSE IS on the ladder (MC-40): 3 once a curator has checked
    // in and its presets no longer wait, 2 with a DJ preset, 1 with Level
    // 1's steps done, 0 before. Only where the setup page makes the presets.
    level: pageMakes ? levelWords(
      curatorAt && !waits && (cfg?.presets ?? []).length ? 3
        : (cfg?.presets ?? []).some((p) => !p.lane) ? 2
        : core.filter(visible).length && core.filter(visible).every(complete) ? 1 : 0) : null };
  // The card at the top (levels.js): on the ladder, it follows the strip.
  return { ...list, next: nextStep(list) };
}
