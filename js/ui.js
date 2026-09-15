// UI: setup screen, HUD panels, targeting modes, map interaction, tooltips, game-over screen.

const UI = {
  game: null, renderer: null, player: null,
  selectedColor: 'crimson',
  needsDraw: true,
  busy: false,
  mode: null,          // active targeting mode (quick action id) or null
  report: [],          // events from the last turn that concern the player
};

const $ = id => document.getElementById(id);
const store = (k, v) => { try { localStorage.setItem('nwm.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
const load = (k, d) => { try { const v = localStorage.getItem('nwm.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDelta = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v}</span>`;
const yieldStr = y => {
  const parts = [];
  if (y.food) parts.push(`🌾${y.food}`);
  if (y.mat) parts.push(`🪵${y.mat}`);
  if (y.gold) parts.push(`🪙${y.gold}`);
  return parts.length ? parts.join(' ') : '—';
};
const costHtml = c => {
  const parts = [];
  if (c.mat) parts.push(`🪵${c.mat}`);
  if (c.gold) parts.push(`🪙${c.gold}`);
  return parts.join(' ') || 'free';
};

// Quick actions shown in the turn panel. `pick` = clicking a highlighted tile only selects it.
const QUICK = [
  { id: 'expand',  icon: '🧭', name: 'Expand',   hint: 'Claim a free tile next to your border' },
  { id: 'village', icon: '🏘️', name: 'Village',  hint: 'Found a village to work nearby land' },
  { id: 'improve', icon: '🛠️', name: 'Improve',  hint: 'Farm, mine, lumber camp, pasture or fishery', pick: true },
  { id: 'road',    icon: '🛤️', name: 'Road',     hint: 'Link settlements to your capital for gold' },
  { id: 'castle',  icon: '🏰', name: 'Castle',   hint: 'Claim and defend land, raise your attack' },
  { id: 'conquer', icon: '⚔️', name: 'Conquer',  hint: 'Seize a border tile from a nation you are at war with' },
];

// ---------------- Setup screen ----------------
function initSetup() {
  const rng = new RNG(Date.now());
  $('in-nation').value = genNationName(rng);
  $('in-leader').value = genLeaderName(rng);
  $('btn-random-names').onclick = () => {
    const r = new RNG(Date.now() + Math.random() * 1e6);
    $('in-nation').value = genNationName(r);
    $('in-leader').value = genLeaderName(r);
    updateTraitPreview();
  };
  $('in-nation').oninput = updateTraitPreview;
  $('version-tag').textContent = 'v' + GAME_VERSION;
  $('version-setup').textContent = 'v' + GAME_VERSION;
  const picker = $('color-picker');
  picker.innerHTML = '';
  for (const c of NATION_COLORS) {
    const el = document.createElement('div');
    el.className = 'color-card' + (c.id === UI.selectedColor ? ' selected' : '');
    el.innerHTML = `<div class="sw" style="background:${c.hex}"></div><div class="cn">${c.name}</div><div class="ct">${NATION_TRAITS[c.trait].name}</div>`;
    el.onclick = () => { UI.selectedColor = c.id; initSetup.refreshCards(); };
    el.dataset.id = c.id;
    picker.appendChild(el);
  }
  initSetup.refreshCards = () => {
    for (const el of picker.children) el.classList.toggle('selected', el.dataset.id === UI.selectedColor);
    updateTraitPreview();
  };
  const lt = $('in-ltrait');
  lt.innerHTML = '<option value="">Random</option>' + Object.entries(LEADER_TRAITS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  lt.onchange = updateTraitPreview;
  $('in-type').innerHTML = Object.entries(MAP_TYPES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('in-size').innerHTML = Object.entries(MAP_SIZES).map(([k, v]) => `<option value="${k}" ${k === 'small' ? 'selected' : ''}>${v.name}</option>`).join('');
  updateTraitPreview();
  $('btn-start').onclick = startGame;
}

function updateTraitPreview() {
  const c = NATION_COLORS.find(x => x.id === UI.selectedColor);
  const T = NATION_TRAITS[c.trait];
  const lk = $('in-ltrait').value;
  const L = lk ? LEADER_TRAITS[lk] : null;
  $('trait-preview').innerHTML = `<div class="trait"><b>${c.name} — ${T.name}:</b> ${T.desc}</div><div class="trait"><b>Leader — ${L ? L.name : 'random trait'}:</b> ${L ? L.desc : 'Your leader receives a random trait when the nation is founded.'}</div>`;
  // flag preview from the current name + colour
  const fp = $('flag-preview');
  fp.innerHTML = '';
  fp.appendChild(makeFlag({ name: $('in-nation').value.trim() || 'My Nation', colorId: c.id, color: c.hex }));
}

function startGame() {
  const size = MAP_SIZES[$('in-size').value];
  const seedIn = $('in-seed').value.trim();
  const seed = seedIn || Math.floor(Math.random() * 1e9).toString(36);
  const rng = new RNG(seed + ':leader');
  const ltrait = $('in-ltrait').value || rng.pick(Object.keys(LEADER_TRAITS));
  const map = generateMap({ width: size.w, height: size.h, seed, type: $('in-type').value });
  const game = new Game(map, {
    player: {
      name: $('in-nation').value.trim() || 'My Nation',
      leaderName: $('in-leader').value.trim() || 'The Leader',
      colorId: UI.selectedColor,
      leaderTrait: ltrait,
    },
    aiCount: parseInt($('in-ai').value, 10),
    maxTurns: Math.max(30, Math.min(500, parseInt($('in-turns').value, 10) || 150)),
  });
  UI.game = game;
  UI.player = game.nations[0];
  UI.mode = null;
  for (const n of game.nations) makeFlag(n);
  UI.report = [{ kind: 'gold', msg: `${UI.player.name} is founded under ${UI.player.leader.name}. Seed: ${seed}` }];
  game.addLog(UI.report[0].msg, UI.player);
  $('setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  initMap();
  centerOnHome();
  selectTile(null);
  refreshAll();
}

// ---------------- Map ----------------
function initMap() {
  const canvas = $('map');
  if (!UI.renderer) {
    UI.renderer = new Renderer(canvas, UI.game);
    bindMapEvents(canvas);
    window.addEventListener('resize', resizeCanvas);
    requestAnimationFrame(frame);
  } else {
    UI.renderer.hover = UI.renderer.selected = UI.renderer.highlight = null;
    UI.renderer.cam.zoom = 1.5;
    UI.renderer.setGame(UI.game);
  }
  UI.renderer.player = UI.player;
  resizeCanvas();
  initLegend();
}

// Draw the real sprites into the legend so the key matches the map.
function initLegend() {
  for (const el of document.querySelectorAll('#legend-grid [data-sprite]')) {
    el.innerHTML = '';
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const g = c.getContext('2d');
    const name = el.dataset.sprite;
    const tint = ['village', 'town', 'city', 'castle'].includes(name) ? UI.player.color : '';
    g.drawImage(UI.renderer.sprites.get(name, tint), 0, 0, 40, 40);
    el.appendChild(c);
  }
}

// ---------------- Collapsible panels & drawer ----------------
function initPanels() {
  for (const d of document.querySelectorAll('details.acc')) {
    const key = 'acc.' + d.dataset.acc;
    const saved = load(key, null);
    if (saved !== null) d.open = saved;
    d.addEventListener('toggle', () => store(key, d.open));
  }
  const st = $('standings');
  st.open = load('standings', true);
  st.addEventListener('toggle', () => store('standings', st.open));
  UI.drawerTab = load('drawer.tab', 'report');
  UI.drawerOpen = load('drawer.open', true);
  for (const b of document.querySelectorAll('.drawer-tab')) b.onclick = () => { UI.drawerTab = b.dataset.tab; UI.drawerOpen = true; store('drawer.tab', UI.drawerTab); store('drawer.open', true); renderDrawer(); };
  $('drawer-toggle').onclick = () => { UI.drawerOpen = !UI.drawerOpen; store('drawer.open', UI.drawerOpen); renderDrawer(); };
  initSound();
}

// ---------------- Sound settings ----------------
function initSound() {
  Sound.volume = load('volume', 0.5);
  Sound.muted = load('muted', false);
  const vol = $('vol'), mute = $('btn-mute');
  vol.value = Math.round(Sound.volume * 100);
  const refresh = () => { mute.textContent = Sound.muted || Sound.volume === 0 ? '🔇' : Sound.volume < 0.4 ? '🔉' : '🔊'; mute.title = Sound.muted ? 'Unmute (M)' : 'Mute (M)'; };
  vol.oninput = () => { Sound.setVolume(vol.value / 100); store('volume', Sound.volume); if (Sound.muted && Sound.volume > 0) { Sound.setMuted(false); store('muted', false); } refresh(); };
  vol.onchange = () => Sound.play('select');
  mute.onclick = () => { Sound.setMuted(!Sound.muted); store('muted', Sound.muted); refresh(); };
  refresh();
  // Browsers only allow audio after a user gesture.
  const wake = () => { Sound.init(); Sound.resume(); };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake);
}

const ACTION_SOUNDS = { expand: 'expand', village: 'village', upgrade: 'upgrade', farm: 'build', mine: 'build', lumber: 'build', pasture: 'build', fishery: 'build', road: 'build', harbor: 'build', castle: 'castle', trade: 'trade', declare_war: 'war', conquer: 'conquer', peace: 'peace', edict: 'edict', wait: null };

function renderDrawer() {
  const drawer = $('drawer');
  drawer.classList.toggle('closed', !UI.drawerOpen);
  $('drawer-toggle').textContent = UI.drawerOpen ? '▾' : '▴';
  for (const b of document.querySelectorAll('.drawer-tab')) b.classList.toggle('active', b.dataset.tab === UI.drawerTab);
  $('report').classList.toggle('hidden', UI.drawerTab !== 'report');
  $('log').classList.toggle('hidden', UI.drawerTab !== 'log');
  // one-line summary shown in the bar: the most notable thing since the last move
  const notable = UI.report.find(e => e.kind === 'bad') || UI.report.find(e => e.kind === 'event') || UI.report.find(e => e.kind === 'good') || UI.report[0];
  $('drawer-summary').textContent = notable ? notable.msg.replace(/<[^>]+>/g, '') : '';
}

function centerOnHome() {
  const g = UI.game, p = UI.player;
  const i = p.capital >= 0 ? p.capital : (p.owned.size ? p.owned.values().next().value : Math.floor(g.tiles.length / 2));
  UI.renderer.centerOn(g.tiles[i]);
  UI.renderer.clampCamera();
  UI.needsDraw = true;
}

function resizeCanvas() {
  const canvas = $('map');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(200, Math.floor(rect.width));
  canvas.height = Math.max(200, Math.floor(rect.height));
  UI.needsDraw = true;
}

function frame() {
  if (UI.needsDraw && UI.renderer && UI.game) { UI.renderer.draw(); UI.needsDraw = false; }
  requestAnimationFrame(frame);
}

function bindMapEvents(canvas) {
  const R = () => UI.renderer;
  let drag = null;
  canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: R().cam.x, cy: R().cam.y, moved: false }; });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { R().cam.x = drag.cx + dx; R().cam.y = drag.cy + dy; R().clampCamera(); canvas.classList.add('dragging'); UI.needsDraw = true; }
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null; canvas.classList.remove('dragging');
    if (wasClick && e.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      mapClick(R().screenToTile(e.clientX - rect.left, e.clientY - rect.top));
    }
  });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const t = R().screenToTile(e.clientX - rect.left, e.clientY - rect.top);
    if (t !== R().hover) { R().hover = t; UI.needsDraw = true; }
    showTooltip(t, e.clientX - rect.left, e.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => { R().hover = null; $('tooltip').classList.add('hidden'); UI.needsDraw = true; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    R().zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    R().clampCamera(); UI.needsDraw = true;
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!UI.game || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const step = 60;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') R().cam.x += step;
    else if (k === 'arrowright' || k === 'd') R().cam.x -= step;
    else if (k === 'arrowup' || k === 'w') R().cam.y += step;
    else if (k === 'arrowdown' || k === 's') R().cam.y -= step;
    else if (k === ' ') { e.preventDefault(); playerAction('wait'); return; }
    else if (k === 'escape') { if (UI.mode) setMode(null); else selectTile(null); return; }
    else if (k === 'c') { centerOnHome(); return; }
    else if (k === 'g') { R().showGrid = !R().showGrid; }
    else if (k === 'l') { $('legend').classList.toggle('hidden'); return; }
    else if (k === 'h') { $('help').classList.toggle('hidden'); return; }
    else if (k === 'm') { $('btn-mute').click(); return; }
    else return;
    R().clampCamera(); UI.needsDraw = true;
  });
}

function mapClick(t) {
  if (!t) return;
  if (UI.mode) {
    const q = QUICK.find(x => x.id === UI.mode);
    if (UI.renderer.highlight && UI.renderer.highlight.has(t.i)) {
      if (q.pick) { setMode(null); selectTile(t); }
      else { const id = UI.mode; setMode(null); selectTile(t); playerAction(id, t); }
    } else {
      toast('Not a valid target — highlighted tiles only. Esc to cancel.', true);
    }
    return;
  }
  selectTile(t);
}

// ---------------- Targeting modes ----------------
function validTargets(mode) {
  const g = UI.game, p = UI.player, set = new Set();
  // Only tiles in or next to the player's territory can ever be targets.
  const cands = Array.from(p.owned, i => g.tiles[i]);
  if (mode !== 'improve' && mode !== 'road' && mode !== 'castle') {
    const seen = new Set(p.owned);
    for (const i of p.owned) for (const nb of g.neighbors(g.tiles[i])) if (!seen.has(nb.i)) { seen.add(nb.i); cands.push(nb); }
  }
  for (const t of cands) {
    if (mode === 'improve') {
      for (const id in IMPROVEMENTS) if (g.checkAction(p, id, t).ok) { set.add(t.i); break; }
    } else if (g.checkAction(p, mode, t).ok) set.add(t.i);
  }
  return set;
}

function setMode(mode) {
  UI.mode = mode;
  const canvas = $('map'), banner = $('mode-banner');
  if (!mode) {
    UI.renderer.highlight = null;
    canvas.classList.remove('targeting');
    banner.classList.add('hidden');
  } else {
    const q = QUICK.find(x => x.id === mode);
    UI.renderer.highlight = validTargets(mode);
    canvas.classList.add('targeting');
    banner.innerHTML = `${q.icon} ${esc(q.name.toUpperCase())} — click a highlighted tile${q.pick ? ' to choose what to build' : ''}<span class="cancel">Esc to cancel</span>`;
    banner.classList.remove('hidden');
  }
  renderQuickActions();
  UI.needsDraw = true;
}

function renderQuickActions() {
  const g = UI.game, p = UI.player;
  const el = $('quick-actions');
  el.innerHTML = QUICK.map(q => {
    const n = validTargets(q.id).size;
    let cost = '';
    if (q.id === 'expand') cost = `🪙${g.expandCost(p).gold}`;
    else if (q.id === 'village') cost = costHtml(g.scaleCost(COSTS.village, g.costMul(p, 'village')));
    else if (q.id === 'road') cost = costHtml(g.scaleCost(COSTS.road, g.costMul(p, 'road')));
    else if (q.id === 'castle') cost = costHtml(g.scaleCost(COSTS.castle, g.costMul(p, 'castle')));
    else if (q.id === 'conquer') cost = costHtml(g.scaleCost(COSTS.conquer, g.costMul(p, 'conquer')));
    else cost = 'varies';
    let why = 'No valid tiles right now (check cost or requirements).';
    if (q.id === 'conquer' && !g.enemies(p).length) why = 'You are not at war. Declare war in the Other nations panel first.';
    const title = `${q.hint}. ${n ? `${n} valid tile${n === 1 ? '' : 's'}.` : why}`;
    return `<button class="quick${UI.mode === q.id ? ' active' : ''}" data-mode="${q.id}" ${n ? '' : 'disabled'} title="${esc(title)}">
      <span class="qi">${q.icon}</span><span>${q.name}</span><span class="qn">${n ? `${n} tile${n === 1 ? '' : 's'} · ${cost}` : cost}</span></button>`;
  }).join('');
  for (const b of el.querySelectorAll('button[data-mode]')) b.onclick = () => setMode(UI.mode === b.dataset.mode ? null : b.dataset.mode);
}

// ---------------- Tooltip & toast ----------------
function showTooltip(t, x, y) {
  const tip = $('tooltip');
  if (!t) { tip.classList.add('hidden'); return; }
  const g = UI.game, T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y0 = g.tileYield(t, owner || UI.player);
  let html = `<b>${T.name}</b>`;
  if (t.river && !t.water) html += ' <span class="dim">· river</span>';
  if (t.coastal) html += ' <span class="dim">· coastal</span>';
  if (t.resource) { const r = RESOURCE_BY_ID[t.resource]; html += `<br>${r.icon} ${r.name} <span class="dim">(${CATEGORY_NAMES[r.cat].toLowerCase()})</span>`; }
  if (t.ruins) html += '<br>🏺 Ancient ruins <span class="dim">— claim to explore</span>';
  html += `<br>Yield ${yieldStr(y0)}`;
  if (t.improvement) html += ` <span class="dim">· ${IMPROVEMENTS[t.improvement].name.toLowerCase()}</span>`;
  if (t.settlement) html += `<br>🏘️ ${esc(t.settlement.name)} — ${SETTLEMENTS[t.settlement.type].name.toLowerCase()}, pop ${t.settlement.pop}${t.settlement.capital ? ', capital' : ''}${t.harbor ? ', harbour' : ''}`;
  if (t.castle) html += '<br>🏰 Castle';
  if (owner) html += `<br><span style="color:${owner.color}">■</span> ${esc(owner.name)}${owner === UI.player && !g.isWorked(t, owner) ? ' <span class="dim">— idle, no settlement nearby</span>' : ''}`;
  else if (!t.water || t.terrain !== 'ocean') html += '<br><span class="dim">Unclaimed</span>';
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const wrap = $('map-wrap').getBoundingClientRect();
  tip.style.left = Math.min(wrap.width - tip.offsetWidth - 8, x + 16) + 'px';
  tip.style.top = Math.min(wrap.height - tip.offsetHeight - 8, y + 16) + 'px';
}

let toastTimer = null;
function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg; el.classList.toggle('bad', bad); el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ---------------- Selection & tile panel ----------------
function selectTile(t) {
  if (t && t !== UI.renderer.selected) Sound.play('select');
  UI.renderer.selected = t;
  UI.needsDraw = true;
  renderTilePanel();
}

const GROUPS = [
  { title: 'Territory', ids: ['expand', 'conquer'] },
  { title: 'Settlement', ids: ['village', 'upgrade', 'harbor'] },
  { title: 'Improve this tile', ids: ['farm', 'mine', 'lumber', 'pasture', 'fishery'] },
  { title: 'Build', ids: ['road', 'castle'] },
];

function renderTilePanel() {
  const panel = $('tile-panel');
  const t = UI.renderer.selected;
  const g = UI.game, p = UI.player;
  if (!t) {
    panel.innerHTML = `<h3 class="engraved">Selected tile</h3><div class="empty">Click any tile to inspect it and see what you can do there — or use a quick action above to light up every valid tile.</div>`;
    return;
  }
  const T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y = g.tileYield(t, owner || p);
  const mine = owner === p;
  let html = `<h3 class="engraved">Selected tile</h3>
    <div class="tile-head"><span class="tile-name">${esc(T.name)}</span><span class="tile-coords">${t.x}, ${t.y}</span></div>`;
  html += `<div class="tile-owner">${owner ? `<span class="swatch" style="background:${owner.color}"></span> ${esc(owner.name)}${mine ? ' <b>(yours)</b>' : ''}` : '<i>Unclaimed land</i>'}</div>`;
  const tags = [];
  if (t.river && !t.water) tags.push('<span class="tag">River</span>');
  if (t.coastal) tags.push('<span class="tag">Coastal</span>');
  if (t.road) tags.push('<span class="tag">Road</span>');
  if (t.castle) tags.push('<span class="tag">🏰 Castle</span>');
  if (t.harbor) tags.push('<span class="tag">⚓ Harbour</span>');
  if (mine) tags.push(g.isWorked(t, p) ? '<span class="tag good">Worked</span>' : '<span class="tag warn">Idle — no settlement within 2</span>');
  if (t.ruins) tags.push('<span class="tag gold">🏺 Ancient ruins — claim to explore</span>');
  if (owner && !mine) tags.push(g.atWar(p, owner) ? '<span class="tag warn">⚔️ At war</span>' : '<span class="tag">At peace</span>');
  if (t.conqueredTurn && g.turn - t.conqueredTurn < 6) tags.push('<span class="tag">Garrisoned (+3 defence)</span>');
  if (tags.length) html += `<div class="tags">${tags.join('')}</div>`;
  html += '<div class="kv">';
  html += `<span>Yield</span><span class="yield">${yieldStr(y)}${mine && !g.isWorked(t, p) ? ' <span class="note">(not collected)</span>' : ''}</span>`;
  if (t.resource) {
    const r = RESOURCE_BY_ID[t.resource];
    const unlocked = t.improvement === r.imp;
    html += `<span>Resource</span><span>${r.icon} <b>${r.name}</b> — ${unlocked ? 'fully worked' : `full yield ${yieldStr(r.yield)} with a ${IMPROVEMENTS[r.imp].name.toLowerCase()}`}</span>`;
  }
  if (t.improvement) html += `<span>Improved</span><span>${IMPROVEMENTS[t.improvement].icon} ${IMPROVEMENTS[t.improvement].name}</span>`;
  if (t.settlement) {
    const S = SETTLEMENTS[t.settlement.type];
    html += `<span>Settlement</span><span>🏘️ <b>${esc(t.settlement.name)}</b>, ${S.name.toLowerCase()}${t.settlement.capital ? ' &amp; capital' : ''}<br>Population ${t.settlement.pop} / ${S.maxPop}${S.next ? ` — ${SETTLEMENTS[S.next].name.toLowerCase()} at ${S.upgradePop}` : ''}</span>`;
  }
  if (owner && !mine) html += `<span>Defence</span><span>${g.defenseAt(owner, t).toFixed(1)} <span class="note">vs your attack ${g.attackStrength(p)}</span></span>`;
  html += '</div>';

  let any = false;
  for (const grp of GROUPS) {
    let items = '';
    for (const id of grp.ids) {
      const c = g.checkAction(p, id, t);
      if (!c.ok && isIrrelevant(id, t)) continue;
      any = true;
      let sub = c.why ? `<span class="sub${c.ok ? '' : ' neg'}">${esc(c.why)}</span>` : '';
      if (IMPROVEMENTS[id] && c.ok) {
        const prev = t.improvement; t.improvement = id; const after = g.tileYield(t, p); t.improvement = prev;
        sub = `<span class="sub">Yield becomes ${yieldStr(after)}${c.why ? ' · ' + esc(c.why) : ''}</span>`;
      }
      items += `<button class="action${id === 'conquer' ? ' danger' : ''}${['village', 'upgrade'].includes(id) && c.ok ? ' gold' : ''}" data-action="${id}" ${c.ok ? '' : 'disabled'}>
        <span class="al">${esc(c.label)}</span><span class="cost">${costHtml(c.cost)}</span>${sub}</button>`;
    }
    if (items) html += `<div class="group-title">${grp.title}</div><div class="actions">${items}</div>`;
  }
  if (!any) html += '<div class="empty" style="margin-top:8px">Nothing can be done here this turn.</div>';
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-action]')) b.onclick = () => playerAction(b.dataset.action, t);
}

// Hide disabled actions that make no sense for the tile at all (keep the ones that fail only on cost/requirements).
function isIrrelevant(id, t) {
  const p = UI.player, g = UI.game;
  const mine = t.owner === p.id;
  const enemy = t.owner !== null && !mine;
  switch (id) {
    case 'expand': return t.owner !== null || t.terrain === 'ocean' || !g.isFrontier(p, t);
    case 'conquer': return !enemy || !g.isFrontier(p, t);
    case 'village': return t.water || t.terrain === 'mountains' || !!t.settlement || (!mine && !(t.owner === null && g.isFrontier(p, t)));
    case 'upgrade': return !t.settlement || !mine || !SETTLEMENTS[t.settlement.type].next;
    case 'harbor': return !t.settlement || !mine || !t.coastal || t.harbor;
    case 'castle': return !mine || t.water || t.terrain === 'mountains' || !!t.settlement || t.castle;
    case 'road': return !mine || t.water || t.terrain === 'mountains' || t.road || !!t.settlement;
    default: return !mine || !g.improvementAllowed(t, id) || t.improvement === id;
  }
}

// ---------------- Turn flow ----------------
function playerAction(id, tile, target) {
  if (UI.busy || !UI.game) return;
  const g = UI.game, p = UI.player;
  if (g.over && !g.continued) { $('gameover').classList.remove('hidden'); return; }
  if (!p.alive) { toast('Your nation has fallen.', true); return; }
  const seqBefore = g.logSeq || 0;
  const res = g.doAction(p, id, tile, target);
  if (!res.ok) { toast(res.why, true); Sound.play('error'); return; }
  const snd = ACTION_SOUNDS[id];
  if (snd) Sound.play(snd);
  setMode(null);
  if (UI.turnLogStart === undefined) UI.turnLogStart = seqBefore; // first action of this turn
  if (p.ap > 0 && !g.over) {
    // Actions remain: stay in the player's turn.
    toast(`${res.msg.charAt(0).toUpperCase() + res.msg.slice(1)}  —  ${p.ap} action${p.ap === 1 ? '' : 's'} left.`);
    refreshAll();
    return;
  }
  UI.busy = true;
  const logStart = UI.turnLogStart;
  UI.turnLogStart = undefined;
  const before = { tiles: p.owned.size };
  g.runAITurns();
  g.endTurn();
  UI.busy = false;
  buildReport(logStart, before);
  if (UI.drawerTab !== 'report') { UI.drawerTab = 'report'; store('drawer.tab', 'report'); }
  refreshAll();
  // turn-end sounds: a soft chime, then a warning or event note if something happened to you
  if (!g.over) {
    Sound.play('turn');
    if (UI.report.some(e => e.kind === 'bad')) setTimeout(() => Sound.play('bad'), 350);
    else if (UI.report.some(e => e.kind === 'event')) setTimeout(() => Sound.play('event'), 350);
    setTimeout(() => Sound.play('draw'), 700);
  }
  if (g.over && !g.continued) showGameOver();
}

function playCardUI(id) {
  const g = UI.game, p = UI.player;
  const r = g.playCard(p, id);
  if (!r.ok) { toast(r.why, true); Sound.play('error'); return; }
  Sound.play('card');
  toast(`${p.name} ${r.msg}`);
  if (UI.turnLogStart === undefined) UI.turnLogStart = (g.logSeq || 0) - 1;
  refreshAll();
}

function buildReport(logStart, before) {
  const g = UI.game, p = UI.player;
  const ev = [];
  const inc = p.income;
  ev.push({ kind: 'gold', msg: `Income: ${fmtDelta(inc.gold)} gold, ${fmtDelta(inc.mat)} materials, food ${fmtDelta(inc.net)} after feeding ${inc.pop} people.` });
  const tilesNow = p.owned.size;
  for (const e of g.logSince(logStart)) {
    const m = e.msg;
    const aboutMe = e.nation === p.id || m.includes(p.name);
    if (!aboutMe) continue;
    let kind = 'neutral';
    if (/^Event:/.test(m)) kind = 'event';
    else if (/declares war on/.test(m)) kind = m.startsWith(p.name) ? 'neutral' : 'bad';
    else if (/conquers|seizes|fallen/.test(m)) kind = m.startsWith(p.name) ? 'good' : 'bad';
    else if (/Famine|Plague|Bandits/.test(m)) kind = 'bad';
    else if (/grows|borders|ruins|peace/.test(m)) kind = 'good';
    else if (/trade route|Plunder/.test(m)) kind = 'gold';
    ev.push({ kind, msg: m });
  }
  for (const id of p.peaceOffers) ev.push({ kind: 'gold', msg: `${g.nation(id).name} offers peace — accept it for free in the Other nations panel.` });
  const gained = tilesNow - before.tiles;
  if (gained > 0 && !ev.some(e => /borders/.test(e.msg))) ev.push({ kind: 'good', msg: `Your territory grew by ${gained} tile${gained === 1 ? '' : 's'}.` });
  // Hostile neighbours warning
  for (const o of g.nations) {
    if (o === p || !o.alive) continue;
    if (g.atWar(p, o)) ev.push({ kind: 'bad', msg: `At war with ${o.name} (their attack ${g.attackStrength(o)}, yours ${g.attackStrength(p)}).` });
    else if (g.rel(p, o) < -40 && g.bordersNation(p, o)) ev.push({ kind: 'bad', msg: `${o.name} is hostile and shares your border — they may declare war.` });
  }
  UI.report = ev;
}

// ---------------- Panels ----------------
function refreshAll() {
  renderTopbar();
  renderTurnPanel();
  renderTilePanel();
  renderReport();
  renderNationPanel();
  renderEdictPanel();
  renderDiploPanel();
  renderLog();
  UI.needsDraw = true;
}

function renderTopbar() {
  const g = UI.game, p = UI.player;
  const inc = p.income || g.computeIncome(p);
  $('turn-info').textContent = `${Math.min(g.turn, g.maxTurns)} / ${g.maxTurns}`;
  const need = g.growthNeed(inc.pop);
  $('resbar').innerHTML = `
    <div class="res-pill" title="Gold pays for expansion, trade, conquest and upkeep. Income ${inc.goldGross}, upkeep ${inc.goldUp}."><span class="icon">🪙</span><div><div class="lbl">Gold</div><div class="num">${Math.floor(p.gold)} <span class="dlt">${fmtDelta(inc.gold)}</span></div></div></div>
    <div class="res-pill" title="Materials build improvements, roads, settlements and castles. Income ${inc.matGross}, upkeep ${inc.matUp}."><span class="icon">🪵</span><div><div class="lbl">Materials</div><div class="num">${Math.floor(p.mat)} <span class="dlt">${fmtDelta(inc.mat)}</span></div></div></div>
    <div class="res-pill" title="Food ${inc.food} produced, ${inc.pop} eaten by population. Surplus fills the growth bar (${Math.floor(p.growth)} / ${need}); shortfall causes famine."><span class="icon">🌾</span><div><div class="lbl">Food surplus</div><div class="num">${fmtDelta(inc.net)}</div></div></div>
    <div class="res-pill" title="Total population across your settlements. Growth ${Math.floor(p.growth)} / ${need}."><span class="icon">👥</span><div><div class="lbl">People</div><div class="num">${inc.pop}</div></div></div>
    <div class="res-pill" title="Score: territory, settlements, population, castles, trade and gold."><span class="icon">🏛️</span><div><div class="lbl">Score</div><div class="num">${g.score(p)}</div></div></div>`;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('standings-sum').textContent = `Standings — you are #${ranked.indexOf(p) + 1} of ${ranked.length}`;
  $('ranking').innerHTML = ranked.map((n, i) => `<div class="rank-row${n.isPlayer ? ' me' : ''}${n.alive ? '' : ' dead'}" title="${esc(n.name)} — ${esc(n.leader.name)}">
    <span>${i + 1}</span>${flagImg(n, 'tiny')}<span>${esc(n.colorName)}${n.isPlayer ? ' · you' : (n.alive && g.atWar(p, n) ? ' <span class="war">⚔️ war</span>' : '')}</span><span class="sc">${g.score(n)}</span></div>`).join('');
}

function renderTurnPanel() {
  const g = UI.game, p = UI.player;
  const title = $('turn-title'), sub = $('turn-sub'), ap = $('ap-info'), wait = $('btn-wait');
  const pips = '●'.repeat(p.ap) + '○'.repeat(Math.max(0, p.apMax - p.ap));
  ap.innerHTML = `<span class="pips">${pips}</span> ${p.ap} of ${p.apMax} action${p.apMax === 1 ? '' : 's'}`;
  if (g.over && !g.continued) { title.textContent = 'Game over'; title.classList.add('done'); sub.textContent = g.reason; }
  else if (!p.alive) { title.textContent = 'Fallen'; title.classList.add('done'); sub.textContent = 'Your nation is no more.'; }
  else {
    title.textContent = 'Your move'; title.classList.remove('done');
    sub.textContent = p.apMax > 1
      ? `You have ${p.apMax} actions this turn (1 + one per two cities). When they are spent, every rival moves.`
      : 'Choose an action. Then every rival nation makes its move. More cities grant more actions per turn.';
  }
  wait.textContent = p.ap < p.apMax ? '⏳  End turn' : '⏳  End turn & save resources';
  renderHand();
  renderQuickActions();
}

function renderHand() {
  const g = UI.game, p = UI.player;
  const hand = $('hand'), note = $('hand-note');
  const played = p.cardPlayed;
  note.textContent = played ? `Played ${CARDS[played].name} — the rest are discarded at end of turn.` : 'Play one for free this turn.';
  const cards = played ? [played, ...p.hand] : p.hand;
  hand.innerHTML = cards.map(id => {
    const c = CARDS[id];
    const affine = c.nation.includes(p.trait) || c.leader.includes(p.leader.trait);
    const state = id === played ? ' played' : played ? ' spent' : '';
    return `<div class="card${state}${affine ? ' affine' : ''}" data-card="${id}" title="${esc(c.desc)}${affine ? ' (favoured by your traits)' : ''}">
      <span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}</span><span class="cd">${esc(c.desc)}</span>
      <span class="ck">${c.kind === 'now' ? 'immediate' : 'this turn'}</span>${id === played ? '<span class="cb">✓ played</span>' : !played ? '<span class="cb">Play</span>' : ''}</div>`;
  }).join('') || '<div class="empty">No cards this turn.</div>';
  if (!played) for (const el of hand.querySelectorAll('.card')) el.onclick = () => playCardUI(el.dataset.card);
}

const flagImg = (n, cls = '') => n.flagURL ? `<img class="flag ${cls}" src="${n.flagURL}" alt="">` : `<span class="swatch" style="background:${n.color}"></span>`;

function renderReport() {
  $('report').innerHTML = UI.report.length
    ? UI.report.map(e => `<div class="ev ${e.kind}">${e.kind === 'gold' && e.msg.startsWith('Income') ? e.msg : esc(e.msg)}</div>`).join('')
    : '<div class="empty">Nothing yet.</div>';
  renderDrawer();
}

function renderNationPanel() {
  const p = UI.player, g = UI.game;
  const inc = p.income || g.computeIncome(p);
  const T = NATION_TRAITS[p.trait], L = LEADER_TRAITS[p.leader.trait];
  const need = g.growthNeed(inc.pop);
  const pct = Math.min(100, Math.round((p.growth / need) * 100));
  $('nation-sum').textContent = `${T.name} · ${L.name} · score ${g.score(p)}`;
  $('nation-body').innerHTML = `
    <div class="nation-head">${flagImg(p, 'big')}
      <div><div class="nation-name">${esc(p.name)}</div><div class="nation-leader">${esc(p.leader.name)} · ${p.colorName} nation${p.alive ? '' : ' · <span class="neg">fallen</span>'}</div></div></div>
    <div class="trait"><b>${T.name}</b> — ${T.desc}</div>
    <div class="trait"><b>${L.name} leader</b> — ${L.desc}</div>
    <div class="stats" style="margin-top:10px">
      <span>Growth</span><span>${Math.floor(p.growth)} / ${need} <span class="note">next citizen</span><div class="bar"><div style="width:${pct}%"></div></div></span>
      <span>Territory</span><span>${p.owned.size} tiles · ${Math.round(g.claimedShare(p) * 100)}% of all claimed land</span>
      <span>Settlements</span><span>${p.settlements.length} of ${g.settlementCap(p)} allowed · ${g.workedTiles(p).size} worked tiles<br><span class="note">Towns raise the limit by 1, cities by 2.</span></span>
      <span>Castles</span><span>${p.castles.length} · attack ${g.attackStrength(p)}</span>
      <span>Trade</span><span>${p.trades.size} route${p.trades.size === 1 ? '' : 's'}</span>
    </div>`;
}

function renderEdictPanel() {
  const p = UI.player, g = UI.game;
  $('edict-sum').textContent = p.edict ? `${EDICTS[p.edict].icon} ${EDICTS[p.edict].name} · ${Math.max(0, p.edictUntil - g.turn)} turns` : 'none in force';
  let html = '';
  if (p.edict) {
    const E = EDICTS[p.edict];
    html += `<div class="edict-now">${E.icon} <b>${E.name}</b> in force for ${Math.max(0, p.edictUntil - g.turn)} more turn${p.edictUntil - g.turn === 1 ? '' : 's'}: ${E.desc}</div>`;
  } else html += '<div class="note">No edict in force. Proclaiming one takes an action and lasts 12 turns.</div>';
  html += '<div class="edicts">';
  for (const id in EDICTS) {
    const E = EDICTS[id];
    const c = g.checkAction(p, 'edict', null, id);
    html += `<button class="action edict${p.edict === id ? ' gold' : ''}" data-edict="${id}" ${c.ok ? '' : 'disabled'} title="${esc(E.desc + (c.why ? ' ' + c.why : ''))}">
      <span class="al">${E.icon} ${E.name}</span><span class="cost">${p.edict === id ? 'active' : costHtml(c.cost)}</span><span class="sub">${E.desc}</span></button>`;
  }
  html += '</div>';
  const panel = $('edict-body');
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-edict]')) b.onclick = () => playerAction('edict', null, b.dataset.edict);
}

function renderDiploPanel() {
  const p = UI.player, g = UI.game;
  const wars = g.enemies(p).length, offers = p.peaceOffers.size;
  $('diplo-sum').textContent = wars ? `⚔️ at war with ${wars}${offers ? ` · ${offers} peace offer${offers === 1 ? '' : 's'}` : ''}` : `${p.trades.size} trade route${p.trades.size === 1 ? '' : 's'} · at peace`;
  let html = '';
  for (const n of g.nations) {
    if (n === p) continue;
    const T = NATION_TRAITS[n.trait], L = LEADER_TRAITS[n.leader.trait];
    const rel = g.rel(p, n), relL = g.relLabel(rel);
    const trading = p.trades.has(n.id);
    const war = g.atWar(p, n), truce = g.truceActive(p, n);
    const borders = n.alive && g.bordersNation(p, n);
    let status = war ? '<span class="war-tag">⚔️ At war</span>' : truce ? `<span class="truce-tag">🕊️ Truce until turn ${g.truces[g.warKey(p, n)]}</span>` : '<span class="status">At peace</span>';
    if (p.peaceOffers.has(n.id)) status += ' · <b>they offer peace</b>';
    let btns = '';
    if (n.alive) {
      const ct = g.checkAction(p, 'trade', null, n.id);
      if (!trading && !war) btns += `<button class="small" data-act="trade" data-n="${n.id}" ${ct.ok ? '' : 'disabled'} title="${esc(ct.why || 'Open a trade route')}">🤝 Trade 🪙${ct.cost.gold}</button>`;
      if (war) {
        const cp = g.checkAction(p, 'peace', null, n.id);
        const accept = p.peaceOffers.has(n.id);
        btns += `<button class="small${accept ? ' gold' : ''}" data-act="peace" data-n="${n.id}" ${cp.ok ? '' : 'disabled'} title="${esc(cp.why || '')}">🕊️ ${accept ? 'Accept peace (free)' : `Offer peace 🪙${cp.cost.gold || 0}`}</button>`;
      } else {
        const cw = g.checkAction(p, 'declare_war', null, n.id);
        btns += `<button class="small danger" data-act="declare_war" data-n="${n.id}" ${cw.ok ? '' : 'disabled'} title="${esc(cw.why || 'Declare war (takes an action)')}">⚔️ Declare war</button>`;
      }
    }
    html += `<div class="nation-row${n.alive ? '' : ' dead'}">
      <span class="swatch" style="background:${n.color}"></span>
      <div><div class="nm">${flagImg(n)} ${esc(n.name)} <span class="note">· ${n.colorName}</span></div>
        <div class="sub">${esc(n.leader.name)} — ${T.name}, ${L.name}${n.edict ? ` · ${EDICTS[n.edict].icon} ${EDICTS[n.edict].name}` : ''}</div>
        <div class="sub">${n.alive ? `${n.owned.size} tiles · ${n.settlements.length} settlements · attack ${g.attackStrength(n)} · score ${g.score(n)}` : 'This nation has fallen.'}</div>
        <div class="sub">${status} · <span class="rel-${relL}">${relL}</span> (${Math.round(rel)})${borders ? ' · shares your border' : ''}${trading ? ` · 🤝 trading, +${g.tradeIncome(p, n)} gold/turn` : ''}</div>
        <div class="sub">Last move: ${esc(n.lastAction)}</div>
        <div class="btns">${btns}</div>
      </div>
    </div>`;
  }
  const panel = $('diplo-body');
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-act]')) b.onclick = () => {
    const id = b.dataset.act, target = parseInt(b.dataset.n, 10);
    if (id === 'declare_war' && !confirm(`Declare war on ${g.nation(target).name}? Trade with them ends and relations sour.`)) return;
    playerAction(id, null, target);
  };
}

function renderLog() {
  const g = UI.game, p = UI.player;
  $('log').innerHTML = g.log.slice(-80).map(e => {
    const war = /conquer|seizes|fallen|Famine|declares war/.test(e.msg);
    const event = /^Event:/.test(e.msg);
    return `<div class="entry${e.nation === p.id ? ' mine' : ''}${war ? ' war' : ''}${event ? ' event' : ''}"><span class="t">T${e.turn}</span>${esc(e.msg)}</div>`;
  }).join('');
}

function showGameOver() {
  const g = UI.game, p = UI.player;
  $('go-title').textContent = g.winner === p ? '🏆 Victory' : `${g.winner.name} prevails`;
  $('go-reason').textContent = g.reason;
  Sound.play(g.winner === p ? 'win' : 'lose');
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('go-table').innerHTML = '<tr><th>#</th><th>Nation</th><th>Leader</th><th>Tiles</th><th>Settlements</th><th>People</th><th>Score</th></tr>' +
    ranked.map((n, i) => `<tr class="${n === p ? 'me' : ''}"><td>${i + 1}</td><td>${flagImg(n)} ${esc(n.name)}${n.alive ? '' : ' (fallen)'}</td><td>${esc(n.leader.name)}</td><td>${n.owned.size}</td><td>${n.settlements.length}</td><td>${g.totalPop(n)}</td><td>${g.score(n)}</td></tr>`).join('');
  $('gameover').classList.remove('hidden');
}
