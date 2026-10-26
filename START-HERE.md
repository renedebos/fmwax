# Start here

*2026-10-17, updated 2026-10-21 (ChatGPT; the code as a ZIP, so no git; Windows tried; the helper's one paste and its Remove).
The install as it is now: one command in a terminal, then a setup page in
your browser that walks you through the rest. It has been run start to
finish twice on a second Cloudflare account, and up to the claim on a Mac
and on Windows 10.
If a step reads differently on your screen, say so.*

This puts a set of radio DJs on your WiiM's presets. You ask a DJ for music
on your phone, in the Claude app or in ChatGPT ("Vibe, play me 20 minutes
for a quiet morning"). The house writes the set into a Spotify playlist and
starts it, and the preset that holds that playlist plays the latest set.
Claude and ChatGPT work the same way here: pick the one you have.

It comes in two layers. Set up the first, check it works, then decide on
the second.

- **Core:** a *Requests* preset (1 is suggested). Whatever a DJ is asked for lands there.
  You ask by text or voice in the Claude app or ChatGPT. The two writers, the
  Librarian and Gatefold, also publish programmes with notes to read, kept
  on the house's Shelf.
- **Endless:** a *house DJ* who keeps playing for as long as you listen, and
  the *guest DJ*, which plays whichever DJ you last played endless (2 and 3
  are suggested). The *curator* writes their sets by itself: a scheduled
  task in your Claude account, or a Work chat in your ChatGPT account. It
  also answers requests asked for on the DJ pages.

You choose the numbers on the setup page. Every other preset stays yours,
for radio or anything else.

## How the pieces fit

```text
   ASKING (your phone)                      PLAYING (the room)

   "Vibe, 20 minutes…"                      press preset 1
          │                                        │
          ▼                                        ▼
   ┌─────────────┐                          ┌─────────────┐
   │ your AI app │                          │ WiiM device │
   └──────┬──────┘                          └──────▲──────┘
          │ the house's connector                  │ the music
          ▼                                        │
   ┌──────────────────────┐   writes   ╔═══════════╧══════════╗
   │ your house, on your  │ ─────────▶ ║ a playlist in your    ║
   │ Cloudflare account   │            ║ Spotify account        ║
   └──────────────────────┘            ╚═══════════════════════╝
```

- **Your AI app** is the Claude app or ChatGPT, on your phone or in a
  browser, typed or by voice.
- **Cloudflare is never in the sound.** The music goes from Spotify to the
  WiiM. If the house were down, every preset would still play what was last
  put on it.
- **A preset remembers the playlist, not the songs.** You save each preset
  once. After that the house only changes what is in the playlist.
- **Nothing runs at home.** The computer is needed for the install and for
  updates, not to play music.

## What you need

- **A WiiM device** (Mini, Pro, Pro Plus, Ultra, Amp…), set up in the WiiM
  Home app, on the same Wi-Fi as your phone.
- **Spotify Premium.** Spotify lets an app start music on a speaker only
  for a paying account.
- **A Cloudflare account.** Free, at cloudflare.com, no card. Before you
  start, open *Workers & Pages* in its dashboard once, so the account gets
  its own `workers.dev` address.
- **Claude or ChatGPT**, whichever you have:
  - **Claude:** Core uses the Claude app with a custom connector. Endless
    needs a paid plan (Pro or higher), because scheduled tasks are not on
    the free plan. Whether the free plan can add a custom connector has not
    been checked yet, so a paid plan is the safe choice.
  - **ChatGPT:** Plus or higher. You ask through a plugin, in ChatGPT on
    the web or in its app, typed or by voice. For Endless the curator is a
    ChatGPT Work chat, which Plus has. Free and Go have not been checked.
- **A computer with Node.js 22 or newer**: a Mac, Windows, Linux or a
  Chromebook's Linux. At nodejs.org, download the **LTS** version's
  installer (on a Mac, *macOS Installer (.pkg)*) and run it. On Windows,
  leave the installer's *Tools for Native Modules* box unticked. Nothing
  else to install: no git, no developer tools. Tried by a person on a Mac
  (2026-10-19) and on Windows 10 (2026-10-21), and checked by machine on
  both at each change to the installer.
- **An invite to this repository**, and a free GitHub account. It is
  private for now: ask for one.

**Time:** about an hour for Core and 30 to 45 minutes more for Endless.
Most of it is saving presets.

## 1. Put the house on Cloudflare

First, accept the invite in the email from GitHub. Then:

1. **Get the code.** In your browser, sign in at github.com and open the
   repository the invite is for (the email links to it). Click the green
   **Code** button, then **Download ZIP**. A Mac unpacks it by itself into
   a folder in Downloads named after the repository, such as
   **music-control-master**. On Windows, right-click the ZIP
   file, then **Extract All** and **Extract**. On a Chromebook, open the
   ZIP in the Files app and copy the folder inside it into *Linux files*.
2. **Open a terminal in its `mcp` folder.**
   - **Mac:** open **Terminal** (press ⌘ and the space bar, type
     *Terminal*, press Return). Type `cd` and a space, drag the **mcp**
     folder from the Finder window into Terminal, and press Return.
   - **Windows:** open the **mcp** folder in File Explorer (the ZIP may
     unpack into a folder of the same name inside another: open both),
     click the address bar at the top, type `powershell`, and press Enter.
   - **Linux or a Chromebook:** in the terminal, `cd` into it, for example
     `cd music-control-master/mcp` (the folder is named after the
     repository).
3. **Type this and press Return:**

```
node install/door.js
```

(If you use git, clone the repository instead of the ZIP; the rest is the
same.)

The command:

1. opens the browser so you can sign in to Cloudflare (once). Cloudflare
   then asks which of your accounts its tool, *Wrangler*, may use: tick the
   one the house goes on, then **Review permissions**, then **Allow**, and
   close the page when it says so. If you tick more than one, the command
   asks which one by number;
2. makes the house's two stores on that account;
3. puts the house there, at `https://fmwax-house.<your-subdomain>.workers.dev`;
4. waits until the house and its setup page answer, then opens the page,
   and prints its link, with its setup key in it, in case no browser opens.

Nothing else is asked. It takes a minute or two, more the first time
while it downloads Cloudflare's own tool (about 400 MB). Each step says
what it is doing and counts the seconds, so you can see it is working.

- **Another name:** `node install/door.js --name my-house`. The name becomes
  the start of the address.
- **No browser on this computer** (a computer you reach from another one):
  add `--no-open`, then open the link it prints in any browser.
- **If you already use wrangler:** an API token in your environment wins
  over the browser sign-in, and nothing says so. If `echo
  $CLOUDFLARE_API_TOKEN` prints anything, run `unset CLOUDFLARE_API_TOKEN`
  first, in the same terminal (in PowerShell: `echo $env:CLOUDFLARE_API_TOKEN`,
  then `Remove-Item Env:CLOUDFLARE_API_TOKEN`).

## 2. Claim it

The setup page opens with the house's setup key already filled in. Tap
**Claim this house**. From then on, only a browser you sign in can change
the house's settings.

You are shown a **recovery code once**. Save it in your password manager or
notes. It signs you in on your phone or any other browser.

## 3. Follow the checklist

The rest happens on the setup page, at `<your address>/setup`. Each step
ticks itself when the house sees it done, without a reload. Where a step
waits on something (the curator's first answer, an endless DJ's first set),
its page shows a clock until it arrives. You can leave and come back, and
open a step again later to change it. In order:

**Core**
- **Spotify.** Make the house's Spotify app in Spotify's developer
  dashboard. The page gives you the exact address to paste, and you paste
  back the app's Client ID. Then sign in to Spotify.
- **Speakers.** The house finds your speakers through Spotify. You tick
  which ones are WiiM devices, then pick the default. A WiiM can show
  Spotify a code instead of its name: tap *Play on it* to hear which one it
  is, then name it.
- **Time zone.** Filled in from your phone's clock.
- **Claude or ChatGPT.** Its page has the house's address and the steps
  for both:
  - **With Claude:** at claude.ai, in a browser (the Claude app cannot add
    a connector itself): Settings, Connectors, Add custom connector. Paste
    the address the page gives you, tap Add, then Connect. Then ask
    something in a new chat in the Claude app.
  - **With ChatGPT:** at chatgpt.com, in a browser: Plugins, Add, Add custom
    MCP server. Name it **fmwax** (any name works), and paste the same
    address in its URL box. Set **Authentication** to **None** (it starts
    on OAuth, which fails: the key is already in the address), tick *I
    understand*, then Create. Then ask something in a new chat. The plugin
    is in ChatGPT's phone app too, with nothing more to set up.
- **On your phone.** Open the setup page's address on your phone, sign in
  with the recovery code, then open the house from there and add it to your
  home screen, so it opens like an app.
- **Requests preset.** You choose its number and the house makes the
  playlist. You ask a DJ for a set in the Claude app or ChatGPT, then save the playlist
  on that preset of each WiiM. A good first ask is a programme from the
  Librarian ("Librarian, an introduction to Stax Records, and put it on my
  Requests preset"): it fills the playlist and puts your first page of notes
  on the Shelf. **It takes a few minutes**, because the Librarian looks
  things up and writes before the songs are ready, so keep the chat open. In
  a hurry, ask Vibe for 20 minutes instead, which is much quicker.

**Endless** (when you want it)
- **Curator.** Claude or ChatGPT: the curator page has the steps for both,
  with the text to paste. **One curator at a time:** the house rings only
  the one you chose.
  - **Claude:** a scheduled task, made at claude.ai/code with its own
    connector. Then you give the house the task's address and token.
  - **ChatGPT:** tap *Set up ChatGPT as the curator*. At chatgpt.com you add
    a second plugin, **fmwax curator**, with the curator's address the page
    gives (Authentication None again). Then start a new chat (its box says
    "Work with ChatGPT") with only that plugin on. Paste the page's first
    note, which makes it listen for the house's work, then the second, its
    hourly check. Back on the page, tap *Make ChatGPT this house's
    curator*, then *Send it a test*. Keep your everyday **fmwax** plugin out
    of that chat: with it there, a set asked in the chat skips the DJ
    pages' requests.
- **DJ presets.** Choose the house DJ and the two numbers. The guest DJ
  comes with it. Then save both on each WiiM.

**Home helper** (optional, any time later). A small program on a computer
at home, on the same Wi-Fi as the WiiMs and often on: a Mac, a Windows PC,
a Linux computer or Raspberry Pi, or a Chromebook with Linux turned on. It
adds what the house can't see from the internet: the preset names on each
WiiM's buttons 1 to 12, the radio and other music on the bar, any preset
pressed from the app, and pause and play for anything. It starts when you
sign in to that computer and works while it is awake; a Raspberry Pi or
other Linux computer can run it from when it starts.

The checklist's **Set up the home helper** has the steps: on that computer,
Node.js and the house's code (the same ZIP), then one command, copied from
that page with **Copy the command** and pasted in a terminal in the code's
`mcp` folder (in Windows' PowerShell, paste with a **right-click**):

```
node install/helper.js --house <your house's address> --pair <a code>
```

The code gets the helper its key from the house, so nothing else is pasted;
it works for an hour, then the page gives a new one. The command finds your
WiiMs by itself (a Chromebook can take two minutes), asks which is which if
their names differ from the ones on the setup page, and starts itself.
**On a Mac**, a box then asks *Allow "node" to find devices on local
networks?*: click **Allow**. It asks once; without it the helper can't
reach the WiiMs.

To take it away again: **Remove the home helper** on the same setup page,
while the helper is connected. Or on its computer: on Windows, Settings,
Apps, **fmwax home helper**, Uninstall; on a Mac or Linux, in a terminal,
`node ~/.fmwax-helper/remove.mjs`. No download is needed for any of them.

Tried by a person on a Mac (macOS Sequoia, 2026-10-19: it kept running with
the download binned, after signing out and in, and after sleep), on Windows
10 (2026-10-21: after signing out and in too) and on a Chromebook.

Without the helper, the house cannot see what a WiiM has saved, so the
preset steps show a **?**: those are yours to check, by pressing the
preset. **Talk** is an optional extra not yet part of this install.

## Saving a preset

This is the one way that works:

1. In the **Spotify app**, open the playlist and play it **on the WiiM
   device**. The device picker should show the WiiM's name, not your phone.
2. In the **WiiM Home app**, choose that device, tap the song bar at the
   bottom, then **…**, **Preset**, and the number.

Start the playlist from the Spotify app, not from Claude or the house's
pages. A playlist started another way can leave WiiM Home's song bar blank,
and a blank one cannot be saved. Do it once on each WiiM. You never save
that preset again.

## Using it

- **Ask for anything.** Three DJs take any ask: **Genre** for a style ("Genre,
  an hour of ska"), **Deep Dive** for an artist ("Deep Dive, forty minutes of
  early Prince") and **the Librarian** for a subject ("Librarian, an
  introduction to Stax"). The Librarian also writes notes to read with the
  set and keeps them on the house's Shelf. With Endless set up, say
  "endless" ("ska, endless", "Michael Jackson, endless") and Genre or Deep
  Dive keeps going on the guest DJ preset.
- **Name the DJ.** "Hank, forty minutes of 45s." The other DJs each have
  their own taste. Each DJ has a page in the house's app; DJs tab.
- **Start a new chat** when something seems off. An old chat may not have
  the house's tools.
- **One music connector at a time.** If Claude's own Spotify connector, or
  ChatGPT's Spotify app, is on, turn it off in chats with the house. If two
  can both make a playlist, the assistant may pick the wrong one, and the
  set will not be on your preset.
- **Spotify ends every login after six months.** The house warns you three
  weeks before, and on Speakers, Spotify you tap *Reconnect Spotify*.

## Updates

Download a new ZIP the same way, open a terminal in its `mcp` folder, and
run the same command again:

```
node install/door.js
```

It finds the same house (by its name, so add `--name` if you gave one) and
updates its code. Everything you chose on the setup page stays. The old
folder can go in the bin. (With git: `git pull` in your clone, then the
same command.)

**Sometimes the Claude app needs the connector added again** (ChatGPT: see
below). The Claude
app keeps the list of the house's tools it got when you added the
connector, and does not fetch a new one by itself. So when an update
changes what the house can do, the message telling you about the update
says **re-add the connector**. Then:

1. On the setup page, open the **Claude or ChatGPT** row and copy the address.
2. At claude.ai, in a browser: Settings, Connectors. Remove the house's
   connector, then Add custom connector, paste the address, tap Add, then
   Connect.
3. Re-adding resets the connector's tool permissions: set them again.
   Then start a new chat.

**In ChatGPT,** open Plugins, then the house's plugin, and rescan it, so
ChatGPT reads the house's tools again. Do the same for **fmwax curator** if
ChatGPT is your curator.

A Claude curator needs nothing: a scheduled task reads the house's tools
afresh every time it runs.

## Backup

On the setup page, **Download a backup**. It is a small file with the
house's settings and keys: keep it like a password. **Restore from a
backup** puts it back, on this house or on a new one.

## If something goes wrong

- **The command stopped:** run it again. It picks up what is already there.
- **The house misbehaves:** setup page, **Check the house**.
- **"Waiting on the curator… its plan may have hit its limit":** an ask or
  a top-up has waited over 20 minutes. Usually the Claude or ChatGPT plan
  ran out for now; the curator carries on when the limit resets. The setup
  page's Curator row says when it last checked in.
- **Lost the recovery code, still signed in somewhere:** on the checklist,
  **Make a new recovery code**.
- **Lost the code and every signed-in browser:** your Cloudflare account is
  the way back. Run `node install/door.js --new-key` (with `--name` if you
  gave one). It makes a new setup key and opens the page with **Claim it
  again with a new setup key** filled in: tap Claim. The old sign-ins and
  the old code stop working.
