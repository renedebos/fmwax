# If something goes wrong

Can't find your problem here? Please report it with [the Install problem form](https://github.com/renedebos/fmwax/issues/new/choose) on GitHub. Say which step you were on and what the screen said. Leave out your house's address, your setup key and your recovery code.

## Installing

- **GitHub's sign-up page says "Too many requests".** That's GitHub's own limit, not something you did. Wait 15 minutes, or sign up on your phone with its Wi-Fi turned off.
- **GitHub shows a settings page with a grey Save button, not Install.** Cloudflare is already connected to that GitHub account. Change nothing there. Press the Deploy button again, click the **Git account** box on the form, and choose your GitHub name. If your name is not in that list, the GitHub account is connected to *another* Cloudflare account, and one GitHub account can only be connected to one: make a new GitHub account for your house.
- **The form shows only a Git account box that says "Select…".** Click that box and choose your GitHub name: the rest of the form appears then.
- **Cloudflare's page says "No URLs enabled" or "workers.dev: Disabled".** Your house's address works all the same: it is the `https://…workers.dev` line near the end of the build log.
- **Cloudflare shows "Select a repository".** That's a detour, not your house's form. Don't pick anything there. Press the Deploy button in [Start here](../../START-HERE.md#step-2-press-the-deploy-button) again: the form opens with your GitHub account filled in.
- **The build failed.** Cloudflare's page shows which step failed, with its log. Copy the log into the Install problem form (link above).
  - One known cause: the two **Name your KV namespace** boxes had the same name. They must be different, for example `fmwax-house-tokens` and `fmwax-house-programs` (any two different names work). Never choose a name already in the list, even when Cloudflare fills one in for you: it belongs to something else on your Cloudflare account, and the two would mix.
- **The form seems to have only a Git account box.** The form scrolls inside its own box: scroll down within it to see the rest.
- **The install command stopped** (the terminal way). Run it again. It picks up what is already done.

## Claiming your house

- **The setup key is refused, or the page says it is too short.** In Cloudflare, open **Workers & Pages**, your house, **Settings**, **Variables and Secrets**. Edit **SETUP_KEY**, paste a new password from your note (24 characters or more), and save. Then claim your house again.
- **Lost the recovery code, but still signed in somewhere:** on the setup page, click **Make a new recovery code**.
- **Lost the recovery code and every signed-in browser:** your Cloudflare account is the way back. Old sign-ins and the old code then stop working.
  - **A house from the Deploy button:** set **SETUP_KEY** again in Cloudflare (as above). On the setup page, open **Claim it again with a new setup key**, paste it, and click **Claim**.
  - **A house from the terminal:** run `node install/door.js --new-key` (add `--name` if you gave your house a name). It makes a new setup key and opens the page with **Claim it again with a new setup key** filled in: click **Claim**.

## Using it

- **Something seems off in Claude or ChatGPT.** Start a new chat. An old chat may not have your house's tools.
- **A set didn't land on your preset.** If Claude's own Spotify connector, or ChatGPT's Spotify app, is turned on, turn it off in chats with your house. Otherwise the assistant may make the playlist in the wrong place.
- **"Waiting on the curator… its plan may have hit its limit."** Something has waited over 20 minutes. Usually your Claude or ChatGPT plan's limit has run out for now. The curator carries on when the limit resets. The setup page's **Curator** row says when it last checked in.
- **Your house misbehaves in some other way.** On the setup page, click **Check the house**.
