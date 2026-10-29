# Brickbox: Tiny Gods — Architecture & Module Contracts

Brickbox: Tiny Gods is an original pixel-art game (a 3D brick world with pixel sprites, or classic 2D). The goal of
the main mode is one line: knock down the red castle before they knock down yours. The game design is in
[`DESIGN.md`](DESIGN.md).

- **Hero** (pixel shooter): a joystick-steered hero with an armory of weapons, one Power button, an automatic gadget,
  a pet, 3 levels and a skin editor.
- **Village** (brick RTS): villagers mine bricks and construct the House, Tower and Barracks you place.
- **Living island** (god sandbox): fire that spreads and regrows, critters, the sun setting as the clock runs down.
  The full "God Box" sandbox is a separate mode.
- **Cards** (card battler meta): cards paid for with bricks, card levels, Lucky Drops, Realms unlocked by trophies,
  the Trophy Road, quests and the shop. The original lane battle code (`src/battle/battle.js`) is the shared
  engine the realm extends.

No trademarked names, characters or art from other games are used. Everything is original.

## Tech rules (all modules)

- Plain JavaScript ES2022 modules, no frameworks. The only runtime dependency is three.js (MIT), used by the 3D island
  view. It is imported through `src/vendor/three.js` (a relative re-export of `node_modules/three`) and bundled by
  esbuild. JSDoc for public functions.
- Realm Clash renders in WebGL through three.js: a 3D brick world with pixel sprites. It falls back to Canvas 2D when
  WebGL is missing or the player turns 3D off. Arena Duel and God Box use Canvas 2D (`imageSmoothingEnabled = false`).
  Menus and the HUD are HTML/CSS.
- Must run in: iOS Safari 16+, iOS home-screen web app, Capacitor iOS WebView, desktop Chrome/Safari/Firefox,
  and inside a sandboxed iframe (Claude Artifact) where service workers, `alert/confirm/prompt`, downloads
  and `window.open` do not work. Never call `alert/confirm/prompt`.
- Everything that touches `localStorage` goes through `src/core/storage.js` (wrapped in try/catch).
- Audio only starts after a user gesture (iOS). Always call audio defensively: `audio?.sfx?.('name')`.
- Touch first: use Pointer Events, `touch-action: none` on game canvases, no hover-only UI.
- Respect `env(safe-area-inset-*)` for anything fixed to screen edges.
- Imports use relative paths with `.js` extensions (works unbundled in the browser and in esbuild).

## Directory layout

```
index.html                 dev entry (loads src/ui/styles.css and src/main.js as a module)
src/main.js                boot: fonts, storage, audio unlock, screen router
src/core/                  storage.js, rng.js, util.js, input.js, loop.js, audio.js (audio agent), events.js
src/data/                  cards.js, heroes.js, weapons.js, gadgets.js, pets.js, arenas.js, progression.js, quests.js, emotes.js
src/art/                   palette.js, sprites.js, sprite-cache.js, tiles.js, realm-tiles.js, icons.js (art agent)
src/battle/                shared combat engine (damage, effects, projectiles, spells, troops, hero) + the Arena Duel lane mode
src/realm/                 Realm Clash: realm.js (Realm extends Battle), worldgen, grid (A*), village (villagers),
                           realm-ai (rival god), horde (Horde Nights), realm-render (2D view), minimap
src/realm3d/               render3d.js (the 3D brick-world view) + models.js (procedural LEGO-style models, 3D art agent)
src/vendor/three.js        relative re-export of three.js
src/ui/                    styles.css + screens (home, realm-screen, battle-screen, cards, hero, shop, lucky drop, skin editor),
                           guide.js (tutorial overlay), training.js (scripted first match), tour.js (first drop + menu tour),
                           skin.js (pixel-art wood, parchment, brick and bracket textures as CSS variables)
src/sandbox/               godbox.js (+ helpers) — the God Box sandbox mode (sandbox agent)
assets/fonts/              Press Start 2P + Pixelify Sans (OFL) + licenses
public/                    manifest.webmanifest, sw.js, icons/ (packaging agent)
scripts/                   build.mjs, serve.mjs, make-icons.mjs (packaging agent)
tests/                     node:test unit tests (`npm test`)
tools/sprite-gallery.html  visual check of every sprite (art agent)
ios/ + capacitor.config.json  native iOS wrapper (packaging agent)
```

## Theme (CSS custom properties, defined in src/ui/styles.css)

The look is carved wood with gold trim, parchment pages, plaques, ribbons and glossy candy buttons over a night brick
wall. `src/ui/skin.js` paints the pixel-art textures at boot and sets them as `--tex-wood`, `--tex-wood-dark`,
`--tex-parch`, `--tex-wall`, `--corner-tl/tr/bl/br` (steel brackets) and `--stud`; every rule falls back to flat
colours without them.

```
--outline #2b1409 (every border)   --wood #a85d2c  --wood-dk #5c2c12   --gold #ffcf3f  --gold-mid #f5a623  --gold-dark #b8650d
--parch #f4ddae  --parch-ink #4b2a12   --ink #fff4dc (text on wood, with --stroke / --stroke-sm outlines)
--wood-bg / --wood-dark-bg / --parch-bg (layered backgrounds)   --board-shadow (gold-rimmed board)  --brackets (corner art)
.btn (gold) .btn-green .btn-red .btn-blue .btn-gem .btn-ghost (wood)   .plaque   .ribbon   .modal-sheet > .modal-body
--font-display: "Press Start 2P", monospace   (headings, numbers; use sparingly, small sizes)
--font-body: "Pixelify Sans", system-ui, sans-serif
```

## World coordinates (battle)

- Arena is 18 x 32 tiles, `TILE = 16` px → 288 x 512 logical px. Player (team 0, blue) at the bottom, enemy (team 1, red) at the top.
- River occupies rows 15–16 (y 15.0–17.0). Bridges: columns 2–4 and 13–15 (x 2.0–5.0 and 13.0–16.0).
- Princess towers centred at (3.5, 25.5) and (14.5, 25.5) for team 0; mirrored (3.5, 6.5) / (14.5, 6.5) for team 1. 3x3 tiles.
- King towers centred at (9, 29) team 0 and (9, 3) team 1. 4x4 tiles.
- Entity positions are in tile units (floats); renderer multiplies by TILE. Sprites are anchored at the feet (bottom-centre).

## Art contract (src/art/*) — art agent

Palette chars in sprite rows map to colours in `palette.js`. `.` = transparent. Reserved team chars:
`T` team main, `t` team dark, `L` team light (blue for team 0, red for team 1, neutral grey for `team = null`).

`sprites.js` exports `SPRITES` keyed by id:
```js
SPRITES.knight = { w: 14, h: 14, fps: 6, anims: { idle: [rows], walk: [[rows],[rows]], attack: [[rows],[rows]] } }
// rows = array of h strings, each w chars. idle may be a single frame (array of strings) or frames list.
```

`sprite-cache.js` exports:
```js
getFrame(key, anim = 'idle', frameIndex = 0, team = null) -> HTMLCanvasElement   // cached
frameCount(key, anim) -> number
spriteSize(key) -> { w, h }
drawSprite(ctx, key, x, y, { anim='idle', t=0, team=null, flip=false, alpha=1, flash=0, scale=1 })
   // x,y in canvas px = feet position; t in seconds picks the frame via fps; flash 0..1 = white hit flash
drawHero(ctx, { heroId, form, skin, x, y, anim='idle', t=0, team=0, flip=false, flash=0, weaponId, aim=0, scale=1 })
   // skin = 12x16 array of palette chars (from the skin editor) or null for the hero's default skin
defaultSkin(heroId) -> string[16]   // 16 rows of 12 palette chars
cardArt(cardId) -> HTMLCanvasElement 32x32 (unit/building sprite or spell icon, transparent bg)
iconURL(key, scale = 2) -> string (data: URL, cached) for UI icons and anything in SPRITES
```

`tiles.js` exports:
```js
BIOMES = { meadow, desert, frost, swamp, crystal, lava, candy, void }  // name, colours
renderArenaBackground(biomeId, seed) -> HTMLCanvasElement (288x512, static ground, river bed, bridges, tower pads, decorations at edges)
drawRiver(ctx, biomeId, t)   // animated water over rows 15-16 except bridges, in 288x512 space
```

### Sprite keys required

Troops (idle/walk/attack; sizes are guidelines; `fly` units are drawn without feet, hovering):
knight 14x14, archer 12x14, skeleton 10x12, gunner 10x12, bomber 12x12, bat 10x8 (fly), builder 12x14 (also anim `mine`),
sheep 12x10, giant 22x24, boarrider 18x16, minigunner 14x14, monk 12x14, icemage 12x14, flamer 14x14, sniper 12x14,
dragon 22x20 (fly), necro 14x16, crab 26x20, babycrab 10x8, ufo 20x12 (fly), rocketeer 14x14, ninja 12x14, zombie 12x14,
mech 24x26, bonedragon 24x20 (fly), titan 22x26, phoenix 20x18 (fly), phoenix_egg 10x12, turret 10x10.

Buildings (idle; `attack` frames where they shoot): bricktower 16x24, tesla 14x20 (anims `hidden`, `idle`, `attack`),
crypt 18x16, mine 18x18, cannon 16x14, wall 16x16.

Towers: king_tower 48x48, princess_tower 32x40, tower_ruin 32x24, king (the little king on top, 12x12: idle, angry, cheer),
element gems 8x8: elem_fire, elem_ice, elem_lightning, elem_earth.

Heroes (12x16, composed by drawHero): ember (fire), terra (earth), volt (lightning), frost (ice), grim (shadow).
Form 1 = plain outfit, form 2 = ninja wrap + belt in element colour, form 3 = golden armour trim + aura. Anims idle, walk, shoot.

Pets: cat 10x8, dragonpup 12x10 (fly), drone 10x8 (fly), slime 10x8, luckysheep 12x10, minigolem 12x12.

Weapons (held, drawn at the hero's hand, pointing right; 8–14 px wide): rifle, brickblaster, pistols, shotgun, katana, hammer,
flameblaster, frostray, zapper, toxicsprayer, leechgun, unicorngun, railsniper, minigun, rocketlauncher, singularity, sheeplauncher.

Spell icons 16x16 (prefix `spell_`): volley, spark, wall, meteor, quake, bless, lightning, acid, blizzard, plague, blackhole, nuke.
Gadget icons 16x16 (prefix `gadget_`): medkit, jetpack, frostgrenade, turret, shield, blackhole.
Emotes 24x24 (prefix `emote_`): laugh, thumbs, cry, angry, gg, baa.
UI icons 10x10 (prefix `ui_`): elixir, brick, gold, gem, trophy, crown, xp, heart, armor, sword, clock, lock.
Projectiles: arrow 7x3, bullet 3x2, brick 5x4, rocket 7x4, fireball 6x6, iceshard 6x4, bone 6x4.
Map objects: brickpile 16x16 (anims idle with a sparkle), scorch 16x16 (decal).
Chests 24x20 (prefix `chest_`, anims `closed`, `open`): common, rare, epic, legendary, mythic.

## Audio contract (src/core/audio.js) — audio agent

```js
import { audio } from './core/audio.js';
audio.unlock()                 // call from the first pointerdown; creates/resumes the AudioContext
audio.sfx(name, { volume=1, pitch=1, pan=0 } = {})  // fire-and-forget; unknown names are ignored
audio.music(theme)             // crossfade to theme; same theme = no-op; null = stop
audio.setMusicVolume(0..1); audio.setSfxVolume(0..1); audio.setMuted(bool)
audio.setIntensity(0..1)       // battle music tension (overtime / low towers)
```
SFX names: ui_click, ui_back, ui_error, card_select, deploy, elixir_full, shoot_pistol, shoot_rifle, shoot_shotgun,
shoot_laser, shoot_rocket, shoot_sniper, shoot_flame, shoot_zap, shoot_minigun, melee_hit, sword_slash, arrow, magic,
explosion_small, explosion_big, meteor, lightning, freeze, heal, poison, fire_ignite, tower_hit, tower_destroy,
king_activate, unit_die, hero_die, hero_respawn, form_upgrade, brick_collect, coin, gem, chest_open, card_reveal,
rarity_up, victory, defeat, draw, countdown, fight, overtime, double_elixir, emote, level_up, build, earthquake,
black_hole, zombie_infect, sheep, dragon_roar, ufo, splash, mine_pick, nuke, horn, built, hammer, age_up, night,
dawn, raid, wolf_howl, relic, shrine, villager, faith, disaster.
Music themes: menu, meadow, desert, frost, swamp, crystal, lava, candy, void, godbox, waves.

## Realm contract (src/realm/*)

- `Realm` extends `Battle`. It overrides `initWorld()` (island, grid, deposits) and `setupSides()` (castles,
  villagers, heroes, critters), and supplies the map hooks the shared unit code calls:
  `routeTo(e, x, y)` (cached A*), `constrain(e)`, `landSafely(e)`, `unitGoal(e)` (march goals), `speedAt(x, y)`,
  `canBurn(tx, ty)`, `onKill(e, src)` and `spellMult(e)` (spells hit troops 0.7× and buildings 0.6×).
  `B.W`/`B.H` give the map size: 18×32 for the lane arena, 30×46 for a realm.
- All rules and tuning live in `src/realm/constants.js`: match length, Double Elixir, elixir and brick income, building
  limits, troop multipliers, hero XP. Cards cost elixir (`player.elixir`, refilled at `player.elixirRate`); buildings
  cost bricks (`player.bricks`, mined by villagers). `atBuildLimit(team, id)` enforces each building's `max`.
- Saving: `src/core/profile.js` writes the profile to the device on every commit, and an autosave timer catches
  direct changes. `src/core/cloud.js` mirrors it to `data/users/<id>/save` in the artifact's `db` when the game runs on
  claude.ai (declare `capabilities: {db: {}, user: {}}` when publishing); the newer save wins on load, and a fresh
  profile never overwrites real progress.
- Territory is fixed: `R.owner` (Int8Array) is team 1 above the river and team 0 below it. Worldgen always makes the
  river with three bridges (`map.bridges`); buildings may not block a bridge.
- Entity kinds: `tower` (castle = type `king`, Tower = type `princess`), `building` (structures with `struct` and
  card buildings), `troop` (summons, barracks soldiers, monsters on team 2), `hero`, `pet`, `villager` and `critter`
  (ambient, untargetable).
- Structures carry `fp` (a footprint in tiles) and `built` (0..1). `Grid.occ` marks footprints, so A* routes around
  buildings.
- Player actions: `playCard`, `previewPlacement`, `orderBuild`, `placementProblem`, `heroJoy`, `heroMove`,
  `heroFocus`, `heroPower` (the one Power button), `emote`, `pause`, `finish`. `castleHealth(team)` is 0..1.
- Events emitted for the HUD: `countdown`, `start`, `banner`, `built`, `order`, `structureLost`, `underAttack`,
  `heroLevel`, `heroDeath`, `crown`, `night`/`day` (Horde Nights), `coach`, `end` (`{ winner, reason, crowns,
  health }`, reason is `keep`, `time`, `draw` or `surrender`).
- `realm-tiles.js` renders the terrain (`renderRealmMap`, `renderRealmTile`, `drawRealmWater`, `drawTerritory`,
  `realmTileColor`). Tile ids `REALM_TILES` must equal `T` in `src/realm/constants.js`.

## 3D view contract (src/realm3d/*)

- `Realm3DRenderer(realm, glCanvas, hudCanvas)` has the same interface as the 2D `RealmRenderer`: `resize`,
  `setZoomTiles`, `cam {x, y}`, `toWorld`, `toCss`, `panDelta`, `draw(ui, dt)`, `drawMinimap`, `ping` and `dispose`.
- World units are tiles, with x → X, y → Z and height → Y. The camera is pitched about 56°, looks north, and follows
  `cam`.
- **Terrain:** one textured top per tile at a per-type height, plus sides where neighbours are lower. The texture is
  the 2D island map from `renderRealmMap`, plus a strip of side textures. A shader adds territory tints, dashed
  borders and a ground-effects overlay. The overlay is a small 2D canvas drawn with the flat renderer's code: fire,
  spell areas, rings, warnings, summon zones, ghosts and markers.
- **Scenery and buildings:**
  - Water and lava are animated planes.
  - Trees, rocks and crystals are InstancedMesh. Trees hide when their tile burns and return when it regrows.
  - Buildings are LEGO-style models on team-coloured baseplates. Scaffolds have 3 stages.
- **Units and effects:**
  - Units, heroes, pets, villagers, pickups and projectiles are pixel-sprite billboards (HD-2D) with blob shadows.
  - Particles are one `THREE.Points` draw.
  - Bars, damage numbers, beams, bolts, emotes and stun stars go on the HUD canvas in screen space.
- **Night:** hemisphere and sun light dim and turn blue. Up to 5 torch point lights follow the light sources nearest
  the camera.
- `models.js` (3D art agent): `structureModel(id, team)`, `scaffoldModel(w, h, progress)`, `depositModel(rich)`,
  `cardBuildingModel(cardId, team)`, `treeGeometry(biome, variant)`, `rockGeometry(biome, variant)`,
  `crystalGeometry(variant)`. Units are tiles, the origin is the footprint centre at ground level, and fronts face +z.

## God Box contract (src/sandbox/godbox.js) — sandbox agent

```js
export function mountGodBox(rootEl, { audio, storage, onExit }) -> { destroy() }
```
Builds its own DOM inside `rootEl` (full-screen), runs its own `requestAnimationFrame` loop, cleans up in `destroy()`.

## Packaging contract — packaging agent

- `npm run dev` serves the repo root (index.html + src) for development.
- `npm run build` → `dist/index.html` (single self-contained file: bundled JS + CSS + base64 fonts, PWA manifest link,
  SW registration guarded by try/catch), `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/*`,
  and `dist/artifact.html` (the same game as an HTML fragment without doctype/html/head/body tags, no SW, no manifest).
- `npm test` runs every `node:test` file in `tests/`.
- Capacitor iOS project (`ios/`) uses `dist/` as webDir.
