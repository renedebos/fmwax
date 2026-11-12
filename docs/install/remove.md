# Remove your house

Nothing here costs money while it sits unused, so you can also just stop using it. To take it away completely, go down this list. Skip what you never set up.

Your music is safe: removing your house never touches your Spotify account's own playlists, your library or the WiiM itself.

## 1. The home helper

Only if you installed it. Remove it first, while your house still answers: see [Remove it](home-helper.md#remove-it).

## 2. Claude or ChatGPT

- **Claude:** at claude.ai in a browser, Settings, Connectors. Remove your house's connector. If you set up the curator, remove **fmwax curator** too, and delete the curator's scheduled task at claude.ai/code.
- **ChatGPT:** open Plugins and remove your house's plugin. If ChatGPT was your curator, remove **fmwax curator** too, delete its Work chat, and delete its hourly task under **Scheduled**.

## 3. Talk

Only if you set up Talk. At platform.openai.com, under API keys, delete the key you made for your house. Nothing is billed once the key is gone.

## 4. Spotify

- **The house's sign-in:** at spotify.com/account/apps, find the app you named for your house and click **Remove access**.
- **The app entry:** at developer.spotify.com/dashboard, open that app, then Settings, and delete it.
- **The playlists your house made** (Requests, one for each DJ preset, Guest DJ): they are ordinary playlists in your Spotify account. Keep them, or delete them in the Spotify app like any other.

## 5. The presets on your WiiM

A preset you saved keeps pointing at its playlist. It still plays what is on that playlist; nobody adds new songs. Save something else on the preset in the WiiM Home app whenever you like.

## 6. Cloudflare

This is the house itself.

1. At dash.cloudflare.com, open **Workers & Pages** and click your house (named `fmwax-house` unless you chose another name).
2. Open its **Settings**, scroll to the bottom, and delete it. Your house's address stops working at once.
3. Under **Storage & Databases**, open **KV** and delete your house's two stores (`fmwax-house-tokens` and `fmwax-house-programs`, unless you named them differently). They hold your house's settings, its Spotify sign-in and its pages.

## 7. GitHub

Only for a house from the Deploy button. The button made a private copy of the code in your GitHub account. Open that repository on github.com, then Settings, scroll to the bottom, and click **Delete this repository**.

## 8. What you saved

Delete your house's setup key and recovery code from your passwords, and any backup file you downloaded. A backup holds your house's keys. A house installed from a terminal also keeps its key on that computer, in the folder `.config/fmwax-house` in your home folder: delete that folder too.

## Coming back later

Install it again from [Start here](../../START-HERE.md). With a backup file from before, **Restore from a backup** on the new house's setup page brings your settings back.
