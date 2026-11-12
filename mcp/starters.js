// THE STARTER SETS (MC-40, tasks/mc40-dj-presets.md, stage 3). A DJ preset
// made before the house has a curator comes with about an hour of that DJ's
// songs, so it can be saved on the WiiM at once. One list for each DJ who
// can have a preset of their own, in playing order, chosen from the DJ's own
// brief (djs.js) and, where there is one, the roll call (rollcalls.js).
//
// Looked up 2026-11-10: on the claude.ai Spotify connector where it shows
// the record, and through the house's own search for the labels the
// connector hides (Universal's, by the look of it: Motown, Geffen, Island,
// Stiff). Each id has its artist and title beside it, so one that leaves
// Spotify can be found and replaced. A track missing in a listener's country
// shows grey in the playlist and the rest play.
//
// Read and agreed by the owner before they ship (the plan's *Decided*, 4).
export const STARTERS = {
  // Dr. Funkenstein: 15 songs, 63:30. Deep 1960s and 70s funk, none of it a hit (checked against his roll call's not lines), nothing over six minutes; opens warm, ends on the heaviest.
  "dr-funkenstein": [
    "1JweeRbJ87ViccTOW7cwz9", // Marvin Gaye — "T" Plays It Cool (4:26)
    "1TB0dZqFRQsnf4fLLLRKQV", // The Meters — Just Kissed My Baby (4:44)
    "4dUOAFN1Yk2TuslROwZcdX", // Lee Dorsey — Give It Up (3:03)
    "1Li9HBLXG2LJSeD4fEhtcd", // Syl Johnson — Concrete Reservation (2:27)
    "6dC98qWGcBL9bscamvMVKN", // Lyn Collins — You Can't Love Me If You Don't Respect Me (5:31)
    "4lcOKGCzvNA6fA7GHYr0Qg", // Bobby Byrd — Back From the Dead (3:28)
    "6A4M7vPiuL9Kqz5WXCidAo", // Cymande — Bra (5:06)
    "21SHzZ1qsXzJ5Socuuyo8w", // Sly & The Family Stone — In Time (5:47)
    "72h68r1IPddK24W0IbuKqQ", // Baby Huey — Running (3:39)
    "0WTjgnkdK84U0MQtxuXKKx", // Dyke & The Blazers — Runaway People (5:18)
    "488g3rZGlfYNUpbtnKNHcD", // Eddie Bo — Getting To The Middle - Part 1 (2:40)
    "5vilhku7KUCbRlog1d0lBy", // Mandrill — Fat City Strut (3:19)
    "5eodjgTYfige8zIrGFeVvd", // Betty Davis — If I'm In Luck I Might Get Picked Up (5:01)
    "3NTtm9c3VfQPnX316l8zst", // Parliament — All Your Goodies Are Gone (5:03)
    "2X6qfjDzhKQA7UqhzyJrQP", // Funkadelic — Super Stupid (3:57)
  ],
  // Hank: 15 songs, 56:47. Funk and soul made after 1990, by label, a vocal then an instrumental, like a box of 45s.
  "hank": [
    "2ffGZTdlRN0lNxA4LOYyTs", // Sharon Jones & The Dap-Kings — How Long Do I Have to Wait for You? (4:04)
    "7GS4WQCPUQuZW6ZSvfZXvA", // The Budos Band — Up From the South (3:27)
    "2gd0nRAv2Q4Y3KVt7NMbrH", // Lee Fields & The Expressions — Faithful Man (4:06)
    "0mgaDfiJQ2UNVCXKhweILQ", // Menahan Street Band — Make the Road By Walking (3:03)
    "6MQlNH8e6jG0LZg2mocK1R", // Charles Bradley — The World (Is Going Up in Flames) (3:22)
    "4itnvWcXYbmIu8tWqF4yZx", // El Michels Affair — Detroit Twice (3:00)
    "3sXAAkkejrZAs57QHjnuZf", // Durand Jones & The Indications — Is It Any Wonder? (4:37)
    "78arHwcM6HFtyXFkmsg3i1", // Delvon Lamarr Organ Trio — Concussion (4:50)
    "5GS1ESaSAh0SgOYvmHwhY3", // Kelly Finnigan — I Don’t Wanna Wait (3:31)
    "37PdLFvxwCLcJReU3yVw2N", // The Sure Fire Soul Ensemble — Step Down (3:56)
    "6IAuH3hgTRpUUdmOGubXGS", // Thee Sacred Souls — Can I Call You Rose? (3:11)
    "43QbUYHz5yBgv76F4l68av", // Bobby Oroza — This Love (4:46)
    "5mGqT6h5aVPxVy6X1TLWXX", // Carlton Jumel Smith — Woman You Made Me (3:44)
    "7DV9f34JIzcWuxfAgb8XcJ", // Ikebe Shakedown — Kings Left Behind (4:37)
    "44kT6XsCkSGb9wNQ5qGXvg", // Jungle Fire — Comencemos (Let's Start) (2:33)
  ],
  // Vibe: 14 songs, 54:20. The room, her daytime mood, so the preset fits whenever it is pressed: songs everybody knows, across decades, easy first and glad last.
  "vibe": [
    "63xdwScd1Ai1GigAwQxE8y", // Al Green — Let's Stay Together (3:19)
    "5TDZyWDfbQFQJabbPwImVY", // Fleetwood Mac — Dreams - 2004 Remaster (4:18)
    "41dDygR3r7e926oGUXfrLt", // Daryl Hall & John Oates — I Can't Go for That (No Can Do) (5:07)
    "4pNiE4LCVV74vfIBaUHm1b", // Stevie Wonder — Sir Duke (3:52)
    "6aBUnkXuCEQQHAlTokv9or", // Talking Heads — This Must Be the Place (Naive Melody) - 2005 Remaster (4:56)
    "2EISedV2npKMtvygkykV2r", // Toots & The Maytals — Pressure Drop (2:57)
    "5LxvwujISqiB8vpRYv887S", // The Jackson 5 — I Want You Back (2:56)
    "2grjqo0Frpf2okIBiifQKs", // Earth, Wind & Fire — September (3:35)
    "62LJFaYihsdVrrkgUOJC05", // Prince — Kiss (3:46)
    "2tUBqZG2AbRi7Q0BIrVrEj", // Whitney Houston — I Wanna Dance with Somebody (Who Loves Me) (4:53)
    "2R9U8R4ZcOoDWg3jjHjQLr", // Outkast — Hey Ya! (3:55)
    "2Foc5Q5nqNiosCNqttzHof", // Daft Punk — Get Lucky (Radio Edit) (4:08)
    "76GlO5H5RT6g7y0gev86Nk", // The Cure — Just like Heaven (3:32)
    "6dGnYIeXmHdcikdzNNDMm2", // The Beatles — Here Comes The Sun (3:05)
  ],
  // Americana: 14 songs, 52:54. The family tree around Uncle Tupelo; a road song first, a slow one with harmony last.
  "americana": [
    "0duHbgFBsmdaV9CJLpiXCa", // Son Volt — Windfall (2:59)
    "5cDfI3KOa64zbuUgD6a4hG", // The Jayhawks — Blue (3:09)
    "2S6yBUXa5KddBV0CqBkcP1", // Old 97's — Timebomb (3:09)
    "5rUqENE7bmNffBbZDhVBty", // Lucinda Williams — Car Wheels On A Gravel Road (4:44)
    "69xqW9Msgi7vmrf3gNw61G", // Wilco — Box Full of Letters (3:06)
    "3aFMz2anc9vurZw6bPunI6", // Whiskeytown — 16 Days (3:54)
    "6XYtjQY3pOWBXTK5fWga6Y", // The Bottle Rockets — Radar Gun (3:16)
    "2nes7xBxT8C2ol7lthypyF", // Drive-By Truckers — Outfit (4:06)
    "2zZWOk2X14YQ5w4JV4CDxk", // Golden Smog — Until You Came Along (5:00)
    "6TsZ3uoLLol9sfBzmMYXXD", // Calexico — Crystal Frontier - Original Version (4:21)
    "4Ssgx7QJr0fzabt4D4JZ1b", // Uncle Tupelo — New Madrid (3:32)
    "4mBYupeEa1e5Ep2HU7xToZ", // Jason Isbell and the 400 Unit — Alabama Pines (3:52)
    "3YBTxokhuaszeWCOXC7FQn", // The Byrds — Hickory Wind (3:31)
    "51i1VCb9udXdzqrmJCP4Pb", // Gillian Welch — Look At Miss Ohio (4:16)
  ],
  // Soul: 15 songs, 45:09. The South and the North in conversation, Stax and Motown side by side; the house band opens and the biggest voice closes.
  "soul": [
    "3XOVanRi3prWDEZQiZTlYx", // Booker T. & the M.G.'s — Time Is Tight (3:15)
    "4CoGNqLap7UGU5Q3VdKug0", // The Temptations — Ain't Too Proud To Beg (2:36)
    "35w6fQ0Wnuv7aIryRx7gTq", // Carla Thomas — B-A-B-Y (2:57)
    "37soQoNhEEIrhhYgHWK1xU", // Marvin Gaye & Tammi Terrell — Ain't Nothing Like The Real Thing (2:18)
    "6PgVDY8GTkxF3GmhVGPzoB", // Sam & Dave — Hold On, I'm Comin' (2:36)
    "6Pkj4nv5K53i64cLVgkVyY", // Four Tops — Reach Out I'll Be There (2:58)
    "5jQc5zKeHhJ6t2cL9zzi9A", // William Bell — You Don't Miss Your Water - Single Version (3:02)
    "5NqYo7el2XVOHXkMSrS9jH", // The Marvelettes — The Hunter Gets Captured By The Game (2:50)
    "4rz596X40rwNfOhwTs7dgI", // Mable John — Your Good Thing (Is About to End) (2:56)
    "1WPqawIF9HCKfSOt7mN6X0", // Martha Reeves & The Vandellas — Nowhere To Run (3:01)
    "2DxX9x7Cmywikp14l1YUdk", // Johnnie Taylor — Who's Making Love (2:46)
    "6QyQmdvQ1ywNccYa0pwLNQ", // Smokey Robinson & The Miracles — The Tracks Of My Tears (2:54)
    "46JKtJ4Ws9VgtUVxFjcDlQ", // The Staple Singers — Respect Yourself (4:56)
    "5VqMwNEDRl9YViumoh1cma", // The Contours — Just A Little Misunderstanding (2:43)
    "36AlMHDBFwSsD3FQOy1R81", // Otis Redding — Try a Little Tenderness (3:22)
  ],
  // Pub Rock: 15 songs, 50:17. A night in the back room: the support bands, the headliners' run, a closer to shout along to.
  "pub-rock": [
    "3wEj6njz1GJnor5QNNIo5k", // Brinsley Schwarz — (What's so Funny 'Bout) Peace Love and Understanding (3:32)
    "70EuvIhFkD6We1BnrfftGt", // Ducks Deluxe — Coast to Coast (3:44)
    "6Wgst4P9SOnc6WGLtfTb1z", // Ace — How Long (3:24)
    "1vQdyrwrqksdQMfvyPbpqN", // Kilburn & The High Roads — Rough Kids (2:26)
    "6Ii2IbnbiRnRlnCrbmgWYg", // Dr. Feelgood — She Does It Right - 2006 Remaster (3:22)
    "3RPEwWIjRxT7KUGWqgFQYL", // The 101ers — Keys to Your Heart (3:44)
    "3ccFwI1USnZGt7LsWSxfK2", // Eddie & The Hot Rods — Do Anything You Wanna Do (4:20)
    "63lZR6NrvsosUAFwXSE63E", // Graham Parker & The Rumour — Local Girls (3:44)
    "6gNAqXYXDimMwaCtT4KKAx", // Nick Lowe — So It Goes (2:34)
    "5UBq9iGT7lfpibWr7KKqKe", // Dave Edmunds — Girls Talk (3:29)
    "4AHU8QRdwCUWxPC53cw4Hh", // Wreckless Eric — Whole Wide World (2:52)
    "0GmLrYUBXDC5vti77zBZfJ", // Elvis Costello — (The Angels Wanna Wear My) Red Shoes (2:47)
    "4MndAZVT7FqXDKCk0HBNIS", // Rockpile — Teacher Teacher (2:33)
    "4G4piMvn2mRy4SDjZzfd1L", // Wilko Johnson & Roger Daltrey — Going Back Home (4:01)
    "2AixJnPYZY3oaiWKS4YvAi", // Ian Dury & The Blockheads — Hit Me with Your Rhythm Stick (3:44)
  ],
  // Sessions: 15 songs, 55:38. Every song a take from a session series, never two in a row from one series.
  "sessions": [
    "48YkpE5enOln5c7jXSTuHL", // Nirvana — About A Girl - Live (3:38) · MTV Unplugged
    "16LKuftb5zZ8kYweuQ7YER", // The Smiths — This Charming Man - John Peel Session 14/09/83 (2:44) · Peel/BBC
    "6FCfj69zzQHnrx4fTukhfo", // Denzel Curry — Bulls on Parade - triple j Like A Version (4:29) · Like A Version
    "52UQOvBafkLaG9BHGqodaB", // Johnny Cash — Ring of Fire - Live (2:58) · Austin City Limits
    "6KgfC7SPNby1wdzkB6EgTJ", // Leon Bridges — Coming Home - Live at SXSW 2015 (3:48) · Spotify Sessions
    "3fgZZA2pefBgc0NFjjI6Eq", // David Bowie & The Spiders From Mars — Ziggy Stardust - Sounds of the 70s - Bob Harris, Recorded 18.1.72, 2000 Remaster (3:22) · BBC
    "3Tf4l8kDGT2VZyJjjS8idf", // Omar Apollo — Evergreen (You Didn't Deserve Me At All) - Live At NPR's Tiny Desk (4:52) · Tiny Desk
    "3QAE7ypzhNZzQxOjKCGHD9", // Alice In Chains — Nutshell - Live at the Majestic Theatre, Brooklyn, NY - April 1996 (4:57) · MTV Unplugged
    "10oWePLWKaVMgR0BNSKPZZ", // Julien Baker — Sprained Ankle - Audiotree Live Version (2:55) · Audiotree Live
    "6tuK0GEmQvC1pLIvk9HLaw", // Led Zeppelin — Communication Breakdown - 23/3/69 Top Gear;Remaster (3:01) · BBC
    "24oDOsC6NhYkgKQUcpLBIm", // DMA'S — Believe (Triple J Like A Version) (3:18) · Like A Version
    "6d0wEqM0jJTNv1asKflGGi", // Hozier — Take Me to Church - Live From Spotify London (4:06) · Spotify Sessions
    "0c4qS4Fs5os8eTunuvHsR9", // Lucy Dacus — I Don't Wanna Be Funny Anymore - Audiotree Live Version (2:35) · Audiotree Live
    "77ih3fdBQE6VLecTiftysZ", // Johnny Cash & Willie Nelson — Always On My Mind - Live (4:05) · VH1 Storytellers
    "0zxj7dVhYZq5ACyaDx5XIo", // Eric Clapton — Layla - Acoustic Live (4:49) · Unplugged
  ],
};
// The DJs who can have a preset of their own in a house with no curator
// (the owner, 2026-11-09): the seven with a starter set. Deep Dive and Genre
// must be told what to play each time, and the Librarian and Gatefold write
// programs; those four stay on Requests.
export const STARTER_DJS = Object.keys(STARTERS);
// A DJ's starter set as Spotify track URIs, in playing order; none for a DJ
// who has no list.
export const starterUris = (dj) => (STARTERS[dj] ?? []).map((id) => `spotify:track:${id}`);
