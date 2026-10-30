// লিখন বোর্ড — হোয়াইটবোর্ড ইঞ্জিন ও ইন্টারফেস
import {
  FONT, isDark, imgCache, setImageLoadHandler, strokePath, measureText, bbox, hit, translate, contentBounds, drawEl, drawPattern,
} from '../shared/draw.mjs';
import qrcode from '../vendor/qrcode.mjs';

// ───────────────────────── সাধারণ সহায়ক ─────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = new URLSearchParams(location.search);

const PEN_COLORS = ['#1b2130', '#e0393e', '#f08c00', '#f5c400', '#18a058', '#1c7ed6', '#3a56f5', '#9c36b5', '#ffffff'];
const BG_COLORS = [
  { c: '#ffffff', n: 'সাদা' },
  { c: '#fbf7ec', n: 'ক্রিম' },
  { c: '#eef3f8', n: 'হালকা নীল' },
  { c: '#1f3b2f', n: 'সবুজ বোর্ড' },
  { c: '#1d2127', n: 'কালো বোর্ড' },
  { c: '#14213d', n: 'গাঢ় নীল' },
];
const SIZE_PRESETS = {
  pen: [2, 4, 7, 12],
  marker: [10, 18, 28, 40],
  eraser: [12, 24, 48, 90],
  shape: [2, 3, 5, 8],
  text: [20, 32, 48, 72],
};
const DRAW_TOOLS = ['pen', 'marker'];
const SHAPE_TOOLS = ['line', 'arrow', 'rect', 'ellipse', 'triangle'];


// ইলেকট্রন না থাকলে (ব্রাউজারে পরীক্ষা) সাধারণ বিকল্প
const native = window.likhonNative || {
  netInfo: async () => ({ ips: [{ name: 'local', address: location.hostname }], port: Number(params.get('port') || location.port), pin: params.get('k') || '' }),
  newPin: async () => params.get('k'),
  saveBoard: async ({ json, suggested }) => { download(json, (suggested || 'board') + '.likhon', 'application/json'); return 'download'; },
  openBoard: async () => null,
  pickImage: async () => pickFileAsDataUrl('image/*'),
  exportPng: async ({ dataUrl, suggested }) => { downloadUrl(dataUrl, (suggested || 'board') + '.png'); return 'download'; },
  exportPdf: async () => { toast('PDF শুধু ডেস্কটপ অ্যাপে'); return null; },
  toggleFullscreen: async () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); },
  showInFolder: async () => {},
};
function download(text, name, type) { downloadUrl(URL.createObjectURL(new Blob([text], { type })), name); }
function downloadUrl(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
function pickFileAsDataUrl(accept) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); };
    i.click();
  });
}

// ───────────────────────── অবস্থা (state) ─────────────────────────
function newPage(bg) {
  return {
    id: uid(),
    bg: bg ? { ...bg } : { color: '#ffffff', pattern: 'grid' },
    els: [],
    undo: [],
    redo: [],
    cam: { x: 0, y: 0, z: 1 },
  };
}

const S = {
  tool: 'pen',
  prevTool: 'pen',
  color: PEN_COLORS[0],
  size: { pen: 4, marker: 18, eraser: 24, shape: 3, text: 32 },
  fill: false,
  dash: false,
  pages: [newPage()],
  pi: 0,
  sel: new Set(),
  showPadView: true,
  filePath: null,
  fileName: 'নতুন বোর্ড',
  saved: true,
};
const page = () => S.pages[S.pi];
const cam = () => page().cam;

// ───────────────────────── ক্যানভাস ─────────────────────────
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const scanvas = document.createElement('canvas'); // স্থির স্তর (ক্যাশ)
const sctx = scanvas.getContext('2d');
let dpr = 1, VW = 0, VH = 0;
let staticDirty = true;
let rafId = 0;

function resize() {
  dpr = window.devicePixelRatio || 1;
  VW = innerWidth; VH = innerHeight;
  for (const c of [canvas, scanvas]) { c.width = Math.round(VW * dpr); c.height = Math.round(VH * dpr); }
  invalidate();
  sendPadState();
}
window.addEventListener('resize', resize);

function invalidate() { staticDirty = true; requestRender(); }
function requestRender() { if (!rafId) rafId = requestAnimationFrame(render); }

const toWorld = (sx, sy) => { const c = cam(); return [sx / c.z + c.x, sy / c.z + c.y]; };
const toScreen = (wx, wy) => { const c = cam(); return [(wx - c.x) * c.z, (wy - c.y) * c.z]; };

// স্থির স্তর: পটভূমি + সব সম্পূর্ণ উপাদান
function drawStatic() {
  const pg = page(), cm = pg.cam;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.fillStyle = pg.bg.color;
  sctx.fillRect(0, 0, VW, VH);
  drawPattern(sctx, pg.bg, cm, VW, VH);
  sctx.setTransform(dpr * cm.z, 0, 0, dpr * cm.z, -cm.x * cm.z * dpr, -cm.y * cm.z * dpr);
  const vx1 = cm.x, vy1 = cm.y, vx2 = cm.x + VW / cm.z, vy2 = cm.y + VH / cm.z;
  for (const el of pg.els) {
    if (drag.moving && S.sel.has(el.id)) continue;
    if (textEdit && textEdit.id === el.id) continue;
    const b = bbox(el);
    if (b.x2 < vx1 || b.x1 > vx2 || b.y2 < vy1 || b.y1 > vy2) continue;
    drawEl(sctx, el, erasing.has(el.id) ? 0.2 : 1);
  }
  staticDirty = false;
}

// লেজার ট্রেইল
const lasers = []; // {pts:[{x,y,t}], done}
const LASER_LIFE = 700;

function render() {
  rafId = 0;
  if (staticDirty) drawStatic();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scanvas, 0, 0);
  const cm = cam();
  ctx.setTransform(dpr * cm.z, 0, 0, dpr * cm.z, -cm.x * cm.z * dpr, -cm.y * cm.z * dpr);

  // সরানোর সময় নির্বাচিত উপাদান
  if (drag.moving) for (const el of page().els) if (S.sel.has(el.id)) drawEl(ctx, translate(el, drag.dx, drag.dy));

  // চলমান স্ট্রোক (মাউস/পেন ও মোবাইল)
  for (const el of liveStrokes()) {
    ctx.save();
    if (el.tool === 'marker') ctx.globalAlpha = 0.38;
    ctx.fillStyle = el.color;
    ctx.fill(strokePath(el, false));
    ctx.restore();
  }
  if (draft) drawEl(ctx, draft);

  // মোবাইল লেখার জায়গা
  drawPadViews();

  // নির্বাচন
  if (S.sel.size) {
    ctx.save();
    ctx.strokeStyle = '#3a56f5';
    ctx.lineWidth = 1.5 / cm.z;
    ctx.setLineDash([5 / cm.z, 4 / cm.z]);
    const sel = page().els.filter((e) => S.sel.has(e.id));
    for (const el of sel) {
      const b = bbox(drag.moving ? translate(el, drag.dx, drag.dy) : el);
      ctx.strokeRect(b.x1 - 4 / cm.z, b.y1 - 4 / cm.z, b.x2 - b.x1 + 8 / cm.z, b.y2 - b.y1 + 8 / cm.z);
    }
    ctx.restore();
  }
  if (marquee) {
    ctx.save();
    ctx.fillStyle = 'rgba(58,86,245,0.07)';
    ctx.strokeStyle = 'rgba(58,86,245,0.7)';
    ctx.lineWidth = 1 / cm.z;
    const x = Math.min(marquee.x1, marquee.x2), y = Math.min(marquee.y1, marquee.y2);
    ctx.fillRect(x, y, Math.abs(marquee.x2 - marquee.x1), Math.abs(marquee.y2 - marquee.y1));
    ctx.strokeRect(x, y, Math.abs(marquee.x2 - marquee.x1), Math.abs(marquee.y2 - marquee.y1));
    ctx.restore();
  }

  // ইরেজার ও লেজার
  if (hover && S.tool === 'eraser' && !pan) {
    ctx.save();
    ctx.strokeStyle = isDark(page().bg.color) ? 'rgba(255,255,255,0.7)' : 'rgba(30,40,60,0.6)';
    ctx.lineWidth = 1.2 / cm.z;
    ctx.beginPath(); ctx.arc(hover.x, hover.y, S.size.eraser / 2, 0, 7); ctx.stroke();
    ctx.restore();
  }
  const now = performance.now();
  let laserAlive = false;
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    L.pts = L.pts.filter((p) => now - p.t < LASER_LIFE);
    if (!L.pts.length && L.done) { lasers.splice(i, 1); continue; }
    laserAlive = true;
    drawLaser(L.pts, now, cm.z);
  }
  if (laserAlive) requestRender();
}

function drawLaser(pts, now, z) {
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = 1 - (now - pts[i].t) / LASER_LIFE;
    ctx.strokeStyle = `rgba(255,40,60,${0.85 * a})`;
    ctx.lineWidth = (2 + 5 * a) / z;
    ctx.shadowColor = 'rgba(255,40,60,0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  const last = pts[pts.length - 1];
  ctx.fillStyle = '#ff2a3c';
  ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(last.x, last.y, 5 / z, 0, 7); ctx.fill();
  ctx.restore();
}

// বোর্ডে মোবাইলের দেখা অংশ নীল ফ্রেমে
function drawPadViews() {
  if (!S.showPadView) return;
  const cm = cam();
  for (const P of pads.values()) {
    const v = P.view;
    if (!v || v.page !== page().id) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(58,86,245,0.75)';
    ctx.lineWidth = 2 / cm.z;
    ctx.setLineDash([8 / cm.z, 6 / cm.z]);
    ctx.strokeRect(v.x, v.y, v.w, v.h);
    ctx.setLineDash([]);
    const label = '📱 ' + (P.name || 'মোবাইল');
    ctx.font = `${12 / cm.z}px ${FONT}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(58,86,245,0.9)';
    ctx.fillRect(v.x, v.y - 20 / cm.z, tw + 14 / cm.z, 18 / cm.z);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, v.x + 7 / cm.z, v.y - 11 / cm.z);
    ctx.restore();
  }
}

// ───────────────────────── ইতিহাস (Undo/Redo) ─────────────────────────
function commit(els, { silent } = {}) {
  const pg = page();
  pg.undo.push(pg.els);
  if (pg.undo.length > 300) pg.undo.shift();
  pg.redo = [];
  pg.els = els;
  changed(silent);
}
function changed(silent) {
  S.saved = false;
  updateTitle();
  invalidate();
  updateUndoButtons();
  scheduleAutosave();
  scheduleDoc();
  if (!silent) schedulePadState();
}
function undo() {
  const pg = page();
  if (!pg.undo.length) return;
  pg.redo.push(pg.els);
  pg.els = pg.undo.pop();
  pruneSel();
  changed();
}
function redo() {
  const pg = page();
  if (!pg.redo.length) return;
  pg.undo.push(pg.els);
  pg.els = pg.redo.pop();
  pruneSel();
  changed();
}
function pruneSel() { const ids = new Set(page().els.map((e) => e.id)); for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id); }
function updateUndoButtons() { $('#undoBtn').disabled = !page().undo.length; $('#redoBtn').disabled = !page().redo.length; }

function addEl(el) { commit([...page().els, el]); }

// ───────────────────────── পয়েন্টার ইনপুট ─────────────────────────
let live = null;          // মাউস/পেনের চলমান স্ট্রোক
let draft = null;         // আকার আঁকার খসড়া
let pan = null;           // সরানো
let marquee = null;
let hover = null;
const drag = { moving: false, dx: 0, dy: 0, sx: 0, sy: 0 };
const erasing = new Set();
let eraseLast = null;
let spaceDown = false;
const touches = new Map();
let pinch = null;
let lastPenTime = 0;
let textEdit = null;

function liveStrokes() {
  const out = [];
  if (live) out.push(live);
  for (const p of pads.values()) for (const s of p.strokes.values()) if (s.type === 'stroke') out.push(s);
  return out;
}

function effectiveTool(e) {
  if (spaceDown || e.button === 1) return 'hand';
  if (e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5)) return 'eraser';
  return S.tool;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // মাউসের ডিফল্ট ফোকাস বদল বন্ধ (টেক্সট বক্স যেন ফোকাস না হারায়)
  if (textEdit) { finishText(); return; }
  closePopups();
  if (e.pointerType === 'pen') lastPenTime = performance.now();

  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { cancelLive(); startPinch(); return; }
    if (touches.size > 2) return;
    // পেন ব্যবহার হলে হাতের তালুর ছোঁয়া শুধু সরাবে
    if (performance.now() - lastPenTime < 4000) { startPan(e); canvas.setPointerCapture(e.pointerId); return; }
  }
  if (e.button === 2) return;
  canvas.setPointerCapture(e.pointerId);
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  const tool = effectiveTool(e);

  if (tool === 'hand') { startPan(e); return; }
  if (DRAW_TOOLS.includes(tool)) {
    const pr = e.pointerType === 'pen' && e.pressure > 0;
    live = {
      id: uid(), type: 'stroke', tool, color: S.color, size: S.size[tool], pr,
      pts: [[wx, wy, pr ? e.pressure : 0.5]], pid: e.pointerId,
    };
    requestRender();
    return;
  }
  if (tool === 'eraser') {
    erasing.clear(); eraseLast = [wx, wy]; eraseAt(wx, wy, wx, wy, S.size.eraser / 2);
    live = { type: 'eraser', pid: e.pointerId };
    return;
  }
  if (SHAPE_TOOLS.includes(tool)) {
    draft = { id: uid(), type: tool, x1: wx, y1: wy, x2: wx, y2: wy, color: S.color, size: S.size.shape, fill: S.fill, dash: S.dash };
    return;
  }
  if (tool === 'text') {
    const t = [...page().els].reverse().find((el) => el.type === 'text' && hit(el, wx, wy, 4 / cam().z));
    startText(t || { id: uid(), type: 'text', x: wx, y: wy - S.size.text * 0.6, text: '', size: S.size.text, color: S.color }, !t);
    return;
  }
  if (tool === 'laser') {
    lasers.push({ pts: [{ x: wx, y: wy, t: performance.now() }], done: false, local: true });
    live = { type: 'laser', pid: e.pointerId };
    requestRender();
    return;
  }
  if (tool === 'select') {
    const r = 6 / cam().z;
    const target = [...page().els].reverse().find((el) => hit(el, wx, wy, r));
    if (target) {
      if (e.shiftKey) { S.sel.has(target.id) ? S.sel.delete(target.id) : S.sel.add(target.id); }
      else if (!S.sel.has(target.id)) { S.sel.clear(); S.sel.add(target.id); }
      if (e.detail === 2 && target.type === 'text') { startText(target, false); return; }
      Object.assign(drag, { moving: false, armed: true, sx: wx, sy: wy, dx: 0, dy: 0 });
    } else {
      if (!e.shiftKey) S.sel.clear();
      marquee = { x1: wx, y1: wy, x2: wx, y2: wy };
    }
    syncPropsToSelection();
    requestRender();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { updatePinch(); return; }
  }
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  hover = { x: wx, y: wy };
  if (pan) {
    const c = cam();
    c.x = pan.cx - (e.clientX - pan.sx) / c.z;
    c.y = pan.cy - (e.clientY - pan.sy) / c.z;
    invalidate();
    return;
  }
  if (live && live.pid === e.pointerId) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (live.type === 'stroke') {
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = toWorld(ev.clientX, ev.clientY);
        live.pts.push([x, y, live.pr ? ev.pressure || 0.5 : 0.5]);
      }
    } else if (live.type === 'eraser') {
      eraseAt(eraseLast[0], eraseLast[1], wx, wy, S.size.eraser / 2);
      eraseLast = [wx, wy];
    } else if (live.type === 'laser') {
      const L = lasers.find((l) => l.local && !l.done);
      if (L) for (const ev of evs.length ? evs : [e]) { const [x, y] = toWorld(ev.clientX, ev.clientY); L.pts.push({ x, y, t: performance.now() }); }
    }
    requestRender();
    return;
  }
  if (draft) {
    let x = wx, y = wy;
    if (e.shiftKey) {
      if (draft.type === 'line' || draft.type === 'arrow') {
        const a = Math.round(Math.atan2(y - draft.y1, x - draft.x1) / (Math.PI / 12)) * (Math.PI / 12);
        const d = Math.hypot(x - draft.x1, y - draft.y1);
        x = draft.x1 + d * Math.cos(a); y = draft.y1 + d * Math.sin(a);
      } else {
        const d = Math.max(Math.abs(x - draft.x1), Math.abs(y - draft.y1));
        x = draft.x1 + Math.sign(x - draft.x1 || 1) * d; y = draft.y1 + Math.sign(y - draft.y1 || 1) * d;
      }
    }
    draft = { ...draft, x2: x, y2: y };
    requestRender();
    return;
  }
  if (drag.armed) {
    drag.dx = wx - drag.sx; drag.dy = wy - drag.sy;
    if (!drag.moving && Math.hypot(drag.dx, drag.dy) * cam().z > 3) { drag.moving = true; invalidate(); }
    requestRender();
    return;
  }
  if (marquee) { marquee.x2 = wx; marquee.y2 = wy; requestRender(); return; }
  if (S.tool === 'eraser') requestRender();
});

function endPointer(e) {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (pinch) { if (touches.size < 2) pinch = null; return; }
  }
  if (pan) { pan = null; updateCursor(); scheduleAutosave(); schedulePadState(); return; }
  if (live && live.pid === e.pointerId) {
    if (live.type === 'stroke') {
      const { pid, ...el } = live;
      live = null;
      addEl(el);
    } else if (live.type === 'eraser') {
      live = null;
      if (erasing.size) commit(page().els.filter((x) => !erasing.has(x.id)));
      erasing.clear();
      invalidate();
    } else if (live.type === 'laser') {
      const L = lasers.find((l) => l.local && !l.done);
      if (L) L.done = true;
      live = null;
    }
    return;
  }
  if (draft) {
    const d = draft; draft = null;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3 / cam().z) addEl(d);
    requestRender();
    return;
  }
  if (drag.armed) {
    if (drag.moving) {
      const { dx, dy } = drag;
      drag.moving = false;
      commit(page().els.map((el) => (S.sel.has(el.id) ? translate(el, dx, dy) : el)));
    }
    drag.armed = false;
    invalidate();
    return;
  }
  if (marquee) {
    const x1 = Math.min(marquee.x1, marquee.x2), x2 = Math.max(marquee.x1, marquee.x2);
    const y1 = Math.min(marquee.y1, marquee.y2), y2 = Math.max(marquee.y1, marquee.y2);
    for (const el of page().els) { const b = bbox(el); if (b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2) S.sel.add(el.id); }
    marquee = null;
    syncPropsToSelection();
    requestRender();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { hover = null; requestRender(); });

function cancelLive() { live = null; draft = null; marquee = null; erasing.clear(); drag.armed = false; drag.moving = false; invalidate(); }
function startPan(e) { pan = { sx: e.clientX, sy: e.clientY, cx: cam().x, cy: cam().y }; canvas.style.cursor = 'grabbing'; }
function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam() } };
}
function updatePinch() {
  const [a, b] = [...touches.values()];
  if (!a || !b) return;
  const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const z = clamp(pinch.cam.z * (d / pinch.d), 0.1, 8);
  const wx = pinch.mx / pinch.cam.z + pinch.cam.x, wy = pinch.my / pinch.cam.z + pinch.cam.y;
  Object.assign(cam(), { z, x: wx - mx / z, y: wy - my / z });
  afterZoom();
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

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
  } else {
    const c = cam();
    c.x += (e.shiftKey ? e.deltaY : e.deltaX) / c.z;
    c.y += (e.shiftKey ? 0 : e.deltaY) / c.z;
    invalidate();
    scheduleAutosave();
    schedulePadState();
  }
}, { passive: false });

function zoomAt(sx, sy, f) {
  const c = cam();
  const [wx, wy] = toWorld(sx, sy);
  c.z = clamp(c.z * f, 0.1, 8);
  c.x = wx - sx / c.z; c.y = wy - sy / c.z;
  afterZoom();
}
function setZoom(z) { zoomAt(VW / 2, VH / 2, z / cam().z); }
function afterZoom() {
  $('#zoomLabel').textContent = bn(Math.round(cam().z * 100)) + '%';
  invalidate();
  scheduleAutosave();
  schedulePadState();
}
function zoomToFit() {
  const b = contentBounds(page().els);
  if (!b) { Object.assign(cam(), { x: 0, y: 0, z: 1 }); afterZoom(); return; }
  const pad = 80;
  const z = clamp(Math.min((VW - pad * 2) / (b.x2 - b.x1 || 1), (VH - pad * 2) / (b.y2 - b.y1 || 1)), 0.1, 2);
  Object.assign(cam(), { z, x: (b.x1 + b.x2) / 2 - VW / 2 / z, y: (b.y1 + b.y2) / 2 - VH / 2 / z });
  afterZoom();
}

// ───────────────────────── টেক্সট ─────────────────────────
const ta = $('#textEditor');
function startText(el, isNew) {
  textEdit = { ...el, isNew };
  S.sel.clear();
  invalidate();
  ta.hidden = false;
  ta.value = el.text;
  placeTextEditor();
  const focus = () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
  focus();
  setTimeout(() => { if (textEdit && document.activeElement !== ta) focus(); }, 0);
}
function placeTextEditor() {
  if (!textEdit) return;
  const c = cam();
  const [sx, sy] = toScreen(textEdit.x, textEdit.y);
  const fs = textEdit.size * c.z;
  Object.assign(ta.style, { left: sx - 4 + 'px', top: sy - 2 + 'px', fontSize: fs + 'px', color: textEdit.color, lineHeight: '1.25' });
  const m = measureText({ ...textEdit, text: ta.value || ' ' });
  ta.style.width = Math.max(60, m.w * c.z + fs) + 'px';
  ta.style.height = m.h * c.z + 6 + 'px';
}
ta.addEventListener('input', placeTextEditor);
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finishText(); }
});
ta.addEventListener('blur', () => finishText());
function finishText() {
  if (!textEdit) return;
  const t = textEdit; textEdit = null;
  ta.hidden = true;
  const text = ta.value.replace(/\s+$/, '');
  const { isNew, ...el } = t;
  if (isNew) { if (text) addEl({ ...el, text }); else invalidate(); }
  else if (!text) commit(page().els.filter((x) => x.id !== el.id));
  else if (text !== el.text) commit(page().els.map((x) => (x.id === el.id ? { ...x, text } : x)));
  else invalidate();
}

// ───────────────────────── টুল ও প্রপার্টি UI ─────────────────────────
function setTool(t) {
  if (textEdit) finishText();
  S.prevTool = t;
  S.tool = t;
  if (t !== 'select') { S.sel.clear(); }
  $$('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  updateProps();
  updateCursor();
  requestRender();
}
function updateCursor() {
  const m = { hand: 'grab', select: 'default', text: 'text', laser: 'none', eraser: 'none' };
  canvas.style.cursor = m[S.tool] || 'crosshair';
}
$$('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function sizeKey() {
  if (S.tool === 'select') {
    const el = page().els.find((e) => S.sel.has(e.id));
    if (!el) return 'pen';
    if (el.type === 'stroke') return el.tool;
    if (el.type === 'text') return 'text';
    return 'shape';
  }
  if (SHAPE_TOOLS.includes(S.tool)) return 'shape';
  return ['pen', 'marker', 'eraser', 'text'].includes(S.tool) ? S.tool : null;
}

function buildSwatches() {
  const box = $('#swatches');
  box.innerHTML = '';
  PEN_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c;
    b.title = `রং ${bn(i + 1)}`;
    b.dataset.c = c;
    b.onclick = () => setColor(c);
    box.appendChild(b);
  });
}
function setColor(c) {
  S.color = c;
  if (['eraser', 'hand', 'laser'].includes(S.tool)) setTool('pen');
  if (S.sel.size) commit(page().els.map((el) => (S.sel.has(el.id) && el.type !== 'image' ? { ...el, color: c } : el)));
  if (textEdit) { textEdit.color = c; placeTextEditor(); }
  updateProps();
}
$('#customColor').addEventListener('input', (e) => setColor(e.target.value));

function updateProps() {
  $$('.sw').forEach((b) => b.classList.toggle('active', b.dataset.c.toLowerCase() === S.color.toLowerCase()));
  $('.custom-color').classList.toggle('active', !PEN_COLORS.includes(S.color));
  const k = sizeKey();
  const sizes = $('#sizes');
  sizes.innerHTML = '';
  const showColor = !['eraser', 'hand', 'laser'].includes(S.tool) || S.sel.size;
  $('#swatches').style.display = showColor ? '' : 'none';
  $('.custom-color').style.display = showColor ? '' : 'none';
  if (k) {
    SIZE_PRESETS[k].forEach((v, i) => {
      const b = document.createElement('button');
      b.className = 'size' + (S.size[k] === v ? ' active' : '');
      b.title = `${['চিকন', 'মাঝারি', 'মোটা', 'অনেক মোটা'][i]}`;
      const d = k === 'text' ? 6 + i * 4 : Math.min(22, 4 + i * 5);
      b.innerHTML = k === 'text' ? `<span style="font-size:${10 + i * 3}px;font-weight:600">অ</span>` : `<i style="width:${d}px;height:${d}px"></i>`;
      b.onclick = () => setSize(k, v);
      sizes.appendChild(b);
    });
    const r = $('#sizeRange');
    r.max = k === 'text' ? 160 : k === 'eraser' ? 200 : k === 'marker' ? 80 : 40;
    r.min = k === 'text' ? 10 : 1;
    r.value = S.size[k];
    r.style.display = '';
  } else $('#sizeRange').style.display = 'none';
  const shapeish = SHAPE_TOOLS.includes(S.tool) || (S.tool === 'select' && page().els.some((e) => S.sel.has(e.id) && SHAPE_TOOLS.includes(e.type)));
  $$('.shape-only').forEach((x) => (x.style.display = shapeish ? '' : 'none'));
  $('#fillBtn').classList.toggle('on', S.fill);
  $('#dashBtn').classList.toggle('on', S.dash);
  $('#props').style.display = S.tool === 'hand' || (S.tool === 'select' && !S.sel.size) ? 'none' : '';
}
function setSize(k, v) {
  S.size[k] = v;
  if (S.sel.size) {
    commit(page().els.map((el) => {
      if (!S.sel.has(el.id) || el.type === 'image') return el;
      return { ...el, size: v };
    }));
  }
  if (textEdit && k === 'text') { textEdit.size = v; placeTextEditor(); }
  updateProps();
}
$('#sizeRange').addEventListener('input', (e) => { const k = sizeKey(); if (k) { S.size[k] = Number(e.target.value); $$('.size').forEach((b) => b.classList.remove('active')); } });
$('#sizeRange').addEventListener('change', (e) => { const k = sizeKey(); if (k) setSize(k, Number(e.target.value)); });
$('#fillBtn').onclick = () => {
  S.fill = !S.fill;
  if (S.sel.size) commit(page().els.map((el) => (S.sel.has(el.id) && SHAPE_TOOLS.includes(el.type) ? { ...el, fill: S.fill } : el)));
  updateProps();
};
$('#dashBtn').onclick = () => {
  S.dash = !S.dash;
  if (S.sel.size) commit(page().els.map((el) => (S.sel.has(el.id) && SHAPE_TOOLS.includes(el.type) ? { ...el, dash: S.dash } : el)));
  updateProps();
};
function syncPropsToSelection() {
  const el = page().els.find((e) => S.sel.has(e.id));
  if (el && el.color) S.color = el.color;
  updateProps();
}

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#clearBtn').onclick = () => {
  if (!page().els.length) return;
  commit([]);
  toast('পেজ পরিষ্কার করা হয়েছে — ফেরত আনতে Ctrl+Z');
};
$('#imgBtn').onclick = async () => { const src = await native.pickImage(); if (src) insertImage(src); };

function insertImage(src, at) {
  const im = new Image();
  im.onload = () => {
    const c = cam();
    const maxW = (VW / c.z) * 0.6, maxH = (VH / c.z) * 0.6;
    const s = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    const [cx, cy] = at || toWorld(VW / 2, VH / 2);
    imgCache.set(src, im);
    const el = { id: uid(), type: 'image', src, x: cx - w / 2, y: cy - h / 2, w, h };
    addEl(el);
    setTool('select');
    S.sel.add(el.id);
    updateProps();
  };
  im.src = src;
}

// ───────────────────────── পেজ ও পটভূমি ─────────────────────────
function goPage(i) {
  if (textEdit) finishText();
  S.pi = clamp(i, 0, S.pages.length - 1);
  S.sel.clear();
  cancelLive();
  updatePageLabel();
  updateUndoButtons();
  afterZoom();
  updateBgUI();
  schedulePadState();
  scheduleDoc();
}
function addPage(afterCurrent = true) {
  const p = newPage(page().bg);
  S.pages.splice(afterCurrent ? S.pi + 1 : S.pages.length, 0, p);
  goPage(S.pages.indexOf(p));
  changed();
  toast(`নতুন পেজ ${bn(S.pi + 1)}`);
}
function updatePageLabel() { $('#pageLabel').textContent = `পেজ ${bn(S.pi + 1)} / ${bn(S.pages.length)}`; }
$('#pagePrev').onclick = () => goPage(S.pi - 1);
$('#pageNext').onclick = () => (S.pi === S.pages.length - 1 ? addPage() : goPage(S.pi + 1));
$('#pageAdd').onclick = () => addPage();
$('#pageLabel').onclick = () => togglePop('#pagesPop', buildThumbs);
$('#pageDup').onclick = () => {
  const src = page();
  const p = newPage(src.bg);
  p.els = src.els.map((e) => ({ ...e, id: uid() }));
  p.cam = { ...src.cam };
  S.pages.splice(S.pi + 1, 0, p);
  goPage(S.pi + 1);
  changed();
  closePopups();
};
$('#pageDel').onclick = () => {
  if (S.pages.length === 1) { commit([]); closePopups(); return; }
  if (page().els.length && !confirm('এই পেজটি মুছে ফেলবেন?')) return;
  S.pages.splice(S.pi, 1);
  goPage(Math.min(S.pi, S.pages.length - 1));
  changed();
  closePopups();
};
function buildThumbs() {
  const box = $('#pageThumbs');
  box.innerHTML = '';
  S.pages.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (i === S.pi ? ' active' : '');
    const img = document.createElement('img');
    img.src = renderPageImage(p, 240, 150).toDataURL();
    b.append(img);
    const s = document.createElement('span'); s.textContent = bn(i + 1); b.append(s);
    b.onclick = () => { goPage(i); closePopups(); };
    box.append(b);
  });
}

function buildBgUI() {
  const box = $('#bgColors');
  box.innerHTML = '';
  for (const { c, n } of BG_COLORS) {
    const b = document.createElement('button');
    b.style.background = c; b.title = n; b.dataset.c = c;
    b.onclick = () => setBg({ color: c });
    box.append(b);
  }
  $$('#bgPattern button').forEach((b) => (b.onclick = () => setBg({ pattern: b.dataset.v })));
}
function setBg(patch) {
  const pg = page();
  const wasDark = isDark(pg.bg.color);
  pg.bg = { ...pg.bg, ...patch };
  const nowDark = isDark(pg.bg.color);
  if (wasDark !== nowDark) {
    if (nowDark && S.color === '#1b2130') S.color = '#ffffff';
    if (!nowDark && S.color === '#ffffff') S.color = '#1b2130';
    updateProps();
  }
  updateBgUI();
  changed();
}
function updateBgUI() {
  $$('#bgColors button').forEach((b) => b.classList.toggle('active', b.dataset.c === page().bg.color));
  $$('#bgPattern button').forEach((b) => b.classList.toggle('active', b.dataset.v === page().bg.pattern));
}
$('#bgBtn').onclick = () => togglePop('#bgPop', updateBgUI);

// ───────────────────────── রপ্তানি ─────────────────────────
function renderPageImage(p, maxW, maxH, scale) {
  const b = contentBounds(p.els);
  let x1, y1, x2, y2;
  if (b) { const m = 40; x1 = b.x1 - m; y1 = b.y1 - m; x2 = b.x2 + m; y2 = b.y2 + m; }
  else { x1 = p.cam.x; y1 = p.cam.y; x2 = x1 + VW / p.cam.z; y2 = y1 + VH / p.cam.z; }
  // অনুপাত ১৬:৯ এর কাছাকাছি রাখি যাতে PDF পেজে ভালো দেখায়
  let w = x2 - x1, h = y2 - y1;
  if (w / h < 16 / 9) { const nw = h * 16 / 9; x1 -= (nw - w) / 2; w = nw; } else { const nh = w * 9 / 16; y1 -= (nh - h) / 2; h = nh; }
  const s = scale ? Math.min(scale, 8000 / w, 8000 / h) : Math.min(maxW / w, maxH / h);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
  const c = cv.getContext('2d');
  c.fillStyle = p.bg.color;
  c.fillRect(0, 0, cv.width, cv.height);
  drawPattern(c, p.bg, { x: x1, y: y1, z: s }, cv.width, cv.height);
  c.setTransform(s, 0, 0, s, -x1 * s, -y1 * s);
  for (const el of p.els) drawEl(c, el);
  return cv;
}
const exportName = () => S.fileName.replace(/\.likhon$/, '');
async function exportPng() {
  const cv = renderPageImage(page(), 0, 0, 2);
  const f = await native.exportPng({ dataUrl: cv.toDataURL('image/png'), suggested: `${exportName()}-পেজ-${S.pi + 1}` });
  if (f) toast('ছবি সেভ হয়েছে');
}
async function exportPdf() {
  toast('PDF তৈরি হচ্ছে…');
  const pages = S.pages.map((p) => renderPageImage(p, 2400, 1350).toDataURL('image/png'));
  const f = await native.exportPdf({ pages, suggested: exportName() });
  if (f) toast('PDF সেভ হয়েছে');
}

// ───────────────────────── ফাইল ও অটোসেভ ─────────────────────────
function serialize() {
  return JSON.stringify({
    app: 'likhon', v: 1,
    pi: S.pi,
    pages: S.pages.map((p) => ({ id: p.id, bg: p.bg, els: p.els, cam: p.cam })),
  });
}
function load(json) {
  const d = JSON.parse(json);
  if (d.app !== 'likhon' || !Array.isArray(d.pages)) throw new Error('bad file');
  S.pages = d.pages.map((p) => ({ ...newPage(), ...p, undo: [], redo: [] }));
  if (!S.pages.length) S.pages = [newPage()];
  S.sel.clear();
  goPage(d.pi || 0);
}
let autosaveT = 0;
function scheduleAutosave() {
  clearTimeout(autosaveT);
  autosaveT = setTimeout(() => {
    try { localStorage.setItem('likhon.autosave', serialize()); localStorage.setItem('likhon.meta', JSON.stringify({ filePath: S.filePath, fileName: S.fileName, saved: S.saved })); } catch {}
  }, 700);
}
function updateTitle() {
  $('#fileName').textContent = S.fileName + (S.saved ? '' : ' •');
  document.title = `${S.saved ? '' : '• '}${S.fileName} — লিখন বোর্ড`;
}
async function save(as) {
  const r = await native.saveBoard({ json: serialize(), suggested: exportName(), filePath: as ? null : S.filePath });
  if (!r) return;
  if (r !== 'download') { S.filePath = r; S.fileName = r.split(/[\\/]/).pop(); }
  S.saved = true;
  updateTitle();
  scheduleAutosave();
  toast('সেভ হয়েছে');
}
async function openFile() {
  if (!S.saved && !confirm('বর্তমান বোর্ডে সেভ না করা পরিবর্তন আছে। তবুও খুলবেন?')) return;
  const r = await native.openBoard();
  if (!r) return;
  try {
    load(r.json);
    S.filePath = r.filePath;
    S.fileName = r.filePath.split(/[\\/]/).pop();
    S.saved = true;
    updateTitle();
    scheduleAutosave();
  } catch { toast('ফাইলটি খোলা গেল না'); }
}
function newBoard() {
  if (!S.saved && page().els.length && !confirm('নতুন বোর্ড খুলবেন? সেভ না করা লেখা হারিয়ে যাবে।')) return;
  S.pages = [newPage()];
  S.filePath = null;
  S.fileName = 'নতুন বোর্ড';
  goPage(0);
  S.saved = true;
  updateTitle();
  scheduleAutosave();
}

// ───────────────────────── মেনু, পপআপ, শর্টকাট ─────────────────────────
function togglePop(sel, before) {
  const el = $(sel);
  const willShow = el.hidden;
  closePopups();
  if (willShow) { before && before(); el.hidden = false; }
}
function closePopups() { ['#menu', '#pagesPop', '#bgPop'].forEach((s) => ($(s).hidden = true)); }
$('#menuBtn').onclick = (e) => { e.stopPropagation(); togglePop('#menu'); };
$('#menu').addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.act;
  closePopups();
  ({ new: newBoard, open: openFile, save: () => save(false), saveas: () => save(true), png: exportPng, pdf: exportPdf,
     fullscreen: () => native.toggleFullscreen(), shortcuts: () => ($('#shortcutsDlg').hidden = false) })[a]?.();
});
$('#shortcutsDlg').addEventListener('click', (e) => { if (e.target === e.currentTarget || e.target.dataset.close !== undefined) $('#shortcutsDlg').hidden = true; });
$('#fsBtn').onclick = () => native.toggleFullscreen();
$('#zoomIn').onclick = () => setZoom(cam().z * 1.25);
$('#zoomOut').onclick = () => setZoom(cam().z / 1.25);
$('#zoomLabel').onclick = () => setZoom(1);
$('#zoomFit').onclick = zoomToFit;

const KEYS = { v: 'select', h: 'hand', p: 'pen', m: 'marker', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', g: 'triangle', t: 'text', k: 'laser' };
let clip = null;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target === ta) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (k === ' ' && !spaceDown) { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mod) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openFile(); }
    else if (k === 'n') { e.preventDefault(); newBoard(); }
    else if (k === 'a') { e.preventDefault(); setTool('select'); page().els.forEach((el) => S.sel.add(el.id)); updateProps(); requestRender(); }
    else if (k === 'd') { e.preventDefault(); duplicateSel(); }
    else if (k === 'c') { clip = page().els.filter((el) => S.sel.has(el.id)); }
    else if (k === '=' || k === '+') { e.preventDefault(); setZoom(cam().z * 1.25); }
    else if (k === '-') { e.preventDefault(); setZoom(cam().z / 1.25); }
    else if (k === '0') { e.preventDefault(); setZoom(1); }
    return;
  }
  if (k === 'delete' || k === 'backspace') { if (S.sel.size) { commit(page().els.filter((el) => !S.sel.has(el.id))); S.sel.clear(); updateProps(); } return; }
  if (k === 'escape') { S.sel.clear(); closePopups(); $('#connPanel').hidden = true; $('#shortcutsDlg').hidden = true; updateProps(); requestRender(); return; }
  if (k === 'pagedown') { e.preventDefault(); $('#pageNext').click(); return; }
  if (k === 'pageup') { e.preventDefault(); goPage(S.pi - 1); return; }
  if (k === 'f11') { e.preventDefault(); native.toggleFullscreen(); return; }
  if (e.key === '!' || (k === '1' && e.shiftKey)) { zoomToFit(); return; }
  if (e.key === '?') { $('#shortcutsDlg').hidden = false; return; }
  if (/^[1-9]$/.test(k)) { setColor(PEN_COLORS[Number(k) - 1]); return; }
  if (k === 'i') { $('#imgBtn').click(); return; }
  if (k === 'f' && SHAPE_TOOLS.includes(S.tool)) { $('#fillBtn').click(); return; }
  if (KEYS[k]) setTool(KEYS[k]);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });

function duplicateSel() {
  const src = page().els.filter((el) => S.sel.has(el.id));
  if (!src.length) return;
  const copies = src.map((el) => ({ ...translate(el, 24, 24), id: uid() }));
  commit([...page().els, ...copies]);
  S.sel = new Set(copies.map((c) => c.id));
  requestRender();
}

window.addEventListener('paste', (e) => {
  if (e.target === ta) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) {
    const r = new FileReader();
    r.onload = () => insertImage(r.result);
    r.readAsDataURL(item.getAsFile());
    return;
  }
  if (clip?.length) {
    const copies = clip.map((el) => ({ ...translate(el, 30, 30), id: uid() }));
    clip = copies;
    commit([...page().els, ...copies]);
    setTool('select');
    S.sel = new Set(copies.map((c) => c.id));
    updateProps();
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (!f) return;
  const r = new FileReader();
  r.onload = () => insertImage(r.result, toWorld(e.clientX, e.clientY));
  r.readAsDataURL(f);
});
window.addEventListener('beforeunload', () => { try { localStorage.setItem('likhon.autosave', serialize()); } catch {} });

let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 2400);
}

// ───────────────────────── মোবাইল প্যাড সংযোগ ─────────────────────────
// মোবাইল বোর্ডের একটা অংশ বড় করে দেখায়; সেখানে যা লেখা হয় তা বোর্ডের আসল জায়গায় (world স্থানাঙ্কে) আসে।
const pads = new Map(); // padId -> {name, strokes: Map, view}
let padList = [];
let ws = null;
let net = null;
const padCount = () => padList.length;

function connectBoard() {
  const port = net.port;
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=board&k=${encodeURIComponent(net.pin)}`);
  ws.onopen = () => { sendPadState(); resendDoc(); };
  ws.onmessage = (ev) => { try { onPadMsg(JSON.parse(ev.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { ws = null; setTimeout(connectBoard, 1500); };
}
function sendPads(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function getPad(id) { let P = pads.get(id); if (!P) { P = { name: '', strokes: new Map(), view: null }; pads.set(id, P); } return P; }

// বোর্ডের লেখা মোবাইলে পাঠানো: নতুন কিছু যোগ হলে শুধু সেটুকু, অন্য বদলে পুরোটা
let docV = 0, sentEls = null, sentPage = null, docT = 0;
const sentImgs = new Set();
const r1 = (v) => Math.round(v * 10) / 10;
function slimEl(el) {
  if (el.type === 'stroke') return { ...el, pts: el.pts.map((p) => [r1(p[0]), r1(p[1]), Math.round((p[2] ?? 0.5) * 100) / 100]) };
  if (el.type === 'image') {
    if (sentImgs.has(el.id)) { const { src, ...rest } = el; return rest; }
    sentImgs.add(el.id);
  }
  return el;
}
function scheduleDoc() { if (!docT) docT = setTimeout(syncDoc, 16); }
function syncDoc() {
  docT = 0;
  if (!padCount()) { sentEls = null; return; }
  const pg = page(), els = pg.els;
  if (sentEls && sentPage === pg.id && els.length >= sentEls.length && sentEls.every((e, i) => els[i] === e)) {
    if (els.length === sentEls.length) return;
    sendPads({ t: 'add', v: ++docV, page: pg.id, els: els.slice(sentEls.length).map(slimEl) });
  } else {
    sendPads({ t: 'doc', v: ++docV, page: pg.id, els: els.map(slimEl) });
  }
  sentEls = els;
  sentPage = pg.id;
}
function resendDoc() { sentEls = null; sentImgs.clear(); scheduleDoc(); }

let padStateT = 0;
function schedulePadState() { clearTimeout(padStateT); padStateT = setTimeout(sendPadState, 60); }
function viewRect() { const cm = cam(); return { x: cm.x, y: cm.y, w: VW / cm.z, h: VH / cm.z }; }
function sendPadState() {
  if (!net) return;
  sendPads({
    t: 'state',
    page: S.pi + 1, pages: S.pages.length, pageId: page().id,
    bg: page().bg.color, pattern: page().bg.pattern, dark: isDark(page().bg.color),
    view: viewRect(),
    canUndo: page().undo.length > 0, canRedo: page().redo.length > 0,
  });
}

// মোবাইলে লেখা বোর্ডের দেখা অংশের বাইরে গেলে বোর্ড সরে গিয়ে লেখাটা দেখায়
function followPoint(x, y) {
  // শুধু লেখা সত্যিই পর্দার বাইরে গেলে সরে
  const cm = cam(), m = 12 / cm.z, w = VW / cm.z, h = VH / cm.z;
  let moved = false;
  if (x > cm.x + w - m) { cm.x = x - w * 0.75; moved = true; }
  else if (x < cm.x + m) { cm.x = x - w * 0.25; moved = true; }
  if (y > cm.y + h - m) { cm.y = y - h * 0.75; moved = true; }
  else if (y < cm.y + m) { cm.y = y - h * 0.25; moved = true; }
  if (moved) { invalidate(); schedulePadState(); scheduleAutosave(); }
}

function onPadMsg(m) {
  if (m.t === 'pads') {
    const before = padList.length;
    padList = m.list;
    for (const id of [...pads.keys()]) if (!padList.some((p) => p.id === id)) pads.delete(id);
    for (const p of padList) getPad(p.id).name = p.name;
    updateConnUI();
    if (padList.length > before) { sendPadState(); resendDoc(); }
    requestRender();
    return;
  }
  if (m.t === 'join') { toast(`📱 ${m.name} যুক্ত হয়েছে`); getPad(m.pad).name = m.name; sendPadState(); resendDoc(); return; }
  if (m.t === 'leave') { pads.delete(m.pad); requestRender(); return; }
  if (!m.pad) return;
  const P = getPad(m.pad);

  switch (m.t) {
    case 'view':
      P.view = { x: m.x, y: m.y, w: m.w, h: m.h, page: m.page };
      requestRender();
      break;
    case 'need':
      resendDoc();
      sendPadState();
      break;
    case 'down': {
      const { x, y } = m;
      if (m.tool === 'laser') {
        const L = { pts: [{ x, y, t: performance.now() }], done: false };
        lasers.push(L);
        P.strokes.set(m.s, { type: 'laser', L });
      } else if (m.tool === 'eraser') {
        erasing.clear();
        const r = Math.max(2, m.w / 2);
        eraseAt(x, y, x, y, r);
        P.strokes.set(m.s, { type: 'eraser', last: [x, y], r });
      } else {
        P.strokes.set(m.s, {
          id: uid(), type: 'stroke', tool: m.tool === 'marker' ? 'marker' : 'pen',
          color: m.c || S.color, size: Math.max(0.5, m.w), pr: !!m.pr, pts: [[x, y, m.p ?? 0.5]],
        });
      }
      followPoint(x, y);
      requestRender();
      break;
    }
    case 'pts': {
      const s = P.strokes.get(m.s);
      if (!s) break;
      const d = m.d;
      for (let i = 0; i < d.length; i += 3) {
        const x = d[i], y = d[i + 1];
        if (s.type === 'stroke') s.pts.push([x, y, d[i + 2]]);
        else if (s.type === 'laser') s.L.pts.push({ x, y, t: performance.now() });
        else if (s.type === 'eraser') { eraseAt(s.last[0], s.last[1], x, y, s.r); s.last = [x, y]; }
      }
      if (d.length >= 3) followPoint(d[d.length - 3], d[d.length - 2]);
      requestRender();
      break;
    }
    case 'up': {
      const s = P.strokes.get(m.s);
      P.strokes.delete(m.s);
      if (!s) break;
      if (s.type === 'stroke') addEl(s);
      else if (s.type === 'laser') s.L.done = true;
      else if (s.type === 'eraser') {
        if (erasing.size) commit(page().els.filter((x) => !erasing.has(x.id)));
        erasing.clear();
        invalidate();
        scheduleDoc();
      }
      requestRender();
      break;
    }
    case 'cancel': {
      const s = P.strokes.get(m.s);
      P.strokes.delete(m.s);
      if (s && s.type === 'eraser') erasing.clear();
      if (s && s.type === 'laser') s.L.done = true;
      invalidate();
      break;
    }
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'clear': if (page().els.length) commit([]); break;
    case 'page':
      if (m.a === 'next') S.pi === S.pages.length - 1 ? addPage() : goPage(S.pi + 1);
      else if (m.a === 'prev') goPage(S.pi - 1);
      else if (m.a === 'new') addPage();
      break;
    case 'hello':
      P.name = m.name || P.name;
      sendPadState();
      resendDoc();
      break;
  }
}

function updateConnUI() {
  const n = padList.length;
  $('#connDot').className = 'dot' + (n ? ' on' : '');
  $('#connText').textContent = n ? (n === 1 ? padList[0].name : `${bn(n)}টি মোবাইল`) + ' যুক্ত' : 'মোবাইল সংযোগ';
  $('#devices').innerHTML = padList.map((p) => `<div class="device">${escapeHtml(p.name)} — যুক্ত আছে</div>`).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function padUrl() {
  const ip = $('#ipSelect').value || (net.ips[0] && net.ips[0].address) || 'localhost';
  return `http://${ip}:${net.port}/pad/?k=${net.pin}`;
}
function drawQr() {
  const url = padUrl();
  $('#addrText').textContent = url.replace(/^http:\/\//, '').replace(/\/pad\/\?.*/, '');
  $('#pinText').textContent = net.pin;
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  const n = q.getModuleCount(), cv = $('#qr'), c = cv.getContext('2d');
  const quiet = 2, cell = Math.floor(cv.width / (n + quiet * 2));
  const off = Math.floor((cv.width - cell * n) / 2);
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#111';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(off + k * cell, off + r * cell, cell, cell);
}
async function initNet() {
  net = await native.netInfo();
  const sel = $('#ipSelect');
  sel.innerHTML = net.ips.length
    ? net.ips.map((i) => `<option value="${i.address}">${i.address} (${escapeHtml(i.name)})</option>`).join('')
    : '<option value="">কোনো নেটওয়ার্ক পাওয়া যায়নি — WiFi চালু করুন</option>';
  sel.onchange = drawQr;
  drawQr();
  connectBoard();
}
$('#connBtn').onclick = () => { closePopups(); $('#connPanel').hidden = !$('#connPanel').hidden; if (!$('#connPanel').hidden) refreshIps(); };
$('#connClose').onclick = () => ($('#connPanel').hidden = true);
async function refreshIps() {
  const n = await native.netInfo();
  if (JSON.stringify(n.ips) !== JSON.stringify(net.ips)) { const keep = $('#ipSelect').value; net.ips = n.ips; await initSelect(keep); }
}
async function initSelect(keep) {
  const sel = $('#ipSelect');
  sel.innerHTML = net.ips.map((i) => `<option value="${i.address}">${i.address} (${escapeHtml(i.name)})</option>`).join('');
  if (keep && net.ips.some((i) => i.address === keep)) sel.value = keep;
  drawQr();
}
$('#pinNew').onclick = async () => {
  net.pin = await native.newPin();
  drawQr();
  if (ws) ws.close();
  toast('নতুন পিন: ' + net.pin + ' — মোবাইলে আবার স্ক্যান করুন');
};
$('#showPadView').onchange = (e) => { S.showPadView = e.target.checked; requestRender(); };
$('#sendView').onclick = () => { sendPads({ t: 'goto', rect: viewRect(), page: page().id }); toast('মোবাইলে এখন বোর্ডের এই অংশ দেখা যাবে'); };

// ───────────────────────── শুরু ─────────────────────────
function boot() {
  buildSwatches();
  buildBgUI();
  try {
    const saved = localStorage.getItem('likhon.autosave');
    if (saved) {
      load(saved);
      const meta = JSON.parse(localStorage.getItem('likhon.meta') || '{}');
      S.filePath = meta.filePath || null;
      S.fileName = meta.fileName || 'নতুন বোর্ড';
      S.saved = meta.saved !== false;
    }
  } catch { S.pages = [newPage()]; S.pi = 0; }
  setImageLoadHandler(invalidate);
  resize();
  setTool('pen');
  updatePageLabel();
  updateUndoButtons();
  updateBgUI();
  updateTitle();
  afterZoom();
  initNet().catch((err) => { console.error(err); toast('মোবাইল সংযোগ চালু করা যায়নি'); });
}
boot();

// পরীক্ষার জন্য
window.__likhon = { S, page, onPadMsg };
