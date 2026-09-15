// Static game data: terrain, resources, nations, traits, costs, name generators.

const TERRAINS = {
  ocean:     { name: 'Ocean',     color: '#1d4e79', water: true, food: 0, mat: 0, gold: 0 },
  coast:     { name: 'Coast',     color: '#3a86b8', water: true, food: 1, mat: 0, gold: 0 },
  lake:      { name: 'Lake',      color: '#4a9ac7', water: true, food: 2, mat: 0, gold: 0 },
  beach:     { name: 'Beach',     color: '#e8d9a8', food: 1, mat: 0, gold: 1 },
  grassland: { name: 'Grassland', color: '#82b366', food: 2, mat: 0, gold: 0 },
  plains:    { name: 'Plains',    color: '#b9b25e', food: 1, mat: 1, gold: 0 },
  woods:     { name: 'Woods',     color: '#63994c', food: 1, mat: 1, gold: 0 },
  forest:    { name: 'Forest',    color: '#376d3c', food: 0, mat: 2, gold: 0 },
  hills:     { name: 'Hills',     color: '#a0916c', food: 0, mat: 2, gold: 0 },
  mountains: { name: 'Mountains', color: '#75716a', food: 0, mat: 1, gold: 0, rugged: true },
  marsh:     { name: 'Marsh',     color: '#5f8663', food: 1, mat: 0, gold: 0 },
  jungle:    { name: 'Jungle',    color: '#237a3e', food: 1, mat: 1, gold: 0 },
  savanna:   { name: 'Savanna',   color: '#c9b45a', food: 1, mat: 0, gold: 0 },
  desert:    { name: 'Desert',    color: '#e3c584', food: 0, mat: 0, gold: 0 },
  tundra:    { name: 'Tundra',    color: '#a9b3a3', food: 0, mat: 1, gold: 0 },
  snow:      { name: 'Snow',      color: '#e9eef0', food: 0, mat: 0, gold: 0 },
};

// imp = improvement that unlocks the full resource yield.
const RESOURCES = [
  // Animals
  { id: 'deer',      name: 'Deer',        cat: 'animal', icon: '🦌', terrains: ['forest', 'woods', 'tundra'],      imp: 'pasture', yield: { food: 2 } },
  { id: 'boar',      name: 'Boar',        cat: 'animal', icon: '🐗', terrains: ['forest', 'woods', 'marsh'],       imp: 'pasture', yield: { food: 2 } },
  { id: 'beaver',    name: 'Beaver fur',  cat: 'animal', icon: '🦫', terrains: ['forest', 'woods'], river: true,   imp: 'pasture', yield: { gold: 2 } },
  { id: 'cattle',    name: 'Cattle',      cat: 'animal', icon: '🐄', terrains: ['grassland', 'plains'],            imp: 'pasture', yield: { food: 3 } },
  { id: 'sheep',     name: 'Sheep',       cat: 'animal', icon: '🐑', terrains: ['hills', 'grassland', 'tundra'],   imp: 'pasture', yield: { food: 1, gold: 1 } },
  { id: 'horses',    name: 'Horses',      cat: 'animal', icon: '🐎', terrains: ['plains', 'grassland', 'savanna'], imp: 'pasture', yield: { food: 1, mat: 1, gold: 1 } },
  { id: 'goats',     name: 'Goats',       cat: 'animal', icon: '🐐', terrains: ['hills', 'mountains', 'desert'],   imp: 'pasture', yield: { food: 2 } },
  { id: 'elephants', name: 'Elephants',   cat: 'animal', icon: '🐘', terrains: ['savanna', 'jungle'],              imp: 'pasture', yield: { gold: 3 } },
  { id: 'camels',    name: 'Camels',      cat: 'animal', icon: '🐪', terrains: ['desert'],                         imp: 'pasture', yield: { food: 1, gold: 2 } },
  { id: 'bison',     name: 'Bison',       cat: 'animal', icon: '🦬', terrains: ['plains', 'savanna'],              imp: 'pasture', yield: { food: 3 } },
  { id: 'bears',     name: 'Bears',       cat: 'animal', icon: '🐻', terrains: ['forest', 'tundra', 'snow'],       imp: 'pasture', yield: { food: 1, gold: 1 } },
  { id: 'seals',     name: 'Seals',       cat: 'animal', icon: '🦭', terrains: ['snow', 'tundra'], coastal: true,  imp: 'pasture', yield: { food: 2 } },
  // Sea life
  { id: 'fish',      name: 'Fish',        cat: 'sea', icon: '🐟', terrains: ['coast', 'lake'],  imp: 'fishery', yield: { food: 3 } },
  { id: 'whales',    name: 'Whales',      cat: 'sea', icon: '🐋', terrains: ['coast'],          imp: 'fishery', yield: { food: 1, gold: 3 } },
  { id: 'crabs',     name: 'Crabs',       cat: 'sea', icon: '🦀', terrains: ['coast', 'beach'], imp: 'fishery', yield: { food: 2, gold: 1 } },
  { id: 'pearls',    name: 'Pearls',      cat: 'sea', icon: '🫧', terrains: ['coast'],          imp: 'fishery', yield: { gold: 4 } },
  // Ores & stone
  { id: 'iron',      name: 'Iron',        cat: 'ore', icon: '⛓️', terrains: ['hills', 'mountains'],           imp: 'mine', yield: { mat: 3 } },
  { id: 'copper',    name: 'Copper',      cat: 'ore', icon: '🟠', terrains: ['hills', 'mountains', 'desert'], imp: 'mine', yield: { mat: 2, gold: 1 } },
  { id: 'tin',       name: 'Tin',         cat: 'ore', icon: '⚪', terrains: ['hills', 'mountains'],           imp: 'mine', yield: { mat: 2, gold: 1 } },
  { id: 'gold',      name: 'Gold',        cat: 'ore', icon: '🪙', terrains: ['hills', 'mountains', 'desert'], imp: 'mine', yield: { gold: 4 } },
  { id: 'silver',    name: 'Silver',      cat: 'ore', icon: '🥈', terrains: ['hills', 'mountains'],           imp: 'mine', yield: { gold: 3 } },
  { id: 'coal',      name: 'Coal',        cat: 'ore', icon: '⚫', terrains: ['hills', 'forest', 'mountains'], imp: 'mine', yield: { mat: 3 } },
  { id: 'gems',      name: 'Gems',        cat: 'ore', icon: '💎', terrains: ['mountains', 'jungle', 'hills'], imp: 'mine', yield: { gold: 4 } },
  { id: 'salt',      name: 'Salt',        cat: 'ore', icon: '🧂', terrains: ['desert', 'marsh', 'beach'],     imp: 'mine', yield: { food: 1, gold: 2 } },
  { id: 'marble',    name: 'Marble',      cat: 'ore', icon: '🏛️', terrains: ['hills', 'mountains'],           imp: 'mine', yield: { mat: 2, gold: 2 } },
  { id: 'stone',     name: 'Stone',       cat: 'ore', icon: '🪨', terrains: ['hills', 'mountains', 'tundra'], imp: 'mine', yield: { mat: 2 } },
  // Timber
  { id: 'oak',       name: 'Oak',         cat: 'wood', icon: '🌳', terrains: ['forest', 'woods'],  imp: 'lumber', yield: { mat: 3 } },
  { id: 'pine',      name: 'Pine',        cat: 'wood', icon: '🌲', terrains: ['forest', 'tundra'], imp: 'lumber', yield: { mat: 2, gold: 1 } },
  { id: 'birch',     name: 'Birch',       cat: 'wood', icon: '🎋', terrains: ['woods', 'tundra'],  imp: 'lumber', yield: { mat: 2 } },
  { id: 'cedar',     name: 'Cedar',       cat: 'wood', icon: '🌴', terrains: ['woods', 'hills'],   imp: 'lumber', yield: { mat: 2, gold: 1 } },
  { id: 'mahogany',  name: 'Mahogany',    cat: 'wood', icon: '🪵', terrains: ['jungle'],           imp: 'lumber', yield: { mat: 2, gold: 2 } },
  { id: 'ebony',     name: 'Ebony',       cat: 'wood', icon: '🖤', terrains: ['jungle'],           imp: 'lumber', yield: { gold: 3 } },
  { id: 'teak',      name: 'Teak',        cat: 'wood', icon: '🪑', terrains: ['jungle', 'savanna'], imp: 'lumber', yield: { mat: 3 } },
  // Crops
  { id: 'wheat',     name: 'Wheat',       cat: 'crop', icon: '🌾', terrains: ['grassland', 'plains'],             imp: 'farm', yield: { food: 3 } },
  { id: 'barley',    name: 'Barley',      cat: 'crop', icon: '🍺', terrains: ['plains', 'tundra', 'hills'],       imp: 'farm', yield: { food: 2, gold: 1 } },
  { id: 'rice',      name: 'Rice',        cat: 'crop', icon: '🍚', terrains: ['marsh', 'jungle'],                 imp: 'farm', yield: { food: 3 } },
  { id: 'maize',     name: 'Maize',       cat: 'crop', icon: '🌽', terrains: ['grassland', 'savanna', 'plains'],  imp: 'farm', yield: { food: 3 } },
  { id: 'cotton',    name: 'Cotton',      cat: 'crop', icon: '☁️', terrains: ['grassland', 'savanna'],            imp: 'farm', yield: { gold: 3 } },
  { id: 'flax',      name: 'Flax',        cat: 'crop', icon: '🧵', terrains: ['grassland', 'marsh'],              imp: 'farm', yield: { mat: 1, gold: 2 } },
  { id: 'spices',    name: 'Spices',      cat: 'crop', icon: '🌶️', terrains: ['jungle'],                          imp: 'farm', yield: { gold: 4 } },
  { id: 'sugar',     name: 'Sugar cane',  cat: 'crop', icon: '🎍', terrains: ['jungle', 'savanna', 'marsh'],      imp: 'farm', yield: { food: 1, gold: 2 } },
  { id: 'grapes',    name: 'Grapes',      cat: 'crop', icon: '🍇', terrains: ['hills', 'plains'],                 imp: 'farm', yield: { food: 1, gold: 2 } },
  { id: 'olives',    name: 'Olives',      cat: 'crop', icon: '🫒', terrains: ['plains', 'hills', 'savanna'],      imp: 'farm', yield: { food: 1, gold: 2 } },
  { id: 'dates',     name: 'Dates',       cat: 'crop', icon: '🌴', terrains: ['desert'],                          imp: 'farm', yield: { food: 3 } },
  { id: 'coffee',    name: 'Coffee',      cat: 'crop', icon: '☕', terrains: ['jungle', 'hills'],                  imp: 'farm', yield: { gold: 3 } },
  { id: 'bananas',   name: 'Bananas',     cat: 'crop', icon: '🍌', terrains: ['jungle'],                          imp: 'farm', yield: { food: 3 } },
  { id: 'tea',       name: 'Tea',         cat: 'crop', icon: '🍵', terrains: ['hills', 'jungle', 'woods'],        imp: 'farm', yield: { gold: 3 } },
];
const RESOURCE_BY_ID = Object.fromEntries(RESOURCES.map(r => [r.id, r]));

const CATEGORY_NAMES = { animal: 'Animal', sea: 'Sea life', ore: 'Ore', wood: 'Timber', crop: 'Crop' };

// Tile improvements. `terrains` = allowed terrains; `resCat` = also allowed on tiles with a resource of that category.
const IMPROVEMENTS = {
  farm:    { name: 'Farm',         icon: '🌾', cost: { mat: 15 }, terrains: ['grassland', 'plains', 'savanna', 'marsh', 'beach'], resCat: 'crop', riverOk: true, yield: { food: 1 } },
  mine:    { name: 'Mine',         icon: '⛏️', cost: { mat: 25 }, terrains: ['hills', 'mountains'], resCat: 'ore', yield: { mat: 2 } },
  lumber:  { name: 'Lumber camp',  icon: '🪓', cost: { mat: 15 }, terrains: ['forest', 'woods', 'jungle'], resCat: 'wood', yield: { mat: 2 } },
  pasture: { name: 'Pasture',      icon: '🐄', cost: { mat: 20 }, terrains: [], resCat: 'animal', yield: { food: 1 } },
  fishery: { name: 'Fishery',      icon: '⚓', cost: { mat: 20 }, terrains: ['coast', 'lake'], resCat: 'sea', yield: { food: 1, gold: 1 } },
};

// influence = radius within which borders grow naturally each turn; upkeep = gold per turn.
const SETTLEMENTS = {
  village: { name: 'Village', gold: 1, mat: 2, upkeep: 1, maxPop: 5,  defense: 2, score: 5,  influence: 2, next: 'town', upgradePop: 4, upgradeCost: { mat: 100, gold: 30 } },
  town:    { name: 'Town',    gold: 3, mat: 4, upkeep: 2, maxPop: 12, defense: 4, score: 12, influence: 3, next: 'city', upgradePop: 9, upgradeCost: { mat: 220, gold: 80 } },
  city:    { name: 'City',    gold: 6, mat: 8, upkeep: 4, maxPop: 30, defense: 7, score: 25, influence: 4, next: null },
};

// Edicts: one active national policy at a time, lasting EDICT_TURNS turns.
const EDICT_TURNS = 12;
const EDICTS = {
  harvest: { name: 'Harvest Festival', icon: '🌾', desc: '+20% food. Your people grow faster.' },
  levy:    { name: 'Great Levy',       icon: '⚔️', desc: '+3 attack and +2 defence, but −20% gold while the levy is raised.' },
  fairs:   { name: 'Market Fairs',     icon: '🎪', desc: 'Each trade route yields +3 gold. Relations with trade partners warm faster.' },
  corvee:  { name: 'Corvée Labour',    icon: '🔨', desc: 'Improvements, roads, castles and villages cost 25% less, but −10% food.' },
};

// Random events (chance per nation per turn is EVENT_CHANCE).
const EVENT_CHANCE = 0.1;

const COSTS = {
  village: { mat: 60, gold: 15 },
  castle:  { mat: 150, gold: 40 },
  harbor:  { mat: 70, gold: 20 },
  road:    { mat: 8 },
  trade:   { gold: 30 },
  conquer: { gold: 40, mat: 20 },
  edict:   { gold: 25 },
  peace:   { gold: 20 },
};
const TRUCE_TURNS = 10;   // no new war for this long after peace

const NATION_COLORS = [
  { id: 'crimson', name: 'Crimson', hex: '#c0392b', trait: 'martial' },
  { id: 'azure',   name: 'Azure',   hex: '#2e86de', trait: 'maritime' },
  { id: 'emerald', name: 'Emerald', hex: '#27ae60', trait: 'agrarian' },
  { id: 'amber',   name: 'Amber',   hex: '#f39c12', trait: 'mercantile' },
  { id: 'violet',  name: 'Violet',  hex: '#8e44ad', trait: 'scholarly' },
  { id: 'ivory',   name: 'Ivory',   hex: '#f1e4c3', trait: 'builders' },
  { id: 'onyx',    name: 'Onyx',    hex: '#2c3e50', trait: 'miners' },
  { id: 'teal',    name: 'Teal',    hex: '#16a085', trait: 'wanderers' },
];

const NATION_TRAITS = {
  martial:    { name: 'Martial',    desc: '+2 attack strength, +1 defence. Castles and conquests cost 30% less.' },
  maritime:   { name: 'Maritime',   desc: 'Coast and lake tiles yield +1 food. Harbours cost half. With a harbour, can trade across the sea with any nation.' },
  agrarian:   { name: 'Agrarian',   desc: 'Farms and pastures yield +1 food. Population grows 25% faster.' },
  mercantile: { name: 'Mercantile', desc: '+25% gold income. Trade routes yield +3 gold.' },
  scholarly:  { name: 'Scholarly',  desc: 'Settlement upgrades cost 30% less. Towns and cities yield +2 gold.' },
  builders:   { name: 'Builders',   desc: 'Improvements and roads cost 40% less. Villages cost 25% less.' },
  miners:     { name: 'Miners',     desc: 'Hills and mountains yield +1 materials. Mines yield +2 materials.' },
  wanderers:  { name: 'Wanderers',  desc: 'Expanding borders costs 40% less. Savanna, desert and tundra yield +1 food.' },
};

const LEADER_TRAITS = {
  ambitious:   { name: 'Ambitious',   desc: 'Border expansion costs 20% less.' },
  frugal:      { name: 'Frugal',      desc: '+15% gold income.' },
  industrious: { name: 'Industrious', desc: '+15% materials income.' },
  bountiful:   { name: 'Bountiful',   desc: '+15% food income.' },
  cunning:     { name: 'Cunning',     desc: 'Trade routes yield +2 gold.' },
  warlike:     { name: 'Warlike',     desc: '+2 attack strength. Quick to wage war.' },
  stalwart:    { name: 'Stalwart',    desc: '+3 defence on every tile.' },
  beloved:     { name: 'Beloved',     desc: 'Population grows 30% faster.' },
  charismatic: { name: 'Charismatic', desc: 'Relations with every nation improve by +2 each turn.' },
  reckless:    { name: 'Reckless',    desc: 'Conquest costs half, but each conquest angers others twice as much.' },
  pious:       { name: 'Pious',       desc: 'Castles cost 25% less and each yields +1 gold.' },
  wise:        { name: 'Wise',        desc: 'Cities yield +3 materials.' },
};

// ---- Name generation ----
const NAME_PARTS = {
  pre: ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hol', 'Is', 'Kar', 'Lor', 'Mor', 'Nar', 'Or', 'Pel', 'Ras', 'Sol', 'Tar', 'Ul', 'Vor', 'Wyn', 'Zar', 'Ash', 'Bran', 'Cal', 'Dun', 'Eth', 'Gor', 'Hal', 'Ith'],
  mid: ['an', 'en', 'in', 'on', 'ur', 'al', 'el', 'ir', 'or', 'ath', 'oth', 'ess', 'im', 'um'],
  suf: ['ia', 'and', 'or', 'heim', 'mark', 'stan', 'burg', 'land', 'gard', 'wick', 'ria', 'oth', 'dor', 'ium', 'ara'],
  townSuf: ['ford', 'ton', 'bury', 'haven', 'wick', 'stead', 'by', 'holm', 'port', 'dale', 'mouth', 'field', 'gate', 'crest'],
  first: ['Aldric', 'Brenna', 'Cassius', 'Dagny', 'Edmund', 'Freya', 'Gideon', 'Hilde', 'Ivar', 'Jorah', 'Kaela', 'Leif', 'Maren', 'Nikolai', 'Orla', 'Percival', 'Quilla', 'Rurik', 'Sigrid', 'Torin', 'Ulla', 'Valen', 'Wren', 'Xanthe', 'Yorick', 'Zelda', 'Anouk', 'Bastien', 'Cyra', 'Darius', 'Elowen', 'Faelan'],
  epithet: ['the Bold', 'the Wise', 'the Just', 'the Grey', 'the Tall', 'the Quiet', 'the Red', 'the Kind', 'the Old', 'the Young', 'Ironhand', 'Stormborn', 'the Patient', 'the Fair', 'the Unready', 'Longstride'],
  govt: ['Kingdom of', 'Realm of', 'Duchy of', 'Republic of', 'Principality of', 'Free Cities of', 'Empire of', 'Clans of', 'Dominion of', 'Marches of'],
};

function genWord(rng, parts = 2) {
  let w = rng.pick(NAME_PARTS.pre);
  for (let i = 0; i < parts - 1; i++) w += rng.pick(NAME_PARTS.mid);
  return w + rng.pick(NAME_PARTS.suf);
}
function genNationName(rng) {
  return `${rng.pick(NAME_PARTS.govt)} ${genWord(rng, rng.int(1, 2))}`;
}
function genLeaderName(rng) {
  const name = rng.pick(NAME_PARTS.first);
  return rng.chance(0.6) ? `${name} ${rng.pick(NAME_PARTS.epithet)}` : `${name} ${genWord(rng, 1)}`;
}
function genTownName(rng) {
  return rng.pick(NAME_PARTS.pre) + rng.pick(NAME_PARTS.mid) + rng.pick(NAME_PARTS.townSuf);
}
