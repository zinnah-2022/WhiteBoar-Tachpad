// লিখন বোর্ড — লোকাল সার্ভার
// মোবাইলের প্যাড পেজ পরিবেশন করে এবং WebSocket দিয়ে প্যাড ↔ বোর্ড বার্তা আদান-প্রদান করে।
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// কোন URL প্রিফিক্স কোন ফোল্ডার থেকে আসবে
const ROUTES = [
  ['/pad/', 'pad'],
  ['/vendor/', 'vendor'],
  ['/board/', 'renderer'],
];

function localIPv4() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address });
    }
  }
  // বাসা/স্কুলের WiFi সাধারণত 192.168.x.x — সেগুলো আগে, ভার্চুয়াল অ্যাডাপ্টার পরে
  const score = (e) => {
    const n = e.name.toLowerCase();
    let s = 0;
    if (/wi-?fi|wlan|wireless/.test(n)) s -= 30;
    if (/ethernet|eth|en\d/.test(n)) s -= 10;
    if (/virtual|vbox|vmware|hyper-v|vethernet|docker|wsl|loopback|bluetooth/.test(n)) s += 100;
    if (e.address.startsWith('192.168.56.')) s += 50; // VirtualBox host-only
    if (e.address.startsWith('192.168.')) s -= 5;
    return s;
  };
  return out.sort((a, b) => score(a) - score(b));
}

function startServer({ root, token, port = 8765, maxTries = 12 }) {
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      res.writeHead(400).end();
      return;
    }
    let p = decodeURIComponent(url.pathname);

    if (p === '/' || p === '/pad') {
      res.writeHead(302, { Location: '/pad/' + url.search });
      res.end();
      return;
    }
    if (p === '/board') {
      res.writeHead(302, { Location: '/board/' + url.search });
      res.end();
      return;
    }
    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'likhon', ok: true }));
      return;
    }

    for (const [prefix, dir] of ROUTES) {
      if (!p.startsWith(prefix)) continue;
      let rel = p.slice(prefix.length) || 'index.html';
      const base = path.join(root, dir);
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base)) break; // ফোল্ডারের বাইরে যাওয়া যাবে না
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('পাওয়া যায়নি');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('পাওয়া যায়নি');
  });

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const boards = new Set();
  const pads = new Map(); // ws -> info
  let padSeq = 0;

  const padList = () => [...pads.values()].map((i) => ({ id: i.id, name: i.name }));
  const tellBoards = (msg) => {
    const s = JSON.stringify(msg);
    for (const b of boards) if (b.readyState === 1) b.send(s);
  };

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const role = url.searchParams.get('role');
      const k = url.searchParams.get('k');
      if (k !== token.value) {
        ws.close(4001, 'bad-pin');
        return;
      }
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));

      if (role === 'board') {
        boards.add(ws);
        ws.send(JSON.stringify({ t: 'pads', list: padList() }));
        ws.on('message', (data) => {
          // বোর্ড → সব প্যাড
          const s = data.toString();
          for (const p of pads.keys()) if (p.readyState === 1) p.send(s);
        });
        ws.on('close', () => boards.delete(ws));
        return;
      }

      // প্যাড
      const info = {
        id: 'p' + ++padSeq,
        name: (url.searchParams.get('name') || 'মোবাইল').slice(0, 40),
      };
      pads.set(ws, info);
      tellBoards({ t: 'pads', list: padList() });
      tellBoards({ t: 'join', pad: info.id, name: info.name });
      ws.on('message', (data) => {
        const s = data.toString();
        // প্যাড বার্তার সাথে প্যাড-আইডি জুড়ে বোর্ডে পাঠাই (দ্রুত, পুরো JSON না খুলে)
        const tagged = '{"pad":"' + info.id + '",' + s.slice(1);
        for (const b of boards) if (b.readyState === 1) b.send(tagged);
      });
      ws.on('close', () => {
        pads.delete(ws);
        tellBoards({ t: 'pads', list: padList() });
        tellBoards({ t: 'leave', pad: info.id });
      });
    });
  });

  // মৃত সংযোগ পরিষ্কার
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, 10000);
  server.on('close', () => clearInterval(heartbeat));

  // পোর্ট ব্যস্ত থাকলে পরেরটা চেষ্টা
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = (pt) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && ++tries < maxTries) attempt(pt + 1);
        else reject(err);
      });
      server.listen(pt, '0.0.0.0', () => {
        resolve({
          port: pt,
          close: () => server.close(),
          kickAllPads: () => {
            for (const p of pads.keys()) p.close(4002, 'pin-changed');
          },
        });
      });
    };
    attempt(port);
  });
}

module.exports = { startServer, localIPv4 };

// সরাসরি চালালে (ডেভেলপমেন্ট/পরীক্ষা): node server.js
if (require.main === module) {
  const token = { value: process.env.LIKHON_PIN || '1234' };
  startServer({ root: __dirname, token, port: Number(process.env.PORT) || 8765 }).then(({ port }) => {
    console.log('লিখন সার্ভার চালু: পোর্ট', port, 'পিন', token.value);
    for (const ip of localIPv4()) console.log(`  প্যাড: http://${ip.address}:${port}/pad/?k=${token.value}`);
    console.log(`  বোর্ড (ব্রাউজারে পরীক্ষা): http://localhost:${port}/board/?k=${token.value}&port=${port}`);
  });
}
