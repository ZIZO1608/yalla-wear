'use strict';
// To-do lists + phone notifications.
// Two work lists: "design" (make the design and send it to printing — Zaven by default)
// and "print" (DTF print on the pieces — Zohrab by default), plus "general" tasks you add by hand.
// Every sale line or accepted wholesale order with a print makes a design task by itself.
// Ticking a design task makes the print task for the printer and sends them a notification.
// Notifications are Web Push: they reach iPhones (iOS 16.4+, app added to the Home Screen) and Android,
// with the phone's normal notification sound, even when the app is closed.
const webpush = require('web-push');

module.exports = function tasks(ctx) {
  const { app, db, auth, HttpError, int, str, nowISO, getSettings, users, hooks } = ctx;

  db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY, list TEXT NOT NULL CHECK (list IN ('design','print','general')),
    assignee TEXT NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]',
    source_type TEXT, source_id INTEGER, parent_id INTEGER REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
    due_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL, done_at TEXT, done_by TEXT);
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
    const body = JSON.stringify({ url: '/', tag: undefined, ...payload });
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
  ctx.notify = notifySoon;

  // ---------- tasks from sales / wholesale orders ----------
  const PRINT = { front: 'Front', front_back: 'Front + back' };
  const linesOf = (items) => items.filter((i) => i.print_type && i.print_type !== 'none')
    .map((i) => ({ qty: i.qty, product: i.product, color: i.color, size: i.size, hex: i.hex, print: i.print_type }));
  const detailsOf = (lines) => lines.map((l) => `${l.qty}× ${l.product} ${l.color} ${l.size} — ${PRINT[l.print]}`).join('\n');
  const pcsOf = (lines) => lines.reduce((t, l) => t + l.qty, 0);

  function sourceInfo(type, id) {
    if (type === 'sale') {
      const s = db.prepare('SELECT id, customer_name, cancelled_at, gift, gift_to FROM sales WHERE id = ?').get(id);
      if (!s) return null;
      const items = db.prepare(`SELECT qty, print_type, product_name product, color_name color, size_name size, color_hex hex FROM sale_items WHERE sale_id = ?`).all(id);
      return { no: 'YW-' + String(id).padStart(4, '0'), who: s.customer_name + (s.gift && s.gift_to ? ` (gift for ${s.gift_to})` : ''), active: !s.cancelled_at, lines: linesOf(items) };
    }
    const o = db.prepare('SELECT o.id, o.status, o.due_date, w.business_name FROM ws_orders o JOIN wholesalers w ON w.id = o.wholesaler_id WHERE o.id = ?').get(id);
    if (!o) return null;
    const items = db.prepare(`SELECT qty, print_type, product_name product, color_name color, size_name size, color_hex hex FROM ws_order_items WHERE order_id = ?`).all(id);
    return { no: 'WS-' + String(id).padStart(4, '0'), who: `${o.business_name} (wholesale)`, active: ['accepted', 'production', 'ready'].includes(o.status), lines: linesOf(items), due: o.due_date };
  }
  const titleFor = (list, info) => `${list === 'design' ? 'Design' : 'DTF print'} · ${info.no} · ${info.who}`;

  // keeps the tasks of a sale / order in step with it: creates, updates or cancels them
  function syncSource(type, id, user) {
    const info = sourceInfo(type, id);
    const open = db.prepare("SELECT * FROM tasks WHERE source_type = ? AND source_id = ? AND status = 'open'").all(type, id);
    const any = db.prepare('SELECT COUNT(*) n FROM tasks WHERE source_type = ? AND source_id = ?').get(type, id).n;
    const now = nowISO();
    if (!info || !info.active || !info.lines.length) {
      for (const t of open) db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, t.id);
      return;
    }
    if (open.length) {
      for (const t of open) {
        db.prepare('UPDATE tasks SET title = ?, details = ?, items_json = ?, updated_at = ? WHERE id = ?')
          .run(titleFor(t.list, info), detailsOf(info.lines), JSON.stringify(info.lines), now, t.id);
      }
      return;
    }
    // a cancelled sale that comes back reopens its last task
    const last = db.prepare("SELECT * FROM tasks WHERE source_type = ? AND source_id = ? AND status = 'cancelled' ORDER BY id DESC LIMIT 1").get(type, id);
    if (last) {
      db.prepare("UPDATE tasks SET status = 'open', title = ?, details = ?, items_json = ?, updated_at = ? WHERE id = ?")
        .run(titleFor(last.list, info), detailsOf(info.lines), JSON.stringify(info.lines), now, last.id);
      return;
    }
    if (any) return; // everything already done
    const assignee = roleUser('design');
    db.prepare(`INSERT INTO tasks (list, assignee, title, details, items_json, source_type, source_id, due_date, created_at, created_by, updated_at)
      VALUES ('design',?,?,?,?,?,?,?,?,?,?)`).run(assignee, titleFor('design', info), detailsOf(info.lines), JSON.stringify(info.lines), type, id, info.due || '', now, user, now);
    if (assignee !== user) notifySoon([assignee], { title: '🎨 New design to make', body: `${info.no} · ${info.who} — ${pcsOf(info.lines)} pcs to print`, tag: `task-${type}-${id}`, url: '/?view=todo' });
  }
  const safeSync = (type, id, user) => { try { syncSource(type, id, user); } catch (e) { console.warn('[yalla] task sync failed', e.message); } };
  hooks.saleChanged = (id, user) => safeSync('sale', id, user);
  hooks.wsOrderChanged = (id, user) => safeSync('ws', id, user);
  hooks.wsOrderPlaced = (order) => notifySoon(users, { title: '🛍️ New wholesale order', body: `${order.order_no} · ${order.business_name} — ${order.items.reduce((t, i) => t + i.qty, 0)} pcs · ${Number(order.total).toLocaleString('en-US')}`, tag: `ws-${order.id}`, url: '/?view=wholesale' });
  hooks.wsOrderCancelled = (order) => notifySoon(users, { title: '❌ Wholesale order cancelled', body: `${order.order_no} · ${order.business_name} cancelled it`, tag: `ws-${order.id}`, url: '/?view=wholesale' });

  // ---------- API ----------
  const taskOut = (t) => ({ ...t, items: JSON.parse(t.items_json || '[]'), items_json: undefined });
  const counts = () => {
    const out = {};
    for (const r of db.prepare("SELECT assignee, COUNT(*) n FROM tasks WHERE status = 'open' GROUP BY assignee").all()) out[r.assignee] = r.n;
    return out;
  };
  ctx.taskCounts = counts;

  app.get('/api/tasks', auth, (req, res) => {
    const status = req.query.status === 'done' ? "status = 'done'" : "status = 'open'";
    const order = req.query.status === 'done' ? 'done_at DESC' : "CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id";
    const rows = db.prepare(`SELECT * FROM tasks WHERE ${status} ORDER BY ${order} LIMIT 300`).all();
    const st = getSettings();
    res.json({ tasks: rows.map(taskOut), counts: counts(), users, roles: { design: st.design_user, print: st.print_user, design_phone: st.design_phone, print_phone: st.print_phone } });
  });
  const taskFields = (b) => {
    const list = ['design', 'print', 'general'].includes(b.list) ? b.list : 'general';
    const assignee = users.includes(String(b.assignee || '').toLowerCase()) ? String(b.assignee).toLowerCase() : (list === 'general' ? null : roleUser(list));
    if (!assignee) throw new HttpError(400, 'Pick who does it');
    const title = str(b.title, 140);
    if (!title) throw new HttpError(400, 'Write what has to be done');
    return { list, assignee, title, details: str(b.details, 1000), due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : '' };
  };
  app.post('/api/tasks', auth, (req, res, next) => {
    try {
      const f = taskFields(req.body || {});
      const now = nowISO();
      const id = db.prepare(`INSERT INTO tasks (list, assignee, title, details, due_date, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(f.list, f.assignee, f.title, f.details, f.due_date, now, req.user, now).lastInsertRowid;
      if (f.assignee !== req.user) notifySoon([f.assignee], { title: `📋 New task from ${req.user}`, body: f.title, tag: `task-${id}`, url: '/?view=todo' });
      res.json({ task: taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)), counts: counts() });
    } catch (e) { next(e); }
  });
  app.put('/api/tasks/:id', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const old = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!old) throw new HttpError(404, 'Task not found');
      const f = taskFields({ ...old, ...req.body });
      db.prepare('UPDATE tasks SET list=?, assignee=?, title=?, details=?, due_date=?, updated_at=? WHERE id=?').run(f.list, f.assignee, f.title, f.details, f.due_date, nowISO(), id);
      if (f.assignee !== old.assignee && f.assignee !== req.user) notifySoon([f.assignee], { title: `📋 ${req.user} gave you a task`, body: f.title, tag: `task-${id}`, url: '/?view=todo' });
      res.json({ task: taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)), counts: counts() });
    } catch (e) { next(e); }
  });
  // tick / untick. A ticked design task creates the DTF print task and tells the printer.
  app.post('/api/tasks/:id/done', auth, (req, res, next) => {
    try {
      const id = int(req.params.id);
      const done = (req.body || {}).done !== false;
      let created = null;
      db.transaction(() => {
        const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        if (!t) throw new HttpError(404, 'Task not found');
        const now = nowISO();
        if (done) {
          if (t.status === 'done') return;
          db.prepare("UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, updated_at = ? WHERE id = ?").run(now, req.user, now, id);
          if (t.list === 'design' && t.source_type) {
            const printer = roleUser('print');
            const info = sourceInfo(t.source_type, t.source_id) || { no: '', who: '' };
            created = db.prepare(`INSERT INTO tasks (list, assignee, title, details, items_json, source_type, source_id, parent_id, due_date, created_at, created_by, updated_at)
              VALUES ('print',?,?,?,?,?,?,?,?,?,?,?)`).run(printer, titleFor('print', info.no ? info : { no: t.title, who: '' }), t.details, t.items_json,
              t.source_type, t.source_id, t.id, t.due_date, now, req.user, now).lastInsertRowid;
            if (printer !== req.user) notifySoon([printer], { title: '🖨️ Ready for DTF printing', body: `${info.no} · ${info.who} — design sent by ${req.user}`, tag: `task-${t.source_type}-${t.source_id}`, url: '/?view=todo' });
          } else if (t.list === 'print') {
            notifySoon(users.filter((u) => u !== req.user), { title: '✅ Printed', body: `${t.title.replace(/^DTF print · /, '')} — done by ${req.user}`, tag: `task-${t.source_type}-${t.source_id}`, url: '/?view=todo' });
          } else if (t.created_by !== req.user && users.includes(t.created_by)) {
            notifySoon([t.created_by], { title: '✅ Task done', body: `${t.title} — ${req.user}`, tag: `task-${t.id}`, url: '/?view=todo' });
          }
        } else {
          if (t.status !== 'done') return;
          db.prepare("UPDATE tasks SET status = 'open', done_at = NULL, done_by = NULL, updated_at = ? WHERE id = ?").run(now, id);
          // undo also takes back the print task it made, if nobody ticked it yet
          db.prepare("DELETE FROM tasks WHERE parent_id = ? AND status = 'open'").run(id);
        }
      })();
      res.json({ task: taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)), created, counts: counts() });
    } catch (e) { next(e); }
  });
  app.delete('/api/tasks/:id', auth, (req, res, next) => {
    try {
      const r = db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowISO(), int(req.params.id));
      if (!r.changes) throw new HttpError(404, 'Task not found');
      res.json({ counts: counts() });
    } catch (e) { next(e); }
  });
  app.post('/api/tasks/:id/restore', auth, (req, res, next) => {
    try {
      db.prepare("UPDATE tasks SET status = 'open', updated_at = ? WHERE id = ? AND status = 'cancelled'").run(nowISO(), int(req.params.id));
      res.json({ counts: counts() });
    } catch (e) { next(e); }
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
    await notify([req.user], { title: '🔔 Yalla Stock', body: 'Notifications work on this phone!', tag: 'test', url: '/?view=todo' }).catch(() => {});
    res.json({ ok: true });
  });
};
