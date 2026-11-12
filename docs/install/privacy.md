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
- **What is asked of the DJs** on the DJ pages or by voice, in the asker's own words, and the sets written for it. An ask is kept for up to 90 days.
- **The pages on the Shelf** (the Librarian's and Gatefold's notes), until you take them off.
- **What it looked up about an artist,** for 180 days, so the next ask about them is quicker.
- **Talk:** how many minutes were used each day. Your house keeps no sound and no transcript of a conversation. But a set you ask a DJ for by voice is an ask like any other (above), and the log (below) has a line for each thing Talk did, with the words that went with it.
- **A short log of what it did:** a line per search, set or Talk action, and the address of each request it got. Cloudflare keeps it in your account for three days. Those addresses carry your house's keys, so never pass that log on as it is.

## Who else sees something

Your house only works by talking to other services. Each sees its own part:

- **Spotify** sees the playlists and what plays, as with anything on your account. It also serves the album covers on your house's pages.
- **Claude or ChatGPT** sees what you ask, and the songs and DJ notes your house hands back. That is covered by your account and privacy settings with Anthropic or OpenAI, not by fmwax. The same goes for the curator.
- **OpenAI** hears your voice during a Talk conversation, under your own OpenAI API account. Only if you set up Talk.
- **MusicBrainz and Wikipedia** (and Last.fm, if you add its key) are asked about artists by name. They see the artist's name, not who is asking.
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
