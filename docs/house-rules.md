# House rules

How fmwax behaves, in plain words. One page, so the rules live in one place
instead of in a hundred code comments. Written 2026-09-26, after the
consolidation. When a rule changes, change it here too, then run `npm run
rules` in mcp/ so the app's House rules page (Speakers → House rules) shows it.

Numbers in **bold** are settings; where they live is in brackets for whoever
changes them.

**Every house reads its own page** (2026-10-18, the owner chose "role on every
key" from https://claude.ai/artifact/SYPeHudMsPjp4GvZdbquVM). The app shows
this page to every house, so a few marks make it fit the one reading it:

- **The presets and the numbers** at the top of the app's page are not written
  here: the app draws them from the house's own settings (`rulesFacts`,
  mcp/house.js).
- Each `##` section is one fold. Its `>` line is what shows while it is
  folded; with several, the first whose `{if …}` holds.
- `{if tidal}` opening a paragraph, a list item, a `>` line or ending a `##`
  heading shows it only in a house that has that; `{if no tidal}` only in one
  that has not. The words: `requests` (a Requests preset), `tidal` (a Tidal
  one), `endless`, `housedj` (a house DJ preset), `guest` (the guest DJ's
  preset), `newdj` (house DJs can be added from a DJ's page: the setup page
  made them), `archive`, `talk` (an OpenAI key), `helper` (a home helper has
  reported), `lastfm` (a Last.fm key, the `LASTFM_KEY` secret), `chatgpt`
  (ChatGPT is the curator, chosen on the setup page) and `history`
  (house.json `rules.history`: this house keeps its own history).
- `{default speaker}`, `{requests presets}`, `{guest preset}`, `{house
  presets}`, `{endless presets}`, `{archive preset}`, `{archive asks}`,
  `{talk minutes}`, `{time zone}` and `{notes default}` are filled in from
  the house's settings.
- `(since 2026-10-16)` shows as a small date where the house keeps its
  history, and nowhere else.
- `## Questions` is the questions card: one `**question?** answer` per item.

## Questions

- **Why did it play on that speaker?** It plays where you last chose, for half an hour. After that it follows the music, and with nothing playing it uses the {default speaker}.
- {if requests} **Where does a set I ask for go?** On {requests presets}, replacing what was there. Tick **Keep** and it goes on the Shelf for good.
- {if endless} **When does a DJ add songs?** When 30 minutes or 4 songs are left: 45 minutes more, up to 4 hours a start. The house has 12 endless runs a day; a set you ask for doesn't count.
- {if endless} **Why did the music stop?** An endless set plays out after 4 hours of top-ups, or once the day's 12 endless runs are spent. Spotify can also refuse for a while; the pages say how long.
- {if endless} **Why did I hear that song again?** An endless DJ skips the last 150 songs they played, and anything the house played in the last 3 hours. A set you ask for doesn't look back, and another recording of a song (a live take, a remaster) counts as a new one.
- **Why does the WiiM app show an old name?** A preset keeps the name it had when it was saved, and renaming it over the network would unhook it. Save it again: play it, then hold the preset.
- **Can I undo a set?** Yes, for 90 days: every playlist is copied before it's rewritten. Ask Claude or ChatGPT to put the old one back.
- {if tidal} **What can't it do?** Move Tidal between speakers, or make a start quieter: your amp sets the volume, so "mute" pauses instead.
- {if no tidal} **What can't it do?** Make a start quieter: your amp sets the volume, so "mute" pauses instead.
- {if no talk} **Why is there no Talk tab?** Talk needs an OpenAI key. The owner can add one on the setup page.

## Which speaker

> The one you picked in the last half hour, else where the music is, else the {default speaker}.

Every page (the bar, the menu, every tab, every "Plays on the" list) names
the same speaker, picked like this:

1. A speaker **you chose in the last half hour**: a tap in the menu or on
   the Speakers page, a Play, a key, a pause or play on the bar, or music
   started there by voice (since 2026-10-10). [`PICK_FIRM_S`]
2. {if helper} Otherwise, **where the music is**: Spotify first, then a WiiM
   playing Tidal or the radio. A WiiM on the TV, optical or line-in doesn't
   count: it can say "playing" while silent.
2. {if no helper} Otherwise, **where the music is**, on Spotify.
3. Otherwise, the last speaker you chose, however long ago.
4. Otherwise, the **default speaker**, the {default speaker}. The owner can
   change it on the setup page (Speakers, Change) (since 2026-10-17).
   [house.json `devices.default`; the page's choice in the house's storage,
   `PAGE_SETTINGS`]

Spotify moves between speakers: "Move to" in the bar's menu, or a speaker
picked on a DJ's page while that DJ plays, where the list says "Move to" too
(since 2026-10-24). On the page of a DJ who isn't playing, a pick only says
where their Play goes, and the music playing stays where it is.

{if helper} **The radio moves between the WiiMs** when the other one has the
same station saved on a preset, by name: "Move to" presses that preset there,
then pauses the first. It needs the home helper. To an Echo, or a station the
other WiiM doesn't have, the radio stays. **Pandora** moves the same way while
each WiiM has exactly one Pandora preset, under the same name: Pandora names
only the song, so the house takes that preset to be what plays (a station
started from an app moves as the preset's), and the other speaker starts on a
new song.

{if tidal} Tidal stays where it started.

## Volume

> Your amp sets the volume, so "mute" pauses.

The WiiMs are fixed volume: your amp decides how loud. Nothing the app sends
can make a start quieter. So **"mute", or volume 0, pauses** instead, whoever
asks; "resume" brings it back (since 2026-10-16).

## What the app can see

> {if helper} Spotify always; Tidal and the radio through the home helper.
> {if no helper} What Spotify is playing, and on which speaker.

- **Spotify:** what the account is playing, on which speaker. One speaker at
  a time, because it is one account.
- {if helper} **Tidal and the radio:** only through the **home helper**, which
  reads each WiiM on the home network about once a minute. If it hasn't
  reported in **2½ minutes**, the app treats it as off. A small **house**
  beside the **?** at the top of every tab says which (since 2026-10-22):
  its window lit while the helper is heard, dark and grey when it isn't.
  Tap it for which WiiMs answer the helper, or when it was last heard.
  If the router gives a WiiM a new address (after a restart or a power cut), the helper notices it
  has stopped answering and finds it again by itself, by the WiiM's own id,
  within about a minute (since 2026-10-19). With the helper on,
  the app can also press a WiiM's keys and pause or play it. A house set up
  on its page gets its helper from the setup page: one command on a
  computer at home finds the WiiMs by itself and tells the house where they
  are, and the setup page says which WiiMs it reads and which aren't
  answering (since 2026-10-19). The command carries a code for the helper's
  key, good for an hour, so nothing else is pasted; and the setup page's
  **Remove** takes the helper off its computer, after which the house
  forgets it. On Windows it is also in Settings, Apps (since 2026-10-21).
  The helper takes only pause, play, a preset key and that remove from the
  house, and never renames a preset.
- {if helper} **The stream's quality** (since 2026-10-25): the bar's panel
  says, under where it plays, what the speaker itself reports while a
  streaming service plays: "Lossless · 24-bit / 96 kHz · 2958 kbps" above
  320 kbps, "Compressed · 128 kbps" at a compressed stream's usual rates,
  and the numbers alone otherwise (Radio Paradise gives no bitrate). The
  speaker says 32-bit for a 24-bit stream; the panel says 24. Only the
  WiiMs report it: not an Echo, the archive, an input or AirPlay.
- {if no helper} **Other services and the radio** need the **home helper**, a
  small program on a computer at home, which this house doesn't have.
- **Paused:** the app believes a pause only if **the app itself sent it**, or
  **the speaker itself says so** through the home helper. Spotify's own
  "paused" can be stale (it says "paused" long after the speaker has moved on
  to another source). The bar remembers its own pause for **one hour**, and
  its play button starts that music again where it stopped.
- {if helper} **Stopped on Spotify** (since 2026-09-29): Spotify lets go of a
  WiiM that sits stopped and then sees nothing there, while the WiiM app still
  shows the song. With the helper on, the page says what the speaker says:
  "Stopped · Spotify", the song, and the preset it was playing from. Spotify's
  own answer comes first whenever it has one. **The bar's play button presses
  that preset** on that WiiM through the helper (since 2026-10-10), as the key
  would: an endless DJ carries on with the songs kept. Never a plain resume:
  that (measured 2026-09-29) plays whatever the Spotify account played last,
  which may be another song. **Its panel opens the playlist in Spotify and
  names whose set it is** (since 2026-10-12), from the helper's reading and
  the house's own records, with no call to Spotify.
- {if helper} **Asking Spotify less** (since 2026-09-28): with the helper on,
  the app keeps Spotify's last answer and asks again only when the helper
  hears a WiiM change (a new song, a pause, another source), when the app
  itself plays, pauses, skips, moves or presses a key, when the song should
  have ended, or after **30 seconds** for an Echo or the phone, **2 minutes**
  when nothing plays, and **5 minutes** at most. The Use page counts what it
  saved. [now.js `PLAYER_REUSE_*`; off: house.json `player.reuse: false`]
- {if tidal} **The Tidal button** in the bar's menu (the Tidal Requests
  playlist, to open in the Tidal app) shows only while Spotify isn't playing
  on that speaker, and with the helper on, only while the helper reads Tidal
  there (since 2026-09-28).

Open pages check what is playing **every 30 seconds** while on screen, stop
after **10 minutes** without a touch, and check again straight away when you
come back.

## Endless DJs {if endless}

> 45 more minutes when 30 are left · 12 endless runs a day · no repeats in 150 songs.

- {if housedj} **A house DJ preset** ({house presets}) plays one DJ, endless:
  the same DJ every press. Change who is on one from a DJ's page.
- {if guest} **The guest DJ** ({guest preset}) is whoever you last played
  endless who has no preset of their own.
- {if newdj} **More house DJs, up to 4** (since 2026-10-18): on a DJ's page,
  **Make … a house DJ** offers a free number. The house makes the playlist
  and the first set (one endless run), and the page shows how to save the
  preset on each WiiM until someone taps **Saved on every WiiM**. **Give up
  preset N**, on a house DJ's page, frees the number: the WiiMs keep playing
  the last set there until something else is saved on it.
- A press plays the DJ's list. While it plays, the app looks **every 10
  minutes**.
- **An endless preset's list is the house's:** nothing writes a set over it
  (since 2026-10-16). A set asked of a DJ goes on Requests; a turn for the DJ
  playing is a steer.
- **It says "endless":** the bar, the speaker's box on Speakers and the DJ's
  page say "endless" when an endless preset plays or is paused. Never on
  Requests or Spotify's own picks after a list runs out (since 2026-10-13).
- **Top-up:** when **30 minutes or 4 songs** are left, the DJ adds **45
  minutes** more. [house.json `endless`: `topupMinutes`, `batchMinutes`]
- **At most 4 hours of top-ups a start**, then the set plays out.
- **12 endless runs a day** across all endless presets: top-ups, fresh sets
  and steers. A set you ask for doesn't count. After that, no new songs until
  tomorrow. [`dailyRuns`]
- **No repeats** of the last **150 songs** the DJ played, nor of anything
  the house played in the last three hours. *Repeats*, below, says how.
- **The house counts the rules it can** before a set lands: never the same
  recording twice, never one act's song twice (a remaster or another take
  is that song), never the same song back to back, and the DJ's own
  spacing: Genre and Sessions never play an act twice in a row or three
  times an hour, Soul never three in a row from one act, Vibe one song an act, Deep Dive
  never two from one album in a row. A set that breaks one goes back to be
  fixed, once; then it plays as sent, and the log says what it held. A set
  of one song's versions isn't counted against it, nor an hour of one
  artist asked of Soul (since 2026-10-18).
- **No same title twice in a row**, for every DJ, a song's versions included:
  they are spread through the set. And never the same record in another mix
  or edit (since 2026-09-27).
- **A session ends** when two looks in a row find it not playing (about 20
  minutes).
- **After a session:** if at least **4 songs and 15 minutes** are unplayed,
  they're kept, and the next press carries on from there, whether tonight or
  next week. If not, the DJ makes a **fresh one-hour opening** for the next
  press.
- **Steering** ("More like this", "Change it up", or asking for a turn):
  about **45 minutes** in the new direction replace what was queued, starting
  after the song that's playing: a top-up's worth, so one tap is one endless
  run (since 2026-09-28). It jumps in at once only if you say "now".
- {if talk} When Talk picks the songs itself it sends about 25, costing no
  run, and the DJ tops up from there.
- {if requests} On a request set, a spoken steer waits for the set to end,
  unless you say to replace the rest. The **More like this** and **Change it
  up** buttons in the bar's menu are the asking: on a request set they
  replace the rest after the playing song (since 2026-09-27). Where they
  can't work, on a set asked for without a DJ, the menu says why instead
  (since 2026-09-28).
- {if tidal} A set on Tidal can't be steered: the app can't see Tidal play,
  and the menu says so.
- **Start fresh** (on a DJ's page, under **More**): a new one-hour set, started on the
  speaker you picked as soon as it's made. If it takes longer than **25
  minutes**, it's only put on the preset for the next press: a late set never
  starts music by itself. Tapping Start fresh again starts the 25 minutes
  over. A guest DJ's opening works the same way (since 2026-10-02).
- {if no chatgpt} **Who makes the songs:** the curator, Claude in the cloud.
  Each tap or ask wakes it, and it also checks in every hour.
- {if chatgpt} **Who makes the songs:** the curator, ChatGPT: a Work chat in
  the house's ChatGPT account, woken by the house for each tap or ask, with
  an hourly check of its own (since 2026-10-19).
- **When the curator is quiet:** if it hasn't checked in for more than an
  hour and a quarter, the pages say when it last did instead of "a few
  minutes", for endless sets and for asked-for sets (since 2026-10-02).
  **Sooner when work waits** (since 2026-10-19): an ask or an endless top-up
  nobody has answered after 20 minutes makes the pages say so straight away,
  with when the curator last checked in. The usual reason is a Claude or
  ChatGPT plan that has hit its limit: the curator carries on when the limit
  resets. The pages call it "the curator", since a house's curator can also
  be ChatGPT.
- {if guest} **The guest DJ ({guest preset}):** playing someone endless who
  has no preset of their own makes them the guest. They start at once from
  their newest program, or make an opening (about four minutes).
- {if talk} If another guest is already playing, Talk asks: after this song,
  or now?
- {if guest} **Any guest DJ can be told what to play** (since 2026-10-13):
  "Gatefold, 1971, endless", "Pub Rock, the eighties, endless". The words are
  kept on every top-up until you change them; other words make a new opening
  (about four minutes), never an old program. Vibe's and Soul's pages have a
  box for it beside Play endless, which can be left empty, while they are not
  on a house preset. A house DJ's own preset takes no words; to turn one,
  steer it.

## Asking a DJ for a set {if requests}

> It goes on {requests presets} and replaces what was there.

- **Roll calls:** Pub Rock (69 acts) (since 2026-10-12), Hank (511) and
  Dr. Funkenstein (5,560) each have one: acts from Discogs, Wikipedia and
  MusicBrainz, reviewed by hand. Every set of theirs, asked or endless, gets
  the dozen that fit the ask (or, for a top-up, ones it hasn't played lately)
  as a guide, plus a few to stay out of. It's a guide, not a whitelist.
  **Genre has one for jazz** (since 2026-10-18): 4,505 acts, given to any
  Genre ask that names jazz or a jazz style ("piano jazz", "bebop", "bossa
  nova"). Not smooth, acid or nu jazz, which it never held: those, and every
  other genre, work from the brief alone. **Sessions has one too** (since
  2026-10-26): 2,543 session releases by series (Peel and BBC, MTV
  Unplugged, Tiny Desk, 2 Meter Sessions, Spotify Sessions, Audiotree Live,
  Austin City Limits, Like A Version, VH1 Storytellers), gathered from
  MusicBrainz and not read one by one; a slice of it crosses the series.
  The other DJs work from their briefs alone until they get one.
  [tasks/rollcalls/]
- A set you ask for (a length, a mood, a subject) goes on **{requests
  presets}**, and replaces what was there.
- **Three dates, kept apart** (since 2026-10-18): when a recording was
  made, when it was first issued, and when another notable version came
  out. A Stax demo on the 2023 box is "Mack Rice's demo, first issued 2023;
  the hit was the Staples', 1971". A recording date, even "around 1970", is
  given only with evidence; otherwise the page says it isn't known. A DJ's
  era goes by when the music was made, so that demo is Soul's 1960s-70s
  music, never Hank's "after 1990" because of its 2023 issue. Kept pages
  show "first issued" beside such a track.
- **An asked-for set is counted too** before it lands: no recording twice,
  no song back to back, and the DJ's own spacing (Genre, Soul, Vibe, Deep
  Dive). One that breaks a rule goes back to be fixed once, then plays as
  sent (since 2026-10-18). **The same goes for a set asked of a DJ by name**
  by voice or in Claude or ChatGPT (since 2026-10-24). There, the second
  try is any set by that DJ on that preset within 15 minutes. A set that
  names no DJ isn't counted.
- {if tidal} **Which service** is the **On: Spotify | Tidal** switch on the
  DJ's Ask form. It starts on Spotify, and each phone remembers its last
  choice. Typing "on Tidal" in the box doesn't switch it: words there are
  taste. (By voice or in the Claude app, just say "on Tidal".)
- If there's nowhere to put it (no Requests preset for that service), the
  ask is refused before anything is written.
- **Keep** puts the set on the Shelf for good. By voice or in Claude or ChatGPT,
  say **"keep it"** about the set on Requests (since 2026-09-28). Only a set
  with a DJ can be kept: the Shelf is by DJ.
- **Short notes or the long read** (since 2026-10-18): on the Librarian's and
  Gatefold's pages, ticking Keep offers **Short** (a line or two about each
  song) or **Long read** (the stories behind the records, about 1,500 to
  3,000 words). The music doesn't wait for either: the page follows. Each
  phone remembers its last choice; until it has chosen, the form starts on
  {notes default}. [house.json `requests.notes`]
- **Play on the Shelf** plays a kept set's own songs on the speaker you
  picked and puts it on no preset, so the set on Requests stays. While it
  plays, the bar names the DJ and the set. **Load**, on the set's own page,
  puts it on Requests (since 2026-10-10).
- {if tidal} **On Tidal, Max quality when there's a choice:** where the same
  recording comes in several releases, the DJ takes the one Tidal plays at
  Max (Hi-Res). Never a different take or mix for it (since 2026-09-27).
- {if endless} **Naming a DJ plays them endless**: a DJ with a preset of
  their own plays from it, and anyone else becomes the guest DJ ("play Genre,
  ska" makes Genre the guest with those words). Only an ask for *a set* ("an
  hour of Hank", "Hank, something for cooking") makes a new set.
- {if history} **Six DJs became three** (since 2026-10-13): **Vibe** is
  Sunny, Morning and Nightside; **Soul** is Stax and Soul Factory; **Hip Hop**
  took in KRS-One (both cut since, below). The old names still work: "play
  Stax" is Soul with "the South (Stax)", "play Motown" Soul with "the North
  (Motown)", "play Sunny" Vibe with "the room", "play Nightside" Vibe with
  "the small hours", "play Morning" Vibe with "the morning". Sets on the
  Shelf under the old names are on the new DJ's page.
- {if history} **Ten DJs**, for this house and the forum version (since
  2026-10-15): Camille, Monk, the Professor, the Selector and Hip Hop are
  cut. Prince's own records are Deep Dive's; jazz, reggae and hip-hop are
  Genre's. Two DJs write a page with their set now, the Librarian and
  Gatefold. Their sets on the Shelf and asks already made still show, under
  the old name. **Eleven since 2026-10-26**, with Sessions.
- **Sessions plays bands live in a small room** (since 2026-10-26): radio
  and TV sessions, never the studio record. John Peel's and the BBC's, MTV
  Unplugged, NPR's Tiny Desk, 2 Meter Sessions, Spotify Sessions, Audiotree
  Live, Austin City Limits, triple j's Like A Version and VH1 Storytellers;
  never a karaoke or tribute version, a contest entry, a festival stage or
  a concert album from a hall. A set crosses the series and the decades (at
  least four series an hour, Audiotree at most a quarter), about half of it
  songs you know in their session version, and every set looks for a
  session out in the last month. Name a series, years or a genre to keep
  to it ("Peel sessions from the eighties", "only unplugged", "sixties
  bands", "only hip-hop"): sixties bands play in sessions of any year,
  while "recorded in the sixties" leaves only the BBC's and Peel's.
- {if guest} **Anything live asked for endless** ("something unplugged",
  "Tiny Desk all night") is **Sessions**, the guest DJ on {guest preset}
  (since 2026-10-26).
- {if guest} **An artist or a style asked for endless** goes to a DJ, never
  to a one-off list that stops. **One artist by name** ("Michael Jackson,
  endless", "change to the Jayhawks") is **Deep Dive**, the guest DJ on
  {guest preset}: it makes a set of that artist (about four minutes) and
  keeps to them, every top-up. Another artist is a new set. **A style or a
  direction** ("disco", "more like the Jayhawks"): if it suits the DJ
  playing, it steers them; if not, it goes to the DJ it suits, a house DJ
  first. The answer says who, in one line (since 2026-10-10).
- {if guest} **A genre no DJ owns** ("80s new wave, endless", "Delta blues
  all night") is **Genre**, the guest DJ on {guest preset}, made like Deep
  Dive's (about four minutes) and kept to that genre, every top-up. A genre
  a DJ owns (soul, funk, Americana…) goes to that DJ (since 2026-10-10).
  But Genre pressed for one of those by name plays it, the plain way:
  a DJ never refuses words given on a DJ's page, since a refusal leaves
  the button empty (since 2026-10-26). Disco, club music, grunge, French song, Dutch-language music, jazz, reggae
  and hip-hop are Genre's too (since 2026-10-15). About half of a Genre or
  Deep Dive set is hits; say "more hits" or "fewer hits" while it plays and
  it steers that way, keeping the genre or the artist (since 2026-10-12).
- **A DJ asked about an artist looks them up first** (since 2026-10-18):
  any DJ whose ask is about one artist ("Maggie Rogers, recent work", "Ray
  Charles before 1980"). On
  MusicBrainz: every album with its original year, under every band and
  name they recorded under (Charlie Hunter's Blue Note years are the
  Trio's), the live albums that matter, and for a songwriter their songs. A
  mood, a genre, a label or "like Okonski" is never looked up. A
  songwriter's songs are looked up when the ask is about what they wrote,
  and added to their folder (Isaac Hayes's had only his albums). The house
  keeps one folder per artist for 180 days (two artists with one name get
  one each) and every DJ shares it, so the
  next ask about them, from any DJ, starts straight away. A set asked of a
  DJ by voice or in Claude or ChatGPT reads the folder too, when the house
  has one (since 2026-10-24).
- **The house looks an artist up itself** (since 2026-10-24). It gets the
  studio albums with their years, and the names the artist recorded under,
  from MusicBrainz, which ChatGPT can't reach. This takes a few seconds and
  works with either curator; Deep Dive's artist is always looked up. What
  needs judgment (the live albums that matter, a songwriter's songs) is
  added by the curator when it can reach MusicBrainz itself, as Claude can.
  If MusicBrainz is busy, the set is made from what the DJ knows, and the
  house tries again an hour later.
- {if lastfm} **Last.fm widens the choices** (since 2026-10-18): a DJ may
  look an artist up there for who its listeners play alongside them, and
  which of their songs they play most. An ask like "piano, like Okonski"
  gets Okonski's neighbours to choose from. They're ideas, not the set:
  every song still fits your words ("piano" means piano music), and the DJ
  adds picks of its own. Last.fm counts what its users have
  played since the 2000s, never the charts of the day, so it says which
  songs are familiar, not which were hits. Its genre labels aren't used
  (its "pub rock" mixes the English scene with Australian and Czech
  bands). If Last.fm doesn't answer, nothing waits. [lastfm.js]
- {if guest} **Deep Dive looks up every artist it's given, and goes
  through every album** before any comes round again, unless the ask
  narrows it ("Miles, a mellow evening", "the Blue Note years"): then only
  the records that fit (since 2026-10-18).
- {if guest} **Deep Dive** and **Genre** must be told what to play: on their
  page, type it in the box beside Play endless. Their squares on the DJs tab
  have no ▶ for that reason.
- {if guest} **Nearby, one tap:** while Genre or Deep Dive plays as the
  guest DJ, their page and the bar's panel offer four places to turn. For
  Genre these are neighbouring genres, suggested by the curator with the
  first set. For Deep Dive they are similar artists, from Last.fm. A tap
  makes a new set of it, about four minutes, using one of the day's DJ
  runs. New words bring new suggestions (since 2026-10-24).
- **A set asked of a DJ by name**, by voice or in Claude or ChatGPT, carries
  that DJ's name on Requests, so **More like this** follows them. The app
  takes the asker's word for which DJ it was. A set with no DJ named has no
  name and can't be steered (since 2026-09-28).

## Repeats

> {if endless} A DJ doesn't play a song again until 150 of their others have played.
> Never the same song twice in one set.

{if endless} An endless DJ remembers what they have played, so the same
preset, pressed night after night, keeps finding something new.

- {if endless} **150 songs before a repeat.** Each DJ keeps a list of the
  last **150 songs** they played and leaves them out of every new set. That
  is about five evenings of listening, but it is counted in songs, not days:
  a DJ you play every night can come round to a song again within a week,
  and one you play once a month may not for months. The list belongs to the
  DJ, not the preset, so it goes with them to another number. [house.json
  `endless`: `noRepeatSongs`; endless.js `endlessRemember`]
- {if endless} **Only what played counts.** A song that was on the list but
  never played isn't used up (since 2026-09-25).
- {if endless} **Nothing the house just played.** Anything heard in the
  last **3 hours** is left out too, whoever played it: another DJ, the
  Shelf, the Spotify app itself. This comes from Spotify's own history, which logs a
  song only after about 30 seconds, so a quick skip doesn't count, and
  music from another service or the radio isn't in it (since 2026-10-18).
  [endless.js `HEARD_WINDOW_MS`]
- {if endless} **Nothing twice on one list.** New songs added to a playing
  set never repeat one already on it.
- **In one set**, the house checks before it plays (every endless set, and
  a set asked of a DJ by name): never the same
  recording twice, never one song twice in two versions (a remaster, a live
  take, another mix), never the same title back to back. A set that breaks
  one goes back to the DJ to be fixed, once. Artists are spaced too, each
  DJ their own way, and the **Same artist** slider changes it.
- {if guest} **Deep Dive goes through every album** of an artist before any
  comes round again.
- {if requests} **A set you ask for starts clean.** It doesn't look at what
  the DJ played before, so it can hold a song you heard yesterday.
- {if endless} **What can come back sooner:** another recording of a song you heard
  (a live take, a remaster) is a new song to Spotify and to the list. And
  the list holds songs, not artists: an artist you just heard can turn up
  again in the next set.

## Tuning a DJ

> Four sliders per DJ, kept until you change them back.

- **Tune** (since 2026-10-23): beside **At a glance** on a DJ's page, and
  beside **More like this** and **Change it up** in the bar's panel while a
  DJ plays. It opens the DJ's own sliders: years, hits, how often one
  artist comes back, and how far from their genre they stray. Vibe has a
  **Mood** slider (pin the morning, the room or the small hours, instead of
  the hour choosing), Deep Dive **Career**, **Live takes** and **Order**,
  the Librarian and Gatefold **Notes** (short or the long read, the
  starting choice on their Ask form), and Sessions **Genres**: close (one
  family of music all set), drift (each song a neighbour of the last, a
  few turns an hour) or anywhere, its own (since 2026-10-27). A small ring
  marks where the DJ stands on their own.
- **Only what fits the DJ**: each slider moves a DJ inside their own
  character (Soul's years run 1959 to 1979, and it never offers "no hits").
  Dr. Funkenstein can go up to half hits, at the owner's word.
- **It lasts**: a tuned DJ stays tuned, for every set and every top-up,
  asked by any phone, by Talk or by Claude or ChatGPT, until someone moves
  the sliders back or taps **Reset**. The DJ's page says so in one line.
  Words in a request still win: "an hour of Soul, all the hits" gets the
  hits.
- **While the DJ plays**, **Apply after this song** replaces the songs
  queued after the one playing, as Change it up does: one of the day's
  DJ runs. **When they are not playing**, **Save** keeps it and
  the next new songs follow it; the songs left from last time play first.
- **The house checks the same-artist slider** before a set lands, as it
  checks the DJs' own spacing. The others are the DJ's to follow: the
  curator gets them as instructions with numbers ("2 or 3 hits an hour").
  [mcp/tuning.js; the DJs' sliders in djs.js `TUNE`]

## Talk {if talk}

> {talk minutes} minutes a day. The day starts at midnight, {time zone}.

**{talk minutes} minutes a day**, counted by the server's clock. The day
resets at midnight, {time zone}. [voice.js `CAP_MINUTES`; the house's time
zone, `HOUSE_TZ`]

**The line hangs up by itself, because it costs money while it is open,
even in silence.**
- **When nobody is talking:** 30 seconds after the desk's last word.
- **After a press with nothing said, or nothing answered:** about 40
  seconds after it.
- **When you leave the page** (another app, another tab, the phone
  locked): as soon as nothing is being worked on, so a set being written
  is finished first. If the phone stops the page altogether, the house
  hangs up within a minute and a half (since 2026-10-24).

**Talk changes only the house's own playlists** (since 2026-10-25): its
presets', its DJs' and the ones it keeps. Any other playlist on the
Spotify account it can play or read out, never change.

{if archive} **The archive by voice** (since 2026-10-10): ask Talk for
{archive asks}. It loads the takes onto **preset {archive
preset}** and, when the speaker is a WiiM and the **home helper** is on, has
the helper press {archive preset} there, so it starts. Otherwise it says it
is loaded and to press {archive preset}, and why (the helper is off, or the
speaker is an Echo). "The show" at a venue in a year with several nights:
Talk says how many and asks which. Loading or starting {archive preset}
needs no yes.

## Spotify's limits

> A daily allowance. The sign-in lasts six months.

The app runs on a Spotify developer account with a daily allowance. If
Spotify refuses ("quota exceeded"), the app stops asking for as long as
Spotify says (**15 minutes** if it doesn't say). Pages say "not known for
about N minutes" and Play is refused until then. The **Use** page (at the
foot of the Speakers tab) shows the calls made in the last 24 hours.

**The Spotify sign-in lasts six months** (Spotify's rule), then Spotify signs
the house out and nothing on Spotify works until someone signs in again. The
**Spotify** page (at the foot of the Speakers tab) says when it ends and has
**Reconnect Spotify**: sign in on Spotify's own page, and you're back. Only
the house's own Spotify account is accepted, and **only the owner can
reconnect**: a phone signed in on the setup page; anyone else sees the page
but not the button (since 2026-10-17). The Speakers tab says so **3 weeks**
before the end, and the bar on every tab says so once Spotify has signed the
house out. Claude or ChatGPT hears it too (since 2026-10-16). Before a new
house's first sign-in, the bar says Spotify is not signed in yet (since
2026-10-19).
[services.js `LOGIN_WARN_DAYS`]

## Safety

> Every rewritten playlist is kept 90 days. Presets are never renamed.

- Before any playlist is rewritten, the app keeps a copy for **90 days**,
  so a bad write can be undone.
- The app **never renames a Spotify preset on a WiiM over the network**.
  Doing that unhooks the preset. Presets are saved by hand in the WiiM app.
- Passwords and keys stay in Cloudflare, never in the code or these files.
