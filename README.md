# Bunker Dive Prototype

Arcade shmup prototype focused on vertical bunker-busting.

## Core mechanics
- Move horizontally across the top combat lane.
- Auto-fire forward to clear airborne threats.
- Drop bombs straight down only.
- Side-scrolling tunnel terrain (ceiling + floor), capped so terrain never exceeds 40% of screen height.
- Bunkers spawn in size tiers (small/medium/large) at different depths.
- Some bunkers contain collectible shmup-style upgrades (`W`, `B`, `R`, `M`, `C`, `S`, `D`, `P`).
- Endless run: bunkers and enemies keep spawning until you lose all lives.
- Enemy pressure scales hard with score/stage, including elite variants and enemy fire at higher stages.

## Run
Open `index.html` in a browser.

## Controls
- `A` / `D` or Arrow keys: move
- `Space`: drop bombs
- `P`: pause / resume
- `R`: restart run

## Scoring updates
- Bunker kills now build a temporary combo multiplier.
- High score is saved in browser local storage.

## Tuning points
In `game.js`, adjust:
- `hardnessPalette`, `makeColumn()` for terrain behavior
- `damageBunkers()` and `explodeBomb()` for weapon balance
- `initLevel()` for bomb economy and overall difficulty pace

