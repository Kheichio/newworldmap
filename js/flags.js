// Procedural flags: a field in the nation's colour, a layout chosen from the nation's seed,
// and an emblem that reflects its national trait. Rendered once to a small canvas.

const FLAG_W = 72, FLAG_H = 48;

const FLAG_SECONDARY = ['#f4f1e6', '#d4af37', '#1b1e24', '#f4f1e6', '#d4af37'];
const FLAG_LAYOUTS = ['plain', 'bands', 'pale', 'cross', 'saltire', 'quartered', 'chevron', 'border', 'canton'];

function makeFlag(nation) {
  const c = document.createElement('canvas');
  c.width = FLAG_W; c.height = FLAG_H;
  const g = c.getContext('2d');
  // The design depends only on colour and the nation's own flag seed — renaming never changes a flag.
  const rng = new RNG(nation.colorId + '|flag|' + (nation.flagSeed || 0));
  const field = nation.color;
  const dark = isLight(field);
  // secondary colour must contrast with the field
  let second = rng.pick(FLAG_SECONDARY);
  if (dark && second === '#f4f1e6') second = '#1b1e24';
  if (!dark && second === '#1b1e24' && rng.chance(0.5)) second = '#f4f1e6';
  const layout = rng.pick(FLAG_LAYOUTS);
  const W = FLAG_W, H = FLAG_H;

  g.fillStyle = field; g.fillRect(0, 0, W, H);
  g.fillStyle = second;
  let ex = W / 2, ey = H / 2, es = H * 0.36; // emblem centre / size
  switch (layout) {
    case 'bands': g.fillRect(0, H / 3, W, H / 3); break;
    case 'pale': g.fillRect(W / 3, 0, W / 3, H); break;
    case 'cross': g.fillRect(W * 0.36, 0, W * 0.16, H); g.fillRect(0, H * 0.4, W, H * 0.2); es = H * 0.22; break;
    case 'saltire':
      g.lineWidth = H * 0.16; g.strokeStyle = second;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke(); es = H * 0.22; break;
    case 'quartered': g.fillRect(W / 2, 0, W / 2, H / 2); g.fillRect(0, H / 2, W / 2, H / 2); break;
    case 'chevron': g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.45, H / 2); g.lineTo(0, H); g.closePath(); g.fill(); ex = W * 0.68; break;
    case 'border': g.fillRect(0, 0, W, H); g.fillStyle = field; g.fillRect(W * 0.1, H * 0.14, W * 0.8, H * 0.72); es = H * 0.3; break;
    case 'canton': g.fillRect(0, 0, W * 0.45, H * 0.55); ex = W * 0.225; ey = H * 0.275; es = H * 0.2; break;
  }
  // emblem colour: contrast with whatever is under it
  const onSecond = ['bands', 'pale', 'cross', 'saltire', 'canton'].includes(layout);
  drawEmblem(g, NATION_COLORS.find(x => x.id === nation.colorId).trait, ex, ey, es, onSecond ? field : second, onSecond ? second : field);
  // wear: subtle horizontal weave
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 1; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, W - 1, H - 1);
  nation.flag = c;
  nation.flagURL = c.toDataURL ? c.toDataURL() : '';
  // second frame for the map: the fly half ripples (vertical slices shifted by a sine wave)
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g2 = c2.getContext('2d');
  for (let x = 0; x < W; x++) {
    const k = Math.max(0, (x - W * 0.35) / (W * 0.65));
    const dy = Math.round(Math.sin(x / W * Math.PI * 3) * 2.5 * k);
    g2.drawImage(c, x, 0, 1, H, x, dy, 1, H);
  }
  nation.flag2 = c2;
  return c;
}

function drawEmblem(g, trait, x, y, s, color, outline) {
  g.save();
  g.translate(x, y);
  g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.2; g.lineJoin = 'round';
  const fillStroke = () => { g.fill(); g.stroke(); };
  switch (trait) {
    case 'martial': // sword
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.18, -s * 0.75); g.lineTo(s * 0.18, s * 0.25); g.lineTo(0, s * 0.45); g.lineTo(-s * 0.18, s * 0.25); g.lineTo(-s * 0.18, -s * 0.75); g.closePath(); fillStroke();
      g.fillRect(-s * 0.55, s * 0.25, s * 1.1, s * 0.16); g.strokeRect(-s * 0.55, s * 0.25, s * 1.1, s * 0.16);
      g.fillRect(-s * 0.1, s * 0.41, s * 0.2, s * 0.5); g.strokeRect(-s * 0.1, s * 0.41, s * 0.2, s * 0.5);
      break;
    case 'maritime': // waves
      g.lineWidth = s * 0.22; g.strokeStyle = color; g.lineCap = 'round';
      for (const dy of [-s * 0.45, 0, s * 0.45]) {
        g.beginPath(); g.moveTo(-s, dy);
        g.quadraticCurveTo(-s * 0.5, dy - s * 0.4, 0, dy); g.quadraticCurveTo(s * 0.5, dy + s * 0.4, s, dy); g.stroke();
      }
      break;
    case 'agrarian': // wheat sheaf
      g.lineWidth = s * 0.14; g.strokeStyle = color; g.lineCap = 'round';
      for (const dx of [-s * 0.45, 0, s * 0.45]) { g.beginPath(); g.moveTo(dx, s); g.lineTo(dx * 0.4, -s * 0.2); g.stroke(); }
      for (const [dx, dy] of [[-s * 0.2, -s * 0.5], [0, -s * 0.85], [s * 0.2, -s * 0.5], [-s * 0.4, -s * 0.15], [s * 0.4, -s * 0.15]]) { g.beginPath(); g.ellipse(dx, dy, s * 0.16, s * 0.26, 0, 0, Math.PI * 2); g.fill(); }
      break;
    case 'mercantile': // coin / scales
      g.beginPath(); g.arc(0, 0, s * 0.9, 0, Math.PI * 2); fillStroke();
      g.fillStyle = outline; g.beginPath(); g.arc(0, 0, s * 0.55, 0, Math.PI * 2); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(0, 0, s * 0.28, 0, Math.PI * 2); g.fill();
      break;
    case 'scholarly': { // star
      g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.42 : s; const a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); fillStroke(); break;
    }
    case 'builders': // tower
      g.fillRect(-s * 0.45, -s * 0.5, s * 0.9, s * 1.5); g.strokeRect(-s * 0.45, -s * 0.5, s * 0.9, s * 1.5);
      for (const dx of [-0.45, -0.1, 0.25]) { g.fillRect(dx * s, -s * 0.8, s * 0.2, s * 0.32); g.strokeRect(dx * s, -s * 0.8, s * 0.2, s * 0.32); }
      g.fillStyle = outline; g.fillRect(-s * 0.13, s * 0.4, s * 0.26, s * 0.6);
      break;
    case 'miners': // diamond / gem
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.9, -s * 0.2); g.lineTo(0, s); g.lineTo(-s * 0.9, -s * 0.2); g.closePath(); fillStroke();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(-s * 0.9, -s * 0.2); g.lineTo(s * 0.9, -s * 0.2); g.moveTo(0, -s); g.lineTo(0, s); g.stroke();
      break;
    case 'wanderers': // arrow / compass
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.5, s * 0.6); g.lineTo(0, s * 0.25); g.lineTo(-s * 0.5, s * 0.6); g.closePath(); fillStroke();
      g.beginPath(); g.arc(0, 0, s * 1.05, 0, Math.PI * 2); g.lineWidth = s * 0.1; g.strokeStyle = color; g.stroke();
      break;
    default:
      g.beginPath(); g.arc(0, 0, s * 0.8, 0, Math.PI * 2); fillStroke();
  }
  g.restore();
}
