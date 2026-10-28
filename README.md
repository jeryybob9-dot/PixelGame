# Brickbox: Tiny Gods

An original pixel-art game for phones. Knock down the red castle before they knock down yours. The island is shown
as a 3D world of toy bricks with pixel-sprite heroes and creatures; you can switch to classic 2D in the settings.

- **Move** your hero with a joystick. It fights on its own; POWER fires its special attack.
- **Mine** bricks with your villagers. Bricks pay for everything.
- **Send** troops by dragging cards onto your side of the river. They march on the enemy castle.
- **Build** a House, Tower or Barracks.

Everything (art, sound and code) is original. It runs as plain JavaScript with Canvas and WebGL. The only library is
three.js (MIT), which is bundled into the game. You can play it in the browser, as an iPhone home-screen app, or as
a native iOS app.

The full design is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Features

**Realm Clash (main mode, 5 minutes).**
- **Goal:** destroy the enemy castle to win at once. If time runs out, the castle with more health wins. Both
  castles' health is always on screen, and an arrow points to the enemy castle.
- **The island** is freshly generated every match and point-symmetric, so both sides get a fair start. A river
  splits it in two, with three bridges. Your side is everything below the river.
- **Brick Rush:** the last minute gives double bricks, for a big final push.

**Hero.**
- Steer with a floating joystick (or WASD). Your hero attacks enemies in range by itself; tap an enemy to focus it.
- One POWER button. The hero levels up by fighting: level 2 is tougher, level 3 upgrades POWER.
- Heals beside your castle and respawns there after 5 seconds.

**Village.**
- Bricks are the only resource. Villagers mine brick piles and carry them home; a few more trickle in every second.
- Three buildings: House (+2 villagers), Tower (shoots enemies) and Barracks (sends Soldiers to attack).
- Buildings stand on little team-coloured brick baseplates. Forests burn and regrow, and the sun sets as the clock
  runs down.

**Cards.**
- An 8-card deck and a 4-card hand of **42 cards**, paid for with bricks (card cost × 10).
- Troops are sturdy, medium-strength units that march on the enemy castle and hit buildings hard. Swarm cards bring
  a few tough units instead of many fragile ones.
- Spells strike anywhere but soften troops rather than wiping them out: Meteor, Earthquake, Blessing, Lightning,
  Acid Rain, Blizzard, Plague, Black Hole and a Tiny Nuke.
- Builder cards bring new villagers.

**The rival** builds a village, defends its side of the river, and attacks in waves with its troops and hero.

**5 heroes, 17 weapons, 6 gadgets, 6 pets and a skin editor.**
- **Heroes:** Ember (fire), Terra (earth), Volt (lightning), Frost (ice) and Grim (shadow).
- **Weapon effects:** burning, poison, bleeding, slow, stun, knockback, lifesteal, piercing rail shots, chain
  lightning, ricochet, spin-up, area damage, black-hole vortices and a Sheep Launcher.
- **Skin editor:** paint your hero on a 12×16 pixel grid.

**Progression.**
- 8 Realms (arenas), each with its own biome, music, rival god and new cards.
- Trophies, a Trophy Road and King levels.
- Card and weapon upgrades, daily quests and achievements.
- **Lucky Drops** after every win: tap up to three times to upgrade the drop before opening it.
- A shop with a free gift every 4 hours. There are no real-money purchases.

**Other modes.**
- **Horde Nights:** your village alone on the island. Every night a bigger horde lands on the beaches, with a
  giant every 5th night.
- **God Box:** a full sandbox world. Paint terrain, spawn four tribes, watch villages grow into warring kingdoms,
  and unleash meteors, plagues, black holes and atomic bombs.
- **Training:** a coached first match.

**Built for iPhone.** Touch-first controls, pinch zoom, a minimap, safe-area awareness, haptics in the native app, an
offline home-screen web app, and synthesized chiptune music and sound effects (no audio files).

## Run it locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server serves the repo root unbundled (`index.html` loads `src/main.js` as an ES
module) and sends `Cache-Control: no-store`, so a plain reload shows your changes.

To try it on a phone on the same Wi-Fi, run `npm run dev -- --host` and open the printed `Network:` URL in Safari.
`--port 8080` changes the port.

## Build

```bash
npm run build
```

This writes `dist/`:

| File | What it is |
| --- | --- |
| `dist/index.html` | The whole game in one self-contained page: bundled and minified JS, CSS and base64-inlined fonts. It also has the PWA manifest link, the iOS web-app meta tags and a guarded service-worker registration. It makes no external requests. |
| `dist/artifact.html` | The same game as an HTML fragment (no doctype/html/head/body, no manifest, no service worker) for publishing as a Claude Artifact. Kept under 16 MB. |
| `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/` | PWA manifest, the offline service worker (cache-first, its cache version is stamped by each build) and the app icons. |
| `dist/licenses/` | Font licenses (SIL OFL 1.1). |

To preview the build, run `node scripts/serve.mjs dist` and open <http://localhost:5173>.

How the build works (`scripts/build.mjs`, esbuild):

- `src/main.js` is bundled into one IIFE (target `es2020` + `safari15`, minified). Imports must be relative with `.js`
  extensions. Don't use top-level `await` or `import.meta`, because neither survives IIFE output.
- `src/ui/styles.css` is bundled. Its `@import`s are inlined, and every `url()` to a font or image becomes a `data:` URI.
  CSS imported from JS (`import './x.css'`) is collected and inlined too.
- The `<meta>` tags, `<title>` and `<body>` markup (minus scripts) are copied from the dev `index.html`, so both entry
  points stay in sync.
- The build fails loudly (exit code 1) on any esbuild error, a missing input, or an output that would load an external URL.

`npm run icons` regenerates every icon from the pixel art in `scripts/make-icons.mjs`. That covers the web icons, the iOS
App Store icon and the iOS launch screen.

## Play on iPhone

### A. Home-screen web app (no Mac needed)

1. Run `npm run build`.
2. Host the `dist/` folder on any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, your own server). For
   example, with GitHub Pages:
   ```bash
   git worktree add --orphan -b gh-pages ../brickbox-pages   # once (git 2.42+)
   cp -R dist/. ../brickbox-pages/
   cd ../brickbox-pages && git add -A && git commit -m "Deploy" && git push -u origin gh-pages
   ```
   Then in the repo's **Settings → Pages**, choose *Deploy from a branch* → `gh-pages` / `(root)`.
3. On the iPhone, open the site in **Safari**, tap **Share → Add to Home Screen**, then launch Brickbox from the home screen.
   It runs full screen in portrait and works offline after the first load.

### B. Native app (needs a Mac with Xcode)

The Capacitor iOS project lives in `ios/` (Capacitor 8, Swift Package Manager, so no CocoaPods). It loads the game from `dist/`.

1. `npm install`
2. `npm run ios:sync`: builds `dist/` and copies it into the iOS project. Run it again after every web change.
3. `npm run ios:open`: opens `ios/App/App.xcodeproj` in Xcode. Xcode fetches the Capacitor Swift packages the first time.
4. In Xcode, select the **App** target → **Signing & Capabilities** → choose your **Team**. A free Apple ID works for
   your own device. If the bundle id `com.brickbox.royale` is already taken, change it to something unique.
5. Connect your iPhone and enable **Developer Mode** on it (Settings → Privacy & Security). Pick the phone as the run
   destination and press **Run** (⌘R).
6. The first time, trust your developer certificate on the phone: Settings → General → VPN & Device Management.

The app is portrait-only, hides the status bar and uses the generated pixel-art icon and dark launch screen. App
settings are in `capacitor.config.json` and `ios/App/App/Info.plist`. Use the current Xcode from the Mac App Store. The
deployment target is iOS 15.

## Tests

```bash
npm test
```

This runs every `node:test` file in `tests/`. `tests/build.test.js` builds the game and checks the packaging. It confirms
that the page is self-contained with inlined fonts, that the artifact fragment is valid, and that the manifest, icons,
service-worker stamping and dev-server MIME types are correct.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module contracts. In short:

```
index.html            dev entry point
src/                  game code (core, data, art, battle, ui, sandbox)
assets/fonts/         bundled fonts + licenses
public/               manifest.webmanifest, sw.js, icons/
scripts/              build.mjs, serve.mjs, make-icons.mjs
tests/                node:test tests
ios/                  Capacitor iOS project (generated)
```

## Credits and licenses

- **Press Start 2P** by Cody "CodeMan38" Boisclair. Copyright 2012 The Press Start 2P Project Authors.
  SIL Open Font License 1.1: [`assets/fonts/OFL-PressStart2P.txt`](assets/fonts/OFL-PressStart2P.txt).
- **Pixelify Sans** by Stefie Justprince. Copyright 2021 The Pixelify Sans Project Authors.
  SIL Open Font License 1.1: [`assets/fonts/OFL-PixelifySans.txt`](assets/fonts/OFL-PixelifySans.txt).

The fonts come from the [Google Fonts](https://github.com/google/fonts) repository and are bundled unmodified.

- **three.js** (c) 2010–present three.js authors, MIT License. Bundled into the game for the 3D island view; its license
  is copied to `dist/licenses/three.js-MIT.txt` by the build.
