# Roadmap — presentation & longevity (items 18–24)

**Status (v0.2.0):** 18 (animated map: two-frame water/river cache, smoke, flag flutter, Motion toggle) and 20 (generative lo-fi music with its own volume) are built; 22 (difficulty levels) is built. 19, 21, 23 and 24 remain as specified below.

These were specified before being built. Each entry lists the intent, the design, the touch points in the code, and open questions. Effort is a rough guide: S = an hour or two, M = an evening, L = a weekend.

---

## 18. Animated map (M)

**Intent.** The world should feel alive without distracting from play: water that shimmers, rivers that flow, chimney smoke over cities, flags that flutter.

**Design.**
- **Two-frame terrain cache.** `Renderer.buildTerrainCache()` currently renders one offscreen canvas. Render two (`cacheA`, `cacheB`) that differ only in the water wave marks and the river dash offset (rivers drawn with `setLineDash([6, 6])` and `lineDashOffset` 0 vs 6). The frame loop swaps every 700 ms. Cost: one extra cached canvas (a few MB) and no per-frame work.
- **Smoke.** Cities and towns emit a slow particle: 1–3 semi-transparent grey circles per settlement that rise `0.3 px/frame` and fade over 2 s, respawned at random offsets. Keep a global cap (200 particles) and skip entirely below zoom 1.0 or when the tab is hidden (`document.hidden`).
- **Flag flutter.** `flags.js` draws the flag once; add a second frame with the fly edge shifted by a 2-px sine wave (three vertical slices offset −1/0/+1 px). The map alternates frames with the cache swap; the sidebar keeps the still image.
- **Animation loop.** `frame()` in `ui.js` only redraws on `needsDraw`. Add `UI.animate` (a setting in the toolbar, persisted like volume) which requests a redraw on a 700 ms interval when true. Animation must never redraw more than ~1.5×/s at low zoom to keep laptops cool.

**Touch points.** `render.js` (`buildTerrainCache`, `draw`), `flags.js` (second frame), `ui.js` (`frame`, setting), `css` (toggle button).

**Open questions.** Should smoke reflect population (more people, more chimneys)? Probably yes — 1 particle per 4 pop, capped at 3.

---

## 19. Turn summary popup (S/M)

**Intent.** The sidebar report is easy to miss. A short interstitial between your turn and the next makes the rivals' phase legible.

**Design.**
- After `g.endTurn()` in `endTurn()`, if anything notable happened (war declared on/by you, settlement lost/gained, wonder completed, peace/pact, unrest, plague/famine), show a centred plate: **"Turn N"** in Cinzel, then up to five lines with icons, grouped: *War*, *Diplomacy*, *Your realm*, *Events*. Income line at the bottom. A single **Continue** button (Enter/Space also closes).
- Quiet turns (only income and border growth) skip the popup unless "Always show turn summary" is enabled in settings.
- The popup plays a soft sting (`Sound.play('turn')` already exists; add `'fanfare'` for wonder completion or a won war).
- Reuse `UI.report` — the popup is just a different renderer for the same list, filtered by `kind !== 'neutral'`.

**Touch points.** `ui.js` (`endTurn`, new `showTurnSummary`), `index.html` (one more modal), `css`.

---

## 20. Ambient lo-fi loop (M)

**Intent.** Background music that suits the mellow sound design, generated in-browser so there are no audio files.

**Design.**
- A **generative chord progression**: pick a key (random per game, from the seed). Every 8 beats (bpm ≈ 68) move to the next chord in a random walk over `I – vi – IV – V – ii – iii`, biased to return to I. Each chord is 3–4 detuned triangle oscillators through the existing low-pass filter and delay, with a slow 4 s attack/release so chords overlap.
- A **melody voice**: every 2 beats, 60% chance of a note from the pentatonic scale of the current chord, sine wave, short envelope, one octave above.
- A **texture**: filtered noise "vinyl crackle" at −30 dB, plus a very slow LFO on the master low-pass cutoff (1200–2200 Hz over 30 s) for the "tape wobble" feel.
- **Dynamics tied to the game**: at war → drop to minor (vi as the tonal centre) and add a soft low drum on beats 1 and 3; game over → resolve to I and stop.
- Own **music volume slider** next to the effects slider (`nwm.music` in localStorage); music starts on the first user gesture like effects do; pauses when the tab is hidden.

**Touch points.** `audio.js` (new `Music` object with `start/stop/setMood`), `ui.js` (`initSound`, war/peace hooks call `Music.setMood`), `index.html` (slider).

**Open questions.** Whether to expose tempo/key choices; probably not — keep it invisible.

---

## 21. Zoomed-out overview mode (S)

**Intent.** One key to see the whole world as a political map.

**Design.**
- Toggle with `O` or a toolbar button. The renderer switches to `overview = true`: fit the map to the canvas (`zoom = min(canvasW / (W·16), canvasH / (H·16))`), draw the cached terrain desaturated (`ctx.filter = 'saturate(0.4)'` where supported, otherwise a dark overlay), fill territory at 0.6 alpha, no sprites/resources/roads, borders 1 px, and a flag + name at each capital. War pairs get a red dashed line between capitals; alliances a gold line; trade routes a thin grey line.
- Clicking a nation's flag opens its row in *Other nations*; clicking anywhere else zooms back in centred on that point.
- Camera state is saved before entering overview and restored on exit.

**Touch points.** `render.js` (`draw` early branch), `ui.js` (key binding, click handling), `css` (button).

---

## 22. Difficulty levels (S)

**Intent.** Let new players learn and veterans sweat.

**Design.** A setup dropdown: *Gentle*, *Fair* (default), *Hard*, *Brutal*, stored on the game and in the save.

| | AI hand size | AI income | AI starting gold/materials | Player contentment | Events vs player |
|---|---|---|---|---|---|
| Gentle | 4 | ×0.85 | ×0.75 | +10 | harmful ×0.5 |
| Fair | 6 | ×1.0 | ×1.0 | 0 | ×1.0 |
| Hard | 7 | ×1.15 | ×1.5 | −5 | ×1.0 |
| Brutal | 8 | ×1.3 | ×2.0 | −10 | harmful ×1.5 |

- Implement as `game.difficulty` and a `mods(n)` helper consulted in `handMax`, `computeIncome` (multiply gross for AI), `contentmentOf`, and `randomEvent` (skip harmful rolls for the player with probability on Gentle, re-roll harmful on Brutal).
- Score at game end is multiplied (×0.8 / ×1 / ×1.25 / ×1.5) and the game-over table shows the difficulty; the profile tracks wins per difficulty.

**Touch points.** `data.js` (`DIFFICULTY` table), `game.js` (five small hooks), `ui.js` (setup, game over), serialize/deserialize (one field).

---

## 23. Scenario seeds (S)

**Intent.** Named starting worlds people can compare notes on.

**Design.**
- `data.js` gets `SCENARIOS`: `{ name, seed, type, size, aiCount, blurb }`. Seeds are chosen by generating candidates and picking ones with a clear identity, e.g.:
  - *The Twin Continents* — continents, medium, 5 rivals: two landmasses split by a strait; harbours decide the game.
  - *Ring of Isles* — archipelago, small, 4 rivals: everyone starts on an island; Colonists and Sea Raids matter.
  - *The Great Plain* — pangaea, large, 7 rivals: one landmass, early borders, alliances or war.
  - *Frostmarch* — continents, small, 3 rivals: a cold northern world, food is scarce, luxuries rare.
- Setup screen: a "Scenario" select above the seed field; choosing one fills type/size/rivals/seed and locks them (a "Custom" entry unlocks). The chosen scenario name shows on the game-over screen and in the profile's win list.
- Finding good seeds: a small node script (like the ones used for balancing) that generates 200 maps per type and prints land fraction, number of continents (flood fill), coastline ratio and luxury count, so seeds can be picked by numbers rather than by eye.

**Touch points.** `data.js`, `ui.js` (setup), `docs/scenarios.md` for the notes on each.

---

## 24. Statistics screen at game end (M)

**Intent.** Show the story of the game: who rose, who fell, when the wars happened.

**Design.**
- **Recording.** In `endTurn()`, push one snapshot per turn per nation into `game.history`: `{ turn, score, tiles, pop, gold, settlements, wars: number }`. 150 turns × 8 nations × 7 numbers is tiny; include it in the save.
- **Events track.** Also record markers: war declared (pair), peace, wonder completed, settlement conquered, nation fallen.
- **Screen.** A tab on the game-over modal: an inline SVG line chart (no library) of score over time, one line per nation in its colour with the flag at the line end; hover shows values; a stripe under the chart marks wars with red bands per pair and wonders with icons. Tabs switch the metric (score / tiles / population / gold).
- **Summary cards.** "Largest empire", "Most wars", "Longest peace", "First wonder", "Comeback of the game" (largest rank climb over 30 turns).
- **Export.** A "Copy summary" button that puts a text version on the clipboard (`navigator.clipboard.writeText`).

**Touch points.** `game.js` (`history`, markers, serialize), `ui.js` (`showGameOver` tabs, chart builder), `css`.

**Open questions.** Whether to keep history for the standings panel too (a sparkline per nation) — cheap once the data exists.

---

## Suggested order

21 (overview) and 22 (difficulty) are small and immediately useful; 24 (statistics) is the most rewarding medium task; 19 (turn summary) improves readability for new players; 18 and 20 are polish and can come last.
