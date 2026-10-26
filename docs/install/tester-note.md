# A note for testers

*To send with the invite.*

---

Thanks for trying this. It puts a set of radio DJs on your WiiM's presets:
you ask a DJ for music in the Claude app or ChatGPT ("Hank, forty minutes
of 45s"), the house writes the set into a Spotify playlist, and a preset on
your WiiM plays it. With the optional *Endless* part, a house DJ keeps playing for as
long as you listen.

**What you need**
- A WiiM device, set up in the WiiM Home app.
- Spotify Premium.
- Claude or ChatGPT, whichever you have:
  - **Claude:** a paid plan (Pro or higher) for the Endless part; it is also
    the safe choice for the rest. If you are on the free plan, please try
    anyway and tell me whether the connector step works: nobody has checked
    yet.
  - **ChatGPT:** Plus or higher. You ask through a plugin, on the web or in
    the ChatGPT app, and a ChatGPT Work chat runs the Endless part. If you
    are on Free or Go, tell me how far you get: nobody has checked yet.
- A free Cloudflare account (no card).
- A computer with Node.js 22 or newer (nodejs.org, the LTS installer): a
  Mac, Windows, Linux, or a Chromebook's Linux. Nothing else to install:
  you download the code as a ZIP. A Mac and a Windows 10 laptop have been
  tried; tell me how it goes on yours.
- A GitHub account, for the invite.
- About an hour, plus 30 to 45 minutes for Endless. Most of it is saving
  presets on the WiiM.

**How:** accept the GitHub invite, then follow `START-HERE.md` in the
repository from the top. It is the whole install: one command in a
terminal, then a checklist on your house's setup page.

**Where to start once it plays:** three DJs take any ask. **Genre** for a
style ("Genre, an hour of ska"), **Deep Dive** for an artist ("Deep Dive,
forty minutes of early Prince"), and **the Librarian** for a subject
("Librarian, an introduction to Stax"), who also writes notes to read and
keeps them on the house's Shelf. Then try the others: each has their own
taste.

**Good to know**
- Everything runs on *your* accounts: your Cloudflare, your own Spotify
  developer app, your Claude or ChatGPT. I cannot see your house or your
  music.
- The repository also holds my own house (its settings and my notes).
  Ignore them: the install makes yours from scratch and touches nothing of
  mine. Please don't push changes to the repository.
- Optional, any time later: the home helper, a small program on a computer
  at home that lets the house see and press every preset (the setup page
  has its steps, and a Remove button to take it away again).
- Not in this version: Tidal, and the house's Talk tab without an OpenAI
  key. The Claude app's and ChatGPT's own voice modes work.
- Updates: I'll send a message. You download the new ZIP and run the
  install command again (`START-HERE.md`, *Updates*). When the message says **re-add the
  connector**, do that too: the Claude app keeps the old list of the
  house's tools until you do. On ChatGPT, rescan the house's plugin
  instead.

**What to tell me**, in a direct message to **Rene** on the WiiM forum
(forum.wiimhome.com):
- Where you stalled or were unsure, and which step it was.
- A screenshot of what you saw. Crop out your house's address with its
  long key, and your recovery code: either one lets someone run your house.
- What you expected to happen, and what happened instead.
- Your phone and computer (for example: iPhone, Mac).

Small things count: a word that confused you is as useful as a step that
failed.

Rene
