const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ==================== Config ====================
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.RIPPLE_ADMIN_PASSWORD || 'admin123';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ==================== JSON File Store ====================
const STORE_PATH = path.join(__dirname, 'data', 'store.json');

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { pledges: [], ripples: [], actions: [], sessions: [], views: [], _nextId: 1 };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

// Auto-increment ID
function nextId(store) {
  return store._nextId++;
}

// Clean expired sessions
function cleanSessions(store) {
  const now = new Date();
  store.sessions = store.sessions.filter(s => new Date(s.expires_at) > now);
}

// Today's date string helper
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ==================== Auth Helpers ====================
function createSession(store) {
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  store.sessions.push({ id: sid, created_at: new Date().toISOString(), expires_at: expiresAt });
  saveStore(store);
  return sid;
}

function validateSession(store, sid) {
  if (!sid) return false;
  cleanSessions(store);
  return store.sessions.some(s => s.id === sid);
}

// ==================== Online Explorer Tracker ====================
const onlineExplorers = new Map(); // id -> lastSeen timestamp
const EXPLORER_TTL = 30000; // 30 seconds timeout

function cleanupExplorers() {
  const now = Date.now();
  for (const [id, lastSeen] of onlineExplorers) {
    if (now - lastSeen > EXPLORER_TTL) onlineExplorers.delete(id);
  }
}
setInterval(cleanupExplorers, 10000);

// ==================== Express App ====================
const app = express();
app.use(compression());
app.use(require('cors')());
app.use(express.json());

// Cache static assets for 1 hour
app.use((req, res, next) => {
  if (req.method === 'GET' && /\.(js|css|png|jpg|svg|ico|woff2?)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  next();
});

// Log page views
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const store = loadStore();
    store.views.push({
      id: nextId(store),
      path: req.path,
      created_at: new Date().toISOString(),
      ip: req.ip,
      user_agent: req.headers['user-agent'] || ''
    });
    saveStore(store);
  }
  next();
});

// ==================== API Routes ====================

// ---- Public APIs ----

// Get pledges (public)
app.get('/api/pledges', (req, res) => {
  const store = loadStore();
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const active = store.pledges
    .filter(p => !p.is_deleted && p.is_approved)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = active.length;
  const offset = (page - 1) * limit;
  const pledges = active.slice(offset, offset + limit).map(p => ({
    id: p.id, text: p.text, avatar: p.avatar, created_at: p.created_at
  }));

  res.json({ pledges, total, page, totalPages: Math.ceil(total / limit) || 1 });
});

// Submit a pledge (public)
app.post('/api/pledges', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '承诺内容不能为空' });
  }
  if (text.length > 200) {
    return res.status(400).json({ error: '承诺内容不能超过200字' });
  }

  const store = loadStore();
  const avatars = ['🌱','🌟','💪','🕊️','🔥','🌊','🎯','💎','🦋','🌈'];

  const pledge = {
    id: nextId(store),
    text: text.trim(),
    avatar: avatars[Math.floor(Math.random() * avatars.length)],
    created_at: new Date().toISOString(),
    ip: req.ip,
    user_agent: req.headers['user-agent'] || '',
    is_approved: 1,
    is_deleted: 0
  };
  store.pledges.push(pledge);
  saveStore(store);

  res.json({ success: true, id: pledge.id, avatar: pledge.avatar });
});

// Record ripple click (public)
app.post('/api/ripple', (req, res) => {
  const store = loadStore();
  store.ripples.push({
    id: nextId(store),
    created_at: new Date().toISOString(),
    ip: req.ip
  });
  saveStore(store);
  res.json({ success: true, totalRipples: store.ripples.length });
});

// Get stats (public)
app.get('/api/stats', (req, res) => {
  const store = loadStore();
  const rippleCount = store.ripples.length;
  const pledgeCount = store.pledges.filter(p => !p.is_deleted && p.is_approved).length;
  const actionCount = [...new Set(store.actions.map(a => a.action_index))].length;
  const viewCount = store.views.length;

  // Top actions
  const actionMap = {};
  store.actions.forEach(a => {
    if (!actionMap[a.action_index]) actionMap[a.action_index] = { action_index: a.action_index, action_title: a.action_title, count: 0 };
    actionMap[a.action_index].count++;
  });
  const topActions = Object.values(actionMap).sort((a, b) => b.count - a.count).slice(0, 5);

  res.json({
    rippleCount, pledgeCount, actionCount, viewCount, topActions,
    peopleImpacted: rippleCount * 9 + pledgeCount * 3,
  });
});

// Heartbeat - track online explorers
app.post('/api/heartbeat', (req, res) => {
  const { id } = req.body || {};
  if (id) onlineExplorers.set(id, Date.now());
  cleanupExplorers();
  res.json({ onlineCount: onlineExplorers.size });
});

// Select an action (public)
app.post('/api/actions', (req, res) => {
  const { actionIndex, actionTitle } = req.body;
  if (actionIndex === undefined || !actionTitle) {
    return res.status(400).json({ error: '缺少参数' });
  }
  const store = loadStore();
  store.actions.push({
    id: nextId(store),
    action_index: actionIndex,
    action_title: actionTitle,
    created_at: new Date().toISOString(),
    ip: req.ip
  });
  saveStore(store);
  res.json({ success: true, totalActions: store.actions.length });
});

// ---- Auth ----

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  const store = loadStore();
  const sid = createSession(store);
  res.json({ success: true, token: sid });
});

app.get('/api/admin/check', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!validateSession(loadStore(), token)) {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  res.json({ valid: true });
});

// ---- Admin Middleware ----

const adminAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!validateSession(loadStore(), token)) {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  next();
};

// Admin: get all pledges
app.get('/api/admin/pledges', adminAuth, (req, res) => {
  const store = loadStore();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const search = req.query.search || '';
  const status = req.query.status || 'active';

  let filtered = store.pledges;

  if (status === 'active') filtered = filtered.filter(p => !p.is_deleted);
  else if (status === 'deleted') filtered = filtered.filter(p => p.is_deleted);

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(p => p.text.toLowerCase().includes(s));
  }

  filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = filtered.length;
  const offset = (page - 1) * limit;
  const pledges = filtered.slice(offset, offset + limit);

  res.json({ pledges, total, page, totalPages: Math.ceil(total / limit) || 1 });
});

// Admin: toggle approve
app.patch('/api/admin/pledges/:id/approve', adminAuth, (req, res) => {
  const store = loadStore();
  const id = parseInt(req.params.id);
  const pledge = store.pledges.find(p => p.id === id);
  if (!pledge) return res.status(404).json({ error: '未找到' });
  pledge.is_approved = pledge.is_approved ? 0 : 1;
  saveStore(store);
  res.json({ success: true, is_approved: pledge.is_approved });
});

// Admin: soft delete
app.patch('/api/admin/pledges/:id/delete', adminAuth, (req, res) => {
  const store = loadStore();
  const id = parseInt(req.params.id);
  const pledge = store.pledges.find(p => p.id === id);
  if (!pledge) return res.status(404).json({ error: '未找到' });
  pledge.is_deleted = pledge.is_deleted ? 0 : 1;
  saveStore(store);
  res.json({ success: true, is_deleted: pledge.is_deleted });
});

// Admin: permanent delete
app.delete('/api/admin/pledges/:id', adminAuth, (req, res) => {
  const store = loadStore();
  const id = parseInt(req.params.id);
  store.pledges = store.pledges.filter(p => p.id !== id);
  saveStore(store);
  res.json({ success: true });
});

// Admin: dashboard stats
app.get('/api/admin/dashboard', adminAuth, (req, res) => {
  const store = loadStore();
  const rippleCount = store.ripples.length;
  const pledgeCount = store.pledges.filter(p => !p.is_deleted).length;
  const deletedPledgeCount = store.pledges.filter(p => p.is_deleted).length;
  const actionCount = store.actions.length;
  const viewCount = store.views.length;

  const today = todayStr();
  const todayRipples = store.ripples.filter(r => r.created_at.startsWith(today)).length;
  const todayPledges = store.pledges.filter(p => p.created_at.startsWith(today)).length;
  const todayViews = store.views.filter(v => v.created_at.startsWith(today)).length;

  // Recent 7 days
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    last7Days.push({
      date: ds,
      ripples: store.ripples.filter(r => r.created_at.startsWith(ds)).length,
      pledges: store.pledges.filter(p => p.created_at.startsWith(ds)).length,
      views: store.views.filter(v => v.created_at.startsWith(ds)).length,
    });
  }

  // Top actions
  const actionMap = {};
  store.actions.forEach(a => {
    if (!actionMap[a.action_index]) actionMap[a.action_index] = { action_index: a.action_index, action_title: a.action_title, count: 0 };
    actionMap[a.action_index].count++;
  });
  const topActions = Object.values(actionMap).sort((a, b) => b.count - a.count);

  // Latest pledges
  const latestPledges = [...store.pledges].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);

  res.json({
    rippleCount, pledgeCount, deletedPledgeCount, actionCount, viewCount,
    todayRipples, todayPledges, todayViews,
    last7Days, topActions, latestPledges,
  });
});

// ==================== Share Card Image Generator ====================
const { PNG } = require('pngjs');

function generateShareCard(callback) {
  const store = loadStore();
  const total = store.pledges.filter(p => !p.is_deleted).length;
  const w = 800, h = 450;
  const png = new PNG({ width: w, height: h });

  // Helper: draw a pixel
  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = (w * y + x) * 4;
    png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = a;
  }

  // Helper: fill rect
  function fillRect(x1, y1, x2, y2, r, g, b) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) setPixel(x, y, r, g, b);
  }

  // Helper: fill circle
  function fillCircle(cx, cy, rad, r, g, b, a = 255) {
    for (let y = Math.max(0, cy - rad); y < Math.min(h, cy + rad); y++)
      for (let x = Math.max(0, cx - rad); x < Math.min(w, cx + rad); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2) setPixel(x, y, r, g, b, a);
  }

  // Background gradient
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = Math.floor(5 + t * 25), g = Math.floor(5 + t * 15), b = Math.floor(30 + t * 20);
    for (let x = 0; x < w; x++) setPixel(x, y, r, g, b);
  }

  // Stars
  for (let i = 0; i < 100; i++) {
    const sx = Math.floor(Math.random() * w), sy = Math.floor(Math.random() * h);
    const bright = Math.floor(180 + Math.random() * 75);
    const sr = Math.floor(Math.random() * 2) + 1;
    fillCircle(sx, sy, sr, bright, bright, bright, Math.floor(60 + Math.random() * 195));
  }

  // Central glow
  for (let i = 80; i > 0; i -= 2)
    fillCircle(w / 2, 100, i, 0, Math.floor(210 * i / 80), Math.floor(255 * i / 80), Math.floor(10 + 5 * i / 80));

  // Title text (simple pixel text - just use circles for now)
  // Draw "RI PPLE" in circles approximation - actually let's keep it simple with just the glowing orb and number

  // Big number in center
  fillCircle(w / 2, 210, 50, 0, 210, 255, 180);
  fillCircle(w / 2, 210, 35, 10, 20, 40, 200);

  // The title and data will be done by the OG meta text; the image is just eye candy
  callback(png);
}

app.get('/share-card.png', (req, res) => {
  generateShareCard((png) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const chunks = [];
    png.pack().on('data', chunk => chunks.push(chunk)).on('end', () => {
      res.send(Buffer.concat(chunks));
    });
  });
});

// ==================== Serve Static Files ====================
app.get('/', (req, res) => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = proto + '://' + req.get('host');
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  // Fix OG URLs for WeChat crawlers (they may not execute JS)
  html = html.replace('content="/share-card.png"', 'content="' + baseUrl + '/share-card.png"');
  html = html.replace('content=""', 'content="' + baseUrl + '/"');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== Start ====================
app.listen(PORT, () => {
  console.log('');
  console.log('  🌍  涟漪效应 · The Ripple Effect');
  console.log('  ─────────────────────────────────');
  console.log(`  主页:    http://localhost:${PORT}`);
  console.log(`  后台:    http://localhost:${PORT}/admin`);
  console.log(`  默认密码: ${ADMIN_PASSWORD}`);
  console.log('');
  console.log('  按 Ctrl+C 停止服务器');
  console.log('');
});
