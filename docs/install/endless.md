# Endless DJs (Level 3)

Set this up once the steps in [Start here](../../START-HERE.md) work. It takes 30 to 45 minutes, most of it setting up the curator. It needs a paid plan: Claude Pro or ChatGPT Plus (or higher).

## What you get

- **Your DJ presets add songs by themselves.** Press a DJ's preset and they keep playing for as long as you listen: new songs are added as the set runs low. If you made [DJ presets](dj-presets.md) in Level 2, those same presets become endless, with nothing to save again.
- **The guest DJ**, on one more preset. It plays whichever DJ you last asked to play endless, for example *"Genre, ska, endless"* or *"Deep Dive, Michael Jackson, endless"*.
- **Asking from the DJ pages** in your house's app, with no chat open.

One thing changes when the curator arrives: a set you ask a DJ for goes on your Requests preset from then on, even for a DJ who has a preset of their own.

## The curator

Endless DJs need a **curator**: an assistant that writes their next songs by itself, while you listen, with no chat open. It also answers sets asked for on the DJs' pages in your house's app.

The curator runs in your Claude or ChatGPT account:

- **With Claude:** a scheduled task. Scheduled tasks need a paid Claude plan (Pro or higher).
- **With ChatGPT:** a Work chat. ChatGPT Plus has it.

You have **one curator at a time**: your house only wakes the one you chose.

## Set it up

On the setup page, under **Endless**:

1. **Curator.** The curator page has the steps for both, with the text to paste.
   - **With Claude:** you make a scheduled task at [claude.ai/code](https://claude.ai/code), with a connector of its own. Then you give your house the task's address and token.
   - **With ChatGPT:** click **Set up ChatGPT as the curator**. At chatgpt.com you add a second plugin, **fmwax curator**, with the curator address the page gives you (set **Authentication** to **None** again). Then start a new chat whose box says *Work with ChatGPT*, with only that plugin turned on. Paste the page's first note (it makes the chat listen for your house's work) and rename the chat **fmwax curator**, so you find it again. Then paste the second note in the same chat (its hourly check; ChatGPT Plus keeps five scheduled tasks, so delete one under **Scheduled** if it says it is at its limit). Back on the setup page, click **Make ChatGPT this house's curator**, then **Send it a test**. The page ticks each part itself: the chat listening, the test answered, and the hourly check, which shows within the hour.

     Keep your everyday **fmwax** plugin turned off in that chat. With it on, a set asked for in that chat skips the DJs' pages.
2. **The guest DJ preset.** Once the curator has checked in, choose its number (3 is suggested). No DJ presets yet? The same step makes a house DJ and the guest DJ together: choose your house DJ and two numbers.
3. **Save the new preset on each WiiM**, the same way as in [Start here, Step 5](../../START-HERE.md#step-5-save-a-preset-on-your-wiim).

## Good to know

- **No repeats.** An endless DJ doesn't play a song again until 150 of their other songs have played, and skips anything your house played in the last three hours.
- **A DJ's page** in your house's app has Play, *More like this* and *Change it up* while they play, and sliders to tune them.
- **"Waiting on the curator… its plan may have hit its limit":** something has waited over 20 minutes. Usually your Claude or ChatGPT plan's limit has run out for now. The curator carries on when the limit resets. The setup page's Curator row says when it last checked in.
