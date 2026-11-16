'use strict';
// To-do lists + phone notifications.
// Lists: "order" (every sale and wholesale order: prepare and hand it over — the whole team),
// "design" (make the design and send it to printing — Zaven by default), "print" (DTF print — Zohrab by default),
// and "general" (anything you add by hand).
// Every new sale / wholesale order makes its order task by itself and pops a "new order" notification on the
// other phones. If it has a print, a design task is made too; ticking it makes the print task for the printer.
// Ticking the order task marks the sale delivered (or moves the wholesale order to Delivered).
// Notifications are Web Push: they reach iPhones (iOS 16.4+, app added to the Home Screen) and Android,
// with the phone's normal notification sound, even when the app is closed.
const webpush = require('web-push');

module.exports = function tasks(ctx) {
  const { app, db, auth, HttpError, int, str, nowISO, getSettings, users, hooks } = ctx;

  const TASKS_SQL = `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY, list TEXT NOT NULL CHECK (list IN ('order','design','print','general')),
    assignee TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]',
    source_type TEXT, source_id INTEGER, parent_id INTEGER REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
    due_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL, done_at TEXT, done_by TEXT)`;
  // the first version of this table did not allow the "order" list: rebuild it once, keeping every row
  const oldSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() || {}).sql;
  if (oldSql && !oldSql.includes("'order'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(TASKS_SQL.replace('IF NOT EXISTS tasks', 'tasks_v2'));
      db.exec(`INSERT INTO tasks_v2 (id, list, assignee, title, details, items_json, source_type, source_id, parent_id, status, due_date, created_at, created_by, updated_at, done_at, done_by)
        SELECT id, list, assignee, title, details, items_json, source_type, source_id, parent_id, status, due_date, created_at, created_by, updated_at, done_at, done_by FROM tasks`);
      db.exec('DROP TABLE tasks');
      db.exec('ALTER TABLE tasks_v2 RENAME TO tasks');
    })();
    db.pragma('foreign_keys = ON');
  }
  db.exec(`${TASKS_SQL};
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, list);
  CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type, source_id);
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, username TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  `);
  const pick = (want, i) => (users.includes(want) ? want : users[Math.min(i, users.length - 1)] || want);
  const addSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  addSetting.run('design_user', pick('zaven', 0));
  addSetting.run('print_user', pick('zohrab', 1));
  addSetting.run('design_phone', '');
  addSetting.run('print_phone', '');
  const roleUser = (list) => getSettings()[list === 'print' ? 'print_user' : 'design_user'];

  // ---------- push ----------
  let keys = { publicKey: getSettings().vapid_public, privateKey: getSettings().vapid_private };
  if (!keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    addSetting.run('vapid_public', keys.publicKey);
    addSetting.run('vapid_private', keys.privateKey);
  }
  const subject = () => process.env.VAPID_SUBJECT || getSettings().vapid_subject || 'mailto:notifications@yalla-stock.app';
  // sends to every phone of these users; phones that unsubscribed are forgotten
  async function notify(usernames, payload) {
    const list = [...new Set(usernames)].filter(Boolean);
    if (!list.length) return;
    const subs = db.prepare(`SELECT * FROM push_subs WHERE username IN (${list.map(() => '?').join(',')})`).all(...list);
    const body = JSON.stringify({ url: '/?view=todo', ...payload });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
          { vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 24, urgency: 'high' });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
        else console.warn('[yalla] push failed', e.statusCode || '', e.body || e.message);
      }
    }));
  }
  const notifySoon = (usernames, payload) => { setImmediate(() => notify(usernames, payload).catch(() => {})); };
  const others = (user) => users.filter((u) => u !== user);
  const money = (n) => `${Number(n || 0).toLocaleString('en-US')} ${getSettings().currency || 'SYP'}`;

  // ---------- what a sale / wholesale order looks like for the lists ----------
  const PRINT = { none: 'No print', front: 'Front', front_back: 'Front + back' };
  const ACTIVE_WS = ['accepted', 'production', 'ready', 'delivered'];
  const pad = (id) => String(id).padStart(4, '0');
  function sourceInfo(type, id) {
    let base, items;
    if (type === 'sale') {
      const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!s) return null;
      items = db.prepare('SELECT qty, print_type, product_name product, color_name color, size_name size, color_hex hex FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
      base = {
        kind: 'sale', no: 'YW-' + pad(id), client: s.customer_name, who: s.customer_name + (s.gift && s.gift_to ? ` → 🎁 ${s.gift_to}` : ''),
        alive: !s.cancelled_at, accepted: true, delivered: !!s.delivered_at, total: s.total, paid: !!s.paid, status: s.cancelled_at ? 'cancelled' : s.delivered_at ? 'delivered' : 'open',
        due: '', gift: !!s.gift, created_by: s.created_by,
      };
    } else {
      const o = db.prepare('SELECT o.*, w.business_name FROM ws_orders o JOIN wholesalers w ON w.id = o.wholesaler_id WHERE o.id = ?').get(id);
      if (!o) return null;
      items = db.prepare('SELECT qty, print_type, product_name product, color_name color, size_name size, color_hex hex FROM ws_order_items WHERE order_id = ? ORDER BY id').all(id);
      base = {
        kind: 'ws', no: 'WS-' + pad(id), client: o.business_name, who: o.business_name,
        alive: !['rejected', 'cancelled'].includes(o.status), accepted: ACTIVE_WS.includes(o.status), delivered: o.status === 'delivered',
        total: o.total, paid: !!o.paid, status: o.status, due: o.due_date, gift: false, created_by: o.created_by,
      };
    }
    const lines = items.map((i) => ({ qty: i.qty, product: i.product, color: i.color, size: i.size, hex: i.hex, print: i.print_type || 'none' }));
    return { ...base, lines, printLines: lines.filter((l) => l.print !== 'none'), pcs: lines.reduce((t, l) => t + l.qty, 0) };
  }
  const detailsOf = (lines) => lines.map((l) => `${l.qty}× ${l.product} ${l.color} ${l.size}${l.print !== 'none' ? ' — ' + PRINT[l.print] : ''}`).join('\n');
  const titleFor = (list, info) => `${info.no} · ${info.who}`;

  const insertTask = (f) => db.prepare(`INSERT INTO tasks (list, assignee, title, details, items_json, source_type, source_id, parent_id, due_date, created_at, created_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.list, f.assignee, f.title, f.details || '', JSON.stringify(f.items || []), f.source_type || null, f.source_id || null,
    f.parent_id || null, f.due_date || '', f.now, f.user, f.now).lastInsertRowid;
  const setStatus = (id, status, now, user = null) => db.prepare(`UPDATE tasks SET status = ?, updated_at = ?,
    done_at = CASE WHEN ? = 'done' THEN ? ELSE NULL END, done_by = CASE WHEN ? = 'done' THEN ? ELSE NULL END WHERE id = ?`)
    .run(status, now, status, now, status, user, id);

  // Keeps the tasks of a sale / order in step with it: creates, updates, ticks, reopens or cancels them.
  // Returns what to tell people, so a new order sends one notification per phone.
  function syncSource(type, id, user, opts = {}) {
    const info = sourceInfo(type, id);
    const all = db.prepare('SELECT * FROM tasks WHERE source_type = ? AND source_id = ? ORDER BY id').all(type, id);
    const now = nowISO();
    const out = { createdOrder: false, createdDesign: false, info };
    if (!info || !info.alive) {
      for (const t of all) if (t.status === 'open') setStatus(t.id, 'cancelled', now);
      return out;
    }
    // 1. the order itself: prepare + hand over (whole team)
    const ord = all.filter((t) => t.list === 'order').pop();
    const fields = { title: titleFor('order', info), details: detailsOf(info.lines), items: JSON.stringify(info.lines) };
    if (!ord) {
      const tid = insertTask({ list: 'order', assignee: '', title: fields.title, details: fields.details, items: info.lines, source_type: type, source_id: id, due_date: info.due, now, user });
      if (info.delivered) setStatus(tid, 'done', now, user);
      out.createdOrder = true;
    } else {
      db.prepare('UPDATE tasks SET title = ?, details = ?, items_json = ?, due_date = ?, updated_at = ? WHERE id = ?').run(fields.title, fields.details, fields.items, info.due || ord.due_date, now, ord.id);
      if (info.delivered && ord.status !== 'done') setStatus(ord.id, 'done', now, user);
      if (!info.delivered && ord.status !== 'open') setStatus(ord.id, 'open', now);
    }
    // 2. printing: design → DTF print (wholesale only once it is accepted)
    const pipe = all.filter((t) => t.list === 'design' || t.list === 'print');
    const wantsPrint = info.printLines.length > 0 && info.accepted;
    if (!wantsPrint) {
      for (const t of pipe) if (t.status === 'open') setStatus(t.id, 'cancelled', now);
      return out;
    }
    const pf = { details: detailsOf(info.printLines), items: JSON.stringify(info.printLines) };
    const openPipe = pipe.filter((t) => t.status === 'open');
    if (openPipe.length) {
      for (const t of openPipe) db.prepare('UPDATE tasks SET title = ?, details = ?, items_json = ?, updated_at = ? WHERE id = ?').run(titleFor(t.list, info), pf.details, pf.items, now, t.id);
    } else if (!pipe.some((t) => t.status === 'done' && t.list === 'print')) {
      const lastCancelled = pipe.filter((t) => t.status === 'cancelled').pop();
      if (lastCancelled && !pipe.some((t) => t.status === 'done' && t.list === lastCancelled.list)) setStatus(lastCancelled.id, 'open', now);
      else if (!pipe.length) {
        insertTask({ list: 'design', assignee: roleUser('design'), title: titleFor('design', info), details: pf.details, items: info.printLines, source_type: type, source_id: id, due_date: info.due, now, user });
        out.createdDesign = true;
      }
    }
    return out;
  }

  function syncAndTell(type, id, user, opts = {}) {
    let r;
    try { r = syncSource(type, id, user, opts); } catch (e) { console.warn('[yalla] task sync failed', e.message); return; }
    const info = r.info;
    if (!info) return;
    const tag = `src-${type}-${id}`;
    const designer = roleUser('design');
    if (type === 'sale' && opts.isNew) {
      // one "new order" notification per phone (the designer's also says it needs a design)
      const body = `${info.client} — ${info.pcs} pcs · ${money(info.total)}${info.paid ? '' : ' · not paid'}${info.gift ? ' · 🎁 gift' : ''}`;
      const to = others(user);
      for (const u of to) {
        notifySoon([u], { title: `🛍️ New order ${info.no}${user ? ` by ${user}` : ''}`, body: body + (r.createdDesign && u === designer ? ' · 🎨 needs a design' : ''), tag });
      }
      if (r.createdDesign && designer === user) { /* they made it themselves */ }
    } else if (r.createdDesign && designer !== user) {
      notifySoon([designer], { title: `🎨 New design to make · ${info.no}`, body: `${info.who} — ${info.printLines.reduce((t, l) => t + l.qty, 0)} pcs to print`, tag });
    }
  }
  hooks.saleChanged = (id, user, opts) => syncAndTell('sale', id, user, opts || {});
  hooks.wsOrderChanged = (id, user) => syncAndTell('ws', id, user);
  hooks.wsOrderPlaced = (order) => {
    syncAndTell('ws', order.id, null);
    notifySoon(users, { title: `🛍️ New wholesale order ${order.order_no}`, body: `${order.business_name} — ${order.items.reduce((t, i) => t + i.qty, 0)} pcs · ${money(order.total)} · tap to review`, tag: `src-ws-${order.id}`, url: '/?view=wholesale' });
  };
  hooks.wsOrderCancelled = (order) => {
    syncAndTell('ws', order.id, null);
    notifySoon(users, { title: `❌ Wholesale order cancelled · ${order.order_no}`, body: `${order.business_name} cancelled it`, tag: `src-ws-${order.id}`, url: '/?view=wholesale' });
  };

  // one-time: put the open wholesale orders on the list
  if (!getSettings().tasks_v2_seeded) {
    try {
      for (const r of db.prepare("SELECT id FROM ws_orders WHERE status IN ('pending','accepted','production','ready')").all()) syncSource('ws', r.id, 'system');
    } catch { /* wholesale tables not there yet */ }
    addSetting.run('tasks_v2_seeded', '1');
  }

  // ---------- API ----------
  const counts = () => {
    const out = {};
    for (const r of db.prepare("SELECT assignee, COUNT(*) n FROM tasks WHERE status = 'open' GROUP BY assignee").all()) out[r.assignee] = r.n;
    return out;
  };
  // each task with its order (total, paid, status) and where the order is in design → print → deliver
  function withContext(rows) {
    const cache = new Map();
    const src = (type, id) => {
      const k = `${type}:${id}`;
      if (!cache.has(k)) {
        const info = sourceInfo(type, id);
        const sib = db.prepare("SELECT list, status FROM tasks WHERE source_type = ? AND source_id = ? AND status <> 'cancelled'").all(type, id);
        const stage = (l) => { const s = sib.filter((t) => t.list === l); return !s.length ? null : s.some((t) => t.status === 'open') ? 'open' : 'done'; };
        cache.set(k, info && {
          no: info.no, client: info.client, total: info.total, paid: info.paid, status: info.status, pcs: info.pcs, gift: info.gift, due: info.due,
          stages: { design: stage('design'), print: stage('print'), order: stage('order') },
        });
      }
      return cache.get(k);
    };
    return rows.map((t) => ({ ...t, items: JSON.parse(t.items_json || '[]'), items_json: undefined, source: t.source_type ? src(t.source_type, t.source_id) : null }));
  }

  app.get('/api/tasks', auth, (req, res) => {
    const done = req.query.status === 'done';
    const rows = db.prepare(done
      ? "SELECT * FROM tasks WHERE status = 'done' ORDER BY done_at DESC LIMIT 200"
      : "SELECT * FROM tasks WHERE status = 'open' ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id DESC LIMIT 500").all();
    const st = getSettings();
    res.json({ tasks: withContext(rows), counts: counts(), users, roles: { design: st.design_user, print: st.print_user, design_phone: st.design_phone, print_phone: st.print_phone } });
  });
  const taskFields = (b) => {
    const list = ['design', 'print', 'general'].includes(b.list) ? b.list : 'general';
    const assignee = users.includes(String(b.assignee || '').toLowerCase()) ? String(b.assignee).toLowerCase() : (list === 'general' ? null : roleUser(list));
    if (!assignee) throw new HttpError(400, 'Pick who does it');
    const title = str(b.title, 140);
    if (!title) throw new HttpError(400, 'Write what has to be done');
    return { list, assignee, title, details: str(b.details, 1000), due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : '' };
  };
  const oneTask = (id) => withContext([db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)])[0];
  app.post('/api/tasks', auth, (req, res, next) => {
    try {
      const f = taskFields(req.body || {});
      const id = insertTask({ ...f, now: nowISO(), user: req.user });
      if (f.assignee !== req.user) notifySoon([f.assignee], { title: `📋 New task from ${req.user}`, body: f.title, tag: `task-${id}` });
      res.json({ task: oneTask(id), counts: counts() });
    } catch (e) { next(e); }
  });
  app.put('/api/tasks/:id', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const old = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!old) throw new HttpError(404, 'Task not found');
      if (old.list === 'order') throw new HttpError(400, 'Order tasks follow their order — edit the order instead');
      const f = taskFields({ ...old, ...req.body });
      db.prepare('UPDATE tasks SET list=?, assignee=?, title=?, details=?, due_date=?, updated_at=? WHERE id=?').run(f.list, f.assignee, f.title, f.details, f.due_date, nowISO(), id);
      if (f.assignee !== old.assignee && f.assignee !== req.user) notifySoon([f.assignee], { title: `📋 ${req.user} gave you a task`, body: f.title, tag: `task-${id}` });
      res.json({ task: oneTask(id), counts: counts() });
    } catch (e) { next(e); }
  });

  // tick / untick
  app.post('/api/tasks/:id/done', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const done = (req.body || {}).done !== false;
      const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!t) throw new HttpError(404, 'Task not found');
      const now = nowISO();
      let created = null;
      if (t.list === 'order') {
        // the order task is "handed over": it moves the sale / wholesale order itself
        if (t.source_type === 'sale') {
          db.prepare('UPDATE sales SET delivered_at = ?, delivered_by = ? WHERE id = ?').run(done ? now : null, done ? req.user : null, t.source_id);
        } else if (t.source_type === 'ws') {
          const o = db.prepare('SELECT status FROM ws_orders WHERE id = ?').get(t.source_id);
          if (done && o && o.status === 'pending') throw new HttpError(409, 'Accept this wholesale order first (Wholesale tab)');
          if (hooks.wsSetStatus && o) hooks.wsSetStatus(t.source_id, done ? 'delivered' : 'ready', req.user, done ? 'Delivered (to-do list)' : 'Undo delivered');
        }
        setStatus(id, done ? 'done' : 'open', now, req.user);
        if (t.source_type) syncSource(t.source_type, t.source_id, req.user);
        if (done) notifySoon(others(req.user), { title: '📦 Delivered', body: `${t.title} — by ${req.user}`, tag: `src-${t.source_type}-${t.source_id}` });
      } else {
        db.transaction(() => {
          if (done) {
            if (t.status === 'done') return;
            setStatus(id, 'done', now, req.user);
            if (t.list === 'design' && t.source_type) {
              const printer = roleUser('print');
              created = insertTask({ list: 'print', assignee: printer, title: t.title, details: t.details, items: JSON.parse(t.items_json || '[]'),
                source_type: t.source_type, source_id: t.source_id, parent_id: t.id, due_date: t.due_date, now, user: req.user });
              if (printer !== req.user) notifySoon([printer], { title: '🖨️ Ready for DTF printing', body: `${t.title} — design sent by ${req.user}`, tag: `src-${t.source_type}-${t.source_id}` });
            } else if (t.list === 'print') {
              notifySoon(others(req.user), { title: '✅ Printed — ready to hand over', body: `${t.title} — by ${req.user}`, tag: `src-${t.source_type}-${t.source_id}` });
            } else if (t.created_by !== req.user && users.includes(t.created_by)) {
              notifySoon([t.created_by], { title: '✅ Task done', body: `${t.title} — ${req.user}`, tag: `task-${t.id}` });
            }
          } else {
            if (t.status !== 'done') return;
            setStatus(id, 'open', now);
            // undo also takes back the print task it made, if nobody ticked it yet
            db.prepare("DELETE FROM tasks WHERE parent_id = ? AND status = 'open'").run(id);
          }
        })();
      }
      res.json({ task: oneTask(id), created, counts: counts() });
    } catch (e) { next(e); }
  });
  app.delete('/api/tasks/:id', auth, (req, res, next) => {
    try {
      const t = db.prepare('SELECT list FROM tasks WHERE id = ?').get(int(req.params.id));
      if (!t) throw new HttpError(404, 'Task not found');
      if (t.list === 'order') throw new HttpError(400, 'Order tasks go away when the order is delivered or cancelled');
      db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowISO(), int(req.params.id));
      res.json({ counts: counts() });
    } catch (e) { next(e); }
  });
  app.post('/api/tasks/:id/restore', auth, (req, res) => {
    db.prepare("UPDATE tasks SET status = 'open', updated_at = ? WHERE id = ? AND status = 'cancelled'").run(nowISO(), int(req.params.id));
    res.json({ counts: counts() });
  });

  // ---------- push subscriptions ----------
  app.get('/api/push/key', auth, (req, res) => {
    const n = db.prepare('SELECT COUNT(*) n FROM push_subs WHERE username = ?').get(req.user).n;
    res.json({ key: keys.publicKey, devices: n });
  });
  app.post('/api/push/subscribe', auth, (req, res, next) => {
    try {
      const s = (req.body || {}).subscription || {};
      if (!/^https:\/\//.test(String(s.endpoint || '')) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw new HttpError(400, 'Bad subscription');
      // Apple wants a real contact in the VAPID subject; the site address works and is set once
      const origin = `${req.protocol}://${req.get('host')}`;
      if (!getSettings().vapid_subject && origin.startsWith('https://')) addSetting.run('vapid_subject', origin);
      db.prepare(`INSERT INTO push_subs (endpoint, username, p256dh, auth, device, created_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET username = excluded.username, p256dh = excluded.p256dh, auth = excluded.auth`)
        .run(s.endpoint, req.user, s.keys.p256dh, s.keys.auth, str(req.get('user-agent'), 200), nowISO());
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.post('/api/push/unsubscribe', auth, (req, res) => {
    db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND username = ?').run(String((req.body || {}).endpoint || ''), req.user);
    res.json({ ok: true });
  });
  app.post('/api/push/test', auth, async (req, res) => {
    await notify([req.user], { title: '🔔 Yalla Stock', body: 'Notifications work on this phone!', tag: 'test' }).catch(() => {});
    res.json({ ok: true });
  });
};
