'use strict';
// Yalla Stock — stock + sales tracker for Yalla Wear (hoodies, t-shirts, shorts… any product).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

// USERS="zaven:secret1,zohrab:secret2"
const USERS = Object.fromEntries(
  (process.env.USERS || 'zaven:yalla123,zohrab:yalla123')
    .split(',')
    .map((pair) => pair.trim().split(':'))
    .filter(([u, p]) => u && p)
    .map(([u, p]) => [u.toLowerCase(), p])
);
const DEFAULT_PASSWORDS = !process.env.USERS;
if (DEFAULT_PASSWORDS) console.warn('[yalla] USERS env not set — using default passwords. Set USERS before going live.');

const db = new Database(path.join(DATA_DIR, 'yalla.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Guard against a database from the single-product preview build.
const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='colors'").get()
  && !db.prepare('PRAGMA table_info(colors)').all().some((c) => c.name === 'product_id');
if (legacy) {
  console.error('[yalla] This data folder holds a database from the preview build. Start with an empty /data volume.');
  process.exit(1);
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  printable INTEGER NOT NULL DEFAULT 1,
  print_front INTEGER NOT NULL DEFAULT 0 CHECK (print_front >= 0),
  print_front_back INTEGER NOT NULL DEFAULT 0 CHECK (print_front_back >= 0),
  sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS colors (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '', hex TEXT NOT NULL DEFAULT '#888888',
  sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, UNIQUE (product_id, name));
CREATE TABLE IF NOT EXISTS sizes (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, UNIQUE (product_id, name));
CREATE TABLE IF NOT EXISTS stock (
  color_id INTEGER NOT NULL REFERENCES colors(id), size_id INTEGER NOT NULL REFERENCES sizes(id),
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), PRIMARY KEY (color_id, size_id));
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL DEFAULT '', customer_instagram TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT, cancelled_by TEXT, receipt_token TEXT UNIQUE);
-- sale lines keep a snapshot of names, so renaming/removing products later never changes old receipts
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  color_id INTEGER NOT NULL REFERENCES colors(id), size_id INTEGER NOT NULL REFERENCES sizes(id),
  product_name TEXT NOT NULL, product_name_ar TEXT NOT NULL DEFAULT '',
  color_name TEXT NOT NULL, color_name_ar TEXT NOT NULL DEFAULT '', color_hex TEXT NOT NULL, size_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0), unit_price INTEGER NOT NULL,
  print_type TEXT NOT NULL CHECK (print_type IN ('none','front','front_back')),
  print_price INTEGER NOT NULL DEFAULT 0, line_total INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  color_id INTEGER NOT NULL REFERENCES colors(id), size_id INTEGER NOT NULL REFERENCES sizes(id), delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale','cancel','restock','adjust','opening')),
  sale_id INTEGER, note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_mov_created ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_colors_product ON colors(product_id);
CREATE INDEX IF NOT EXISTS idx_sizes_product ON sizes(product_id);
`);

const DEFAULT_SETTINGS = {
  low_threshold: '1',
  high_threshold: '6',
  currency: 'SYP',
  shop_phone: '',
  shop_instagram: '',
  receipt_note: 'Thank you for choosing Yalla Wear!',
  logo: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

// ---------- helpers ----------
const getSettings = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
const int = (v, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };
const nowISO = () => new Date().toISOString();
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const cleanInstagram = (v) => String(v || '').trim()
  .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '')
  .replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
const ensureStockRows = () => db.prepare(`INSERT OR IGNORE INTO stock (color_id, size_id, qty)
  SELECT c.id, s.id, 0 FROM colors c JOIN sizes s ON s.product_id = c.product_id`).run();

// ---------- products (create / edit with colors + sizes in one go) ----------
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL'];
function saveProduct(spec, productId) {
  const name = String(spec.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Product name is required');
  const price = int(spec.price, -1);
  if (price < 0) throw new HttpError(400, 'Price must be 0 or more');
  const printable = spec.printable ? 1 : 0;
  const pf = Math.max(0, int(spec.print_front));
  const pfb = Math.max(0, int(spec.print_front_back));
  const colors = Array.isArray(spec.colors) ? spec.colors : [];
  const sizes = Array.isArray(spec.sizes) ? spec.sizes : [];
  const dup = (arr) => { const seen = new Set(); for (const a of arr) { const k = a.toLowerCase(); if (seen.has(k)) return a; seen.add(k); } return null; };
  const cNames = colors.map((c) => String(c.name || '').trim());
  const sNames = sizes.map((s) => String(s.name || '').trim().toUpperCase());
  if (cNames.some((n) => !n)) throw new HttpError(400, 'Every color needs a name');
  if (sNames.some((n) => !n)) throw new HttpError(400, 'Every size needs a name');
  const dc = dup(cNames); if (dc) throw new HttpError(400, `Color "${dc}" is added twice`);
  const ds = dup(sNames); if (ds) throw new HttpError(400, `Size "${ds}" is added twice`);

  return db.transaction(() => {
    let id = productId;
    if (id) {
      const r = db.prepare(`UPDATE products SET name=?, name_ar=?, price=?, printable=?, print_front=?, print_front_back=? WHERE id=?`)
        .run(name, String(spec.name_ar || '').trim().slice(0, 40), price, printable, pf, pfb, id);
      if (!r.changes) throw new HttpError(404, 'Product not found');
    } else {
      const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM products').get().n;
      id = db.prepare(`INSERT INTO products (name,name_ar,price,printable,print_front,print_front_back,sort,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(name, String(spec.name_ar || '').trim().slice(0, 40), price, printable, pf, pfb, sort, nowISO()).lastInsertRowid;
    }
    // colors: update by id, revive by name, else insert; anything left out gets archived (history stays intact)
    const existingC = db.prepare('SELECT * FROM colors WHERE product_id = ?').all(id);
    const keepC = new Set();
    colors.forEach((c, i) => {
      const n = cNames[i];
      const hex = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#888888';
      const ar = String(c.name_ar || '').trim().slice(0, 30);
      const row = (c.id && existingC.find((e) => e.id === int(c.id))) || existingC.find((e) => e.name.toLowerCase() === n.toLowerCase() && !keepC.has(e.id));
      if (row) {
        const clash = existingC.find((e) => e.id !== row.id && e.name.toLowerCase() === n.toLowerCase());
        if (clash) db.prepare("UPDATE colors SET name = name || ' (old ' || id || ')' WHERE id = ?").run(clash.id);
        db.prepare('UPDATE colors SET name=?, name_ar=?, hex=?, sort=?, archived=0 WHERE id=?').run(n, ar, hex, i, row.id);
        keepC.add(row.id);
      } else {
        keepC.add(db.prepare('INSERT INTO colors (product_id,name,name_ar,hex,sort) VALUES (?,?,?,?,?)').run(id, n, ar, hex, i).lastInsertRowid);
      }
    });
    for (const e of existingC) if (!keepC.has(e.id)) db.prepare('UPDATE colors SET archived = 1 WHERE id = ?').run(e.id);

    const existingS = db.prepare('SELECT * FROM sizes WHERE product_id = ?').all(id);
    const keepS = new Set();
    const order = (n) => { const i = SIZE_ORDER.indexOf(n); return i === -1 ? null : i; };
    sizes.forEach((s, i) => {
      const n = sNames[i];
      const sort = order(n) ?? 100 + i;
      const row = (s.id && existingS.find((e) => e.id === int(s.id))) || existingS.find((e) => e.name === n && !keepS.has(e.id));
      if (row) {
        const clash = existingS.find((e) => e.id !== row.id && e.name === n);
        if (clash) db.prepare("UPDATE sizes SET name = name || ' (old ' || id || ')' WHERE id = ?").run(clash.id);
        db.prepare('UPDATE sizes SET name=?, sort=?, archived=0 WHERE id=?').run(n, sort, row.id);
        keepS.add(row.id);
      } else {
        keepS.add(db.prepare('INSERT INTO sizes (product_id,name,sort) VALUES (?,?,?)').run(id, n, sort).lastInsertRowid);
      }
    });
    for (const e of existingS) if (!keepS.has(e.id)) db.prepare('UPDATE sizes SET archived = 1 WHERE id = ?').run(e.id);
    ensureStockRows();
    return id;
  })();
}

// Opening stock from the Hoodies_2026-2027 sheet (first run only).
if (db.prepare('SELECT COUNT(*) n FROM products').get().n === 0) {
  const colors = [
    ['Black', 'أسود', '#111111'], ['White', 'أبيض', '#F4F4F2'], ['Olive', 'زيتي', '#6B7046'],
    ['Grey', 'رمادي', '#8D9096'], ['Pink', 'زهري', '#F2A7C3'], ['Turquoise', 'تركوازي', '#2EC4C4'],
  ];
  const opening = { M: [3, 2, 1, 1, 3, 4], L: [3, 3, 2, 1, 8, 8], XL: [3, 3, 2, 0, 10, 6], '2XL': [3, 3, 0, 0, 3, 4] };
  db.transaction(() => {
    const pid = saveProduct({
      name: 'Hoodie', name_ar: 'هودي', price: 150000, printable: true, print_front: 30000, print_front_back: 50000,
      colors: colors.map(([name, name_ar, hex]) => ({ name, name_ar, hex })),
      sizes: Object.keys(opening).map((name) => ({ name })),
    });
    const cIds = db.prepare('SELECT id FROM colors WHERE product_id = ? ORDER BY sort').all(pid).map((r) => r.id);
    for (const s of db.prepare('SELECT id, name FROM sizes WHERE product_id = ?').all(pid)) {
      opening[s.name].forEach((qty, ci) => {
        db.prepare('UPDATE stock SET qty = ? WHERE color_id = ? AND size_id = ?').run(qty, cIds[ci], s.id);
        if (qty) db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note)
          VALUES (?,?,?,?,?,'opening','Opening stock — Hoodies 2026-2027 sheet')`).run(nowISO(), 'system', cIds[ci], s.id, qty);
      });
    }
  })();
}

function monthStartISO() {
  const d = new Date(); // server runs with TZ=Asia/Damascus
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function saleWithItems(id) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return null;
  sale.items = db.prepare(`SELECT id, product_id, color_id, size_id, qty, unit_price, print_type, print_price, line_total,
      product_name product, product_name_ar product_ar, color_name color, color_name_ar color_ar, color_hex hex, size_name size
    FROM sale_items WHERE sale_id = ? ORDER BY id`).all(id);
  sale.invoice_no = 'YW-' + String(sale.id).padStart(4, '0');
  sale.receipt_path = sale.receipt_token ? `/r/${sale.receipt_token}` : null;
  delete sale.receipt_token;
  return sale;
}

const ACTIVE_STOCK = `FROM stock st JOIN colors c ON c.id = st.color_id JOIN sizes s ON s.id = st.size_id
  JOIN products p ON p.id = c.product_id WHERE c.archived = 0 AND s.archived = 0 AND p.archived = 0`;

function buildState() {
  ensureStockRows();
  const since = monthStartISO();
  const month = db.prepare(`SELECT COUNT(*) sales, COALESCE(SUM(total),0) revenue FROM sales
    WHERE cancelled_at IS NULL AND created_at >= ?`).get(since);
  const monthPieces = db.prepare(`SELECT COALESCE(SUM(i.qty),0) n FROM sale_items i JOIN sales s ON s.id = i.sale_id
    WHERE s.cancelled_at IS NULL AND s.created_at >= ?`).get(since).n;
  const unpaid = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) amount FROM sales WHERE cancelled_at IS NULL AND paid = 0`).get();
  const best = db.prepare(`SELECT i.product_name product, i.color_name color, i.color_hex hex, i.size_name size, SUM(i.qty) n
    FROM sale_items i JOIN sales x ON x.id = i.sale_id WHERE x.cancelled_at IS NULL AND x.created_at >= ?
    GROUP BY i.color_id, i.size_id ORDER BY n DESC LIMIT 1`).get(since) || null;
  return {
    settings: getSettings(),
    products: db.prepare('SELECT * FROM products ORDER BY sort, id').all(),
    colors: db.prepare('SELECT * FROM colors ORDER BY product_id, sort, id').all(),
    sizes: db.prepare('SELECT * FROM sizes ORDER BY product_id, sort, id').all(),
    stock: db.prepare('SELECT color_id, size_id, qty FROM stock').all(),
    stats: {
      in_stock: db.prepare(`SELECT COALESCE(SUM(st.qty),0) n ${ACTIVE_STOCK}`).get().n,
      month_sales: month.sales, month_pieces: monthPieces, month_revenue: month.revenue,
      unpaid_count: unpaid.n, unpaid_amount: unpaid.amount, best_seller: best,
    },
  };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
// Coolify's Traefik proxy sits on the private Docker network; only trust forwarded headers from there.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use('/api/sales/:id/receipt', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());

const SESSION_DAYS = 30;
function auth(req, res, next) {
  const token = req.cookies.ys_session;
  const row = token && db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  if (!row) return res.status(401).json({ error: 'Please log in' });
  req.user = row.username;
  next();
}

// Brute-force guard: 8 wrong tries per IP per 15 minutes.
const loginFails = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginFails.get(ip);
  if (rec && now - rec.first < LOGIN_WINDOW && rec.count >= 8) {
    const mins = Math.ceil((rec.first + LOGIN_WINDOW - now) / 60000);
    return res.status(429).json({ error: `Too many wrong tries. Try again in ${mins} min.` });
  }
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const expected = USERS[username];
  const want = Buffer.from(expected || ''), got = Buffer.from(password);
  const ok = !!expected && want.length === got.length && crypto.timingSafeEqual(want, got);
  if (!ok) {
    const r = rec && now - rec.first < LOGIN_WINDOW ? rec : { first: now, count: 0 };
    r.count += 1; loginFails.set(ip, r);
    if (loginFails.size > 5000) loginFails.clear();
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?,?,?)').run(token, username, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie('ys_session', token, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5,
    secure: req.secure || process.env.COOKIE_SECURE === '1', // automatic on HTTPS
  });
  res.json({ username });
});
app.post('/api/logout', (req, res) => {
  if (req.cookies.ys_session) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.ys_session);
  res.clearCookie('ys_session');
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ username: req.user, default_passwords: DEFAULT_PASSWORDS }));
app.get('/api/state', auth, (req, res) => res.json(buildState()));

// ---- products ----
app.post('/api/products', auth, (req, res, next) => {
  try { const id = saveProduct(req.body || {}); res.json({ product_id: id, state: buildState() }); } catch (e) { next(e); }
});
app.put('/api/products/:id', auth, (req, res, next) => {
  try { saveProduct(req.body || {}, int(req.params.id)); res.json({ state: buildState() }); } catch (e) { next(e); }
});
app.post('/api/products/:id/archive', auth, (req, res, next) => {
  try {
    const r = db.prepare('UPDATE products SET archived = ? WHERE id = ?').run(req.body.archived === false ? 0 : 1, int(req.params.id));
    if (!r.changes) throw new HttpError(404, 'Product not found');
    res.json({ state: buildState() });
  } catch (e) { next(e); }
});

// ---- sales ----
app.post('/api/sales', auth, (req, res, next) => {
  try {
    const b = req.body || {};
    const customer = String(b.customer_name || '').trim().slice(0, 60);
    if (!customer) throw new HttpError(400, 'Client name is required');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'Add at least one item');

    const id = db.transaction(() => {
      const items = b.items.map((it) => {
        const qty = int(it.qty);
        if (qty <= 0) throw new HttpError(400, 'Quantity must be at least 1');
        const v = db.prepare(`SELECT st.qty have, c.id color_id, c.name color, c.name_ar color_ar, c.hex, c.archived ca,
            s.id size_id, s.name size, s.archived sa, s.product_id s_pid,
            p.id product_id, p.name product, p.name_ar product_ar, p.price, p.printable, p.print_front, p.print_front_back, p.archived pa
          FROM stock st JOIN colors c ON c.id = st.color_id JOIN sizes s ON s.id = st.size_id JOIN products p ON p.id = c.product_id
          WHERE st.color_id = ? AND st.size_id = ?`).get(int(it.color_id), int(it.size_id));
        if (!v || v.s_pid !== v.product_id || v.ca || v.sa || v.pa) throw new HttpError(400, 'That item is not available any more — refresh');
        const printType = v.printable && ['front', 'front_back'].includes(it.print_type) ? it.print_type : 'none';
        const printPrice = printType === 'front' ? v.print_front : printType === 'front_back' ? v.print_front_back : 0;
        const unit = it.unit_price == null || it.unit_price === '' ? v.price : int(it.unit_price);
        if (unit < 0) throw new HttpError(400, 'Price cannot be negative');
        return { ...v, qty, unit, printType, printPrice, label: `${v.product} ${v.color} ${v.size}` };
      });
      const demand = {};
      for (const it of items) demand[`${it.color_id}:${it.size_id}`] = (demand[`${it.color_id}:${it.size_id}`] || 0) + it.qty;
      for (const it of items) if (demand[`${it.color_id}:${it.size_id}`] > it.have) throw new HttpError(409, `Not enough ${it.label} — only ${it.have} left`);
      const subtotal = items.reduce((a, it) => a + (it.unit + it.printPrice) * it.qty, 0);
      const discount = Math.max(0, Math.min(int(b.discount), subtotal));
      const now = nowISO();
      const saleId = db.prepare(`INSERT INTO sales (created_at, created_by, customer_name, customer_phone, customer_instagram, subtotal, discount, total, paid, note)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(now, req.user, customer, String(b.customer_phone || '').trim().slice(0, 30), cleanInstagram(b.customer_instagram),
        subtotal, discount, subtotal - discount, b.paid === false ? 0 : 1, String(b.note || '').trim().slice(0, 300)).lastInsertRowid;
      for (const it of items) {
        db.prepare(`INSERT INTO sale_items (sale_id,product_id,color_id,size_id,product_name,product_name_ar,color_name,color_name_ar,color_hex,size_name,
            qty,unit_price,print_type,print_price,line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(saleId, it.product_id, it.color_id, it.size_id, it.product, it.product_ar, it.color, it.color_ar, it.hex, it.size,
            it.qty, it.unit, it.printType, it.printPrice, (it.unit + it.printPrice) * it.qty);
        db.prepare('UPDATE stock SET qty = qty - ? WHERE color_id = ? AND size_id = ?').run(it.qty, it.color_id, it.size_id);
        db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,sale_id) VALUES (?,?,?,?,?,'sale',?)`)
          .run(now, req.user, it.color_id, it.size_id, -it.qty, saleId);
      }
      return saleId;
    })();
    res.json({ sale: saleWithItems(id), state: buildState() });
  } catch (e) { next(e); }
});

app.get('/api/sales', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || 'all');
  const where = [];
  const params = [];
  if (q) {
    where.push(`(customer_name LIKE ? OR customer_phone LIKE ? OR customer_instagram LIKE ? OR note LIKE ?
      OR id IN (SELECT sale_id FROM sale_items WHERE product_name LIKE ? OR product_name_ar LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`, `%${q.replace(/^@/, '')}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === 'unpaid') where.push('paid = 0 AND cancelled_at IS NULL');
  if (status === 'cancelled') where.push('cancelled_at IS NOT NULL');
  const ids = db.prepare(`SELECT id FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...params);
  res.json({ sales: ids.map((r) => saleWithItems(r.id)) });
});

app.get('/api/sales/:id', auth, (req, res) => {
  const sale = saleWithItems(int(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  res.json({ sale });
});

app.post('/api/sales/:id/cancel', auth, (req, res, next) => {
  try {
    const id = int(req.params.id);
    db.transaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!sale) throw new HttpError(404, 'Sale not found');
      if (sale.cancelled_at) throw new HttpError(409, 'Sale already cancelled');
      const now = nowISO();
      db.prepare('UPDATE sales SET cancelled_at = ?, cancelled_by = ? WHERE id = ?').run(now, req.user, id);
      for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id)) {
        db.prepare('UPDATE stock SET qty = qty + ? WHERE color_id = ? AND size_id = ?').run(it.qty, it.color_id, it.size_id);
        db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,sale_id) VALUES (?,?,?,?,?,'cancel',?)`)
          .run(now, req.user, it.color_id, it.size_id, it.qty, id);
      }
    })();
    res.json({ sale: saleWithItems(id), state: buildState() });
  } catch (e) { next(e); }
});

// undo a cancel: the pieces leave stock again (only if they are still there)
app.post('/api/sales/:id/restore', auth, (req, res, next) => {
  try {
    const id = int(req.params.id);
    db.transaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!sale) throw new HttpError(404, 'Sale not found');
      if (!sale.cancelled_at) throw new HttpError(409, 'This sale is not cancelled');
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
      const demand = {};
      for (const it of items) demand[`${it.color_id}:${it.size_id}`] = (demand[`${it.color_id}:${it.size_id}`] || 0) + it.qty;
      for (const it of items) {
        const row = db.prepare('SELECT qty FROM stock WHERE color_id = ? AND size_id = ?').get(it.color_id, it.size_id);
        if (!row || row.qty < demand[`${it.color_id}:${it.size_id}`]) {
          throw new HttpError(409, `Not enough ${it.product_name} ${it.color_name} ${it.size_name} in stock to bring this sale back`);
        }
      }
      const now = nowISO();
      db.prepare('UPDATE sales SET cancelled_at = NULL, cancelled_by = NULL WHERE id = ?').run(id);
      for (const it of items) {
        db.prepare('UPDATE stock SET qty = qty - ? WHERE color_id = ? AND size_id = ?').run(it.qty, it.color_id, it.size_id);
        db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,sale_id,note) VALUES (?,?,?,?,?,'sale',?,'Cancel undone')`)
          .run(now, req.user, it.color_id, it.size_id, -it.qty, id);
      }
    })();
    res.json({ sale: saleWithItems(id), state: buildState() });
  } catch (e) { next(e); }
});

app.post('/api/sales/:id/paid', auth, (req, res) => {
  const id = int(req.params.id);
  const r = db.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(req.body.paid ? 1 : 0, id);
  if (!r.changes) return res.status(404).json({ error: 'Sale not found' });
  res.json({ sale: saleWithItems(id), state: buildState() });
});

// ---- stock ----
app.post('/api/restock', auth, (req, res, next) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items.filter((i) => int(i.qty) > 0) : [];
    if (!items.length) throw new HttpError(400, 'Nothing to add');
    const now = nowISO();
    db.transaction(() => {
      ensureStockRows();
      for (const it of items) {
        const ok = db.prepare('SELECT 1 FROM colors c JOIN sizes s ON s.product_id = c.product_id WHERE c.id = ? AND s.id = ?').get(int(it.color_id), int(it.size_id));
        if (!ok) throw new HttpError(400, 'Unknown color/size');
        db.prepare('UPDATE stock SET qty = qty + ? WHERE color_id = ? AND size_id = ?').run(int(it.qty), int(it.color_id), int(it.size_id));
        db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note) VALUES (?,?,?,?,?,'restock',?)`)
          .run(now, req.user, int(it.color_id), int(it.size_id), int(it.qty), String(req.body.note || '').slice(0, 200));
      }
    })();
    res.json({ state: buildState() });
  } catch (e) { next(e); }
});

app.post('/api/stock/set', auth, (req, res, next) => {
  try {
    const qty = int(req.body.qty, -1);
    if (qty < 0) throw new HttpError(400, 'Count must be 0 or more');
    db.transaction(() => {
      ensureStockRows();
      const cur = db.prepare('SELECT qty FROM stock WHERE color_id = ? AND size_id = ?').get(int(req.body.color_id), int(req.body.size_id));
      if (!cur) throw new HttpError(400, 'Unknown color/size');
      if (cur.qty === qty) return;
      db.prepare('UPDATE stock SET qty = ? WHERE color_id = ? AND size_id = ?').run(qty, int(req.body.color_id), int(req.body.size_id));
      db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note) VALUES (?,?,?,?,?,'adjust',?)`)
        .run(nowISO(), req.user, int(req.body.color_id), int(req.body.size_id), qty - cur.qty, String(req.body.note || 'Manual count correction').slice(0, 200));
    })();
    res.json({ state: buildState() });
  } catch (e) { next(e); }
});

// undo a restock or a count fix: applies the opposite change, never below zero
app.post('/api/stock/undo', auth, (req, res, next) => {
  try {
    const items = (Array.isArray(req.body.items) ? req.body.items : [])
      .map((i) => ({ c: int(i.color_id), s: int(i.size_id), d: int(i.delta) })).filter((i) => i.d !== 0);
    if (!items.length) throw new HttpError(400, 'Nothing to undo');
    const note = String(req.body.note || 'Undo').slice(0, 200);
    const now = nowISO();
    db.transaction(() => {
      for (const it of items) {
        const cur = db.prepare('SELECT qty FROM stock WHERE color_id = ? AND size_id = ?').get(it.c, it.s);
        if (!cur) throw new HttpError(400, 'Unknown color/size');
        if (cur.qty + it.d < 0) throw new HttpError(409, 'Some of those pieces were sold already');
        db.prepare('UPDATE stock SET qty = qty + ? WHERE color_id = ? AND size_id = ?').run(it.d, it.c, it.s);
        db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note) VALUES (?,?,?,?,?,'adjust',?)`)
          .run(now, req.user, it.c, it.s, it.d, note);
      }
    })();
    res.json({ state: buildState() });
  } catch (e) { next(e); }
});

app.get('/api/movements', auth, (req, res) => {
  res.json({
    movements: db.prepare(`SELECT m.*, p.name product, c.name color, c.hex, s.name size FROM movements m
      JOIN colors c ON c.id = m.color_id JOIN sizes s ON s.id = m.size_id JOIN products p ON p.id = c.product_id
      ORDER BY m.id DESC LIMIT 250`).all(),
  });
});

// ---- receipts: rendered in the browser (Arabic shaping + brand fonts), stored here behind a private link ----
const decodeData = (dataUrl, mimeRe) => {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || !mimeRe.test(m[1])) throw new HttpError(400, 'Bad receipt file');
  return Buffer.from(m[2], 'base64');
};
app.post('/api/sales/:id/receipt', auth, (req, res, next) => {
  try {
    const id = int(req.params.id);
    const sale = db.prepare('SELECT id, receipt_token FROM sales WHERE id = ?').get(id);
    if (!sale) throw new HttpError(404, 'Sale not found');
    const pdf = decodeData(req.body.pdf, /^application\/pdf$/);
    const img = decodeData(req.body.image, /^image\/jpeg$/);
    const og = decodeData(req.body.thumb, /^image\/jpeg$/);
    if (pdf.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'Bad PDF');
    const token = sale.receipt_token || crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(RECEIPTS_DIR, `${token}.pdf`), pdf);
    fs.writeFileSync(path.join(RECEIPTS_DIR, `${token}.jpg`), img);
    fs.writeFileSync(path.join(RECEIPTS_DIR, `${token}.og.jpg`), og);
    if (!sale.receipt_token) db.prepare('UPDATE sales SET receipt_token = ? WHERE id = ?').run(token, id);
    res.json({ receipt_path: `/r/${token}` });
  } catch (e) { next(e); }
});

app.get('/api/customers', auth, (req, res) => {
  res.json({ customers: db.prepare(`SELECT customer_name name, customer_phone phone, customer_instagram instagram, MAX(id) last_id, COUNT(*) sales
    FROM sales GROUP BY lower(trim(customer_name)) ORDER BY last_id DESC LIMIT 500`).all() });
});

// ---- settings ----
app.put('/api/settings', auth, (req, res, next) => {
  try {
    const numeric = ['low_threshold', 'high_threshold'];
    const text = ['currency', 'shop_phone', 'shop_instagram', 'receipt_note', 'logo'];
    const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    db.transaction(() => {
      for (const k of numeric) if (req.body[k] != null) {
        const v = int(req.body[k], -1);
        if (v < 0) throw new HttpError(400, `${k} must be 0 or more`);
        up.run(String(v), k);
      }
      for (const k of text) if (req.body[k] != null) {
        const v = String(req.body[k]);
        if (k === 'logo' && v && !/^data:image\/(png|jpeg|webp);base64,/.test(v)) throw new HttpError(400, 'Logo must be an image');
        up.run(k === 'logo' ? v : v.slice(0, 120), k);
      }
    })();
    res.json({ state: buildState() });
  } catch (e) { next(e); }
});

// ---- export + backup ----
app.get('/api/export/sales.csv', auth, (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.created_at, s.created_by, s.customer_name, s.customer_phone, s.customer_instagram,
    i.product_name, i.color_name, i.size_name, i.qty, i.unit_price, i.print_type, i.print_price, i.line_total,
    s.discount, s.total, s.paid, s.cancelled_at, s.note
    FROM sales s JOIN sale_items i ON i.sale_id = s.id ORDER BY s.id, i.id`).all();
  const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['invoice', 'date', 'by', 'client', 'phone', 'instagram', 'product', 'color', 'size', 'qty', 'unit_price', 'print', 'print_price', 'line_total', 'sale_discount', 'sale_total', 'paid', 'cancelled', 'note'];
  const body = rows.map((r) => [
    'YW-' + String(r.id).padStart(4, '0'), r.created_at, r.created_by, r.customer_name, r.customer_phone, r.customer_instagram ? '@' + r.customer_instagram : '',
    r.product_name, r.color_name, r.size_name, r.qty, r.unit_price, r.print_type, r.print_price, r.line_total, r.discount, r.total,
    r.paid ? 'yes' : 'no', r.cancelled_at ? 'yes' : '', r.note,
  ].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="yalla-sales.csv"');
  res.send('﻿' + [head.join(','), ...body].join('\n'));
});

app.get('/api/backup', auth, async (req, res, next) => {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  try {
    await db.backup(tmp);
    res.download(tmp, `yalla-stock-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(tmp, { force: true }, () => {}));
  } catch (e) { fs.rm(tmp, { force: true }, () => {}); next(e); }
});

// ---- public receipt page (opened by the client from WhatsApp / Instagram) ----
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN_RE = /^[a-f0-9]{32}$/;
function publicSale(token) {
  if (!TOKEN_RE.test(token)) return null;
  const row = db.prepare('SELECT id FROM sales WHERE receipt_token = ?').get(token);
  return row ? saleWithItems(row.id) : null;
}
const sendReceiptFile = (ext, type) => (req, res) => {
  const sale = publicSale(req.params.token);
  if (!sale) return res.status(404).send('Not found');
  const file = path.join(RECEIPTS_DIR, `${req.params.token}.${ext}`);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (ext === 'pdf') res.setHeader('Content-Disposition', `inline; filename="YallaWear-${sale.invoice_no}.pdf"`);
  res.sendFile(file);
};
app.get('/r/:token/receipt.pdf', sendReceiptFile('pdf', 'application/pdf'));
app.get('/r/:token/receipt.jpg', sendReceiptFile('jpg', 'image/jpeg'));
app.get('/r/:token/og.jpg', sendReceiptFile('og.jpg', 'image/jpeg'));
app.get('/r/:token', (req, res) => {
  const sale = publicSale(req.params.token);
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!sale) return res.status(404).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#2E2D4C;color:#F2F5F1;font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h2>Receipt not found</h2><p>إيصال غير موجود</p></div>');
  const st = getSettings();
  const base = `${req.protocol}://${req.get('host')}`;
  const jpg = path.join(RECEIPTS_DIR, `${req.params.token}.jpg`);
  const v = fs.existsSync(jpg) ? Math.round(fs.statSync(jpg).mtimeMs / 1000) : 0;
  const total = `${Number(sale.total).toLocaleString('en-US')} ${st.currency}`;
  const cancelled = !!sale.cancelled_at;
  const contact = [st.shop_instagram && `<a href="https://instagram.com/${escHtml(cleanInstagram(st.shop_instagram))}">Instagram ${escHtml(st.shop_instagram)}</a>`,
    st.shop_phone && `<a href="https://wa.me/${escHtml(String(st.shop_phone).replace(/\D/g, ''))}">WhatsApp ${escHtml(st.shop_phone)}</a>`].filter(Boolean).join(' · ');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#2E2D4C">
<meta name="robots" content="noindex,nofollow">
<title>Yalla Wear · Receipt ${sale.invoice_no}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Yalla Wear">
<meta property="og:title" content="Yalla Wear · Receipt ${sale.invoice_no}">
<meta property="og:description" content="${escHtml(sale.customer_name)} · Total ${escHtml(total)}${cancelled ? ' · CANCELLED' : ''}">
<meta property="og:image" content="${base}/r/${req.params.token}/og.jpg?v=${v}"><meta property="og:image:type" content="image/jpeg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/brand/icon-512.png">
<style>
@font-face{font-family:Bebas;src:url(/fonts/bebas-neue-latin-400-normal.woff2) format('woff2')}
@font-face{font-family:Inter;src:url(/fonts/inter-latin-600-normal.woff2) format('woff2');font-weight:600}
@font-face{font-family:Cairo;src:url(/fonts/cairo-arabic-700-normal.woff2) format('woff2');font-weight:700}
*{box-sizing:border-box}::selection{background:#C0DBC6;color:#2E2D4C}html{scrollbar-color:#C0DBC6 #262543;scrollbar-width:thin}html{background:#2E2D4C}body{margin:0;background:#2E2D4C;color:#F2F5F1;font-family:Inter,Cairo,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.w{max-width:560px;margin:0 auto;padding:22px 16px calc(28px + env(safe-area-inset-bottom,0px))}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.top img{height:46px}
.inv{font-family:Bebas,sans-serif;font-size:26px;letter-spacing:1px;color:#ABAACB}
.card{border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.35)}
.card img{display:block;width:100%}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;padding:15px;border-radius:14px;font-weight:600;font-size:16px;text-decoration:none;margin-top:16px;background:#C0DBC6;color:#2E2D4C}
.ar{font-family:Cairo,sans-serif;font-weight:700}
.x{background:rgba(255,92,108,.15);color:#FF7A87;border:1px solid rgba(255,92,108,.4);padding:12px;border-radius:12px;text-align:center;font-weight:600;margin-bottom:14px}
.f{text-align:center;color:#ABAACB;font-size:13px;margin-top:22px;line-height:1.7}.f a{color:#C0DBC6;text-decoration:none}
.f img{height:15px;opacity:.9;display:block;margin:0 auto 8px}
</style></head><body><div class="w">
<div class="top"><img src="/brand/logo-lockup.png" alt="Yalla Wear"><div class="inv">${sale.invoice_no}</div></div>
${cancelled ? '<div class="x">This sale was cancelled · <span class="ar">تم إلغاء هذه الفاتورة</span></div>' : ''}
<div class="card"><img src="/r/${req.params.token}/receipt.jpg?v=${v}" alt="Receipt ${sale.invoice_no}"></div>
<a class="btn" href="/r/${req.params.token}/receipt.pdf?v=${v}" download="YallaWear-${sale.invoice_no}.pdf">Download PDF · <span class="ar">تحميل الإيصال</span></a>
<div class="f"><img src="/brand/tagline.png" alt="Style That Moves You!">${contact}</div>
</div></body></html>`);
});

app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(woff2|png)$/.test(file) ? 'public, max-age=604800' : 'no-cache'),
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  let status = err.status || 500;
  let msg = err.message;
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') { status = 409; msg = 'That name is already used'; }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : msg });
});

app.listen(PORT, () => console.log(`[yalla] Yalla Stock running on http://localhost:${PORT}`));
