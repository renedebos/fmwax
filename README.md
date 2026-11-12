# fmwax

**Radio-style DJs for your WiiM speaker's preset buttons, curated by Claude or ChatGPT.**

Ask for music on your phone, in Claude or ChatGPT, and later in the fmwax app too: *"Vibe, play me 20 minutes for a quiet morning."* A few minutes later a newly created playlist starts on your WiiM. The set also stays on a preset button, so a press on the WiiM remote plays it again. Some of the DJs play endlessly, adding new songs as long as you listen. Two of the DJs write program notes to read with their sets.

It runs on your own free Cloudflare account. Nothing is shared with the author: everything is on your own accounts. [What your house keeps, and who sees it](docs/install/privacy.md) says it in full.

## What you get, level by level

You install Level 1 first, in about an hour. Everything after it is added later from your house's setup page, when you want it. **You can stop at any level and it works.**

| Level | What you get | What it needs | Time |
|---|---|---|---|
| **Level 1 · Ask a DJ** | Ask any of the eleven DJs for a set, in Claude or ChatGPT. It plays on your WiiM and stays on one preset button, Requests. Your house's own app on your phone. | Spotify Premium. Free Cloudflare and GitHub accounts. Claude or ChatGPT (a free ChatGPT account worked in our test). | about an hour |
| **Level 2 · DJ presets** | A DJ on a preset button of their own, with an hour of their songs on it from the start. For new songs, ask that DJ for a set. | Nothing more. | a few minutes per added preset |
| **Level 3 · Endless** | Your DJ presets add songs by themselves for as long as you listen. A guest DJ preset for any DJ. Ask from the DJ pages in your house's app. | A paid plan: Claude Pro or ChatGPT Plus (or higher). | 30 to 45 minutes |
| **Extra · Home helper** | A small program on a computer at home. While it runs, your house sees what is saved on each WiiM preset, and can press them for you. | A computer at home (Mac, Windows or Linux). It helps whenever that computer is on; it need not stay on. | 15 minutes |
| **Extra · Talk** | Ask by voice in your house's app: a DJ, a preset, "more like this". | Your own OpenAI API key, paid by the minute (about 5 cents). Not part of ChatGPT Plus. | 10 to 15 minutes |

The extras can be added at any level.

## Install it

Read **[Start here](START-HERE.md)** first. It takes under an hour, all in your browser. Then begin at the start page, which makes your house's setup key and has the Deploy button:

**[Open the start page](https://renedebos.github.io/fmwax/)**

No GitHub account? [Install from a terminal](docs/install/terminal.md) instead.

## Help

- **Stuck while installing?** See [If something goes wrong](docs/install/troubleshooting.md), or tell us with the **Install problem** form under [Issues](https://github.com/renedebos/fmwax/issues/new/choose). You can also send a message, as [the tester note](docs/install/tester-note.md) says.
- **Had enough?** [Remove your house](docs/install/remove.md) takes it all away again, step by step.
- **A security problem?** Please report it privately, as [SECURITY.md](.github/SECURITY.md) says, never in a public issue.

## For developers

What is in this repository:

- `mcp/`: the house, a Cloudflare Worker with its pages, its connector for Claude and ChatGPT, and the install command (`mcp/install/door.js`).
- `helper/`: the optional home helper, a small program for a computer at home that reads the WiiMs.
- `docs/install/`: the install pages, the curator's notes, the secrets, and the note for testers.
- `docs/house-rules.md`: the source of the app's House rules page. Read the rules in your house's app (the **Speakers** tab, then **House rules**), where each house sees its own; this file carries marks the app fills in, and notes on the author's own house.
- `art/covers/`: the DJs' faces.
- `wrangler.jsonc`, `package.json`, `.dev.vars.example`: what the Deploy button reads.

This repository is a copy, made by a script from the author's own repository. A change made here directly is not kept: please suggest it in an issue instead.

MIT licence: [LICENSE](LICENSE).
