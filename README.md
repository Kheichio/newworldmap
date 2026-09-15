# New World Map — v0.0.6

A small turn-based, card-driven nation builder on a procedurally generated tile world. Plain HTML/JS/Canvas — no build step, no dependencies. The version is set in `js/data.js` (`GAME_VERSION`) and shown in the title bar and setup screen.

**Play:** open `index.html` in a browser (double-click works; no server needed).

## The world

Each map is generated from a seed using layered simplex noise:

- **Elevation** → ocean, coast (shallow water), beach, lowlands, hills, mountains; rivers flow downhill from the hills and form lakes where they get stuck.
- **Temperature** (latitude + altitude) and **moisture** → grassland, plains, woods, forest, marsh, jungle, savanna, desert, tundra, snow.
- **Resources** scattered by terrain: animals, sea life, ores, timber and crops. **Ancient ruins** reward whoever claims them.
- Tiles are drawn as irregular polygons (every grid vertex is displaced by seeded noise), so the world reads as an organic mosaic; hit-testing follows the real shapes.
- World types: Continents, Pangaea, Archipelago. Sizes: small / medium / large.

## Nations

You name your nation and leader and pick a **colour**; each colour has a fixed national trait (Crimson = Martial, Azure = Maritime, Emerald = Agrarian, Amber = Mercantile, Violet = Scholarly, Ivory = Builders, Onyx = Miners, Teal = Wanderers). Your leader gets a random (or chosen) trait on top. Rival AI nations get random names, colours and leaders. Every nation gets a procedurally drawn **flag** (field colour, layout from its name, emblem from its trait) — redraw yours any time with ↻.

## Everything is a card

Your **hand** sits at the bottom of the map: up to 6 cards, refilled at the start of every turn. Click a card, then **Play**, **Keep** it for later, or **Discard** it (free) so a fresh card arrives next turn.

- **Action cards** spend an action point and follow the normal rules and costs: Expansion, Settlers, Charter (upgrade), Farmers, Miners, Woodcutters, Herders, Fishers, Road Builders, Master Builder (castle), Shipwrights (harbour), Merchants (trade), Casus Belli (declare war), March (conquer), Treaty (offer peace), Proclamation (edict). Tile cards highlight every valid tile on the map; nation and edict cards open a chooser.
- **Bonus cards** are instant and free: Caravan, Tax Collectors, Prospectors, Bumper Crop, Migrants, Envoys, Festival, Rally (+1 action).
- **Draw weights:** base weight, +1.5 for a matching national trait, +1.5 for a matching leader trait (those cards glow gold), scaled down sharply when a card has nothing to do right now. Duplicates in hand get rarer. Keeping a card you can't use blocks a fresh draw.
- **Actions per turn:** 1, plus 1 for every two cities (max 3). End the turn with the button or `Space`; then every rival moves. The AI draws and plays from a hand under the same rules and discards what it can't use.

## Rules of the land

- Tiles only produce when **within 2 tiles of one of your settlements** (idle land is hatched).
- **Settlement limit:** the capital supports 3 settlements; each town adds 1, each city adds 2. Grow and upgrade before you spread.
- **Food** is a flow: it feeds population and surplus grows your settlements; a shortfall causes famine. **Materials** build; **gold** pays for expansion, trade, war, edicts and upkeep. Costs rise as your nation grows.
- Borders **grow naturally** around settlements each turn.
- **Relations** drift: trade and charismatic leaders warm them (to a point); shared borders, land hunger and warlike leaders cool them; goodwill and grudges both fade. **War must be declared** before anyone can conquer; conquered settlements are plundered; accepting an offered peace is free and brings a 10-turn truce.
- **Edicts** are 12-turn policies (Harvest Festival, Great Levy, Market Fairs, Corvée Labour). **Random events** — harvests, plagues, migrants, bandits, storms — strike every nation now and then; castles keep bandits away.
- **Win** by holding half of all claimed land, being the last nation standing, or top score at the turn limit.

## Interface

Map with standings (top-right), legend (`L`, top-left), and the card tray (bottom). Sidebar: Selected tile (with the cards that can be played there), then collapsible *Since your last move*, *Your nation*, *Other nations* and *Chronicle*; open/closed states are remembered. Soft lo-fi sound effects are synthesised in-browser; the volume slider and mute (`M`) live in the title bar.

Controls: drag / WASD / arrows to pan, scroll to zoom, `1`–`6` select a card, `Space` end turn, `C` capital, `G` grid, `H` help, `Esc` cancel.

Fonts (Cinzel, Alegreya) load from Google Fonts; without internet the page falls back to Georgia/serif.

## Code layout

```
index.html        page + setup / help / game-over dialogs
css/style.css
js/rng.js         seeded RNG
js/noise.js       simplex noise + fBm
js/data.js        terrains, resources, improvements, settlements, costs, traits, cards, edicts, names
js/mapgen.js      world generation
js/game.js        rules: yields, actions, cards, war & peace, relations, events, turn processing, AI
js/render.js      canvas renderer (organic tile polygons, cached terrain layer, sprites, overlays)
js/flags.js       procedural nation flags
js/audio.js       synthesised lo-fi sound effects
js/ui.js          setup screen, card tray, targeting, HUD panels, map interaction
js/main.js        wiring
```

Balance knobs live mostly in `data.js` (yields, costs, traits, card weights) and `game.js` (`settlementCap`, `cardUsefulness`, `costMul`, `updateRelations`, AI scoring in `aiTurn`).
