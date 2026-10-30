// লিখন প্যাড — মোবাইলের লেখার প্যাড
import { getStroke } from '../vendor/perfect-freehand.mjs';

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
// প্রস্থ: লাইন মোডে লাইনের উচ্চতার ভগ্নাংশ, ফ্রি মোডে বোর্ডের উচ্চতার ভগ্নাংশ
const WIDTH = {
  line: { pen: [0.045, 0.07, 0.105], marker: [0.28, 0.4, 0.55], eraser: [0.15, 0.3, 0.55], laser: [0.06, 0.06, 0.06] },
  free: { pen: [0.0035, 0.006, 0.011], marker: [0.02, 0.03, 0.045], eraser: [0.025, 0.05, 0.1], laser: [0.01, 0.01, 0.01] },
};

const P = {
  mode: localStorage.getItem('likhon.mode') || 'line',
  tool: 'pen',
  sizeIdx: { pen: 1, marker: 1, eraser: 1, laser: 0 },
  color: COLORS[0],
  board: { page: 1, pages: 1, dark: false, bg: '#ffffff', max: 8, aspect: 16 / 9, canUndo: false, canRedo: false },
  scrollX: 0,
  line: [],   // এই লাইনের স্ট্রোক (লোকাল প্রদর্শন)
  free: [],   // ফ্রি মোডের স্ট্রোক
  redo: [],
};

// ───────────── ক্যানভাস ও জ্যামিতি ─────────────
const cv = $('#pad');
const ctx = cv.getContext('2d');
let W = 0, H = 0, dpr = 1, raf = 0;
const G = { top: 0, sh: 0, fx: 0, fy: 0, fw: 0, fh: 0 };

function layout() {
  const r = $('#stage').getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  // লাইন মোড: লেখার পট্টি
  G.sh = Math.min(H - 24, W * 0.6);
  G.top = (H - G.sh) / 2;
  // ফ্রি মোড: বোর্ডের অনুপাতে
  const a = P.board.aspect || 16 / 9;
  G.fw = Math.min(W - 16, (H - 16) * a);
  G.fh = G.fw / a;
  G.fx = (W - G.fw) / 2; G.fy = (H - G.fh) / 2;
  draw();
}
new ResizeObserver(layout).observe($('#stage'));

const unitsVisible = () => W / G.sh;

// স্ক্রিন পিক্সেল → নরমালাইজড
function toN(px, py) {
  if (P.mode === 'line') return [px / G.sh + P.scrollX, (py - G.top) / G.sh];
  return [(px - G.fx) / G.fw, (py - G.fy) / G.fh];
}
function toPx(s, x, y) {
  if (s.m === 'line') return [(x - P.scrollX) * G.sh, G.top + y * G.sh];
  return [G.fx + x * G.fw, G.fy + y * G.fh];
}
const scaleOf = (m) => (m === 'line' ? G.sh : G.fh);

function svgPath(pts) {
  const n = pts.length;
  if (n < 4) return '';
  let a = pts[0], b = pts[1];
  const c = pts[2];
  let d = `M${a[0]},${a[1]} Q${b[0]},${b[1]} ${(b[0] + c[0]) / 2},${(b[1] + c[1]) / 2} T`;
  for (let i = 2; i < n - 1; i++) { a = pts[i]; b = pts[i + 1]; d += `${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2} `; }
  return d + 'Z';
}
function strokePath(s, done) {
  const pts = s.pts.map((p) => { const [x, y] = toPx(s, p[0], p[1]); return [x, y, s.tool === 'marker' ? 0.5 : p[2]]; });
  const opt = s.tool === 'marker'
    ? { size: s.w * scaleOf(s.m), thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last: done }
    : { size: s.w * scaleOf(s.m), thinning: 0.6, smoothing: 0.55, streamline: 0.4, simulatePressure: !s.pr, last: done };
  return new Path2D(svgPath(getStroke(pts, opt)));
}

function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }
function draw() {
  raf = 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dark = P.board.dark;
  const paper = P.board.bg || '#ffffff';
  ctx.fillStyle = dark ? '#0d111d' : '#e9ebf1';
  ctx.fillRect(0, 0, W, H);

  if (P.mode === 'line') {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
    // পট্টি
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(58,86,245,0.035)';
    ctx.fillRect(0, G.top, W, G.sh);
    const line = (y, a, dash) => {
      ctx.save();
      ctx.strokeStyle = dark ? `rgba(255,255,255,${a})` : `rgba(40,55,110,${a})`;
      ctx.lineWidth = 1;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke();
      ctx.restore();
    };
    line(G.top, 0.22);
    line(G.top + G.sh, 0.22);
    line(G.top + G.sh * 0.25, 0.12, [6, 6]); // মাত্রা
    line(G.top + G.sh * 0.78, 0.2);         // বেসলাইন
    // বোর্ডের লাইনের শেষ সীমা
    const lim = (P.board.max - P.scrollX) * G.sh;
    if (lim < W) {
      ctx.fillStyle = 'rgba(255,70,85,0.08)';
      ctx.fillRect(Math.max(0, lim), G.top, W - Math.max(0, lim), G.sh);
      if (lim > 0) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,70,85,0.6)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(lim, G.top); ctx.lineTo(lim, G.top + G.sh); ctx.stroke(); ctx.restore();
        ctx.fillStyle = 'rgba(255,70,85,0.8)'; ctx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
        ctx.fillText('লাইন শেষ', Math.min(lim + 6, W - 60), G.top + 16);
      }
    }
    // কতটুকু সরানো হয়েছে তার নির্দেশক
    if (P.scrollX > 0.01) {
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(40,55,110,0.35)';
      ctx.beginPath(); ctx.moveTo(8, G.top + G.sh / 2 - 8); ctx.lineTo(2, G.top + G.sh / 2); ctx.lineTo(8, G.top + G.sh / 2 + 8); ctx.fill();
    }
  } else {
    ctx.fillStyle = paper;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 12;
    ctx.fillRect(G.fx, G.fy, G.fw, G.fh);
    ctx.restore();
  }

  ctx.save();
  if (P.mode === 'free') { ctx.beginPath(); ctx.rect(G.fx, G.fy, G.fw, G.fh); ctx.clip(); }
  for (const s of P.mode === 'line' ? P.line : P.free) {
    ctx.globalAlpha = s.tool === 'marker' ? 0.38 : 1;
    ctx.fillStyle = s.c;
    ctx.fill(strokePath(s, !s.live));
  }
  ctx.restore();

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
      ctx.strokeStyle = `rgba(255,40,60,${a})`; ctx.lineWidth = 2 + 5 * a; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L.pts[k - 1].x, L.pts[k - 1].y); ctx.lineTo(L.pts[k].x, L.pts[k].y); ctx.stroke();
    }
  }
  if (alive) requestDraw();

  // ইরেজারের বৃত্ত
  if (eraserAt) {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.7)' : 'rgba(30,40,60,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(eraserAt[0], eraserAt[1], eraserAt[2], 0, 7); ctx.stroke();
  }
}
const lasers = [];
let eraserAt = null;

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
    try { localStorage.setItem('likhon.last', location.href); } catch {}
    app && app.onConnected && app.onConnected(location.href);
  };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
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

function onMsg(m) {
  if (m.t !== 'state') return;
  const prevPage = P.board.page;
  const aspectChanged = Math.abs((m.aspect || 0) - P.board.aspect) > 0.01;
  P.board = { ...P.board, ...m };
  if (m.page !== prevPage) { P.line = []; P.free = []; P.redo = []; P.scrollX = 0; }
  $('#pgLabel').textContent = `${bn(P.board.page)}/${bn(P.board.pages)}`;
  $('#pgPrev').disabled = P.board.page <= 1;
  $('#undoBtn').disabled = !P.board.canUndo && !P.line.length;
  $('#redoBtn').disabled = !P.board.canRedo;
  // কালো বোর্ডে কালো কালি অদৃশ্য — স্বয়ংক্রিয়ভাবে সাদা
  if (P.board.dark && P.color === '#1b2130') setColor('#ffffff');
  if (!P.board.dark && P.color === '#ffffff') setColor('#1b2130');
  if (aspectChanged) layout(); else requestDraw();
}

// ───────────── আঁকা (ইনপুট) ─────────────
let cur = null;         // বর্তমান স্ট্রোক
let seq = 0;
let pending = [];
let flushRaf = 0;
let penSeen = false;
const touches = new Map();
let scrollDrag = null;
let autoScrollT = 0;

function flush() {
  flushRaf = 0;
  if (cur && pending.length) send({ t: 'pts', s: cur.s, d: pending });
  pending = [];
}
const r4 = (v) => Math.round(v * 10000) / 10000;

cv.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (e.pointerType === 'pen') penSeen = true;
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, e.clientX);
    // দুই আঙুল: লেখা বাতিল করে স্ক্রল
    if (touches.size >= 2 || (penSeen && P.mode === 'line')) {
      if (cur && cur.pid !== undefined && touches.size >= 2) cancelStroke();
      if (P.mode === 'line') scrollDrag = { x: e.clientX, sx: P.scrollX };
      return;
    }
    if (penSeen) return; // স্টাইলাস থাকলে হাতের তালু উপেক্ষা
  }
  if (cur) return;
  cv.setPointerCapture(e.pointerId);
  clearTimeout(autoScrollT);
  $('#hint').classList.add('gone');
  const r = cv.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const [x, y] = toN(px, py);
  const pr = e.pointerType === 'pen' && e.pressure > 0;
  const p = pr ? e.pressure : 0.5;
  const w = WIDTH[P.mode][P.tool][P.sizeIdx[P.tool]];
  cur = { s: ++seq, pid: e.pointerId, tool: P.tool, c: P.color, w, m: P.mode, pr, pts: [[x, y, p]], live: true };
  if (P.tool === 'pen' || P.tool === 'marker') {
    (P.mode === 'line' ? P.line : P.free).push(cur);
    P.redo = [];
  } else if (P.tool === 'laser') {
    cur.L = { pts: [{ x: px, y: py, t: performance.now() }], done: false };
    lasers.push(cur.L);
  } else if (P.tool === 'eraser') {
    eraseLocal(x, y, w / 2);
    eraserAt = [px, py, (w * scaleOf(P.mode)) / 2];
  }
  send({ t: 'down', s: cur.s, tool: P.tool, c: P.color, w, m: P.mode, x: r4(x), y: r4(y), p: r4(p), pr });
  requestDraw();
});

cv.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, e.clientX);
    if (scrollDrag) {
      const xs = [...touches.values()];
      const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
      if (scrollDrag.avg === undefined) scrollDrag.avg = avg;
      P.scrollX = Math.max(0, scrollDrag.sx - (avg - scrollDrag.avg) / G.sh);
      requestDraw();
      return;
    }
  }
  if (!cur || e.pointerId !== cur.pid) return;
  const r = cv.getBoundingClientRect();
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  for (const ev of evs.length ? evs : [e]) {
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const [x, y] = toN(px, py);
    const p = cur.pr ? ev.pressure || 0.5 : 0.5;
    if (cur.tool === 'pen' || cur.tool === 'marker') cur.pts.push([x, y, p]);
    else if (cur.tool === 'laser') cur.L.pts.push({ x: px, y: py, t: performance.now() });
    else if (cur.tool === 'eraser') { eraseLocal(x, y, cur.w / 2); eraserAt = [px, py, eraserAt[2]]; }
    pending.push(r4(x), r4(y), r4(p));
  }
  if (!flushRaf) flushRaf = requestAnimationFrame(flush);
  requestDraw();
});

function endStroke(e) {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (scrollDrag) {
      if (!touches.size) scrollDrag = null;
      else { scrollDrag.avg = undefined; scrollDrag.sx = P.scrollX; }
      return;
    }
  }
  if (!cur || e.pointerId !== cur.pid) return;
  flush();
  send({ t: 'up', s: cur.s });
  cur.live = false;
  if (cur.L) cur.L.done = true;
  const was = cur;
  cur = null;
  eraserAt = null;
  if (was.m === 'line' && (was.tool === 'pen' || was.tool === 'marker')) scheduleAutoScroll();
  updateUndo();
  requestDraw();
}
cv.addEventListener('pointerup', endStroke);
cv.addEventListener('pointercancel', endStroke);

function cancelStroke() {
  if (!cur) return;
  flush();
  send({ t: 'cancel', s: cur.s });
  const list = cur.m === 'line' ? P.line : P.free;
  const i = list.indexOf(cur);
  if (i >= 0) list.splice(i, 1);
  cur = null;
  eraserAt = null;
  requestDraw();
}

function eraseLocal(x, y, r) {
  // লাইন মোডে দুই অক্ষই পট্টির উচ্চতার এককে; ফ্রি মোডে x-কে বোর্ডের উচ্চতার এককে আনি
  const kx = P.mode === 'line' ? 1 : G.fw / G.fh;
  const list = P.mode === 'line' ? P.line : P.free;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.pts.some((p) => Math.hypot((p[0] - x) * kx, p[1] - y) <= r + s.w / 2)) list.splice(i, 1);
  }
}

// লেখা ডানে পৌঁছালে পট্টি নিজে সরে যায়
function lineMaxX() { return P.line.reduce((m, s) => Math.max(m, ...s.pts.map((p) => p[0])), 0); }
function scheduleAutoScroll() {
  clearTimeout(autoScrollT);
  autoScrollT = setTimeout(() => {
    const max = lineMaxX();
    const vis = unitsVisible();
    if (max - P.scrollX > vis * 0.68) animateScroll(max - vis * 0.3);
  }, 420);
}
function animateScroll(target) {
  const from = P.scrollX, t0 = performance.now(), dur = 260;
  target = Math.max(0, target);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    P.scrollX = from + (target - from) * (1 - Math.pow(1 - k, 3));
    draw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ───────────── নিয়ন্ত্রণ ─────────────
function setMode(m) {
  if (cur) return;
  P.mode = m;
  try { localStorage.setItem('likhon.mode', m); } catch {}
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.m === m));
  $('#lineActions').style.display = m === 'line' ? '' : 'none';
  $('[data-tool="laser"]').disabled = m === 'line';
  if (m === 'line' && P.tool === 'laser') setTool('pen');
  $('#hint').textContent = m === 'line' ? 'এই পট্টিতে লিখুন — বোর্ডে নির্দিষ্ট সাইজে বসবে' : 'পুরো বোর্ড এখানে — যেখানে খুশি লিখুন বা আঁকুন';
  $('#hint').classList.remove('gone');
  setTimeout(() => $('#hint').classList.add('gone'), 3500);
  buzz();
  requestDraw();
}
$$('#modeSeg button').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));

function setTool(t) {
  P.tool = t;
  $$('.tb[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $$('#sizes button').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === P.sizeIdx[t]));
  $('#sizes').style.visibility = t === 'laser' ? 'hidden' : '';
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
  if (P.tool === 'eraser' || P.tool === 'laser') setTool('pen');
  $$('.sw').forEach((b) => b.classList.toggle('active', b.dataset.c === c));
  $('#moreColors').classList.toggle('active', !COLORS.includes(c));
  $('#moreColors').style.background = COLORS.includes(c) ? '' : c;
  buzz(5);
}
$('#moreColors').onclick = () => ($('#colorSheet').hidden = false);
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) s.hidden = true; }));

function updateUndo() {
  const list = P.mode === 'line' ? P.line : P.free;
  $('#undoBtn').disabled = !P.board.canUndo && !list.length;
}
$('#undoBtn').onclick = () => {
  send({ t: 'undo' });
  const list = P.mode === 'line' ? P.line : P.free;
  if (list.length) P.redo.push({ m: P.mode, s: list.pop() });
  buzz(); requestDraw();
};
$('#redoBtn').onclick = () => {
  send({ t: 'redo' });
  const r = P.redo.pop();
  if (r) (r.m === 'line' ? P.line : P.free).push(r.s);
  buzz(); requestDraw();
};
$('#nlBtn').onclick = () => {
  send({ t: 'nl' });
  P.line = []; P.redo = [];
  P.scrollX = 0;
  buzz(14); requestDraw();
};
$('#spaceBtn').onclick = () => {
  const max = lineMaxX();
  animateScroll(max > 0 ? max + 0.35 - unitsVisible() * 0.12 : P.scrollX + unitsVisible() * 0.5);
  buzz();
};
$('#pgPrev').onclick = () => { send({ t: 'page', a: 'prev' }); buzz(); };
$('#pgNext').onclick = () => { send({ t: 'page', a: 'next' }); buzz(); };
$('#moreBtn').onclick = () => ($('#moreSheet').hidden = false);
$('#newPageBtn').onclick = () => { send({ t: 'page', a: 'new' }); $('#moreSheet').hidden = true; };
$('#clearBtn').onclick = () => {
  if (!confirm('বোর্ডের এই পেজের সব লেখা মুছে যাবে। নিশ্চিত?')) return;
  send({ t: 'clear' });
  P.line = []; P.free = []; P.redo = []; P.scrollX = 0;
  $('#moreSheet').hidden = true; requestDraw();
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
setMode(P.mode);
layout();
keepAwake();
connect();
booted = true;
window.__pad = { P };
