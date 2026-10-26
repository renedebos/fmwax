# music-control MCP server

Curate from a phone, play on the WiiM. See [../docs/remote-control.md](../docs/remote-control.md)
for why this exists and what it replaces.

A Cloudflare Worker, no dependencies, speaking MCP Streamable HTTP.
`worker.js` is the entry (the fetch and cron handlers, and `__test` for the
tests); `programs.js` is the page template it renders. The server itself was
one 16,000-line worker.js until 2026-09-26 and is now split by what it does:

| File | What is in it |
|---|---|
| `routes.js` | every page and URL (`handleRequest`) |
| `tools.js` | what each MCP tool does (`callTool`) |
| `toollist.js` | each tool's schema and description; `AGENT_TOOLS`, `VOICE_TOOLS` |
| `mcp.js` | the JSON-RPC protocol |
| `now.js` | what is playing and on which speaker (`nowAnswer`, `pickFor`), the home helper's readings, the bar's pause note |
| `endless.js` | endless presets, the guest DJ on 3, the ten-minute watch, top-ups, steering |
| `house.js` | the buttons and guest presets from config, finding a DJ, the house clock in words |
| `room.js` | the preset roster, speakers, readings, faces |
| `shelf.js` | the Shelf, program records and covers, the words after a play |
| `writes.js` | activate_program, revise_program, request events |
| `playback.js` | starting music on a speaker |
| `playlists.js` | safe playlist writes, snapshots, undo |
| `services.js` | Spotify and Tidal calls and tokens, budgets and meters, KV, the quota note |
| `archive.js` | the archive, a house's own recordings (whose: `archive-identity.js`) |
| `settings.js` | the house's settings in the `HOUSE` object (MC-31), read on every request with the vars underneath |
| `claim.js` | claiming a house once with its `SETUP_KEY` at `/setup`: the owner's cookie and recovery code (MC-31) |
| `checklist.js` | the setup checklist the owner sees at `/setup`: each step ticked by looking at the house (MC-31) |
| `rules.js` | docs/house-rules.md, copied by `npm run rules` for the House rules page |
| `station.js`, `voice.js`, `djs.js`, `catalog.js`, `spotify.js`, `tidal.js`, `keymap.js`, `icons.js` | as before |

## Tools

| Tool | What it does |
|---|---|
| `get_dj` | The house DJs and their briefs. Call first when one is named. With `ask` (the listener's words), a DJ with a roll call also returns the acts from it that fit (`mcp/rollcall.js`, data in `mcp/rollcalls.js`, built from `tasks/rollcalls/`). |
| `search_tracks` | Resolve tracks to URIs, one or a whole set at once, concurrently. Lookup, not recommendation. (`search_track`, its one-track twin, went on 2026-10-12.) |
| `list_devices` | Find the WiiM. |
| `play_uris` | **The point.** Play an explicit ordered list Claude chose. |
| `play_playlist` | Play a saved playlist *as a playlist*. The only playback that a WiiM preset can be saved over. |
| `replace_playlist` | Overwrite a saved playlist. Loads music for later; does not play. |
| `append_to_playlist` | Add to the end of a playlist. How a long set is built while it plays. |
| `restore_playlist` | Undo for `replace_playlist`. Previews first; writes only on `confirm`. |
| `make_librarian_program` | Research, a survey of a subject with a boundary, and playlist in one action. Publishes a page; loads the button only if asked. (`make_professor_program`, the argued version on the same machinery, went with the Professor, 2026-10-15.) |
| `list_programs` | What has been published. Pass an id for the whole record. |
| `play_program` | Play an old program as the Shelf's Play does: its preset if one holds it, else its own tracks. Writes nothing. |
| `activate_program` | Put an old program back ON the button. Backs up what was there. |
| `unpublish_program` | Delete one permanently. Previews first. |
| `revise_program` | Edit a kept set's tracklist and page together, with a reason the page shows. Setlists only; writes the button only when the set is on air. |
| `read_playlist` | What is on a playlist, and how much is left if it is the one playing. |
| `now_playing` | What is on, where, how far in, shuffle/repeat state. |
| `recently_played` | The last 50 Spotify plays, each labelled with the button or DJ it came from. |
| `search_archive` | The live-recording archive: 136 songs, 680 takes, with duration/venue/source and loudness range. |
| `play_archive` | Loads up to three takes onto the archive button. Does **not** start playback — nothing here can. |
| `playback_control` | pause / resume / next / previous / volume. |

## Two ways to play, and only one is preset material

`play_uris` hands the speaker a bare list of track URIs. `play_playlist` hands
it a `context_uri`. **They are indistinguishable by ear** — same tracks, same
order — and the difference matters exactly once: when a WiiM preset is saved.

A preset snapshots what is being handed over. Over a `context_uri` it stores a
pointer, which is the whole mechanism behind the physical buttons: rewrite the
playlist and the button plays the new thing. Over a bare URI list there is no
pointer to store, so the slot pins the single track that happened to be playing
and then falls through to Spotify autoplay — plausible-sounding music chosen by
the engine this repo exists to bypass.

So `play_uris` stays the tool for a set Claude just curated, and `play_playlist`
is the tool for anything a button touches.

One caveat found on the device: **`play_playlist` is not a reliable way to set up
a preset save.** Playback is correct — right context, right device, position
advancing — but the WiiM's own metadata can stay blank after an API-initiated
start, and the WiiM app will not save a slot from a blank now-playing card.
Press play in the Spotify app for that one job. `play_playlist` remains the tool
for playing a saved playlist and for answering "is this preset material". `now_playing` reports `context` for
this reason: `null` means whatever is on is not preset material.

`play_playlist` also clears **shuffle and repeat-one** before starting. Both
survive a context start, and repeat-one is the nastier of the two — it reports a
perfectly good playlist context while looping the first track forever. If it
refuses to clear, the tool says so rather than reporting a set that is not
playing.

## The house: buttons and aliases

`replace_playlist` takes a playlist as a label, an id or URI, or an exact name.
The labels come from two `[vars]` in `wrangler.toml`. `BUTTONS` is the house —
which DJ sits on which preset, holding which playlist, on which catalog:

    BUTTONS = [
      { button = 1, dj = "dr-funkenstein", playlist = "<the preset's playlist id>", catalog = "spotify" },
      { button = 6, archive = true },
    ]

Each entry gives the label `"button N"`, and the DJ named there is the button's
standing owner (`get_dj`, `read_playlist` and the buttons page all take it from
here — the DJs in `djs.js` know nothing about buttons). `catalog` is `"spotify"`
or `"tidal"`; only Spotify can be reached by this version, and a Tidal button is
refused in words by every tool that would touch it rather than searched for by
name. `PLAYLIST_ALIASES` holds the labels nothing physical points at — the replay
playlist — and refuses a `"button N"` key, so a preset's playlist is only ever
said in one place:

    PLAYLIST_ALIASES = '{"replay": "<the replay playlist's id>"}'

**Crates and the wall are gone.** MC-11's crates (a playlist of a benched
DJ's own) and the wall's moves went with MC-18's stage 6 (2026-09-26): a DJ's
set lands on the requests preset for its service (`destinationFor`), and an
endless DJ's on their own preset. The old crate playlists stay in the alias
map as `was … crate …` while their 90-day backups last, because that map is
the membership set `undoToSnapshot` checks a saved copy against.

A label is **only a label**. This server has no LAN path to the speaker, so it
cannot check that preset 1 still points where the house says — re-point the
button in the WiiM app and you must edit this too. That is also why there is no
`preset` parameter: a number would imply the server knows something it cannot.

Resolution is fail-closed at every branch, because a wrong guess overwrites the
wrong playlist and there is no undo:

| Input | Behaviour |
|---|---|
| a configured alias | wins over a playlist of the same name |
| alias to an unreadable id | stops and names the alias. **No** fall-through to a name search |
| alias to a readable but unwritable playlist | stops and names the alias, id and playlist |
| id or `spotify:playlist:` URI | used directly |
| exact name, one match | used |
| exact name, several matches | refused; pass an id |
| no match | refused, with the visible names listed |

That last-but-one case is not hypothetical: a well-formed id can belong to a
stranger's public playlist, which reads fine and rejects the write.

It never creates a playlist. `--name` on the CLI does; the tool deliberately
does not, so a typo cannot quietly produce a second playlist no button points at.

Two limits accepted knowingly:

- **A set over 100 tracks is written as several requests** — one replacing PUT
  then appending POSTs — because that is the API's cap. Two overlapping calls on
  the same playlist could therefore interleave into a mix of both, each
  reporting success. Single-user setup, so this is a real race that cannot
  practically happen; it would need locking to fix properly.
- **If a later batch fails, the replacement has already happened.** The PUT does
  not roll back, so the old contents are gone and the playlist is left short.
  The error says so and gives the count that landed — re-run to finish.
- **A 22-character alphanumeric input is read as a playlist id**, so a playlist
  whose *name* is exactly that shape cannot be addressed by name. Give it an
  alias.

## The catalog: Spotify and Tidal behind one seam

Everything that reads or writes a playlist goes through the interface in
[`catalog.js`](catalog.js) — ten verbs (`playlist`, `items`, `myPlaylists`,
`replaceItems`, `appendItems`, `describe`, `createPlaylist`, `track`,
`search`, `byIsrc`) and the shapes they answer with. [`spotify.js`](spotify.js)
and [`tidal.js`](tidal.js) each implement the same verbs and nothing else: the
backups, the read-back check, the room pages and the tools never name a
service.

The shapes are Spotify's own field names, cut down to what the Worker reads;
Tidal's JSON:API maps into them. Track identity is `"<catalog>:track:<id>"`,
and the tools check every URI against the catalog of the playlist it is bound
for once that playlist is resolved — `tidal:track:…` aimed at a Spotify
playlist is refused before the backup is taken.

**Tidal has no replace.** Rewriting a playlist there is a clear and then a
refill, fifty at a time, and a failure in between leaves the playlist holding
neither set. The adapter reports that as a *torn* write rather than "nothing
was written", and the safe-write path puts the backup straight back and says
what happened — it never throws past that point, because a throw invites a
retry. "Nothing was written" is claimed only when Tidal *refused* the call (a
4xx) or the Worker never sent it; a 5xx or a lost answer on the first call is
treated as torn too, since the work may have been done.

Tidal also rations calls (about five in hand, two a second back), so every
Tidal call goes through one lane, half a second after the last, and a 429 is
retried once after its `Retry-After`. A 401 on a cached token is retried once
with a fresh one. Its secrets are `TIDAL_CLIENT_ID` and `TIDAL_REFRESH_TOKEN`
(the token lives in KV under `tidal` after first use, like Spotify's); the
country is the var `TIDAL_COUNTRY` (default `NL`). One account per catalog.

**A playlist is `(catalog, id)`, and the id says which.** Spotify's ids are
22 base-62 characters and Tidal's are UUIDs, so a button's `playlist`, an
alias's value, a bare id, a URI or a share link each names its own service by
shape, and nothing stores a catalog beside an id. A name is looked for on
every service the house has buttons on, and one found on both is refused
with both ids. In a house whose buttons are on both services,
`search_track`, `search_tracks` and `create_playlist` take a `catalog`
argument; `get_dj` and `list_requests` say each DJ's catalog beside the
button, so the curating routine knows what to pass.

Playback is **not** behind the interface. Play, transfer, volume and "what is
playing" are Spotify Connect and stay so. A Tidal button is read and
rewritten like any other, but it is started from the remote: `play_playlist`,
the room page's Play and a programme replay through a Tidal playlist all
refuse in words that say which preset to press, and the page shows *press N
on the remote* where the Play form would be.

The pages follow the id too. A programme's rows link to the record on its
own service (`open.spotify.com/track/…` or `tidal.com/browse/track/…`) and
its masthead says *Open in Tidal ↗* when the set sits on a Tidal button —
`serviceLink` in [`programs.js`](programs.js), which builds every such link
from a checked id and never from a stored URL. Sleeves and covers are admitted
from the two image hosts only, each in its one measured shape
(`i.scdn.co/image/…` and `image-cdn-xx.spotifycdn.com/image/…`;
`resources.tidal.com/images/<uuid as five segments>/<W>x<H>.jpg`), and the
CSP `img-src` of the buttons, DJ and library pages names both hosts and no
other.

## Every destructive write is backed up first

`replace_playlist` reads the playlist into KV before it overwrites it, and
`restore_playlist` puts it back. Copies keep both the URIs **and the titles**,
because a URI stops resolving when a track is pulled and then the title is the
only thing that says what was there.

This exists because of a real loss on 2026-08-27: `spotify_cli.py playlist --id
X` with no `--uris` reads its URIs from stdin, an agent's stdin is an empty
pipe, and a command that looked like a query emptied a 24-track playlist. It was
recovered from a chat transcript, because nothing here had kept a copy. **The
Web API has no undo and `snapshot_id` is not a restore point.**

What it does and does not promise:

- **Copies are versioned**, `snap:<playlistId>:<ms>-<salt>`, and last 90 days.
  A single slot per playlist would look like an undo and stop being one on the
  second write, when it buried the copy actually wanted back. Restoring twice
  steps back through them rather than toggling.
- **A copy that cannot be trusted refuses the write**, before Spotify is
  touched: a truncated read, an unreadable entry (no URI, so restoring shifts
  everything after it), or a local file (which the Web API cannot re-add).
- **Only writes made by this server are covered.** A playlist edited in the
  Spotify app leaves nothing to restore, and the tool says so rather than
  guessing.
- **`restore_playlist` previews by default.** Without `confirm: true` it reports
  what would come back and changes nothing.

`replacePlaylistSafely` is the single path all of this runs through. Its
contract: it throws freely **until** the PUT goes out and never after it. Past
that point a throw reaches the model as *"it did not happen"*, so the model
retries — and a retry rewrites the button a second time and buries the first
backup. Everything after the point of no return is reported in the result.

A verification mismatch **does not** roll back. A read straight after a write
can be stale, and rolling back on one would destroy a playlist that is correct;
it warns instead. A failed write does roll back, and if the rollback also fails
the result says exactly that rather than claiming the old contents are safe.

## Programs

A **program** is a set with something written down beside it: prose with its
playlist, stored whole and served at a permanent URL. There is no draft and no
approval step — the audience is one person, so a review gate would be a tap that
never changes an outcome. Validation is technical, never editorial.

    make_librarian_program -> published; the button only if load_button
    make_gatefold_program  -> the same, in Gatefold's register
    GET /programs/<slug>   -> the article

(Since 2026-10-15 the two who write are the Librarian and Gatefold: the owner
cut the Professor, and `make_professor_program` with him. His records keep the
`argument` shape and render as below.)

**Two characters write them, and the machinery is one implementation.** The
Professor programs by argument — a set is a thesis and every track is evidence.
The Librarian programs by scope — a subject with a fence around it, and the set
is a tour of what is inside. Both hand over the same record shape; what differs
is the discipline each tool's description carries, and two fields the page
labels from the record's `shape`:

| | argument | survey |
|---|---|---|
| `thesis` is | the claim the set demonstrates | the fence: what is in, what is out |
| `complications` is | the competing reading, and why the thesis survives it | what was left out, and why |
| `coda` is | what the set is arguing | where to go next |
| the eyebrow reads | Program | Survey |

Both `complications` are **required**, and they are the same mechanism doing the
same job for different characters: the field that stops a program being liner
notes. A record written before `shape` existed renders as an argument, which is
what every one of them was.

**Which character is writing comes from the TOOL NAME, never from a parameter.**
An MCP client drops arguments its cached schema does not know about — that is
how a `load_button: false` got stripped and rewrote a button against an explicit
instruction — and a dropped `dj` would publish one DJ's work under another's
name and onto another's button. A tool name cannot be dropped. It also lets each
description carry that character's full discipline, which is where the curation
in this repo actually lives.

**The identity check is the point of the whole thing.** Claude hands over URIs it
got from `search_tracks`, and a URI can be a re-recording, a live take, a
covers-band upload or the wrong artist entirely. A read-back only checks the
ORDER, so every one of those verifies green — a program arguing about the 1968
single ships with a 2004 re-cut in slot three, permanently, and no machine
listens to the result. So every track is looked up **before** anything is
written, and the whole call is refused if the artist contradicts the essay.

Two honest limits on that check:

- **It cannot see a later mix credited to the same artist.** A Director's Cut
  revision of a Frankie Knuckles record is Frankie Knuckles by every field
  Spotify exposes. A second check covers that one and is worth describing,
  because the obvious version of it does not work:

  **Release year alone is useless.** On a real twelve-track program it fired
  seven times — a 1973 record on a 2018 compilation looks exactly like a remix —
  and buried the single true positive in six false ones. It shipped that way and
  the wrong record went out anyway.

  **The signal is the conjunction**: a version marker in the TITLE, *and* a
  release far from the year the essay claims, *and* a marker that does not name
  that year. A reissue has no marker. A period mix names its own year
  (`Jack Your Body - 1986 Club Mix`). A contemporaneous twelve-inch is not far
  away. Only the late remix satisfies all three — one flag on the same twelve
  tracks, and it is the right one. See `versionSuspect` in `programs.js`.

  It reports rather than refuses: only a listener can say whether a period mix
  on a late pressing is the wrong record.
- **Nobody reads the prose before it publishes.** That is the real cost of
  removing the approval step. Citations attach to paragraphs rather than
  trailing as a bibliography, and the tool says plainly: if a date cannot be
  sourced, write it as a claim rather than dressing it as scholarship.

Other decisions worth knowing:

- **Programs are immutable, with one exception.** A correction to an essay is
  a new program; the old one stays readable. `unpublish_program` is the only
  way to remove one, because permanent model-written prose at a stable URL
  with no take-down path is not acceptable. The exception (2026-09-07) is a
  **setlist** — a kept request set or an archive set, no prose — whose
  tracklist `revise_program` can rewrite in place with a stated reason; the
  page then carries a *Revised* line per revision, so it never reads as
  though it had always been right.
- **The slug carries six random characters**, because KV has no conditional
  write and a title-derived key would eventually overwrite an immutable record.
- **`/programs` and `/programs/` 404.** The shelf is a separate route,
  `/notes/<PROGRAM_LIBRARY_KEY>` (the old `/library/<…>` was removed on
  2026-10-18) — because an unguessable
  slug per program stops protecting anything once something lists them all. That
  key is the whole of what guards it, weaker than `MCP_SECRET` deliberately. It
  is **no longer read-only**: since 2026-08-28 the page activates a programme
  onto its writer's button and undoes that again, so whoever holds the link can
  change what a button plays. Bounded on purpose — only a published programme,
  only onto its own writer's button, so the worst it does is play the owner their
  own music. **Nothing links to the shelf from a program page**, so
  sending someone one program still sends them exactly one program. The page is
  `no-store`, unlike a program: it changes whenever one is published, and a
  cached shelf is one quietly missing the newest thing. **And since 2026-09-10
  every row carries the action its service allows:** a Spotify row has
  **Play**, which starts the record's own tracks on the speaker chosen at the
  top of the page (`POST /notes/<key>/play`, the same start as `play_uris`,
  no playlist written, nothing on the presets changed); a Tidal row is put on
  its DJ's preset or crate and, once loaded, offers *Open in Tidal* and the
  number to press, because nothing on a server can start Tidal; an archive
  row goes on the archive preset. The Play button sits outside its form and
  names it with the `form` attribute, so the row's own chooser form and the
  page's one speaker select coexist with no script.
- **The bar, the DJs tab and the Home Screen** (MC-14, 2026-09-11). Every
  keyed page carries four tabs fixed to its bottom — Speakers, DJs, Shelf,
  Loaded, and Talk fifth where a voice is set (Speakers first since
  2026-09-27; Loaded was Presets, and first, until then) — links and no script, the active one decided by the route,
  the Speakers tab wearing the count of presets owed a re-save. **The Shelf**
  is the page above (Program Notes until then; the routes are unchanged).
  **`/buttons/<key>/djs`** is the DJs tab: every DJ once, a number tile for a
  preset, *Crate* or *Ask* for the bench, three filter links; declared
  before the DJ page's catch-all, so no DJ can be called "djs". The wall lost
  its bench section to it; the drop bar is the one take-off target and the
  bar hides while a band is lifted. **`/buttons/<key>/manifest.webmanifest`**
  is what Add to Home Screen reads (start_url the Speakers tab with the key, scope `/`,
  standalone, both colours, the icons); the icons are public PNGs at
  `/icon-192.png`, `/icon-512.png` and `/apple-touch-icon.png`, served from
  `icons.js`; the keyed pages link the manifest and wear the Apple metas, a
  public programme page does neither. **`/buttons/<key>/<dj>/preset`** is
  the sheet for a benched DJ — "Put <DJ> on a preset", the picker reversed:
  every live preset a link into the picker's confirm (`?dj=<key>&from=dj`),
  with who leaves and what the DJ would arrive with on that service; the
  press returns to the DJ's page (`return=dj`). **`/buttons/<key>/programs/<slug>`**
  is a programme read inside the app: the same page with the bar and a way
  back (`?from=<dj>` → that DJ, else the Shelf), because the public page
  links nowhere and an installed app has no browser back; every keyed page
  links this twin, the tools still return the public URL. Plan:
  `tasks/done/mc14-tab-bar.md`.
- **Talk, the fifth tab** (MC-15, 2026-09-12; by the minute since MC-16 the
  same day). **`/buttons/<key>/talk`** is one hold-to-talk control, a hang-up
  button while a line is open, the last exchange as two lines, the speaker
  chooser and the day's minutes — drawn in the bar, and answering at all,
  only where `OPENAI_API_KEY` is set (tab absent and page 404 otherwise).
  The page holds no credential. Its script posts an SDP offer to
  **`POST /buttons/<key>/talk/session`**: the Worker opens a row in the
  ledger (`station.js`, the `voice-*` ops; the day is the house's, from
  `HOUSE_TZ`, else the Tidal country's capital, else UTC) if at least a
  minute of the day's sixty is left, builds the GPT-Live session —
  `gpt-live-1` with the voice prompt, delegating to `VOICE_BACKEND_MODEL`
  (default `gpt-5.6-terra`) with the backend prompt, the voice's function
  definitions and `web_search` — binds OpenAI's session id to the row, and
  returns the answer with a per-session capability. **A line is charged by
  the server's clock** from the moment it opens to the moment the ledger
  considers it over; the page never sends a number, only "still here"
  (**`POST /buttons/<key>/talk/beat`**, every thirty seconds) and "done"
  (**`POST /buttons/<key>/talk/closed`**), on which the ledger hangs up at
  OpenAI itself over the documented sideband and stops the clock. A line
  that stops beating is over at the end of a ninety-second grace and hung
  up by the ledger object's alarm; the alarm is armed for the moment the
  day's minutes run out and hangs up whatever is open then. The row goes
  back only on an unambiguous refusal from OpenAI (a 4xx). The model's
  voice arrives over WebRTC. Every tool the backend asks for comes back
  through **`POST /buttons/<key>/talk/tool`** under `X-Talk-Session`,
  checked in the one order that works: origin, media type, capability
  shape, capability live, the allowlist and a bounded plain parse, then the
  speaker rule — a start, a resume or a volume must name a speaker on
  `ROOM_DEVICES`, any speaker named is checked whole, every speaker equal —
  then `callTool`. The voice's list (`VOICE_TOOLS`): play, read, search and
  rewrite playlists, and since 2026-09-12 the seven programme writers and
  `activate_program` — not the delete, the moves or the requests. Every
  body is read under a ceiling. **`talk_ledger`**
  (owner only) reads a house day's seconds and lines and can relabel a
  day's rows. Rules and prompts are `voice.js`; design
  `tasks/done/mc15-live-voice.md`, the minute rule `tasks/done/mc16-minutes.md`.
- **`/buttons/<key>` is the room's front door** (added 2026-08-29): a grid of
  the DJ presets and the archive, `/buttons/<key>/<dj>` one DJ's room —
  premise or recorded ask, the tracklist on the button, a writer's latest three
  programmes — and `POST /buttons/<key>/<dj>/play` starts a set through the
  same verified machinery as `play_playlist`. Same key as the notes page: one
  surface, one credential. Three bounds carry the security: the DJ comes from
  the path (fixed slugs, fail closed), the speaker must be on `ROOM_DEVICES`
  (config, not discovery — a form field cannot aim the account at an arbitrary
  device), and mutation is POST-only behind the same origin rule as the
  chooser. Unlike the notes page a view here DOES call Spotify — live-ish
  state is its value and the route is keyed — held to ~1 external call warm by
  a ten-minute `tile:<playlistId>` KV cache that every write through this
  server deletes. Its CSP adds `*.spotifycdn.com`, because uploaded playlist
  covers do not live on `i.scdn.co` and `imageUrl` would blank every one —
  `playlistCoverUrl` pins those hosts. Captions never overclaim: "last loaded"
  (the pointer records what this Worker last wrote), "Spotify is quiet on this
  account" (`/me/player` cannot see the archive or another input).
- **The page is `no-cache` with an ETag over slug + template version + whether
  the set is on the button**, not `immutable` and no longer `max-age=300` — the
  *record* is immutable and the *template* is not, and a year-long cache would
  stop an improved page ever reaching anything already published. The five
  minutes went when the listen link became conditional on which set is on the
  button: it bought a window in which the page could still claim a set was
  loaded after it had moved on, which is the exact quiet wrongness the
  conditional link exists to prevent. The ETag keeps revalidation at a 304, so
  the cost is a conditional request rather than a re-render. Bumping
  `TEMPLATE_VERSION` on a markup change is not optional: a browser holding the
  old ETag revalidates to a 304 and keeps the old page indefinitely, which
  `max-age` cannot rescue.
- **Every track row links to the record on Spotify**, built from the stored URI
  after re-checking it against `^[A-Za-z0-9]{22}$`. That is a *reference*
  affordance and not a way to play the program: one tap plays one track and then
  Spotify autoplays its own suggestions, which is the sequence the essay argues
  against.
- **A listen link appears only while `current:<playlistId>` still names this
  program.** A permanent link to a playlist that gets rewritten would spend most
  of its life playing something else — wrong quietly, which is worse than
  absent. The route reads one KV key to decide and **never calls Spotify**: it
  is public and unauthenticated, so a page view must not spend the account's
  subrequest budget or reach for its token.
- **`play_program` writes nothing.** Since 2026-10-12 it is the Shelf's Play
  (`playShelfSet`, shelf.js): the preset that holds the set if one does,
  otherwise the set's own tracks, with the Shelf's record of whose they are.
  Until then a set no preset held was copied to the replay playlist first.
  `replay` stays for Talk: a set asked for with no DJ is written there.
- **A programme goes back to the DJ WHO WROTE IT, read from the record.** The
  shelf lists everybody's work behind one key, so the thing that keeps that key
  bounded is that a row can only ever reach its own author's playlist — a
  Librarian survey cannot be pressed onto the Professor's button. `programDj`
  resolves it, and a record with no `dj` at all falls back to the Professor,
  which is not a guess: the field has been written since programs existed, so a
  record missing it predates there being anyone else. (He was cut on
  2026-10-15, so such a record finds nobody now and is refused in words, as
  any cut DJ's is.) More than one row can be
  live at once now, so the on-air marker is a set of slugs and reads *On The
  Librarian's button* rather than *On the button*.
- **`activate_program` writes the DJ's CONFIGURED playlist**, not the
  `playlistId` frozen in the record — an alias re-pointed since publication
  would otherwise send an old set into whatever that id is now. When the two
  disagree it **refuses**: writing to the configured one would set
  `current:<new id>` while the program's page reads `current:<the id it was
  published to>`, so the page would either hide the link for a set that is on
  the button or offer one pointing where the set no longer is. It starts
  nothing; `play_program` afterwards plays it straight from the button and
  writes nothing.
- **A verification mismatch clears the pointer instead of setting it.** Two
  disagreeing read-backs mean the playlist contents are unknown, and a listen
  link on a public page for a set nothing can confirm is worse than no link.
  Suppressing a good pointer costs a link the next write restores. A pointer
  write that fails is retried once and then reported as a warning — it stopped
  being cosmetic when it started driving a public link.
- **`read_playlist` reports the program a button is currently showing**, and a
  plain `replace_playlist` clears it. Notes that no longer describe the playlist
  are worse than none.

Two Worker vars: `PROGRAM_BASE_URL` (the tool layer never sees a request, so the
origin is configured rather than derived) and `PROGRAM_REPLAY_PLAYLIST`.

### `GET /v1/tracks?ids=` is 403, and `GET /v1/tracks/{id}` is not

Measured 2026-08-28. The several-tracks endpoint answers the same featureless
`Forbidden` as the playlist paths that February 2026 renamed, and it reads
exactly like a scope problem. The single-track endpoint works.

The consequence is the program size limit: one subrequest per track rather than
one per fifty, so a program caps at **30 tracks** — the same ceiling
`search_tracks` already uses, for the same reason.

## Listener requests

Any DJ page carries a small form: mood or occasion, a length (30/60/90), an
optional avoid. Submitting it is the whole interface the household has — what
happens next is a pipeline with one rule everywhere: **the family gains a
voice, not the keys.**

The pipe: the Worker stores the words in KV (`request:<id>`) and a row in the
claim ledger, then rings the curator with the request's random id: a web call
to its routine's API trigger (`fireRoutine`, `REQUEST_ROUTINE_ID` and
`REQUEST_ROUTINE_TOKEN`), which wakes a Claude routine ("Radio requests
curator" at claude.ai/code/routines) in about a second; an hourly check on the
same routine sweeps stragglers. The routine speaks to this Worker through the
"fmwax curator" connector, whose address carries `AGENT_SECRET` — a second
credential that answers to the curator's tools only (`AGENT_TOOLS` in
toollist.js). Nothing else answers it: no playback, no button change, no
owner surface. It curates as the DJ, replaces the DJ's own button playlist
through the same backed-up safe write as every other write, and records Ready.

**Until 2026-10-16** the ring was a file committed to a private GitHub
doorbell repo, whose push woke the routine; it stayed as the fallback until
2026-10-23, when it was removed with its token. **Since 2026-10-19 a ChatGPT curator
can hear it too** (MC-31 stage 6b, `curator-events.js`). A Work chat
subscribes to the `house.work` event on the curator's door, which speaks
MCP 2026-07-28 beside the legacy versions. `emitRequestEvent` then sends
each live subscription a signed web call (Standard Webhooks) carrying the
work's id only. Subscriptions are kept in PROGRAMS under `events:subs`, and
`list_requests` shows how many (`event_subscriptions`). Until the setup
page lets a house choose one curator, the owner pauses the Claude routines
while ChatGPT is tried.

**States** (mcp/station.js is the machine): pending → claimed (leased, held
by a token) → ready | needs-attention; declined and dismissed leave from
pending; superseded and changed-since are DERIVED on every page load, never
stored — Ready renders only while the live playlist's ordered-URI
fingerprint still matches the fulfilled one. The ledger is ONE SQLite-backed
Durable Object (STATION binding) because the fired run and the sweep are
concurrent by design and KV cannot serialize their claims; everything else
stays in KV.

**Keeping one** (groundwork; nothing calls it yet): a fulfilled request can
reserve exactly one page for itself. `keep-reserve` stores a `kept_slug` on
the row — and hands the SAME one back to every later caller, because
`makeSlug` salts each slug it makes and two curators would otherwise publish
two permanent URLs instead of overwriting one. `keep-commit` sets `kept_at`,
after which the request refuses to be kept again and names the page that
already exists. Deliberately unleased: a rival arriving mid-flight can write
its own curation over the same key, which is one URL with different prose —
the harmless shape of the race, for a window one KV put wide.

**Recovery**: every fulfilment snapshots before writing (same 90-day backups
as replace_playlist); a dead claim's lease expires and the next curator
reconciles against the LIVE playlist before deciding — an uncertain outcome
lands on needs-attention, which never retries and waits for a person (the
card has an acknowledge). A pending request can be withdrawn from the page.

**Retention, and the one copy it cannot cover**: pending text lives 30 days,
settled outcomes 90 — but text a Claude run has READ lives on in that run's
transcript beyond both. That is why every payload that leaves the Worker
(the routine's ring, a ChatGPT event, the URL bar) carries the opaque id ONLY
and the words never ride in any URL.

**Switches and secrets**: `REQUESTS_ENABLED` gates the form,
`AUTOFULFILL_ENABLED` gates the doorbell — two [vars], so requests can be
collected without spending cloud sessions. Secrets: `AGENT_SECRET` (the
curator connector's address, `/mcp/<AGENT_SECRET>`) and
`REQUEST_ROUTINE_TOKEN` (the routine's trigger). Rotating AGENT_SECRET:
`wrangler secret put`, then remove and re-add the "fmwax curator" connector
at claude.ai with the new address, and attach the new one to the routine on
its page (claude.ai/code/routines): a routine keeps its own copy of a
connector, and the old one answers 404. The curator misses its runs in
between.
**Keeping one** (MC-08): tick *Worth keeping* on the form and the fulfilled
set gets a page of its own — a `setlist` record on the same shelf as the
essays, at a permanent public URL, put back on a button any time with
`activate_program`. The curator writes the title and one line of intro and
NOTHING else: the tracklist comes from `fulfilled:<id>`, the read-back that
proved the write landed, so a page cannot describe a set the button never
held. The listener's tick is required, the DJ comes from the ledger row, one
page per request is enforced by `keep-reserve`, and nothing here reaches a
button.

WHAT the DJ writes depends on the DJ. The two writers (the Librarian and
Gatefold, since 2026-10-15) owe their programme —
thesis, sections, complications — and each section says how MANY of the set's
tracks it covers, in order, so the writer divides a tracklist that already
exists instead of choosing one. Everyone else owes one line. Both shapes are
built from the same snapshot, which is why a kept programme has no track
ceiling: the app's `make_*_program` tools resolve one Spotify lookup per claim
and cap near 38, and this resolves nothing (tasks/done/mc08-write-it-up.md).

## Tests

    cd mcp && npm test

The station ledger has a second, deliberately small suite that runs the
real Durable Object in workerd: `npm run test:workerd` (vitest 4 and
Cloudflare's `@cloudflare/vitest-plugin`; package.json's `overrides` lift
three of the plugin's pinned dependencies past known advisories).

`node --test`, no dependencies beyond two dev tools: esbuild (pinned to the
deploy's wrangler's version, to bundle as the deploy does) and acorn. It stubs `globalThis.fetch` and KV rather than
injecting a client, so the code under test builds its own URLs and refreshes its
own token exactly as it does in production. The cases that matter are the ones
that cannot be produced on demand against the real API: a failure after the
first batch, a rollback that itself fails, a truncated or holed backup, a
verification mismatch, and a relinked track (which must not read as a mismatch).

`test/catalog.test.js` runs one contract suite against both adapters — the same
assertions, each with its own fake wire — and `test/tidal.test.js` puts a fake
Tidal at `fetch` for the moments a clear-then-refill can go wrong: the refill
that fails after the clear, the clear whose answer was lost, the rollback that
fails too, the budget that must stand down past the first write, and the one
429 retry that must never become a third try.

## Long sets stream

A four-hour set does not have to be finished before it starts. Verified on the
device 2026-08-25: tracks appended to a playlist that is already playing appear
in `GET /me/player/queue` within six seconds, in the right position.

So: `replace_playlist` the first block, start it, `append_to_playlist` the rest
while it plays. `read_playlist` reports what is left when the playlist is the
live one — that is the number to watch.

**Running dry used to be the failure mode**, and it was quiet: Spotify autoplay
filled the gap with algorithmic suggestions that sounded plausible. **Autoplay
was turned off on this account on 2026-08-26**, so a dry set now ends in silence
instead. That is the better failure — it is audible — but it is still a failure
if the user wanted to keep listening. Buffer in minutes.

Both tools refuse rather than mislead. A read that cannot page the whole
playlist says so and withholds the total duration and the remaining time instead
of computing them over a fragment. A read with no lookup budget left errors
rather than reporting an empty playlist. An append too large for the remaining
budget is refused before it writes anything, and one that fails part-way
distinguishes what is confirmed added from what may or may not have landed —
retrying the latter can duplicate tracks.

## Deploy

    npx wrangler kv namespace create TOKENS     # paste the id into wrangler.toml
    npx wrangler kv namespace create PROGRAMS  # and this one

    npx wrangler secret put SPOTIFY_CLIENT_ID
    npx wrangler secret put SPOTIFY_REFRESH_TOKEN
    npx wrangler secret put MCP_SECRET        # long random string, see below
    npx wrangler secret put TIDAL_CLIENT_ID      # only for a house with a Tidal button
    npx wrangler secret put TIDAL_REFRESH_TOKEN  # from tidal/probe.py's login; TIDAL_COUNTRY is a var
    npx wrangler@4.129.1 deploy

**The version is pinned on purpose, and the reason survived the thing that
caused it.** Wrangler is not a dependency here — there is no `node_modules`, no
lockfile, nothing in `package.json` — so a bare `npx wrangler` runs whatever the
npx cache happens to hold. The pin was first put in because **wrangler 4.87.0
hard-fails on Node.js below 22** and this box was on Node 20, which made three
of the four cached versions unrunnable. Node is 22 now and that half is gone.

**The pin stayed anyway, because the cache is the real hazard.** Measured on
2026-09-08, minutes after the Node upgrade: a bare `npx wrangler deploy` ran
**4.42.2**, an old version sitting in the cache, not the current release. A
deploy that silently picks its own tool version is the thing being prevented,
and that was never about Node. So the number moves; the pin does not go.

`compatibility_date` pins the Worker's *runtime*; this pins the tool that
builds and uploads it. They are separate, and only the second one drifts.

**`npm run deploy` opens every page first** (`dev/pagecheck.mjs`, since
2026-10-12; `npm run check:pages` alone). It builds the deploy's own bundle
with wrangler's dry run, serves the preview house from it, opens each tab in
headless Chromium and hands the bar every kind of answer it draws, its panel
shut and open; a script error stops the deploy. The tests run the source and
cannot see this: from `a15a3548` the bundle's `__name` broke the bar for a day
and a half with every test green. It needs Playwright from `tools/browser/`, and
a house without it is told so and not stopped.

Values for the first two come from the local CLI, which must be logged in
(`spotify_cli.py login`):

    python3 -c "import json;print(json.load(open('$HOME/.config/spotify-wiim/config.json'))['client_id'])"
    python3 -c "import json;print(json.load(open('$HOME/.config/spotify-wiim/token.json'))['refresh_token'])"

Generate the third:

    openssl rand -hex 32

## Connect it to Claude

Add a custom connector in claude.ai settings pointing at:

    https://<your-worker>.workers.dev/mcp/<MCP_SECRET>

Then, from the phone: *"play deep cuts of Parliament and move into rare Prince."*

## The 403 was a renamed endpoint, not a permissions problem

Solved 2026-08-25. Spotify's **February 2026 Development Mode changes** renamed
the playlist-contents endpoints and withdrew one outright:

| Old path | New path |
|---|---|
| `GET/PUT/POST/DELETE /playlists/{id}/tracks` | `.../items` |
| `POST /users/{id}/playlists` | `POST /me/playlists` |

The old paths answer a bare `403 Forbidden` — no `Reason`, no
`WWW-Authenticate` — which reads exactly like a scope or account restriction and
is not one. Probes on 2026-08-24 and 2026-08-25 both misread it that way, and the
plan that followed (register a second app) would have proved nothing: a new
registration would call the same dead paths and fail identically.

What the corrected calls do on this registration, unchanged app and token:

| Call | Result |
|---|---|
| `GET /playlists/{id}/items` | 200 |
| `PUT /playlists/{id}/items` | 200 |
| `POST /me/playlists` | 201 |

**The preset trick is reachable after all.** `spotify_cli.py playlist` works on
both paths — replace-in-place via `--id`, create via `--name`.

Two things the migration did *not* restore, still worth knowing:

- `GET /me/playlists` returns names without `tracks.total`. Harmless here.
- Development Mode caps authorized test users at five. Single-user setup, so no.

The client-id-per-developer limit tightened to one in February 2026 and was
raised to 25 in July 2026; existing apps were grandfathered either way. Moot now
that the registration was never the problem.

Reference: [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).

## Turn the built-in Spotify connector OFF

If claude.ai's own Spotify connector is enabled, it will answer music requests
instead of this server — especially anything phrased as "make a playlist", which
routes straight to its `create_playlist`. The result looks like success and is
not: track selection goes to Spotify's popularity-weighted engine, so a request
for rare Prince comes back with "Kiss" and "Purple Rain".

Disabling it may not be enough — if it still appears in the tool list, Claude
can try to call it and get "the Spotify playlist tool is not responding".
**Remove the connector**, do not merely toggle it off.

`play_uris` carries an explicit instruction to treat "make a playlist" / "build
a set" / "an introduction to X" as its own job: decide the tracklist, resolve
each title, play it. Sets play immediately rather than being saved, and that is
the default — `create_playlist` exists for the narrower case where something
must be *kept*, usually so a button can point at it.

How to tell which one answered, from the local CLI:

    # context is a playlist URI  -> claude.ai's Spotify connector
    # context is null            -> this server's play_uris
    spotify_cli.py status        # or read /me/player and look at `context`

Phrasing helps too: say **"play ..."** rather than **"make a playlist ..."**, and
name what to exclude ("nothing from Purple Rain"). But the reliable fix is
switching the built-in connector off.

## About the secret in the URL

The path segment **is** the credential — anyone with the URL can control your
Spotify. That is a deliberate trade: claude.ai custom connectors cannot reliably
set custom headers, and full OAuth is a large amount of work for a single-user
service. A bearer token against `/mcp` is accepted too, for clients that can send
one.

Consequences worth accepting knowingly:
- Treat the URL like a password. Do not paste it into shared chats or issues.
- To rotate, `wrangler secret put MCP_SECRET` and update the connector URL.
- **The blast radius is wider than "playback".** Whoever holds the URL can also
  replace or append to any playlist on the account, create playlists, read every
  playlist, and read listening history. **A leak can erase a curated set, not
  just change the current song** — and `replace_playlist` does not roll back.
  It is still not the Spotify password, and it reaches nothing else in the
  house. An earlier version of this line said "nothing else", which understated
  it.

If that is too loose, the upgrade is real OAuth on the Worker, and it is a
substantially bigger job.

## Why unknown paths return 404, not 401

A `401` tells an MCP client to authenticate, and claude.ai responds by going
looking for OAuth metadata and then trying **dynamic client registration**
against a sign-in service this server does not have. That fails with:

    Couldn't register with <name>'s sign-in service.

Returning `404` instead means the client finds no OAuth to discover and simply
connects to the one URL that works — the one carrying the secret in its path.
Leave both OAuth fields blank when adding the connector.

Side benefit: a wrong guess no longer confirms the endpoint exists.

`GET` on the real endpoint answers `405`. That is spec-legal — there are no
server-initiated messages, so there is no SSE stream to offer.

## Scopes

The Worker never asks Spotify for scopes — it inherits whatever the refresh
token was minted with, from `SCOPES` in `skills/spotify/spotify_cli.py`. So a
tool that needs a scope the token predates fails with 403 and no hint that the
cause is the token rather than the code.

Adding one is therefore a three-step change, and skipping any step leaves the
old scope set in force. Run all three from `mcp/`: Wrangler searches upward for
its config, so from the repository root it would not find `mcp/wrangler.toml`
and would target nothing.

    # 1. add the scope to SCOPES in ../skills/spotify/spotify_cli.py, then
    (cd .. && uv run skills/spotify/spotify_cli.py login)
    # 2. push the new token
    python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/spotify-wiim/token.json')))['refresh_token'])" \
      | npx wrangler secret put SPOTIFY_REFRESH_TOKEN
    # 3. drop the KV copy, or the Worker keeps using the old narrow token
    npx wrangler kv key delete --namespace-id <house.json kv.TOKENS> spotify --remote

Step 3 is the one that is easy to miss: `SPOTIFY_REFRESH_TOKEN` is a bootstrap
value only, and KV wins over it once seeded.

`recently_played` was the first tool to need this — it added
`user-read-recently-played` on 2026-08-26.

One consequence of step 2 that bites afterwards: for a while the local CLI and
the Worker hold the *same* refresh token, and PKCE rotation invalidates the old
one on every refresh. Whichever refreshes first keeps working and the other
starts failing with `token refresh failed`. So call the Worker once before
touching the local CLI again, and expect to re-run `spotify_cli.py login` for
local use afterwards. They are not meant to share a token long-term.

## Why the refresh token lives in KV, not just a secret

Spotify's PKCE flow **rotates the refresh token** on refresh. A Worker cannot
write to its own secrets, so a rotated token would be lost and the next call
would fail. `SPOTIFY_REFRESH_TOKEN` is therefore a bootstrap value only: on first
refresh the live token is written to KV and read from there afterwards.

If the server starts failing with `token refresh failed`, the chain is broken —
run `spotify_cli.py login` locally, push a fresh `SPOTIFY_REFRESH_TOKEN`, and
delete the `spotify` key from KV so it re-seeds.

**Since 2026-10-16 there is a way with no terminal: Reconnect Spotify** (MC-31
stage 0b, `spotify-login.js`). The Spotify page (Speakers → Spotify, at
`/buttons/<key>/spotify`) runs Spotify's own sign-in and writes the new login
straight to the `spotify` key in KV, with its date (`login_at`) and account,
so no secret, no delete and no deploy. Spotify ends a login six months after
the sign-in (since 2026-07-20) and answers `invalid_grant`; the house then
notes `spotify:signed-out` in PROGRAMS, stops asking with that login, and the
pages, the bar and `list_requests` say to reconnect. Only the house's own
Spotify account is kept. **The Spotify app must list the return address among
its Redirect URIs** (Spotify's developer dashboard): `PROGRAM_BASE_URL` +
`/oauth/spotify/callback`, for example `https://fmwax-house.example.workers.dev/oauth/spotify/callback`.

Tidal's refresh token does **not** rotate (the same one served every probe run
for days), but it takes the same path — seeded from `TIDAL_REFRESH_TOKEN`, kept
in KV under `tidal` — so one code path serves both and a rotation, if Tidal
ever starts one, is already persisted. The message names the service:
`tidal token refresh failed … push a fresh TIDAL_REFRESH_TOKEN`.

## Local development

    python3 - <<'PY'
    import json, pathlib
    cfg=json.load(open(f"{__import__('os').path.expanduser('~')}/.config/spotify-wiim/config.json"))
    tok=json.load(open(f"{__import__('os').path.expanduser('~')}/.config/spotify-wiim/token.json"))
    pathlib.Path('.dev.vars').write_text(
        f"SPOTIFY_CLIENT_ID={cfg['client_id']}\n"
        f"SPOTIFY_REFRESH_TOKEN={tok['refresh_token']}\n"
        f"MCP_SECRET=localtest\n")
    PY
    npx wrangler dev --local --port 8799

`.dev.vars` holds a live refresh token. It is gitignored — keep it that way.

Smoke test:

    curl -s localhost:8799/health
    curl -s localhost:8799/mcp/localtest -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

## Notes carried over from the CLI

- Search returns **at most 10** results (capped Feb 2026) and Spotify has no
  batch lookup, so every track costs its own request. `search_tracks` hides that
  by fanning out inside the Worker: one MCP round trip, six requests in flight.
  Measured on a twelve-track set, 2.7s against 6.6s done one at a time — and the
  saving is larger from a phone, where the twelve round trips it replaces each
  cost a model turn as well.
- **30 queries per `search_tracks` call.** Each is a subrequest and the Workers
  free plan allows 50 per invocation; the tool refuses past 30 rather than
  failing halfway through a set.
- `/recommendations`, audio-features and related-artists were removed Nov 2024.
  Nothing here depends on them, by design.
- Playback control requires Premium.
- **Playing is the default; saving is the exception.** `play_uris` plays a set
  immediately, which is what keeps "make a playlist" from routing to Spotify's
  own generator. `create_playlist` was added 2026-08-26 for the case that
  genuinely needs a durable destination — a new DJ cannot be given a button
  until something exists for the preset to point at. It refuses a duplicate
  name, an id- or URI-shaped name, and any name that is already an alias, all
  because every other tool here resolves playlists by name.
- If the WiiM is missing from `list_devices` it is asleep, not gone. Start
  anything on it briefly and retry. **Echo devices never go missing** — they
  stay listed while idle and wake on the first `play` call, measured at 2.4 s
  from cold. Waking is a WiiM problem, not a Connect one.
- **A device can accept the stream without playing it.** `play_uris` re-reads
  `/me/player` after starting and treats success narrowly: playing, **on the
  requested device**, **on a track from the submitted list**. Anything short of
  that triggers one retry — transfer with `play: false`, then re-issue the URIs —
  and then a `warning` telling Claude not to report the set as playing. The
  re-issue matters: a bare transfer resumes whatever queue was already current,
  so it can hand the room an unrelated old track and still look like success.
  The track test accepts Spotify's **relinked** ids (`item.linked_from.id`) —
  a track unavailable in your market is substituted, and that is the set
  playing correctly, not a mismatch.
  Silence with a success message is the worst outcome — it sends the operator
  debugging the wrong layer.
- **Each tool call is an approval tap in claude.ai.** A DJ set costs three or
  four. Pick **Allow always** per tool on the first run. Merging `search_tracks`
  into `play_uris` would save one tap and cost the verification pass that keeps
  covers and karaoke versions out of a set — not a trade worth making.
