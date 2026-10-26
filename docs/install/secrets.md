# Every secret and setting, and who makes it

*2026-09-03. The inventory is read off the code, and the install that
pushes it has been run: every secret below went up through
`wrangler secret put` on stdin during a throwaway install, and the
deployed Worker read live from both services afterwards.*

Two kinds of value. **Secrets** are pushed to Cloudflare one at a time and
cannot be read back — `npx wrangler secret put NAME` takes the value on
stdin, so nothing is printed or kept in shell history. **Vars** live in
plain text in `wrangler.toml`, which is a tracked file: nothing goes in
[vars] that would hurt to publish.

A house made by the terminal installer (`mcp/install/door.js`) is deployed
with one secret, `SETUP_KEY`, and makes or is given the rest on its setup
page (*The house's own storage*, below). The owner's house, set up from its
files, has its secrets pushed by hand. The tables are for that house, and so
any house can check what it has and rotate a key on purpose.

## The core install

| Secret | Where it comes from | Rotating it |
|---|---|---|
| `MCP_SECRET` | Generated, `openssl rand -hex 32`. It is the path in the connector address, so it *is* the password to the whole server. | Push a new one, redeploy, then remove and re-add the connector at claude.ai with the new address. |
| `PROGRAM_LIBRARY_KEY` | Generated, `openssl rand -hex 12`. Guards the library, the DJ pages and the programme-notes index — everything at `/notes/<key>` and `/buttons/<key>`. | Same push-and-redeploy, but it breaks every link already sent to somebody. **Never put this back in [vars]** — a `PROGRAM_LIBRARY_KEY` line there overrides the secret and puts the value in git. |
| `SPOTIFY_CLIENT_ID` | The Spotify developer dashboard. Public by design (it travels in every login URL); a secret here only for tidiness. | Harmless. |
| `SPOTIFY_REFRESH_TOKEN` | The browser login. **See the trap below.** | See the trap below. |
| `TIDAL_CLIENT_ID` | The Tidal developer dashboard. Same public-by-design. | Harmless. |
| `TIDAL_REFRESH_TOKEN` | The browser login. Tidal does not rotate it — the same one has served every call for months. | Push, **delete the stored copy** (the trap below applies to every service), redeploy. |

A one-service house pushes only its own pair.

**The trap: a refresh token lives in two places.** Spotify hands back a
*new* refresh token on every refresh, so the Worker keeps the current one
in the `TOKENS` store and only reads the secret the very first time
(`loadTokens`, services.js). Consequence: **pushing a new
`SPOTIFY_REFRESH_TOKEN` on its own changes nothing.** To actually replace
it — after a fresh login, or when widening the scopes — push the secret
*and* delete the stored copy:

    npx wrangler kv key delete --namespace-id <your TOKENS id> spotify --remote

The next call re-seeds from the secret. The same applies to `tidal`,
though it rarely comes up.

**For Spotify there is a simpler way since 2026-10-16:** Speakers → Spotify →
Reconnect Spotify signs in again from the app and replaces the stored copy
itself, with no secret and no delete. Spotify ends every login six months
after the sign-in, so this comes round twice a year. It needs the app's
return address, `<PROGRAM_BASE_URL>/oauth/spotify/callback`, added once to
the Spotify app's Redirect URIs in Spotify's developer dashboard.

**`--remote` is not optional.** Without it wrangler edits a *local*
simulated store, prints a cheerful success, and leaves the deployed
token exactly where it was. The namespace id is the `TOKENS` id in
`wrangler.toml`; `--binding TOKENS` also works, but only alongside
`--remote`.

**Scopes are baked into a token.** Spotify's are read at login; a token
minted before a scope was added answers a bare `403` for anything needing
it, and the fix is a fresh login plus the delete above — not a setting.

## Settings in `wrangler.toml`

Generated from `house.json`; safe to read, safe to commit.

| Var | What it is |
|---|---|
| `BUTTONS` | The house: which DJ sits on which preset, holding which playlist, on which service. The one place that says so. |
| `PLAYLIST_ALIASES` | Names for playlists that no preset points at. Holds `replay` and normally nothing else. |
| `PROGRAM_REPLAY_PLAYLIST` | Which of those an old programme is replayed through, so hearing one again never costs the set on the button. Spotify houses only. |
| `PROGRAM_BASE_URL` | The address programme links are built from — normally your `workers.dev` address, and a domain if you have one. **Required**: publishing a programme throws without it (`programBaseUrl`, shelf.js), because a record would be stored with no way to say where to read it. Every link is built at read time, so changing this re-points links already sent. |
| `DEFAULT_DEVICE` | The speaker Play uses when none is named. |
| `ROOM_DEVICES` | The speakers a Play form may name — a fixed list, so a form field can never aim the account at an arbitrary device. |
| `TIDAL_COUNTRY` | Two letters, default `NL` — this house's, not a sensible universal default. Which catalogue Tidal answers with, on **every** Tidal call. Wrong value, and records look missing that are not. Set it in `house.json`. |
| `TIDAL_GAP_MS` | Milliseconds between Tidal calls, default 500. Tidal's limit is real and low; leave it alone unless you measure. |
| `REQUESTS_ENABLED`, `AUTOFULFILL_ENABLED` | Both `"false"` in a core install. See below. |

## The two stores

The terminal installer creates them and names them after the Worker —
`<your-worker>-TOKENS` and `<your-worker>-PROGRAMS`. That is not
decoration: two installs in one Cloudflare account both want a TOKENS, and
anything that matched on the binding name alone could adopt, or delete, the
other house's credentials. If you ever clean up by hand, match on the title.

`TOKENS` holds the live refresh token per service (see the trap above) and,
if you have an archive button, the m3u it serves. `PROGRAMS` holds the
published programmes and the rollback copy of every button write. Deleting
`PROGRAMS` loses the writing; deleting `TOKENS` costs a fresh login.

## The house's own storage, and its setup key (MC-31, 2026-10-16)

A third store, the `HOUSE` Durable Object (`mcp/settings.js`), bound in
every install like the ledger. It keeps **a copy of the settings** above,
read on every request with the `[vars]` underneath (a deploy with changed
vars copies them in again, so house.json edits still work), and **who
owns the house**.

`SETUP_KEY` (a Worker secret, at least 24 characters) opens `/setup`,
where the house is **claimed once** with that key: the claiming browser
gets a sign-in cookie and a recovery code, shown once, that signs in
another browser at the same page. Without a `SETUP_KEY` there is no
`/setup` at all. The key is spent by the claim; a second claim is refused
whatever key is typed. **A new `SETUP_KEY` opens the claim again** (since
2026-10-17): set a new value in Cloudflare (the Worker's Settings,
Variables and Secrets) and claim with it; every old sign-in and the old
recovery code stop. A signed-in owner who has lost only the code makes
a new one on the checklist ("Make a new recovery code"). The new setup key
is the way back if the recovery code and every signed-in browser are lost, and it needs the Cloudflare account, which is
the house's real owner. Never use `PROGRAM_LIBRARY_KEY` for it: that one is
shared. The owner's house was claimed on 2026-10-16 from the Chromebook
(its files below).

**The keys a new house keeps itself** (since 2026-10-17): a house deployed
with only `SETUP_KEY` makes `MCP_SECRET`, `AGENT_SECRET`,
`PROGRAM_LIBRARY_KEY` and `HELPER_SECRET` at its claim, and keeps them in
`HOUSE`; the Spotify app's Client ID is given on the setup page
(`/setup/spotify-app`). A Worker secret of the same name always wins, so a
house installed from a terminal, like the owner's, keeps its own. The
connector's address is on the owner's checklist, with Copy.

**Backup** (since 2026-10-17): the setup page's Download a backup is a
small .json of the settings chosen on the page and the keys the house keeps
itself. It holds keys: keep it like a password. Restore from a backup puts
it back, on this house or a newly claimed one.

## Not installed, and what each would cost

Neither is part of a core install. Both work; both need accounts a
household would have to make.

**The archive button** — one preset that plays a family's own recordings
as an m3u this server hosts, rather than a streaming playlist. Needs
an `{ button = N, archive = true }` line and the archive's settings in
`house.json`. Its name, its DJ, who is on the tapes and its m3u key are
in one file, `mcp/archive-identity.js` (`ARCHIVE_M3U_KEY`, where set,
overrides the key): a different family's archive writes its own words
there.

**Its two tools appear only where there is an archive.** `search_archive`
and `play_archive` are titled after one family's tapes and would do nothing
useful anywhere else, so a house with no `archive = true` line is not shown
them and is refused in a sentence if a client that cached an older tool list
calls one anyway.

**The listener-request pipe** — a request form on each DJ page, fulfilled
by a Claude that wakes when someone asks. Needs `AGENT_SECRET`, both
switches flipped to `"true"`, and a routine configured at claude.ai, which
the house rings by web call (MC-31 stage 2): `requests.routine` in
house.json (the routine's id, rendered as `REQUEST_ROUTINE_ID`) and
`REQUEST_ROUTINE_TOKEN`, the token of the routine's API trigger (made on the
routine's page at claude.ai, shown once). The Durable Object it uses is
already bound in every install, so nothing changes in the config's shape.
(The GitHub doorbell repo and its `GITHUB_TOKEN`, the ring before
2026-10-16, were removed on 2026-10-23.) The routine works
through the "fmwax curator" connector (`/mcp/<AGENT_SECRET>`, the curator's
seven tools only), so it needs no `AGENT_SECRET` in its environment either.
Rotating the token: generate a new one on the routine's page, push it with
`wrangler secret put REQUEST_ROUTINE_TOKEN`; the old one stops at once.

**Talking to the room** (MC-15, planned 2026-09-11, `tasks/done/mc15-live-voice.md`)
— a Talk tab where a phone holds a voice conversation and the voice's backend
calls this server's tools through the Talk page's own door, with a
short-lived capability per conversation (plays, reads and rewrites
playlists, nothing else — `toollist.js` `VOICE_TOOLS`). Needs
`OPENAI_API_KEY` (the Worker mints each session with it; the phone gets a
short-lived credential and never the key). Billed by OpenAI per minute of
conversation; the server keeps a
daily ledger and refuses new sessions past the house's cap. Without the key
the Talk tab is not drawn and its doors do not exist.

**Last.fm for the DJs** (2026-10-18, `mcp/lastfm.js`; the trial,
`docs/research/lastfm-trial-2026-10-18.md`) — the curator's `look_up_artist`:
who Last.fm's listeners play alongside an artist, and their songs by
listening, read by the Worker and kept 90 days in KV (`lastfm:<artist>`).
Needs `LASTFM_KEY`: a free API key from last.fm/api/account/create (an app
name and a line of description; no callback). Free, no billing. Push it with
`wrangler secret put LASTFM_KEY`. Without it, `look_up_artist` carries no
Last.fm part, and the per-request notes don't mention it.

**The house's own MusicBrainz lookup** (2026-10-24, `mcp/musicbrainz.js`):
`look_up_artist` makes the artist's folder when the house has none: the
studio albums with their years, and the names the artist recorded under.
The Worker fetches them from MusicBrainz itself and keeps them in KV
(`research:<artist>`) for every DJ. `list_requests` does the same for a
Deep Dive job. A ChatGPT curator can't reach MusicBrainz, so this is how
its folders get made.
- **On by default, no key needed.** To turn it off, set `ARTIST_LOOKUP` to
  `off`: `wrangler secret put ARTIST_LOOKUP`. A name that found nothing is
  not asked again for an hour (`mbmiss:<artist>`).

## Where things sit on the install machine

Created by the install, mode 600, all gitignored — none of it should
ever be committed.

    mcp/.tokens/spotify.json    what the browser login returned
    mcp/.tokens/tidal.json
    mcp/.tokens/.pending-*.json a login started but not yet approved; it
                                holds no credential and is deleted the
                                moment the approval is used
    mcp/.secrets.json           the two generated keys, so the addresses
                                can be reprinted without a new deploy
    ~/.config/fmwax-owner/      the owner's house's claim (MC-31): the
                                spent setup key, the recovery code (it
                                signs a new browser in at /setup), and
                                curl's cookie from the claim
    ~/.config/fmwax-house/<account id>/<name>/
                                a house made by the terminal installer:
                                its setup key, its address, and the link
                                that opens its setup page with the key
                                (`--new-key` makes a new key)
    mcp/.door-<name>-<account>.toml  that house's config, rendered on
                                each run

**These are not all disposable.** The tokens are: delete them and
`node install/login.js <spotify|tidal> <client id>` signs in again. `.secrets.json` is not.
`MCP_SECRET` and `PROGRAM_LIBRARY_KEY` are write-only once pushed —
Cloudflare will not show a secret's value again, and nothing in the
Worker will print one — so this file is the **only remaining copy** of
the two addresses. Lose it and the addresses are not recoverable, only
replaceable: new keys, a new connector to add at claude.ai, and every
library link already sent to somebody stops working.

Back it up with the rest of the house, or accept that losing it costs a
rotation. The Worker itself is unaffected either way; it holds its own
copies and keeps serving the old addresses until new ones are pushed.
