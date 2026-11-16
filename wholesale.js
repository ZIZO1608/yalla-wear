'use strict';
// Wholesale: shops you give a login to can order from the website and follow their orders.
// You create every wholesaler account (nobody can sign up). They see products that have a wholesale price,
// how many are in stock, and can order more than you have (the rest is made to order).
// Each order goes Pending → Accepted → In production → Ready → Delivered (or Rejected / Cancelled).
// Pieces that are in stock are taken from stock when you accept, and go back if the order is rejected or cancelled.
// Invoices are drawn in the admin app (same look as receipts) and stored here for the wholesaler to download.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function wholesale(ctx) {
  const { app, db, auth, HttpError, int, str, nowISO, liveLine, printPriceFor, cleanPrint, cleanInstagram, getSettings, RECEIPTS_DIR, loginGuard, fire } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS wholesalers (
    id INTEGER PRIMARY KEY, business_name TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL, pass_hash TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_username ON wholesalers(lower(username));
  CREATE TABLE IF NOT EXISTS ws_sessions (token TEXT PRIMARY KEY, wholesaler_id INTEGER NOT NULL REFERENCES wholesalers(id), expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ws_orders (
    id INTEGER PRIMARY KEY, wholesaler_id INTEGER NOT NULL REFERENCES wholesalers(id),
    created_at TEXT NOT NULL, created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','production','ready','delivered','rejected','cancelled')),
    customer_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0, stock_taken INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL, invoice_token TEXT UNIQUE, invoice_for TEXT);
  -- lines keep a snapshot of names; from_stock = pieces taken from stock (the rest is made to order)
  CREATE TABLE IF NOT EXISTS ws_order_items (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES ws_orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id), color_id INTEGER NOT NULL REFERENCES colors(id), size_id INTEGER NOT NULL REFERENCES sizes(id),
    product_name TEXT NOT NULL, product_name_ar TEXT NOT NULL DEFAULT '', color_name TEXT NOT NULL, color_name_ar TEXT NOT NULL DEFAULT '',
    color_hex TEXT NOT NULL, size_name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0), unit_price INTEGER NOT NULL, print_type TEXT NOT NULL DEFAULT 'none',
    print_price INTEGER NOT NULL DEFAULT 0, line_total INTEGER NOT NULL, from_stock INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS ws_order_events (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES ws_orders(id), created_at TEXT NOT NULL,
    by_name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT, note TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_wso_ws ON ws_orders(wholesaler_id);
  CREATE INDEX IF NOT EXISTS idx_wsi_order ON ws_order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_wse_order ON ws_order_events(order_id);
  `);
  if (!db.prepare('PRAGMA table_info(movements)').all().some((c) => c.name === 'ws_order_id')) db.exec('ALTER TABLE movements ADD COLUMN ws_order_id INTEGER');
  const addSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  addSetting.run('ws_welcome', 'Welcome to Yalla Wear wholesale. Pick colors and sizes, send your order, and follow it here.');
  addSetting.run('ws_show_stock', '1');

  const STATUSES = ['pending', 'accepted', 'production', 'ready', 'delivered', 'rejected', 'cancelled'];
  const ACTIVE = ['accepted', 'production', 'ready', 'delivered'];
  const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', production: 'In production', ready: 'Ready', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled' };
  const orderNo = (id) => 'WS-' + String(id).padStart(4, '0');

  // ---------- passwords ----------
  const hashPass = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`; };
  const checkPass = (pw, stored) => {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const want = Buffer.from(hash, 'hex'), got = crypto.scryptSync(String(pw), salt, 32);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  };
  const checkNewPass = (pw) => { if (String(pw).length < 6) throw new HttpError(400, 'Password must be at least 6 characters'); return String(pw); };

  // ---------- reading ----------
  const publicWholesaler = (w) => w && ({
    id: w.id, business_name: w.business_name, contact_name: w.contact_name, phone: w.phone, instagram: w.instagram,
    city: w.city, username: w.username, created_at: w.created_at, last_login_at: w.last_login_at,
  });
  const WS_STATS = `SELECT w.*, COUNT(o.id) orders,
      COALESCE(SUM(CASE WHEN o.status IN ('accepted','production','ready','delivered') THEN o.total ELSE 0 END), 0) spent,
      COALESCE(SUM(CASE WHEN o.status IN ('accepted','production','ready','delivered') AND o.paid = 0 THEN o.total ELSE 0 END), 0) unpaid_amount,
      COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) pending,
      MAX(o.created_at) last_order_at
    FROM wholesalers w LEFT JOIN ws_orders o ON o.wholesaler_id = w.id`;
  const adminWholesaler = (w) => { if (!w) return w; const { pass_hash, ...rest } = w; return rest; };

  function orderFull(id, forWholesaler = false) {
    const o = db.prepare(`SELECT o.*, w.business_name, w.contact_name, w.phone, w.instagram, w.city
      FROM ws_orders o JOIN wholesalers w ON w.id = o.wholesaler_id WHERE o.id = ?`).get(id);
    if (!o) return null;
    o.order_no = orderNo(o.id);
    o.items = db.prepare(`SELECT id, product_id, color_id, size_id, qty, unit_price, print_type, print_price, line_total, from_stock,
        product_name product, product_name_ar product_ar, color_name color, color_name_ar color_ar, color_hex hex, size_name size
      FROM ws_order_items WHERE order_id = ? ORDER BY id`).all(id);
    o.events = db.prepare('SELECT created_at, by_name, kind, status, note FROM ws_order_events WHERE order_id = ? ORDER BY id').all(id);
    o.has_invoice = !!(o.invoice_token && fs.existsSync(path.join(RECEIPTS_DIR, `ws-${o.invoice_token}.pdf`)));
    o.invoice_stale = o.has_invoice && o.invoice_for !== o.updated_at;
    delete o.invoice_token;
    if (forWholesaler) {
      delete o.admin_note; delete o.created_by; delete o.stock_taken; delete o.invoice_for;
      o.events = o.events.filter((e) => e.kind !== 'internal');
    }
    return o;
  }
  const event = (orderId, by, kind, status = null, note = '') =>
    db.prepare('INSERT INTO ws_order_events (order_id, created_at, by_name, kind, status, note) VALUES (?,?,?,?,?,?)').run(orderId, nowISO(), by, kind, status, str(note, 300));

  // ---------- order lines ----------
  // asAdmin: prices can be set per line, and saved lines (with id) keep their names. Wholesalers always get the wholesale price.
  function buildLines(rawItems, { asAdmin = false, oldItems = [] } = {}) {
    if (!Array.isArray(rawItems) || !rawItems.length) throw new HttpError(400, 'Add at least one item');
    const lines = rawItems.map((it) => {
      const qty = int(it.qty);
      if (qty <= 0) throw new HttpError(400, 'Quantity must be at least 1');
      if (qty > 100000) throw new HttpError(400, 'That quantity is too big');
      const old = asAdmin && it.id ? oldItems.find((o) => o.id === int(it.id)) : null;
      if (old) {
        const p = db.prepare('SELECT printable, print_front, print_front_back FROM products WHERE id = ?').get(old.product_id) || { printable: 0 };
        const printType = it.print_type == null || it.print_type === old.print_type ? old.print_type : cleanPrint(p.printable, it.print_type);
        const unit = it.unit_price == null || it.unit_price === '' ? old.unit_price : int(it.unit_price);
        if (unit < 0) throw new HttpError(400, 'Price cannot be negative');
        return { id: old.id, product_id: old.product_id, color_id: old.color_id, size_id: old.size_id,
          product: old.product_name, product_ar: old.product_name_ar, color: old.color_name, color_ar: old.color_name_ar, hex: old.color_hex, size: old.size_name,
          qty, unit, printType, printPrice: printType === old.print_type ? old.print_price : printPriceFor(p, printType) };
      }
      const v = liveLine(it.color_id, it.size_id);
      if (!asAdmin && !(v.wholesale_price > 0)) throw new HttpError(400, `${v.product} is not sold wholesale`);
      const printType = cleanPrint(v.printable, it.print_type);
      const base = v.wholesale_price > 0 ? v.wholesale_price : v.price;
      const unit = asAdmin && it.unit_price != null && it.unit_price !== '' ? int(it.unit_price) : base;
      if (unit < 0) throw new HttpError(400, 'Price cannot be negative');
      return { ...v, qty, unit, printType, printPrice: printPriceFor(v, printType) };
    });
    if (!asAdmin) {
      // the least pieces per product in one order
      const per = {};
      for (const l of lines) {
        per[l.product_id] = per[l.product_id] || { n: 0, min: l.wholesale_min, name: l.product };
        per[l.product_id].n += l.qty;
      }
      for (const p of Object.values(per)) if (p.min > 1 && p.n < p.min) throw new HttpError(400, `${p.name}: the least for wholesale is ${p.min} pieces (you have ${p.n})`);
    }
    return lines;
  }
  const insertLine = (orderId, l) => db.prepare(`INSERT INTO ws_order_items (order_id,product_id,color_id,size_id,product_name,product_name_ar,color_name,color_name_ar,color_hex,size_name,
      qty,unit_price,print_type,print_price,line_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orderId, l.product_id, l.color_id, l.size_id, l.product, l.product_ar || '', l.color, l.color_ar || '', l.hex, l.size,
      l.qty, l.unit, l.printType, l.printPrice, (l.unit + l.printPrice) * l.qty);
  function writeLines(orderId, lines, discountRaw) {
    const old = db.prepare('SELECT id FROM ws_order_items WHERE order_id = ?').all(orderId).map((r) => r.id);
    const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
    for (const id of old) if (!keep.has(id)) db.prepare('DELETE FROM ws_order_items WHERE id = ?').run(id);
    for (const l of lines) {
      if (l.id) db.prepare('UPDATE ws_order_items SET qty=?, unit_price=?, print_type=?, print_price=?, line_total=? WHERE id=?')
        .run(l.qty, l.unit, l.printType, l.printPrice, (l.unit + l.printPrice) * l.qty, l.id);
      else insertLine(orderId, l);
    }
    const subtotal = lines.reduce((a, l) => a + (l.unit + l.printPrice) * l.qty, 0);
    const discount = Math.max(0, Math.min(int(discountRaw), subtotal));
    db.prepare('UPDATE ws_orders SET subtotal=?, discount=?, total=? WHERE id=?').run(subtotal, discount, subtotal - discount, orderId);
  }

  // ---------- stock ----------
  // takes what is in stock for each line (the rest is made to order)
  function takeStock(orderId, user) {
    const now = nowISO();
    const left = {};
    for (const it of db.prepare('SELECT * FROM ws_order_items WHERE order_id = ? ORDER BY id').all(orderId)) {
      const key = `${it.color_id}:${it.size_id}`;
      if (!(key in left)) left[key] = (db.prepare('SELECT qty FROM stock WHERE color_id = ? AND size_id = ?').get(it.color_id, it.size_id) || { qty: 0 }).qty;
      const take = Math.min(left[key], it.qty);
      left[key] -= take;
      db.prepare('UPDATE ws_order_items SET from_stock = ? WHERE id = ?').run(take, it.id);
      if (!take) continue;
      db.prepare('UPDATE stock SET qty = qty - ? WHERE color_id = ? AND size_id = ?').run(take, it.color_id, it.size_id);
      db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note,ws_order_id) VALUES (?,?,?,?,?,'adjust',?,?)`)
        .run(now, user, it.color_id, it.size_id, -take, `Wholesale ${orderNo(orderId)}`, orderId);
    }
    db.prepare('UPDATE ws_orders SET stock_taken = 1 WHERE id = ?').run(orderId);
  }
  function releaseStock(orderId, user, why) {
    const now = nowISO();
    for (const it of db.prepare('SELECT * FROM ws_order_items WHERE order_id = ? AND from_stock > 0').all(orderId)) {
      db.prepare('UPDATE stock SET qty = qty + ? WHERE color_id = ? AND size_id = ?').run(it.from_stock, it.color_id, it.size_id);
      db.prepare(`INSERT INTO movements (created_at,created_by,color_id,size_id,delta,reason,note,ws_order_id) VALUES (?,?,?,?,?,'adjust',?,?)`)
        .run(now, user, it.color_id, it.size_id, it.from_stock, `Wholesale ${orderNo(orderId)} — ${why}`, orderId);
    }
    db.prepare('UPDATE ws_order_items SET from_stock = 0 WHERE order_id = ?').run(orderId);
    db.prepare('UPDATE ws_orders SET stock_taken = 0 WHERE id = ?').run(orderId);
  }

  // ---------- admin: wholesalers ----------
  function wholesalerFields(b, { creating }) {
    const f = {
      business_name: str(b.business_name, 80), contact_name: str(b.contact_name, 60), phone: str(b.phone, 30),
      instagram: cleanInstagram(b.instagram), city: str(b.city, 60), note: str(b.note, 300),
      username: str(b.username, 40).toLowerCase(),
    };
    if (!f.business_name) throw new HttpError(400, 'Shop name is required');
    if (!/^[a-z0-9._-]{3,40}$/.test(f.username)) throw new HttpError(400, 'Username: 3+ letters or numbers, no spaces');
    if (creating || b.password) f.pass_hash = hashPass(checkNewPass(b.password));
    return f;
  }
  const wholesalerById = (id) => adminWholesaler(db.prepare(`${WS_STATS} WHERE w.id = ? GROUP BY w.id`).get(id));

  app.get('/api/wholesalers', auth, (req, res) => {
    res.json({ wholesalers: db.prepare(`${WS_STATS} WHERE w.archived = 0 GROUP BY w.id ORDER BY COALESCE(MAX(o.created_at), w.created_at) DESC`).all().map(adminWholesaler) });
  });
  app.get('/api/wholesalers/:id', auth, (req, res) => {
    const w = wholesalerById(int(req.params.id));
    if (!w) return res.status(404).json({ error: 'Wholesaler not found' });
    const ids = db.prepare('SELECT id FROM ws_orders WHERE wholesaler_id = ? ORDER BY id DESC LIMIT 200').all(w.id);
    res.json({ wholesaler: w, orders: ids.map((r) => orderFull(r.id)) });
  });
  app.post('/api/wholesalers', auth, (req, res, next) => {
    try {
      const f = wholesalerFields(req.body || {}, { creating: true });
      if (db.prepare('SELECT 1 FROM wholesalers WHERE lower(username) = ?').get(f.username)) throw new HttpError(409, `The username ${f.username} is taken`);
      const now = nowISO();
      const id = db.prepare(`INSERT INTO wholesalers (business_name, contact_name, phone, instagram, city, note, username, pass_hash, created_at, created_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(f.business_name, f.contact_name, f.phone, f.instagram, f.city, f.note, f.username, f.pass_hash, now, req.user, now).lastInsertRowid;
      res.json({ wholesaler: wholesalerById(id) });
    } catch (e) { next(e); }
  });
  app.put('/api/wholesalers/:id', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      if (!db.prepare('SELECT 1 FROM wholesalers WHERE id = ?').get(id)) throw new HttpError(404, 'Wholesaler not found');
      const f = wholesalerFields(req.body || {}, { creating: false });
      const clash = db.prepare('SELECT id FROM wholesalers WHERE lower(username) = ?').get(f.username);
      if (clash && clash.id !== id) throw new HttpError(409, `The username ${f.username} is taken`);
      db.prepare(`UPDATE wholesalers SET business_name=?, contact_name=?, phone=?, instagram=?, city=?, note=?, username=?, updated_at=? WHERE id=?`)
        .run(f.business_name, f.contact_name, f.phone, f.instagram, f.city, f.note, f.username, nowISO(), id);
      if (f.pass_hash) {
        db.prepare('UPDATE wholesalers SET pass_hash = ? WHERE id = ?').run(f.pass_hash, id);
        db.prepare('DELETE FROM ws_sessions WHERE wholesaler_id = ?').run(id); // new password logs them out everywhere
      }
      res.json({ wholesaler: wholesalerById(id) });
    } catch (e) { next(e); }
  });
  // removing blocks their login; their orders stay
  app.post('/api/wholesalers/:id/archive', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const archived = req.body && req.body.archived === false ? 0 : 1;
      const r = db.prepare('UPDATE wholesalers SET archived = ?, updated_at = ? WHERE id = ?').run(archived, nowISO(), id);
      if (!r.changes) throw new HttpError(404, 'Wholesaler not found');
      if (archived) db.prepare('DELETE FROM ws_sessions WHERE wholesaler_id = ?').run(id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- admin: orders ----------
  app.get('/api/ws-orders', auth, (req, res) => {
    const status = String(req.query.status || 'open');
    const where = [], params = [];
    if (status === 'open') where.push("o.status IN ('pending','accepted','production','ready')");
    else if (status === 'closed') where.push("o.status IN ('rejected','cancelled')");
    else if (status === 'unpaid') where.push("o.status IN ('accepted','production','ready','delivered') AND o.paid = 0");
    else if (STATUSES.includes(status)) { where.push('o.status = ?'); params.push(status); }
    if (req.query.wholesaler_id) { where.push('o.wholesaler_id = ?'); params.push(int(req.query.wholesaler_id)); }
    const ids = db.prepare(`SELECT o.id FROM ws_orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`).all(...params);
    res.json({ orders: ids.map((r) => orderFull(r.id)), stats: wsStats() });
  });
  function wsStats() {
    const since = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); })();
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    return {
      pending: one("SELECT COUNT(*) n FROM ws_orders WHERE status = 'pending'").n,
      in_work: one("SELECT COUNT(*) n FROM ws_orders WHERE status IN ('accepted','production')").n,
      ready: one("SELECT COUNT(*) n FROM ws_orders WHERE status = 'ready'").n,
      unpaid_amount: one("SELECT COALESCE(SUM(total),0) n FROM ws_orders WHERE status IN ('accepted','production','ready','delivered') AND paid = 0").n,
      month_total: one("SELECT COALESCE(SUM(total),0) n FROM ws_orders WHERE status IN ('accepted','production','ready','delivered') AND created_at >= ?", since).n,
      month_orders: one("SELECT COUNT(*) n FROM ws_orders WHERE status IN ('accepted','production','ready','delivered') AND created_at >= ?", since).n,
      wholesalers: one('SELECT COUNT(*) n FROM wholesalers WHERE archived = 0').n,
    };
  }
  ctx.wsStats = wsStats;

  app.get('/api/ws-orders/:id', auth, (req, res) => {
    const o = orderFull(int(req.params.id));
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json({ order: o });
  });

  // you can also write an order for a wholesaler (phone/WhatsApp orders)
  app.post('/api/ws-orders', auth, (req, res, next) => {
    try {
      const b = req.body || {};
      const w = db.prepare('SELECT * FROM wholesalers WHERE id = ?').get(int(b.wholesaler_id));
      if (!w) throw new HttpError(400, 'Pick a wholesaler');
      const id = db.transaction(() => {
        const lines = buildLines(b.items, { asAdmin: true });
        const now = nowISO();
        const oid = db.prepare(`INSERT INTO ws_orders (wholesaler_id, created_at, created_by, customer_note, admin_note, due_date, paid, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(w.id, now, req.user, str(b.customer_note, 500), str(b.admin_note, 500), str(b.due_date, 10), b.paid ? 1 : 0, now).lastInsertRowid;
        writeLines(oid, lines, b.discount);
        event(oid, req.user, 'created', 'pending', 'Order written by Yalla Wear');
        return oid;
      })();
      res.json({ order: orderFull(id), state: ctx.buildState() });
    } catch (e) { next(e); }
  });

  // edit everything on an order: lines, prices, discount, notes, due date, paid
  app.put('/api/ws-orders/:id', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const b = req.body || {};
      db.transaction(() => {
        const o = db.prepare('SELECT * FROM ws_orders WHERE id = ?').get(id);
        if (!o) throw new HttpError(404, 'Order not found');
        const oldItems = db.prepare('SELECT * FROM ws_order_items WHERE order_id = ?').all(id);
        if (b.items) {
          const lines = buildLines(b.items, { asAdmin: true, oldItems });
          if (o.stock_taken) releaseStock(id, req.user, 'order edited');
          writeLines(id, lines, b.discount != null ? b.discount : o.discount);
          if (o.stock_taken) takeStock(id, req.user);
        } else if (b.discount != null) {
          const d = Math.max(0, Math.min(int(b.discount), o.subtotal));
          db.prepare('UPDATE ws_orders SET discount = ?, total = subtotal - ? WHERE id = ?').run(d, d, id);
        }
        db.prepare(`UPDATE ws_orders SET customer_note = ?, admin_note = ?, due_date = ?, paid = ?, updated_at = ? WHERE id = ?`)
          .run(b.customer_note != null ? str(b.customer_note, 500) : o.customer_note, b.admin_note != null ? str(b.admin_note, 500) : o.admin_note,
            b.due_date != null ? str(b.due_date, 10) : o.due_date, b.paid != null ? (b.paid ? 1 : 0) : o.paid, nowISO(), id);
        if (b.items) event(id, req.user, 'edited', null, 'Order changed by Yalla Wear');
        if (b.paid != null && !!b.paid !== !!o.paid) event(id, req.user, 'paid', null, b.paid ? 'Marked as paid' : 'Marked as not paid');
      })();
      if (b.items) fire('wsOrderChanged', id, req.user);
      res.json({ order: orderFull(id), state: ctx.buildState() });
    } catch (e) { next(e); }
  });

  // move an order to another status; stock follows (taken when accepted, back when rejected/cancelled)
  app.post('/api/ws-orders/:id/status', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const status = String((req.body || {}).status || '');
      if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
      db.transaction(() => {
        const o = db.prepare('SELECT * FROM ws_orders WHERE id = ?').get(id);
        if (!o) throw new HttpError(404, 'Order not found');
        if (o.status === status) return;
        if (ACTIVE.includes(status) && !o.stock_taken) takeStock(id, req.user);
        if (!ACTIVE.includes(status) && o.stock_taken) releaseStock(id, req.user, STATUS_LABEL[status].toLowerCase());
        db.prepare('UPDATE ws_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), id);
        event(id, req.user, 'status', status, (req.body || {}).note || '');
      })();
      fire('wsOrderChanged', id, req.user);
      res.json({ order: orderFull(id), state: ctx.buildState() });
    } catch (e) { next(e); }
  });

  // the invoice PDF drawn in the admin app
  app.post('/api/ws-orders/:id/invoice', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const o = db.prepare('SELECT id, invoice_token, updated_at FROM ws_orders WHERE id = ?').get(id);
      if (!o) throw new HttpError(404, 'Order not found');
      const m = /^data:application\/pdf;base64,(.+)$/.exec(String((req.body || {}).pdf || ''));
      if (!m) throw new HttpError(400, 'Bad invoice file');
      const pdf = Buffer.from(m[1], 'base64');
      if (pdf.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'Bad PDF');
      const token = o.invoice_token || crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(path.join(RECEIPTS_DIR, `ws-${token}.pdf`), pdf);
      const forVersion = String((req.body || {}).for_version || o.updated_at);
      db.prepare('UPDATE ws_orders SET invoice_token = ?, invoice_for = ? WHERE id = ?').run(token, forVersion, id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  const sendInvoice = (o, res) => {
    const tok = db.prepare('SELECT invoice_token FROM ws_orders WHERE id = ?').get(o.id).invoice_token;
    const file = tok && path.join(RECEIPTS_DIR, `ws-${tok}.pdf`);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'The invoice is not ready yet' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Disposition', `inline; filename="YallaWear-${o.order_no}.pdf"`);
    res.sendFile(file);
  };
  app.get('/api/ws-orders/:id/invoice.pdf', auth, (req, res) => {
    const o = orderFull(int(req.params.id));
    if (!o) return res.status(404).json({ error: 'Order not found' });
    sendInvoice(o, res);
  });

  // ---------- wholesaler side ----------
  const SESSION_DAYS = 30;
  function wsAuth(req, res, next) {
    const token = req.cookies.ys_ws;
    const row = token && db.prepare(`SELECT w.* FROM ws_sessions s JOIN wholesalers w ON w.id = s.wholesaler_id
      WHERE s.token = ? AND s.expires_at > ? AND w.archived = 0`).get(token, Date.now());
    if (!row) return res.status(401).json({ error: 'Please log in' });
    req.ws = row;
    next();
  }
  app.post('/api/ws/login', (req, res) => {
    const ip = 'ws:' + (req.ip || 'unknown');
    const blocked = loginGuard.blocked(ip);
    if (blocked) return res.status(429).json({ error: blocked });
    const username = str((req.body || {}).username, 40).toLowerCase();
    const w = db.prepare('SELECT * FROM wholesalers WHERE lower(username) = ? AND archived = 0').get(username);
    // compare even when the user is unknown, so timing does not tell which usernames exist
    const ok = checkPass((req.body || {}).password, w ? w.pass_hash : 'x:00');
    if (!w || !ok) { loginGuard.fail(ip); return res.status(401).json({ error: 'Wrong username or password · اسم المستخدم أو كلمة السر غلط' }); }
    loginGuard.ok(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO ws_sessions (token, wholesaler_id, expires_at) VALUES (?,?,?)').run(token, w.id, Date.now() + SESSION_DAYS * 864e5);
    db.prepare('DELETE FROM ws_sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('UPDATE wholesalers SET last_login_at = ? WHERE id = ?').run(nowISO(), w.id);
    res.cookie('ys_ws', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5, secure: req.secure || process.env.COOKIE_SECURE === '1' });
    res.json({ wholesaler: publicWholesaler(w) });
  });
  app.post('/api/ws/logout', (req, res) => {
    if (req.cookies.ys_ws) db.prepare('DELETE FROM ws_sessions WHERE token = ?').run(req.cookies.ys_ws);
    res.clearCookie('ys_ws');
    res.json({ ok: true });
  });
  const shopInfo = () => {
    const st = getSettings();
    return { currency: st.currency, shop_phone: st.shop_phone, shop_instagram: st.shop_instagram, logo: st.logo, welcome: st.ws_welcome, show_stock: st.ws_show_stock !== '0' };
  };
  app.get('/api/ws/me', wsAuth, (req, res) => res.json({ wholesaler: publicWholesaler(req.ws), shop: shopInfo() }));
  app.put('/api/ws/password', wsAuth, (req, res, next) => {
    try {
      const b = req.body || {};
      if (!checkPass(b.current, req.ws.pass_hash)) throw new HttpError(400, 'Your current password is wrong');
      db.prepare('UPDATE wholesalers SET pass_hash = ?, updated_at = ? WHERE id = ?').run(hashPass(checkNewPass(b.next)), nowISO(), req.ws.id);
      db.prepare('DELETE FROM ws_sessions WHERE wholesaler_id = ? AND token <> ?').run(req.ws.id, req.cookies.ys_ws);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // products sold wholesale, with stock (exact counts, or just in stock / made to order)
  app.get('/api/ws/catalog', wsAuth, (req, res) => {
    const showStock = getSettings().ws_show_stock !== '0';
    const products = db.prepare(`SELECT id, name, name_ar, wholesale_price, wholesale_min, printable, print_front, print_front_back
      FROM products WHERE archived = 0 AND wholesale_price > 0 ORDER BY sort, id`).all();
    const pids = products.map((p) => p.id);
    const inP = pids.length ? `(${pids.join(',')})` : '(0)';
    const colors = db.prepare(`SELECT id, product_id, name, name_ar, hex FROM colors WHERE archived = 0 AND product_id IN ${inP} ORDER BY product_id, sort, id`).all();
    const sizes = db.prepare(`SELECT id, product_id, name FROM sizes WHERE archived = 0 AND product_id IN ${inP} ORDER BY product_id, sort, id`).all();
    const stock = db.prepare(`SELECT st.color_id, st.size_id, st.qty FROM stock st JOIN colors c ON c.id = st.color_id WHERE c.product_id IN ${inP}`).all()
      .map((r) => (showStock ? r : { color_id: r.color_id, size_id: r.size_id, qty: r.qty > 0 ? 1 : 0 }));
    res.json({ products, colors, sizes, stock, show_stock: showStock });
  });
  app.get('/api/ws/orders', wsAuth, (req, res) => {
    const ids = db.prepare('SELECT id FROM ws_orders WHERE wholesaler_id = ? ORDER BY id DESC LIMIT 200').all(req.ws.id);
    res.json({ orders: ids.map((r) => orderFull(r.id, true)) });
  });
  const ownOrder = (req) => {
    const o = db.prepare('SELECT * FROM ws_orders WHERE id = ? AND wholesaler_id = ?').get(int(req.params.id), req.ws.id);
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  };
  app.get('/api/ws/orders/:id', wsAuth, (req, res, next) => {
    try { ownOrder(req); res.json({ order: orderFull(int(req.params.id), true) }); } catch (e) { next(e); }
  });
  app.post('/api/ws/orders', wsAuth, (req, res, next) => {
    try {
      const b = req.body || {};
      const id = db.transaction(() => {
        const lines = buildLines(b.items);
        const now = nowISO();
        const oid = db.prepare(`INSERT INTO ws_orders (wholesaler_id, created_at, created_by, customer_note, updated_at) VALUES (?,?,?,?,?)`)
          .run(req.ws.id, now, req.ws.username, str(b.note, 500), now).lastInsertRowid;
        writeLines(oid, lines, 0);
        event(oid, req.ws.business_name, 'created', 'pending', '');
        return oid;
      })();
      fire('wsOrderPlaced', orderFull(id));
      res.json({ order: orderFull(id, true) });
    } catch (e) { next(e); }
  });
  // a wholesaler can change or cancel an order until you accept it
  app.put('/api/ws/orders/:id', wsAuth, (req, res, next) => {
    try {
      const b = req.body || {};
      db.transaction(() => {
        const o = ownOrder(req);
        if (o.status !== 'pending') throw new HttpError(409, 'This order is already being handled — message us to change it');
        writeLines(o.id, buildLines(b.items), 0);
        db.prepare('UPDATE ws_orders SET customer_note = ?, updated_at = ? WHERE id = ?').run(str(b.note, 500), nowISO(), o.id);
        event(o.id, req.ws.business_name, 'edited', null, 'Order changed');
      })();
      res.json({ order: orderFull(int(req.params.id), true) });
    } catch (e) { next(e); }
  });
  app.post('/api/ws/orders/:id/cancel', wsAuth, (req, res, next) => {
    try {
      db.transaction(() => {
        const o = ownOrder(req);
        if (o.status !== 'pending') throw new HttpError(409, 'This order is already being handled — message us to cancel it');
        db.prepare("UPDATE ws_orders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowISO(), o.id);
        event(o.id, req.ws.business_name, 'status', 'cancelled', 'Cancelled by the wholesaler');
      })();
      fire('wsOrderCancelled', orderFull(int(req.params.id)));
      res.json({ order: orderFull(int(req.params.id), true) });
    } catch (e) { next(e); }
  });
  app.get('/api/ws/orders/:id/invoice.pdf', wsAuth, (req, res, next) => {
    try { ownOrder(req); sendInvoice(orderFull(int(req.params.id), true), res); } catch (e) { next(e); }
  });

  // the portal page
  app.get(['/wholesale', '/wholesale/'], (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('wholesale.html', { root: path.join(__dirname, 'public') });
  });
};
