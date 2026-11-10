/* Yalla Stock — front end (no framework, no build step). Many products, each with its own colors, sizes and prices. */
(() => {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const cur = () => S.data?.settings.currency || 'SYP';
  const money = (n) => `${fmt(n)} ${cur()}`;
  const TZ = 'Asia/Damascus';
  const dateFmt = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(',', ' ·');
  const dateOnly = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
  const invNo = (id) => 'YW-' + String(id).padStart(4, '0');
  const PRINT = {
    none: { en: 'No print', ar: 'بدون طباعة' },
    front: { en: 'Front print', ar: 'طباعة أمامية' },
    front_back: { en: 'Front + back print', ar: 'طباعة أمامية وخلفية' },
  };
  const COLOR_PRESETS = [
    ['Black', 'أسود', '#111111'], ['White', 'أبيض', '#F4F4F2'], ['Grey', 'رمادي', '#8D9096'], ['Navy', 'كحلي', '#1F2A44'],
    ['Red', 'أحمر', '#C62828'], ['Maroon', 'خمري', '#6D1A2B'], ['Blue', 'أزرق', '#1E5BC6'], ['Sky Blue', 'سماوي', '#7EC8E3'],
    ['Green', 'أخضر', '#2E7D32'], ['Olive', 'زيتي', '#6B7046'], ['Beige', 'بيج', '#D8C3A5'], ['Brown', 'بني', '#6D4C41'],
    ['Pink', 'زهري', '#F2A7C3'], ['Purple', 'بنفسجي', '#6A3FA0'], ['Yellow', 'أصفر', '#F2C230'], ['Orange', 'برتقالي', '#EF7A1A'],
    ['Turquoise', 'تركوازي', '#2EC4C4'],
  ];
  const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'ONE SIZE'];

  // One box for the client's contact: a phone number (→ WhatsApp) or an Instagram username.
  function parseContact(raw) {
    const v = String(raw || '').trim();
    if (!v) return { type: null, phone: '', instagram: '' };
    const url = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(v);
    if (url) return { type: 'instagram', phone: '', instagram: url[1] };
    if (v.startsWith('@')) return { type: 'instagram', phone: '', instagram: v.replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '') };
    if (/^[+\d][\d\s\-()]{5,}$/.test(v)) return { type: 'phone', phone: v, instagram: '' };
    if (/^[A-Za-z0-9._]+$/.test(v) && /[A-Za-z_.]/.test(v)) return { type: 'instagram', phone: '', instagram: v };
    return { type: 'unknown', phone: '', instagram: '' };
  }
  const contactOf = (sale) => (sale.customer_instagram ? '@' + sale.customer_instagram : sale.customer_phone || '');
  // saved clients: WhatsApp number first (the receipt goes there), else Instagram
  const clientContact = (c) => c.phone || (c.instagram ? '@' + c.instagram : '');
  const initials = (name) => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (/[؀-ۿ]/.test(w[0])) return [...w[0]][0];
    return w.slice(0, 2).map((x) => [...x][0]).join('').toUpperCase();
  };
  const avatar = (name, size = '') => `<span class="avatar ${size}" dir="auto">${esc(initials(name))}</span>`;
  const isPhone = (v) => /^[+\d][\d\s\-()]{5,}$/.test(String(v || '').trim());
  function waDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '963' + d.slice(1);
    else if (d.length === 9 && d.startsWith('9')) d = '963' + d;
    return d;
  }
  const isLight = (hex) => {
    const h = String(hex || '#888888').replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  };
  const shortName = (name) => {
    if (name.length <= 6) return name;
    const w = name.trim().split(/\s+/);
    return w.length > 1 ? `${w[0].slice(0, 4)} ${w[1][0]}.` : name.slice(0, 4) + '.';
  };
  const icon = {
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    csv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  };

  // ---------- state ----------
  const S = { me: null, data: null, view: 'stock', pid: null, sales: [], salesQ: '', salesStatus: 'all', pdfCache: new Map(), clients: null, clientsQ: '', clientsFilter: 'all' };

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || (opts.body ? 'POST' : 'GET'),
        headers: opts.body ? { 'Content-Type': 'application/json' } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new Error('No internet — check your connection and try again');
    }
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && path !== '/api/login') { S.me = null; renderLogin(); throw new Error(json.error || 'Please log in'); }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  // ---------- catalog helpers ----------
  const products = () => S.data.products.filter((p) => !p.archived);
  const productById = (id) => S.data.products.find((p) => p.id === id);
  const colorById = (id) => S.data.colors.find((c) => c.id === id);
  const sizeById = (id) => S.data.sizes.find((s) => s.id === id);
  const colorsOf = (pid) => S.data.colors.filter((c) => c.product_id === pid && !c.archived);
  const sizesOf = (pid) => S.data.sizes.filter((s) => s.product_id === pid && !s.archived);
  const qtyOf = (cid, sid) => (S.data.stock.find((r) => r.color_id === cid && r.size_id === sid) || { qty: 0 }).qty;
  const totalOf = (pid) => sizesOf(pid).reduce((t, s) => t + colorsOf(pid).reduce((u, c) => u + qtyOf(c.id, s.id), 0), 0);
  const multi = () => products().length > 1;
  const labelOf = (cid, sid) => {
    const c = colorById(cid), s = sizeById(sid), p = productById(c.product_id);
    return `${multi() ? p.name + ' ' : ''}${c.name} ${s.name}`;
  };
  const printPriceOf = (p, t) => (!p.printable ? 0 : t === 'front' ? p.print_front : t === 'front_back' ? p.print_front_back : 0);
  function currentPid() {
    const list = products();
    if (!list.length) return null;
    if (!list.some((p) => p.id === S.pid)) S.pid = list[0].id;
    return S.pid;
  }
  function statusOf(q) {
    const low = Number(S.data.settings.low_threshold);
    const high = Number(S.data.settings.high_threshold);
    if (q === 0) return 'out';
    if (q <= low) return 'low';
    if (high > 0 && q >= high) return 'high';
    return 'ok';
  }
  function alerts() {
    const res = { low: [], out: [], high: [] };
    for (const p of products()) for (const s of sizesOf(p.id)) for (const c of colorsOf(p.id)) {
      const q = qtyOf(c.id, s.id);
      const st = statusOf(q);
      if (st !== 'ok') res[st].push({ p, c, s, q, label: labelOf(c.id, s.id) });
    }
    res.high.sort((a, b) => b.q - a.q);
    return res;
  }

  // ---------- toasts ----------
  let toastSeq = 0;
  function toast(kind, title, text = '', ms = 4200, action = null) {
    const box = $('#toasts');
    const key = action ? `act${++toastSeq}` : `${kind}|${title}|${text}`;
    const same = [...box.children].find((t) => t.dataset.key === key && !t.classList.contains('out'));
    if (same) {
      clearTimeout(same._t); same._t = setTimeout(same._kill, ms);
      const bar = $('.bar', same); if (bar) bar.replaceWith(bar.cloneNode());
      return;
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.dataset.key = key;
    const ic = { ok: '✓', low: '!', high: '↑', err: '✕' }[kind] || 'i';
    el.innerHTML = `<div class="ic">${ic}</div><div class="tx"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>
      ${action ? `<button class="toast-act">${icon.undo}${esc(action.label)}</button>` : ''}<i class="bar" style="animation-duration:${ms}ms"></i>`;
    box.appendChild(el);
    el._kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.onclick = el._kill;
    el._t = setTimeout(el._kill, ms);
    if (action) {
      el._act = true;
      $('.toast-act', el).onclick = (e) => { e.stopPropagation(); clearTimeout(el._t); el._kill(); action.run(); };
    }
    const older = [...box.children].filter((t) => t !== el && !t.classList.contains('out'));
    if (older.length >= 3) { const v = older.find((t) => !t._act) || older[0]; clearTimeout(v._t); v._kill(); }
  }
  // a success toast with an Undo button (8 seconds to change your mind)
  function undoable(title, text, undo) {
    toast('ok', title, text, 8000, { label: 'Undo', run: async () => {
      try { await undo(); } catch (e) { toast('err', 'Could not undo', e.message); }
    } });
  }
  // stops double taps: the button shows a spinner until the request is done
  async function busy(btn, fn) {
    if (!btn || btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    try { await fn(); } finally { btn.classList.remove('is-busy'); }
  }
  function countUp(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    $$('[data-count]', root).forEach((el) => {
      const end = Number(el.dataset.count);
      if (!end) return;
      const t0 = performance.now();
      const step = (t) => {
        if (!el.isConnected) return;
        const k = Math.min(1, (t - t0) / 650);
        el.textContent = fmt(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- sheets (stackable modals) ----------
  function openSheet(html, { wide = false, onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
    ov._onClose = onClose;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeSheet(ov); });
    $('#sheet-root').appendChild(ov);
    document.body.style.overflow = 'hidden';
    $$('[data-close]', ov).forEach((b) => (b.onclick = () => closeSheet(ov)));
    return $('.sheet', ov);
  }
  function closeSheet(ov) {
    ov = ov || [...$('#sheet-root').children].reverse().find((o) => !o.classList.contains('closing'));
    if (!ov || ov.classList.contains('closing')) return;
    ov.classList.add('closing');
    ov._onClose && ov._onClose();
    setTimeout(() => {
      ov.remove();
      if (!$('#sheet-root').children.length) document.body.style.overflow = '';
    }, 170);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const sheetHead = (title) => `<div class="sheet-head"><div class="sheet-title">${title}</div><button class="icon-btn" data-close aria-label="Close">${icon.x}</button></div>`;

  function confirmSheet(title, text, okLabel = 'Confirm', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const sh = openSheet(`${sheetHead(esc(title))}<p class="muted" style="margin:0 0 18px">${esc(text)}</p>
        <div class="row"><button class="btn" data-no>Back</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`,
      { onClose: () => { if (!done) resolve(false); } });
      $('[data-no]', sh).onclick = () => closeSheet();
      $('[data-yes]', sh).onclick = () => { done = true; closeSheet(); resolve(true); };
    });
  }

  // ---------- login ----------
  function renderLogin() {
    $('#sheet-root').innerHTML = '';
    document.body.style.overflow = '';
    $('#app').innerHTML = `
      <div class="login"><form class="login-card" id="login-form" autocomplete="on">
        <div class="brand"><img src="/brand/logo-lockup.png" alt="Yalla Wear" style="width:220px;margin:0 auto 6px"><div><div class="brand-title">YALLA STOCK</div><div class="brand-sub">Yalla Wear · stock & sales</div></div></div>
        <div class="field"><label for="u">Username</label><input class="input" id="u" name="username" autocomplete="username" autocapitalize="none" required /></div>
        <div class="field"><label for="p">Password</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required /></div>
        <div class="err-text" id="login-err"></div>
        <button class="btn primary block" type="submit">Log in</button>
      </form></div>`;
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#login-err').textContent = '';
      try {
        const r = await api('/api/login', { body: { username: $('#u').value, password: $('#p').value } });
        S.me = r.username;
        await boot();
      } catch (err) { $('#login-err').textContent = err.message; }
    };
  }

  // ---------- shell ----------
  function renderShell() {
    const a = alerts();
    const alertCount = a.low.length + a.high.length;
    const logo = S.data.settings.logo;
    $('#app').innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark"><img src="${esc(logo || '/brand/mark.png')}" alt="Yalla Wear"></div>
            <div><div class="brand-title">YALLA STOCK</div><div class="brand-sub">Yalla Wear · stock & sales</div></div>
          </div>
          <div class="top-actions">
            <span class="user-pill">${esc(S.me)}</span>
            <button class="icon-btn" id="btn-settings" title="Settings" aria-label="Settings">${icon.gear}</button>
            <button class="icon-btn" id="btn-logout" title="Log out" aria-label="Log out">${icon.out}</button>
          </div>
        </header>
        ${S.defaultPasswords ? '<div class="pw-warn">⚠️ Still using the test passwords. Set <b>USERS</b> in Coolify before sharing the link.</div>' : ''}
        <main id="view"></main>
      </div>
      <nav class="tabs">
        <button class="tab ${S.view === 'stock' ? 'active' : ''}" data-view="stock">${icon.grid}<span class="lbl">Stock</span>${alertCount ? `<span class="badge">${alertCount}</span>` : ''}</button>
        <button class="tab tab-sell" id="btn-sell">${icon.plus}<span class="lbl">New sale</span></button>
        <button class="tab ${S.view === 'sales' ? 'active' : ''}" data-view="sales">${icon.receipt}<span class="lbl">Sales</span></button>
        <button class="tab ${S.view === 'clients' ? 'active' : ''}" data-view="clients">${icon.users}<span class="lbl">Clients</span></button>
      </nav>`;
    $$('[data-view]').forEach((b) => (b.onclick = () => {
      if (S.view !== b.dataset.view) { S.enter = true; window.scrollTo(0, 0); }
      S.view = b.dataset.view; renderShell();
    }));
    $('#btn-sell').onclick = () => openNewSale();
    $('#btn-settings').onclick = openSettings;
    $('#btn-logout').onclick = async () => { await api('/api/logout', { body: {} }).catch(() => {}); S.me = null; renderLogin(); };
    if (S.view === 'stock') renderStock(); else if (S.view === 'clients') renderClients(); else renderSales();
    if (S.enter) { S.enter = false; $('#view').classList.add('enter'); countUp($('#view')); }
  }

  function refreshView(flash = []) {
    renderShell();
    if (S.view === 'stock' && flash.length) renderStock(flash);
  }

  // ---------- STOCK VIEW ----------
  function renderStock(flashKeys = []) {
    const { stats } = S.data;
    const pid = currentPid();
    const a = alerts();
    const best = stats.best_seller;
    const plist = products();

    const kpis = `
      <section class="kpis">
        <div class="kpi accent"><div class="kpi-label">In stock</div><div class="kpi-value num"><span data-count="${stats.in_stock}">${fmt(stats.in_stock)}</span><small>pcs</small></div><div class="kpi-foot">${plist.length} product${plist.length === 1 ? '' : 's'}</div></div>
        <div class="kpi"><div class="kpi-label">Sold this month</div><div class="kpi-value num"><span data-count="${stats.month_pieces}">${fmt(stats.month_pieces)}</span><small>pcs</small></div><div class="kpi-foot">${best ? `Top: ${esc(multi() ? best.product + ' ' : '')}${esc(best.color)} ${esc(best.size)} (${best.n})` : `${stats.month_sales} sales`}</div></div>
        <div class="kpi"><div class="kpi-label">Revenue this month</div><div class="kpi-value num"><span data-count="${stats.month_revenue}">${fmt(stats.month_revenue)}</span><small>${esc(cur())}</small></div><div class="kpi-foot">${stats.month_sales} sale${stats.month_sales === 1 ? '' : 's'}</div></div>
        <div class="kpi ${stats.unpaid_amount ? 'warn' : ''}"><div class="kpi-label">Unpaid</div><div class="kpi-value num"><span data-count="${stats.unpaid_amount}">${fmt(stats.unpaid_amount)}</span><small>${esc(cur())}</small></div><div class="kpi-foot">${stats.unpaid_count} sale${stats.unpaid_count === 1 ? '' : 's'} not paid yet</div></div>
      </section>`;

    const tabs = `
      <div class="prod-tabs" role="tablist">
        ${plist.map((p) => `<button class="prod-tab ${p.id === pid ? 'on' : ''}" data-pid="${p.id}" role="tab"><span class="pn">${esc(p.name)}</span><span class="pc num">${totalOf(p.id)}</span></button>`).join('')}
        <button class="prod-tab add" id="btn-add-product">${icon.plus}<span class="pn">Product</span></button>
      </div>`;

    if (!pid) {
      $('#view').innerHTML = kpis + tabs + `<div class="empty"><div class="em-ic">${icon.box}</div><b>No products yet</b>Add your first product — hoodies, t-shirts, shorts…<div style="margin-top:14px"><button class="btn primary" id="btn-first-product">${icon.plus}Add product</button></div></div>`;
      $('#btn-add-product').onclick = () => openProductEditor();
      $('#btn-first-product').onclick = () => openProductEditor();
      return;
    }

    const p = productById(pid);
    const colors = colorsOf(pid), sizes = sizesOf(pid);
    const colTotals = colors.map((c) => sizes.reduce((t, s) => t + qtyOf(c.id, s.id), 0));
    const total = totalOf(pid);
    const chip = (x) => `<span class="alert-chip"><i class="sw" style="background:${esc(x.c.hex)}"></i>${esc(x.label)} · <b>${x.q === 1 ? '1 left' : x.q + ' left'}</b></span>`;
    const hiChip = (x) => `<span class="alert-chip"><i class="sw" style="background:${esc(x.c.hex)}"></i>${esc(x.label)} · <b>${x.q} in stock</b></span>`;

    const grid = colors.length && sizes.length ? `
      <div class="grid-wrap">
        <table class="stock">
          <colgroup><col class="c-size">${colors.map(() => '<col>').join('')}<col class="c-total"></colgroup>
          <thead><tr><th></th>${colors.map((c) => `<th><div class="col-head"><i class="sw" style="background:${esc(c.hex)}"></i>${esc(innerWidth < 460 ? shortName(c.name) : c.name)}</div></th>`).join('')}<th class="tcol-head">Total</th></tr></thead>
          <tbody>
            ${sizes.map((s) => `<tr><th>${esc(s.name === 'ONE SIZE' ? '1SZ' : s.name)}</th>${colors.map((c) => {
              const q = qtyOf(c.id, s.id);
              const st = statusOf(q);
              const key = `${c.id}:${s.id}`;
              const tag = st === 'low' ? 'low' : st === 'high' ? 'push' : '';
              return `<td><button class="cell num ${st} ${flashKeys.includes(key) ? 'flash' : ''}" data-c="${c.id}" data-s="${s.id}" aria-label="${esc(c.name)} ${esc(s.name)}: ${q}">${q}${tag ? `<span class="tag">${tag}</span>` : ''}</button></td>`;
            }).join('')}<td class="total-col num">${colors.reduce((t, c) => t + qtyOf(c.id, s.id), 0)}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><th></th>${colTotals.map((t) => `<td class="num">${t}</td>`).join('')}<td class="grand num">${total}</td></tr></tfoot>
        </table>
      </div>
      <div class="legend">
        <span><i style="background:var(--red-soft);border:1px solid var(--red)"></i>${S.data.settings.low_threshold} or less left</span>
        <span><i style="background:var(--amber-soft);border:1px solid var(--amber)"></i>${S.data.settings.high_threshold}+ in stock — push it</span>
        <span><i style="background:var(--bg-2);border:1px solid var(--line-2)"></i>Tap a box to sell or fix the count</span>
      </div>` : `<div class="empty"><b>${esc(p.name)} has no ${!colors.length ? 'colors' : 'sizes'} yet</b>Add them and the stock grid appears.<div style="margin-top:14px"><button class="btn primary" data-edit-product>${icon.edit}Add colors & sizes</button></div></div>`;

    $('#view').innerHTML = kpis + tabs + `
      <div class="prod-head">
        <div class="ph-main">
          <div class="ph-name">${esc(p.name)}${p.name_ar ? ` <span class="ar">${esc(p.name_ar)}</span>` : ''}</div>
          <div class="ph-meta"><span class="num">${money(p.price)}</span> · ${p.printable ? `print +${fmt(p.print_front)} / +${fmt(p.print_front_back)}` : 'no printing'} · <span class="num">${total}</span> pcs</div>
        </div>
        <button class="btn sm" data-edit-product>${icon.edit}Edit</button>
      </div>
      ${grid}
      <div class="section-head">
        <div class="section-title">Alerts</div>
        <div class="section-actions">
          <button class="btn sm" id="btn-history">${icon.clock}History</button>
          <button class="btn sm primary" id="btn-restock">${icon.box}Restock</button>
        </div>
      </div>
      <section class="alerts">
        <div class="alert-col low"><h4><span class="dot"></span>Running out</h4><div class="alert-list">
          ${a.low.length || a.out.length ? a.low.map(chip).join('') + (a.out.length ? `<span class="alert-chip out">Sold out · <b>${a.out.map((x) => esc(x.label)).join(', ')}</b></span>` : '') : '<div class="alert-empty">Nothing running out. 👌</div>'}
        </div></div>
        <div class="alert-col high"><h4><span class="dot"></span>Too many — push sales</h4><div class="alert-list">
          ${a.high.length ? a.high.map(hiChip).join('') : '<div class="alert-empty">No piles building up.</div>'}
        </div></div>
      </section>`;

    $$('.prod-tab[data-pid]').forEach((b) => (b.onclick = () => { S.pid = +b.dataset.pid; renderStock(); }));
    $('#btn-add-product').onclick = () => openProductEditor();
    $$('[data-edit-product]').forEach((b) => (b.onclick = () => openProductEditor(pid)));
    $$('.cell').forEach((b) => (b.onclick = () => openCellActions(Number(b.dataset.c), Number(b.dataset.s))));
    $('#btn-restock').onclick = () => openRestock(pid);
    $('#btn-history').onclick = openHistory;
    const on = $('.prod-tab.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function openCellActions(cid, sid) {
    const c = colorById(cid), s = sizeById(sid), p = productById(c.product_id), q = qtyOf(cid, sid);
    const sh = openSheet(`${sheetHead(`${esc(c.name)} · ${esc(s.name)}`)}
      <p class="muted" style="margin:-8px 0 12px">${esc(p.name)}</p>
      <div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <div style="width:54px;height:54px;border-radius:14px;background:${esc(c.hex)};border:1px solid var(--line-2)"></div>
        <div><div class="kpi-label">In stock</div><div class="kpi-value num" style="margin:0">${q}</div></div>
      </div>
      <button class="btn primary block" data-sell ${q ? '' : 'disabled'}>${icon.plus}Sell this one</button>
      <div style="height:14px"></div>
      <div class="label" style="margin-bottom:8px">Fix the count (after a manual check)</div>
      <div class="row"><input class="input num" type="number" min="0" inputmode="numeric" value="${q}" data-set /><button class="btn" data-save style="flex:0 0 auto">Save count</button></div>`);
    $('[data-sell]', sh).onclick = () => { closeSheet(); openNewSale({ product_id: p.id, color_id: cid, size_id: sid }); };
    $('[data-save]', sh).onclick = (ev) => busy(ev.currentTarget, async () => {
      const raw = $('[data-set]', sh).value.trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 0) { $('[data-set]', sh).focus(); return toast('err', 'Type the real count', 'A whole number, 0 or more'); }
      if (n === q) return closeSheet();
      try {
        const r = await api('/api/stock/set', { body: { color_id: cid, size_id: sid, qty: n } });
        S.data = r.state; closeSheet(); refreshView([`${cid}:${sid}`]);
        const label = labelOf(cid, sid);
        undoable('Count updated', `${label}: ${q} → ${n}`, async () => {
          const u = await api('/api/stock/undo', { body: { items: [{ color_id: cid, size_id: sid, delta: q - n }], note: 'Undo count fix' } });
          S.data = u.state; refreshView([`${cid}:${sid}`]); toast('ok', 'Undone', `${label} is back to ${qtyOf(cid, sid)}`);
        });
      } catch (e) { toast('err', e.message); }
    });
  }

  // ---------- PRODUCT EDITOR (add / edit / remove products, colors, sizes) ----------
  function openProductEditor(pid = null) {
    const p = pid ? productById(pid) : null;
    const E = p ? {
      name: p.name, name_ar: p.name_ar, price: p.price, printable: !!p.printable, print_front: p.print_front, print_front_back: p.print_front_back,
      colors: colorsOf(pid).map((c) => ({ id: c.id, name: c.name, name_ar: c.name_ar, hex: c.hex })),
      sizes: sizesOf(pid).map((s) => ({ id: s.id, name: s.name })),
    } : { name: '', name_ar: '', price: '', printable: true, print_front: 30000, print_front_back: 50000, colors: [], sizes: [] };

    const sh = openSheet(`${sheetHead(p ? 'Edit product' : 'New product')}
      <div class="row stack-sm">
        <div class="field"><label>Product name</label><input class="input" data-f="name" placeholder="e.g. T-shirt, Shorts" value="${esc(E.name)}" /></div>
        <div class="field"><label>Arabic name (receipt)</label><input class="input ar" dir="rtl" data-f="name_ar" placeholder="مثلاً تيشيرت" value="${esc(E.name_ar)}" /></div>
      </div>
      <div class="field"><label>Price per piece (${esc(cur())})</label><input class="input num" type="number" min="0" inputmode="numeric" data-f="price" placeholder="e.g. 90000" value="${esc(E.price)}" /></div>
      <label class="switch" style="margin-bottom:12px"><span>Can be printed on</span><input type="checkbox" data-f="printable" ${E.printable ? 'checked' : ''} /></label>
      <div class="row" data-print-row ${E.printable ? '' : 'hidden'}>
        <div class="field"><label>Front print +</label><input class="input num" type="number" min="0" inputmode="numeric" data-f="print_front" value="${esc(E.print_front)}" /></div>
        <div class="field"><label>Front + back +</label><input class="input num" type="number" min="0" inputmode="numeric" data-f="print_front_back" value="${esc(E.print_front_back)}" /></div>
      </div>

      <div class="ed-block">
        <div class="ed-head"><span class="label">Colors</span><span class="muted" data-ccount></span></div>
        <div class="color-rows" data-colors></div>
        <div class="label" style="margin:12px 0 8px">Tap to add</div>
        <div class="chips preset-chips" data-cpresets></div>
        <button class="btn sm" data-add-custom-color style="margin-top:10px">${icon.plus}Custom color</button>
      </div>

      <div class="ed-block">
        <div class="ed-head"><span class="label">Sizes</span><span class="muted" data-scount></span></div>
        <div class="chips" data-sizes></div>
        <div class="label" style="margin:12px 0 8px">Tap to add</div>
        <div class="chips preset-chips" data-spresets></div>
        <div class="row" style="margin-top:10px"><input class="input" data-size-custom placeholder="Other size (e.g. 38, 10Y)" autocapitalize="characters" /><button class="btn" data-add-size style="flex:0 0 auto">Add</button></div>
      </div>

      <button class="btn primary block" data-save>${p ? 'Save changes' : 'Create product'}</button>
      ${p ? `<button class="btn danger block" data-archive style="margin-top:10px">Remove ${esc(p.name)}</button>
        <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">Removing hides it from stock and new sales. Old sales and receipts stay. You can restore it from Settings.</p>` : ''}`, { wide: true });

    $$('[data-f]', sh).forEach((i) => {
      i.oninput = i.onchange = () => {
        E[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value;
        if (i.dataset.f === 'printable') $('[data-print-row]', sh).hidden = !i.checked;
      };
    });

    function paintColors(focusLast = false) {
      $('[data-colors]', sh).innerHTML = E.colors.length ? E.colors.map((c, i) => `
        <div class="color-row">
          <label class="swatch-pick" style="background:${esc(c.hex)}"><input type="color" value="${esc(c.hex)}" data-ci="${i}" data-k="hex" aria-label="Pick color"></label>
          <input class="input" value="${esc(c.name)}" data-ci="${i}" data-k="name" placeholder="Name" />
          <input class="input ar" dir="rtl" value="${esc(c.name_ar)}" data-ci="${i}" data-k="name_ar" placeholder="عربي" />
          <button class="x" data-crm="${i}" aria-label="Remove ${esc(c.name)}">×</button>
        </div>`).join('') : '<div class="muted" style="font-size:13px">No colors yet — tap one below.</div>';
      $('[data-ccount]', sh).textContent = E.colors.length ? `${E.colors.length}` : '';
      $$('[data-ci]', sh).forEach((inp) => (inp.oninput = () => {
        const c = E.colors[+inp.dataset.ci];
        c[inp.dataset.k] = inp.value;
        if (inp.dataset.k === 'hex') inp.parentElement.style.background = inp.value;
      }));
      $$('[data-crm]', sh).forEach((b) => (b.onclick = () => { E.colors.splice(+b.dataset.crm, 1); paintColors(); }));
      const have = new Set(E.colors.map((c) => c.name.trim().toLowerCase()));
      $('[data-cpresets]', sh).innerHTML = COLOR_PRESETS.filter(([n]) => !have.has(n.toLowerCase())).map(([n, ar, hex]) =>
        `<button class="chip sm" data-cp="${esc(n)}"><i class="sw" style="background:${hex}"></i>${esc(n)}</button>`).join('') || '<span class="muted" style="font-size:13px">All presets added.</span>';
      $$('[data-cp]', sh).forEach((b) => (b.onclick = () => {
        const [n, ar, hex] = COLOR_PRESETS.find(([x]) => x === b.dataset.cp);
        E.colors.push({ name: n, name_ar: ar, hex }); paintColors();
      }));
      if (focusLast) { const ins = $$('.color-row input[data-k="name"]', sh); ins[ins.length - 1]?.focus(); }
    }
    function paintSizes() {
      $('[data-sizes]', sh).innerHTML = E.sizes.length ? E.sizes.map((s, i) => `<span class="chip size-tag">${esc(s.name)}<button class="x" data-srm="${i}" aria-label="Remove size ${esc(s.name)}">×</button></span>`).join('') : '<div class="muted" style="font-size:13px">No sizes yet — tap one below.</div>';
      $('[data-scount]', sh).textContent = E.sizes.length ? `${E.sizes.length}` : '';
      $$('[data-srm]', sh).forEach((b) => (b.onclick = () => { E.sizes.splice(+b.dataset.srm, 1); paintSizes(); }));
      const have = new Set(E.sizes.map((s) => s.name.toUpperCase()));
      $('[data-spresets]', sh).innerHTML = SIZE_PRESETS.filter((n) => !have.has(n)).map((n) => `<button class="chip sm" data-sp="${n}">${n === 'ONE SIZE' ? 'One size' : n}</button>`).join('');
      $$('[data-sp]', sh).forEach((b) => (b.onclick = () => { addSize(b.dataset.sp); }));
    }
    const ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL'];
    function addSize(raw) {
      const n = String(raw || '').trim().toUpperCase();
      if (!n) return;
      if (E.sizes.some((s) => s.name.toUpperCase() === n)) return toast('err', `${n} is already added`);
      E.sizes.push({ name: n });
      E.sizes.sort((a, b) => { const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
      paintSizes();
    }
    $('[data-add-custom-color]', sh).onclick = () => { E.colors.push({ name: '', name_ar: '', hex: '#888888' }); paintColors(true); };
    $('[data-add-size]', sh).onclick = () => { addSize($('[data-size-custom]', sh).value); $('[data-size-custom]', sh).value = ''; };
    $('[data-size-custom]', sh).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-add-size]', sh).click(); } };
    paintColors(); paintSizes();

    $('[data-save]', sh).onclick = async (e) => {
      if (!String(E.name).trim()) { $('[data-f="name"]', sh).focus(); return toast('err', 'Give the product a name'); }
      if (E.price === '' || Number(E.price) < 0) { $('[data-f="price"]', sh).focus(); return toast('err', 'Set the price'); }
      if (E.colors.some((c) => !c.name.trim())) return toast('err', 'One of the colors has no name');
      // warn if removed colors/sizes still hold stock
      if (p) {
        const keptC = new Set(E.colors.filter((c) => c.id).map((c) => c.id));
        const keptS = new Set(E.sizes.filter((s) => s.id).map((s) => s.id));
        let hidden = 0;
        for (const c of colorsOf(pid)) for (const s of sizesOf(pid)) if (!keptC.has(c.id) || !keptS.has(s.id)) hidden += qtyOf(c.id, s.id);
        if (hidden > 0) {
          const ok = await confirmSheet('Hide stock?', `The colors/sizes you removed still have ${hidden} piece${hidden === 1 ? '' : 's'} in stock. They will be hidden from the grid (you can add them back later and the count returns).`, 'Yes, save', true);
          if (!ok) return;
        }
      }
      const body = { ...E, price: Number(E.price) || 0, print_front: Number(E.print_front) || 0, print_front_back: Number(E.print_front_back) || 0 };
      e.target.disabled = true;
      try {
        const r = p ? await api(`/api/products/${pid}`, { method: 'PUT', body }) : await api('/api/products', { body });
        S.data = r.state;
        if (!p) S.pid = r.product_id;
        closeSheet(); refreshView();
        toast('ok', p ? 'Product saved' : `${E.name} added`, p ? '' : 'Now add the pieces you have');
        if (!p && E.colors.length && E.sizes.length) setTimeout(() => openRestock(r.product_id, true), 350);
      } catch (err) { toast('err', 'Could not save', err.message); e.target.disabled = false; }
    };
    const arch = $('[data-archive]', sh);
    if (arch) arch.onclick = async () => {
      const pcs = totalOf(pid);
      const ok = await confirmSheet(`Remove ${p.name}?`, `${pcs ? `${pcs} pieces in stock will be hidden. ` : ''}Old sales and receipts are kept. You can restore it any time from Settings.`, 'Yes, remove', true);
      if (!ok) return;
      try {
        const r = await api(`/api/products/${pid}/archive`, { body: { archived: true } });
        S.data = r.state; S.pid = null; closeSheet(); refreshView();
        undoable(`${p.name} removed`, 'Old sales and receipts are kept', async () => {
          const u = await api(`/api/products/${pid}/archive`, { body: { archived: false } });
          S.data = u.state; S.pid = pid; refreshView(); toast('ok', `${p.name} is back`);
        });
      } catch (err) { toast('err', err.message); }
    };
  }

  // ---------- RESTOCK ----------
  function openRestock(pid, opening = false) {
    pid = pid || currentPid();
    if (!pid) return toast('err', 'Add a product first');
    const render = () => {
      const p = productById(pid), colors = colorsOf(pid), sizes = sizesOf(pid);
      return `${sheetHead(opening ? 'Opening stock' : 'Restock')}
        ${products().length > 1 && !opening ? `<div class="chips" style="margin:-4px 0 12px">${products().map((x) => `<button class="chip ${x.id === pid ? 'on' : ''}" data-rp="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
        <p class="muted" style="margin:-4px 0 12px;font-size:14px">${esc(p.name)} — type how many <b>new</b> pieces arrived. Empty = none.</p>
        ${colors.length && sizes.length ? `<div style="overflow-x:auto"><table class="restock-grid">
          <thead><tr><th></th>${colors.map((c) => `<th><i class="sw" style="background:${esc(c.hex)}"></i>${esc(shortName(c.name))}</th>`).join('')}</tr></thead>
          <tbody>${sizes.map((s) => `<tr><th>${esc(s.name === 'ONE SIZE' ? '1SZ' : s.name)}</th>${colors.map((c) => `<td><input type="number" min="0" inputmode="numeric" placeholder="·" data-c="${c.id}" data-s="${s.id}"></td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="field" style="margin-top:14px"><label>Note (optional)</label><input class="input" data-note placeholder="${opening ? 'Opening stock' : 'e.g. new batch from supplier'}" /></div>
        <button class="btn primary block" data-save>Add to stock</button>` : `<div class="empty"><b>No colors or sizes yet</b>Edit the product first.</div>`}
        ${opening ? '<button class="btn ghost block" data-close style="margin-top:10px">Skip for now</button>' : ''}`;
    };
    const sh = openSheet(render(), { wide: true });
    const wire = () => {
      $$('[data-close]', sh).forEach((b) => (b.onclick = () => closeSheet()));
      $$('[data-rp]', sh).forEach((b) => (b.onclick = () => { pid = +b.dataset.rp; sh.innerHTML = '<div class="sheet-grip"></div>' + render(); wire(); }));
      const save = $('[data-save]', sh);
      if (!save) return;
      save.onclick = () => busy(save, async () => {
        const items = $$('input[data-c]', sh).filter((i) => Math.round(Number(i.value)) > 0).map((i) => ({ color_id: +i.dataset.c, size_id: +i.dataset.s, qty: Math.round(Number(i.value)) }));
        if (!items.length) return toast('err', 'Nothing to add', 'Type a number in at least one box');
        try {
          const r = await api('/api/restock', { body: { items, note: $('[data-note]', sh).value || (opening ? 'Opening stock' : '') } });
          S.data = r.state; S.pid = pid; closeSheet();
          const total = items.reduce((t, i) => t + i.qty, 0);
          const keys = items.map((i) => `${i.color_id}:${i.size_id}`);
          const pname = productById(pid).name;
          refreshView(keys);
          undoable(`+${total} piece${total === 1 ? '' : 's'} added`, pname, async () => {
            const u = await api('/api/stock/undo', { body: { items: items.map((i) => ({ color_id: i.color_id, size_id: i.size_id, delta: -i.qty })), note: 'Undo restock' } });
            S.data = u.state; refreshView(keys); toast('ok', 'Restock undone', `${total} piece${total === 1 ? '' : 's'} taken back out · ${pname}`);
          });
        } catch (e) { toast('err', e.message); }
      });
    };
    wire();
  }

  // ---------- HISTORY ----------
  async function openHistory() {
    const sh = openSheet(`${sheetHead('Stock history')}<div data-list>${'<div class="skel sm"></div>'.repeat(6)}</div>`);
    try {
      const { movements } = await api('/api/movements');
      const why = { sale: 'Sold', cancel: 'Sale cancelled — back to stock', restock: 'Restock', adjust: 'Count fixed', opening: 'Opening stock' };
      $('[data-list]', sh).innerHTML = movements.length ? movements.map((m) => `
        <div class="mv"><i class="sw" style="background:${esc(m.hex)}"></i>
          <div class="what">${multi() ? esc(m.product) + ' ' : ''}${esc(m.color)} ${esc(m.size)} — ${esc(why[m.reason])}${m.sale_id ? ` <span class="muted">${invNo(m.sale_id)}</span>` : ''}
            <small>${dateFmt(m.created_at)} · ${esc(m.created_by)}${m.note && m.reason !== 'opening' ? ' · ' + esc(m.note) : ''}</small></div>
          <div class="d num ${m.delta > 0 ? 'plus' : 'minus'}">${m.delta > 0 ? '+' : ''}${m.delta}</div></div>`).join('') : '<p class="muted">No movements yet.</p>';
    } catch (e) { $('[data-list]', sh).innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---------- NEW SALE ----------
  function openNewSale(preset = {}) {
    if (!products().length) return toast('err', 'Add a product first', 'Stock → + Product');
    const D = { items: [] };
    const startPid = preset.product_id || (products().length === 1 ? products()[0].id : currentPid());
    const p0 = productById(startPid);
    D.pick = { product_id: startPid, color_id: preset.color_id || null, size_id: preset.size_id || null, qty: 1, print_type: 'none', unit_price: p0 ? p0.price : 0 };

    const sh = openSheet(`${sheetHead('New sale')}
      <div class="row stack-sm">
        <div class="field"><label>Client name</label><input class="input" data-name placeholder="Who is buying? Type a name or number" autocomplete="off" dir="auto" />
          <div class="hint" data-name-hint></div></div>
        <div class="field"><label>Phone or Instagram</label>
          <div class="contact-input"><span class="ci-icon" data-ci>${icon.phone}</span>
          <input class="input" data-contact placeholder="0944 123 456  or  @username" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" /></div>
          <div class="hint" data-ci-hint>The receipt will be sent here</div></div>
      </div>
      <div class="builder" data-builder></div>
      <div class="cart" data-cart></div>
      <div class="row">
        <div class="field"><label>Discount (${esc(cur())})</label><input class="input num" data-discount type="number" min="0" inputmode="numeric" placeholder="0" /></div>
        <div class="field"><label>Payment</label><label class="switch"><span data-paid-lbl>Paid</span><input type="checkbox" data-paid checked /></label></div>
      </div>
      <div class="field"><label>Note (design, delivery…)</label><input class="input" data-note placeholder="Optional" /></div>
      <div class="totals" data-totals></div>
      <button class="btn primary block" data-save>Save sale & make receipt</button>`, { wide: true });

    const used = (cid, sid) => D.items.filter((i) => i.color_id === cid && i.size_id === sid).reduce((t, i) => t + i.qty, 0);
    const avail = (cid, sid) => qtyOf(cid, sid) - used(cid, sid);
    const lineUnit = (it) => it.unit_price + printPriceOf(productById(it.product_id), it.print_type);

    function renderBuilder() {
      const pk = D.pick;
      const prod = productById(pk.product_id);
      if (pk.color_id && pk.size_id && avail(pk.color_id, pk.size_id) <= 0) pk.size_id = null;
      const maxQ = pk.color_id && pk.size_id ? avail(pk.color_id, pk.size_id) : 0;
      if (pk.qty > maxQ) pk.qty = Math.max(1, maxQ);
      if (!prod.printable) pk.print_type = 'none';
      const unitTotal = pk.unit_price + printPriceOf(prod, pk.print_type);
      $('[data-builder]', sh).innerHTML = `
        ${products().length > 1 ? `<div class="block"><span class="label">Product</span><div class="chips">
          ${products().map((x) => { const t = colorsOf(x.id).reduce((a, c) => a + sizesOf(x.id).reduce((b, s) => b + avail(c.id, s.id), 0), 0);
            return `<button class="chip ${x.id === pk.product_id ? 'on' : ''}" data-prod="${x.id}" ${t ? '' : 'disabled'}>${icon.tag}${esc(x.name)}<span class="cnt">${t}</span></button>`; }).join('')}
        </div></div>` : ''}
        <div class="block"><span class="label">Color</span><div class="chips">
          ${colorsOf(pk.product_id).map((c) => {
            const tot = sizesOf(pk.product_id).reduce((t, s) => t + avail(c.id, s.id), 0);
            return `<button class="chip ${pk.color_id === c.id ? 'on' : ''}" data-color="${c.id}" ${tot ? '' : 'disabled'}><i class="sw" style="background:${esc(c.hex)}"></i>${esc(c.name)}<span class="cnt">${tot}</span></button>`;
          }).join('') || '<span class="muted" style="font-size:13px">No colors for this product yet.</span>'}
        </div></div>
        <div class="block"><span class="label">Size</span><div class="chips">
          ${sizesOf(pk.product_id).map((s) => {
            const a = pk.color_id ? avail(pk.color_id, s.id) : null;
            return `<button class="chip size-chip ${pk.size_id === s.id ? 'on' : ''}" data-size="${s.id}" ${pk.color_id && a > 0 ? '' : 'disabled'}><span class="s">${esc(s.name === 'ONE SIZE' ? '1SZ' : s.name)}</span><span class="cnt">${a == null ? '—' : a === 0 ? 'out' : a + ' left'}</span></button>`;
          }).join('')}
        </div></div>
        ${prod.printable ? `<div class="block"><span class="label">Print</span><div class="seg">
          <button class="${pk.print_type === 'none' ? 'on' : ''}" data-print="none">No print<small>+0</small></button>
          <button class="${pk.print_type === 'front' ? 'on' : ''}" data-print="front">Front<small>+${fmt(prod.print_front)}</small></button>
          <button class="${pk.print_type === 'front_back' ? 'on' : ''}" data-print="front_back">Front + back<small>+${fmt(prod.print_front_back)}</small></button>
        </div></div>` : ''}
        <div class="row" style="align-items:flex-end">
          <div style="flex:0 0 auto"><span class="label" style="display:block;margin-bottom:8px">Qty</span>
            <div class="stepper"><button data-q="-1" aria-label="Less">−</button><span class="num">${pk.qty}</span><button data-q="1" aria-label="More">+</button></div></div>
          <div><span class="label" style="display:block;margin-bottom:8px">${esc(prod.name)} price</span><input class="input num" data-unit type="number" min="0" inputmode="numeric" value="${pk.unit_price}" /></div>
        </div>
        <button class="btn block" data-add style="margin-top:14px" ${pk.color_id && pk.size_id && maxQ > 0 ? '' : 'disabled'}>${icon.plus}Add to sale${pk.color_id && pk.size_id ? ` · <span class="num">${fmt(unitTotal * pk.qty)}</span>` : ''}</button>`;

      $$('[data-prod]', sh).forEach((b) => (b.onclick = () => {
        const np = productById(+b.dataset.prod);
        Object.assign(pk, { product_id: np.id, color_id: null, size_id: null, qty: 1, print_type: 'none', unit_price: np.price });
        renderBuilder();
      }));
      $$('[data-color]', sh).forEach((b) => (b.onclick = () => { pk.color_id = +b.dataset.color; pk.size_id = null; pk.qty = 1; renderBuilder(); }));
      $$('[data-size]', sh).forEach((b) => (b.onclick = () => { pk.size_id = +b.dataset.size; pk.qty = 1; renderBuilder(); }));
      $$('[data-print]', sh).forEach((b) => (b.onclick = () => { pk.print_type = b.dataset.print; renderBuilder(); }));
      $$('[data-q]', sh).forEach((b) => (b.onclick = () => {
        const n = pk.qty + Number(b.dataset.q);
        if (n < 1) return;
        if (n > maxQ) return toast('low', `Only ${maxQ} left`, labelOf(pk.color_id, pk.size_id), 1800);
        pk.qty = n; renderBuilder();
      }));
      $('[data-unit]', sh).oninput = (e) => {
        pk.unit_price = Math.max(0, Number(e.target.value) || 0);
        const n = $('[data-add] .num', sh);
        if (n) n.textContent = fmt((pk.unit_price + printPriceOf(prod, pk.print_type)) * pk.qty);
      };
      $('[data-add]', sh).onclick = () => {
        D.items.push({ product_id: pk.product_id, color_id: pk.color_id, size_id: pk.size_id, qty: pk.qty, print_type: pk.print_type, unit_price: pk.unit_price });
        pk.size_id = null; pk.qty = 1; pk.print_type = 'none';
        renderBuilder(); renderCart(); renderTotals();
      };
    }

    function renderCart() {
      $('[data-cart]', sh).innerHTML = D.items.map((it, i) => {
        const c = colorById(it.color_id), s = sizeById(it.size_id), pr = productById(it.product_id);
        return `<div class="cart-line"><div class="sw" style="background:${esc(c.hex)};color:${isLight(c.hex) ? '#2E2D4C' : '#fff'}">${esc(s.name === 'ONE SIZE' ? '1SZ' : s.name)}</div>
          <div class="info"><div class="t">${it.qty} × ${esc(pr.name)} · ${esc(c.name)} ${esc(s.name)}</div><div class="s">${PRINT[it.print_type].en} · ${fmt(lineUnit(it))} each</div></div>
          <div class="p">${fmt(lineUnit(it) * it.qty)}</div><button class="x" data-rm="${i}" aria-label="Remove">×</button></div>`;
      }).join('');
      $$('[data-rm]', sh).forEach((b) => (b.onclick = () => { D.items.splice(+b.dataset.rm, 1); renderBuilder(); renderCart(); renderTotals(); }));
    }

    function renderTotals() {
      const sub = D.items.reduce((t, it) => t + lineUnit(it) * it.qty, 0);
      const disc = Math.min(sub, Math.max(0, Number($('[data-discount]', sh).value) || 0));
      const pcs = D.items.reduce((t, it) => t + it.qty, 0);
      $('[data-totals]', sh).innerHTML = `
        <div class="line"><span>${pcs} piece${pcs === 1 ? '' : 's'}</span><span class="num">${fmt(sub)}</span></div>
        ${disc ? `<div class="line"><span>Discount</span><span class="num">−${fmt(disc)}</span></div>` : ''}
        <div class="grand"><span>Total</span><b class="num">${fmt(sub - disc)} <small style="font-size:14px;font-family:var(--ui)">${esc(cur())}</small></b></div>`;
      $('[data-save]', sh).disabled = !D.items.length;
    }

    const ci = $('[data-contact]', sh);
    const paintContact = () => {
      const c = parseContact(ci.value);
      const box = $('[data-ci]', sh), hint = $('[data-ci-hint]', sh);
      box.className = 'ci-icon ' + (c.type || '');
      box.innerHTML = c.type === 'instagram' ? icon.ig : c.type === 'phone' ? icon.wa : icon.phone;
      hint.textContent = c.type === 'instagram' ? `Receipt goes to Instagram @${c.instagram}` : c.type === 'phone' ? 'Receipt goes to WhatsApp' : c.type === 'unknown' ? 'Type a phone number or @username' : 'The receipt will be sent here';
      hint.className = 'hint ' + (c.type === 'unknown' ? 'bad' : c.type ? 'ok' : '');
    };
    ci.oninput = paintContact;
    // client: picked from the saved clients, or a new one (saved automatically with the sale)
    const nameIn = $('[data-name]', sh);
    const showClient = (c) => {
      const hint = $('[data-name-hint]', sh);
      hint.className = 'hint' + (c ? ' ok' : '');
      hint.textContent = c ? (c.orders ? `Saved client · ${c.orders} order${c.orders === 1 ? '' : 's'} · ${money(c.spent)} spent` : 'Saved client') : '';
    };
    const useClient = (c, overwrite) => {
      D.client = c;
      nameIn.value = c.name;
      if (overwrite || !ci.value.trim()) { ci.value = clientContact(c); paintContact(); }
      showClient(c);
    };
    const picker = attachClientPicker(nameIn, (c) => { useClient(c, true); ci.focus(); });
    if (!S.clients) loadClients().then(() => picker.refresh()).catch(() => {});
    nameIn.addEventListener('input', () => {
      const v = nameIn.value.trim().toLowerCase();
      if (D.client && D.client.name.toLowerCase() !== v) D.client = null;
      const exact = !D.client && S.clients && S.clients.find((x) => x.name.toLowerCase() === v);
      if (exact) useClient(exact, false); else showClient(D.client);
    });
    if (preset.client) useClient(preset.client, true);
    $('[data-discount]', sh).oninput = renderTotals;
    $('[data-paid]', sh).onchange = (e) => { $('[data-paid-lbl]', sh).textContent = e.target.checked ? 'Paid' : 'Not paid yet'; };
    $('[data-save]', sh).onclick = async (e) => {
      const name = $('[data-name]', sh).value.trim();
      if (!name) { $('[data-name]', sh).focus(); return toast('err', 'Client name is missing'); }
      if (!D.items.length) return toast('err', 'Add at least one item');
      const contact = parseContact(ci.value);
      if (contact.type === 'unknown') { ci.focus(); return toast('err', 'Check the contact', 'Type a phone number or an Instagram @username'); }
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const r = await api('/api/sales', { body: {
          client_id: D.client ? D.client.id : null,
          customer_name: name, customer_phone: contact.phone, customer_instagram: contact.instagram, items: D.items,
          discount: Number($('[data-discount]', sh).value) || 0, paid: $('[data-paid]', sh).checked, note: $('[data-note]', sh).value,
        } });
        S.data = r.state;
        S.sales = [];
        closeSheet();
        refreshClients();
        const keys = [...new Set(D.items.map((i) => `${i.color_id}:${i.size_id}`))];
        refreshView(keys);
        announceStock(keys);
        openSaleDone(r.sale);
      } catch (err) {
        toast('err', 'Could not save', err.message);
        e.target.disabled = false; e.target.textContent = 'Save sale & make receipt';
      }
    };

    renderBuilder(); renderCart(); renderTotals();
    if (matchMedia('(hover: hover)').matches) setTimeout(() => $('[data-name]', sh).focus(), 250);
  }

  function announceStock(keys, quiet = false) {
    keys.forEach((k, i) => {
      const [cid, sid] = k.split(':').map(Number);
      if (!colorById(cid) || !sizeById(sid)) return;
      const q = qtyOf(cid, sid), st = statusOf(q);
      const label = labelOf(cid, sid);
      setTimeout(() => {
        if (st === 'out') toast('low', `${label} is sold out`, 'Time to restock this one');
        else if (st === 'low') toast('low', `${label}: only ${q} left`, 'Running out — be careful');
        else if (st === 'high' && !quiet) toast('high', `${label}: still ${q} in stock`, 'Too many — push sales on it');
      }, 500 + i * 350);
    });
  }

  // ---------- SALE DONE / DETAIL ----------
  function openSaleDone(sale) {
    const sh = openSheet(`${sheetHead('Sale saved ✓')}
      <p class="muted" style="margin:-6px 0 10px">${invNo(sale.id)} · <span dir="auto">${esc(sale.customer_name)}</span> · <b style="color:var(--mint)">${money(sale.total)}</b></p>
      <div class="receipt-preview" data-prev><p class="muted" style="padding:40px;text-align:center">Making the receipt…</p></div>
      ${receiptButtons(sale)}
      <div class="row" style="margin-top:10px">
        <button class="btn danger" data-undo-sale>${icon.undo}Undo sale</button>
        <button class="btn ghost" data-close>Done</button>
      </div>`);
    $('[data-undo-sale]', sh).onclick = (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api(`/api/sales/${sale.id}/cancel`, { body: {} });
        S.data = r.state; S.sales = []; closeSheet();
        refreshView([...new Set(sale.items.map((i) => `${i.color_id}:${i.size_id}`))]);
        toast('ok', 'Sale undone', `${invNo(sale.id)} is cancelled — the pieces are back in stock`);
      } catch (err) { toast('err', 'Could not undo', err.message); }
    });
    wireReceiptButtons(sh, sale);
  }

  function receiptButtons(sale) {
    const send = sale.customer_instagram
      ? `<button class="btn ig block send-btn" data-ig disabled><span class="lbl">${icon.ig}Send on Instagram</span><small>@${esc(sale.customer_instagram)}</small></button>`
      : sale.customer_phone
        ? `<button class="btn wa block send-btn" data-wa disabled><span class="lbl">${icon.wa}Send on WhatsApp</span><small>${esc(sale.customer_phone)}</small></button>`
        : '';
    return `${send}<div class="actions-grid" style="margin-top:${send ? '10px' : '0'}">
      <button class="btn ${send ? '' : 'primary'}" data-share disabled>${icon.share}Share PDF</button>
      <button class="btn" data-dl disabled>${icon.down}Download</button>
    </div>`;
  }

  async function wireReceiptButtons(sh, sale) {
    $$('[data-close]', sh).forEach((b) => (b.onclick = () => closeSheet()));
    const waBtn = $('[data-wa]', sh), igBtn = $('[data-ig]', sh);
    const sendBtn = waBtn || igBtn;
    const small = sendBtn && sendBtn.querySelector('small');
    const orig = small && small.textContent;
    if (small) small.textContent = 'Preparing receipt…';
    try {
      const pdf = await getPdf(sale);
      if (sendBtn) {
        sendBtn.disabled = false;
        small.textContent = orig;
        if (!pdf.link) toast('err', 'Receipt link not ready', 'No internet — the message will go without the link');
      }
      if (waBtn) waBtn.onclick = () => window.open(waLink(sale, pdf.link), '_blank');
      if (igBtn) igBtn.onclick = () => {
        copyText(receiptMessage(sale, pdf.link));
        window.open(`https://ig.me/m/${encodeURIComponent(sale.customer_instagram)}`, '_blank');
        toast('ok', 'Message copied 📋', 'Paste it in the Instagram chat and send', 6000);
      };
      const prev = $('[data-prev]', sh);
      if (prev) prev.innerHTML = `<img src="${pdf.cover}" alt="Welcome page ${invNo(sale.id)}"><img src="${pdf.preview}" alt="Receipt ${invNo(sale.id)}">`;
      const share = $('[data-share]', sh), dl = $('[data-dl]', sh);
      share.disabled = false; dl.disabled = false;
      dl.onclick = () => downloadBlob(pdf.blob, pdf.filename);
      share.onclick = async () => {
        const file = new File([pdf.blob], pdf.filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: `Yalla Wear ${invNo(sale.id)}` }); } catch { /* user closed share sheet */ }
        } else {
          downloadBlob(pdf.blob, pdf.filename);
          toast('ok', 'PDF downloaded', 'Attach it in the chat');
        }
      };
    } catch (e) {
      console.error(e);
      const prev = $('[data-prev]', sh);
      if (prev) prev.innerHTML = `<p class="muted" style="padding:30px;text-align:center">Could not make the receipt: ${esc(e.message)}</p>`;
    }
  }

  const itemLine = (i) => `${i.qty} × ${i.product} ${i.color} ${i.size}${i.print_type !== 'none' ? ' (' + PRINT[i.print_type].en + ')' : ''}`;
  function receiptMessage(sale, link) {
    return [
      `مرحبا ${sale.customer_name} 👋`,
      'Thanks for shopping at Yalla Wear! 🖤',
      '',
      `إيصالك · Your receipt ${invNo(sale.id)}`,
      ...sale.items.map((i) => '• ' + itemLine(i)),
      `Total: ${money(sale.total)}${sale.paid ? '' : ' (not paid yet)'}`,
      ...(link ? ['', link] : []),
    ].join('\n');
  }
  function waLink(sale, link) {
    return `https://wa.me/${waDigits(sale.customer_phone)}?text=${encodeURIComponent(receiptMessage(sale, link))}`;
  }
  function copyText(text) {
    const legacy = () => {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
      try { document.execCommand('copy'); } catch { /* ignore */ }
      t.remove();
    };
    try { navigator.clipboard ? navigator.clipboard.writeText(text).catch(legacy) : legacy(); } catch { legacy(); }
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function openSaleDetail(id) {
    let { sale } = await api(`/api/sales/${id}`);
    const sh = openSheet(`${sheetHead(invNo(sale.id))}<div data-body></div>`);
    const paint = () => {
      const cancelled = !!sale.cancelled_at;
      $('[data-body]', sh).innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 12px;flex-wrap:wrap">
          ${cancelled ? '<span class="pill cancelled">Cancelled</span>' : sale.paid ? '<span class="pill paid">Paid</span>' : '<span class="pill unpaid">Not paid</span>'}
          <span class="muted" style="font-size:13px">${dateFmt(sale.created_at)} · by ${esc(sale.created_by)}</span>
        </div>
        <div class="kv"><span>Client</span>${sale.client_id ? `<button class="link-btn" data-open-client dir="auto">${esc(sale.customer_name)}${icon.chevron}</button>` : `<b dir="auto">${esc(sale.customer_name)}</b>`}</div>
        ${sale.customer_phone ? `<div class="kv"><span>WhatsApp</span><span>${esc(sale.customer_phone)}</span></div>` : ''}
        ${sale.customer_instagram ? `<div class="kv"><span>Instagram</span><span>@${esc(sale.customer_instagram)}</span></div>` : ''}
        ${sale.note ? `<div class="kv"><span>Note</span><span>${esc(sale.note)}</span></div>` : ''}
        <div class="detail-items">${sale.items.map((it) => `<div class="cart-line"><div class="sw" style="background:${esc(it.hex)};color:${isLight(it.hex) ? '#2E2D4C' : '#fff'}">${esc(it.size === 'ONE SIZE' ? '1SZ' : it.size)}</div>
          <div class="info"><div class="t">${it.qty} × ${esc(it.product)} · ${esc(it.color)} ${esc(it.size)}</div><div class="s">${PRINT[it.print_type].en} · ${fmt(it.unit_price + it.print_price)} each</div></div><div class="p">${fmt(it.line_total)}</div></div>`).join('')}</div>
        <div class="totals">
          ${sale.discount ? `<div class="line"><span>Subtotal</span><span class="num">${fmt(sale.subtotal)}</span></div><div class="line"><span>Discount</span><span class="num">−${fmt(sale.discount)}</span></div>` : ''}
          <div class="grand"><span>Total</span><b class="num" ${cancelled ? 'style="text-decoration:line-through;color:var(--muted)"' : ''}>${fmt(sale.total)} <small style="font-size:14px;font-family:var(--ui)">${esc(cur())}</small></b></div>
        </div>
        ${cancelled ? `<p class="muted" style="font-size:13px">Cancelled ${dateFmt(sale.cancelled_at)} by ${esc(sale.cancelled_by)} — the pieces went back to stock.</p>
        <button class="btn block" data-restore-sale>${icon.undo}Undo cancel — bring this sale back</button>` : `
        <div class="receipt-preview hidden" data-prev></div>
        ${receiptButtons(sale)}
        <div class="actions-grid">
          <button class="btn" data-toggle-paid>${sale.paid ? 'Mark as not paid' : 'Mark as paid ✓'}</button>
          <button class="btn danger" data-cancel>Cancel sale</button>
        </div>`}`;
      const oc = $('[data-open-client]', sh);
      if (oc) oc.onclick = () => openClient(sale.client_id);
      if (cancelled) {
        $('[data-restore-sale]', sh).onclick = (e) => busy(e.currentTarget, () => restoreSale().catch((err) => toast('err', 'Could not bring it back', err.message)));
        return;
      }
      wireReceiptButtons(sh, sale);
      $('[data-toggle-paid]', sh).onclick = (e) => busy(e.currentTarget, async () => {
        const want = !sale.paid;
        try {
          await setPaid(want);
          undoable(want ? 'Marked as paid' : 'Marked as not paid', invNo(sale.id), async () => { await setPaid(!want); toast('ok', 'Undone', `${invNo(sale.id)} is ${want ? 'not paid' : 'paid'} again`); });
        } catch (err) { toast('err', err.message); }
      });
      $('[data-cancel]', sh).onclick = async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmSheet('Cancel this sale?', `${invNo(sale.id)} for ${sale.customer_name}. The pieces go back to stock.`, 'Yes, cancel it', true);
        if (!ok) return;
        busy(btn, async () => {
          try {
            apply(await api(`/api/sales/${sale.id}/cancel`, { body: {} }));
            undoable('Sale cancelled', `${invNo(sale.id)} · stock is back`, restoreSale);
          } catch (err) { toast('err', err.message); }
        });
      };
    };
    const apply = (r) => { sale = r.sale; S.data = r.state; if (sh.isConnected) paint(); renderShell(); };
    const setPaid = async (paid) => apply(await api(`/api/sales/${sale.id}/paid`, { body: { paid } }));
    const restoreSale = async () => {
      apply(await api(`/api/sales/${sale.id}/restore`, { body: {} }));
      toast('ok', 'Sale is back', `${invNo(sale.id)} · the pieces left stock again`);
    };
    paint();
  }

  // ---------- SALES VIEW ----------
  async function reloadSales() {
    const p = new URLSearchParams({ q: S.salesQ, status: S.salesStatus });
    const r = await api('/api/sales?' + p);
    S.sales = r.sales;
    if (S.view === 'sales') paintSalesList();
  }

  function renderSales() {
    $('#view').innerHTML = `
      <div class="section-head" style="margin-top:4px">
        <div class="section-title">Sales log</div>
        <div class="section-actions"><a class="btn sm" href="/api/export/sales.csv" download>${icon.csv}Export</a></div>
      </div>
      <div class="toolbar">
        <input class="input" id="sales-q" placeholder="Search client, @instagram, product…" value="${esc(S.salesQ)}" />
        <div class="filter-seg chips">
          ${[['all', 'All'], ['unpaid', 'Not paid'], ['cancelled', 'Cancelled']].map(([k, l]) => `<button class="chip ${S.salesStatus === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="sales-list" id="sales-list">${S.sales.length ? '' : '<div class="skel"></div>'.repeat(4)}</div>`;
    if (S.sales.length) paintSalesList();
    let t;
    $('#sales-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.salesQ = e.target.value; reloadSales(); }, 250); };
    $$('[data-st]').forEach((b) => (b.onclick = () => { S.salesStatus = b.dataset.st; $$('[data-st]').forEach((x) => x.classList.toggle('on', x === b)); reloadSales(); }));
    reloadSales().catch((e) => toast('err', e.message));
  }

  function paintSalesList() {
    const el = $('#sales-list');
    if (!el) return;
    if (!S.sales.length) {
      el.innerHTML = `<div class="empty"><div class="em-ic">${icon.receipt}</div><b>${S.salesQ || S.salesStatus !== 'all' ? 'No sales match' : 'No sales yet'}</b>Tap <span style="color:var(--mint)">New sale</span> below to log the first one.</div>`;
      return;
    }
    el.innerHTML = S.sales.map(saleRow).join('');
    $$('.sale', el).forEach((b) => (b.onclick = () => openSaleDetail(+b.dataset.id).catch((e) => toast('err', e.message))));
  }

  function saleRow(s) {
    {
      const pcs = s.items.reduce((t, i) => t + i.qty, 0);
      const state = s.cancelled_at ? '<span class="pill cancelled">Cancelled</span>' : s.paid ? '<span class="pill paid">Paid</span>' : '<span class="pill unpaid">Not paid</span>';
      return `<button class="sale ${s.cancelled_at ? 'is-cancelled' : s.paid ? '' : 'is-unpaid'}" data-id="${s.id}">
        <div class="main">
          <div class="top"><span class="inv">${invNo(s.id)}</span><span class="who" dir="auto">${esc(s.customer_name)}</span>${state}</div>
          <div class="items">${s.items.map((i) => `<span class="mini ${i.print_type !== 'none' ? 'print' : ''}"><i class="sw" style="background:${esc(i.hex)}"></i>${i.qty}× ${esc(i.product)} ${esc(i.color)} ${esc(i.size)}${i.print_type === 'front' ? ' · F' : i.print_type === 'front_back' ? ' · F+B' : ''}</span>`).join('')}</div>
          <div class="when">${dateFmt(s.created_at)} · ${esc(s.created_by)}${contactOf(s) ? ` · <span style="white-space:nowrap">${esc(contactOf(s))}</span>` : ''}</div>
        </div>
        <div class="amt"><b class="num">${fmt(s.total)}</b><span class="muted" style="font-size:12px">${pcs} pc${pcs === 1 ? '' : 's'} · ${esc(cur())}</span></div>
      </button>`;
    }
  }

  // ---------- CLIENTS ----------
  async function loadClients() {
    const r = await api('/api/clients');
    S.clients = r.clients;
    return r.clients;
  }
  const contactLine = (c) => {
    const parts = [];
    if (c.phone) parts.push(`<span class="ct-wa">${icon.wa}${esc(c.phone)}</span>`);
    if (c.instagram) parts.push(`<span class="ct-ig">${icon.ig}@${esc(c.instagram)}</span>`);
    return parts.join('') || '<span class="muted">No number saved</span>';
  };

  function renderClients() {
    $('#view').innerHTML = `
      <div class="section-head" style="margin-top:4px">
        <div class="section-title">Clients <span class="count-tag" id="cl-count">${S.clients ? S.clients.length : ''}</span></div>
        <div class="section-actions">
          <a class="btn sm" href="/api/export/clients.csv" download>${icon.csv}Export</a>
          <button class="btn sm primary" id="cl-add">${icon.plus}Add client</button>
        </div>
      </div>
      <div class="toolbar">
        <input class="input" id="cl-q" placeholder="Search name, number, @instagram…" value="${esc(S.clientsQ)}" autocomplete="off" />
        <div class="filter-seg chips">
          ${[['all', 'All'], ['unpaid', 'Owes money'], ['top', 'Top buyers']].map(([k, l]) => `<button class="chip ${S.clientsFilter === k ? 'on' : ''}" data-cf="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="client-list" id="client-list">${S.clients ? '' : '<div class="skel"></div>'.repeat(4)}</div>`;
    if (S.clients) paintClients();
    $('#cl-q').oninput = (e) => { S.clientsQ = e.target.value; paintClients(); };
    $$('[data-cf]').forEach((b) => (b.onclick = () => { S.clientsFilter = b.dataset.cf; $$('[data-cf]').forEach((x) => x.classList.toggle('on', x === b)); paintClients(); }));
    $('#cl-add').onclick = () => openClientEditor(null, (c) => openClient(c.id));
    loadClients().then(() => { if (S.view === 'clients') paintClients(); }).catch((e) => toast('err', e.message));
  }

  function matchClients(list, q, withNote = true) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return list;
    const ig = q.replace(/^@/, ''), digits = q.replace(/\D/g, '');
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.instagram && c.instagram.toLowerCase().includes(ig))
      || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)) || (withNote && c.note && c.note.toLowerCase().includes(q)));
  }

  function paintClients() {
    const el = $('#client-list');
    if (!el || !S.clients) return;
    const count = $('#cl-count'); if (count) count.textContent = S.clients.length;
    let list = matchClients(S.clients, S.clientsQ);
    if (S.clientsFilter === 'unpaid') list = list.filter((c) => c.unpaid_count > 0);
    if (S.clientsFilter === 'top') list = [...list].filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent);
    if (!list.length) {
      el.innerHTML = `<div class="empty"><div class="em-ic">${icon.users}</div><b>${S.clients.length ? 'No clients match' : 'No clients yet'}</b>${S.clients.length ? 'Try another name or number.' : 'Every sale saves its client here. You can also tap <span style="color:var(--mint)">Add client</span>.'}</div>`;
      return;
    }
    el.innerHTML = list.map((c, i) => `<button class="client" data-cid="${c.id}">
      ${S.clientsFilter === 'top' && i < 3 ? `<span class="rank r${i + 1}">${i + 1}</span>` : ''}${avatar(c.name)}
      <div class="main"><div class="nm" dir="auto">${esc(c.name)}</div><div class="ct">${contactLine(c)}</div></div>
      <div class="amt">${c.orders ? `<b class="num">${fmt(c.spent)}</b><span class="muted">${c.orders} order${c.orders === 1 ? '' : 's'} · ${esc(cur())}</span>` : '<span class="pill new">No orders yet</span>'}
        ${c.unpaid_count ? `<span class="pill unpaid">Owes ${fmt(c.unpaid_amount)}</span>` : ''}</div>
    </button>`).join('');
    $$('[data-cid]', el).forEach((b) => (b.onclick = () => openClient(+b.dataset.cid)));
  }

  async function openClient(id) {
    const sh = openSheet(`${sheetHead('Client')}<div data-body>${'<div class="skel sm"></div>'.repeat(4)}</div>`);
    let data;
    try { data = await api(`/api/clients/${id}`); } catch (e) { $('[data-body]', sh).innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const paint = () => {
      const { client: c, sales } = data;
      $('[data-body]', sh).innerHTML = `
        <div class="cl-hero">${avatar(c.name, 'lg')}
          <div class="cl-id"><div class="nm" dir="auto">${esc(c.name)}</div>
            <div class="muted">Client since ${dateOnly(c.created_at)}${c.last_order_at ? ` · last order ${dateOnly(c.last_order_at)}` : ''}</div></div></div>
        <div class="cl-stats">
          <div><span>Orders</span><b class="num">${c.orders}</b></div>
          <div><span>Spent</span><b class="num">${fmt(c.spent)}<small>${esc(cur())}</small></b></div>
          <div class="${c.unpaid_count ? 'owes' : ''}"><span>Not paid</span><b class="num">${fmt(c.unpaid_amount)}<small>${esc(cur())}</small></b></div>
        </div>
        ${c.phone || c.instagram ? `<div class="actions-grid cl-contact">
          ${c.phone ? `<a class="btn wa" href="https://wa.me/${waDigits(c.phone)}" target="_blank" rel="noopener">${icon.wa}${esc(c.phone)}</a>` : ''}
          ${c.instagram ? `<a class="btn ig" href="https://ig.me/m/${encodeURIComponent(c.instagram)}" target="_blank" rel="noopener">${icon.ig}@${esc(c.instagram)}</a>` : ''}
        </div>` : '<p class="muted" style="font-size:13px;margin:0 0 12px">No WhatsApp number or Instagram saved yet — tap Edit to add one.</p>'}
        ${c.note ? `<div class="cl-note">${esc(c.note)}</div>` : ''}
        <button class="btn primary block" data-sell>${icon.plus}New sale for ${esc(c.name.split(' ')[0])}</button>
        <div class="actions-grid" style="margin-top:10px">
          <button class="btn" data-edit>${icon.edit}Edit</button>
          <button class="btn danger" data-remove>Remove</button>
        </div>
        <div class="label" style="margin:22px 0 10px">Orders${sales.length ? ` · ${sales.length}` : ''}</div>
        <div class="sales-list">${sales.length ? sales.map(saleRow).join('') : '<p class="muted" style="font-size:13px">No orders yet.</p>'}</div>`;
      $$('.sale', sh).forEach((b) => (b.onclick = () => openSaleDetail(+b.dataset.id).catch((e) => toast('err', e.message))));
      $('[data-sell]', sh).onclick = () => { closeSheet(); openNewSale({ client: c }); };
      $('[data-edit]', sh).onclick = () => openClientEditor(c, (saved) => { data.client = saved; paint(); });
      $('[data-remove]', sh).onclick = async () => {
        const ok = await confirmSheet(`Remove ${c.name}?`, 'They will be hidden from your clients. Their sales and receipts stay. If you sell to them again they come back.', 'Yes, remove', true);
        if (!ok) return;
        try {
          await api(`/api/clients/${c.id}/archive`, { body: { archived: true } });
          closeSheet(); await refreshClients();
          undoable(`${c.name} removed`, 'Their sales are kept', async () => {
            await api(`/api/clients/${c.id}/archive`, { body: { archived: false } });
            await refreshClients(); toast('ok', 'Undone', `${c.name} is back`);
          });
        } catch (err) { toast('err', 'Could not remove', err.message); }
      };
    };
    paint();
  }
  async function refreshClients() {
    await loadClients().catch(() => {});
    if (S.view === 'clients') paintClients();
  }

  function openClientEditor(c, onSaved) {
    const editing = !!c;
    const sh = openSheet(`${sheetHead(editing ? 'Edit client' : 'New client')}
      <div class="field"><label>Name</label><input class="input" data-f="name" dir="auto" placeholder="Client name" value="${esc(c ? c.name : '')}" autocomplete="off" /></div>
      <div class="field"><label>WhatsApp number</label>
        <div class="contact-input"><span class="ci-icon ${c && c.phone ? 'phone' : ''}">${icon.wa}</span>
        <input class="input" data-f="phone" type="tel" inputmode="tel" placeholder="0944 123 456" value="${esc(c ? c.phone : '')}" autocomplete="off" /></div></div>
      <div class="field"><label>Instagram</label>
        <div class="contact-input"><span class="ci-icon ${c && c.instagram ? 'instagram' : ''}">${icon.ig}</span>
        <input class="input" data-f="instagram" placeholder="@username" value="${esc(c && c.instagram ? '@' + c.instagram : '')}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" /></div></div>
      <div class="field"><label>Note (size, address, likes…)</label><input class="input" data-f="note" placeholder="Optional" value="${esc(c ? c.note : '')}" /></div>
      <button class="btn primary block" data-save>${editing ? 'Save changes' : 'Save client'}</button>`);
    const f = (k) => $(`[data-f="${k}"]`, sh);
    f('phone').oninput = (e) => { e.target.previousElementSibling.className = 'ci-icon ' + (isPhone(e.target.value) ? 'phone' : ''); };
    f('instagram').oninput = (e) => { e.target.previousElementSibling.className = 'ci-icon ' + (e.target.value.trim() ? 'instagram' : ''); };
    if (!editing && matchMedia('(hover: hover)').matches) setTimeout(() => f('name').focus(), 250);
    $('[data-save]', sh).onclick = (e) => busy(e.currentTarget, async () => {
      const body = { name: f('name').value, phone: f('phone').value.trim(), instagram: f('instagram').value, note: f('note').value };
      if (!body.name.trim()) { f('name').focus(); return toast('err', 'Client name is missing'); }
      if (body.phone && !isPhone(body.phone)) { f('phone').focus(); return toast('err', 'Check the number', 'Digits only, like 0944 123 456'); }
      try {
        const r = await api(editing ? `/api/clients/${c.id}` : '/api/clients', { method: editing ? 'PUT' : 'POST', body });
        closeSheet(); await refreshClients();
        toast('ok', editing ? 'Client saved' : 'Client added', r.client.name);
        onSaved && onSaved(r.client);
      } catch (err) { toast('err', 'Could not save', err.message); }
    });
  }

  // Branded dropdown under the client-name box: saved clients, searchable by name, number or @instagram.
  function attachClientPicker(input, onPick) {
    const pop = document.createElement('div');
    pop.className = 'combo-pop hidden';
    pop.id = 'combo-' + Math.random().toString(36).slice(2);
    pop.setAttribute('role', 'listbox');
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    input.before(wrap);
    wrap.append(input, pop);
    Object.entries({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': pop.id }).forEach(([k, v]) => input.setAttribute(k, v));
    let list = [], active = -1;
    const mark = (text, q) => {
      const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
      return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
    };
    const hide = () => { pop.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); active = -1; };
    const paint = () => {
      if (document.activeElement !== input || !S.clients) return hide();
      const q = input.value.trim();
      list = matchClients(S.clients, q, false).slice(0, 6);
      if (!list.length || (list.length === 1 && list[0].name.toLowerCase() === q.toLowerCase())) return hide();
      pop.innerHTML = `<div class="combo-head">${q ? 'Saved clients' : 'Recent clients'}<span>${S.clients.length} saved</span></div>`
        + list.map((c, i) => `<button type="button" tabindex="-1" class="combo-opt ${i === active ? 'on' : ''}" role="option" aria-selected="${i === active}" data-i="${i}">
          ${avatar(c.name, 'sm')}<span class="co-main"><b dir="auto">${mark(c.name, q)}</b><small>${clientContact(c) ? esc(clientContact(c)) : 'No number saved'}</small></span>
          <span class="co-meta">${c.orders ? `${c.orders} order${c.orders === 1 ? '' : 's'}` : 'New'}</span></button>`).join('');
      pop.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    };
    const pick = (c) => { hide(); onPick(c); };
    input.addEventListener('focus', paint);
    input.addEventListener('input', () => { active = -1; paint(); });
    input.addEventListener('blur', () => setTimeout(hide, 150));
    input.addEventListener('keydown', (e) => {
      if (pop.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        paint();
      } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(list[active]); }
      else if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    });
    pop.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard open while tapping
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(list[+b.dataset.i]); });
    return { refresh: paint };
  }

  // ---------- SETTINGS ----------
  function openSettings() {
    const st = S.data.settings;
    const all = S.data.products;
    const sh = openSheet(`${sheetHead('Settings')}
      <div class="ed-head"><span class="label">Products</span><button class="btn sm primary" data-newp>${icon.plus}New product</button></div>
      <div class="plist">
        ${all.map((p) => `<div class="pitem ${p.archived ? 'is-arch' : ''}">
          <div class="pi-main"><b>${esc(p.name)}</b>${p.name_ar ? ` <span class="ar muted">${esc(p.name_ar)}</span>` : ''}
            <small>${money(p.price)} · ${colorsOf(p.id).length} colors · ${sizesOf(p.id).length} sizes${p.archived ? ' · removed' : ` · ${totalOf(p.id)} pcs`}</small></div>
          ${p.archived ? `<button class="btn sm" data-restore="${p.id}">Restore</button>` : `<button class="btn sm" data-editp="${p.id}">${icon.edit}Edit</button>`}
        </div>`).join('') || '<p class="muted">No products yet.</p>'}
      </div>

      <div class="label" style="margin:20px 0 8px">Alerts</div>
      <div class="row">
        <div class="field"><label>Running out at (or less)</label><input class="input num" type="number" min="0" data-k="low_threshold" value="${esc(st.low_threshold)}" /></div>
        <div class="field"><label>Too many at (or more)</label><input class="input num" type="number" min="0" data-k="high_threshold" value="${esc(st.high_threshold)}" /></div>
      </div>
      <div class="label" style="margin-bottom:8px">Receipt</div>
      <div class="row stack-sm">
        <div class="field"><label>Shop phone</label><input class="input" data-k="shop_phone" value="${esc(st.shop_phone)}" placeholder="+963 …" inputmode="tel" /></div>
        <div class="field"><label>Shop Instagram</label><input class="input" data-k="shop_instagram" value="${esc(st.shop_instagram)}" placeholder="@yallawear" autocapitalize="none" /></div>
      </div>
      <div class="row">
        <div class="field" style="flex:0 0 96px"><label>Currency</label><input class="input" data-k="currency" value="${esc(st.currency)}" /></div>
        <div class="field"><label>Thank-you line</label><input class="input" data-k="receipt_note" value="${esc(st.receipt_note)}" /></div>
      </div>
      <div class="field"><label>Custom receipt logo (optional — Yalla Wear logo is used by default)</label>
        <div class="row" style="align-items:center">
          <div class="brand-mark" data-logo-prev style="flex:0 0 auto;width:56px;height:56px"><img src="${esc(st.logo || '/brand/mark.png')}" alt=""></div>
          <label class="btn" style="flex:0 0 auto">${icon.share}Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" data-logo hidden /></label>
          ${st.logo ? '<button class="btn sm danger" data-logo-rm style="flex:0 0 auto">Remove</button>' : ''}
        </div>
      </div>
      <button class="btn primary block" data-save>Save settings</button>
      <a class="btn block" href="/api/backup" download style="margin-top:10px">${icon.down}Download backup (all stock + sales)</a>`, { wide: true });

    $('[data-newp]', sh).onclick = () => { closeSheet(); openProductEditor(); };
    $$('[data-editp]', sh).forEach((b) => (b.onclick = () => { closeSheet(); S.pid = +b.dataset.editp; openProductEditor(+b.dataset.editp); }));
    $$('[data-restore]', sh).forEach((b) => (b.onclick = async () => {
      try { const r = await api(`/api/products/${b.dataset.restore}/archive`, { body: { archived: false } }); S.data = r.state; S.pid = +b.dataset.restore; closeSheet(); refreshView(); toast('ok', 'Product restored'); }
      catch (e) { toast('err', e.message); }
    }));
    let logo = st.logo;
    $('[data-logo]', sh).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { logo = await shrinkImage(f, 360); $('[data-logo-prev]', sh).innerHTML = `<img src="${logo}" alt="">`; }
      catch (err) { toast('err', err.message); }
    };
    const rm = $('[data-logo-rm]', sh);
    if (rm) rm.onclick = () => { logo = ''; $('[data-logo-prev]', sh).innerHTML = '<img src="/brand/mark.png" alt="">'; rm.remove(); };
    $('[data-save]', sh).onclick = async () => {
      const body = { logo };
      $$('[data-k]', sh).forEach((i) => (body[i.dataset.k] = i.value));
      try { const r = await api('/api/settings', { method: 'PUT', body }); S.data = r.state; S.pdfCache.clear(); closeSheet(); refreshView(); toast('ok', 'Settings saved'); }
      catch (e) { toast('err', e.message); }
    };
  }

  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- RECEIPT → PDF ----------
  // page 1 of the PDF: a welcome cover for the client
  function coverHTML(sale) {
    const st = S.data.settings;
    const c = esc(cur());
    const logo = st.logo ? `<img class="custom" src="${esc(st.logo)}" alt="">` : '<img src="/brand/logo-lockup.png" alt="Yalla Wear">';
    const pcs = sale.items.reduce((t, i) => t + i.qty, 0);
    const first = esc(String(sale.customer_name).trim().split(/\s+/)[0] || sale.customer_name);
    const contacts = [st.shop_instagram, st.shop_phone].filter(Boolean).map(esc).join(' · ');
    return `<div class="rcv">
      <div class="rcv-glow"></div>
      <img class="rcv-bg" src="/brand/mark.png" alt="">
      <div class="rcv-frame"></div>
      <div class="rcv-top">
        <span class="rcv-pill">ORDER ${invNo(sale.id)}</span>
        <span class="rcv-date">${dateOnly(sale.created_at)}</span>
      </div>
      <div class="rcv-mid">
        <div class="rcv-logo">${logo}</div>
        <div class="rcv-ar">أهلاً بك في عائلة يلا وير</div>
        <div class="rcv-en">WELCOME TO THE<br><em>YALLA WEAR</em> FAMILY</div>
        <div class="rcv-rule"></div>
        <div class="rcv-hello">Hello <b dir="auto">${first}</b>,</div>
        <div class="rcv-hello-ar">مرحبا <b dir="auto">${first}</b></div>
        <div class="rcv-ready"><i class="ck"></i><span>YOUR ORDER IS READY</span><span class="sep"></span><span class="ar">طلبك جاهز</span></div>
      </div>
      <div class="rcv-stats">
        <div class="rcv-box"><div class="k"><span>Order</span><span class="ar">الطلب</span></div><div class="v">${invNo(sale.id)}</div></div>
        <div class="rcv-box"><div class="k"><span>Pieces</span><span class="ar">القطع</span></div><div class="v">${pcs}</div></div>
        <div class="rcv-box hl"><div class="k"><span>Total</span><span class="ar">المجموع</span></div><div class="v">${fmt(sale.total)}<small>${c}</small></div></div>
      </div>
      <div class="rcv-foot">
        <div><img class="tagline" src="/brand/tagline.png" alt="Style That Moves You!">${contacts ? `<div class="ct">${contacts}</div>` : ''}</div>
        <div class="next"><div class="en">YOUR RECEIPT IS ON THE NEXT PAGE <span class="arw">›</span></div><div class="ar">إيصالك بالصفحة التالية</div></div>
      </div>
    </div>`;
  }

  function receiptHTML(sale) {
    const st = S.data.settings;
    const c = esc(cur());
    const logo = st.logo ? `<img class="custom" src="${esc(st.logo)}" alt="">` : '<img class="lockup" src="/brand/logo-lockup.png" alt="Yalla Wear">';
    const pcs = sale.items.reduce((t, i) => t + i.qty, 0);
    return `<div class="rc">
      <div class="rc-head">
        <div class="rc-logo">${logo}</div>
        <div class="rc-title"><div class="en">RECEIPT</div><div class="ar">إيصال بيع</div></div>
      </div>
      <div class="rc-meta">
        <div class="rc-box"><div class="k"><span>Invoice</span><span class="ar">رقم الفاتورة</span></div><div class="v">${invNo(sale.id)}</div></div>
        <div class="rc-box"><div class="k"><span>Date</span><span class="ar">التاريخ</span></div><div class="v">${dateOnly(sale.created_at)}</div></div>
        <div class="rc-box"><div class="k"><span>Client</span><span class="ar">الزبون</span></div><div class="v" dir="auto">${esc(sale.customer_name)}</div>${contactOf(sale) ? `<div class="v2">${esc(contactOf(sale))}</div>` : ''}</div>
      </div>
      <table class="rc-table">
        <thead><tr>
          <th>Item<span class="ar">المنتج</span></th><th class="c">Qty<span class="ar">العدد</span></th>
          <th class="r">Price<span class="ar">السعر</span></th><th class="r">Total<span class="ar">المجموع</span></th>
        </tr></thead>
        <tbody>${sale.items.map((it) => `<tr>
          <td><div class="rc-item"><i class="sw" style="background:${esc(it.hex)}"></i><div>
            <div class="t">${esc(it.product)} · ${esc(it.color)} · ${esc(it.size)}</div>
            <div class="s"><span class="ar">${esc(it.product_ar || it.product)} ${esc(it.color_ar || it.color)} · ${esc(it.size)}</span>${it.print_type !== 'none' ? ` &nbsp;·&nbsp; <span class="pr">${PRINT[it.print_type].en} / <span class="ar">${PRINT[it.print_type].ar}</span></span>` : ''}</div>
          </div></div></td>
          <td class="c">${it.qty}</td>
          <td class="r">${fmt(it.unit_price + it.print_price)}</td>
          <td class="r"><b>${fmt(it.line_total)}</b></td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="rc-sum">
        <div class="rc-stamp ${sale.paid ? '' : 'unpaid'}">${sale.paid ? 'PAID' : 'NOT PAID'}<span class="ar">${sale.paid ? 'مدفوع' : 'غير مدفوع'}</span></div>
        <div class="rc-totals">
          <div class="ln"><span>${pcs} piece${pcs === 1 ? '' : 's'} · <span class="ar">قطع</span></span><span>${fmt(sale.subtotal)} ${c}</span></div>
          ${sale.discount ? `<div class="ln"><span>Discount · <span class="ar">خصم</span></span><span>−${fmt(sale.discount)} ${c}</span></div>` : ''}
          <div class="gr"><div class="lbl">TOTAL<span class="ar">المجموع النهائي</span></div><div class="val">${fmt(sale.total)}<small>${c}</small></div></div>
        </div>
      </div>
      ${sale.note ? `<div class="rc-note">${esc(sale.note)}</div>` : ''}
      <div class="rc-foot">
        <div class="thanks">${esc(st.receipt_note)}<span class="ar">شكراً لاختيارك يلا وير 🖤</span></div>
        <div style="text-align:right"><img class="tagline" src="/brand/tagline.png" alt="Style That Moves You!">${[st.shop_phone, st.shop_instagram].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
    </div>`;
  }

  async function getPdf(sale) {
    const key = `${sale.id}:${sale.paid}:${sale.cancelled_at || ''}`;
    if (S.pdfCache.has(key)) return S.pdfCache.get(key);
    const stage = $('#receipt-stage');
    stage.innerHTML = coverHTML(sale) + receiptHTML(sale);
    await Promise.all([
      document.fonts.load('800 28px Cairo', 'يلا وير'), document.fonts.load('400 13px Cairo', 'مدفوع'),
      document.fonts.load('700 13px Cairo', 'مدفوع'), document.fonts.load('400 40px Bebas', 'TOTAL'),
      document.fonts.load('700 15px Inter', 'A'), document.fonts.load('400 15px Inter', 'A'),
      document.fonts.load('600 15px Inter', 'A'),
    ]).catch(() => {});
    await document.fonts.ready;
    await Promise.all($$('img', stage).map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    const shot = (el) => window.html2canvas(el, { scale: 2, backgroundColor: '#2E2D4C', useCORS: true, logging: false });
    const coverCanvas = await shot($('.rcv', stage));
    const canvas = await shot($('.rc', stage));
    const { jsPDF } = window.jspdf;
    const wPt = 420;
    const sizeOf = (cv) => [wPt, (cv.height / cv.width) * wPt];
    const orient = ([w, h]) => (h > w ? 'portrait' : 'landscape');
    const coverSize = sizeOf(coverCanvas), rcSize = sizeOf(canvas);
    // page 1: welcome cover · page 2: the receipt
    const doc = new jsPDF({ unit: 'pt', format: coverSize, orientation: orient(coverSize), compress: true });
    const coverImg = coverCanvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(coverImg, 'JPEG', 0, 0, ...coverSize);
    doc.addPage(rcSize, orient(rcSize));
    const img = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(img, 'JPEG', 0, 0, ...rcSize);
    doc.setProperties({ title: `Yalla Wear ${invNo(sale.id)}`, author: 'Yalla Wear' });
    const safeName = sale.customer_name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'client';
    const out = { blob: doc.output('blob'), cover: coverImg, preview: img, filename: `YallaWear-${invNo(sale.id)}-${safeName}.pdf`, link: null };
    stage.innerHTML = '';
    // the link preview in WhatsApp / Instagram shows the welcome cover
    const tw = 600, th = Math.round(coverCanvas.height * tw / coverCanvas.width);
    const tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
    const tctx = tc.getContext('2d'); tctx.fillStyle = '#2E2D4C'; tctx.fillRect(0, 0, tw, th);
    tctx.drawImage(coverCanvas, 0, 0, tw, th);
    try {
      const pdfData = doc.output('datauristring').replace(/^data:application\/pdf;[^,]*base64,/, 'data:application/pdf;base64,');
      const r = await api(`/api/sales/${sale.id}/receipt`, { body: { pdf: pdfData, image: img, thumb: tc.toDataURL('image/jpeg', 0.8) } });
      out.link = location.origin + r.receipt_path;
      S.pdfCache.set(key, out);
    } catch (e) { console.warn('receipt upload failed', e); }
    return out;
  }

  // ---------- live sync between phones ----------
  let syncing = false;
  async function sync() {
    if (!S.me || !S.data || document.hidden || syncing || document.body.classList.contains('kb') || !navigator.onLine) return;
    syncing = true;
    try {
      const fresh = await api('/api/state');
      const changed = fresh.stock.filter((r) => {
        const old = S.data.stock.find((o) => o.color_id === r.color_id && o.size_id === r.size_id);
        return !old || old.qty !== r.qty;
      }).map((r) => `${r.color_id}:${r.size_id}`);
      const metaChanged = JSON.stringify([fresh.settings, fresh.products, fresh.colors, fresh.sizes, fresh.stats]) !== JSON.stringify([S.data.settings, S.data.products, S.data.colors, S.data.sizes, S.data.stats]);
      S.data = fresh;
      if (changed.length || metaChanged) {
        const y = window.scrollY;
        refreshView(changed);
        window.scrollTo(0, y);
        if (changed.length) { toast('ok', 'Stock updated', 'Synced with the other phone', 2500); announceStock(changed, true); }
      }
    } catch { /* next tick will retry */ } finally { syncing = false; }
  }
  setInterval(sync, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

  // hide the floating tab bar while the phone keyboard is open
  const isField = (el) => el && el.matches && el.matches('input:not([type=checkbox]):not([type=file]):not([type=color]), textarea, select');
  document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb'); }, 60));

  function netBar() {
    let b = $('.offline-bar');
    if (navigator.onLine) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.className = 'offline-bar'; b.textContent = 'No internet — sales can’t be saved until you’re back online'; document.body.appendChild(b); }
  }
  window.addEventListener('online', () => { netBar(); sync(); });
  window.addEventListener('offline', netBar);
  netBar();

  // ---------- boot ----------
  async function boot() {
    try {
      const me = await api('/api/me');
      S.me = me.username;
      S.defaultPasswords = me.default_passwords;
      S.data = await api('/api/state');
      S.enter = true;
      renderShell();
      const a = alerts();
      if (a.low.length || a.out.length || a.high.length) {
        const parts = [];
        if (a.low.length) parts.push(`${a.low.length} running out`);
        if (a.out.length) parts.push(`${a.out.length} sold out`);
        if (a.high.length) parts.push(`${a.high.length} too many`);
        toast(a.low.length ? 'low' : 'high', 'Stock check', parts.join(' · '));
      }
    } catch { renderLogin(); }
  }
  window.__yalla = { S, getPdf, sync };
  boot();
})();
