// UI: setup screen, card tray, targeting, HUD panels, map interaction, tooltips, game-over screen.

const UI = {
  game: null, renderer: null, player: null,
  selectedColor: 'crimson',
  needsDraw: true,
  busy: false,
  mode: null,          // active targeting action id (from a card being played) or null
  modeCard: -1,        // hand index of the card being played
  selCard: -1,         // hand index of the card selected in the tray
  report: [],          // events since the player's last move
  newIds: new Set(),   // card ids drawn this turn (for the "new" ribbon)
  turnLogStart: undefined,
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
  if (c && c.mat) parts.push(`🪵${c.mat}`);
  if (c && c.gold) parts.push(`🪙${c.gold}`);
  return parts.join(' ') || 'free';
};
const flagImg = (n, cls = '') => n.flagURL ? `<img class="flag ${cls}" src="${n.flagURL}" alt="">` : `<span class="swatch" style="background:${n.color}"></span>`;
const ACTION_SOUNDS = { expand: 'expand', village: 'village', upgrade: 'upgrade', farm: 'build', mine: 'build', lumber: 'build', pasture: 'build', fishery: 'build', road: 'build', harbor: 'build', castle: 'castle', trade: 'trade', declare_war: 'war', conquer: 'conquer', peace: 'peace', edict: 'edict' };

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
  $('btn-reflag-setup').onclick = () => { UI.setupFlagSeed = (UI.setupFlagSeed || 0) + 1; updateTraitPreview(); };
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
  const fp = $('flag-preview');
  fp.innerHTML = '';
  fp.appendChild(makeFlag({ name: $('in-nation').value.trim() || 'My Nation', colorId: c.id, color: c.hex, flagSeed: UI.setupFlagSeed || 0 }));
}

function startGame() {
  const size = MAP_SIZES[$('in-size').value];
  const seedIn = $('in-seed').value.trim();
  const seed = seedIn || Math.floor(Math.random() * 1e9).toString(36);
  const rng = new RNG(seed + ':leader');
  const ltrait = $('in-ltrait').value || rng.pick(Object.keys(LEADER_TRAITS));
  const map = generateMap({ width: size.w, height: size.h, seed, type: $('in-type').value });
  const game = new Game(map, {
    player: { name: $('in-nation').value.trim() || 'My Nation', leaderName: $('in-leader').value.trim() || 'The Leader', colorId: UI.selectedColor, leaderTrait: ltrait },
    aiCount: parseInt($('in-ai').value, 10),
    maxTurns: Math.max(30, Math.min(500, parseInt($('in-turns').value, 10) || 150)),
  });
  UI.game = game;
  UI.player = game.nations[0];
  UI.player.flagSeed = UI.setupFlagSeed || 0;
  UI.mode = null; UI.modeCard = -1; UI.selCard = -1; UI.turnLogStart = undefined;
  for (const n of game.nations) makeFlag(n);
  UI.newIds = new Set(UI.player.newCards || []);
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

function initLegend() {
  for (const el of document.querySelectorAll('#legend-grid [data-sprite]')) {
    el.innerHTML = '';
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const name = el.dataset.sprite;
    const tint = ['village', 'town', 'city', 'castle'].includes(name) ? UI.player.color : '';
    c.getContext('2d').drawImage(UI.renderer.sprites.get(name, tint), 0, 0, 40, 40);
    el.appendChild(c);
  }
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
    else if (k === ' ') { e.preventDefault(); endTurn(); return; }
    else if (k === 'escape') { if (UI.mode) setMode(null); else if (!$('picker').classList.contains('hidden')) closePicker(); else if (UI.selCard >= 0) selectCard(-1); else selectTile(null); return; }
    else if (k === 'c') { centerOnHome(); return; }
    else if (k === 'g') { R().showGrid = !R().showGrid; }
    else if (k === 'l') { $('legend').classList.toggle('hidden'); return; }
    else if (k === 'h') { $('help').classList.toggle('hidden'); return; }
    else if (k === 'm') { $('btn-mute').click(); return; }
    else if (k >= '1' && k <= '6') { const i = parseInt(k, 10) - 1; if (i < UI.player.hand.length) selectCard(i); return; }
    else return;
    R().clampCamera(); UI.needsDraw = true;
  });
}

function mapClick(t) {
  if (!t) return;
  if (UI.mode) {
    if (UI.renderer.highlight && UI.renderer.highlight.has(t.i)) {
      const idx = UI.modeCard;
      setMode(null);
      selectTile(t);
      playCardFlow(idx, t, null);
    } else toast('Not a valid target — click a highlighted tile, or press Esc to keep the card.', true);
    return;
  }
  selectTile(t);
}

// ---------------- Targeting ----------------
function validTargets(action) {
  const g = UI.game, p = UI.player, set = new Set();
  const cands = Array.from(p.owned, i => g.tiles[i]);
  if (['expand', 'conquer', 'village'].includes(action)) {
    const seen = new Set(p.owned);
    for (const i of p.owned) for (const nb of g.neighbors(g.tiles[i])) if (!seen.has(nb.i)) { seen.add(nb.i); cands.push(nb); }
  }
  for (const t of cands) if (g.checkAction(p, action, t).ok) set.add(t.i);
  return set;
}

function setMode(action, cardIdx = -1) {
  UI.mode = action; UI.modeCard = cardIdx;
  const canvas = $('map'), banner = $('mode-banner');
  if (!action) {
    UI.renderer.highlight = null;
    canvas.classList.remove('targeting');
    banner.classList.add('hidden');
  } else {
    const c = CARDS[UI.player.hand[cardIdx]];
    UI.renderer.highlight = validTargets(action);
    canvas.classList.add('targeting');
    banner.innerHTML = `${c.icon} ${esc(c.name.toUpperCase())} — click a highlighted tile<span class="cancel">Esc to keep the card</span>`;
    banner.classList.remove('hidden');
  }
  renderTray();
  UI.needsDraw = true;
}

// ---------------- Cards ----------------
function selectCard(idx) {
  if (UI.mode) setMode(null);
  UI.selCard = idx === UI.selCard ? -1 : idx;
  if (UI.selCard >= 0) Sound.play('select');
  renderTray();
}

// Start playing the card at hand index idx: instant, tile targeting, or a chooser for nations / edicts.
function beginPlay(idx) {
  const g = UI.game, p = UI.player;
  const id = p.hand[idx];
  if (!id) return;
  const c = CARDS[id];
  if (g.over && !g.continued) { $('gameover').classList.remove('hidden'); return; }
  if (!c.action) { playCardFlow(idx, null, null); return; }
  if (p.ap <= 0) { toast('No actions left this turn — end your turn first (Space).', true); Sound.play('error'); return; }
  if (c.target === 'tile') {
    const targets = validTargets(c.action);
    if (!targets.size) { toast(noTargetReason(c.action), true); Sound.play('error'); return; }
    UI.selCard = idx;
    setMode(c.action, idx);
  } else openPicker(idx);
}

function noTargetReason(action) {
  const g = UI.game, p = UI.player;
  switch (action) {
    case 'conquer': return g.enemies(p).length ? 'No enemy border tile can be taken right now — check cost, attack and defence.' : 'You are not at war with anyone. Play Casus Belli first.';
    case 'village': return p.settlements.length >= g.settlementCap(p) ? `Settlement limit reached (${p.settlements.length}/${g.settlementCap(p)}) — raise a town or city first.` : 'No valid site (needs land 3 tiles from other settlements) or not enough resources.';
    case 'expand': return `No free tile can be claimed — expansion costs 🪙${g.expandCost(p).gold}.`;
    case 'upgrade': return 'No settlement has enough people to upgrade, or you cannot afford it.';
    case 'harbor': return 'No coastal settlement without a harbour, or not enough resources.';
    default: return 'No valid tile right now — check the cost and the tile requirements.';
  }
}

function playCardFlow(idx, tile, target) {
  const g = UI.game, p = UI.player;
  const id = p.hand[idx];
  if (!id) return;
  const c = CARDS[id];
  const seqBefore = g.logSeq || 0;
  const r = g.playCard(p, idx, tile, target);
  if (!r.ok) { toast(r.why, true); Sound.play('error'); return; }
  Sound.play(c.action ? (ACTION_SOUNDS[c.action] || 'build') : 'card');
  if (UI.turnLogStart === undefined) UI.turnLogStart = seqBefore;
  UI.selCard = -1;
  const left = p.ap;
  toast(`${c.icon} ${c.name}: ${r.msg.charAt(0).toUpperCase() + r.msg.slice(1)}${c.action ? `  —  ${left} action${left === 1 ? '' : 's'} left` : ''}`);
  refreshAll();
  if (g.over && !g.continued) showGameOver();
}

function discardCard(idx) {
  const p = UI.player;
  const r = UI.game.discardCard(p, idx);
  if (!r.ok) return;
  Sound.play('card');
  UI.selCard = -1;
  toast(`${CARDS[r.id].icon} ${CARDS[r.id].name} discarded — a new card arrives next turn.`);
  renderTray();
  renderTilePanel();
}

// Chooser for nation- and edict-targeted cards.
function openPicker(idx) {
  const g = UI.game, p = UI.player;
  const c = CARDS[p.hand[idx]];
  const picker = $('picker'), body = $('picker-body');
  $('picker-title').innerHTML = `${c.icon} ${esc(c.name)} — ${c.target === 'edict' ? 'choose an edict' : 'choose a nation'}`;
  let html = '';
  if (c.target === 'edict') {
    for (const id in EDICTS) {
      const E = EDICTS[id], chk = g.checkAction(p, 'edict', null, id);
      html += `<button class="action pick" data-target="${id}" ${chk.ok ? '' : 'disabled'}><span class="al">${E.icon} ${E.name}</span><span class="cost">${costHtml(chk.cost)}</span><span class="sub${chk.ok ? '' : ' neg'}">${esc(E.desc)}${chk.why ? ' · ' + esc(chk.why) : ''}</span></button>`;
    }
  } else {
    for (const n of g.nations) {
      if (n === p || !n.alive) continue;
      const chk = g.checkAction(p, c.action, null, n.id);
      const rel = g.rel(p, n), relL = g.relLabel(rel);
      html += `<button class="action pick" data-target="${n.id}" ${chk.ok ? '' : 'disabled'}><span class="al">${flagImg(n)} ${esc(n.name)}</span><span class="cost">${costHtml(chk.cost)}</span><span class="sub${chk.ok ? '' : ' neg'}"><span class="rel-${relL}">${relL}</span> (${Math.round(rel)}) · attack ${g.attackStrength(n)}${chk.why ? ' · ' + esc(chk.why) : ''}</span></button>`;
    }
  }
  body.innerHTML = html || '<div class="empty">No valid choice right now.</div>';
  for (const b of body.querySelectorAll('button[data-target]')) b.onclick = () => {
    const target = c.target === 'edict' ? b.dataset.target : parseInt(b.dataset.target, 10);
    if (c.action === 'declare_war' && !confirm(`Declare war on ${g.nation(target).name}? Trade with them ends and relations sour.`)) return;
    closePicker();
    playCardFlow(idx, null, target);
  };
  picker.classList.remove('hidden');
  $('picker-close').onclick = closePicker;
}
function closePicker() { $('picker').classList.add('hidden'); }

function renderTray() {
  const g = UI.game, p = UI.player;
  const hand = $('hand'), note = $('tray-note');
  note.innerHTML = `${p.hand.length} / ${HAND_MAX} cards · <b>${p.ap}</b> action${p.ap === 1 ? '' : 's'} left · click a card to play, keep or discard it`;
  hand.innerHTML = p.hand.map((id, i) => {
    const c = CARDS[id];
    const affine = c.nation.includes(p.trait) || c.leader.includes(p.leader.trait);
    const sel = i === UI.selCard;
    const playing = UI.mode && UI.modeCard === i;
    let cost = '';
    if (c.action) {
      const chk = c.target === 'tile' ? null : g.checkAction(p, c.action, null, c.target === 'edict' ? 'harvest' : undefined);
      if (c.action === 'expand') cost = `🪙${g.expandCost(p).gold}`;
      else if (c.action === 'village') cost = costHtml(g.scaleCost(COSTS.village, g.costMul(p, 'village')));
      else if (c.action === 'castle') cost = costHtml(g.scaleCost(COSTS.castle, g.costMul(p, 'castle')));
      else if (c.action === 'road') cost = costHtml(g.scaleCost(COSTS.road, g.costMul(p, 'road')));
      else if (c.action === 'harbor') cost = costHtml(g.scaleCost(COSTS.harbor, g.costMul(p, 'harbor')));
      else if (c.action === 'conquer') cost = costHtml(g.scaleCost(COSTS.conquer, g.costMul(p, 'conquer')));
      else if (IMPROVEMENTS[c.action]) cost = costHtml(g.scaleCost(IMPROVEMENTS[c.action].cost, g.costMul(p, 'improve')));
      else if (c.action === 'upgrade') cost = 'varies';
      else if (chk) cost = costHtml(chk.cost);
    }
    return `<div class="card${sel ? ' sel' : ''}${playing ? ' playing' : ''}${affine ? ' affine' : ''}${UI.newIds.has(id) ? ' new' : ''}${c.action ? '' : ' bonus'}" data-idx="${i}" title="${esc(c.desc)}${affine ? ' (favoured by your traits)' : ''}">
      <span class="ck">${c.action ? 'action' : 'bonus · free'}</span>
      <span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}</span><span class="cd">${esc(c.desc)}</span>
      ${cost ? `<span class="cc">${cost}</span>` : ''}
      ${sel ? `<div class="card-actions"><button class="btn small gold" data-play="${i}">${c.action ? (c.target === 'tile' ? 'Play — choose tile' : 'Play — choose') : 'Play now'}</button><button class="btn small" data-keep="${i}">Keep</button><button class="btn small" data-discard="${i}">Discard</button></div>` : ''}
    </div>`;
  }).join('') || '<div class="empty">Your hand is empty — new cards arrive next turn.</div>';
  for (const el of hand.querySelectorAll('.card')) el.onclick = e => { if (e.target.closest('button')) return; selectCard(parseInt(el.dataset.idx, 10)); };
  for (const b of hand.querySelectorAll('button[data-play]')) b.onclick = e => { e.stopPropagation(); beginPlay(parseInt(b.dataset.play, 10)); };
  for (const b of hand.querySelectorAll('button[data-keep]')) b.onclick = e => { e.stopPropagation(); selectCard(-1); };
  for (const b of hand.querySelectorAll('button[data-discard]')) b.onclick = e => { e.stopPropagation(); discardCard(parseInt(b.dataset.discard, 10)); };
}

// ---------------- Turn flow ----------------
function endTurn() {
  if (UI.busy || !UI.game) return;
  const g = UI.game, p = UI.player;
  if (g.over && !g.continued) { $('gameover').classList.remove('hidden'); return; }
  if (!p.alive) { toast('Your nation has fallen.', true); return; }
  setMode(null); closePicker();
  const seqBefore = g.logSeq || 0;
  if (p.ap >= p.apMax) g.doAction(p, 'wait'); else p.ap = 0;
  if (UI.turnLogStart === undefined) UI.turnLogStart = seqBefore;
  UI.busy = true;
  const logStart = UI.turnLogStart;
  UI.turnLogStart = undefined;
  const before = { tiles: p.owned.size };
  g.runAITurns();
  g.endTurn();
  UI.busy = false;
  UI.newIds = new Set(p.newCards || []);
  UI.selCard = -1;
  buildReport(logStart, before);
  refreshAll();
  if (!g.over) {
    Sound.play('turn');
    if (UI.report.some(e => e.kind === 'bad')) setTimeout(() => Sound.play('bad'), 350);
    else if (UI.report.some(e => e.kind === 'event')) setTimeout(() => Sound.play('event'), 350);
    if (UI.newIds.size) setTimeout(() => Sound.play('draw'), 700);
  }
  if (g.over && !g.continued) showGameOver();
}

// Accepting an offered peace is free and needs no card.
function acceptPeace(id) {
  const g = UI.game, p = UI.player;
  const r = g.doAction(p, 'peace', null, id);
  if (!r.ok) { toast(r.why, true); Sound.play('error'); return; }
  Sound.play('peace');
  toast(`${p.name} ${r.msg}`);
  refreshAll();
}

function buildReport(logStart, before) {
  const g = UI.game, p = UI.player;
  const ev = [];
  const inc = p.income;
  ev.push({ kind: 'gold', msg: `Income: ${fmtDelta(inc.gold)} gold, ${fmtDelta(inc.mat)} materials, food ${fmtDelta(inc.net)} after feeding ${inc.pop} people.` });
  for (const e of g.logSince(logStart)) {
    const m = e.msg;
    if (!(e.nation === p.id || m.includes(p.name))) continue;
    if (e.nation === p.id && /^.* plays /.test(m) === false && /waits and saves/.test(m)) continue;
    let kind = 'neutral';
    if (/^Event:/.test(m)) kind = 'event';
    else if (/declares war on/.test(m)) kind = m.startsWith(p.name) ? 'neutral' : 'bad';
    else if (/conquers|seizes|fallen/.test(m)) kind = m.startsWith(p.name) ? 'good' : 'bad';
    else if (/Famine|Plague|Bandits/.test(m)) kind = 'bad';
    else if (/grows|borders|ruins|peace/.test(m)) kind = 'good';
    else if (/trade route|Plunder/.test(m)) kind = 'gold';
    ev.push({ kind, msg: m });
  }
  for (const id of p.peaceOffers) ev.push({ kind: 'gold', msg: `${g.nation(id).name} offers peace — accept it for free in Other nations.` });
  const gained = p.owned.size - before.tiles;
  if (gained > 0 && !ev.some(e => /borders/.test(e.msg))) ev.push({ kind: 'good', msg: `Your territory grew by ${gained} tile${gained === 1 ? '' : 's'}.` });
  for (const o of g.nations) {
    if (o === p || !o.alive) continue;
    if (g.atWar(p, o)) ev.push({ kind: 'bad', msg: `At war with ${o.name} (their attack ${g.attackStrength(o)}, yours ${g.attackStrength(p)}).` });
    else if (g.rel(p, o) < -40 && g.bordersNation(p, o)) ev.push({ kind: 'bad', msg: `${o.name} is hostile and shares your border — they may declare war.` });
  }
  if (UI.newIds.size) ev.push({ kind: 'neutral', msg: `New cards: ${Array.from(UI.newIds).map(id => CARDS[id].icon + ' ' + CARDS[id].name).join(', ')}.` });
  UI.report = ev;
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
  else if (t.terrain !== 'ocean') html += '<br><span class="dim">Unclaimed</span>';
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
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------------- Selection & tile panel ----------------
function selectTile(t) {
  if (t && t !== UI.renderer.selected) Sound.play('select');
  UI.renderer.selected = t;
  UI.needsDraw = true;
  renderTilePanel();
}

function renderTilePanel() {
  const panel = $('tile-panel');
  const t = UI.renderer.selected;
  const g = UI.game, p = UI.player;
  if (!t) {
    panel.innerHTML = `<h3 class="engraved">Selected tile</h3><div class="empty">Click any tile to inspect it. Cards in your hand that can be played on it will be listed here.</div>`;
    return;
  }
  const T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y = g.tileYield(t, owner || p);
  const mine = owner === p;
  let html = `<h3 class="engraved">Selected tile</h3>
    <div class="tile-head"><span class="tile-name">${esc(T.name)}</span><span class="tile-coords">${t.x}, ${t.y}</span></div>`;
  html += `<div class="tile-owner">${owner ? `${flagImg(owner, 'tiny')} ${esc(owner.name)}${mine ? ' <b>(yours)</b>' : ''}` : '<i>Unclaimed land</i>'}</div>`;
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
    html += `<span>Resource</span><span>${r.icon} <b>${r.name}</b> — ${t.improvement === r.imp ? 'fully worked' : `full yield ${yieldStr(r.yield)} with a ${IMPROVEMENTS[r.imp].name.toLowerCase()}`}</span>`;
  }
  if (t.improvement) html += `<span>Improved</span><span>${IMPROVEMENTS[t.improvement].icon} ${IMPROVEMENTS[t.improvement].name}</span>`;
  if (t.settlement) {
    const S = SETTLEMENTS[t.settlement.type];
    html += `<span>Settlement</span><span>🏘️ <b>${esc(t.settlement.name)}</b>, ${S.name.toLowerCase()}${t.settlement.capital ? ' &amp; capital' : ''}<br>Population ${t.settlement.pop} / ${S.maxPop}${S.next ? ` — ${SETTLEMENTS[S.next].name.toLowerCase()} at ${S.upgradePop}` : ''}</span>`;
  }
  if (owner && !mine) html += `<span>Defence</span><span>${g.defenseAt(owner, t).toFixed(1)} <span class="note">vs your attack ${g.attackStrength(p)}</span></span>`;
  html += '</div>';

  // Cards in hand that target tiles, and whether they can be played here.
  let items = '';
  const seen = new Set();
  p.hand.forEach((id, idx) => {
    const c = CARDS[id];
    if (!c.action || c.target !== 'tile' || seen.has(id)) return;
    seen.add(id);
    const chk = g.checkAction(p, c.action, t);
    if (!chk.ok && isIrrelevant(c.action, t)) return;
    let sub = chk.why ? `<span class="sub${chk.ok ? '' : ' neg'}">${esc(chk.why)}</span>` : '';
    if (IMPROVEMENTS[c.action] && chk.ok) {
      const prev = t.improvement; t.improvement = c.action; const after = g.tileYield(t, p); t.improvement = prev;
      sub = `<span class="sub">Yield becomes ${yieldStr(after)}${chk.why ? ' · ' + esc(chk.why) : ''}</span>`;
    }
    items += `<button class="action${c.action === 'conquer' ? ' danger' : ''}" data-play="${idx}" ${chk.ok && p.ap > 0 ? '' : 'disabled'}><span class="al">${c.icon} ${esc(c.name)} — ${esc(chk.label)}</span><span class="cost">${costHtml(chk.cost)}</span>${sub}</button>`;
  });
  html += `<div class="group-title">Cards you can play here</div><div class="actions">${items || '<div class="empty">None of the cards in your hand apply to this tile.</div>'}</div>`;
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-play]')) b.onclick = () => playCardFlow(parseInt(b.dataset.play, 10), t, null);
}

// Hide disabled cards that make no sense for the tile at all (keep ones that fail only on cost/requirements).
function isIrrelevant(action, t) {
  const p = UI.player, g = UI.game;
  const mine = t.owner === p.id;
  const enemy = t.owner !== null && !mine;
  switch (action) {
    case 'expand': return t.owner !== null || t.terrain === 'ocean' || !g.isFrontier(p, t);
    case 'conquer': return !enemy || !g.isFrontier(p, t);
    case 'village': return t.water || t.terrain === 'mountains' || !!t.settlement || (!mine && !(t.owner === null && g.isFrontier(p, t)));
    case 'upgrade': return !t.settlement || !mine || !SETTLEMENTS[t.settlement.type].next;
    case 'harbor': return !t.settlement || !mine || !t.coastal || t.harbor;
    case 'castle': return !mine || t.water || t.terrain === 'mountains' || !!t.settlement || t.castle;
    case 'road': return !mine || t.water || t.terrain === 'mountains' || t.road || !!t.settlement;
    default: return !mine || !g.improvementAllowed(t, action) || t.improvement === action;
  }
}

// ---------------- Panels ----------------
function refreshAll() {
  renderTopbar();
  renderTray();
  renderTilePanel();
  renderReport();
  renderNationPanel();
  renderDiploPanel();
  renderLog();
  UI.needsDraw = true;
}

function renderTopbar() {
  const g = UI.game, p = UI.player;
  const inc = p.income || g.computeIncome(p);
  $('turn-info').textContent = `${Math.min(g.turn, g.maxTurns)} / ${g.maxTurns}`;
  $('ap-info').innerHTML = `<span class="pips">${'●'.repeat(p.ap)}${'○'.repeat(Math.max(0, p.apMax - p.ap))}</span>`;
  $('ap-info').title = `${p.ap} of ${p.apMax} actions left this turn (1 + one per two cities)`;
  const need = g.growthNeed(inc.pop);
  $('resbar').innerHTML = `
    <div class="res-pill" title="Gold pays for expansion, trade, war, edicts and upkeep. Income ${inc.goldGross}, upkeep ${inc.goldUp}."><span class="icon">🪙</span><div><div class="lbl">Gold</div><div class="num">${Math.floor(p.gold)} <span class="dlt">${fmtDelta(inc.gold)}</span></div></div></div>
    <div class="res-pill" title="Materials build improvements, roads, settlements and castles. Income ${inc.matGross}, upkeep ${inc.matUp}."><span class="icon">🪵</span><div><div class="lbl">Materials</div><div class="num">${Math.floor(p.mat)} <span class="dlt">${fmtDelta(inc.mat)}</span></div></div></div>
    <div class="res-pill" title="Food ${inc.food} produced, ${inc.pop} eaten. Surplus fills the growth bar (${Math.floor(p.growth)} / ${need}); shortfall causes famine."><span class="icon">🌾</span><div><div class="lbl">Food surplus</div><div class="num">${fmtDelta(inc.net)}</div></div></div>
    <div class="res-pill" title="Population across your settlements. Growth ${Math.floor(p.growth)} / ${need}."><span class="icon">👥</span><div><div class="lbl">People</div><div class="num">${inc.pop}</div></div></div>
    <div class="res-pill" title="Score: territory, settlements, population, castles, trade, relics and gold."><span class="icon">🏛️</span><div><div class="lbl">Score</div><div class="num">${g.score(p)}</div></div></div>`;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('standings-sum').textContent = `Standings — you are #${ranked.indexOf(p) + 1} of ${ranked.length}`;
  $('ranking').innerHTML = ranked.map((n, i) => `<div class="rank-row${n.isPlayer ? ' me' : ''}${n.alive ? '' : ' dead'}" title="${esc(n.name)} — ${esc(n.leader.name)}">
    <span>${i + 1}</span>${flagImg(n, 'tiny')}<span>${esc(n.colorName)}${n.isPlayer ? ' · you' : (n.alive && g.atWar(p, n) ? ' <span class="war">⚔️ war</span>' : '')}</span><span class="sc">${g.score(n)}</span></div>`).join('');
  const end = $('btn-end');
  end.textContent = p.ap > 0 ? `End turn ▸` : 'End turn ▸';
  end.classList.toggle('pulse', p.ap === 0 || !p.hand.some(id => CARDS[id].action));
}

function renderReport() {
  $('report').innerHTML = UI.report.length
    ? UI.report.map(e => `<div class="ev ${e.kind}">${e.kind === 'gold' && e.msg.startsWith('Income') ? e.msg : esc(e.msg)}</div>`).join('')
    : '<div class="empty">Nothing yet.</div>';
  const notable = UI.report.find(e => e.kind === 'bad') || UI.report.find(e => e.kind === 'event') || UI.report.find(e => e.kind === 'good');
  $('report-sum').textContent = notable ? notable.msg.replace(/<[^>]+>/g, '').slice(0, 48) + (notable.msg.length > 48 ? '…' : '') : `${UI.report.length} note${UI.report.length === 1 ? '' : 's'}`;
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
      <div><div class="nation-name">${esc(p.name)}</div><div class="nation-leader">${esc(p.leader.name)} · ${p.colorName} nation${p.alive ? '' : ' · <span class="neg">fallen</span>'}</div></div>
      <button id="btn-reflag" class="btn small" title="Draw a new flag design">↻ Flag</button></div>
    <div class="trait"><b>${T.name}</b> — ${T.desc}</div>
    <div class="trait"><b>${L.name} leader</b> — ${L.desc}</div>
    <div class="trait"><b>Edict</b> — ${p.edict ? `${EDICTS[p.edict].icon} ${EDICTS[p.edict].name}, ${Math.max(0, p.edictUntil - g.turn)} more turn${p.edictUntil - g.turn === 1 ? '' : 's'}: ${EDICTS[p.edict].desc}` : 'none in force. Play a Proclamation card to declare one.'}</div>
    <div class="stats" style="margin-top:10px">
      <span>Growth</span><span>${Math.floor(p.growth)} / ${need} <span class="note">next citizen</span><div class="bar"><div style="width:${pct}%"></div></div></span>
      <span>Territory</span><span>${p.owned.size} tiles · ${Math.round(g.claimedShare(p) * 100)}% of all claimed land</span>
      <span>Settlements</span><span>${p.settlements.length} of ${g.settlementCap(p)} allowed · ${g.workedTiles(p).size} worked tiles<br><span class="note">Towns raise the limit by 1, cities by 2.</span></span>
      <span>Castles</span><span>${p.castles.length} · attack ${g.attackStrength(p)}</span>
      <span>Trade</span><span>${p.trades.size} route${p.trades.size === 1 ? '' : 's'}</span>
      <span>Relics</span><span>${p.relics}</span>
    </div>`;
  $('btn-reflag').onclick = () => { p.flagSeed = (p.flagSeed || 0) + 1; makeFlag(p); initLegend(); Sound.play('card'); refreshAll(); };
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
    let btns = '';
    if (n.alive) {
      if (p.peaceOffers.has(n.id)) btns += `<button class="small gold" data-accept="${n.id}">🕊️ Accept peace (free)</button>`;
      const hint = [];
      const cardBtn = (action, label, cls = '') => {
        const idx = g.handIndexFor(p, action);
        if (idx < 0) { hint.push(label.replace(/^.*? /, '')); return; }
        const chk = g.checkAction(p, action, null, n.id);
        btns += `<button class="small${cls}" data-card="${idx}" data-n="${n.id}" ${chk.ok && p.ap > 0 ? '' : 'disabled'} title="${esc(chk.why || 'Play ' + CARDS[p.hand[idx]].name)}">${label}</button>`;
      };
      if (!trading && !war) cardBtn('trade', '🤝 Trade (Merchants)');
      if (war) cardBtn('peace', '🕊️ Offer peace (Treaty)');
      else cardBtn('declare_war', '⚔️ Declare war (Casus Belli)', ' danger');
      if (hint.length) btns += `<span class="note">Needs a card: ${hint.join(', ')}.</span>`;
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
  for (const b of panel.querySelectorAll('button[data-accept]')) b.onclick = () => acceptPeace(parseInt(b.dataset.accept, 10));
  for (const b of panel.querySelectorAll('button[data-card]')) b.onclick = () => {
    const idx = parseInt(b.dataset.card, 10), target = parseInt(b.dataset.n, 10);
    const c = CARDS[p.hand[idx]];
    if (c.action === 'declare_war' && !confirm(`Declare war on ${g.nation(target).name}? Trade with them ends and relations sour.`)) return;
    playCardFlow(idx, null, target);
  };
}

function renderLog() {
  const g = UI.game, p = UI.player;
  const entries = g.log.slice(-80);
  $('log-sum').textContent = entries.length ? `turn ${entries[entries.length - 1].turn}` : '';
  $('log').innerHTML = entries.map(e => {
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

// ---------------- Collapsible panels, sound ----------------
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
  initSound();
}

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
  const wake = () => { Sound.init(); Sound.resume(); };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake);
}
