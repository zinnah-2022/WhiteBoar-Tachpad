// লিখন প্যাড — মোবাইলে বোর্ডের একটা অংশ বড় করে দেখায়; যেখানে খুশি লেখা যায়।
// প্যাড নিজে থেকে কখনো সরে না — শুধু দুই আঙুলে (বা "সরান" টুলে) টানলে সরে।
import { drawEl, drawPattern, setImageLoadHandler, hit } from '../shared/draw.mjs';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const q = new URLSearchParams(location.search);
const app = window.LikhonApp || null; // অ্যান্ড্রয়েড অ্যাপের ভেতরে থাকলে
let booted = false;
const buzz = (ms = 8) => { if (!booted) return; try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

const COLORS = ['#1b2130', '#e0393e', '#f08c00', '#f5c400', '#18a058', '#1c7ed6', '#3a56f5', '#9c36b5', '#ffffff'];
const PALETTE = [
  '#000000', '#1b2130', '#495057', '#868e96', '#ced4da', '#ffffff',
  '#c92a2a', '#e0393e', '#ff6b6b', '#d9480f', '#f08c00', '#fab005',
  '#f5c400', '#82c91e', '#18a058', '#0ca678', '#1098ad', '#1c7ed6',
  '#3a56f5', '#5f3dc4', '#9c36b5', '#d6336c', '#a0522d', '#5c3d2e',
];
// কলমের মোটা — বোর্ডের এককে (বোর্ডে ঠিক এই মাপেই আসবে)
const WIDTH = { pen: [2, 3.5, 6], marker: [12, 20, 30], eraser: [12, 26, 54], laser: [4, 4, 4], hand: [0, 0, 0] };
// প্যাডে স্বাভাবিক অবস্থায় বোর্ডের কত উঁচু অংশ দেখা যাবে
const DEFAULT_VIEW_H = 320;

const P = {
  tool: 'pen',
  sizeIdx: { pen: 1, marker: 1, eraser: 1, laser: 0, hand: 0 },
  color: COLORS[0],
  st: { page: 1, pages: 1, pageId: null, bg: '#ffffff', pattern: 'grid', dark: false, view: null, canUndo: false, canRedo: false },
  els: [],
  docV: 0,
  cams: new Map(), // pageId -> {x,y,z}
};
const imgSrc = new Map(); // element id -> src

// ───────────── ক্যানভাস ─────────────
const cv = $('#pad');
const ctx = cv.getContext('2d');
const scv = document.createElement('canvas'); // স্থির স্তর
const sctx = scv.getContext('2d');
let W = 0, H = 0, dpr = 1, raf = 0, staticDirty = true;

function cam() {
  const id = P.st.pageId || '_';
  let c = P.cams.get(id);
  if (!c) {
    const z = H ? H / DEFAULT_VIEW_H : 1.5;
    const v = P.st.view;
    c = v ? { x: v.x + v.w * 0.06, y: v.y + v.h * 0.1, z } : { x: 0, y: 0, z };
    P.cams.set(id, c);
  }
  return c;
}
const defaultZ = () => (H ? H / DEFAULT_VIEW_H : 1.5);
const toWorld = (sx, sy) => { const c = cam(); return [sx / c.z + c.x, sy / c.z + c.y]; };

function layout() {
  const r = $('#stage').getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  for (const c of [cv, scv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  staticDirty = true;
  draw();
  sendView();
  updateZoomLabel();
}
new ResizeObserver(layout).observe($('#stage'));

function invalidate() { staticDirty = true; requestDraw(); }
function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }

function drawStatic() {
  const c = cam();
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.fillStyle = P.st.bg || '#ffffff';
  sctx.fillRect(0, 0, W, H);
  drawPattern(sctx, { color: P.st.bg, pattern: P.st.pattern || 'grid' }, c, W, H);
  sctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);
  for (const el of P.els) {
    const e = el.type === 'image' && !el.src ? { ...el, src: imgSrc.get(el.id) } : el;
    if (e.type === 'image' && !e.src) continue;
    drawEl(sctx, e, erasing.has(el.id) ? 0.2 : 1);
  }
  staticDirty = false;
}

function draw() {
  raf = 0;
  if (!W) return;
  if (staticDirty) drawStatic();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scv, 0, 0);
  const c = cam();
  ctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);

  // কম্পিউটারের পর্দায় যে অংশ দেখা যাচ্ছে
  const v = P.st.view;
  if (v) {
    ctx.save();
    ctx.strokeStyle = P.st.dark ? 'rgba(255,255,255,0.35)' : 'rgba(40,55,110,0.35)';
    ctx.lineWidth = 1.5 / c.z;
    ctx.setLineDash([10 / c.z, 7 / c.z]);
    ctx.strokeRect(v.x, v.y, v.w, v.h);
    ctx.restore();
  }

  // নিজের চলমান ও সদ্য-শেষ স্ট্রোক (বোর্ড থেকে নিশ্চিত হওয়া পর্যন্ত)
  for (const s of pending) drawEl(ctx, s.el);
  if (cur && cur.el) drawEl(ctx, { ...cur.el }, 1);

  // লেজার
  const now = performance.now();
  let alive = false;
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    L.pts = L.pts.filter((p) => now - p.t < 650);
    if (!L.pts.length && L.done) { lasers.splice(i, 1); continue; }
    alive = true;
    for (let k = 1; k < L.pts.length; k++) {
      const a = 1 - (now - L.pts[k].t) / 650;
      ctx.strokeStyle = `rgba(255,40,60,${a})`;
      ctx.lineWidth = (2 + 5 * a) / c.z;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L.pts[k - 1].x, L.pts[k - 1].y); ctx.lineTo(L.pts[k].x, L.pts[k].y); ctx.stroke();
    }
  }
  if (alive) requestDraw();

  if (eraserAt) {
    ctx.strokeStyle = P.st.dark ? 'rgba(255,255,255,.75)' : 'rgba(30,40,60,.6)';
    ctx.lineWidth = 1.5 / c.z;
    ctx.beginPath(); ctx.arc(eraserAt[0], eraserAt[1], eraserAt[2], 0, 7); ctx.stroke();
  }
}
const lasers = [];
let eraserAt = null;
const erasing = new Set();
setImageLoadHandler(invalidate);

// ───────────── সংযোগ ─────────────
let ws = null, retry = 0, openedOnce = false, fatal = false, discT = 0;
function deviceName() {
  const saved = q.get('name') || localStorage.getItem('likhon.name');
  if (saved) return saved;
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/);
  return m ? m[1].trim() : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'মোবাইল';
}
function connect() {
  if (fatal) return;
  const url = `ws://${location.host}/ws?role=pad&k=${encodeURIComponent(q.get('k') || '')}&name=${encodeURIComponent(deviceName())}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 0; openedOnce = true;
    clearTimeout(discT);
    setStatus('on', `সংযুক্ত · ${location.hostname}`);
    $('#overlay').hidden = true;
    send({ t: 'hello', name: deviceName() });
    sendView(true);
    try { localStorage.setItem('likhon.last', location.href); } catch {}
    app && app.onConnected && app.onConnected(location.href);
  };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = (e) => {
    ws = null;
    if (e.code === 4001 || e.code === 4002) {
      fatal = true;
      setStatus('off', 'পিন মেলেনি');
      showOverlay('পিন মেলেনি', e.code === 4002 ? 'কম্পিউটারে নতুন পিন তৈরি করা হয়েছে। নতুন QR কোড স্ক্যান করুন।' : 'কম্পিউটারের লিখন বোর্ডে “মোবাইল সংযোগ” খুলে QR কোড আবার স্ক্যান করুন।', true);
      return;
    }
    setStatus('off', 'সংযোগ নেই');
    clearTimeout(discT);
    discT = setTimeout(() => showOverlay(openedOnce ? 'সংযোগ বিচ্ছিন্ন' : 'সংযোগ হচ্ছে না', 'কম্পিউটারে লিখন বোর্ড খোলা আছে এবং দুটো একই WiFi-তে আছে কিনা দেখুন। আবার চেষ্টা হচ্ছে…', !!app), 1200);
    setTimeout(connect, Math.min(5000, 600 + retry++ * 700));
  };
  ws.onerror = () => {};
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function setStatus(kind, text) { $('#dot').className = 'dot ' + kind; $('#statusText').textContent = text; }
function showOverlay(title, text, showBtn) {
  $('#ovTitle').textContent = title;
  $('#ovText').textContent = text;
  $('#ovSpin').hidden = fatal;
  $('#ovBtn').hidden = !(showBtn && app);
  $('#overlay').hidden = false;
}
$('#ovBtn').onclick = () => app && app.rescan();

let viewT = 0;
function sendView(now) {
  const go = () => {
    viewT = 0;
    if (!W || !P.st.pageId) return;
    const c = cam();
    send({ t: 'view', x: c.x, y: c.y, w: W / c.z, h: H / c.z, page: P.st.pageId });
  };
  if (now) { clearTimeout(viewT); go(); } else if (!viewT) viewT = setTimeout(go, 70);
}

let needT = 0;
function askFull() { if (needT) return; needT = setTimeout(() => (needT = 0), 800); send({ t: 'need' }); }
function rememberImages(els) { for (const e of els) if (e.type === 'image' && e.src) imgSrc.set(e.id, e.src); }

function onMsg(m) {
  if (m.t === 'state') {
    const prev = P.st.pageId;
    P.st = { ...P.st, ...m };
    $('#pgLabel').textContent = `${bn(P.st.page)}/${bn(P.st.pages)}`;
    $('#pgPrev').disabled = P.st.page <= 1;
    $('#undoBtn').disabled = !P.st.canUndo;
    $('#redoBtn').disabled = !P.st.canRedo;
    // কালো বোর্ডে কালো কালি দেখা যায় না — নিজে থেকে সাদা
    if (P.st.dark && P.color === '#1b2130') setColor('#ffffff');
    if (!P.st.dark && P.color === '#ffffff') setColor('#1b2130');
    if (m.pageId !== prev) { pending.length = 0; sendView(true); updateZoomLabel(); }
    invalidate();
    return;
  }
  if (m.t === 'doc') {
    P.els = m.els;
    P.docV = m.v;
    rememberImages(m.els);
    if (m.els.some((e) => e.type === 'image' && !e.src && !imgSrc.has(e.id))) askFull();
    settle(m.v);
    return;
  }
  if (m.t === 'add') {
    if (m.page !== P.st.pageId || m.v !== P.docV + 1) { askFull(); return; }
    P.els = P.els.concat(m.els);
    P.docV = m.v;
    rememberImages(m.els);
    settle(m.v);
    return;
  }
  if (m.t === 'goto' && m.rect) {
    const c = cam();
    c.x = m.rect.x + m.rect.w * 0.06;
    c.y = m.rect.y + m.rect.h * 0.1;
    afterMove();
    buzz(12);
  }
}
// বোর্ড থেকে নতুন লেখা এলে সাময়িক স্ট্রোকগুলো সরিয়ে দিই
function settle(v) {
  for (let i = pending.length - 1; i >= 0; i--) if (v > pending[i].v) pending.splice(i, 1);
  erasing.clear();
  invalidate();
}

// ───────────── ইনপুট ─────────────
let cur = null;
let seq = 0;
let buf = [];
let flushRaf = 0;
let penSeen = false;
const pending = []; // {el, v}
const touches = new Map();
let gesture = null; // দুই আঙুল বা সরানো

function flush() {
  flushRaf = 0;
  if (cur && buf.length) send({ t: 'pts', s: cur.s, d: buf });
  buf = [];
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function localPt(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

function startGesture() {
  const pts = [...touches.values()];
  const c = cam();
  if (pts.length >= 2) {
    const [a, b] = pts;
    gesture = { mode: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, c0: { ...c } };
  } else if (pts.length === 1) {
    gesture = { mode: 'pan', sx: pts[0][0], sy: pts[0][1], c0: { ...c } };
  }
}
function updateGesture() {
  const pts = [...touches.values()];
  const c = cam();
  if (!gesture) return;
  if (gesture.mode === 'pinch' && pts.length >= 2) {
    const [a, b] = pts;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const g = gesture;
    const z = clamp(g.c0.z * (d / g.d), defaultZ() * 0.15, defaultZ() * 4);
    const wx = g.mx / g.c0.z + g.c0.x, wy = g.my / g.c0.z + g.c0.y;
    c.z = z; c.x = wx - mx / z; c.y = wy - my / z;
  } else if (gesture.mode === 'pan' && pts.length === 1) {
    c.x = gesture.c0.x - (pts[0][0] - gesture.sx) / c.z;
    c.y = gesture.c0.y - (pts[0][1] - gesture.sy) / c.z;
  }
  afterMove();
}
function afterMove() { invalidate(); sendView(); updateZoomLabel(); }

cv.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (e.pointerType === 'pen') penSeen = true;
  const pt = localPt(e);
  $('#hint').classList.add('gone');

  if (e.pointerType === 'touch' || P.tool === 'hand') {
    touches.set(e.pointerId, pt);
    cv.setPointerCapture(e.pointerId);
    // দুই আঙুল = সরানো/জুম; স্টাইলাস থাকলে এক আঙুলেও সরানো; "সরান" টুলেও সরানো
    if (touches.size >= 2) { cancelStroke(); startGesture(); return; }
    if (P.tool === 'hand' || (penSeen && e.pointerType === 'touch')) { startGesture(); return; }
    if (cur) return;
  }
  if (cur) return;
  cv.setPointerCapture(e.pointerId);
  const [x, y] = toWorld(pt[0], pt[1]);
  const pr = e.pointerType === 'pen' && e.pressure > 0;
  const p = pr ? e.pressure : 0.5;
  const w = WIDTH[P.tool][P.sizeIdx[P.tool]];
  cur = { s: ++seq, pid: e.pointerId, tool: P.tool, sent: false };
  if (P.tool === 'pen' || P.tool === 'marker') {
    cur.el = { type: 'stroke', tool: P.tool, color: P.color, size: w, pr, pts: [[x, y, p]] };
  } else if (P.tool === 'laser') {
    cur.L = { pts: [{ x, y, t: performance.now() }], done: false };
    lasers.push(cur.L);
  } else if (P.tool === 'eraser') {
    cur.r = w / 2;
    eraseLocal(x, y, cur.r);
    eraserAt = [x, y, cur.r];
  }
  // প্রথম বিন্দু একটু পরে পাঠাই, যাতে দুই আঙুলের সরানো শুরু হলে ভুল দাগ না পড়ে
  cur.first = { t: 'down', s: cur.s, tool: P.tool, c: P.color, w, x: r1(x), y: r1(y), p: r2(p), pr };
  cur.timer = setTimeout(sendFirst, e.pointerType === 'touch' ? 45 : 0);
  requestDraw();
});
function sendFirst() {
  if (!cur || cur.sent) return;
  cur.sent = true;
  clearTimeout(cur.timer);
  send(cur.first);
}

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
    const p = cur.el && cur.el.pr ? ev.pressure || 0.5 : 0.5;
    if (cur.el) cur.el.pts.push([x, y, p]);
    else if (cur.L) cur.L.pts.push({ x, y, t: performance.now() });
    else if (cur.tool === 'eraser') { eraseLocal(x, y, cur.r); eraserAt = [x, y, cur.r]; }
    buf.push(r1(x), r1(y), r2(p));
  }
  if (cur.sent && !flushRaf) flushRaf = requestAnimationFrame(flush);
  else if (!cur.sent && buf.length > 6) { sendFirst(); flush(); }
  requestDraw();
});

function endPointer(e) {
  if (touches.has(e.pointerId)) {
    touches.delete(e.pointerId);
    if (gesture) {
      if (touches.size) startGesture(); else gesture = null;
      return;
    }
  }
  if (!cur || e.pointerId !== cur.pid) return;
  sendFirst();
  flush();
  send({ t: 'up', s: cur.s });
  if (cur.el) pending.push({ el: cur.el, v: P.docV });
  if (cur.L) cur.L.done = true;
  cur = null;
  eraserAt = null;
  requestDraw();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

function cancelStroke() {
  if (!cur) return;
  clearTimeout(cur.timer);
  if (cur.sent) { flush(); send({ t: 'cancel', s: cur.s }); }
  buf = [];
  if (cur.L) cur.L.done = true;
  cur = null;
  eraserAt = null;
  if (erasing.size) { erasing.clear(); invalidate(); }
  requestDraw();
}

function eraseLocal(x, y, r) {
  let added = false;
  for (const el of P.els) {
    if (erasing.has(el.id)) continue;
    if (hit(el, x, y, r)) { erasing.add(el.id); added = true; }
  }
  if (added) invalidate();
}

// ───────────── জুম ─────────────
function zoomBy(f) {
  const c = cam();
  const wx = W / 2 / c.z + c.x, wy = H / 2 / c.z + c.y;
  c.z = clamp(c.z * f, defaultZ() * 0.15, defaultZ() * 4);
  c.x = wx - W / 2 / c.z; c.y = wy - H / 2 / c.z;
  afterMove();
  buzz();
}
function updateZoomLabel() { if (H) $('#zoomLabel').textContent = bn(Math.round((cam().z / defaultZ()) * 100)) + '%'; }
$('#zoomIn').onclick = () => zoomBy(1.25);
$('#zoomOut').onclick = () => zoomBy(1 / 1.25);
$('#zoomLabel').onclick = () => { const c = cam(); zoomBy(defaultZ() / c.z); };
// কম্পিউটারের পর্দায় যা দেখা যাচ্ছে পুরোটা মোবাইলে
$('#fitBtn').onclick = () => {
  const v = P.st.view;
  if (!v) return;
  const c = cam();
  c.z = clamp(Math.min(W / v.w, H / v.h), defaultZ() * 0.15, defaultZ() * 4);
  c.x = v.x + v.w / 2 - W / 2 / c.z;
  c.y = v.y + v.h / 2 - H / 2 / c.z;
  afterMove();
  buzz();
};

// ───────────── নিয়ন্ত্রণ ─────────────
function setTool(t) {
  P.tool = t;
  $$('.tb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $$('#sizes button').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === P.sizeIdx[t]));
  $('#sizes').style.visibility = t === 'laser' || t === 'hand' ? 'hidden' : '';
  buzz();
}
$$('.tb[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$$('#sizes button').forEach((b) => (b.onclick = () => { P.sizeIdx[P.tool] = Number(b.dataset.i); setTool(P.tool); }));

function buildColors() {
  const box = $('#colors');
  box.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = c; b.dataset.c = c;
    b.onclick = () => setColor(c);
    box.append(b);
  }
  const pal = $('#palette');
  pal.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = c; b.dataset.c = c;
    b.onclick = () => { setColor(c); $('#colorSheet').hidden = true; };
    pal.append(b);
  }
}
function setColor(c) {
  P.color = c;
  if (['eraser', 'laser', 'hand'].includes(P.tool)) setTool('pen');
  $$('.sw').forEach((b) => b.classList.toggle('active', b.dataset.c === c));
  $('#moreColors').classList.toggle('active', !COLORS.includes(c));
  $('#moreColors').style.background = COLORS.includes(c) ? '' : c;
  buzz(5);
}
$('#moreColors').onclick = () => ($('#colorSheet').hidden = false);
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) s.hidden = true; }));

$('#undoBtn').onclick = () => { send({ t: 'undo' }); buzz(); };
$('#redoBtn').onclick = () => { send({ t: 'redo' }); buzz(); };
$('#pgPrev').onclick = () => { send({ t: 'page', a: 'prev' }); buzz(); };
$('#pgNext').onclick = () => { send({ t: 'page', a: 'next' }); buzz(); };
$('#moreBtn').onclick = () => ($('#moreSheet').hidden = false);
$('#newPageBtn').onclick = () => { send({ t: 'page', a: 'new' }); $('#moreSheet').hidden = true; };
$('#clearBtn').onclick = () => {
  if (!confirm('বোর্ডের এই পেজের সব লেখা মুছে যাবে। নিশ্চিত?')) return;
  send({ t: 'clear' });
  $('#moreSheet').hidden = true;
};
$('#reconnectBtn').onclick = () => { fatal = false; $('#moreSheet').hidden = true; if (ws) ws.close(); else connect(); };
if (app) {
  $('#scanBtn').hidden = false;
  $('#scanBtn').onclick = () => app.rescan();
}

// স্ক্রিন জাগিয়ে রাখা
async function keepAwake() { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (!ws && !fatal) connect(); } });

// ───────────── শুরু ─────────────
buildColors();
setColor(COLORS[0]);
setTool('pen');
setTimeout(() => $('#hint').classList.add('gone'), 5000);
layout();
keepAwake();
connect();
booted = true;
window.__pad = { P, cam };
