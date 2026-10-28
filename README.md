# Brickbox Royale

An original 2D pixel-art battle game for phones. Pick a deck and push your lanes. You also steer a hero yourself, send builders
to mine bricks that power up your hero and towers, and call down god powers on the battlefield. Everything (art, sound and
code) is original. It runs as plain JavaScript and Canvas with no runtime dependencies, in the browser, as an iPhone
home-screen app, or as a native iOS app.

## Features

**Battles (3 minutes + overtime).** Portrait lane arena with two bridges, a King tower and two Princess towers per side.
Drag cards from a 4-card hand (8-card deck, cycling) onto your half. Elixir refills over time, at double speed in the
last minute and triple in overtime. Take Princess towers for crowns and a bigger deploy zone. Knock down the King for an
instant win. Overtime is sudden death, and a tie goes to whoever's weakest tower has more HP.

**Your hero.** A blocky hero fights alongside your cards. Tap the ground to move, tap an enemy to focus it. Heroes
auto-fire their equipped weapon, have armour that regenerates, respawn when they fall, and deal bonus damage to towers.

**Bricks.** Builders mine brick piles and haul bricks to your King. Defeated enemies and towers drop bricks too. Spend
them to:
- upgrade your hero through 3 forms (Apprentice → Ninja → Elemental Master), unlocking an elemental spell at each step;
- give a Princess tower an element: fire burns, ice slows, lightning chains, earth adds HP and stuns.

**42 cards** across Common, Rare, Epic and Legendary. Troops include knights, archers, Boom Sheep that explode, a
Necromancer, a UFO that beams up small units, a Zombie Horde that converts its victims, and a Phoenix that is reborn
from an egg. Buildings include a Tesla Coil, a Bone Crypt and an Elixir Mine. God-power spells include Meteor
(burning ground), Earthquake, Blessing, Lightning, Acid Rain, Blizzard, Plague that spreads, Black Hole, and a Tiny Nuke
that leaves wasteland nobody can deploy on.

**5 heroes, 17 weapons, 6 gadgets, 6 pets.**
- **Heroes:** Ember (fire), Terra (earth), Volt (lightning), Frost (ice) and Grim (shadow).
- **Weapons:** Primary, Backup, Melee, Special, Sniper and Heavy categories. Effects include burning, poison, bleeding,
  slow, stun, knockback, lifesteal, piercing rail shots, chain lightning, ricochet, spin-up, area damage, black-hole
  vortices and a Sheep Launcher.
- **Gadgets:** Medkit, Jetpack, Frost Grenade, Auto Turret, Energy Shield and Void Grenade.
- **Pets:** they follow your hero into battle. The Lucky Sheep finds extra bricks and gold.

**Skin editor.** Paint your hero on a 12×16 pixel grid. Forms 2 and 3 layer their outfit on top of your design.

**Progression.**
- 8 arenas, each with its own biome, music, AI opponent and new cards.
- Trophies, a Trophy Road with rewards and King levels.
- Card and weapon upgrades.
- Daily quests and achievements.
- A shop with a free gift every 4 hours and daily deals. Everything costs in-game currency; there are no real-money
  purchases.

**Lucky Drops.** Every win gives a drop. Tap it up to three times to try to upgrade it from Wooden to Rainbow before
opening.

**Modes.**
- **Battle** vs the AI. It defends with counters, spends spells for value, builds pushes, raids with its hero and emotes.
- **Siege Waves:** endless monster waves with a boss every 5th wave.
- **Training:** a guided tutorial.
- **God Box:** a full sandbox world. Paint terrain, spawn four tribes, watch villages grow into warring kingdoms, and
  unleash meteors, plagues, black holes and atomic bombs.

**Built for iPhone.** Touch-first controls, safe-area aware, haptics in the native app, offline home-screen web app, and
synthesized chiptune music and sound effects (no audio files).

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
