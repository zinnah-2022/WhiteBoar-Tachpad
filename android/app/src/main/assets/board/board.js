// লিখন — ফোনের নিজস্ব হোয়াইটবোর্ড (কম্পিউটার ছাড়াই চলে)
// লেখার মাপ ফোনের পর্দার মাপে ঠিক থাকে; ফোন ঘোরালেও লেখা ছোট-বড় হয় না।
import {
  isDark, strokePath, measureText, bbox, hit, contentBounds, drawEl, drawPattern, setImageLoadHandler,
} from '../shared/draw.mjs';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const app = window.LikhonApp || null;
let booted = false;
const buzz = (ms = 8) => { if (!booted) return; try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

const COLORS = ['#1b2130', '#e0393e', '#f08c00', '#f5c400', '#18a058', '#1c7ed6', '#3a56f5', '#9c36b5', '#ffffff'];
const PALETTE = [
  '#000000', '#1b2130', '#495057', '#868e96', '#ced4da', '#ffffff',
  '#c92a2a', '#e0393e', '#ff6b6b', '#d9480f', '#f08c00', '#fab005',
  '#f5c400', '#82c91e', '#18a058', '#0ca678', '#1098ad', '#1c7ed6',
  '#3a56f5', '#5f3dc4', '#9c36b5', '#d6336c', '#a0522d', '#5c3d2e',
];
const BGS = [
  { c: '#ffffff', n: 'সাদা' }, { c: '#fbf7ec', n: 'ক্রিম' }, { c: '#eef3f8', n: 'হালকা নীল' },
  { c: '#1f3b2f', n: 'সবুজ বোর্ড' }, { c: '#1d2127', n: 'কালো বোর্ড' }, { c: '#14213d', n: 'গাঢ় নীল' },
];
// মাপগুলো ফোনের পর্দার পিক্সেলে — যে জুমেই লিখুন, পর্দায় এই মোটাই দেখাবে
const SIZES = {
  pen: [2.6, 4.2, 7], marker: [14, 22, 34], eraser: [16, 32, 64],
  shape: [2.2, 3.5, 6], text: [22, 30, 44],
};
const SHAPES = ['line', 'arrow', 'rect', 'ellipse'];
const STORE = 'likhon.mboard';

// ───────────── অবস্থা ─────────────
function newPage(bg) {
  return { id: uid(), bg: bg ? { ...bg } : { color: '#ffffff', pattern: 'grid' }, els: [], undo: [], redo: [], cam: { x: 0, y: 0, z: 1 } };
}
const S = {
  tool: 'pen',
  color: COLORS[0],
  sizeIdx: { pen: 1, marker: 1, eraser: 1, shape: 1, text: 1 },
  pages: [newPage()],
  pi: 0,
  rec: false,
};
const page = () => S.pages[S.pi];
const cam = () => page().cam;
const sizeKey = (t = S.tool) => (SHAPES.includes(t) ? 'shape' : SIZES[t] ? t : null);
const curSize = (t = S.tool) => { const k = sizeKey(t); return k ? SIZES[k][S.sizeIdx[k]] : 0; };

// ───────────── ক্যানভাস ─────────────
const cv = $('#board');
const ctx = cv.getContext('2d', { desynchronized: true }); // কম দেরিতে কালি দেখানো
const scv = document.createElement('canvas');
const sctx = scv.getContext('2d');
let W = 0, H = 0, dpr = 1, raf = 0, staticDirty = true;

const toWorld = (sx, sy) => { const c = cam(); return [sx / c.z + c.x, sy / c.z + c.y]; };
const toScreen = (wx, wy) => { const c = cam(); return [(wx - c.x) * c.z, (wy - c.y) * c.z]; };

function layout() {
  const r = $('#stage').getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = Math.min(3, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  for (const c of [cv, scv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  staticDirty = true;
  draw();
  if (textEdit) { keepTextVisible(); placeTextEditor(); }
}
new ResizeObserver(layout).observe($('#stage'));

function invalidate() { staticDirty = true; requestDraw(); }
function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }
setImageLoadHandler(invalidate);

function drawStatic() {
  const pg = page(), c = pg.cam;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.fillStyle = pg.bg.color;
  sctx.fillRect(0, 0, W, H);
  drawPattern(sctx, pg.bg, c, W, H);
  sctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);
  const vx1 = c.x, vy1 = c.y, vx2 = c.x + W / c.z, vy2 = c.y + H / c.z;
  for (const el of pg.els) {
    if (textEdit && textEdit.id === el.id) continue;
    const b = bbox(el);
    if (b.x2 < vx1 || b.x1 > vx2 || b.y2 < vy1 || b.y1 > vy2) continue;
    drawEl(sctx, el, erasing.has(el.id) ? 0.18 : 1);
  }
  staticDirty = false;
}

const lasers = [];
let eraserAt = null;
const erasing = new Set();

function draw() {
  raf = 0;
  if (!W) return;
  if (staticDirty) drawStatic();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scv, 0, 0);
  const c = cam();
  ctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);

  if (live) {
    ctx.save();
    if (live.tool === 'marker') ctx.globalAlpha = 0.38;
    ctx.fillStyle = live.color;
    ctx.fill(strokePath(live, false));
    ctx.restore();
  }
  if (draft) drawEl(ctx, draft);

  const now = performance.now();
  let alive = false;
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    L.pts = L.pts.filter((p) => now - p.t < 700);
    if (!L.pts.length && L.done) { lasers.splice(i, 1); continue; }
    alive = true;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,40,60,0.8)';
    ctx.shadowBlur = 10;
    for (let k = 1; k < L.pts.length; k++) {
      const a = 1 - (now - L.pts[k].t) / 700;
      ctx.strokeStyle = `rgba(255,40,60,${0.9 * a})`;
      ctx.lineWidth = (2 + 5 * a) / c.z;
      ctx.beginPath(); ctx.moveTo(L.pts[k - 1].x, L.pts[k - 1].y); ctx.lineTo(L.pts[k].x, L.pts[k].y); ctx.stroke();
    }
    const last = L.pts[L.pts.length - 1];
    if (last) { ctx.fillStyle = '#ff2a3c'; ctx.beginPath(); ctx.arc(last.x, last.y, 5 / c.z, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  if (alive) requestDraw();

  if (eraserAt) {
    ctx.strokeStyle = isDark(page().bg.color) ? 'rgba(255,255,255,.75)' : 'rgba(30,40,60,.6)';
    ctx.lineWidth = 1.5 / c.z;
    ctx.beginPath(); ctx.arc(eraserAt[0], eraserAt[1], eraserAt[2], 0, 7); ctx.stroke();
  }
}

// ───────────── ইতিহাস ─────────────
function commit(els) {
  const pg = page();
  pg.undo.push(pg.els);
  if (pg.undo.length > 200) pg.undo.shift();
  pg.redo = [];
  pg.els = els;
  changed();
}
function changed() { invalidate(); updateUndo(); scheduleSave(); }
function undo() { const pg = page(); if (!pg.undo.length) return; pg.redo.push(pg.els); pg.els = pg.undo.pop(); changed(); buzz(); }
function redo() { const pg = page(); if (!pg.redo.length) return; pg.undo.push(pg.els); pg.els = pg.redo.pop(); changed(); buzz(); }
function updateUndo() {
  $('#undoBtn').disabled = !page().undo.length;
  $('#redoBtn').disabled = !page().redo.length;
}

// ───────────── ইনপুট ─────────────
let live = null;     // চলমান কলমের দাগ
let draft = null;    // আকার
let cur = null;      // {pid, kind}
let penSeen = false;
const touches = new Map();
let gesture = null;

function localPt(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

function startGesture() {
  const pts = [...touches.values()];
  const c = { ...cam() };
  if (pts.length >= 2) {
    const [a, b] = pts;
    gesture = { mode: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, c0: c };
  } else if (pts.length === 1) {
    gesture = { mode: 'pan', sx: pts[0][0], sy: pts[0][1], c0: c };
  }
}
function updateGesture() {
  const pts = [...touches.values()];
  const c = cam(), g = gesture;
  if (!g) return;
  if (g.mode === 'pinch' && pts.length >= 2) {
    const [a, b] = pts;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const z = clamp(g.c0.z * (d / g.d), 0.25, 5);
    const wx = g.mx / g.c0.z + g.c0.x, wy = g.my / g.c0.z + g.c0.y;
    c.z = z; c.x = wx - mx / z; c.y = wy - my / z;
  } else if (g.mode === 'pan' && pts.length === 1) {
    c.x = g.c0.x - (pts[0][0] - g.sx) / c.z;
    c.y = g.c0.y - (pts[0][1] - g.sy) / c.z;
  }
  afterMove();
}
function afterMove() { invalidate(); updateZoomLabel(); scheduleSave(); if (textEdit) placeTextEditor(); }

cv.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (textEdit) { finishText(); return; }
  if (e.pointerType === 'pen') penSeen = true;
  hideHint();
  const pt = localPt(e);

  if (e.pointerType === 'touch' || S.tool === 'hand') {
    touches.set(e.pointerId, pt);
    cv.setPointerCapture(e.pointerId);
    // দুই আঙুল = সরানো/জুম; স্টাইলাস ব্যবহার হলে এক আঙুলেও শুধু সরানো
    if (touches.size >= 2) { cancelCurrent(); startGesture(); return; }
    if (S.tool === 'hand' || (penSeen && e.pointerType === 'touch')) { startGesture(); return; }
  }
  if (cur) return;
  cv.setPointerCapture(e.pointerId);
  const [x, y] = toWorld(pt[0], pt[1]);
  const z = cam().z;
  const t = S.tool;
  cur = { pid: e.pointerId, kind: t };

  if (t === 'pen' || t === 'marker') {
    const pr = e.pointerType === 'pen' && e.pressure > 0;
    live = { id: uid(), type: 'stroke', tool: t, color: S.color, size: curSize(t) / z, pr, pts: [[x, y, pr ? e.pressure : 0.5]] };
  } else if (t === 'eraser') {
    erasing.clear();
    cur.r = curSize('eraser') / 2 / z;
    cur.last = [x, y];
    eraseAt(x, y, x, y, cur.r);
    eraserAt = [x, y, cur.r];
  } else if (t === 'laser') {
    cur.L = { pts: [{ x, y, t: performance.now() }], done: false };
    lasers.push(cur.L);
  } else if (SHAPES.includes(t)) {
    draft = { id: uid(), type: t, x1: x, y1: y, x2: x, y2: y, color: S.color, size: curSize(t) / z };
  } else if (t === 'text') {
    cur = null;
    const r = 8 / z;
    const old = [...page().els].reverse().find((el) => el.type === 'text' && hit(el, x, y, r));
    const size = curSize('text') / z;
    startText(old || { id: uid(), type: 'text', x, y: y - size * 0.6, text: '', size, color: S.color }, !old);
    return;
  }
  requestDraw();
});

cv.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, localPt(e));
    if (gesture) { updateGesture(); return; }
  }
  if (!cur || e.pointerId !== cur.pid) return;
  const r = cv.getBoundingClientRect();
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of evs.length ? evs : [e]) {
    const [x, y] = toWorld(ev.clientX - r.left, ev.clientY - r.top);
    if (live) {
      const last = live.pts[live.pts.length - 1];
      // খুব কাছাকাছি বিন্দু বাদ — রেখা মসৃণ থাকে
      if (Math.hypot(x - last[0], y - last[1]) * cam().z < 0.6) continue;
      live.pts.push([x, y, live.pr ? ev.pressure || 0.5 : 0.5]);
    } else if (cur.kind === 'eraser') {
      eraseAt(cur.last[0], cur.last[1], x, y, cur.r);
      cur.last = [x, y];
      eraserAt = [x, y, cur.r];
    } else if (cur.L) {
      cur.L.pts.push({ x, y, t: performance.now() });
    } else if (draft) {
      draft = { ...draft, x2: x, y2: y };
    }
  }
  requestDraw();
});

function endPointer(e) {
  if (touches.has(e.pointerId)) {
    touches.delete(e.pointerId);
    if (gesture) { if (touches.size) startGesture(); else gesture = null; return; }
  }
  if (!cur || e.pointerId !== cur.pid) return;
  const k = cur;
  cur = null;
  if (live) {
    const el = live;
    live = null;
    commit([...page().els, el]);
  } else if (k.kind === 'eraser') {
    eraserAt = null;
    if (erasing.size) commit(page().els.filter((x) => !erasing.has(x.id)));
    erasing.clear();
    invalidate();
  } else if (k.L) {
    k.L.done = true;
  } else if (draft) {
    const d = draft;
    draft = null;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * cam().z > 6) commit([...page().els, d]);
  }
  requestDraw();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('contextmenu', (e) => e.preventDefault());

function cancelCurrent() {
  if (!cur) return;
  if (cur.L) cur.L.done = true;
  cur = null;
  live = null;
  draft = null;
  eraserAt = null;
  if (erasing.size) erasing.clear();
  invalidate();
}

function eraseAt(x0, y0, x1, y1, r) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 2)));
  let added = false;
  for (const el of page().els) {
    if (erasing.has(el.id)) continue;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (hit(el, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) { erasing.add(el.id); added = true; break; }
    }
  }
  if (added) invalidate();
}

// ───────────── লেখা (টেক্সট) ─────────────
const ta = $('#textEditor');
let textEdit = null;
function startText(el, isNew) {
  textEdit = { ...el, isNew };
  invalidate();
  ta.hidden = false;
  ta.value = el.text;
  placeTextEditor();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function placeTextEditor() {
  if (!textEdit) return;
  const c = cam();
  const [sx, sy] = toScreen(textEdit.x, textEdit.y);
  const fs = textEdit.size * c.z;
  const m = measureText({ ...textEdit, text: ta.value || ' ' });
  Object.assign(ta.style, {
    left: sx - 3 + 'px', top: sy - 2 + 'px', fontSize: fs + 'px', color: textEdit.color,
    width: Math.max(70, m.w * c.z + fs * 1.2) + 'px', height: m.h * c.z + 8 + 'px',
  });
}
// কিবোর্ড খুললে লেখা যেন ঢাকা না পড়ে
function keepTextVisible() {
  const c = cam();
  const [, sy] = toScreen(textEdit.x, textEdit.y);
  const h = measureText({ ...textEdit, text: ta.value || ' ' }).h * c.z;
  if (sy + h + 16 > H) { c.y += (sy + h + 16 - H) / c.z; invalidate(); }
  if (sy < 8) { c.y -= (8 - sy) / c.z; invalidate(); }
}
ta.addEventListener('input', placeTextEditor);
ta.addEventListener('blur', () => finishText());
function finishText() {
  if (!textEdit) return;
  const t = textEdit;
  textEdit = null;
  ta.hidden = true;
  ta.blur();
  const text = ta.value.replace(/\s+$/, '');
  const { isNew, ...el } = t;
  if (isNew) { if (text) commit([...page().els, { ...el, text }]); else invalidate(); }
  else if (!text) commit(page().els.filter((x) => x.id !== el.id));
  else if (text !== el.text) commit(page().els.map((x) => (x.id === el.id ? { ...x, text } : x)));
  else invalidate();
}

// ───────────── নিয়ন্ত্রণ ─────────────
function setTool(t) {
  if (textEdit) finishText();
  S.tool = t;
  $$('.tb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const k = sizeKey(t);
  $('#sizes').classList.toggle('off', !k);
  $$('#sizes button').forEach((b) => b.classList.toggle('active', !!k && Number(b.dataset.i) === S.sizeIdx[k]));
  $('#miniPen').classList.toggle('active', t === 'pen');
  $('#miniEraser').classList.toggle('active', t === 'eraser');
  $('#miniLaser').classList.toggle('active', t === 'laser');
  buzz();
}
$$('.tb[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$$('#sizes button').forEach((b) => (b.onclick = () => {
  const k = sizeKey();
  if (!k) return;
  S.sizeIdx[k] = Number(b.dataset.i);
  setTool(S.tool);
  scheduleSave();
}));

function buildColors() {
  const mk = (box, list, after) => {
    box.innerHTML = '';
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', c);
      b.onclick = () => { setColor(c); after && after(); };
      box.append(b);
    }
  };
  mk($('#colors'), COLORS);
  mk($('#palette'), PALETTE, () => ($('#colorSheet').hidden = true));
  const bg = $('#bgColors');
  bg.innerHTML = '';
  for (const { c, n } of BGS) {
    const b = document.createElement('button');
    b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', n);
    b.onclick = () => setBg({ color: c });
    bg.append(b);
  }
  $$('#bgPattern button').forEach((b) => (b.onclick = () => setBg({ pattern: b.dataset.v })));
}
function setColor(c, quiet) {
  S.color = c;
  if (['eraser', 'laser', 'hand'].includes(S.tool) && !quiet) setTool('pen');
  $$('#colors .sw, #palette .sw').forEach((b) => b.classList.toggle('active', b.dataset.c === c));
  $('#moreColors').classList.toggle('active', !COLORS.includes(c));
  $('#moreColors').style.background = COLORS.includes(c) ? '' : c;
  $('#miniDot').style.background = c;
  if (!quiet) { buzz(5); scheduleSave(); }
}
$('#moreColors').onclick = () => ($('#colorSheet').hidden = false);
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) s.hidden = true; }));

function setBg(patch) {
  const pg = page();
  const was = isDark(pg.bg.color);
  pg.bg = { ...pg.bg, ...patch };
  const now = isDark(pg.bg.color);
  // কালো বোর্ডে কালো কালি দেখা যায় না — নিজে থেকে সাদা (আর উল্টোটা)
  if (was !== now) {
    if (now && S.color === '#1b2130') setColor('#ffffff', true);
    if (!now && S.color === '#ffffff') setColor('#1b2130', true);
  }
  updateBgUI();
  invalidate();
  scheduleSave();
}
function updateBgUI() {
  $$('#bgColors button').forEach((b) => b.classList.toggle('active', b.dataset.c === page().bg.color));
  $$('#bgPattern button').forEach((b) => b.classList.toggle('active', b.dataset.v === page().bg.pattern));
  $('.stage').style.background = page().bg.color;
}

// জুম
function zoomTo(z) {
  const c = cam();
  const wx = W / 2 / c.z + c.x, wy = H / 2 / c.z + c.y;
  c.z = clamp(z, 0.25, 5);
  c.x = wx - W / 2 / c.z; c.y = wy - H / 2 / c.z;
  afterMove();
}
function updateZoomLabel() { $('#zoomLabel').textContent = bn(Math.round(cam().z * 100)) + '%'; }
$('#zoomLabel').onclick = () => { zoomTo(1); buzz(); };
$('#fitBtn').onclick = () => {
  $('#moreSheet').hidden = true;
  const b = contentBounds(page().els);
  const c = cam();
  if (!b) { Object.assign(c, { x: 0, y: 0, z: 1 }); afterMove(); return; }
  const pad = 24;
  c.z = clamp(Math.min((W - pad * 2) / (b.x2 - b.x1 || 1), (H - pad * 2) / (b.y2 - b.y1 || 1)), 0.25, 1.5);
  c.x = (b.x1 + b.x2) / 2 - W / 2 / c.z;
  c.y = (b.y1 + b.y2) / 2 - H / 2 / c.z;
  afterMove();
};

// পেজ
function goPage(i) {
  if (textEdit) finishText();
  cancelCurrent();
  S.pi = clamp(i, 0, S.pages.length - 1);
  $('#pgLabel').textContent = `${bn(S.pi + 1)}/${bn(S.pages.length)}`;
  $('#pgPrev').disabled = S.pi === 0;
  updateUndo();
  updateBgUI();
  updateZoomLabel();
  invalidate();
  scheduleSave();
}
function addPage() {
  const p = newPage(page().bg);
  p.cam.z = cam().z;
  S.pages.splice(S.pi + 1, 0, p);
  goPage(S.pi + 1);
  toast(`নতুন পেজ ${bn(S.pi + 1)}`);
  buzz(12);
}
$('#pgPrev').onclick = () => { goPage(S.pi - 1); buzz(); };
$('#pgNext').onclick = () => { if (S.pi === S.pages.length - 1) addPage(); else { goPage(S.pi + 1); buzz(); } };
$('#pgAdd').onclick = addPage;

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#moreBtn').onclick = () => { updateBgUI(); $('#moreSheet').hidden = false; };
$('#clearBtn').onclick = () => {
  $('#moreSheet').hidden = true;
  if (!page().els.length) return;
  commit([]);
  toast('পেজ পরিষ্কার হয়েছে — ফেরত আনতে ↶ চাপুন');
};
$('#delPageBtn').onclick = () => {
  $('#moreSheet').hidden = true;
  if (S.pages.length === 1) { if (page().els.length) commit([]); return; }
  if (page().els.length && !confirm('এই পেজটি মুছে ফেলবেন?')) return;
  S.pages.splice(S.pi, 1);
  goPage(Math.min(S.pi, S.pages.length - 1));
};
$('#homeBtn').onclick = () => { saveNow(); if (app) app.home(); else history.back(); };

// রেকর্ডিং মোড
function setRec(on) {
  if (textEdit) finishText();
  S.rec = on;
  document.body.classList.toggle('rec', on);
  $('#mini').hidden = !on;
  if (on) toast('শুধু বোর্ড দেখাচ্ছে — এখন স্ক্রিন রেকর্ড চালু করুন');
}
$('#hideBtn').onclick = () => setRec(true);
$('#miniShow').onclick = () => setRec(false);
$('#miniPen').onclick = () => {
  if (S.tool === 'pen') { // আবার চাপলে পরের রং
    const i = COLORS.indexOf(S.color);
    const list = COLORS.filter((c) => isDark(page().bg.color) ? c !== '#1b2130' : c !== '#ffffff');
    setColor(list[(Math.max(0, list.indexOf(S.color)) + 1) % list.length] || COLORS[(i + 1) % COLORS.length]);
  }
  setTool('pen');
};
$('#miniEraser').onclick = () => setTool('eraser');
$('#miniLaser').onclick = () => setTool('laser');
$('#miniUndo').onclick = undo;

// ───────────── ছবি সেভ / শেয়ার ─────────────
function renderImage() {
  const p = page();
  const b = contentBounds(p.els);
  let x1, y1, x2, y2;
  if (b) { const m = 30; x1 = b.x1 - m; y1 = b.y1 - m; x2 = b.x2 + m; y2 = b.y2 + m; }
  else { const c = p.cam; x1 = c.x; y1 = c.y; x2 = x1 + W / c.z; y2 = y1 + H / c.z; }
  const w = x2 - x1, h = y2 - y1;
  const s = Math.min(3, 4096 / w, 4096 / h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * s)); out.height = Math.max(1, Math.round(h * s));
  const c = out.getContext('2d');
  c.fillStyle = p.bg.color;
  c.fillRect(0, 0, out.width, out.height);
  drawPattern(c, p.bg, { x: x1, y: y1, z: s }, out.width, out.height);
  c.setTransform(s, 0, 0, s, -x1 * s, -y1 * s);
  for (const el of p.els) drawEl(c, el);
  return out.toDataURL('image/png');
}
const imgName = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `Likhon-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
$('#saveImg').onclick = () => {
  $('#moreSheet').hidden = true;
  const url = renderImage();
  if (app && app.saveImage) toast(app.saveImage(url, imgName()));
  else { const a = document.createElement('a'); a.href = url; a.download = imgName() + '.png'; a.click(); toast('ছবি নামানো হয়েছে'); }
};
$('#shareImg').onclick = () => {
  $('#moreSheet').hidden = true;
  const url = renderImage();
  if (app && app.shareImage) app.shareImage(url, imgName());
  else toast('শেয়ার শুধু অ্যাপে কাজ করে');
};

// ───────────── সেভ (ফোনে) ─────────────
let saveT = 0;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 600); }
function saveNow() {
  clearTimeout(saveT);
  try {
    localStorage.setItem(STORE, JSON.stringify({
      v: 1, pi: S.pi, color: S.color, sizeIdx: S.sizeIdx, tool: S.tool,
      pages: S.pages.map((p) => ({ id: p.id, bg: p.bg, cam: p.cam, els: p.els })),
    }));
  } catch (err) {
    toast('ফোনে জায়গা কম — পুরোনো পেজ মুছে দিন');
  }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d || !Array.isArray(d.pages) || !d.pages.length) return;
    S.pages = d.pages.map((p) => ({ ...newPage(), ...p, undo: [], redo: [] }));
    S.pi = clamp(d.pi || 0, 0, S.pages.length - 1);
    if (d.color) S.color = d.color;
    if (d.sizeIdx) Object.assign(S.sizeIdx, d.sizeIdx);
    if (d.tool && d.tool !== 'text') S.tool = d.tool;
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
window.addEventListener('pagehide', saveNow);

// ───────────── অন্যান্য ─────────────
let toastT = 0;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 2600);
}
function hideHint() { $('#hint').classList.add('gone'); }
async function keepAwake() { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// ───────────── শুরু ─────────────
load();
buildColors();
setColor(S.color, true);
setTool(S.tool);
goPage(S.pi);
layout();
keepAwake();
setTimeout(hideHint, 4500);
booted = true;
window.__mb = { S, page, cam, saveNow };
