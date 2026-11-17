# What your house keeps, and who sees it

In short: your house runs on your own accounts. The author of fmwax has no way into it, and it never reports anything to the author.

## Where it lives

- **Your Cloudflare account** holds the house itself and everything it remembers.
- **Your Spotify account** holds the playlists.
- **Your Claude or ChatGPT account** holds your chats with the DJs.

Nobody else has a copy. There is no fmwax server and no fmwax account.

## What your house remembers

All of it sits in your Cloudflare account:

- **Your Spotify sign-in,** so it can write playlists and start music.
- **Your settings and keys:** speakers, presets, DJs, time zone.
- **The songs played in the last 7 days,** and each endless DJ's last 150 songs, so DJs don't repeat themselves.
- **A copy of every playlist it rewrites,** for 90 days, so a set can be put back.
- **What is asked of the DJs** on the DJ pages or by voice, in the asker's own words, and the sets written for it. An ask is kept up to 30 days while it waits, and 90 days more once it is answered or turned down.
- **The pages on the Shelf** (the Librarian's and Gatefold's notes), until you take them off.
- **What it looked up about an artist,** for 180 days, so the next ask about them is quicker.
- **When Claude or ChatGPT last called,** and which copy of the tools it held or last fetched, with the short name the app gives itself (such as "openai-mcp"). No address of a caller, and nothing of what was asked beyond the asks above.
- **Talk:** how many minutes were used each day. Your house keeps no sound and no transcript of a conversation. But a set you ask a DJ for by voice is an ask like any other (above).
- **No request log.** A new house keeps no log at Cloudflare: its settings switch Cloudflare's log (Workers Logs) off, in so many words, each time it is deployed. Cloudflare can keep one (three days) if you turn it on for your house yourself. It would hold the address of every request, and those addresses carry your house's keys: never pass such a log on as it is.
  - **A house made before 15 November 2026:** its settings said nothing about the log, and Cloudflare turns the log on for a new Worker that says nothing. Check once: in Cloudflare, open your house (Workers & Pages, then its name), **Settings**, **Observability**. If Workers Logs is on, switch it off, or update your house: the next version switches it off itself. If you ever sent anyone a copy of those logs, treat your house's links as seen: on the setup page, make new ones for Claude or ChatGPT, the curator and the app.

## Who else sees something

Your house only works by talking to other services. Each sees its own part:

- **Spotify** sees the playlists and what plays, as with anything on your account. It also serves the album covers on your house's pages.
- **Claude or ChatGPT** sees what you ask, and the songs and DJ notes your house hands back. That is covered by your account and privacy settings with Anthropic or OpenAI, not by fmwax. The same goes for the curator.
- **OpenAI** hears your voice during a Talk conversation, under your own OpenAI API account. Only if you set up Talk.
- **MusicBrainz and Wikipedia** (and Last.fm and Genius, if you add their keys) are asked about artists and songs by name: an artist a DJ looks up, and the song playing while the [TV page](tv.md) is open. They see the names, not who is asking.
- **On a TV,** TV Bro's voice search uses the TV's own speech recognition (Google's, on a Google TV), as any voice search on that TV does. Your house gets the words it heard. Only if you set up voice on the TV.
- **Google** serves the fonts of your house's pages, so it sees that a browser opened a page. It doesn't see what is on it.
- **GitHub** is asked, now and then, whether a newer version of fmwax is out. A house from the Deploy button also has a copy of the code in your GitHub account (private, if you ticked that box on the form). It holds the code and no keys.
- **The home helper,** if you install it, runs on your own computer. It talks to your WiiMs on your home network and to your house, and to nothing else. It tells your house what each WiiM is playing and what is saved on its presets.

## Links are keys

Your house has no usernames or passwords. Its addresses carry long keys instead, so whoever has a link can use it:

- **The house's app** (the link you open on your phone): anyone with it can see what's playing, start and stop music, and ask the DJs. Share it with your household only.
- **The address you gave Claude or ChatGPT:** it can do everything the DJs can. Never post it, and leave it out of screenshots.
- **The setup key and the recovery code:** they open the setup page. Keep them in your passwords.
- **A page kept on the Shelf** has a link of its own that needs no key, so you can send it to a friend. It is listed nowhere, but anyone who has that link can read the page.
- **A backup file** holds all of the keys above. Keep it as safe as a password.

If a link gets out, open the setup page, then **Keys and signed-in browsers**, and make a new key for it. The old link stops working at once.

## Taking it all away

[Remove your house](remove.md) lists every place something sits, and how to delete it.
