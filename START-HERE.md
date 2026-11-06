# Start here

This guide sets up **fmwax**: a set of radio DJs that play on your WiiM speaker's preset buttons.

You ask a DJ for music on your phone, typed or spoken, in the Claude app or in ChatGPT. For example: *"Vibe, play me 20 minutes for a quiet morning."* A few minutes later the set is playing on your WiiM. It also stays on a preset button, so a press on the WiiM's remote plays your latest set again.

Claude and ChatGPT work the same way here. Use the one you already have.

## What it costs

| | |
|---|---|
| **Spotify Premium** | Paid. Spotify only lets an app start music on a speaker for a paying account. |
| **Claude or ChatGPT** | Paid: Claude Pro (or higher), or ChatGPT Plus (or higher). The free plans have not been tried with fmwax. |
| **Cloudflare** | Free, no card. Your fmwax runs on your own Cloudflare account. |
| **GitHub** | Free. Your own copy of fmwax is kept there. |

Nothing else is paid. Nothing is shared with the author: everything runs on your own accounts.

## What you need

- **A WiiM speaker** (Mini, Pro, Pro Plus, Ultra, Amp…), already set up in the WiiM Home app, on the same Wi-Fi as your phone.
- **A computer with a web browser**, a laptop or a desktop. Some steps only work in a browser on a computer.
- **About an hour.** Most of that time is saving presets on the WiiM.

## Before you start: two free accounts

**1. A Cloudflare account.** Sign up at [cloudflare.com](https://www.cloudflare.com). You don't need a card.

- Click the link in Cloudflare's "verify your email" message.
- Then open [Cloudflare's Workers page](https://dash.cloudflare.com/?to=/:account/workers-and-pages) once. This gives your account its own web address. If it asks you to choose a name for that address (a *subdomain*), accept the one it suggests. If it offers to create an application, skip that.

**2. A GitHub account.** Sign up at [github.com/signup](https://github.com/signup).

- **If you already have a GitHub account that is connected to another Cloudflare account**, make a new GitHub account for fmwax. One GitHub account can only be connected to one Cloudflare account.
- If GitHub's sign-up page says **Too many requests**, that's GitHub's own limit, not something you did. Wait 15 minutes, or sign up on your phone with its Wi-Fi turned off.

**No GitHub account, and you'd rather not make one?** There is another way to install, from your computer's terminal: [Install from a terminal](docs/install/terminal.md). The result is the same.

## How it fits together

```text
   ASKING (your phone)                      PLAYING (the room)

   "Vibe, 20 minutes…"                      press preset 1
          │                                        │
          ▼                                        ▼
   ┌─────────────┐                          ┌─────────────┐
   │ Claude app  │                          │ WiiM speaker│
   │ or ChatGPT  │                          └──────▲──────┘
   └──────┬──────┘                                 │ the music
          ▼                                        │
   ┌──────────────────────┐   writes   ╔═══════════╧══════════╗
   │ your fmwax, on your  │ ─────────▶ ║ a playlist in your    ║
   │ Cloudflare account   │            ║ Spotify account        ║
   └──────────────────────┘            ╚═══════════════════════╝
```

- **The music comes from Spotify, straight to the WiiM.** If fmwax were ever down, every preset would still play what was last put on it.
- **A preset remembers a playlist, not the songs in it.** You save each preset once. After that, fmwax only changes the songs in the playlist.
- **Nothing runs at home.** You need a computer to set things up, not to play music.

In this guide, your own fmwax is called **your house**. It has a web address of its own, with pages you can open on your phone.

## Step 1. Make up a password

Make up a password of **24 characters or more**. Letters and numbers are enough.

**Write it in a note** (on your computer or phone) before you go on. This is your house's *setup key*. You paste it twice: once into Cloudflare's form, and once to claim your house.

Paste it each time, don't type it. Cloudflare's form hides what you type, so a wrong character goes unnoticed and locks you out.

## Step 2. Press the Deploy button

If you are signed in to other Cloudflare or GitHub accounts in this browser, open a private (incognito) window first, so fmwax can't land on the wrong account.

Then press this button:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/renedebos/fmwax)

1. **Sign in to Cloudflare.** If it asks which account, pick the one for fmwax. A form called *Set up your application* opens.
2. **Connect GitHub.** Under **Git account**, click **New GitHub connection**. GitHub opens. Sign in, choose **All repositories**, then click **Install & Authorize**. (You can narrow this later to your fmwax copy only, in GitHub's Settings, Applications.)
   - If GitHub shows a settings page with a grey **Save** button instead of **Install**, that GitHub account is already connected to another Cloudflare account. Make a new GitHub account (see *Before you start*).
3. **Cloudflare now shows a page called "Select a repository".** This is a detour. **Don't pick anything on this page**, not even *Clone a public repository*. Instead, press the Deploy button above again (or paste this into the address bar: `https://deploy.workers.cloudflare.com/?url=https://github.com/renedebos/fmwax`). The fmwax form opens again, now with your GitHub account filled in.
4. **Change three things on the form, and leave everything else as it is.** The form scrolls inside its own box: scroll down within it to see every part.

   | On the form | What to do |
   |---|---|
   | **Create private Git repository** | Check this box. Your copy doesn't need to be public. |
   | The two **Select KV namespace** boxes | In each, choose **+ Create new**, even if it already shows a name. Then, in the **Name your KV namespace** box that appears below, type **`fmwax-house-tokens`** in the first and **`fmwax-house-programs`** in the second. |
   | **SETUP_KEY** | Paste the password from your note. |

   What the three look like when they're done:

   ![The form's top: Create private Git repository, checked](docs/install/images/deploy-form-1-private-repository.png)

   ![The two Select KV namespace boxes, each on + Create new, named fmwax-house-tokens and fmwax-house-programs](docs/install/images/deploy-form-2-stores.png)

   ![SETUP_KEY, with the password pasted in](docs/install/images/deploy-form-3-setup-key.png)

   Why the two boxes: they are the two stores your house keeps its data in. Cloudflare suggests the same name for both, and two stores can't share a name, so the deploy would fail. If your Cloudflare account already has stores, Cloudflare may fill in their names: never keep those, because they belong to something else and the data would mix.

   Leave the rest alone: the project name (`fmwax-house`, which becomes the start of your house's address), **SOURCE_REPO** and the filled-in boxes after it, the two commands, **Enable Preview builds** (off), **Protect with Cloudflare Access** (off: it would block Claude and ChatGPT), and **Advanced settings** (closed).

   Then click **Deploy**, at the bottom right.
5. **Wait about a minute.** The steps turn green one by one. The log underneath ends with **Success! Build completed**. A few lines above that is your house's address. It looks like `https://fmwax-house.your-name.workers.dev`.
6. **Copy that address** into a new tab, add **`/setup`** to the end, and press Enter.

If the build fails, see [If something goes wrong](docs/install/troubleshooting.md).

## Step 3. Claim your house

Your house's setup page opens and asks for the setup key.

1. Paste the password from your note, and click **Claim this house**. From now on, only a browser you have signed in can change your house's settings.
2. You are shown a **recovery code**, once. Click **Save it in this phone's passwords**: your browser offers to keep it, like any password. Or copy it into your note. You need it to sign in on your phone or another browser.

This browser stays signed in for a year.

## Step 4. Follow the setup page

The setup page is a checklist. Each step ticks itself when your house sees it done. You can stop and come back later.

A step marked **?** is one your house can't check for itself, like a preset saved on the WiiM. Check it yourself, by pressing the preset. (The optional [home helper](docs/install/home-helper.md) lets your house see these too.)

Do the steps under **Core** in order:

1. **Spotify.** Your house needs its own free "app" entry in Spotify's developer website, so it can use your Spotify account. The page tells you exactly what to click and what to paste. At the end, you sign in to Spotify.
2. **Speakers.** Your house finds your speakers through Spotify. Check which ones are WiiM speakers, then pick the one music plays on by default. If a WiiM shows up as a code instead of its name, click **Play on it** to hear which one it is, then name it.
3. **Time zone.** Filled in from your device's clock.
4. **Claude or ChatGPT.** This step adds your house to Claude or ChatGPT, so you can ask the DJs. Do it in a web browser on your computer (the phone apps can't add it), at [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com). The page shows each click. In ChatGPT, set **Authentication** to **None**: your house's address already carries its key. Afterwards it works in the Claude or ChatGPT app on your phone too.
5. **On your phone.** Open your house's setup address on your phone, and sign in with the recovery code. Then open your house from there and add it to your home screen, so it opens like an app.
6. **Requests preset.** Choose a preset number for your requests (1 is suggested). Your house makes a playlist for it. Then ask a DJ for a set (see *Your first set*, below), and save that playlist on the preset of each WiiM (see Step 5).

## Step 5. Save a preset on your WiiM

There is one way that works:

1. In the **Spotify app**, open the playlist and play it **on the WiiM**. The device picker should show the WiiM's name, not your phone.
2. In the **WiiM Home app**, choose that WiiM, tap the song bar at the bottom, then **…**, then **Preset**, then the number.

![In WiiM Home: 1. tap the song bar at the bottom, 2. tap …, 3. tap Preset, 4. tap the number](docs/install/images/wiim-save-preset.jpg)

Start the playlist from the Spotify app, not from Claude, ChatGPT or your house's pages. Started another way, the WiiM Home song bar can stay blank, and a blank song bar can't be saved.

Do this once on each WiiM. You never need to save that preset again: from then on, your house changes what is in the playlist.

## Your first set

Ask in the Claude app or ChatGPT, typed or spoken. Two good first asks:

- **Quick:** *"Vibe, 20 minutes for a quiet morning, on my Requests preset."*
- **With notes to read:** *"Librarian, an introduction to Stax Records, and put it on my Requests preset."* This takes a few minutes, because the Librarian looks things up and writes notes before the songs are ready. Keep the chat open. The notes appear on your house's **Shelf**.

## Using it

- **Ask for anything.** Three DJs take any ask: **Genre** for a style (*"Genre, an hour of ska"*), **Deep Dive** for an artist (*"Deep Dive, forty minutes of early Prince"*) and **the Librarian** for a subject (*"Librarian, an introduction to Stax"*).
- **Or name a DJ.** *"Hank, forty minutes of 45s."* Each DJ has their own taste, and their own page in your house's app (the **DJs** tab).
- **Something seems off?** Start a new chat. An old chat may not have your house's tools.
- **Use one music connector at a time.** If Claude's own Spotify connector, or ChatGPT's Spotify app, is turned on, turn it off in chats with your house. Otherwise the assistant may make the playlist in the wrong place, and the set won't be on your preset.
- **Spotify signs you out every six months.** Your house warns you three weeks before. Then, in your house's app, go to **Speakers**, then **Spotify**, and tap **Reconnect Spotify**.
- **The house's rules,** like how long before a song can play again, are on the **House rules** page (the **Speakers** tab).

Every preset you didn't give to fmwax stays yours, for radio or anything else.

## Keep a backup

On the setup page, click **Download a backup**. It's a small file with your house's settings and keys: keep it as safe as a password. **Restore from a backup** puts it back, on this house or a new one.

## What next

- **[Endless DJs](docs/install/endless.md):** DJs that keep playing for as long as you listen, each on a preset of their own. About 30 to 45 minutes to set up, once the steps above work.
- **[The home helper](docs/install/home-helper.md)** (optional): a small program on a computer at home, so your house can see and press the WiiM's presets.
- **[Updates](docs/install/updates.md):** how to get a newer version, and which version you have.
- **[If something goes wrong](docs/install/troubleshooting.md).**

Stuck, or a step looks different on your screen? Please say so, with [the Install problem form](https://github.com/renedebos/fmwax/issues/new/choose) on GitHub.
