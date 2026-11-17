/* Yalla Wear wholesale portal — shops log in with the username/password you gave them,
   order by color × size, and follow their orders (status, invoice, history). No build step. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const TZ = 'Asia/Damascus';
  const dateFmt = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(',', ' ·');
  const dateOnly = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
  const P = { me: null, shop: null, cat: null, orders: null, view: 'shop', mode: 'stock', cart: {}, print: {}, own: [], files: [], note: '', editing: null,
    draft: { garment: 'Hoodie', color: 'Black', hex: '#1D1D1F', size: 'M', qty: '', print_type: 'front' } };
  // their own pieces: what they can pick when they bring their hoodies for us to print
  const GARMENTS = [['Hoodie', 'هودي'], ['Zip hoodie', 'هودي سحاب'], ['Sweatshirt', 'كنزة'], ['T-shirt', 'تيشيرت']];
  const OWN_COLORS = [['Black', '#1D1D1F'], ['White', '#F5F5F2'], ['Grey', '#9A9AA0'], ['Navy', '#1F2A4D'], ['Beige', '#D8C7A8'], ['Brown', '#6B4A35'], ['Green', '#3E5B3A'], ['Red', '#A3262A']];
  const OWN_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Mixed'];
  const ownFee = (t) => (t === 'front_back' ? P.shop.own_front_back : P.shop.own_front) || 0;
  const cur = () => (P.shop ? P.shop.currency : 'SYP');
  const money = (n) => `${fmt(n)} ${cur()}`;
  const PRINT = { none: ['No print', 'بدون طباعة'], front: ['Front print', 'طباعة أمامية'], front_back: ['Front + back', 'أمامية وخلفية'] };
  const STATUS = {
    pending: ['Sent — waiting for us', 'تم الإرسال · بالانتظار', 'unpaid'],
    accepted: ['Accepted', 'تم القبول', 'paid'],
    production: ['In production', 'قيد التصنيع', 'paid'],
    ready: ['Ready', 'جاهز', 'paid'],
    delivered: ['Delivered', 'تم التسليم', 'done'],
    rejected: ['Rejected', 'مرفوض', 'cancelled'],
    cancelled: ['Cancelled', 'ملغي', 'cancelled'],
  };
  const FLOW = ['pending', 'accepted', 'production', 'ready', 'delivered'];
  const ACTIVE = ['accepted', 'production', 'ready', 'delivered'];
  const icon = {
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  };
  const isLight = (hex) => {
    const h = String(hex || '#888888').replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  };
  const waDigits = (phone) => {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '963' + d.slice(1); else if (d.length === 9 && d.startsWith('9')) d = '963' + d;
    return d;
  };

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch { throw new Error('No internet — check your connection · لا يوجد إنترنت'); }
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && path !== '/api/ws/login') { P.me = null; renderLogin(); throw new Error(json.error || 'Please log in'); }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  // ---------- toasts + sheets ----------
  function toast(kind, title, text = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<div class="ic">${{ ok: '✓', err: '✕', low: '!' }[kind] || 'i'}</div><div class="tx"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div><i class="bar" style="animation-duration:${ms}ms"></i>`;
    $('#toasts').appendChild(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.onclick = kill; setTimeout(kill, ms);
  }
  function openSheet(html, { wide = false } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
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
    setTimeout(() => { ov.remove(); if (!$('#sheet-root').children.length) document.body.style.overflow = ''; }, 170);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const sheetHead = (title) => `<div class="sheet-head"><div class="sheet-title">${title}</div><button class="icon-btn" data-close aria-label="Close">${icon.x}</button></div>`;
  async function busy(btn, fn) {
    if (!btn || btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    try { await fn(); } finally { btn.classList.remove('is-busy'); }
  }
  const bi = (en, ar) => `${esc(en)} <span class="ar bi">${esc(ar)}</span>`;

  // ---------- cart (kept on this phone so a half-made order is not lost) ----------
  const cartKey = () => `yw-ws-cart-${P.me ? P.me.id : 0}`;
  const saveCart = () => { try { localStorage.setItem(cartKey(), JSON.stringify({ cart: P.cart, print: P.print, own: P.own, note: P.note, editing: P.editing })); } catch { /* private mode */ } };
  const loadCart = () => {
    try { const v = JSON.parse(localStorage.getItem(cartKey()) || 'null'); if (v) Object.assign(P, { cart: v.cart || {}, print: v.print || {}, own: Array.isArray(v.own) ? v.own : [], note: v.note || '', editing: v.editing || null }); } catch { /* ignore */ }
  };
  const clearCart = () => { P.cart = {}; P.print = {}; P.own = []; P.files = []; P.note = ''; P.editing = null; saveCart(); };

  const prod = (id) => P.cat.products.find((p) => p.id === id);
  const colorsOf = (pid) => P.cat.colors.filter((c) => c.product_id === pid);
  const sizesOf = (pid) => P.cat.sizes.filter((s) => s.product_id === pid);
  const stockOf = (cid, sid) => (P.cat.stock.find((r) => r.color_id === cid && r.size_id === sid) || { qty: 0 }).qty;
  const printPrice = (p, t) => (!p.printable ? 0 : t === 'front' ? p.print_front : t === 'front_back' ? p.print_front_back : 0);
  function cartLines() {
    const lines = [];
    for (const [key, qty] of Object.entries(P.cart)) {
      if (!(qty > 0)) continue;
      const [cid, sid] = key.split(':').map(Number);
      const c = P.cat.colors.find((x) => x.id === cid), s = P.cat.sizes.find((x) => x.id === sid);
      if (!c || !s) continue;
      const p = prod(c.product_id);
      if (!p) continue;
      const pt = p.printable ? P.print[p.id] || 'none' : 'none';
      lines.push({ p, c, s, qty, print_type: pt, unit: p.wholesale_price + printPrice(p, pt) });
    }
    return lines;
  }
  const ownLines = () => P.own.filter((l) => l.qty > 0).map((l) => ({ ...l, unit: ownFee(l.print_type) }));
  const cartTotals = () => {
    const lines = cartLines(), own = ownLines();
    const all = [...lines, ...own];
    return { lines, own, pcs: all.reduce((t, l) => t + l.qty, 0), ownPcs: own.reduce((t, l) => t + l.qty, 0), total: all.reduce((t, l) => t + l.unit * l.qty, 0) };
  };
  const underMin = (lines) => {
    const per = {};
    for (const l of lines) per[l.p.id] = (per[l.p.id] || 0) + l.qty;
    return P.cat.products.filter((p) => per[p.id] && p.wholesale_min > 1 && per[p.id] < p.wholesale_min).map((p) => ({ p, n: per[p.id] }));
  };

  // ---------- login ----------
  function renderLogin() {
    $('#sheet-root').innerHTML = '';
    document.body.style.overflow = '';
    $('#app').innerHTML = `
      <div class="login"><form class="login-card" id="login-form" autocomplete="on">
        <div class="brand"><img src="/brand/logo-lockup.png" alt="Yalla Wear" style="width:220px;margin:0 auto 6px">
          <div><div class="brand-title">WHOLESALE</div><div class="brand-sub">Yalla Wear · <span class="ar">طلبات الجملة</span></div></div></div>
        <div class="field"><label for="u">${bi('Username', 'اسم المستخدم')}</label><input class="input" id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required /></div>
        <div class="field"><label for="p">${bi('Password', 'كلمة السر')}</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required /></div>
        <div class="err-text" id="login-err"></div>
        <button class="btn primary block" type="submit">Log in · <span class="ar">دخول</span></button>
        <p class="muted portal-help">No account yet? Ask Yalla Wear for one. · <span class="ar">ما عندك حساب؟ تواصل معنا</span></p>
      </form></div>`;
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#login-err').textContent = '';
      try {
        await api('/api/ws/login', { body: { username: $('#u').value, password: $('#p').value } });
        await boot();
      } catch (err) { $('#login-err').textContent = err.message; }
    };
  }

  // ---------- shell ----------
  function renderShell() {
    const logo = P.shop.logo;
    const t = cartTotals();
    const open = (P.orders || []).filter((o) => ['pending', 'accepted', 'production', 'ready'].includes(o.status)).length;
    $('#app').innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark"><img src="${esc(logo || '/brand/mark.png')}" alt="Yalla Wear"></div>
            <div><div class="brand-title">WHOLESALE</div><div class="brand-sub" dir="auto">${esc(P.me.business_name)}</div></div>
          </div>
          <div class="top-actions"><button class="icon-btn" id="btn-logout" title="Log out" aria-label="Log out">${icon.out}</button></div>
        </header>
        <main id="view"></main>
      </div>
      ${P.view === 'shop' && t.pcs ? `<div class="cart-bar"><div><b class="num">${t.pcs} pcs · ${fmt(t.total)} <small>${esc(cur())}</small></b><small>${P.editing ? `Editing ${esc(P.editing.no)}` : 'Your order · <span class="ar">طلبك</span>'}</small></div>
        <button class="btn primary" id="btn-review">${P.editing ? 'Review changes' : 'Review order'} ›</button></div>` : ''}
      <nav class="tabs">
        <button class="tab ${P.view === 'shop' ? 'active' : ''}" data-view="shop">${icon.shop}<span class="lbl">Order</span></button>
        <button class="tab ${P.view === 'orders' ? 'active' : ''}" data-view="orders">${icon.list}<span class="lbl">My orders</span>${open ? `<span class="badge mint">${open}</span>` : ''}</button>
        <button class="tab ${P.view === 'account' ? 'active' : ''}" data-view="account">${icon.user}<span class="lbl">Account</span></button>
      </nav>`;
    document.body.classList.toggle('has-cart', P.view === 'shop' && t.pcs > 0);
    $$('[data-view]').forEach((b) => (b.onclick = () => { if (P.view !== b.dataset.view) window.scrollTo(0, 0); P.view = b.dataset.view; renderShell(); }));
    $('#btn-logout').onclick = async () => { await api('/api/ws/logout', { body: {} }).catch(() => {}); P.me = null; renderLogin(); };
    const rv = $('#btn-review'); if (rv) rv.onclick = openReview;
    if (P.view === 'shop') renderShop(); else if (P.view === 'orders') renderOrders(); else renderAccount();
  }
  const paintCartBar = () => { const y = window.scrollY; renderShell(); window.scrollTo(0, y); };

  // ---------- SHOP: one grid per product (sizes × colors), type how many you want ----------
  function renderShop() {
    const showStock = P.cat.show_stock;
    const prods = P.cat.products;
    const stockPcs = cartLines().reduce((t, l) => t + l.qty, 0), ownPcs = ownLines().reduce((t, l) => t + l.qty, 0);
    const head = `
      ${P.editing ? `<div class="edit-banner"><div><b>Editing ${esc(P.editing.no)}</b><small>Change the numbers, then review and save. · <span class="ar">عدّل الطلب</span></small></div><button class="btn sm" id="stop-edit">Stop editing</button></div>` : ''}
      ${P.shop.welcome && !P.editing ? `<div class="welcome card"><div class="wl-hi">Hello <b dir="auto">${esc(P.me.contact_name || P.me.business_name)}</b> 👋 <span class="ar">أهلاً</span></div><p dir="auto">${esc(P.shop.welcome)}</p></div>` : ''}
      <div class="seg mode-seg">
        <button class="${P.mode === 'stock' ? 'on' : ''}" data-mode="stock">Our hoodies${stockPcs ? ` · ${stockPcs}` : ''}<small class="ar">من عنا</small></button>
        <button class="${P.mode === 'own' ? 'on' : ''}" data-mode="own">🎨 Your hoodies, our print${ownPcs ? ` · ${ownPcs}` : ''}<small class="ar">قطعك وطباعتنا</small></button>
      </div>`;
    if (P.mode === 'own') { $('#view').innerHTML = head; renderOwn(); bindHead(); return; }
    $('#view').innerHTML = `${head}
      ${prods.length ? prods.map((p) => {
        const cs = colorsOf(p.id), ss = sizesOf(p.id);
        const pt = P.print[p.id] || 'none';
        const n = cs.reduce((t, c) => t + ss.reduce((u, s) => u + (P.cart[`${c.id}:${s.id}`] || 0), 0), 0);
        const short = p.wholesale_min > 1 && n > 0 && n < p.wholesale_min;
        return `<section class="wp card" data-p="${p.id}">
          <div class="wp-head">
            <div><div class="wp-name">${esc(p.name)}${p.name_ar ? ` <span class="ar">${esc(p.name_ar)}</span>` : ''}</div>
              <div class="wp-meta"><b class="num">${money(p.wholesale_price)}</b> / piece${p.wholesale_min > 1 ? ` · least ${p.wholesale_min} pcs · <span class="ar">الحد الأدنى ${p.wholesale_min}</span>` : ''}</div></div>
            <div class="wp-count ${short ? 'short' : n ? 'on' : ''}"><b class="num">${n}</b><small>pcs</small></div>
          </div>
          ${p.printable ? `<div class="seg wp-print">${['none', 'front', 'front_back'].map((t) => `<button class="${pt === t ? 'on' : ''}" data-pt="${t}">${PRINT[t][0]}<small>${t === 'none' ? '+0' : '+' + fmt(printPrice(p, t))}</small></button>`).join('')}</div>` : ''}
          ${cs.length && ss.length ? `<div class="grid-wrap wp-grid"><table class="stock order-grid">
            <thead><tr><th></th>${cs.map((c) => `<th><div class="col-head"><i class="sw" style="background:${esc(c.hex)}"></i>${esc(c.name)}${c.name_ar ? `<span class="ar">${esc(c.name_ar)}</span>` : ''}</div></th>`).join('')}</tr></thead>
            <tbody>${ss.map((s) => `<tr><th>${esc(s.name === 'ONE SIZE' ? '1SZ' : s.name)}</th>${cs.map((c) => {
              const k = `${c.id}:${s.id}`, q = P.cart[k] || '', have = stockOf(c.id, s.id);
              const over = q && showStock && q > have;
              return `<td><label class="oc ${q ? 'has' : ''}"><input class="num" type="number" min="0" inputmode="numeric" placeholder="0" data-k="${k}" value="${q}" aria-label="${esc(c.name)} ${esc(s.name)}" />
                <small class="${have ? (over ? 'amber' : '') : 'mto'}">${showStock ? (have ? `${have} left` : 'to make') : (have ? 'in stock' : 'to make')}</small></label></td>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Not available right now.</p>'}
          ${short ? `<p class="wp-warn">Add ${p.wholesale_min - n} more ${esc(p.name)} — the least is ${p.wholesale_min} pieces · <span class="ar">أضف ${p.wholesale_min - n} قطع</span></p>` : ''}
        </section>`;
      }).join('') : '<div class="empty"><b>Nothing to order yet</b>Yalla Wear will add products here soon. · <span class="ar">قريباً</span></div>'}
      <p class="muted portal-help">Pieces we don't have in stock are made for you — we'll confirm the date. · <span class="ar">القطع غير المتوفرة منصنعها إلك ومنأكدلك الموعد</span></p>`;
    bindHead();
    $$('.wp').forEach((sec) => {
      const pid = Number(sec.dataset.p);
      $$('[data-pt]', sec).forEach((b) => (b.onclick = () => { P.print[pid] = b.dataset.pt; saveCart(); paintCartBar(); }));
    });
    $$('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const v = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (v) P.cart[inp.dataset.k] = v; else delete P.cart[inp.dataset.k];
        saveCart(); updateCounts(inp);
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
  }
  function bindHead() {
    const stop = $('#stop-edit');
    if (stop) stop.onclick = () => { clearCart(); renderShell(); toast('ok', 'Stopped editing', 'Your order was not changed'); };
    $$('[data-mode]').forEach((b) => (b.onclick = () => { if (P.mode !== b.dataset.mode) { P.mode = b.dataset.mode; paintCartBar(); } }));
  }

  // ---------- YOUR HOODIES: they bring their own pieces, we print on them ----------
  function renderOwn() {
    const d = P.draft;
    const otherColor = !OWN_COLORS.some(([n]) => n === d.color);
    const otherGarment = !GARMENTS.some(([n]) => n === d.garment);
    const lines = P.own;
    const box = document.createElement('div');
    box.innerHTML = `
      <section class="card own-how">
        <div class="wp-name">Print on your own hoodies <span class="ar">منطبع على قطعك</span></div>
        <ol class="own-steps">
          <li><b>1</b><span>Add your pieces below: what they are, color, size, how many. <span class="ar">ضيف قطعك</span></span></li>
          <li><b>2</b><span>Attach your logo / design when you review the order. <span class="ar">ارفع التصميم</span></span></li>
          <li><b>3</b><span>Send or bring us the pieces — we tell you when we got them. <span class="ar">بعتلنا القطع</span></span></li>
          <li><b>4</b><span>We print and you pick them up. You pay for the print only. <span class="ar">بتدفع الطباعة بس</span></span></li>
        </ol>
        <div class="own-prices"><span>Front print <b class="num">${money(P.shop.own_front)}</b></span><span>Front + back <b class="num">${money(P.shop.own_front_back)}</b></span><small>per piece · <span class="ar">للقطعة</span></small></div>
      </section>
      <section class="card own-add">
        <div class="label">Add pieces · <span class="ar">ضيف قطع</span></div>
        <div class="own-lbl">What is it? · <span class="ar">شو القطعة</span></div>
        <div class="chips">${GARMENTS.map(([n, ar]) => `<button class="chip ${d.garment === n ? 'on' : ''}" data-g="${esc(n)}">${esc(n)} <span class="ar">${ar}</span></button>`).join('')}<button class="chip ${otherGarment ? 'on' : ''}" data-g="">Other</button></div>
        ${otherGarment ? `<input class="input own-other" data-g-other maxlength="40" dir="auto" placeholder="e.g. Jacket, Cap…" value="${esc(d.garment)}" />` : ''}
        <div class="own-lbl">Color · <span class="ar">اللون</span></div>
        <div class="chips">${OWN_COLORS.map(([n, hex]) => `<button class="chip ${d.color === n ? 'on' : ''}" data-c="${esc(n)}" data-hex="${hex}"><i class="sw" style="background:${hex}"></i>${esc(n)}</button>`).join('')}<button class="chip ${otherColor ? 'on' : ''}" data-c="" data-hex="#8A8A99">Other</button></div>
        ${otherColor ? `<input class="input own-other" data-c-other maxlength="30" dir="auto" placeholder="Which color?" value="${esc(d.color)}" />` : ''}
        <div class="own-lbl">Size · <span class="ar">القياس</span></div>
        <div class="chips">${OWN_SIZES.map((z) => `<button class="chip size-chip ${d.size === z ? 'on' : ''}" data-z="${z}">${z === 'Mixed' ? 'Mixed sizes' : z}</button>`).join('')}</div>
        <div class="own-lbl">Print · <span class="ar">الطباعة</span></div>
        <div class="seg">${['front', 'front_back'].map((t) => `<button class="${d.print_type === t ? 'on' : ''}" data-opt="${t}">${PRINT[t][0]}<small>${fmt(ownFee(t))} each</small></button>`).join('')}</div>
        <div class="row own-qty-row">
          <div class="field" style="margin:0"><label>How many? · <span class="ar">العدد</span></label><input class="input num" data-oq type="number" min="1" inputmode="numeric" placeholder="0" value="${esc(d.qty)}" /></div>
          <button class="btn primary" data-oadd>+ Add</button>
        </div>
      </section>
      <section class="card own-list">
        <div class="label">Your pieces · <span class="ar">قطعك</span>${lines.length ? ` <span class="muted">· ${lines.reduce((t, l) => t + l.qty, 0)} pcs</span>` : ''}</div>
        ${lines.length ? lines.map((l, i) => `<div class="cart-line"><div class="sw" style="background:${esc(l.hex)};color:${isLight(l.hex) ? '#2E2D4C' : '#fff'}">${esc(l.size === 'Mixed' ? 'MIX' : l.size)}</div>
          <div class="info"><div class="t" dir="auto">${esc(l.garment)} · ${esc(l.color)} · ${esc(l.size === 'Mixed' ? 'mixed sizes' : l.size)}</div><div class="s">${PRINT[l.print_type][0]} · ${fmt(ownFee(l.print_type))} each</div></div>
          <input class="input num own-line-qty" type="number" min="1" inputmode="numeric" data-olq="${i}" value="${l.qty}" aria-label="How many" />
          <button class="x" data-orm="${i}" aria-label="Remove">×</button></div>`).join('') : '<p class="muted" style="font-size:13px;margin:6px 0 0">Nothing added yet. · <span class="ar">ما ضفت شي بعد</span></p>'}
      </section>`;
    $('#view').append(...box.children);
    const v = $('#view');
    const keep = (fn) => () => { fn(); paintCartBar(); };
    $$('[data-g]', v).forEach((b) => (b.onclick = keep(() => { d.garment = b.dataset.g; })));
    $$('[data-c]', v).forEach((b) => (b.onclick = keep(() => { d.color = b.dataset.c; d.hex = b.dataset.hex; })));
    $$('[data-z]', v).forEach((b) => (b.onclick = keep(() => { d.size = b.dataset.z; })));
    $$('[data-opt]', v).forEach((b) => (b.onclick = keep(() => { d.print_type = b.dataset.opt; })));
    const go = $('[data-g-other]', v); if (go) go.oninput = () => { d.garment = go.value; };
    const co = $('[data-c-other]', v); if (co) co.oninput = () => { d.color = co.value; };
    $('[data-oq]', v).oninput = (e) => { d.qty = e.target.value; };
    $('[data-oq]', v).onkeydown = (e) => { if (e.key === 'Enter') $('[data-oadd]', v).click(); };
    $('[data-oadd]', v).onclick = () => {
      const qty = Math.floor(Number(d.qty) || 0);
      if (qty < 1) return toast('err', 'How many pieces?', 'Type the number first · اكتب العدد');
      if (!String(d.garment).trim()) return toast('err', 'What is the piece?', 'Pick or type it · اختار القطعة');
      if (!String(d.color).trim()) return toast('err', 'Which color?', 'Pick or type it · اختار اللون');
      const same = P.own.find((l) => l.garment === d.garment.trim() && l.color === d.color.trim() && l.size === d.size && l.print_type === d.print_type);
      if (same) same.qty += qty;
      else P.own.push({ garment: d.garment.trim(), color: d.color.trim(), hex: d.hex, size: d.size, qty, print_type: d.print_type });
      d.qty = '';
      saveCart(); paintCartBar();
      toast('ok', `${qty} × ${d.garment} added`, `${d.color} · ${d.size}`, 2200);
    };
    $$('[data-olq]', v).forEach((inp) => (inp.onchange = () => {
      const q = Math.floor(Number(inp.value) || 0);
      if (q < 1) P.own.splice(+inp.dataset.olq, 1); else P.own[+inp.dataset.olq].qty = q;
      saveCart(); paintCartBar();
    }));
    $$('[data-orm]', v).forEach((b) => (b.onclick = () => { P.own.splice(+b.dataset.orm, 1); saveCart(); paintCartBar(); }));
  }

  // files: read a picture / PDF for upload (kept on this page only until the order is sent)
  const MAX_FILE = 8 * 1024 * 1024;
  const readFile = (f) => new Promise((resolve, reject) => {
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.type)) return reject(new Error(`${f.name}: send a PNG, JPG, WEBP or PDF`));
    if (f.size > MAX_FILE) return reject(new Error(`${f.name} is too big (8 MB max)`));
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, data: r.result, type: f.type, size: f.size });
    r.onerror = () => reject(new Error(`Could not read ${f.name}`));
    r.readAsDataURL(f);
  });
  const fileChip = (f, href, rm) => `<div class="file-chip">${/^image\//.test(f.mime || f.type) && (href || f.data) ? `<img src="${esc(href || f.data)}" alt="">` : '<span class="pdf">PDF</span>'}
    <div class="fn"><a ${href ? `href="${esc(href)}" target="_blank" rel="noopener"` : ''} dir="auto">${esc(f.name)}</a><small>${fmt(Math.max(1, Math.round(f.size / 1024)))} KB</small></div>${rm != null ? `<button class="x" data-frm="${rm}" aria-label="Remove">×</button>` : ''}</div>`;

  // updates the numbers in place (no redraw, so the next box you tap still gets the tap)
  function updateCounts(inp) {
    const [cid, sid] = inp.dataset.k.split(':').map(Number);
    const q = P.cart[inp.dataset.k] || 0, have = stockOf(cid, sid);
    const label = inp.closest('.oc');
    label.classList.toggle('has', q > 0);
    if (P.cat.show_stock && have) { const sm = $('small', label); sm.className = q > have ? 'amber' : ''; sm.textContent = `${have} left`; }
    const sec = inp.closest('.wp'), p = prod(Number(sec.dataset.p));
    const n = colorsOf(p.id).reduce((t, c) => t + sizesOf(p.id).reduce((u, s) => u + (P.cart[`${c.id}:${s.id}`] || 0), 0), 0);
    const short = p.wholesale_min > 1 && n > 0 && n < p.wholesale_min;
    const box = $('.wp-count', sec);
    box.className = `wp-count ${short ? 'short' : n ? 'on' : ''}`;
    $('b', box).textContent = n;
    let warn = $('.wp-warn', sec);
    if (short) {
      if (!warn) { warn = document.createElement('p'); warn.className = 'wp-warn'; sec.appendChild(warn); }
      warn.innerHTML = `Add ${p.wholesale_min - n} more ${esc(p.name)} — the least is ${p.wholesale_min} pieces · <span class="ar">أضف ${p.wholesale_min - n} قطع</span>`;
    } else if (warn) warn.remove();
    const t = cartTotals();
    let bar = $('.cart-bar');
    if (!t.pcs) { if (bar) bar.remove(); document.body.classList.remove('has-cart'); return; }
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'cart-bar';
      bar.innerHTML = `<div><b class="num"></b><small>${P.editing ? `Editing ${esc(P.editing.no)}` : 'Your order · <span class="ar">طلبك</span>'}</small></div><button class="btn primary">${P.editing ? 'Review changes' : 'Review order'} ›</button>`;
      $('button', bar).onclick = openReview;
      $('nav.tabs').before(bar);
      document.body.classList.add('has-cart');
    }
    $('b', bar).innerHTML = `${t.pcs} pcs · ${fmt(t.total)} <small>${esc(cur())}</small>`;
  }

  function openReview() {
    const t = cartTotals();
    if (!t.pcs) return;
    const short = underMin(t.lines);
    const showStock = P.cat.show_stock;
    const toMake = t.lines.reduce((a, l) => a + Math.max(0, l.qty - stockOf(l.c.id, l.s.id)), 0);
    const sh = openSheet(`${sheetHead(P.editing ? `Save ${esc(P.editing.no)}` : 'Your order')}
      ${t.own.length && t.lines.length ? '<div class="label" style="margin-bottom:6px">From our stock · <span class="ar">من عنا</span></div>' : ''}
      <div class="cart">${t.lines.map((l) => `<div class="cart-line"><div class="sw" style="background:${esc(l.c.hex)};color:${isLight(l.c.hex) ? '#2E2D4C' : '#fff'}">${esc(l.s.name === 'ONE SIZE' ? '1SZ' : l.s.name)}</div>
        <div class="info"><div class="t">${l.qty} × ${esc(l.p.name)} · ${esc(l.c.name)} ${esc(l.s.name)}</div><div class="s">${PRINT[l.print_type][0]} · ${fmt(l.unit)} each</div></div>
        <div class="p">${fmt(l.unit * l.qty)}</div></div>`).join('')}</div>
      ${t.own.length ? `<div class="label" style="margin:${t.lines.length ? '14px' : '0'} 0 6px">🎨 Your pieces, we print · <span class="ar">قطعك</span></div>
      <div class="cart">${t.own.map((l) => `<div class="cart-line"><div class="sw" style="background:${esc(l.hex)};color:${isLight(l.hex) ? '#2E2D4C' : '#fff'}">${esc(l.size === 'Mixed' ? 'MIX' : l.size)}</div>
        <div class="info"><div class="t" dir="auto">${l.qty} × ${esc(l.garment)} · ${esc(l.color)} ${esc(l.size === 'Mixed' ? 'mixed sizes' : l.size)}</div><div class="s">Your piece · ${PRINT[l.print_type][0]} · ${fmt(l.unit)} each</div></div>
        <div class="p">${fmt(l.unit * l.qty)}</div></div>`).join('')}</div>
      <p class="own-note">📦 Send or bring us your ${t.ownPcs} piece${t.ownPcs === 1 ? '' : 's'} — we start printing when they arrive. · <span class="ar">بعتلنا القطع لنبلش طباعة</span></p>` : ''}
      ${t.own.length || Object.values(P.print).some((x) => x && x !== 'none') ? `<div class="field"><label>${bi('Your design / logo (picture or PDF)', 'التصميم أو اللوغو')}</label>
        <div class="files" data-files></div>
        <label class="btn block file-btn">${icon.clip}Attach design · <span class="ar">ارفع ملف</span><input type="file" data-file accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden /></label></div>` : ''}
      ${short.length ? `<div class="wp-warn box">${short.map((x) => `${esc(x.p.name)}: the least is ${x.p.wholesale_min} pieces (you have ${x.n})`).join('<br>')}</div>` : ''}
      ${showStock && toMake ? `<p class="muted" style="font-size:13px">${toMake} piece${toMake === 1 ? '' : 's'} will be made for you · <span class="ar">${toMake} قطع للتصنيع</span></p>` : ''}
      <div class="field"><label>${bi('Note for Yalla Wear (date, delivery, design…)', 'ملاحظة')}</label><textarea class="input" data-note rows="2" maxlength="500" dir="auto" placeholder="Optional">${esc(P.note)}</textarea></div>
      <div class="totals"><div class="line"><span>${t.pcs} pieces</span><span class="num">${fmt(t.total)}</span></div>
        <div class="grand"><span>Total · <span class="ar">المجموع</span></span><b class="num">${fmt(t.total)} <small style="font-size:14px;font-family:var(--ui)">${esc(cur())}</small></b></div></div>
      <p class="muted" style="font-size:12px;margin:-4px 0 12px">Yalla Wear confirms the final price and date when they accept your order. · <span class="ar">منأكد السعر والموعد عند القبول</span></p>
      <button class="btn primary block" data-send ${short.length ? 'disabled' : ''}>${P.editing ? 'Save changes' : 'Send order'} · <span class="ar">${P.editing ? 'حفظ' : 'إرسال الطلب'}</span></button>`);
    $('[data-note]', sh).oninput = (e) => { P.note = e.target.value; saveCart(); };
    const paintFiles = () => {
      const el = $('[data-files]', sh);
      if (!el) return;
      el.innerHTML = P.files.map((f, i) => fileChip(f, null, i)).join('');
      $$('[data-frm]', el).forEach((b) => (b.onclick = () => { P.files.splice(+b.dataset.frm, 1); paintFiles(); }));
    };
    const fin = $('[data-file]', sh);
    if (fin) fin.onchange = async () => {
      for (const f of [...fin.files]) {
        if (P.files.length >= 8) { toast('err', 'Up to 8 files'); break; }
        try { P.files.push(await readFile(f)); } catch (err) { toast('err', err.message); }
      }
      fin.value = ''; paintFiles();
    };
    paintFiles();
    $('[data-send]', sh).onclick = (e) => busy(e.currentTarget, async () => {
      const body = { items: [
        ...t.lines.map((l) => ({ color_id: l.c.id, size_id: l.s.id, qty: l.qty, print_type: l.print_type })),
        ...t.own.map((l) => ({ own: true, garment: l.garment, color: l.color, hex: l.hex, size: l.size, qty: l.qty, print_type: l.print_type })),
      ], note: P.note };
      try {
        const editing = P.editing;
        const r = await api(editing ? `/api/ws/orders/${editing.id}` : '/api/ws/orders', { method: editing ? 'PUT' : 'POST', body });
        const failed = [];
        for (const f of P.files) {
          try { await api(`/api/ws/orders/${r.order.id}/files`, { body: { name: f.name, data: f.data } }); } catch (err) { failed.push(`${f.name}: ${err.message}`); }
        }
        if (failed.length) toast('err', 'A file did not upload', `${failed.join(' · ')} — open the order to try again`, 8000);
        clearCart();
        closeSheet();
        await loadOrders();
        P.view = 'orders';
        renderShell();
        window.scrollTo(0, 0);
        openOrder(r.order.id, editing ? null : 'sent');
      } catch (err) { toast('err', 'Could not send', err.message, 6000); }
    });
  }

  // ---------- ORDERS ----------
  async function loadOrders() { P.orders = (await api('/api/ws/orders')).orders; return P.orders; }
  const statusPill = (st) => `<span class="pill ${STATUS[st][2]}">${STATUS[st][0]}</span>`;
  function renderOrders() {
    const list = P.orders || [];
    const active = list.filter((o) => ACTIVE.includes(o.status));
    const open = list.filter((o) => ['pending', 'accepted', 'production', 'ready'].includes(o.status));
    const toPay = active.filter((o) => !o.paid).reduce((t, o) => t + o.total, 0);
    $('#view').innerHTML = `
      <section class="kpis">
        <div class="kpi accent"><div class="kpi-label">Open · <span class="ar">قيد التنفيذ</span></div><div class="kpi-value num">${open.length}</div><div class="kpi-foot">${list.filter((o) => o.status === 'ready').length} ready to pick up</div></div>
        <div class="kpi"><div class="kpi-label">All orders · <span class="ar">كل الطلبات</span></div><div class="kpi-value num">${list.length}</div><div class="kpi-foot">${fmt(active.reduce((t, o) => t + o.items.reduce((u, i) => u + i.qty, 0), 0))} pieces</div></div>
        <div class="kpi"><div class="kpi-label">Total bought</div><div class="kpi-value num">${fmt(active.reduce((t, o) => t + o.total, 0))}<small>${esc(cur())}</small></div><div class="kpi-foot">accepted orders</div></div>
        <div class="kpi ${toPay ? 'warn' : ''}"><div class="kpi-label">To pay · <span class="ar">المتبقي</span></div><div class="kpi-value num">${fmt(toPay)}<small>${esc(cur())}</small></div><div class="kpi-foot">${active.filter((o) => !o.paid).length} not paid</div></div>
      </section>
      <div class="section-head"><div class="section-title">My orders · <span class="ar">طلباتي</span></div></div>
      <div class="sales-list">${list.length ? list.map((o) => {
        const pcs = o.items.reduce((t, i) => t + i.qty, 0);
        const idx = FLOW.indexOf(o.status);
        return `<button class="sale ws-row ${['rejected', 'cancelled'].includes(o.status) ? 'is-cancelled' : ''}" data-oid="${o.id}">
          <div class="main">
            <div class="top"><span class="inv">${o.order_no}</span>${statusPill(o.status)}${ACTIVE.includes(o.status) ? (o.paid ? '<span class="pill paid">Paid</span>' : '<span class="pill unpaid">Not paid</span>') : ''}</div>
            ${idx >= 0 ? `<div class="mini-steps">${FLOW.map((s, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>` : ''}
            <div class="when">${dateFmt(o.created_at)} · ${pcs} pcs${o.own_pcs ? ` · 🎨 ${o.own_pcs} yours` : ''}${o.due_date && idx < 4 && idx >= 0 ? ` · ready by ${esc(o.due_date)}` : ''}</div>
          </div>
          <div class="amt"><b class="num">${fmt(o.total)}</b><span class="muted" style="font-size:12px">${esc(cur())}</span></div>
        </button>`;
      }).join('') : `<div class="empty"><b>No orders yet</b>Go to <span style="color:var(--mint)">Order</span>, type how many you want, and send it. · <span class="ar">ما في طلبات بعد</span></div>`}</div>`;
    $$('[data-oid]').forEach((b) => (b.onclick = () => openOrder(+b.dataset.oid)));
  }

  async function openOrder(id, just) {
    const sh = openSheet(`${sheetHead('Order')}<div data-body>${'<div class="skel sm"></div>'.repeat(4)}</div>`, { wide: true });
    let o;
    try { o = (await api(`/api/ws/orders/${id}`)).order; } catch (e) { $('[data-body]', sh).innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const st = o.status, idx = FLOW.indexOf(st), closed = idx < 0;
    const pcs = o.items.reduce((t, i) => t + i.qty, 0);
    const contact = P.shop.shop_phone ? `https://wa.me/${waDigits(P.shop.shop_phone)}?text=${encodeURIComponent(`Hi Yalla Wear, about my order ${o.order_no} (${P.me.business_name}):\n`)}` : null;
    $('.sheet-title', sh).textContent = o.order_no;
    $('[data-body]', sh).innerHTML = `
      ${just === 'sent' ? `<div class="sent-banner">✓ Order sent! We'll look at it and confirm. <span class="ar">تم إرسال الطلب، منأكدلك قريباً</span></div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;flex-wrap:wrap">${statusPill(st)}${ACTIVE.includes(st) ? (o.paid ? '<span class="pill paid">Paid</span>' : '<span class="pill unpaid">Not paid</span>') : ''}<span class="muted" style="font-size:13px">${dateFmt(o.created_at)}</span></div>
      ${closed ? '' : `<div class="ws-steps big">${FLOW.map((s, i) => `<div class="ws-step ${i < idx ? 'done' : i === idx ? 'now' : ''}"><i></i><span>${STATUS[s][0].replace('Sent — waiting for us', 'Sent')}</span><span class="ar">${STATUS[s][1].replace('تم الإرسال · ', '')}</span></div>`).join('')}</div>`}
      <p class="status-line">${{
        pending: 'We got your order and will confirm it soon. You can still change or cancel it. · <span class="ar">فيك تعدّل أو تلغي الطلب لهلق</span>',
        accepted: 'Your order is accepted. · <span class="ar">تم قبول طلبك</span>',
        production: 'Your pieces are being made. · <span class="ar">عم نصنع طلبك</span>',
        ready: 'Your order is ready! · <span class="ar">طلبك جاهز</span>',
        delivered: 'Delivered. Thank you! · <span class="ar">تم التسليم، شكراً</span>',
        rejected: 'We could not take this order. Message us for details. · <span class="ar">ما قدرنا ناخد هالطلب</span>',
        cancelled: 'This order was cancelled. · <span class="ar">تم إلغاء الطلب</span>',
      }[st]}${o.due_date && !closed && st !== 'delivered' ? `<br><b>Ready by ${esc(o.due_date)}</b> · <span class="ar">الموعد</span>` : ''}</p>
      ${o.customer_note ? `<div class="gift-card"><div class="gc-h">Note</div><div class="gc-m" dir="auto">${esc(o.customer_note)}</div></div>` : ''}
      ${o.own_pcs && !closed ? `<div class="own-recv ${o.own_received >= o.own_pcs ? 'all' : ''}"><div><b>📦 Your pieces: we got ${o.own_received} of ${o.own_pcs}</b>
        <small>${o.own_received >= o.own_pcs ? 'All here — thank you! · <span class="ar">وصلوا كلهن</span>' : `Send or bring us ${o.own_pcs - o.own_received} more · <span class="ar">باقي ${o.own_pcs - o.own_received} قطعة</span>`}</small></div>
        <div class="bar"><i style="width:${Math.round((o.own_received / o.own_pcs) * 100)}%"></i></div></div>` : ''}
      <div class="detail-items">${o.items.map((it) => `<div class="cart-line"><div class="sw" style="background:${esc(it.hex)};color:${isLight(it.hex) ? '#2E2D4C' : '#fff'}">${esc(it.size === 'ONE SIZE' ? '1SZ' : it.size === 'Mixed' ? 'MIX' : it.size)}</div>
        <div class="info"><div class="t" dir="auto">${it.qty} × ${esc(it.product)} · ${esc(it.color)} ${esc(it.size)}</div><div class="s">${it.own ? '<b class="own-tag">Your piece</b> · ' : ''}${PRINT[it.print_type][0]} · ${fmt(it.unit_price + it.print_price)} each</div></div>
        <div class="p">${fmt(it.line_total)}</div></div>`).join('')}</div>
      <div class="totals">
        ${o.discount ? `<div class="line"><span>Subtotal</span><span class="num">${fmt(o.subtotal)}</span></div><div class="line"><span>Discount · <span class="ar">خصم</span></span><span class="num">−${fmt(o.discount)}</span></div>` : ''}
        <div class="grand"><span>Total · ${pcs} pcs</span><b class="num" ${closed ? 'style="text-decoration:line-through;color:var(--muted)"' : ''}>${fmt(o.total)} <small style="font-size:14px;font-family:var(--ui)">${esc(cur())}</small></b></div>
      </div>
      ${o.files.length || !closed && st !== 'delivered' ? `<div class="label" style="margin:16px 0 8px">Design files · <span class="ar">ملفات التصميم</span></div>
        <div class="files">${o.files.map((f) => fileChip(f, `/api/ws/orders/${o.id}/files/${f.id}`, st === 'pending' ? f.id : null)).join('') || '<p class="muted" style="font-size:13px;margin:0 0 8px">No design attached yet. · <span class="ar">ما في تصميم</span></p>'}</div>
        ${!closed && st !== 'delivered' ? `<label class="btn block file-btn" style="margin-bottom:12px">${icon.clip}Add design file · <span class="ar">ارفع ملف</span><input type="file" data-add-file accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden /></label>` : ''}` : ''}
      ${o.has_invoice && ACTIVE.includes(st) ? `<a class="btn primary block" href="/api/ws/orders/${o.id}/invoice.pdf" download="YallaWear-${o.order_no}.pdf">${icon.down}Download invoice · <span class="ar">تحميل الفاتورة</span></a>` : ACTIVE.includes(st) ? '<p class="muted" style="font-size:13px">The invoice will be here soon. · <span class="ar">الفاتورة قريباً</span></p>' : ''}
      ${st === 'pending' ? `<div class="actions-grid" style="margin-top:10px"><button class="btn" data-edit>${icon.edit}Change order</button><button class="btn danger" data-cancel>Cancel order</button></div>` : ''}
      ${contact ? `<a class="btn wa block" style="margin-top:10px" href="${contact}" target="_blank" rel="noopener">${icon.wa}Message Yalla Wear about this order</a>` : ''}
      ${o.events.length ? `<div class="label" style="margin:22px 0 10px">History · <span class="ar">السجل</span></div><div class="ws-events">${o.events.slice().reverse().map((e) => `
        <div class="ws-ev"><i></i><div><b>${e.kind === 'status' ? STATUS[e.status][0] : e.kind === 'created' ? 'Order sent' : e.kind === 'paid' || e.kind === 'received' ? esc(e.note) : 'Order changed'}</b>
        <small>${dateFmt(e.created_at)}${e.kind === 'edited' && e.note ? ' · ' + esc(e.note) : ''}</small></div></div>`).join('')}</div>` : ''}`;
    const ed = $('[data-edit]', sh);
    if (ed) ed.onclick = () => {
      // load the order back into the grid
      P.cart = {}; P.print = {}; P.own = []; P.files = [];
      for (const it of o.items) {
        if (it.own) { P.own.push({ garment: it.product, color: it.color, hex: it.hex, size: it.size, qty: it.qty, print_type: it.print_type }); continue; }
        const k = `${it.color_id}:${it.size_id}`; P.cart[k] = (P.cart[k] || 0) + it.qty; P.print[it.product_id] = it.print_type;
      }
      P.mode = P.own.length && !Object.keys(P.cart).length ? 'own' : 'stock';
      P.note = o.customer_note; P.editing = { id: o.id, no: o.order_no };
      saveCart(); closeSheet(); P.view = 'shop'; renderShell(); window.scrollTo(0, 0);
    };
    const af = $('[data-add-file]', sh);
    if (af) af.onchange = () => busy(af.closest('label'), async () => {
      let n = 0;
      for (const f of [...af.files]) {
        try { const file = await readFile(f); await api(`/api/ws/orders/${o.id}/files`, { body: { name: file.name, data: file.data } }); n++; }
        catch (err) { toast('err', 'Could not add it', err.message, 6000); }
      }
      if (n) { closeSheet(); openOrder(o.id); toast('ok', n === 1 ? 'Design added ✓' : `${n} files added ✓`); }
    });
    $$('[data-frm]', sh).forEach((b) => (b.onclick = () => busy(b, async () => {
      if (!confirm('Remove this file? · حذف الملف؟')) return;
      try { await api(`/api/ws/orders/${o.id}/files/${b.dataset.frm}`, { method: 'DELETE' }); closeSheet(); openOrder(o.id); } catch (err) { toast('err', err.message); }
    })));
    const cn = $('[data-cancel]', sh);
    if (cn) cn.onclick = () => busy(cn, async () => {
      if (!confirm(`Cancel ${o.order_no}? · إلغاء الطلب؟`)) return;
      try { await api(`/api/ws/orders/${o.id}/cancel`, { body: {} }); closeSheet(); await loadOrders(); renderShell(); toast('ok', `${o.order_no} cancelled`); }
      catch (e) { toast('err', e.message); }
    });
  }

  // ---------- ACCOUNT ----------
  function renderAccount() {
    const m = P.me, s = P.shop;
    $('#view').innerHTML = `
      <div class="card acct">
        <div class="kpi-label">Your shop · <span class="ar">محلك</span></div>
        <div class="acct-name" dir="auto">${esc(m.business_name)}</div>
        <div class="muted">${[m.contact_name, m.city, m.phone].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="muted" style="margin-top:6px">Username: <b>${esc(m.username)}</b></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">To change these details, message Yalla Wear.</p>
      </div>
      <div class="section-head"><div class="section-title">Change password · <span class="ar">تغيير كلمة السر</span></div></div>
      <form class="card" id="pw-form">
        <div class="field"><label>Current password</label><input class="input" type="password" id="pw-cur" autocomplete="current-password" required /></div>
        <div class="field"><label>New password (6+ characters)</label><input class="input" type="password" id="pw-new" autocomplete="new-password" minlength="6" required /></div>
        <button class="btn primary block" type="submit">Save new password</button>
      </form>
      ${s.shop_phone || s.shop_instagram ? `<div class="section-head"><div class="section-title">Contact us · <span class="ar">تواصل معنا</span></div></div>
      <div class="actions-grid">
        ${s.shop_phone ? `<a class="btn wa" href="https://wa.me/${waDigits(s.shop_phone)}" target="_blank" rel="noopener">${icon.wa}WhatsApp</a>` : ''}
        ${s.shop_instagram ? `<a class="btn ig" href="https://instagram.com/${encodeURIComponent(String(s.shop_instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">${icon.ig}${esc(s.shop_instagram)}</a>` : ''}
      </div>` : ''}`;
    $('#pw-form').onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter || $('#pw-form button'), async () => {
        try {
          await api('/api/ws/password', { method: 'PUT', body: { current: $('#pw-cur').value, next: $('#pw-new').value } });
          $('#pw-form').reset(); toast('ok', 'Password changed ✓', 'Use it next time you log in');
        } catch (err) { toast('err', 'Could not change it', err.message); }
      });
    };
  }

  // ---------- refresh: orders and stock stay fresh while the page is open ----------
  async function refresh() {
    if (!P.me || document.hidden || $('#sheet-root').children.length) return;
    try {
      const [cat] = await Promise.all([api('/api/ws/catalog'), loadOrders()]);
      P.cat = cat;
      if (P.view === 'orders') renderShell();
    } catch { /* next tick */ }
  }
  setInterval(refresh, 30000);
  // hide the tab bar while the phone keyboard is open
  const isField = (el) => el && el.matches && el.matches('input:not([type=checkbox]), textarea, select');
  document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb'); }, 60));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  async function boot() {
    try {
      const me = await api('/api/ws/me');
      P.me = me.wholesaler; P.shop = me.shop;
      const [cat] = await Promise.all([api('/api/ws/catalog'), loadOrders()]);
      P.cat = cat;
      loadCart();
      renderShell();
    } catch { renderLogin(); }
  }
  boot();
})();
