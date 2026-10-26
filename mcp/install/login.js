// The browser step: sign in to Spotify or Tidal once, and keep the refresh
// token the Worker will run on for months.
//
//   node install/login.js spotify <client id>
//   node install/login.js tidal   <client id>
//
// Authorization Code with PKCE, which is why no client secret appears here or
// anywhere else in the install. The secret's job in the classic flow is to
// prove the app is the app; PKCE proves it with a one-time verifier instead,
// so a household registers a public client and has nothing long-lived to
// leak. The redirect comes back to a server this process runs on loopback for
// the few seconds the approval takes — the code never passes through a screen
// or the clipboard.
//
// Zero dependencies: node:http and node:crypto do all of it.

import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { MCP } from "./config.js";
import { SPOTIFY_SCOPES } from "../spotify.js";

// Where the logins live. A function rather than a constant because the tests
// point it at a temporary directory: an earlier version cleaned up after
// itself by deleting this path, and `npm test` therefore deleted the real
// account's saved logins. A suite must not be able to log the machine out.
let tokenDir = join(MCP, ".tokens");
export const tokenDirPath = () => tokenDir;
export function useTokenDir(dir) { tokenDir = dir; }

// Half a login. The authorize URL is printed by one command and approved in a
// browser that may be on another machine, minutes later — so the verifier and
// the state that belong to it are written down rather than held in a process
// somebody has to keep alive. Nothing here is a credential: a verifier without
// its code buys nothing, and it is deleted the moment the code is spent.
const pendingFile = (service) => join(tokenDir, `.pending-${service}.json`);

// `mode:` on writeFileSync and mkdirSync applies AT CREATION and nowhere else,
// so a token file restored from a backup at 0644, or a directory that already
// existed, kept whatever mode it had — and these are live credentials for a
// real account on a machine other people may have logins on. Set it every time,
// and write through a temp file so a half-written token never replaces a good
// one. chmod is a no-op on Windows, where the mode bits mean nothing anyway;
// the throw is swallowed rather than pretended about.
function secureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not POSIX */ }
}

export function writeSecret(file, body) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* not POSIX */ }
  renameSync(tmp, file); // carries the 0600 with it, whatever the old file was
}

function keepPending(service, data) {
  secureDir(tokenDir);
  writeSecret(pendingFile(service), JSON.stringify(data, null, 2));
}

function takePending(service) {
  const file = pendingFile(service);
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  return saved.verifier && saved.state ? saved : null;
}

const dropPending = (service) => rmSync(pendingFile(service), { force: true });

// Two services, one flow, three differences that matter. The redirect hosts
// are NOT interchangeable: Spotify rejects `localhost` in a redirect URI and
// requires the literal loopback address, and Tidal's dashboard takes the name.
// A house pastes whichever string its dashboard was given, so the value here
// has to match the docs exactly.
export const SERVICES = {
  spotify: {
    label: "Spotify",
    authorize: "https://accounts.spotify.com/authorize",
    token: "https://accounts.spotify.com/api/token",
    redirect: "http://127.0.0.1:8888/callback",
    // The Worker's nine, one list with the app's Reconnect (spotify.js).
    scope: SPOTIFY_SCOPES,
    // Premium is not a scope and not visible until something is asked of the
    // player, so the check is a call: a free account can curate all day and
    // then fail at the one moment somebody presses Play. Spotify has stopped
    // sending `product` for some apps (Codex's review, 2026-10-15, not
    // checked): no field is no warning, never a false one.
    async verify(token) {
      const r = await fetch("https://api.spotify.com/v1/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`Spotify /me answered ${r.status}`);
      const me = await r.json();
      return {
        who: me.display_name || me.id,
        warn: !me.product || me.product === "premium" ? null
          : `this account is "${me.product}", not premium — Claude will be able to ` +
            "fill the buttons but not start them. Pressing the preset still works.",
      };
    },
  },
  tidal: {
    label: "Tidal",
    authorize: "https://login.tidal.com/authorize",
    token: "https://auth.tidal.com/v1/oauth2/token",
    redirect: "http://localhost:8888/callback",
    // Exactly two. An unrecognised scope name is what produced Tidal's opaque
    // "Error 1002" on the authorize page, which names no parameter at all —
    // `user.read` is not valid here (tidal/probe.py).
    scope: "playlists.read playlists.write",
    async verify(token) {
      const r = await fetch("https://openapi.tidal.com/v2/playlists?" +
        "filter%5Br.owners.id%5D=me&limit=1", {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.api+json" },
      });
      if (!r.ok) throw new Error(`Tidal answered ${r.status} to a playlist read`);
      return { who: "your Tidal account", warn: null };
    },
  },
};

const b64url = (buf) => buf.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The one page the browser ever sees from this process. Kept to a sentence:
// whatever went wrong, the terminal is where the detail belongs.
const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px/1.6 system-ui,sans-serif;margin:3rem;max-width:32rem">` +
  `<h2 style="font-weight:600">${title}</h2><p>${body}</p>`;

// NO SHELL, ON ANY PLATFORM. Windows used to go through `start` with
// `shell: true`, which hands the URL to cmd.exe — and an authorize URL is
// nothing but `&`-separated parameters, which is cmd's command separator. The
// URL could be split mid-way and the rest run as commands. `rundll32
// url.dll,FileProtocolHandler` opens the default browser with the URL as one
// argument and no interpreter in between.
function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" })
      .on("error", () => {}).unref();
  } catch { /* headless, or no handler: the printed URL is the fallback */ }
}

// Wait for ONE approval, then stop listening. Two ways it can arrive, because
// the browser is not always on the machine running this:
//
//   the redirect      the browser hits the loopback port directly. What
//                     happens when the two are the same machine, or a tunnel
//                     makes them look like it.
//   a pasted URL      the browser is elsewhere — a laptop, a Chromebook, a
//                     phone — and its redirect to localhost lands nowhere.
//                     The address bar still holds the whole answer, so the
//                     failed URL pasted back here is as good as the request.
//                     PKCE is what makes this safe: the verifier never left
//                     this process, so a code alone spends nothing.
//
// The state parameter is checked before the code is touched either way: a link
// someone else crafted can reach this port while it is open, and a code from
// an authorization this process did not start is not ours to spend.
function catchRedirect({ redirect, state, timeoutMs = 180_000, paste = process.stdin.isTTY }) {
  timeoutMs = timeoutMs ?? 180_000;
  const url = new URL(redirect);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const got = new URL(req.url, redirect);
      if (got.pathname !== url.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = got.searchParams.get("code");
      const err = got.searchParams.get("error");
      const ok = code && got.searchParams.get("state") === state;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ok
        ? page("Connected.", "You can close this tab and go back to the terminal.")
        : page("Not connected.", "Go back to the terminal — it says what happened."));
      done(ok ? null : new Error(err ? `the service said: ${err}`
        : code ? "state did not match — this approval was not the one we started"
          : "no code came back"), code);
    });

    let settled = false;
    const cleanup = [];
    const done = (e, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const undo of cleanup) undo();
      // close() waits for the response above to flush before the callback.
      server.close(() => (e ? reject(e) : resolve(code)));
    };
    const timer = setTimeout(
      () => done(new Error(`nobody approved within ${timeoutMs / 1000}s`)), timeoutMs);

    server.on("error", (e) => done(e.code === "EADDRINUSE"
      ? new Error(`port ${url.port} is already in use — close whatever holds it and retry`)
      : e));
    server.listen(Number(url.port), url.hostname);

    // The paste lane. Only when there is a person at a terminal to paste into
    // it — a scripted run has no stdin worth listening to, and an idle
    // listener would keep the process alive after the answer arrived.
    if (!paste) return;
    const onLine = (chunk) => {
      const said = String(chunk).trim();
      if (!said) return;
      let got;
      try {
        // A whole URL, or just the code out of one. Both get typed by people;
        // anything with a space in it is neither.
        if (!said.includes("?") && /\s/.test(said)) throw new Error("prose");
        got = said.includes("?") ? new URL(said).searchParams
          : new URLSearchParams({ code: said, state });
      } catch {
        console.error("that is not a URL — paste the whole address bar, or just the code");
        return;
      }
      const err = got.get("error");
      if (err) return done(new Error(`the service said: ${err}`));
      const code = got.get("code");
      if (!code) return done(new Error("that URL carries no code"));
      if (got.get("state") !== state) {
        return done(new Error("state did not match — this approval was not the one we started"));
      }
      done(null, code);
    };
    process.stdin.on("data", onLine);
    cleanup.push(() => {
      process.stdin.off("data", onLine);
      process.stdin.pause();
    });
  });
}

async function exchange(svc, body) {
  const r = await fetch(svc.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${svc.label} refused the exchange: ${r.status} ${text}`);
  return JSON.parse(text);
}

// The whole flow. Returns what was stored, never printing the token itself:
// this runs in a terminal a household may well be screen-sharing.
export async function login(service, clientId,
  { open = true, log = console.log, timeoutMs, paste = process.stdin.isTTY,
    restart = false } = {}) {
  const svc = SERVICES[service];
  if (!svc) throw new Error(`unknown service "${service}"`);
  if (!clientId) throw new Error(`no ${svc.label} client id — copy it from the dashboard`);

  // A PENDING APPROVAL IS NOT SCRAP PAPER. Starting a login writes a verifier
  // and a state, and starting a second one used to overwrite them — so the
  // ordinary recovery (the first attempt times out, the person approves it on
  // their phone a minute later, and is told to run setup again) destroyed the
  // one secret that could still spend that approval. A recent one is reported
  // rather than replaced; an old one is assumed abandoned.
  const waitingAlready = takePending(service);
  const startedAt = waitingAlready?.created ? Date.parse(waitingAlready.created) : NaN;
  const freshMs = 30 * 60 * 1000;
  if (waitingAlready && !restart && Number.isFinite(startedAt)
      && Date.now() - startedAt < freshMs) {
    const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    throw new Error(
      `a ${svc.label} login started ${mins} minute${mins === 1 ? "" : "s"} ago is still ` +
      "waiting to be finished, and starting another would throw away the only thing " +
      "that can complete it.\n\n" +
      "If you have the address that browser ended up at:\n" +
      `  node install/login.js ${service} --finish\n\n` +
      "To abandon it and approve again from the start:\n" +
      `  node install/login.js ${service} ${clientId} --restart`);
  }

  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const url = `${svc.authorize}?` + new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: svc.redirect,
    scope: svc.scope,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  // Written before the URL is shown, so that whatever happens to this process
  // — a timeout, a closed terminal, a Ctrl-C — the approval it printed can
  // still be completed by `login.js <service> --finish "<the URL>"`.
  keepPending(service, { client_id: clientId, verifier, state, created: new Date().toISOString() });

  // Listen BEFORE the browser opens, or a fast approval arrives at a closed
  // port and the household is told nobody approved anything.
  const waiting = catchRedirect({ redirect: svc.redirect, state, timeoutMs, paste });
  log(`\nOpening ${svc.label} in your browser to approve access…`);
  log("If nothing opens, paste this into a browser — any browser, any machine:\n");
  log(url); // on its own line, so it survives a copy out of the terminal
  if (paste) {
    log(`\nApproving on ANOTHER machine? Its browser will end up at a ${
      new URL(svc.redirect).host} page that cannot load. That is expected — copy `
      + "the whole address out of the bar, paste it here, and press Enter.");
  }
  if (open) openBrowser(url);

  const code = await waiting;
  return settle(service, { clientId, verifier, code, log });
}

// The half a login that happens after somebody approves: spend the code with
// the verifier that was kept for it, check the account, write the token down.
// Shared by the waiting flow above and by --finish, so the two cannot drift.
async function settle(service, { clientId, verifier, code, log }) {
  const svc = SERVICES[service];
  const tok = await exchange(svc, {
    grant_type: "authorization_code",
    code,
    redirect_uri: svc.redirect,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (!tok.refresh_token) {
    throw new Error(
      `${svc.label} returned no refresh token, so nothing would survive the ` +
      "first hour. Check the app's redirect URI matches exactly.");
  }

  // THE CODE IS SPENT, SO THE TOKEN IS WRITTEN FIRST. An authorization code is
  // single-use: by this line it has been exchanged and cannot be exchanged
  // again. The account check below is an ordinary network call that can fail
  // for ordinary reasons, and doing it before the write meant a flaky /me lost
  // the refresh token outright and sent a household back through the whole
  // browser dance. Saved unverified, then marked verified — never the reverse.
  const record = {
    service,
    client_id: clientId,
    refresh_token: tok.refresh_token,
    scope: tok.scope ?? svc.scope,
    saved: new Date().toISOString(),
  };
  secureDir(tokenDir);
  const file = join(tokenDir, `${service}.json`);
  writeSecret(file, JSON.stringify({ ...record, verified: false }, null, 2));
  // The verifier bought what it was for; keeping it buys nothing and it is
  // half of a credential.
  dropPending(service);

  let checked;
  try {
    checked = await svc.verify(tok.access_token);
  } catch (e) {
    throw new Error(
      `${svc.label} signed you in and the login IS SAVED to ${file} — but the ` +
      `check straight afterwards did not answer: ${e.message}\n` +
      "Nothing is lost and nothing needs approving again: the house's secret is " +
      "made from that file (docs/install/secrets.md).");
  }
  writeSecret(file, JSON.stringify({ ...record, verified: true }, null, 2));

  log(`\n${svc.label}: connected as ${checked.who}.`);
  if (checked.warn) log(`\n  Note: ${checked.warn}\n`);
  log(`Saved to ${file} — it is gitignored. docs/install/secrets.md says how it becomes the house's secret.`);
  return { file, ...checked };
}

// Finish a login that was started earlier and approved somewhere else. Takes
// the URL out of the failed page's address bar — or just the code — and spends
// it with the verifier the first command wrote down. This is the whole of what
// makes the two-machine case forgiving: nothing has to stay running, and the
// approval keeps until it is used.
export async function finish(service, pasted, { log = console.log } = {}) {
  const svc = SERVICES[service];
  if (!svc) throw new Error(`unknown service "${service}"`);
  const pending = takePending(service);
  if (!pending) {
    throw new Error(
      `no ${svc.label} login is waiting to be finished — start one first:\n` +
      `  node install/login.js ${service} <client id>`);
  }
  if (!pasted) throw new Error("paste the address the browser ended up at");

  const said = String(pasted).trim();
  let got;
  try {
    // A whole address, or the bare code out of one — both get pasted by
    // people. A code has no spaces in it, so anything that does is a sentence
    // rather than either, and saying so beats spending it and failing later.
    if (!said.includes("?") && /\s/.test(said)) throw new Error("prose");
    got = said.includes("?") ? new URL(said).searchParams
      : new URLSearchParams({ code: said, state: pending.state });
  } catch {
    throw new Error("that is not a URL — paste the whole address bar, or just the code");
  }
  const err = got.get("error");
  if (err) throw new Error(`${svc.label} said: ${err}`);
  const code = got.get("code");
  if (!code) throw new Error("that address carries no code — approve first, then copy the bar");
  if (got.get("state") !== pending.state) {
    throw new Error(
      "state did not match — this address is from a different login than the " +
      "one waiting. Start again so the two belong together.");
  }
  return settle(service, {
    clientId: pending.client_id, verifier: pending.verifier, code, log,
  });
}

// The login saved on this machine, or null when there is none to read.
export function savedLogin(service) {
  const file = join(tokenDir, `${service}.json`);
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return saved.refresh_token ? saved : null;
  } catch {
    return null; // half-written by an interrupted run: log in again.
  }
}

if (process.argv[1]?.endsWith("login.js")) {
  const args = process.argv.slice(2);
  // Flags anywhere, the two positional words in order:
  //   login.js tidal <client id>            start one
  //   login.js tidal --finish                complete one approved elsewhere
  //                                         (it asks for the address; passing
  //                                         it here puts a live code in your
  //                                         shell history)
  // --no-open is for a session on a machine with no browser to open; the
  // printed URL is then the whole of the step.
  const flags = args.filter((a) => a.startsWith("--"));
  const [service, second] = args.filter((a) => !a.startsWith("--"));
  const fail = (e) => {
    console.error(`\nerror: ${e.message}`);
    process.exit(1);
  };

  if (flags.includes("--finish")) {
    // THE CODE DOES NOT GO IN ARGV. An authorization code on the command line
    // is visible in `ps` to anything on the machine and lands in shell history,
    // where it outlives the seconds it is worth anything for. Given no value,
    // this asks — which is now the form every message here prints. The
    // positional form still works, because it is in older instructions and
    // refusing it would strand somebody mid-install.
    const pasted = second ? Promise.resolve(second) : (async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question("Paste the address the browser ended up at: ");
      } finally {
        rl.close();
      }
    })();
    Promise.resolve(pasted).then((v) => finish(service, v)).catch(fail);
  } else {
    // Ten minutes, not three. Copying a URL to another machine, signing in
    // there and copying the answer back is slower than clicking Approve, and
    // the only cost of waiting is a person who has walked away.
    login(service, second, { open: !flags.includes("--no-open"), timeoutMs: 600_000,
      restart: flags.includes("--restart") })
      .catch((e) => {
        console.error(`\nerror: ${e.message}`);
        if (SERVICES[service] && takePending(service)) {
          console.error(
            "\nThe approval it printed is still good — nothing had to stay running. " +
            "When you have the address the browser ended up at:\n" +
            `  node install/login.js ${service} --finish\n` +
            "  (it asks for the address, so the code stays out of your shell history)");
        }
        process.exit(1);
      });
  }
}
