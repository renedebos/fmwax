# fmwax

**Radio-style DJs for your WiiM speaker's preset buttons, curated by Claude or ChatGPT.**

Ask for music on your phone, in the Claude app or in ChatGPT: *"Vibe, play me 20 minutes for a quiet morning."* A few minutes later it plays on your WiiM. The set also stays on a preset button, so a press on the remote plays it again. Some DJs play endlessly, adding songs as long as you listen. Others write notes to read with their sets.

It runs on your own free Cloudflare account. You need Spotify Premium and a paid Claude or ChatGPT plan.

## Install it

Read **[Start here](START-HERE.md)** first. It takes under an hour, all in your browser. Then begin at the start page, which makes your house's setup key and has the Deploy button:

**[Open the start page](https://renedebos.github.io/fmwax/)**

No GitHub account? [Install from a terminal](docs/install/terminal.md) instead.

## Help

- **Stuck while installing?** See [If something goes wrong](docs/install/troubleshooting.md), or tell us with the **Install problem** form under [Issues](https://github.com/renedebos/fmwax/issues/new/choose). You can also send a message, as [the tester note](docs/install/tester-note.md) says.
- **A security problem?** Please report it privately, as [SECURITY.md](.github/SECURITY.md) says, never in a public issue.

## For developers

What is in this repository:

- `mcp/`: the house, a Cloudflare Worker with its pages, its connector for Claude and ChatGPT, and the install command (`mcp/install/door.js`).
- `helper/`: the optional home helper, a small program for a computer at home that reads the WiiMs.
- `docs/install/`: the install pages, the curator's notes, the secrets, and the note for testers.
- `docs/house-rules.md`: how the house behaves, in plain words (the app's House rules page).
- `art/covers/`: the DJs' faces.
- `wrangler.jsonc`, `package.json`, `.dev.vars.example`: what the Deploy button reads.

This repository is a copy, made by a script from the author's own repository. A change made here directly is not kept: please suggest it in an issue instead.

MIT licence: [LICENSE](LICENSE).
