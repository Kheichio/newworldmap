# New World Map

A small turn-based nation builder on a procedurally generated tile world. Plain HTML/JS/Canvas — no build step, no dependencies.

**Play:** open `index.html` in a browser (double-click works; no server needed).

## The world

Each map is generated from a seed using layered simplex noise:

- **Elevation** → ocean, coast (shallow water), beach, lowlands, hills, mountains; rivers flow downhill from the hills and form lakes where they get stuck.
- **Temperature** (latitude + altitude) and **moisture** → grassland, plains, woods, forest, marsh, jungle, savanna, desert, tundra, snow.
- **Resources** are scattered by terrain: animals (deer, cattle, horses, elephants, camels…), sea life (fish, whales, pearls…), ores (iron, copper, gold, gems, salt…), timber (oak, pine, mahogany, ebony…) and crops (wheat, rice, cotton, spices, grapes, coffee…).
- World types: Continents, Pangaea, Archipelago. Sizes: small / medium / large.

## Nations

You name your nation and leader and pick a **colour**; each colour has a fixed national trait (Crimson = Martial, Azure = Maritime, Emerald = Agrarian, Amber = Mercantile, Violet = Scholarly, Ivory = Builders, Onyx = Miners, Teal = Wanderers). Your leader gets a random (or chosen) trait on top — Ambitious, Frugal, Warlike, Stalwart, Charismatic, Reckless, Pious… Rival AI nations get random names, colours and leaders.

## Turns

Every nation, including yours, takes **exactly one action per turn**:

| Action | Effect |
| --- | --- |
| Expand border | Claim a specific free tile next to your territory (gold) |
| Found village | On your land, or free land bordering it. Villages → towns → cities as population grows |
| Upgrade settlement | Needs population; bigger settlements give more gold/materials and grow borders faster |
| Farm / Mine / Lumber camp / Pasture / Fishery | Tile improvements; unlock the full yield of a matching resource |
| Road | Settlements connected by road to the capital earn extra gold |
| Harbour | Coastal settlements: gold, food, and sea trade |
| Castle | Claims nearby land, defends everything within 2 tiles, adds attack strength |
| Trade route | Both nations earn gold every turn; relations improve |
| Conquer | Take an enemy border tile (or settlement) when your attack beats its defence |
| Wait | Save resources |

Key rules:

- Tiles only produce when **within 2 tiles of one of your settlements**.
- **Food** is a flow: it feeds population and surplus grows your settlements; a shortfall causes famine.
- **Materials** build things; **gold** pays for expansion, trade, conquest and upkeep. Costs scale with the size of your nation.
- Borders **grow naturally** around settlements each turn.
- Relations drift: trade and charismatic leaders warm them; shared borders, land hunger and warlike neighbours cool them. Hostile AI nations will attack.
- **Win** by holding half of all claimed land, being the last nation standing, or top score at the turn limit.

**Playing a turn:** use the quick actions in the sidebar (Expand, Village, Improve, Road, Castle, Conquer) — each one lights up every valid tile on the map and dims the rest; click one to act. Or click any tile to inspect it and pick from its panel, which shows costs and the yield each improvement would give. The **Last turn** panel summarises what happened to you; hatched tiles are yours but idle (no settlement within 2).

Controls: drag / WASD / arrows to pan, scroll to zoom, `Space` to wait, `C` capital, `L` legend, `G` grid, `H` help, `Esc` cancel.

Fonts (Cinzel, Cormorant Garamond) load from Google Fonts; without internet the page falls back to Georgia/serif.

## Code layout

```
index.html        page + setup / help / game-over dialogs
css/style.css
js/rng.js         seeded RNG
js/noise.js       simplex noise + fBm
js/data.js        terrains, resources, improvements, settlements, costs, nation & leader traits, name generators
js/mapgen.js      world generation
js/game.js        rules: yields, actions, conquest, relations, turn processing, AI
js/render.js      canvas renderer (cached terrain layer + overlays)
js/ui.js          setup screen, HUD panels, map interaction
js/main.js        wiring
```

Balance knobs live mostly in `data.js` (yields, costs, traits) and the top of `game.js` (`SETTLEMENT_SPACING`, `WORK_RADIUS`, `costMul`, `updateRelations`, AI scoring in `aiTurn`).
