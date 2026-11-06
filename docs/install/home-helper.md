# The home helper

The home helper is optional. You can add it any time, or never.

It is a small program on a computer at home. It lets your house see and do what it can't from the internet:

- the names of the presets saved on each WiiM's buttons 1 to 12;
- radio and other music on the bar at the bottom of your house's app, not only Spotify;
- pressing any preset from the app;
- pause and play for anything.

Without it, your house can't see what a WiiM has saved, so the setup page's preset steps show a **?**. Those are yours to check, by pressing the preset.

## What you need

A computer at home, on the same Wi-Fi as your WiiMs, that is often switched on: a Mac, a Windows PC, a Linux computer or Raspberry Pi, or a Chromebook with Linux turned on. It needs **Node.js**, installed as in [Install from a terminal](terminal.md#what-you-need).

The helper starts when you sign in to that computer, and works while the computer is awake. A Raspberry Pi or other Linux computer can run it from the moment it starts.

## Set it up

On the setup page, open **Set up the home helper**. It has the steps:

1. Put your house's code on that computer: a ZIP from GitHub (from your own copy if you used the Deploy button, or as in [Install from a terminal](terminal.md#1-get-the-code)).
2. Click **Copy the command** on the setup page.
3. Open a terminal in the code's `mcp` folder, and paste the command. (In Windows' PowerShell, paste with a **right-click**.) It looks like this:

   ```
   node install/helper.js --house <your house's address> --pair <a code>
   ```

The code in the command gets the helper its key from your house, so you paste nothing else. The code works for an hour; after that, the setup page gives you a new one.

The command finds your WiiMs by itself (on a Chromebook this can take two minutes). If their names differ from the ones on the setup page, it asks which is which. Then it starts itself.

**On a Mac,** a box then asks *Allow "node" to find devices on local networks?* Click **Allow**. It only asks once, and without it the helper can't reach your WiiMs.

## Remove it

- On the setup page, click **Remove the home helper**, while the helper is connected.
- Or, on its computer:
  - **Windows:** Settings, Apps, **fmwax home helper**, Uninstall.
  - **Mac or Linux:** in a terminal, `node ~/.fmwax-helper/remove.mjs`.

You don't need to download anything for either.
