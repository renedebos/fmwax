# fmwax

A house of radio DJs on the presets of a WiiM device. You ask a DJ for music
in the Claude app or ChatGPT (*"Vibe, play me 20 minutes for a quiet
morning"*), the house writes the set into a Spotify playlist and starts it,
and the preset that holds the playlist plays the latest set. Endless DJs keep
playing on their own presets, and the writers publish programmes with notes.

**Installing it?** Read [`START-HERE.md`](START-HERE.md): one command, then a
setup page, in about an hour.

What is here:

- `mcp/` — the house: a Cloudflare Worker with its pages, its connector for
  Claude and ChatGPT, and the install command (`mcp/install/door.js`).
- `helper/` — the home helper, a small program for a computer at home that
  reads the WiiMs. Optional.
- `docs/install/` — the curator's notes, the secrets, and the note for
  testers.
- `docs/house-rules.md` — how the house behaves, in plain words: the app's
  House rules page.
- `art/covers/` — the DJs' faces.

This copy is made by a script from the author's own repository, so a change
made here is not kept: say what you would change instead
(`docs/install/tester-note.md`).

MIT licence: [`LICENSE`](LICENSE).
