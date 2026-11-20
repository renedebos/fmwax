# On your TV

An extra, at any level. Your house as one screen on a TV, worked with the TV's own remote: your speaker's presets, what's playing with its cover large, the DJs, the Shelf of programs, and **About this song** (who wrote it, its story from Wikipedia, its samples and covers). You can ask by voice too, and if your house has [Talk](talk.md), talk to it on the TV.

It is already part of your house: there is nothing to install on the house. The setup is on the TV, about 15 minutes.

There are two ways to show it:

- **The fmwax TV app** (the better one): a small app, a download. It shows the page full screen with its own tile on the TV's home screen. Voice needs no setting up, the remote's Back key works on the page, and Talk on the TV is only in the app.
- **TV Bro**, a free web browser for TVs from Google Play. Nothing to download outside Google Play, but you set up voice yourself, and there is no Talk.

## What you need

- A TV with **Google TV** or **Android TV**. So far it is tested on one TV, a Sony Bravia, and the keys below are named for its remote.
- On your phone, the **Google TV** app, to type on the TV with your phone's keyboard.
- For the app: **Downloader**, a free app on the TV's Google Play that fetches a download. (Or a computer with `adb`: see [the app's own notes](../../tools/tv/shell/README.md).)
- Optional: the [home helper](home-helper.md). With it, a press on the TV can start any preset on a WiiM, the radio too, and the screen catches up quicker with what plays.

## The fmwax TV app

1. On the TV, install **Downloader** from Google Play.
2. Open Downloader and choose its address box. On your phone, open the Google TV app, tap the remote, then the keyboard, and paste this address:

   `https://github.com/renedebos/fmwax/releases/latest/download/fmwax-tv.apk`

   Then **Go**.
3. The first time, the TV asks whether Downloader may install apps. Allow it: **Settings**, **Apps**, **Security & restrictions**, **Unknown sources**, and turn Downloader on. Then go back to Downloader.
4. Choose **Install**. If Google Play Protect says it doesn't know the app (it is not in Google Play), choose to install it anyway. Then **Open**. Downloader then offers to delete the file it fetched: you can.
5. The app asks for your TV page's address, once. On your phone, in your house's app: the **Speakers** tab, then **Voice on the TV** at the bottom. On the **On the TV** card, copy **the TV page's** address. On the TV, paste it with the Google TV app's keyboard, and press the keyboard's ✓.

fmwax is now among the TV's apps. Add it to the home screen's favourites to keep it in front.

**The remote in the app:**

- **Arrows and OK** move from one button to the next and press it.
- **Back** closes what's open (the room chooser, the song page), then goes to the page before. Held about a second, it opens the address screen again.
- **Guide**: press it, and when **Listening…** shows at the bottom, say it: *"what's playing"*, *"skip"*, a DJ and what you'd like. The whole list is on the **On the TV** card on your phone. The first time, the TV asks whether fmwax may use the microphone: allow it.
- **The fmwax word** at the top left opens **About fmwax**: the house's version, what's connected, these keys, and where the help is.

**Talk on the TV** (if your house has Talk): the microphone button at the top of the TV page opens Talk, or hold Guide about a second anywhere. Hold **Guide** (or OK on the big button) while you speak, let go, and the desk answers. The button says what the line does: Getting ready, Listening, Thinking, Speaking. Talk opens its line as the screen opens, so the first press is heard at once; left alone, it hangs up by itself after its quiet time. Talk's minutes are the phone's.

- Talk hears you through **the TV's own microphone**. On a Sony Bravia it has a switch on the set itself: turn it on, and restart the TV once.
- Talk's voice is the TV's sound. If your TV's sound goes through a receiver, it must be on the TV's input to hear Talk. For a **Denon** receiver the app can do that itself: while Talk is open it switches the receiver to TV, and back when you hang up (unless you chose another input during the call). It is set once from a computer with `adb`, with the receiver's address on your home network:

  `adb shell am start -n house.fmwax.tv/.Main -e denon 192.168.1.50`

**A new version of the app:** the same steps 2 to 4. It installs over the old one and keeps the address. About fmwax shows which version is on the TV.

**What the app may do:** it opens only your house's pages, nothing else; only those pages may use the microphone; the address stays on the TV, out of the TV's backups. Its code is in [tools/tv/shell](../../tools/tv/shell), and the release page lists the download's checksum.

## TV Bro instead

1. On the TV, install **TV Bro** from Google Play.
2. On your phone, in your house's app: the **Speakers** tab, then **Voice on the TV** at the bottom. The **On the TV** card shows **the TV page's** address. Tap **Copy**.
3. On the TV, open TV Bro and choose its address bar. On your phone, open the Google TV app, tap the remote, then the keyboard, and paste the address. Press Enter.
4. Keep it: add a bookmark in TV Bro, or make it TV Bro's home page (**Settings**, **Search and home page**, **Home page**, **Custom**, and paste the same address).
5. **Box to box.** TV Bro starts with a cursor. Hold OK on the page and choose the **D-pad** button (*Direct navigation mode*). Now the arrows move from one button to the next, the one in hand is filled amber, and OK presses it. TV Bro says this works best with its **WebView** engine, in its settings.

**Ask by voice in TV Bro (optional):**

6. On the same **On the TV** card, copy the second address, the one for voice.
7. In TV Bro: **Settings**, **Search and home page**, **Search engine**, **Custom URL**. Paste the address.
8. In TV Bro's settings, **Remote and cursor**: put **Voice search** on a key of your remote. On a Sony Bravia, **Guide** works.
9. On the TV page, press that key, wait until TV Bro listens, and say *"what's playing"*. The whole list of what to say is on the same card on your phone. The microphone button at the top of the TV page shows the key and some examples too.

Every search in TV Bro then goes to your house, not to a search engine.

- **Going back:** in TV Bro the remote's Back key belongs to TV Bro. It leaves box-to-box mode, then opens TV Bro's own bar. Use the buttons on the page instead (Home, DJs, Shelf, Back).
- **If TV Bro says it can't recognize your voice**, restarting the TV has helped. Music played loud near the remote makes it harder too.

## Good to know

- **The address holds your house's key.** Anyone who has it can use your house. Keep it to this TV.
- **Play, pause and skip on the remote** don't reach the page. Use the buttons on the page, or say it.
- **The remote's own microphone button** belongs to the TV's assistant, not to fmwax: use Guide.
- **Nothing is typed on the TV page.** A text box would trap the remote, so there is none: you choose from buttons, or speak.
- **After an update of the house** the TV page loads itself again by itself.
- **Song facts** come from MusicBrainz and Wikipedia, and from Genius if you add its key (see [Your keys](secrets.md)). They are looked up the first time a song plays while the TV page is open, then kept.

It has been tested on one TV so far. If it misbehaves on yours, please say so in an [issue](https://github.com/renedebos/fmwax/issues/new/choose): the TV's make, the app or TV Bro, and what happened.
