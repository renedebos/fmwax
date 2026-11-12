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

## A house installed from a terminal

Download a new ZIP the same way as when you installed ([Install from a terminal](terminal.md#1-get-the-code)), open a terminal in its `mcp` folder, and run the same command again:

```
node install/door.js
```

It finds the same house (by its name: add `--name` if you gave it one) and updates it. The old folder can go in the bin. With git: `git pull` in your clone, then the same command.

## After some updates: connect Claude or ChatGPT again

The Claude app remembers the list of your house's tools from when you added it, and doesn't fetch a new one by itself. So when an update changes what your house can do, the update's note says **re-add the connector**. Then:

1. On the setup page, open the **Claude or ChatGPT** row and copy the address.
2. At claude.ai, in a browser: Settings, Connectors. Remove your house's connector. Then click **Add custom connector**, paste the address, click **Add**, then **Connect**.
3. Re-adding resets the connector's tool permissions: set them again. Then start a new chat.

**In ChatGPT:** open Plugins, then your house's plugin, and rescan it. Do the same for **fmwax curator** if ChatGPT is your curator.

A Claude curator needs nothing: its scheduled task reads your house's tools afresh every time it runs.
