# Install from a terminal

This is the other way to put your house on Cloudflare, instead of the Deploy button in [Start here](../../START-HERE.md). It needs no GitHub account, and your house's code stays on your computer. The result is the same house.

Use it in place of **Step 1** and **Step 2** of Start here. Everything else in Start here is the same.

## What you need

- Everything in Start here's *What it costs* and *What you need*, except GitHub.
- **Node.js 22 or newer** on your computer: a Mac, Windows, Linux, or a Chromebook with Linux turned on. Go to [nodejs.org](https://nodejs.org), download the **LTS** version's installer (on a Mac, the *macOS Installer (.pkg)*), and run it. On Windows, leave the installer's *Tools for Native Modules* box unchecked. Nothing else needs installing.

## 1. Get the code

1. In your browser, open [the fmwax page on GitHub](https://github.com/renedebos/fmwax).
2. Click the green **Code** button, then **Download ZIP**.
3. Unpack it:
   - **Mac:** it unpacks by itself, into a folder named **fmwax-main** in Downloads.
   - **Windows:** right-click the ZIP file, then click **Extract All**, then **Extract**.
   - **Chromebook:** open the ZIP in the Files app, and copy the folder inside it into *Linux files*.

## 2. Open a terminal in the `mcp` folder

- **Mac:** open **Terminal** (press ⌘ and the space bar, type *Terminal*, press Return). Type `cd` and a space, drag the **mcp** folder from the Finder window into Terminal, and press Return.
- **Windows:** open the **mcp** folder in File Explorer. (The ZIP may unpack into a folder of the same name inside another one: open both.) Click the address bar at the top, type `powershell`, and press Enter.
- **Linux or a Chromebook:** in the terminal, go into the folder, for example with `cd fmwax-main/mcp`.

## 3. Run the install command

Type this and press Return:

```
node install/door.js
```

The command:

1. Opens your browser, so you can sign in to Cloudflare (only the first time). Cloudflare then asks which of your accounts its tool, *Wrangler*, may use: check the one for your house, then click **Review permissions**, then **Allow**, and close the page when it says so. If you check more than one, the command asks you which by number.
2. Makes your house's two stores on that account.
3. Puts your house there, at `https://fmwax-house.your-name.workers.dev`.
4. Waits until your house's setup page answers, then opens it, already filled in with your setup key. It also prints the page's address, in case no browser opens.

It takes a minute or two. The first time takes longer, while it downloads Cloudflare's tool (about 400 MB). Each step says what it is doing and counts the seconds, so you can see it is working.

Then go on with **Step 3. Claim your house** in [Start here](../../START-HERE.md#step-3-claim-your-house). The setup key is already filled in: just click **Claim this house**.

## Options

- **Another name for your house:** `node install/door.js --name my-house`. The name becomes the start of your house's address.
- **A computer with no browser** (one you reach from another computer): add `--no-open`, then open the address it prints in any browser.
- **With git instead of the ZIP:** clone the repository, then do the same steps from its `mcp` folder.
- **If you already use Wrangler:** an API token in your terminal's environment wins over the browser sign-in, and nothing says so. If `echo $CLOUDFLARE_API_TOKEN` prints anything, run `unset CLOUDFLARE_API_TOKEN` first, in the same terminal. In PowerShell: `echo $env:CLOUDFLARE_API_TOKEN`, then `Remove-Item Env:CLOUDFLARE_API_TOKEN`.

## If the command stops

Run it again. It picks up what is already done.

Updating a house installed this way: see [Updates](updates.md#a-house-installed-from-a-terminal).
