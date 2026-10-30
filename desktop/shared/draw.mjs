// লিখন — বোর্ড ও প্যাড দুটোর জন্য একই আঁকার কোড
import { getStroke } from '../vendor/perfect-freehand.mjs';

export const FONT = "'Nirmala UI','Hind Siliguri','Noto Sans Bengali','Segoe UI',sans-serif";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mctx = document.createElement('canvas').getContext('2d'); // লেখার মাপ নেওয়ার জন্য

export function isDark(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

// ───────────────────────── উপাদানের জ্যামিতি ─────────────────────────
const pathCache = new WeakMap();
const boxCache = new WeakMap();
export const imgCache = new Map();

export function svgPath(pts) {
  const n = pts.length;
  if (n < 4) return '';
  let a = pts[0], b = pts[1];
  const c = pts[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${((b[0] + c[0]) / 2).toFixed(2)},${((b[1] + c[1]) / 2).toFixed(2)} T`;
  for (let i = 2; i < n - 1; i++) {
    a = pts[i]; b = pts[i + 1];
    d += `${((a[0] + b[0]) / 2).toFixed(2)},${((a[1] + b[1]) / 2).toFixed(2)} `;
  }
  return d + 'Z';
}

export function strokeOptions(el, last) {
  if (el.tool === 'marker') {
    return { size: el.size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last, start: { cap: true }, end: { cap: true } };
  }
  return { size: el.size, thinning: 0.6, smoothing: 0.55, streamline: 0.4, simulatePressure: !el.pr, last, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } };
}

export function strokePath(el, last = true) {
  if (last) { const p = pathCache.get(el); if (p) return p; }
  const pts = el.tool === 'marker' ? el.pts.map((q) => [q[0], q[1], 0.5]) : el.pts;
  const outline = getStroke(pts, strokeOptions(el, last));
  const p = new Path2D(svgPath(outline));
  if (last) pathCache.set(el, p);
  return p;
}

export function textLines(el) { return String(el.text).split('\n'); }
export function measureText(el) {
  mctx.save();
  mctx.font = `${el.size}px ${FONT}`;
  const w = Math.max(...textLines(el).map((l) => mctx.measureText(l || ' ').width));
  mctx.restore();
  return { w, h: textLines(el).length * el.size * 1.25 };
}

export function bbox(el) {
  let b = boxCache.get(el);
  if (b) return b;
  if (el.type === 'stroke') {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of el.pts) { if (p[0] < x1) x1 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[0] > x2) x2 = p[0]; if (p[1] > y2) y2 = p[1]; }
    const r = el.size;
    b = { x1: x1 - r, y1: y1 - r, x2: x2 + r, y2: y2 + r };
  } else if (el.type === 'text') {
    const m = measureText(el);
    b = { x1: el.x, y1: el.y, x2: el.x + m.w, y2: el.y + m.h };
  } else if (el.type === 'image') {
    b = { x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h };
  } else {
    const r = el.size * 2 + (el.type === 'arrow' ? el.size * 4 + 12 : 0);
    b = { x1: Math.min(el.x1, el.x2) - r, y1: Math.min(el.y1, el.y2) - r, x2: Math.max(el.x1, el.x2) + r, y2: Math.max(el.y1, el.y2) + r };
  }
  boxCache.set(el, b);
  return b;
}

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function shapeOutline(el) {
  const x1 = Math.min(el.x1, el.x2), x2 = Math.max(el.x1, el.x2), y1 = Math.min(el.y1, el.y2), y2 = Math.max(el.y1, el.y2);
  if (el.type === 'rect') return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
  if (el.type === 'triangle') return [[(x1 + x2) / 2, y1], [x2, y2], [x1, y2], [(x1 + x2) / 2, y1]];
  if (el.type === 'ellipse') {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2, out = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return out;
  }
  return [[el.x1, el.y1], [el.x2, el.y2]];
}

export function hit(el, x, y, r) {
  const b = bbox(el);
  if (x < b.x1 - r || x > b.x2 + r || y < b.y1 - r || y > b.y2 + r) return false;
  if (el.type === 'text' || el.type === 'image') return true;
  if (el.type === 'stroke') {
    const rr = r + el.size / 2;
    const p = el.pts;
    if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= rr;
    for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= rr) return true;
    return false;
  }
  if (el.fill && el.type !== 'line' && el.type !== 'arrow') {
    const xa = Math.min(el.x1, el.x2), xb = Math.max(el.x1, el.x2), ya = Math.min(el.y1, el.y2), yb = Math.max(el.y1, el.y2);
    if (x >= xa && x <= xb && y >= ya && y <= yb) return true;
  }
  const o = shapeOutline(el), rr = r + el.size / 2 + 2;
  for (let i = 1; i < o.length; i++) if (segDist(x, y, o[i - 1][0], o[i - 1][1], o[i][0], o[i][1]) <= rr) return true;
  return false;
}

export function translate(el, dx, dy) {
  if (el.type === 'stroke') return { ...el, pts: el.pts.map((p) => [p[0] + dx, p[1] + dy, p[2]]) };
  if (el.type === 'text' || el.type === 'image') return { ...el, x: el.x + dx, y: el.y + dy };
  return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
}

export function contentBounds(els) {
  if (!els.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of els) { const b = bbox(e); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
  return { x1, y1, x2, y2 };
}

// ───────────────────────── আঁকা ─────────────────────────
let onImageLoad = () => {};
export function setImageLoadHandler(fn) { onImageLoad = fn; }
export function getImage(src) {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = () => onImageLoad(); im.src = src; imgCache.set(src, im); }
  return im;
}

export function drawEl(c, el, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  if (el.type === 'stroke') {
    if (el.tool === 'marker') c.globalAlpha = alpha * 0.38;
    c.fillStyle = el.color;
    c.fill(strokePath(el));
  } else if (el.type === 'text') {
    c.fillStyle = el.color;
    c.font = `${el.size}px ${FONT}`;
    c.textBaseline = 'top';
    textLines(el).forEach((l, i) => c.fillText(l, el.x, el.y + i * el.size * 1.25 + el.size * 0.08));
  } else if (el.type === 'image') {
    const im = getImage(el.src);
    if (im.complete && im.naturalWidth) c.drawImage(im, el.x, el.y, el.w, el.h);
    else { c.strokeStyle = '#bbb'; c.setLineDash([6, 6]); c.strokeRect(el.x, el.y, el.w, el.h); }
  } else {
    c.strokeStyle = el.color;
    c.lineWidth = el.size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (el.dash) c.setLineDash([el.size * 3, el.size * 2.4]);
    c.beginPath();
    const x1 = Math.min(el.x1, el.x2), x2 = Math.max(el.x1, el.x2), y1 = Math.min(el.y1, el.y2), y2 = Math.max(el.y1, el.y2);
    if (el.type === 'line' || el.type === 'arrow') {
      c.moveTo(el.x1, el.y1); c.lineTo(el.x2, el.y2);
    } else if (el.type === 'rect') {
      const rr = Math.min(6, (x2 - x1) / 4, (y2 - y1) / 4);
      c.roundRect ? c.roundRect(x1, y1, x2 - x1, y2 - y1, Math.max(0, rr)) : c.rect(x1, y1, x2 - x1, y2 - y1);
    } else if (el.type === 'ellipse') {
      c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.1, (x2 - x1) / 2), Math.max(0.1, (y2 - y1) / 2), 0, 0, Math.PI * 2);
    } else if (el.type === 'triangle') {
      c.moveTo((x1 + x2) / 2, y1); c.lineTo(x2, y2); c.lineTo(x1, y2); c.closePath();
    }
    if (el.fill && el.type !== 'line' && el.type !== 'arrow') {
      c.save(); c.globalAlpha = alpha * 0.22; c.fillStyle = el.color; c.fill(); c.restore();
    }
    c.stroke();
    if (el.type === 'arrow') {
      c.setLineDash([]);
      const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      const L = Math.max(14, el.size * 4.2);
      c.beginPath();
      c.moveTo(el.x2 - L * Math.cos(a - 0.45), el.y2 - L * Math.sin(a - 0.45));
      c.lineTo(el.x2, el.y2);
      c.lineTo(el.x2 - L * Math.cos(a + 0.45), el.y2 - L * Math.sin(a + 0.45));
      c.stroke();
    }
  }
  c.restore();
}

export function drawPattern(c, bg, cm, w, h) {
  if (bg.pattern === 'none') return;
  const dark = isDark(bg.color);
  const col = dark ? 'rgba(255,255,255,0.09)' : 'rgba(40,52,90,0.09)';
  const strong = dark ? 'rgba(255,255,255,0.16)' : 'rgba(40,52,90,0.15)';
  let step = 32;
  if (bg.pattern === 'lines') step = 48;
  while (step * cm.z < 14) step *= 2;
  const s = step * cm.z;
  const ox = -((cm.x * cm.z) % s);
  const oy = -((cm.y * cm.z) % s);
  c.save();
  if (bg.pattern === 'dots') {
    c.fillStyle = strong;
    const r = Math.max(1, Math.min(2, cm.z * 1.4));
    for (let x = ox; x < w + s; x += s) for (let y = oy; y < h + s; y += s) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
  } else {
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.beginPath();
    if (bg.pattern === 'grid') for (let x = ox; x < w + s; x += s) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
    for (let y = oy; y < h + s; y += s) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
    c.stroke();
    if (bg.pattern === 'lines') {
      c.strokeStyle = dark ? 'rgba(255,120,120,0.25)' : 'rgba(224,57,62,0.25)';
      const mx = (60 - cm.x) * cm.z;
      if (mx > 0 && mx < w) { c.beginPath(); c.moveTo(mx, 0); c.lineTo(mx, h); c.stroke(); }
    }
  }
  c.restore();
}

