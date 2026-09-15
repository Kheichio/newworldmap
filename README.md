# New World Map — v0.0.5

A small turn-based nation builder on a procedurally generated tile world. Plain HTML/JS/Canvas — no build step, no dependencies. The version is set in `js/data.js` (`GAME_VERSION`) and shown in the title bar and setup screen.

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

Every nation gets **1 action per turn, plus 1 for every two cities (max 3)**. Actions:

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
| Declare war | Required before any conquest; ends trade, sours relations |
| Conquer | Take a border tile (or settlement — with plunder) from a nation you are at war with, when your attack beats its defence |
| Offer peace | The weaker or wearier side usually accepts; a 10-turn truce follows. Accepting an offer is free |
| Edict | A 12-turn policy: Harvest Festival, Great Levy, Market Fairs or Corvée Labour |
| End turn | Save resources |

**Settlement limit:** the capital supports 3 settlements, each town adds 1, each city adds 2 (Scholarly nations +1) — grow and upgrade before you spread.

**Fortune cards:** every nation draws 3 cards a turn and may play one for free. Immediate cards pay out gold, materials, growth, population or goodwill; modifier cards discount a kind of action (or boost attack) for the rest of the turn. Cards related to your colour's trait or your leader's trait are drawn more often (weight 1 → 2.5 → 4).

**Flags:** each nation gets a procedurally drawn flag (field colour, layout from the nation's name, emblem from its trait) shown on the map above capitals and in every panel.

**Sound:** soft lo-fi effects synthesised with the Web Audio API — no files. Volume slider and mute (M) in the title bar; settings are remembered.

Also in play: **ancient ruins** 🏺 that reward whoever claims them, and **random events** (harvests, plagues, migrants, bandits, storms, wildfires) that strike every nation now and then — castles keep bandits away.

Key rules:

- Tiles only produce when **within 2 tiles of one of your settlements**.
- **Food** is a flow: it feeds population and surplus grows your settlements; a shortfall causes famine.
- **Materials** build things; **gold** pays for expansion, trade, conquest and upkeep. Costs scale with the size of your nation.
- Borders **grow naturally** around settlements each turn.
- Relations drift: trade and charismatic leaders warm them; shared borders, land hunger and warlike neighbours cool them. Hostile AI nations will declare war when they think they can win, and sue for peace when they are losing.
- Tiles are drawn as irregular polygons (every grid vertex is displaced by seeded noise), so the world reads as an organic mosaic; hit-testing follows the real shapes.
- **Win** by holding half of all claimed land, being the last nation standing, or top score at the turn limit.

**Playing a turn:** use the quick actions in the sidebar (Expand, Village, Improve, Road, Castle, Conquer) — each one lights up every valid tile on the map and dims the rest; click one to act. Or click any tile to inspect it and pick from its panel, which shows costs and the yield each improvement would give. The drawer at the bottom of the map has two tabs — **Since your last move** (what happened to you) and the full **Chronicle** — and collapses to a one-line summary. Your nation, Edicts and Other nations are collapsible sections in the sidebar; Standings sits in the map's top-right corner; the Legend (L) shows the actual sprites. Open/closed states are remembered. Hatched tiles are yours but idle (no settlement within 2).

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
js/render.js      canvas renderer (organic tile polygons, cached terrain layer, sprites, overlays)
js/flags.js       procedural nation flags
js/audio.js       synthesised lo-fi sound effects
js/ui.js          setup screen, HUD panels, cards, map interaction
js/main.js        wiring
```

Balance knobs live mostly in `data.js` (yields, costs, traits) and the top of `game.js` (`SETTLEMENT_SPACING`, `WORK_RADIUS`, `costMul`, `updateRelations`, AI scoring in `aiTurn`).
