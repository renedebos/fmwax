# Talk (an extra)

Talk is a tab in your house's app where you ask by voice: a DJ, a preset, "more like this". Add it at any level, once the steps in [Start here](../../START-HERE.md) work. It takes 10 to 15 minutes.

## What it costs

Talk runs on OpenAI's voice model, and **you pay OpenAI by the minute, on your own OpenAI account**: about 5 cents a minute of talking. It is separate from ChatGPT Plus, which does not include it.

Two things keep the bill in hand:

- **Your house counts the minutes.** You choose 10, 20, 30 or 60 minutes a day, and a call is ended when the day's minutes run out. A house that turns Talk on starts at 30, at most about $1.50 a day.
- **A spending limit at OpenAI.** Set a monthly limit on your OpenAI account. It holds whatever your house is set to.

## Set it up

1. **An OpenAI account for the API.** At [platform.openai.com](https://platform.openai.com), sign in (your ChatGPT sign-in works) and add a payment method and some credit, on its Billing page.
2. **A spending limit.** On the same site, set a monthly limit you are comfortable with.
3. **A key.** On its API keys page, create a new secret key and copy it. It starts with `sk-` and is shown once.
4. **On your house's setup page**, under **Extra · Talk**, click **Set up Talk**. Paste the key, choose the minutes a day, and click **Save and test**.

Your house asks OpenAI whether the key can use the voice model before it keeps it. If it cannot, the page says so and keeps nothing.

The Talk tab then appears in your house's app. Open it on your phone and tap to talk.

## Good to know

- **"It cannot use the voice model yet":** a new OpenAI account usually needs credit added first, and sometimes its organisation verified, on platform.openai.com. Then paste the key again.
- **The key is kept by your house only.** It is never shown again, and it is not part of a backup file: after restoring a backup on a new house, paste it again.
- **Changing the minutes, or turning Talk off:** on the same page. Removing the key takes the Talk tab away; delete the key at OpenAI too if you no longer want it.
- **The day** starts at midnight in your house's time zone.
