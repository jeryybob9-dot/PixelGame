# Brickbox: Tiny Gods — Game Design

**The whole game in one line: knock down the red castle before they knock down yours.**

You and a rival share a small island split by a river. Each side has a castle, a hero and a few villagers. Your
villagers mine bricks. Bricks pay for everything: troop cards, spells and three kinds of buildings. Your hero walks
the island and fights; your troops march on the enemy castle by themselves.

Each source game supplies one part, and none of them needs a manual:

| Part | Inspired by | What you do |
| --- | --- | --- |
| **Hero** | Pixel shooter | Steer with a joystick. Your hero attacks on its own. One POWER button. It levels up by fighting. |
| **Village** | Brick RTS | Villagers mine bricks on their own. Place a House, Tower or Barracks on your side of the river. |
| **Living island** | God sandbox | Forests burn and regrow, critters wander, and the sun sets as the clock runs down. |
| **Cards** (meta) | Card battler | 8-card deck and 4-card hand, card levels, Lucky Drops, Realms (arenas) unlocked by trophies, quests. |

## The Realm Clash match (main mode)

- **Goal**: destroy the enemy castle (instant win, 3 crowns). When the 5 minutes run out, the castle with more health
  wins (1 crown, +1 if their castle is below half). Equal health is a draw.
- **On screen at all times**: both castles' health bars, the clock, and an arrow at the screen edge pointing to the
  enemy castle when it is off screen. The match opens with "DESTROY THE RED CASTLE!".
- **Island**: 30×46 tiles in portrait, generated per match from the Realm's biome and point-symmetric so both sides
  are equal. Your castle is near the bottom, theirs near the top. A river runs across the middle with three bridges
  (left, centre, right).
- **Your side** is everything below the river. There is no territory to capture.
- **Brick Rush**: the last minute gives double bricks and faster barracks, so matches end with a big final push.

### Bricks (the only resource)

| Source | Amount |
| --- | --- |
| Start | 120 |
| Trickle | 1.2 per second, +0.5 for every House (all ×2 in the Brick Rush). The brick bar shows the current rate. |
| Villagers | Mine a brick pile for 3 s and carry 3 bricks home. You start with 4; each House adds 2. Lost villagers are replaced every 12 s. |
| Bounties | 40 for the enemy hero, 40 for a tower, half the price of any other enemy building, 5 for a villager |

A card costs its printed cost × 10 bricks (a Knight is 30, Skeletons are 10, a Giant is 50).

### Buildings

Pick one from the BUILD bar and tap your side of the river. Villagers build it. Building is not allowed on the
bridges or on brick piles.

| Building | Cost | Size | HP | Effect |
| --- | --- | --- | --- | --- |
| Castle | — | 3×3 | 9000 | Shoots splash bricks (range 7.5). Spawns villagers. If it falls, you lose. |
| House | 50 | 2×2 | 900 | +2 villagers and +0.5 bricks/s. Pays for itself in well under a minute. |
| Tower | 80 | 2×2 | 2400 | Heavy guard: 100 damage per shot with a little splash, range 7. Beats a lone Knight; a real push of two or three cards gets past it. |
| Barracks | 110 | 3×2 | 1800 | Trains a Soldier every 6 s. Soldiers wait in front of the Barracks until a squad of 3 is ready, then attack together (up to 6 alive per Barracks). |

### Troops, spells and the hero

- **Troop cards** drop on your side of the river, or within 4 tiles of your hero. They march to the enemy castle and
  fight whatever they meet on the way.
- **Troops are sturdy.** In the realm they have 2.2× HP, 1.5× damage and 1.25× speed, and deal 1.6× damage to
  buildings. Swarm cards bring fewer, tougher units (a 3–4 unit card brings 2; 5+ brings 3). Every card's squad
  shares at least 450 HP per point of cost. A group of three or four cards is a real push.
- **Spells** land anywhere. They hit troops and heroes for 70% and buildings for 60%, so a spell softens a squad
  instead of wiping it.
- **Hero**: joystick movement with auto-attack. Tap an enemy to focus it. The POWER button fires the hero's special
  attack. The hero earns XP for fighting (and a little over time) and levels up twice: level 2 is tougher and
  stronger, and level 3 upgrades POWER. Its gadget (Medkit, Shield, Jetpack…) fires by itself when it drops below half health in a fight. It heals
  beside its own castle and respawns there 5 s after falling.

### Rival AI

The rival follows a build plan by difficulty (houses, towers, barracks), defends anything that crosses into its half,
saves up and attacks in waves down one lane, and steers its hero (defends, joins pushes, uses its Power). New players
face an easy rival for their first two matches.

## Controls

- **Phone (portrait)**: drag the left half of the island to move the hero with a floating joystick. Tap an enemy to
  attack it. Drag a card from the tray onto the island (or tap the card, then tap the island). BUILD swaps the tray
  for the build bar: pick a building, tap the island, then tap ✓. POWER is beside the hero portrait. Pinch to zoom,
  drag the right half to look around, tap the minimap or the red arrow to look there, and "Back to hero" snaps back.
- **Desktop**: WASD/arrows move, Q/E/F use POWER, B builds, 1–4 select a card and a click casts it, the wheel zooms,
  Space recentres and Esc pauses.

## Other modes

- **Horde Nights**: your village alone on the island. Every night a bigger monster horde lands on the beaches, with
  a giant every 5th night. Survive as many nights as you can.
- **God Box**: the free sandbox.
- **Training**: the guided first match (see below). It can be replayed from the Battle tab.

## First-time experience

Modelled on card-battler tutorials: a new player taps "Tap to Play" and lands straight in a guided match. Foreman Bo
(a builder in a hard hat) only explains what the screen does not make obvious. Everything except the thing to touch is
dimmed and blocked, a pixel hand shows the gesture (tap, drag a card to a glowing spot, or drag the joystick), and the
match pauses while a new idea is introduced. Self-explanatory parts of the HUD (health bars, the brick counter, card
prices, the NEXT card, the minimap, the arrow, the clock) are not covered.

1. **The goal:** knock down the red castle; the camera shows it.
2. **Hero:** drag the left side to move (it attacks on its own), then tap POWER on a gang of skeletons.
3. **Troops:** drag a Knight onto your side of the river and watch it march; the rival defends and counter-attacks,
   and the player drops Archers in front of the castle.
4. **Spells:** drag a Volley onto a group.
5. **Building:** one line on why buildings matter, then the hand alone shows BUILD → House → spot → confirm.
6. **Your turn:** a Brick Rush starts and the player finishes the (weakened) red castle. If they stall, the hand
   suggests a card.

After the win the first Lucky Drop is fixed (its first tap always upgrades it, and it holds enough Knights to level one
up). Back in the menu Bo asks for a name and shows one thing: levelling the Knight up in Cards. A "Skip tutorial"
button is always available.

## Meta (card-game layer)

The card collection, card levels and rarities, Lucky Drops, Realms (= arenas: biome, music, new cards, rival),
trophies, Trophy Road, King levels, daily quests, achievements and the shop. A win grants a Lucky Drop.
