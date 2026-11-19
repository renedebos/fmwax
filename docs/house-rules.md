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
  reported), `lastfm` (a Last.fm key, the `LASTFM_KEY` secret), `genius` (a Genius token, the `GENIUS_TOKEN` secret), `chatgpt`
  (ChatGPT is the curator, chosen on the setup page), `talkasks` (Talk
  hands a DJ's set to the curator: Talk, asks and a curator), `alexa`
  (maple crate, the private Alexa skill, acts: house.json `alexa.acts`),
  `playnow` ("play …" plays at once: house.json `playNow` "on") and
  `history` (house.json `rules.history`: this house keeps its own history).
- `{default speaker}`, `{requests presets}`, `{guest preset}`, `{house
  presets}`, `{endless presets}`, `{archive preset}`, `{archive asks}`,
  `{talk minutes}`, `{time zone}` and `{notes default}` are filled in from
  the house's settings.
- `(since 2026-10-16)` shows as a small date where the house keeps its
  history, and nowhere else.
- `## Questions` is the questions card: one `**question?** answer` per item.


## Questions

- **Why did it play on that speaker?** It plays where you last chose, for half an hour. After that it follows the music, and with nothing playing it uses the last speaker you chose, or else the {default speaker}.
- {if requests} **Where does a set I ask for go?** On {requests presets}, in place of the set that was there. Tick **Keep** and it's also kept on the Shelf for good.
- {if waits} **And a set I ask a DJ who has a preset of their own?** It goes on that DJ's own preset ({house presets}), in place of the songs there. Requests stays as it was.
- {if waits} **Why did a DJ's preset stop?** It plays the songs on it, about an hour, and stops. Nothing adds songs by itself until a curator is set up. Ask that DJ for a set and the preset has new ones.
- {if endless} **When does a DJ add songs?** When 30 minutes or 4 songs are left, they add 45 minutes more, for up to 4 hours a start. The house has {daily runs} endless runs a day. A set you ask for doesn't count.
- {if endless} **Why did the music stop?** An endless set plays out after 4 hours of top-ups, or once the day's {daily runs} endless runs are used up. Spotify can also refuse for a while; the pages say how long.
- {if endless} **Why did I hear that song again?** An endless DJ skips the last 150 songs they played, and anything the house played in the last 3 hours. A set you ask for doesn't look back. And another recording of a song (a live take, a remaster) counts as a new song.
- **Why does the WiiM app show an old name?** A preset keeps the name it had when it was saved. Renaming it over the network would unhook it. To update the name, save the preset again: play it, then hold the preset.
- {if requests} **What's on Requests and the guest DJ's preset?** The keys on the Speakers tab and the TV say it, not the speaker's saved name (since 2026-11-18): the DJ on each now, and under it the set's title or the words asked. A line too long for its key slides along once and then rests; the playing key's keeps sliding, and so does the one the TV's remote is on.
- **Can I undo a set?** Yes, for 90 days: every playlist is copied before it's rewritten. Ask Claude or ChatGPT to put the old one back.
- {if tidal} **What can't it do?** Move Tidal between speakers, or make a start quieter: your amp sets the volume, so "mute" pauses instead.
- {if no tidal} **What can't it do?** Make a start quieter: your amp sets the volume, so "mute" pauses instead.
- {if no talk} **Why is there no Talk tab?** Talk needs an OpenAI key. The owner can add one on the setup page.
- {if talkasks} **Can I hang up after asking Talk for a set?** Yes, once Talk says the DJ is making it and which preset it goes on. If you hang up sooner, the line stays open for the few seconds the ask needs, then hangs up by itself (press Hang up again to stop at once). The house makes the set after the call, as it makes one asked for on a DJ's page, and starts it on the speaker you named, unless something else has started playing by then.

## Which speaker

> The one you picked in the last half hour, else where the music is, else the {default speaker}.

Every page names the same speaker: the bar, the menu, every tab and every "Plays on the" list. It's picked like this:

1. A speaker **you chose in the last half hour**: a tap in the menu or on the Speakers page, a Play, a preset key, a pause or play on the bar, or music started there by voice (since 2026-10-10). [`PICK_FIRM_S`]
2. {if helper} Otherwise, **where the music is**: Spotify first, then a WiiM playing Tidal or the radio. A WiiM on the TV, optical or line-in doesn't count: it can say "playing" while silent.
2. {if no helper} Otherwise, **where the music is**, on Spotify.
3. Otherwise, the last speaker you chose, however long ago.
4. Otherwise, the **default speaker**, the {default speaker}. The owner can change it on the setup page, under Speakers, Change (since 2026-10-17). [house.json `devices.default`; the page's choice in the house's storage, `PAGE_SETTINGS`]

**Moving the music.** Spotify moves between speakers. Tap the speaker in the bar's menu and pick another under "Move to". Or pick a speaker on the page of the DJ who's playing: the list says "Move to" there too (since 2026-10-24). On the page of a DJ who isn't playing, a pick only says where their Play goes, and the music stays where it is.

{if helper} **The radio moves between the WiiMs** when the other WiiM has the same station saved on a preset, under the same name. "Move to" presses that preset there, then pauses the first WiiM. It needs the home helper. The radio doesn't move to an Echo, or to a WiiM without that station. **Pandora** moves the same way while each WiiM has exactly one Pandora preset, under the same name. Pandora only names the song, so the house takes that preset to be what's playing (a station started from an app moves as the preset's), and the other speaker starts on a new song.

{if tidal} Tidal stays on the speaker where it started.

## Volume

> Your amp sets the volume, so "mute" pauses.

The WiiMs are fixed volume: your amp decides how loud. Nothing the app sends can make a start quieter. So **"mute", or volume 0, pauses** instead, whoever asks, and "resume" brings it back (since 2026-10-16).

## Play something now {if playnow}

> "Play the Beatles on the Ultra" plays in a few seconds, and a DJ carries on.

**"Play" means now** (since 2026-11-18). Say "play" and what you'd like, with no DJ named and no length: an artist, a song, an album or a genre. It works the same by maple crate ("Alexa, ask maple crate to play the Beatles on the Ultra"), in Talk, in the Claude app or ChatGPT, and by the TV's voice.

- **An artist, a song or a genre** starts at once on the guest DJ's preset ({guest preset}), with a few songs the house found for it, and the DJ who fits carries on from there, endless: Deep Dive for an artist or a song, Genre for a genre. Their own songs come in after the song that's playing when they're ready, usually within a minute or two. Whoever was the guest DJ is replaced, at once. [mcp/playnow.js, mcp/playnow-start.js]
- **An album** ("play Abbey Road") plays as itself, in order, on no preset. Nobody follows it.
- **A style a house DJ owns** ("play funk from the seventies", "play some Stax") starts that DJ's own preset, and the songs turn that way after the first one.
- **A song that's also an album** ("Jolene", "Pet Sounds"): the house asks "the album, or the song?". Maple crate keeps listening for the answer. Elsewhere, say "the album …" or "the song …" first.
- {if helper} **On a WiiM the key is pressed** through the home helper, so it starts cleanly and lossless. With the helper off, Spotify starts it.
- **A DJ named with words and no length plays now too:** "Hank, some 70s soul" starts Hank's preset and turns it toward 70s soul; "Deep Dive, Prince" puts Deep Dive on the guest DJ's preset with Prince. **A new set is made only with a length or "a set"**: "Hank, an hour of 70s soul", "Hank, a set of 70s soul", or when you ask to keep it. A DJ's name alone ("Hank") still starts their preset as it is. The Ask form on a DJ's page always makes a set.
- **It costs one of the day's {daily runs} DJ runs** when a DJ follows. Ask for something new before the DJ has started on the last ask, and that last one isn't counted.
- **Not at once:** classical, the charts, "something like …", several artists together and a mood alone are said, not played: ask a DJ for those. Maple crate now and then loses a "play …" to Alexa itself (YouTube, or "I can't help with that"); saying it again works.

## Asking a DJ for a set {if requests}

> It goes on {requests presets} and replaces what was there.

- **Where it goes:** a set you ask for (a length, a mood, a subject) goes on **{requests presets}**, in place of the set that was there.
- {if playnow} **By voice or in the chat, say a length or "a set"** to get one made (since 2026-11-18): "Sessions, an hour of acoustic grunge". A DJ with other words and no length plays now instead, as "Play something now" says.
- {if tidal} **Which service:** the **On: Spotify | Tidal** switch on the DJ's Ask form. It starts on Spotify, and each phone remembers its last choice. Typing "on Tidal" in the box doesn't switch it: words there are taste. (By voice or in the Claude app, just say "on Tidal".)
- {if waits} **A DJ with a preset of their own:** their set lands on their own preset ({house presets}) instead, and Requests stays as it was. That holds until a curator is set up.
- If there's nowhere to put it (no Requests preset for that service), the ask is refused before anything is written.
- **Keep** puts the set on the Shelf for good. By voice or in Claude or ChatGPT, say **"keep it"** about the set on Requests (since 2026-09-28). Only a set with a DJ can be kept, because the Shelf is sorted by DJ.
- {if autoasks} **Play when ready** (since 2026-11-15): tick it on the DJ's Ask form and choose a speaker, and the set starts there by itself when it lands, as a set asked by voice does: if it lands within 25 minutes of asking, and nothing else has started playing since. Music somebody chose in between is never cut off: the set then waits for a press of its preset. Not ticked, nothing plays until you press Play. [mcp/asks.js `startExtra`, `startAsked`]
- {if autoasks} **The right songs at a start** (since 2026-11-15): when the house starts a set the moment it lands, Spotify sometimes begins on the songs that playlist held before. The house checks the song that is playing against the new set and asks again, twice at most. Before, the wrong songs lasted until the next ten-minute look. [mcp/lossless.js `playingOneOf`]
- **Short notes or the long read** (since 2026-10-18): on the Librarian's and Gatefold's pages, ticking Keep offers a choice. **Short** is a line or two about each song. **Long read** is the stories behind the records. Since 2026-11-12 it is researched first (notes gathered from the people who were there and from what was written at the time), written from those notes, and read against them before it is published. It is as long as the story is: there is no word limit, and a subject with little written about it gets a shorter page, not a padded one. Since 2026-11-13 the house counts the research: a long read that comes with fewer than 20 notes, from fewer than 6 different sites, or under 1,500 words is sent back to its writer once, to read more and write it out. A site is where a note was read (since 2026-11-14): every page of Wikipedia together counts as one, and so does one magazine; a book or a record sleeve is one each. The second time it is published as it comes, so a subject with truly little written about it still gets its page, and says so. The music doesn't wait for either: the curator puts the set on its preset first and only then researches and writes the page (since 2026-11-14). The page follows, usually within ten minutes; a long one can take half an hour. Each phone remembers its last choice; until it has chosen, the form starts on {notes default}. [house.json `requests.notes`]
- **Play on the Shelf** plays a kept set's own songs on the speaker you picked, and puts it on no preset, so the set on Requests stays. While it plays, the bar names the DJ and the set. **Load**, on the set's own page, puts it on Requests (since 2026-10-10).
- **A playlist of its own** (since 2026-11-14): a Spotify set's page in the app has **Make a Spotify playlist of this set**. One press makes a playlist on your Spotify account with the set's songs, in order, and from then on the page links to it (**Open in Spotify**, also on the page you send to someone), whether or not a preset holds the set. Until then a page has that link only while its set is on a preset. It's made only when you ask, never by itself. The playlist is **public**: anyone with the link can open it, and it shows on your Spotify profile, because Spotify has nothing in between. **Remove its Spotify playlist**, at the foot of the page, takes it out of your library and off your profile and leaves the page, which can have a new one made later; deleting the program removes it too. A link somebody already holds still opens either way, because Spotify itself deletes nothing. Only a set of Spotify songs can have one. [mcp/listen.js]
- **When a DJ passes on your ask**, the reason shows in the header of their page for **12 hours**, then further down that page until you ask them again. It also shows on Loaded, under the preset the set was for, until a new set lands there, for 12 hours at most (since 2026-10-30). Where another DJ could do it, the page offers them the same ask in one press.
- **A set asked of a DJ by name**, by voice or in Claude or ChatGPT, carries that DJ's name on Requests, so **More like this** follows them. The app takes the asker's word for which DJ it was. A set with no DJ named has no name, and can't be steered (since 2026-09-28).
- {if tidal} **On Tidal, Max quality when there's a choice:** where the same recording comes in several releases, the DJ takes the one Tidal plays at Max (Hi-Res). Never a different take or mix for it (since 2026-09-27).

## Which DJ gets an ask {if endless}

> Name a DJ and they play. Live music goes to Sessions, one artist to Deep Dive, a genre to Genre.

- **Naming a DJ plays them endless.** A DJ with a preset of their own plays from it. Anyone else becomes the guest DJ ("play Genre, ska" makes Genre the guest with those words). Only an ask for *a set* ("an hour of Hank", "Hank, something for cooking") makes a new set.
- {if guest} **Anything live asked for endless** ("something unplugged", "Tiny Desk all night") is **Sessions**, the guest DJ on {guest preset} (since 2026-10-26).
- {if guest} **One artist by name, endless** ("Michael Jackson, endless", "change to the Jayhawks") is **Deep Dive**, the guest DJ on {guest preset}. It makes a set of that artist (about four minutes) and keeps to them, every top-up. Another artist is a new set. An artist or a style asked for endless always goes to a DJ, never to a one-off playlist that stops.
- {if guest} **A style or a direction** ("disco", "more like the Jayhawks"): if it suits the DJ who's playing, it steers them. If not, it goes to the DJ it suits, a house DJ first. The answer says who, in one line (since 2026-10-10).
- {if guest} **A genre no DJ owns** ("80s new wave, endless", "Delta blues all night") is **Genre**, the guest DJ on {guest preset}. It makes the set like Deep Dive does (about four minutes), and keeps to that genre, every top-up. A genre a DJ owns (soul, funk, Americana…) goes to that DJ (since 2026-10-10). But Genre, asked by name for one of those, plays it the plain way: a DJ never refuses words given on a DJ's page, since a refusal would leave the preset empty (since 2026-10-26).
- {if guest} **Genre's too:** disco, club music, grunge, French song, Dutch-language music, jazz, reggae and hip-hop (since 2026-10-15).
- {if guest} **Hits:** about half of a Genre or Deep Dive set is hits. Say "more hits" or "fewer hits" while it plays, and it steers that way, keeping the genre or the artist (since 2026-10-12).
- {if guest} **Deep Dive and Genre must be told what to play:** on their page, type it in the box beside Play endless. Their squares on the DJs tab have no ▶ for that reason.
- {if guest} **Nearby, one tap:** while Genre or Deep Dive plays as the guest DJ, their page and the bar's panel offer four places to turn. For Genre, neighbouring genres, suggested by the curator with the first set. For Deep Dive, similar artists, from Last.fm. A tap makes a new set of it, about four minutes, using one of the day's DJ runs. New words bring new suggestions (since 2026-10-24).
- {if history} **Six DJs became three** (since 2026-10-13): **Vibe** is Sunny, Morning and Nightside; **Soul** is Stax and Soul Factory; **Hip Hop** took in KRS-One (both cut since, below). The old names still work: "play Stax" is Soul with "the South (Stax)", "play Motown" Soul with "the North (Motown)", "play Sunny" Vibe with "the room", "play Nightside" Vibe with "the small hours", "play Morning" Vibe with "the morning". Sets on the Shelf under the old names are on the new DJ's page.
- {if history} **Ten DJs**, for this house and the forum version (since 2026-10-15): Camille, Monk, the Professor, the Selector and Hip Hop are cut. Prince's own records are Deep Dive's; jazz, reggae and hip-hop are Genre's. Two DJs write a page with their set now, the Librarian and Gatefold. Their sets on the Shelf and asks already made still show, under the old name. **Eleven since 2026-10-26**, with Sessions.

## DJ presets {if waits}

> A DJ's own preset plays about an hour · new songs when you ask that DJ · endless once a curator is set up.

- **A DJ preset** ({house presets}) holds one DJ's songs: about an hour to start with, chosen for that DJ (since 2026-11-10). A press plays them, and they stop at the end.
- **New songs:** ask that DJ for a set in Claude or ChatGPT (a length, a mood, a subject). It lands on **their own preset**, in place of the songs there, and Requests stays as it was. A set asked of a DJ with no preset goes on Requests.
- **Nothing adds songs by itself yet.** Start fresh, More like this and Change it up are the curator's work, so the pages don't offer them. Play does, and spends nothing.
- **Adding and removing:** on the setup page, under DJ presets. Each takes a few minutes to save on every WiiM, and three is a good number to stop at. Remove frees the number; the playlist stays in your Spotify.
- **Once a curator is set up** (Endless, on the setup page), the same presets add songs by themselves while they play, with nothing to save again. From then on, a set you ask a DJ for goes on Requests.

## Endless DJs {if endless}

> 45 more minutes when 30 are left · {daily runs} endless runs a day · no repeats in 150 songs.

**What they are**

- {if housedj} **A house DJ preset** ({house presets}) plays one DJ, endless: the same DJ every press. To change who is on one, go to a DJ's page.
- {if guest} **The guest DJ** ({guest preset}) is whoever you last played endless who has no preset of their own. They start at once from their newest program, or make an opening (about four minutes).
- {if newdj} **More house DJs, up to 4** (since 2026-10-18): on a DJ's page, **Make … a house DJ** offers a free number. The house makes the playlist and the first set (one endless run). The page then shows how to save the preset on each WiiM, until someone taps **Saved on every WiiM**. **Give up preset N**, on a house DJ's page, frees the number. The WiiMs keep playing the last set there until something else is saved on it.
- **An endless preset's playlist belongs to the house:** nothing writes a set over it (since 2026-10-16). A set asked of a DJ goes on Requests instead, and a turn for the DJ who's playing is a steer.
- **It says "endless":** the bar, the speaker's box on Speakers and the DJ's page say "endless" when an endless preset plays or is paused. Never on Requests, or on Spotify's own picks after a playlist runs out (since 2026-10-13).

**How a set keeps going**

- A press plays the DJ's playlist. While it plays, the house looks **every 10 minutes**.
- **Top-up:** when **30 minutes or 4 songs** are left, the DJ adds **45 minutes** more. [house.json `endless`: `topupMinutes`, `batchMinutes`] A skip on the app's bar that leaves the set that short asks at once (since 2026-11-02). Skips in the Spotify app or on a remote wait for the next look.
- {if helper} **A set started in the Spotify app on an Echo or a phone** can go up to **3 hours** before the DJ notices it and tops it up. Opening the app brings that down to about 10 minutes. A Play from the app is noticed within about 10 minutes, and so is a press on a WiiM, its remote included: the home helper tells the house when a WiiM starts an endless preset (since 2026-11-15).
- {if no helper} **A set started anywhere but the app** (a WiiM's remote, the Spotify app) is noticed at the house's next look, up to **30 minutes** later, or up to **3 hours** in a quiet stretch. A Play from the app is noticed within about 10 minutes.
- **At most 4 hours of top-ups a start**, then the set plays out.
- **{daily runs} endless runs a day** across all endless presets: top-ups, fresh sets and steers. A set you ask for doesn't count. After that, no new songs until tomorrow. [`dailyRuns`]
- **No repeats** of the last **150 songs** the DJ played, or of anything the house played in the last three hours. *Repeats* says how.
- **A session ends** when two looks in a row find it not playing (about 20 minutes).
- **After a session:** if at least **4 songs and 15 minutes** are unplayed, they're kept, and the next press carries on from there, whether tonight or next week. If not, the DJ makes a **fresh one-hour opening** for the next press.
- **What counts as heard comes from Spotify's own history** (since 2026-11-15). Spotify keeps the last 50 songs played (30 seconds or more), with the playlist each came from. At a session's end the house cuts up to the last song you actually heard, not only to where its last look saw the set. And a preset played without the house seeing it (a short listen between two looks) is cut the same way at the next look, at most every half hour. The songs heard count toward the DJ's list of songs not to repeat. It costs one Spotify call a look, about 48 a day at most. [endless.js `recentPlays`]

**The buttons**

- **Play** on a DJ's preset plays what's on it, and never makes a new set. On a preset with nothing on it yet, Play says so and Start fresh takes its place, for the first set (since 2026-11-05).
- **Start fresh** (on a DJ's page, under **More**): a new one-hour set, started on the speaker you picked as soon as it's made. If it takes longer than **25 minutes**, it's only put on the preset for the next press: a late set never starts music by itself. If that preset is playing by then, its songs go on the end of the playlist instead (since 2026-10-31). Tapping Start fresh again starts the 25 minutes over. A guest DJ's opening works the same way (since 2026-10-02).
- **Steering** ("More like this", "Change it up", or asking for a turn): about **45 minutes** in the new direction replace what was queued, starting after the song that's playing. That's a top-up's worth, so one tap is one endless run (since 2026-09-28). It jumps in at once only if you say "now".
- **Steer in your own words** (since 2026-11-11): on the page of a DJ who's playing endless, **More** has a box for a turn in your own words ("more upbeat", "no ballads", "James Brown"). It works as a spoken steer does: about 45 minutes that way, after the song that's playing, one endless run. The DJ keeps to it on every top-up until the music stops. The **Ask** box on the same page is something else: it always makes a one-off set on the requests preset, and a line above it says so while the DJ plays.
- {if requests} **On a request set**, a spoken steer waits for the set to end, unless you say to replace the rest. The **More like this** and **Change it up** buttons in the bar's menu are the asking: on a request set they replace the rest after the playing song (since 2026-09-27). Where they can't work, on a set asked for without a DJ, the menu says why instead (since 2026-09-28).
- {if tidal} A set on Tidal can't be steered: the app can't see Tidal play, and the menu says so.
- {if talk} When Talk picks the songs itself, it sends about 25, costing no run, and the DJ tops up from there.

**Telling a DJ what to play**

- {if guest} **Any guest DJ can be told what to play** (since 2026-10-13): "Gatefold, 1971, endless", "Pub Rock, the eighties, endless". The words are kept on every top-up until you change them. Other words make a new opening (about four minutes), never an old program. Vibe's and Soul's pages have a box for it beside Play endless, which can be left empty, while they're not on a house preset. A house DJ's own preset takes no words: to turn one, steer it (by voice, in the chat, or in the box under **More** on their page).
- **Words you gave a guest DJ** ("acoustic grunge") stay on every set and top-up. **Change it up** lets go of them, unless the DJ has to be told what to play, like Deep Dive's artist (since 2026-10-31). More like this and Start fresh keep them, and no button touches your Tune sliders. Sessions has a box beside Play endless for new words, as Vibe and Soul do (since 2026-10-31): new words make a new set, and an empty box carries on.
- {if talk} If another guest DJ is already playing, Talk asks: after this song, or now?

## Repeats

> {if endless} No song from the last 7 days, and a DJ doesn't play a song again until 150 of their others have played.
> No song from the last 7 days, and never the same song twice in one set.

{if endless} An endless DJ remembers what they've played, so the same preset, pressed night after night, keeps finding something new.

- **Nothing from this week** (since 2026-11-07). A song played in the last **7 days**, by any DJ on any preset, stays out of a new set, unless you asked for that song by name. Another take of it (a live one, a remaster) is a different song and can play. A set counts once it's on a preset; an undo, or an old set put back, doesn't. [week.js; station.js `played_week`]
- {if endless} **For an endless DJ, only what played** goes into the week, as with their own list below.
- **How it's kept to.** Every DJ gets the week's list before making a set. A set asked for on a DJ's page, or by an endless preset, that still holds one is sent back to the DJ once (see the checks below). A set made in Claude, ChatGPT or Talk is written as sent, and the DJ is told which songs were already heard this week, to swap.
- {if endless} **150 songs before a repeat.** Each DJ keeps a list of the last **150 songs** they played, and leaves them out of every new set. That's about five evenings of listening, but it's counted in songs, not days. A DJ you play every night would come round to a song within a week, which the week's rule above now stops. One you play once a month may not for months. The list belongs to the DJ, not the preset, so it goes with them to another number. [house.json `endless`: `noRepeatSongs`; endless.js `endlessRemember`]
- {if endless} **Only what played counts.** A song that was on the playlist but never played isn't used up (since 2026-09-25).
- {if endless} **Nothing the house just played.** Anything heard in the last **3 hours** is left out too, whoever played it: another DJ, the Shelf, the Spotify app itself. This comes from Spotify's own history, which logs a song only after about 30 seconds, so a quick skip doesn't count, and music from another service or the radio isn't in it (since 2026-10-18). [endless.js `HEARD_WINDOW_MS`]
- {if endless} **Nothing twice on one playlist.** New songs added to a playing set never repeat one already on it.
- {if guest} **Deep Dive goes through every album** of an artist before any comes round again.
- {if endless} **What can come back sooner:** another recording of a song you heard (a live take, a remaster) is a new song to Spotify and to the list. And the list holds songs, not artists: an artist you just heard can turn up again in the next set.

**The house checks a set before it plays:** every endless set, every set asked for on a DJ's page (since 2026-10-18), and a set asked of a DJ by name, by voice or in Claude or ChatGPT (since 2026-10-24). A set that names no DJ isn't checked.

- Never the same recording twice.
- No song from this week, unless you asked for it by name (since 2026-11-07). Checked like this for an endless set and a set asked for on a DJ's page; a set asked by voice or in Claude or ChatGPT is told after it's written instead.
- Never one song twice in two versions: a remaster, a live take, another mix or edit (since 2026-09-27).
- Never the same song or title back to back: a song's versions are spread through the set.
- Each DJ's own spacing of artists. Genre and Sessions never play an act twice in a row, or three times an hour. Soul never plays three in a row from one act. Vibe plays one song an act. Deep Dive never plays two from one album in a row. Sessions' top-ups leave out the acts of the last two batches (since 2026-11-02). The **Same artist** slider changes the spacing.
- A set that breaks a rule goes back to the DJ to be fixed, once. Then it plays as sent, and the log says what it held. For a set asked by voice or in Claude or ChatGPT, the second try is any set by that DJ on that preset within 15 minutes.
- Not counted against a set: a set of one song's versions, or an hour of one artist asked of Soul (since 2026-10-18).

## Tuning a DJ

> Four sliders per DJ, kept until you change them back.

- **Tune** (since 2026-10-23): beside **At a glance** on a DJ's page, and beside **More like this** and **Change it up** in the bar's panel while a DJ plays. It opens the DJ's own sliders: their years, how many hits, how often one artist comes back, and how far from their genre they stray. A small ring marks where the DJ stands on their own.
- **Some DJs have their own slider:** Vibe has **Mood** (pin the morning, the room or the small hours, instead of the hour choosing). Deep Dive has **Career**, **Live takes** and **Order**. The Librarian and Gatefold have **Notes** (short or the long read: the starting choice on their Ask form). Sessions has **Genres**: close (one family of music the whole set), drift (each song a neighbour of the last, a few turns an hour) or anywhere, its own (since 2026-10-27).
- **Only what fits the DJ:** each slider moves a DJ inside their own character. Soul's years run 1959 to 1979, and it never offers "no hits". Dr. Funkenstein can go up to half hits, at the owner's word.
- **It lasts:** a tuned DJ stays tuned, for every set and every top-up, whoever asks: any phone, Talk, Claude or ChatGPT. It stays until someone moves the sliders back or taps **Reset**. The DJ's page says so in one line. Words in a request still win: "an hour of Soul, all the hits" gets the hits.
- **While the DJ plays**, **Apply after this song** replaces the songs queued after the one playing, as Change it up does. It uses one of the day's DJ runs.
- **When they're not playing**, **Save** keeps the change, and the next new songs follow it. The songs left from last time play first.
- **The house checks the Same artist slider** before a set lands, as it checks the DJs' own spacing. The other sliders are the DJ's to follow: the curator gets them as instructions with numbers ("2 or 3 hits an hour"). [mcp/tuning.js; the DJs' sliders in djs.js `TUNE`]

## Sessions {if requests}

> Bands live in a small room: radio and TV sessions, never the studio record.

**Sessions plays bands live in a small room** (since 2026-10-26): radio and TV sessions, never the studio record.

- **The series:** John Peel's and the BBC's sessions, MTV Unplugged, NPR's Tiny Desk, 2 Meter Sessions, Spotify Sessions, Audiotree Live, Austin City Limits, Sessions at West 54th (since 2026-10-30), Live at Third Man Records (since 2026-10-30), Rockpalast from a small room (since 2026-10-30), triple j's Like A Version and VH1 Storytellers.
- **Never** a karaoke or tribute version, a contest entry, a festival stage, or a concert album from a hall.
- **Outside the series**, a live take counts, at most two an hour, when its title or album names a club of about 1,000 people or fewer, or a TV or radio studio (since 2026-11-02). A bare "Live" doesn't, and neither do bigger rooms: Paradiso, the Apollo, the Bataclan, the Ryman. Name a series and there are none.
- **A best-of** counts when its title names the series, whether it's one act's or many acts'.
- **Rockpalast** counts only where the title names WDR's studio, Harmonie Bonn, Zeche Bochum or Markthalle Hamburg, so never its halls or open-air shows.
- **A set crosses the series and the decades:** at least four series an hour. Audiotree is at most a quarter, and no other series more than a third, unless you named it. The BBC's and Peel's count as one. About half of it is songs you know, in their session version. Every set looks for a session that came out in the last month.
- **To keep to something, name it:** a series, years or a genre ("Peel sessions from the eighties", "only unplugged", "sixties bands", "only hip-hop"). "Sixties bands" play in sessions of any year, while "recorded in the sixties" leaves only the BBC's and Peel's.
- **A decade's hits** ("seventies hits") are the decade's songs, mostly real hits, in sessions of any year, with a newer band's cover among them. Under a decade, the new session is such a cover, and when none fits, the set goes without one and says so.

## Talk {if talk}

> {talk minutes} minutes a day. The day starts at midnight, {time zone}.

**{talk minutes} minutes a day**, counted by the server's clock. The day resets at midnight, {time zone}. [voice.js `CAP_MINUTES`; the house's time zone, `HOUSE_TZ`]

**The line hangs up by itself, because it costs money while it's open, even in silence.**

- **When nobody is talking:** 30 seconds after the desk's last word.
- **After a press with nothing said, or nothing answered:** about 40 seconds after it.
- **When you leave the page** (another app, another tab, the phone locked): as soon as nothing is being worked on, so a set being written is finished first. If the phone stops the page altogether, the house hangs up within a minute and a half (since 2026-10-24).

{if talkasks} **A set you ask a DJ for by voice is made after the call** (since 2026-11-04). Talk hands it to the curator, the same way a DJ's Ask form does, says who is making it, and you can hang up: leaving the page or locking the phone loses nothing.

- {if talkasks} **Talk says it's on its way only once the house has the ask** (since 2026-11-05). Until then it says it's asking. Hang up while it's still asking, and the line stays open until the ask is in, thirty seconds at most.
- {if talkasks} **A DJ's name heard a letter off** ("DJ Pup Rock") still finds that DJ.
- {if talkasks} **It lands on {requests presets}**, in place of the set there, usually within five minutes.
- {if talkasks} **It starts by itself on the speaker you named** (since 2026-11-05), if it lands within 25 minutes of asking, and nothing else has started playing since. Music somebody chose in between is never cut off: the set then waits for a press of its preset.
- {if talkasks} **No "are you sure":** asking is the yes. Its length is the one you said, rounded to 30, 60, 90 or 120 minutes, and an hour when you said none. Ask to keep it and it goes on the Shelf as well.
- {if talkasks} **Still made on the call:** a set with no DJ named, a change to what's playing ("more upbeat"), and "keep it" for a set already there. [asks.js `startAsked`; voice.js `askRule`; house.js `findSpokenDj`; the Talk page's `finishing`]

{if tidal} A Tidal set asked by voice starts by itself only on a WiiM, with the home helper on, which presses its preset. Anywhere else, press it.

{if helper} **Talk presses a WiiM's presets** (since 2026-11-08), as maple crate does: "press 12 on the Pro Plus", or by what the preset holds: "put on Radio Paradise". With the home helper on, the WiiM presses it as its remote would, so whatever the key holds plays, a DJ, Tidal, Pandora, the radio, with any settings saved with it (a WiiM Home "Smart Preset" can keep a volume and an EQ with a button; most buttons have none). Talk names what's on the key.

- {if helper} **A preset by name** is the name saved on it, whole, with case and punctuation aside. A name on no preset, or on two, presses nothing, and Talk asks which.
- {if helper} **"Put on Hank" presses Hank's own preset** when the WiiM's list still names him there. With words ("Hank, something for cooking"), or on an Echo, he starts as before.
- {if helper} **With the helper off,** a DJ's preset and the Requests preset start through Spotify, without any settings saved with the preset, and Talk says so. Anything else is "press it on the remote". An Echo has no keys: a DJ's preset plays there as its playlist, and the radio is named with the WiiMs it plays on.
- {if helper} **No "are you sure":** asking is the yes. The app follows that speaker only once the press is confirmed. [talk-press.js; alexa-act.js `presetAct`, `pressOwnKey`, `keyNamed`]
- {if helper} **What the WiiMs play beside Spotify** (since 2026-11-08): "what's playing" names Tidal and the radio on a WiiM, and which EQ each WiiM plays through ("the Pro Plus is on Dance"). A WiiM on one of its inputs isn't counted as playing. Talk never sets an EQ.
- {if helper} **Pause and play again on Tidal or the radio** (since 2026-11-08): on the WiiM you name, through the home helper, as maple crate's "hush" and "carry on".

**Talk moves the music** (since 2026-11-08): "move it to the Ultra" carries what Spotify is playing over, the same song at the same place, as the bar's move. Only Spotify moves: Tidal stays where it is, and the bar can move the radio. The app follows the speaker it moved to. [talk-press.js `talkMove`; transport.js `moveOn`]

{if no helper} **A preset by number** ("play preset 5"): a DJ's preset and the Requests preset start through Spotify. Anything else is "press it on the remote"; a home helper would press it on the WiiM.

**Talk changes only the house's own playlists** (since 2026-10-25): its presets', its DJs' and the ones it keeps. Any other playlist on the Spotify account it can play or read out, but never change.

{if archive} **The archive by voice** (since 2026-10-10): ask Talk for {archive asks}. It loads the takes onto **preset {archive preset}** and, when the speaker is a WiiM and the **home helper** is on, has the helper press {archive preset} there, so it starts. Otherwise it says it's loaded and to press {archive preset}, and why (the helper is off, or the speaker is an Echo). For "the show" at a venue in a year with several nights, Talk says how many and asks which. Loading or starting {archive preset} needs no yes.

## Maple crate {if alexa}

> On an Echo: "Alexa, ask maple crate for Hank." Spotify only.

**Maple crate is a private Alexa skill on this house's Echos** (since 2026-11-07). It was called house radio until 2026-11-08, when Alexa began taking "open house radio" for its own radio, then wax room until Alexa+ took "room" for one of the house's rooms (an announcement, Drop In), then wax works until it answered with a film. The name has no music, room, device or brand word in it, and is no title. Start each sentence with "Alexa, ask maple crate for …" or "…to …": without "for" or "to" after the name, Alexa never passes the sentence on (the owner's tries, 2026-11-08). Say it a little slowly: a sentence said fast can miss the skill altogether.

- {if playnow} **Play something now:** "…to play the Beatles on the Ultra", "…to play Abbey Road", "…to play some 80s hip hop", as "Play something now" says. "…for Sessions, acoustic grunge" (a DJ with words and no length) plays Sessions' preset now, steered that way (since 2026-11-18).
- **A set from a DJ:** "…for Sessions, acoustic grunge, on the Ultra, for two hours". It's asked the way a DJ's Ask form asks, lands on {requests presets}, and starts by itself on the speaker you named, as Talk's does: if it lands within 25 minutes and nothing else has started since. "No …" or "without …" says what to leave out ("no Eagles"). A room may come bare too: "…for Sessions, acoustic piano, living room" (since 2026-11-08). No speaker said: the {default speaker}. No length: an hour.
- **No DJ named** ("…for something mellow for dinner"): Alexa asks "Which DJ?". Say a name and nothing else; anything else lets the ask go.
- **A DJ put on:** "…to put on Hank", "…to play Vibe on the Ultra", or a DJ's name alone ("…for Hank"). They start on their own preset, or on the guest DJ's ({guest preset}) if they have none. A length said with only a name is dropped. If another DJ is on the guest preset, Alexa says who: ask again with "now" or "after this song".
- **A preset by number:** "…to play preset 7". A DJ's preset is that DJ put on; the Requests preset starts the newest set you asked for.
- {if helper} **With the home helper on, a preset is pressed for real** (since 2026-11-07): "…to play preset 10 on the Ultra" presses 10 on that WiiM, as its remote would, so whatever the key holds plays, with any settings saved with it: a DJ, Tidal, the radio. Alexa says "pressed", and names what the WiiM has on that key. A house DJ put on by name is pressed on their own key too, when the WiiM's list still names them there. With the helper off, presets start as before (without the preset's saved settings), and anything Spotify can't start is "press it on the remote".
- {if tidal} **Without the home helper, a Tidal preset can't be started by voice:** press it on the remote.
- **A preset asked of an Echo** (since 2026-11-08): an Echo has no keys. A DJ's preset and the Requests preset start there as their Spotify playlist. A preset that holds the radio, Pandora or Tidal is named, with the WiiMs it plays on: "Preset 10 is KQED, on the radio, which plays only on the Pro Plus and the Ultra." What a key holds is the WiiMs' own word, as the helper or the phone last read it; an old note of what a key once held is never started over it. For the radio on an Echo itself, ask Alexa: "Alexa, play KQED".
- **Endless with words** (since 2026-11-07): "…for Deep Dive on Michael Jackson, endless" or "…for Gatefold, 1971, all night" puts that DJ on the guest DJ's preset with those words, as the box beside Play endless on their page does. "Endless" said last is what makes it endless; without it, the words make a one-off set. A house DJ with a preset of their own starts it, and the words steer it (since 2026-11-08): "…for Sessions, acoustic grunge, endless" starts Sessions' preset and the new songs come in after the first. Asked again while the set is still being made, Alexa says so rather than making a second.
- **Now, or after this song:** "…to put on Pub Rock now" (or "…after this song") takes the guest DJ's preset over from the DJ on it. Without either, Alexa says who is on it and stops there.
- **A fresh start:** "…to start Hank fresh" (or "…for Hank, fresh") makes a new opening set for the preset the DJ is on, as their page's Start fresh does, using one of the day's endless runs. It starts on the speaker once it's made, in about four minutes.
- **Steering the DJ who's playing,** in one breath with "steer" (since 2026-11-08): "Alexa, ask maple crate to steer the same way" (the bar's More like this), "…to steer somewhere else" (Change it up), or your own words: "…to steer toward Stax", "…to steer it mellower". "…to steer the same way" was tried on the bedroom Echo and reached the DJ (2026-11-08). Without "steer", "more like this", "change it up", "more upbeat" or "fewer hits" said in one breath go to Amazon Music, and "Alexa, open maple crate" first is refused under Alexa+. The new songs come in after the one playing, in a few minutes; over a set you asked for, your own words wait for its end, and the DJ carries on that way after it. Maple crate keeps listening, so the next steer or "go back a song" needs no opening again (until about eight seconds of quiet).
- **Keep:** "…and put it on the shelf" (or "…and keep it") said last with an ask keeps that set on the Shelf too, like the Ask form's Keep box. Alexa once heard "and keep it" as "and Cupid", so the shelf is the safer way to say it. "…to keep this set", said while a set you asked for plays, does the same for it: the house saves its songs as they are on the preset, and the DJ writes its page in a few minutes.
- **What's playing:** the song, the speaker and which preset, or that it's paused.
- {if helper} **The radio and Tidal, through the home helper:** "what's playing" names them, and "hush" and "carry on" pause and resume them on the WiiM; "skip" and "go back" move a song on Tidal (or another service with songs) on (since 2026-11-16), and never a station. With no speaker named and two WiiMs playing them, Alexa asks which. A WiiM on one of its inputs (the TV's optical, line-in, Bluetooth) isn't music to it: never said as playing, never paused (since 2026-11-08).
- **Pause, play again, skip, back, move:** in one breath, tried on the bedroom Echo (2026-11-08): "Alexa, ask maple crate to send the music to the Ultra" moves it, and "…for one song back" goes back a song. "Hush" and "carry on" in one breath don't reliably reach the skill (Alexa keeps them for itself; "carry on" once resumed Alexa's own music), and under Alexa+ "Alexa, open maple crate" is refused, so the bar's pause is the sure way; music playing on the Echo you speak to also pauses with Alexa's own "Alexa, pause". "Move music to …" without "ask maple crate to send" is Alexa's own: it moved music Echo to Echo and said "okay" to the Pro Plus without moving anything. The same as the bar's buttons: on the speaker you named, or the one Spotify is playing on. Play again starts what the pause stopped, from where it stopped, never Spotify's own resume.
- **Not caught:** if maple crate doesn't catch what you said, it says so and keeps listening, so you can say it again without "Alexa" (since 2026-11-08).
- **Longer than five seconds:** Alexa says what it began (a press on a WiiM, a start anywhere else), and the app shows when it plays.
- **What to say** (since 2026-11-08): a page from the Talk tab ("?", or the maple crate box) lists the sentences that work, Talk's and maple crate's, each with what it does. The maple crate examples are this house's own DJs, presets and speakers, and every one is checked against the skill's reading.
- **What it heard** (since 2026-11-08): a box under Talk's button says whether maple crate is on, and shows the last three things it heard, as Alexa passed them on, with what it said back. A word Alexa misheard shows there.
- **Only Amazon gets in:** every request carries Amazon's signature, and the house checks it before it does anything. Each request is answered once: a copy sent again is refused. [alexa.js; alexa-act.js; alexa-read.js; alexa-sign.js]

## On a TV

> A screen for a TV's remote: the rooms, the presets and what is playing, and the cover large when nobody is steering.

- **The TV page** (since 2026-11-15): **TV**, at the foot of the Speakers tab, opens the house as one screen made for a TV's browser and its remote. The room shown is one button at the top left, the picked room's presets fill the middle, and what is playing sits along the bottom with Pause, Play, Skip and a button back to the song before. At the top right, a **microphone** (since 2026-11-16) shows how to speak to the TV: which key and what to say, since a page can't open TV Bro's voice search itself (only TV Bro's own start page can), **Now Playing**, a musical note (since 2026-11-16), shows the cover large, **DJs** opens the DJs, **Shelf** opens the programs, and **App** goes back to the phone's pages. Nothing on it is typed, and it has no Talk: a TV's browser gives a page no microphone that hears (measured on a Sony Bravia, 2026-11-15). [tv.js]
- **The remote:** the arrow keys move from one button to the next, and OK presses the one you're on. That button is filled amber. A browser that moves a cursor instead presses the same buttons. **One press, one act** (since 2026-11-16): OK held down, or pressed again within half a second of a screen or a view opening, does nothing, so a second OK never presses the next screen's first button; Skip and one song back wait for the song to change (or 4 seconds) before they take another press. On a page that scrolls, up and down reach the bar at its top only when nothing else lies that way.
- **The rooms** (since 2026-11-16): one button with the room's name, which opens every room as a tile: WiiMs with WiiM's mark, the one shown marked "Showing" and any with music "Playing"; a press shows that room. A room picked there is a choice like any other (see Which speaker), kept on that TV. Small bars on the button mean music is playing in the room shown.
- **A WiiM's tiles** are its own twelve presets, as the speaker was last read: the number, the name and what it is. A tile with nothing saved says so. A tile's corner is empty unless it is the one playing.
- {if helper} **A press on a WiiM** is the home helper pressing that key on the speaker, as its remote would: Spotify, the radio and every other service alike, and Spotify then plays lossless. While the helper is off, a Spotify preset starts through Spotify, and the other tiles say "On the remote".
- {if no helper} **A press on a WiiM** starts a Spotify preset through Spotify. A preset from another service says "On the remote": only the home helper, which this house doesn't have, can press it.
- **Any other room** (an Echo, the phone) shows the house's own Spotify presets, the Requests preset and the DJs', and a press starts one there through Spotify.
- **What is playing** is said for the room being shown, in the bar's own words, with the cover, how far the song is and, where the speaker reports it, the stream's quality, on the song page on a line of its own under the room (since 2026-11-16).
- {if tidal} **A song on Tidal** (since 2026-11-16) shows as one on Spotify does: its cover, its album and how far it is, as the home helper reads the WiiM (it sends the place with any other change, or once a minute, and the page counts on from there), with **Skip** and one song back sent by the helper to the WiiM, and About this song by its title and artist. A station has none of these.
- {if genius} **Genius in About this song** (since 2026-11-16): who produced the song, what it samples, who sampled it, what it is a cover of and who covered it, a few names each, the most read first (anyone may add a song to Genius, so songs nobody reads there are left out of who sampled or covered it), and Genius's own short text when Wikipedia has none, marked as Genius's. Never lyrics. Asked by title and artist the first time the song plays while the TV page is open, and kept 90 days (a song Genius doesn't know, 14).
- {if genius} **The DJs can look a song up on Genius** (since 2026-11-16) for sets built on those links: the records hip-hop sampled and what sampled them, a song and who sang it next, a cover and its original. The lists are its readers' work: a DJ checks a link it isn't sure of, and every song is still found on the service as always.
- **More from Wikipedia** (since 2026-11-16): in About this song, when the song has a Wikipedia article, a button at the top fetches the rest of the article's story (the rest of its opening, then its sections: background, recording, release, reception and the like), leaving out its lists and tables (charts, certifications, track listings, credits, release history, references). It is asked for only when pressed, and kept 90 days; at most about 9,000 letters. No AI writes it. The tile that is playing is marked "Playing". Music in another room shows as small bars on that room's button.
- **The display** (since 2026-11-15): the cover large, the song, the artist and the album, a clock in the house's own time, and how far the song is. Back, Pause and Skip stay on it, and so does **Tune** when the DJ can be tuned. While music plays the page **opens on the display**; it also opens from **Now Playing**, from the small cover, and by itself once music has played for **1 minute** with the remote at rest. **Home** brings the buttons back (the way back is called Home on every TV screen). The display stays between songs: the buttons come back by themselves only after the room has been silent for **45 seconds**, and the display returns with the next music. A line too long for its place slides slowly, there and back. Between **10 at night and 7 in the morning** it dims while the remote rests, and it shifts a little every 2 minutes so nothing burns into the screen.
- **Up next** on the display: the next three songs, for a set from the Shelf and for a DJ's endless set. It comes from what the house keeps, so it costs no Spotify call. Other music shows none.
- **Move** (while Spotify plays in the room shown; a round button with an arrow into a speaker, at the bottom of the presets and on the song page): the rooms as tiles, and a press moves the music there, at the same place in the song. The screen then shows that room. A WiiM's tile carries WiiM's own mark. A phone only takes the music while its Spotify app is open, and the screen says so when a move doesn't land. Only Spotify moves, so the button isn't shown for the radio or another service.
- **About this song** (the round button with a circled i) shows the paragraph that names the song, for a song from a Shelf page whose DJ wrote about it, large enough to read from the couch. It stays while the song is paused.
- **Song facts** (since 2026-11-15), for any song on Spotify, endless sets included: who wrote it, where it was recorded, the year it first came out and the first album that holds it, and the opening of its Wikipedia article when it has one. They come from MusicBrainz and Wikipedia, open databases anyone can edit, looked up by the song's code (its ISRC) the first time the song plays while the TV page is open, and kept for 90 days. When there is no code, or MusicBrainz doesn't know it (a remaster or a compilation often has its own), the song is found by its title and artist instead, and then only its writers and its Wikipedia article are shown, since that match may be another recording of it. No AI writes them and they cost no DJ run and no Spotify call. A song neither database knows shows none, and then About this song shows only if the DJ wrote about it. They come under the DJ's words when there are some. [musicbrainz.js `songFacts`] It scrolls as a page: the remote's **up and down arrows** scroll it about three lines a press, and on while held (since 2026-11-16); **Page up** and **Page down** turn it a screen at a time and stop on a whole line, so the next page starts with the line that didn't fit (since 2026-11-15), and they go dim at the top and at the end, so a dim Page down means that is all of it. **Program notes** opens the whole page the DJ wrote, set for reading from the couch: every stop with its words and its songs, the song playing marked, and **To the song** goes straight to its stop. The phone's link that asks the assistant stays on the phone.
- **The Shelf:** every program as a cover, newest first; the page scrolls as you move down. A press **opens the program** (since 2026-11-16): its notes, with its cover, its length and **Play on** the room shown first in its bar. Nothing plays until Play is pressed, so one program can be read while other music plays. After Play the page stays, says what happened and marks the stop that plays; **Shelf** goes back.
- {if tidal} **A Tidal program** opens on the TV to be read and, in a room that is a WiiM with the home helper on, plays as on the phone's Shelf: put on the Tidal Requests preset, and its key pressed (since 2026-11-16). Anywhere else it says so, with no Play.
- {if endless} **Tune** (the round button with sliders), under Move and on the display while a DJ who can be steered is playing: that DJ's dials as sliders, each with a **−** and a **+**. A press moves one stop, or one year (five years for a DJ whose years run past thirty). The white knob is where a slider stands, and a small ring before a stop's name marks the DJ's own. The years are two sliders, one for the first year and one for the last, each saying its year under its knob. **Apply after this song** works as on the phone and uses one DJ run; **Reset** puts every slider back on the DJ's own and sends nothing until Apply (since 2026-11-16).
- {if endless} **The DJs** (since 2026-11-16): **DJs**, at the top right, shows every DJ as their own sleeve, the cover their playlist wears in Spotify and WiiM Home (since 2026-11-16), in three bands: the DJs on a preset of their own, the guest DJs, who take turns on the guest preset (only the one holding it says "Now on" it; the others say what they play), and the writers, who make a set with notes. A DJ who is playing has a light edge and says so; where the DJ's speaker is a WiiM the home helper reads, it must be playing that DJ's playlist (since 2026-11-16), so pressing another preset clears it at once. A press opens that DJ's screen. What a DJ's buttons and words do is what the same ask does on an Echo or on the Ask form: nothing on the TV decides it again. [tvdj.js; tvpages.js draws the screens]
- {if no endless} **The DJs** (since 2026-11-16): **DJs**, at the top right, shows the writers, who make a set with notes, each as their own sleeve. A DJ who is playing has a light edge and says so; where the DJ's speaker is a WiiM the home helper reads, it must be playing that DJ's playlist (since 2026-11-16), so pressing another preset clears it at once. A press opens that DJ's screen. What a DJ's buttons and words do is what the same ask does on an Echo or on the Ask form: nothing on the TV decides it again. [tvdj.js; tvpages.js draws the screens]
- **A DJ's screen** always fits the screen (since 2026-11-16). It shows what to say and gives it as buttons: three of the DJ's own example asks as large cards of up to two lines (for a guest DJ holding the guest preset, the genres or artists next to theirs; a house DJ's three in a row under Play and Start fresh). Since 2026-11-16 it no longer shows your last asks. A press asks for it at once, and the answer shows over the song page. **Surprise me** lets a guest DJ or a writer pick a subject of their own. While a DJ's screen is open, what is said to TV Bro's voice search (the Guide key) goes to that DJ without their name; a command (skip, pause, what's playing, a preset by number) is still that command. Home or the DJs list ends it, and so do 30 minutes.
- {if endless} **A house DJ's screen:** **Play preset** and its number, saying what it carries on with, and **Start fresh**, which uses one of the day's DJ runs. Words, said or pressed, start their preset and turn it that way; while they play, the words turn it after the song.
- {if endless} **A guest DJ's screen:** the words put them on the guest preset, endless, as "put on Genre, ska" does on an Echo. One setting: when another guest DJ is playing there, take over **after the song** or **now**. **Start fresh** shows while that guest holds the guest preset.
- **A writer's screen** (the Librarian, Gatefold): the words ask for a set as the Ask form does, with four settings beside them: its length (30 minutes to 2 hours), short notes or a long read, kept on the Shelf or not, and played when ready or not. Not played, it waits on the Requests preset.
- {if tidal} **A writer's set on Tidal:** a fifth setting, **On**, puts it on Spotify's Requests preset or Tidal's (since 2026-11-16); a Tidal set played when ready is started by the home helper pressing its key.
- **A DJ's settings are remembered for that DJ on that TV** (in the TV browser), not shared with the phone or another TV.
- **More like this** and **Change it up**, at the foot of a DJ's screen, turn that DJ, as the bar's buttons do on the phone. Another DJ playing is said and left alone, and no DJ run is used (since 2026-11-16).
- {if endless} **Tune** on a DJ's screen (the round button with sliders) opens that DJ's sliders, for a DJ who can be tuned.
- **Say it on the TV** (since 2026-11-15): the remote's own microphone button belongs to the TV's search, and a TV's browser gives a page no microphone, but TV Bro's own voice search can send the words to the house. Set up once: on **What to say** (Voice on the TV, at the foot of the Speakers tab) copy the house's address, then in TV Bro set **Search engine** to **Custom URL** with it, and put **Voice search** on a remote key under Remote and cursor (the Guide key, on a Sony Bravia's remote). Then press that key and say it as you would to the Echos: a DJ and what you'd like, a DJ alone, a preset by number, pause, skip, one song back, more like this, steer, what's playing. The house reads the words against the Echo skill's own sentences and does it the same way, in the room the TV page shows unless you name another; an act said twice within a minute is done once, and the second time shows the first answer; "what's playing" is answered every time. What it heard and what it did shows for about 20 seconds over the song page, which stays on screen while music plays (since 2026-11-15). Every TV Bro search then goes to the house, not to a search engine. The whole list of what to say on the TV is on What to say, under On the TV (since 2026-11-16). [tvsay.js]
- **A press that did not land** says why in a line at the bottom, for about 20 seconds, and a preset the house can't start keeps the buttons on screen with that tile in hand (since 2026-11-16). **A press on its way** says so ("Starting preset 5…", "Sending…" on a DJ's screen and on the dials, "Starting…" on a program's page) until the music shows it, or 25 seconds, and meanwhile the page looks every 3 seconds, so a station started by a key shows within a few seconds of the home helper hearing it. **When the house can't be reached** (the Wi-Fi, the internet), after two looks that failed a line says so until the next look that answers.
- **How often it looks.** The phone's pages stop looking after 10 minutes; a TV is left on, so this page slows down instead. Every **10 seconds** for as long as a look costs Spotify nothing (music playing on a WiiM, from Spotify, the radio or another service, with the home helper reading the speakers every **3 seconds** (since 2026-11-16)), so a song skipped in the Spotify app shows within about 3 to 13 seconds. Otherwise every **30 seconds** for **10 minutes** after the remote was last used. Otherwise when the song should have ended, and every **5 minutes**; every **15 minutes** once the remote has rested an hour. Any key looks at once, and a hidden page does not look at all. A TV page left open loads itself again, once, when a deploy has changed it (since 2026-11-15), and when a speaker's presets have changed, never only because they were read again, and never while About this song, Move or the rooms are open (since 2026-11-16). Once a song it also asks the house what comes next and whether the DJ wrote about it. [tv.js, the page's script; tvpages.js for the Shelf, the dials and the program notes]

## What the app can see

> {if helper} Spotify always; Tidal and the radio through the home helper.
> {if no helper} What Spotify is playing, and on which speaker.

- **Spotify:** what the account is playing, and on which speaker. One speaker at a time, because it's one account.
- {if helper} **Tidal and the radio:** only through the **home helper**, which reads each WiiM on the home network about once a minute. If it hasn't reported for **2½ minutes**, the app treats it as off. A small **house** beside the **?** at the top of every tab shows which (since 2026-10-22): its window is lit while the helper is heard, dark and grey when it isn't. Tap it to see which WiiMs answer the helper, or when it was last heard.
- {if helper} **With the helper on, the app can also** press a WiiM's preset keys, and pause or play it. The helper takes only pause, play, a preset key and "remove" from the house, and never renames a preset.
- {if helper} **A WiiM with a new address** (after a router restart or a power cut): the helper notices it has stopped answering. It finds it again by itself, by the WiiM's own id, within about a minute (since 2026-10-19). And if the router gives that old address to another WiiM, the helper sees it is not the same one, sends it nothing and reads nothing from it as that room: a press for one room never plays in another. It asks the WiiM who it is before every press, and every ten minutes; a WiiM that doesn't answer that gets no press either. A WiiM you replace with a new one is taken when you run the helper's setup command again (since 2026-11-11).
- {if helper} **Setting up the helper:** a house set up on its setup page gets its helper there. One command, run on a computer at home, finds the WiiMs and tells the house where they are. The setup page shows which WiiMs answer (since 2026-10-19). The command carries a code for the helper's key, good for an hour, so nothing else is pasted. **Remove**, on the setup page, takes the helper off its computer, and the house forgets it. On Windows it's also in Settings, Apps (since 2026-10-21).
- {if helper} **The stream's quality** (since 2026-10-25): the bar's panel shows, under where the music plays, what the speaker itself reports while a streaming service plays. For example "Lossless · 24-bit / 96 kHz · 2958 kbps" above 320 kbps, "Compressed · 128 kbps" at a compressed stream's usual rates, and just the numbers otherwise (Radio Paradise gives no bitrate). The speaker says 32-bit for a 24-bit stream; the panel says 24. Only the WiiMs report it: not an Echo, the archive, an input or AirPlay.
- **A DJ's page follows the bar** (since 2026-11-15): pause or start a DJ from the bar, the remote or anywhere else, and that DJ's page redraws itself within a few seconds, so its Play button and its "playing" line are true. Not while you are typing an ask or have a sheet open.
- {if helper} **Lossless when the app starts the music** (since 2026-11-15): a WiiM that has sat idle for some hours plays what the app starts at 320 kbps, whatever Spotify is asked (measured on both WiiMs, ten ways). A press of one of that speaker's own presets makes it lossless, and it stays so for everything started on it afterwards, until it has sat idle for hours again. So when the house starts a playlist on an idle WiiM, and that playlist is on one of the speaker's presets, the home helper presses that preset a moment later: the first song begins a second time, lossless. Not for a set that is on none of that speaker's presets (a Shelf set played as its own songs), not for the bar's play-again, and not for a move to another speaker: there, press a preset on that speaker once. The panel's quality line shows what you got. [mcp/lossless.js]
- {if no helper} **Lossless on a WiiM** (since 2026-11-15): a WiiM that has sat idle for some hours plays what the app starts at 320 kbps, even with Spotify Lossless on for that speaker. Press one of its presets on the remote or in WiiM Home, and that speaker is lossless for everything the app starts afterwards, until it has sat idle for hours again. With the home helper, the house makes that press itself.
- {if no helper} **Other services and the radio** need the **home helper**, a small program on a computer at home, which this house doesn't have.
- **Paused:** the app believes a pause only if **the app itself sent it**, or **the speaker itself says so** through the home helper. Spotify's own "paused" can be stale: it can still say "paused" long after the speaker has moved on to another source. The bar remembers its own pause for **one hour**, with the song's cover, artist and album (since 2026-11-02), and its play button starts that music again where it stopped.
- {if helper} **Stopped on Spotify** (since 2026-09-29): Spotify lets go of a WiiM that sits stopped, and then sees nothing there, while the WiiM app still shows the song. With the helper on, the page says what the speaker says: "Stopped · Spotify", the song, and the preset it was playing from. Spotify's own answer comes first whenever it has one. **The bar's play button presses that preset** on that WiiM through the helper (since 2026-10-10), as the key would. So an endless DJ carries on with the songs kept. It never sends a plain "resume": that plays whatever the Spotify account played last, which may be another song (measured 2026-09-29). **Its panel opens the playlist in Spotify and names whose set it is** (since 2026-10-12). It knows from the helper's reading and the house's own records, with no call to Spotify.
- **About this song** (since 2026-11-14): while Spotify plays, a button beside the speaker in the bar's menu. It opens what the DJ wrote about the song, when the song comes from a page on the Shelf: the stop it is in, the paragraph that names it (or the stop's first), and a link to the page at that stop. Below that, a link that opens the house's assistant with the question typed (Claude or ChatGPT: the one the curator runs on; a house with no curator yet, the app that last fetched its tools): "Tell me about the song … by …", title and artist only, because Spotify's album and year are often a reissue's. The question is not sent until you send it. Claude shows a caution note first for any link that types a question in; that is expected. Nothing is looked up until the button is tapped, and nothing asks Spotify.
- **The Spotify icon** to the right of the speaker in the bar's menu opens the playlist in the Spotify app, and the music carries on. There's no link to the song itself: Spotify's app takes a song link as "play this", from the start, on its album, and an endless set would be lost (measured 2026-11-02).
- {if tidal} **The Tidal icon** in the same place opens the Tidal Requests playlist in the Tidal app. It shows only while Spotify isn't playing on that speaker. With the helper on, that's only while the helper reads Tidal there (since 2026-09-28). Without it, only once Spotify has answered, so never while Spotify can't be read (since 2026-10-30).

**How often pages check:** an open page checks what's playing **every 30 seconds** while it's on screen, stops after **10 minutes** without a touch, and checks again straight away when you come back. A page with only the bar (a DJ's page, Talk) checks when it opens, and once more **4 seconds** later if Spotify didn't answer.

{if helper} **Asking Spotify less** (since 2026-09-28): with the helper on, the app keeps Spotify's last answer. It asks again only:

- {if helper} when the helper hears a WiiM change (a new song, a pause, another source);
- {if helper} when the app itself plays, pauses, skips, moves or presses a key;
- {if helper} when the song should have ended;
- {if helper} or after **30 seconds** for an Echo or the phone, **2 minutes** when nothing plays, and **5 minutes** at most.

{if helper} The Use page counts what this saved. [now.js `PLAYER_REUSE_*`; off: house.json `player.reuse: false`]
- **Which copy of the tools a chat holds** (since 2026-11-13): Claude and ChatGPT keep a copy of the house's tools from when they were added or refreshed. The tools a chat starts with or writes through carry a short stamp of the whole list, and a call sends it back, so the house knows whether that chat holds today's list. When a chat has used an older copy in the past day, the setup page says so on the Claude or ChatGPT row, with what to do, and the chat is told in its answer. If a chat holding today's copy has called since, the row says that too, so you can see a refresh worked. The house also notes each time ChatGPT, Claude or another app fetches the tools (a refresh, or a connector added), and the row says which app holds today's tools and which last fetched them before they changed. That needs nothing from the chat. For an app that holds today's tools, the row also says what its calls have said since: that they used today's copy, that a chat of its used an older one (start a new chat there), or that its calls carry no stamp, in which case it is not called stale and the house goes by its fetch. Of who called, only the kind of app and the short name it gives itself are kept. For the curator it says so on the Curator row, until the curator's next call with the current copy. Nothing else about the call changes. A chat added before the stamps sends none until its tools have been refreshed once.

## Who makes the songs {if endless}

> {if no chatgpt} The curator: Claude in the cloud, woken for each tap or ask.
> {if chatgpt} The curator: ChatGPT, woken for each tap or ask.

- {if no chatgpt} **The curator** is Claude in the cloud. Each tap or ask wakes it, and it also checks in every hour.
- {if chatgpt} **The curator** is ChatGPT: a Work chat in the house's ChatGPT account, woken by the house for each tap or ask, with an hourly check of its own (since 2026-10-19).
- **When the curator is quiet:** if it hasn't checked in for more than an hour and a quarter, the pages say when it last did. They say that instead of "a few minutes", for endless sets and for asked-for sets (since 2026-10-02).
- **Sooner when work waits** (since 2026-10-19): an ask or an endless top-up nobody has answered after 20 minutes makes the pages say so straight away, with when the curator last checked in. The usual reason is a Claude or ChatGPT plan that has hit its limit: the curator carries on when the limit resets. The pages say "the curator", since a house's curator can be Claude or ChatGPT.
- **During a Spotify block**, work waiting on Spotify doesn't count: the pages say Spotify is the reason (since 2026-10-31).

## How DJs look things up {if requests}

> {if lastfm} Roll calls of acts, MusicBrainz for an artist's albums, Last.fm for their neighbours.
> Roll calls of acts, and MusicBrainz for an artist's albums.

- **Roll calls:** lists of acts a DJ draws on, reviewed by hand, from Discogs, Wikipedia and MusicBrainz. Pub Rock has one (69 acts) (since 2026-10-12), and so do Hank (511) and Dr. Funkenstein (5,560). Every set of theirs, asked for or endless, gets a dozen acts that fit the ask as a guide, plus a few to stay out of. For a top-up, they're acts it hasn't played lately. It's a guide, not a whitelist. The other DJs work from their briefs alone until they get one. [tasks/rollcalls/]
- **Genre has one for jazz** (since 2026-10-18): 4,505 acts, given to any Genre ask that names jazz or a jazz style ("piano jazz", "bebop", "bossa nova"). Not smooth, acid or nu jazz, which it never held: those, and every other genre, work from the brief alone.
- **Sessions has one too** (since 2026-10-26): 2,642 lines by series (Peel and the BBC, MTV Unplugged, Tiny Desk, 2 Meter Sessions, Spotify Sessions, Audiotree Live, Austin City Limits, Like A Version, VH1 Storytellers), gathered from MusicBrainz and not read one by one. A slice of it crosses the series, and a decade in your words ("70's hits", "seventies") fills half of it from that decade's sessions (since 2026-11-02). Added by hand: 108 albums called Unplugged that aren't titled MTV, each one ticked by the owner (since 2026-10-31). Any other album that only says Unplugged stays out.
- **A DJ asked about an artist looks them up first** (since 2026-10-18): any DJ whose ask is about one artist ("Maggie Rogers, recent work", "Ray Charles before 1980"). On MusicBrainz it finds every album with its original year, under every band and name they recorded under (Charlie Hunter's Blue Note years are the Trio's). It also finds the live albums that matter, and for a songwriter, their songs. A mood, a genre, a label or "like Okonski" is never looked up. A songwriter's songs are looked up when the ask is about what they wrote, and added to their folder (Isaac Hayes's had only his albums).
- **One folder per artist, shared:** the house keeps what it found for 180 days (two artists with one name get one each). Every DJ shares it, so the next ask about them, from any DJ, starts straight away. A set asked of a DJ by voice or in Claude or ChatGPT reads the folder too, when the house has one (since 2026-10-24).
- **The house looks an artist up itself** (since 2026-10-24): the studio albums with their years, and the names the artist recorded under, from MusicBrainz, which ChatGPT can't reach. It takes a few seconds and works with either curator; Deep Dive's artist is always looked up. What needs judgment (the live albums that matter, a songwriter's songs) is added by the curator when it can reach MusicBrainz itself, as Claude can. If MusicBrainz is busy, the set is made from what the DJ knows, and the house tries again an hour later.
- {if guest} **Deep Dive looks up every artist it's given, and goes through every album** before any comes round again (since 2026-10-18). If the ask narrows it ("Miles, a mellow evening", "the Blue Note years"), only the records that fit.
- {if lastfm} **Last.fm widens the choices** (since 2026-10-18): a DJ may look an artist up there, for who its listeners play alongside them, and which of their songs they play most. An ask like "piano, like Okonski" gets Okonski's neighbours to choose from. They're ideas, not the set: every song still fits your words ("piano" means piano music), and the DJ adds picks of its own. Last.fm counts what its users have played since the 2000s, never the charts of the day, so it says which songs are familiar, not which were hits. Its genre labels aren't used (its "pub rock" mixes the English scene with Australian and Czech bands). If Last.fm doesn't answer, nothing waits. [lastfm.js]
- **Three dates, kept apart** (since 2026-10-18): when a recording was made, when it was first issued, and when another notable version came out. A Stax demo on the 2023 box is "Mack Rice's demo, first issued 2023; the hit was the Staples', 1971". A recording date, even "around 1970", is given only with evidence; otherwise the page says it isn't known. A DJ's era goes by when the music was made, so that demo is Soul's 1960s-70s music, never Hank's "after 1990" because of its 2023 issue. Kept pages show "first issued" beside such a track.
- **A named classical recording, found whole** (since 2026-11-12): ask in Claude or ChatGPT for a work and who plays it ("Beethoven's Fifth, Carlos Kleiber and the Vienna Philharmonic"), and the house finds that recording on Spotify: every movement, from one album, in order. It checks the composer and every name you gave, first names too (Carlos Kleiber is not his father Erich), and it never takes a "best of". If those players recorded the work more than once, it lists the recordings and asks which; it doesn't pick one. If it isn't on Spotify, it says so, and doesn't play another in its place. Where MusicBrainz knows, the answer says when and where it was recorded. A recording found once is kept for 180 days and costs nothing to find again. A very long work in a big box set (a whole Passion, an opera) may come back in part, and says so. This is the first piece of a classical DJ; there is no DJ for it yet.

## Spotify's limits

> A daily allowance. The sign-in lasts six months.

**A daily allowance.** The app runs on a Spotify developer account with a daily allowance. If Spotify refuses ("quota exceeded"), the app stops asking for as long as Spotify says (**15 minutes** if it doesn't say). Pages say "not known for about N minutes", and Play on Spotify is refused until then. The **Use** page (at the foot of the Speakers tab) shows the calls made in the last 24 hours.

{if tidal} A set asked for on Tidal goes ahead during a block: Tidal isn't behind Spotify's limit. A set asked for on Spotify waits, and is made after the block, without being asked again.

{if helper} While Spotify is blocked and the home helper is on, the bar still shows Tidal, the radio and the archive, and still pauses and plays them. It can also restart a Spotify preset that has stopped. The preset keys on the Speakers tab all work. A Spotify preset that's playing shows as "not known" until the block lifts.

**The Spotify sign-in lasts six months** (Spotify's rule). Then Spotify signs the house out, and nothing on Spotify works until someone signs in again. The **Spotify** page (at the foot of the Speakers tab) says when it ends, and has **Reconnect Spotify**: sign in on Spotify's own page, and you're back. Only the house's own Spotify account is accepted, and **only the owner can reconnect**: a phone signed in on the setup page; anyone else sees the page but not the button (since 2026-10-17). The Speakers tab warns **3 weeks** before the end, and the bar on every tab says so once Spotify has signed the house out. Claude or ChatGPT hears it too (since 2026-10-16). Before a new house's first sign-in, the bar says Spotify isn't signed in yet (since 2026-10-19). [services.js `LOGIN_WARN_DAYS`]

## Safety

> Every rewritten playlist is kept 90 days. Presets are never renamed.

- Before any playlist is rewritten, the app keeps a copy for **90 days**, so a bad write can be undone.
- The app **never renames a Spotify preset on a WiiM over the network**. Doing that unhooks the preset. Presets are saved by hand in the WiiM app.
- Passwords and keys stay in Cloudflare, never in the code or these files.
