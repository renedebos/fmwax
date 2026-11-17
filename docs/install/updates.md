# Updates

Nothing updates by itself: you choose when. Everything you chose on the setup page stays when you update.

## Which version you have

The last line of the **House rules** page (in your house's app, the **Speakers** tab, then **House rules**) says which version your house runs, by the day it was made. For example: *"the version of 5 November 2026 (code b8a5d8a)"*. Give both the day and the code when you report a problem.

## A house from the Deploy button

The setup page's **Updates** says when a newer version is out.

**The first time only:** tell your house where your copy is on GitHub (the page says where to find it), then click **Turn updates on**. GitHub opens a new file, already written: click **Commit changes**, then **Commit changes** again.

**Each update after that:**

1. On the setup page's **Updates**, click **Get the latest version**. GitHub opens.
2. Click **Run workflow**, then **Run workflow** again.
3. A minute or two later, Cloudflare has put the new version on your house, and the page says your house has the latest version.

Your copy keeps your house's name and stores.

**What an update does, exactly.** It takes the public fmwax repository as it is at one exact commit, and replaces everything in your copy with it, except your copy's own settings: its name and stores, and its `.github` folder (so an update can never change the update itself). If you changed the code in your copy yourself, an update replaces those changes. The program that does the replacing is the one already in your copy, not one that has just arrived.

**To see what changed:** on GitHub, open your copy and click the newest commit, *The latest version of fmwax*. It shows every changed line, and its note names the exact commit of the public repository it was taken from. The run's own log (Actions, the run, *The latest version*) lists the changed files too.

**To go back:** open that commit on GitHub and choose **Revert**. Cloudflare then puts the version before it on your house.

**To take one exact version** and not simply the newest: the **Run workflow** box has a field for a commit of the public repository (its 40 characters). Leave it empty for the newest.

**Updates turned on before 15 November 2026?** Turn them on again once, so your copy gets this safer way of updating: on GitHub, delete `.github/workflows/update.yml` in your copy, then use **Turn updates on** on the setup page again.

## A house installed from a terminal

Download a new ZIP the same way as when you installed ([Install from a terminal](terminal.md#1-get-the-code)), open a terminal in its `mcp` folder, and run the same command again:

```
node install/door.js
```

It finds the same house (by its name: add `--name` if you gave it one) and updates it. The old folder can go in the bin. With git: `git pull` in your clone, then the same command.

## The home helper is updated separately

Only if you use it. The helper is a separate program on a computer at home, and updating your house does not touch it. When the helper has changed since you set it up (the list below), set it up again on that computer with the new code: [Update it](home-helper.md#update-it-or-after-you-replace-a-wiim). An older helper keeps working with a newer house in the meantime.

**When the helper last changed:**

- **16 November 2026:** it reads the WiiMs every 3 seconds (it was every 10), so the app and the [TV page](tv.md) follow a new song sooner. For music that isn't Spotify it also passes on the album, the cover and where in the song it is, and it can skip and go back.

## After some updates: connect Claude or ChatGPT again

The Claude app remembers the list of your house's tools from when you added it, and doesn't fetch a new one by itself. So when an update changes what your house can do, the update's note says **re-add the connector**. Then:

1. On the setup page, open the **Claude or ChatGPT** row and copy the address.
2. At claude.ai, in a browser: Settings, Connectors. Remove your house's connector. Then click **Add custom connector**, paste the address, click **Add**, then **Connect**.
3. Re-adding resets the connector's tool permissions: set them again. Then start a new chat.

**In ChatGPT:** open Plugins, then your house's plugin, scroll to **Manage app** and click **Refresh tools**. Do the same for **fmwax curator** if ChatGPT is your curator. A chat that was already open picks the new tools up the next time it uses your house; until then it answers from the old ones.

A Claude curator needs nothing: its scheduled task reads your house's tools afresh every time it runs.
