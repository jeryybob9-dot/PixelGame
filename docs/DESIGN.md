# Brickbox: Tiny Gods — Game Design

You are a tiny god with a champion. Your tribe lives on a small pixel island and runs itself. You fight beside
them as a hero, help them build their village brick by brick, and cast Divine Cards from your deck. A rival god
and its tribe live on the other side of the island. Only one village can rule it.

Each source game supplies one pillar, and each pillar has equal weight:

| Pillar | Inspired by | What you do |
| --- | --- | --- |
| **FIGHT** | Pixel shooter | Steer your hero with a joystick. It auto-fires its weapon (with effects), and you trigger 2 spells, a gadget and a pet. Spend bricks on 3 forms. Respawn at your Keep. |
| **BUILD** | Brick RTS | Place blueprints with bricks: House, Barracks, Watchtower, Temple, Outpost, Wall. Villagers build them, mine brick deposits and repair. |
| **RULE** | God sandbox | Your tribe is alive: it grows, works, prays and flees. Forests burn and regrow. Wildlife and monster nests roam. Day and night cycle. Four Ages change the rules, ending in the Age of Chaos with disasters. |
| **CARDS** (meta) | Card battler | 8-card deck and 4-card hand, cast with Faith. Card levels, rarities, Lucky Drops (chests), Realms (arenas) unlocked by trophies, Trophy Road, quests and shop. |

## The Realm Clash match (main mode)

- **Island**: 40×64 tiles in portrait. It is procedurally generated per match from the Realm's biome. Your Keep is
  near the bottom (≈ 20, 55) and the rival Keep is near the top (≈ 20, 9). A land route always connects them.
- **Length**: 8:00, split into four Ages (see below). Destroying the rival Keep wins instantly (3 crowns). Otherwise the
  higher **Dominion** wins when the Age of Chaos ends.
- **Dominion** = owned territory tiles + 12 × buildings (walls excluded) + 4 × population + 60 if you hold the Shrine.
  It is shown live as a tug-of-war bar.
- **Crowns**: a Keep kill gives 3. A Dominion win gives 1, plus 1 if you destroyed 3 or more enemy buildings, to a
  maximum of 2. A draw gives 0.

### Resources

| Resource | How you get it | Used for |
| --- | --- | --- |
| **Bricks** | Villagers mine deposits and carry 5 per trip to the Keep or an Outpost. +1 every 2 s passively. Kill bounties. Red Bricks. | Buildings, hero forms (60 / 140), Watchtower elements (80) |
| **Faith** (0–10) | 0.25/s base + 0.012/s per villager + 0.08/s per Temple with a praying priest + 0.1/s for the Shrine. ×2 in the Age of Chaos. | Casting Divine Cards (card cost) |
| **Population** | The Keep spawns a villager every 10 s while pop < cap. Cap = 6 (Keep) + 4 per House (+ relics). Warriors count. | Villagers work, warriors fight, and both feed Faith and Dominion |

### Territory

Every building claims tiles around it (Keep 8, Outpost 6, Watchtower 4, others 3, Shrine 5). A tile belongs to
the team with the strongest influence, where influence = Σ max(0, claim − distance). Borders are drawn as team
tints with dashed edges, WorldBox style.

- You can only place **buildings** on free, buildable land inside your own territory.
- **Summon cards** can be dropped inside your territory, or anywhere within 4 tiles of your living hero. The hero is
  a walking beacon.
- **Spells** can be cast anywhere.
- **Building cards** (Tesla, Cannon, Crypt, Brick Tower, Elixir Mine) follow the building rule. They appear
  instantly and decay as in the card game.

### Buildings (bricks; villagers construct them)

| Id | Name | Cost | Size | HP | Claim | Build | Effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| keep | Keep | — | 3×3 | 4200 | 8 | — | Shoots bricks (range 7) and is the drop-off point. Spawns villagers. If it falls, you lose. |
| house | House | 25 | 2×2 | 450 | 3 | 6 s | +4 population cap |
| barracks | Barracks | 70 | 3×2 | 950 | 3 | 12 s | Trains a Warrior every 16 s (8 s in the Age of War) while there is pop room, up to 5 alive per barracks |
| tower | Watchtower | 45 | 2×2 | 850 | 4 | 9 s | Archer tower, range 6.5. Tap it to give it an element for 80 bricks (fire/ice/lightning/earth). |
| temple | Temple | 60 | 2×2 | 650 | 3 | 10 s | A priest prays here: +Faith. Each temple also adds +1 Faith per kill made in its territory. |
| outpost | Outpost | 35 | 1×1 | 380 | 6 | 6 s | Claims land and works as a brick drop-off |
| wall | Wall | 4 | 1×1 | 600 | 0 | 1.5 s | Blocks every unit. Enemies smash through it. |

Unfinished buildings appear as scaffolds. Their HP grows as they are built, and enemies can attack them.

### Units

- **Villagers** (pop) take a job automatically. Builders build scaffolds and then repair. One priest goes to each
  Temple. Everyone else mines. Villagers flee from enemies within 3 tiles and fight back weakly. Killing one gives
  the killer 3 bricks. The *Builder* card summons 2 extra villagers.
- **Warriors** (pop) come from Barracks. **Guard** stance: they patrol your territory and engage intruders.
  **Charge** stance (war horn button): they march on the nearest enemy building.
- **Summons** (troop cards) always push: they go for the nearest enemy building and fight what they meet, as in the
  card game.
- **Hero**: joystick movement with auto-aim at the nearest enemy in weapon range. Spells, gadget, pet and forms
  are the same as in the card arena. A fallen hero respawns at the Keep after 6 s, and the enemy gets 20 bricks.

### Living world (team 2 = wild)

- **Critters** (sheep, chicks) wander for ambience. They cannot be targeted and they flee fire.
- **Monster nests** (2–3 in the contested middle): each keeps up to 3 wolves or bandits nearby, leashed to 6 tiles.
  At **night** each nest sends a raid at the nearest village. Destroying a nest gives 40 bricks and drops a
  **Red Brick** relic.
- **Red Bricks**: walk over one with the hero to collect a random match perk. Swift Hands (+40% work speed), Holy
  Spark (+25% Faith), Brick Rain (+120 bricks), Hero's Might (+20% hero damage), Thick Walls (+25% building HP),
  Battle Hymn (+15% unit damage), Fertile Lands (+4 pop cap), Gold Rush (+50% match gold).
- **Fire**: burning ground spreads across forest tiles. Forest burns to ash, ash regrows into grass, and grass grows
  back into forest.
- **Shrine** (centre): it is captured by having units near it and no enemies for 5 s. It gives +0.1 Faith/s, claims
  land (5) and is worth 60 Dominion.

### Ages and day/night

| Age | Time | Rules |
| --- | --- | --- |
| Dawn | 0:00–1:30 | Peaceful build-up. Nests do not raid. |
| Bricks | 1:30–3:30 | Deposits are rich (+50% per trip). Night falls every 80 s for 25 s, and nests raid at night. |
| War | 3:30–6:00 | Barracks train twice as fast. The rival god turns aggressive. Raids are bigger. |
| Chaos | 6:00–8:00 | Faith ×2. Disasters every ~14 s: meteors, lightning storms, earthquakes. |

### Rival god AI

The rival god places buildings with a planner: houses when pop is near cap, then temple, barracks, towers on the
side that faces you, and outposts toward deposits and the shrine. It plays cards (pushes, counters inside its
territory, spells on clusters), steers its hero (defends, hunts nests and relics, joins pushes), upgrades forms
and sounds the war horn in waves. The difficulty comes from the Realm's AI profile.

## Controls

- **Phone (portrait)**: drag the left half of the screen to move the hero with a floating joystick. Buttons on the
  right: Spell 1, Spell 2, Gadget, Form. The bottom tray holds 4 cards, the next card and the Faith bar; drag a card
  onto the map to cast it. The hammer swaps the tray for the build bar: pick a building, tap the map to put a
  ghost down, then tap ✓. The horn toggles Guard/Charge. Pinch to zoom. Tap the minimap to look there, and tap the
  hero button to snap back.
- **Desktop**: WASD/arrows move, Q/E cast spells, F uses the gadget, R upgrades the form, B builds, G sounds the
  horn, 1–4 select a card and a click casts it, the wheel zooms, and right-drag pans.

## Other modes

- **Horde Nights**: your village alone on the island. Every night a bigger monster horde attacks from the
  nests. Survive as many nights as you can.
- **Arena Duel**: the original lane-battle arena (towers, bridges, elixir) as a quick side mode.
- **God Box**: the free sandbox.
- **Training**: a guided first match with a coach.

## Meta (card-game layer)

The card collection, card levels and rarities, Lucky Drops, Realms (= arenas: biome, music, new cards, rival
god), trophies (+30 / −22), Trophy Road, King levels, daily quests, achievements and the shop all carry over
unchanged. A Realm Clash win grants a Lucky Drop.
