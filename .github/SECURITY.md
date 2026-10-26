# Security

fmwax runs on the internet: every house is a Cloudflare Worker that holds
its owner's Spotify sign-in, and some hold an OpenAI key. A security problem
is reported privately, never in a public issue.

## Reporting a problem

1. On this repository's page, open **Security**, then **Report a
   vulnerability**. Only the author sees what you write there.
2. Say what someone could do, and how: the address or page, the steps,
   and what they gain. A short proof is welcome; a guess is welcome too,
   marked as one.
3. Never include a real house's address with its key, a recovery code, a
   setup key or a Spotify token, yours or anyone else's.

This is one person's project, so allow a few days for an answer. A fix goes
into the next version, and the report is credited if you wish.

## What counts

- Anything that lets someone without a house's keys read or change it,
  play on its speakers, or spend its owner's Spotify, OpenAI or Cloudflare
  allowance.
- A key, a sign-in or a recovery code shown where it should not be: a
  page, a log, an error, a backup someone else can read.
- The home helper doing anything on its computer or its network beyond
  reading the WiiMs and pressing their presets.

Spotify's, Cloudflare's, OpenAI's and Anthropic's own services are theirs to
hear about.

## If a key of your own house got out

On the house's setup page, open **Keys and signed-in browsers**. It makes a
new key in place of the old one, which stops at once, and signs out every
browser but yours.
