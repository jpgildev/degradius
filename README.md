# Bunker Dive Prototype

Arcade shmup prototype focused on vertical bunker-busting.

## Core mechanics
- Move horizontally across the top combat lane.
- Auto-fire forward to clear airborne threats.
- Drop bombs straight down only.
- Side-scrolling tunnel terrain (ceiling + floor), capped so terrain never exceeds 40% of screen height.
- Bunkers spawn in size tiers (small/medium/large) at different depths.
- Some bunkers contain collectible shmup-style upgrades (`W`, `B`, `S`, `D`, `P`).
- Clear all bunkers to advance to the next level.

## Run
Open `index.html` in a browser.

## Controls
- `A` / `D` or Arrow keys: move
- `Space`: drop bombs / continue after clearing a level
- `P`: pause / resume
- `R`: restart from level 1

## Scoring updates
- Bunker kills now build a temporary combo multiplier.
- High score is saved in browser local storage.

## Tuning points
In `game.js`, adjust:
- `hardnessPalette`, `makeColumn()` for terrain behavior
- `damageBunkers()` and `explodeBomb()` for weapon balance
- `initLevel()` for fuel and bomb economy
