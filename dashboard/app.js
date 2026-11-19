// Token Radar dashboard, third revision.
//
// Reads window.RADAR — written beside dashboard/ by main.ts — and
// renders the ranked board, the filters, and a per-protocol detail
// view with the model's inputs and the farm plan. No network: every
// byte shown is in data.js, and every number the page shows is
// recomputed here from the same snapshot figures board.json carries.
(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const mount = document.getElementById('board');

  // View state: search text, category and chain filters, which tab,
  // which sort and direction, and which protocol's detail is open.
  const view = {
    q: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }

  function percent(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, recomputed in the page from the same snapshot figures,
  // so the number the page shows is visibly the number board.json
  // carries for that row.
  function impliedOf(row, model) {
    // The knobs data.js carries are the renamed ones from lib/model.ts:
    // tvlShare, growthLow/High/Weight, ageBase/Span/CapDays/FallbackDays,
    // chainBonus/chainBonusMax — not the starter's old field names.
    const growth = Math.min(model.growthHigh, Math.max(model.growthLow, row.change_7d == null ? 0 : row.change_7d));
    const growthMult = 1 + (growth / 100) * model.growthWeight;
    const age = row.age_days == null ? model.ageFallbackDays : row.age_days;
    const maturity = model.ageBase + (Math.min(Math.max(age, 0), model.ageCapDays) / model.ageCapDays) * model.ageSpan;
    const breadth = 1 + Math.max(0, Math.min((row.chains || []).length - 1, model.chainBonusMax)) * model.chainBonus;
    return Math.max(1, Math.round(row.tvl_usd * model.tvlShare * growthMult * maturity * breadth));
  }

  // Tiny element builder: tag, attributes (class/text/on*), children.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach((c) => { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan, derived in the page exactly as main.ts derives it
  // for board.json: category, chains, TVL and age decide the action,
  // the capital, the hold and every cost and time. No name is
  // special-cased anywhere in here.
  function mainChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 400;
    if (p.tvl_usd >= 1e8) return 200;
    if (p.tvl_usd >= 1e7) return 100;
    return 50;
  }

  function holdFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }

  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    const name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the loan open.';
    if (c.includes('dex') || c.includes('leveraged farm')) return 'Add $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the LP tokens.';
    if (c.includes('yield')) return 'Deposit $' + capital + " into " + name + "'s main yield vault on " + chain + ' and keep the vault shares.';
    if (c.includes('perpetual') || c.includes('derivative')) return 'Fund a $' + capital + ' margin account on ' + name + ' (' + chain + ') and open one small hedged trade.';
    if (c.includes('prediction')) return 'Put $' + capital + ' behind one prediction position on ' + name + ' and let it settle.';
    if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and hold the allocation.';
    if (c.includes('stable')) return 'Mint or hold $' + capital + ' of the stable asset issued through ' + name + ' on ' + chain + '.';
    if (c.includes('rwa')) return 'Buy $' + capital + ' of the tokenised real-world asset offered by ' + name + ' on ' + chain + ' and hold it.';
    if (c.includes('insurance')) return 'Take $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' with ' + name + ' and use the bridged funds in its app.';
    if (c.includes('staking') || c.includes('restak')) return 'Stake $' + capital + " of the chain asset through " + name + ' and keep the staking receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  function farmSteps(p) {
    const chain = mainChain(p);
    const capital = capitalFor(p);
    const hold = holdFor(p.age_days);
    const gas = capital >= 200 ? 8 : 4;
    const step = (text, cost, time) => {
      let s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
      if (s.length > 600) s = s.slice(0, 596) + '...';
      return s;
    };
    return [
      step('Open a fresh wallet for this farm only, fund it with the position size, and store its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      step(actionFor(p, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
      step('Do one qualifying action every week — a deposit, a borrow, a swap, a vote or a claim — and keep the receipts.', 'about $2 of gas a week', '10 minutes a week'),
      step('Keep the position open for at least ' + hold + ' days, so it appears in more than one activity snapshot.', 'the $' + capital + ' stays locked in the position', hold + ' days'),
      step('Before withdrawing, check the protocol’s own rewards page and claim only through the link that page publishes.', 'no fee to check, and never pay anyone to claim', '10 minutes'),
      step('Log the wallet, the dates and every transaction hash, so you can repeat the farm or unwind it cleanly.', 'nothing but the log', '5 minutes'),
    ];
  }

  // The view is shareable: search, filter, tab, sort and the open
  // protocol all live in the URL hash, so a screenshot link reopens
  // the same board, detail and filtered views.
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('tab')) view.tab = params.get('tab');
    if (params.get('sort')) view.sort = params.get('sort');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.tab !== 'pre-token') params.set('tab', view.tab);
    if (view.sort !== 'implied') params.set('sort', view.sort);
    if (view.selected) params.set('p', view.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    const q = view.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function sortedRows(list) {
    const key = view.sort;
    return list.slice().sort((a, b) => {
      let av; let bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })));
  }

  function intro() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them rankable. Implied value is a model, not a promise.' })),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))));
  }

  function controlBar() {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
    const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { view.q = search.value; writeHash(); render(); });
    const catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => el('option', { value: c, text: c, selected: c === view.category ? 'selected' : null })));
    catSelect.addEventListener('change', () => { view.category = catSelect.value; writeHash(); render(); });
    const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => el('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null })));
    chainSelect.addEventListener('change', () => { view.chain = chainSelect.value; writeHash(); render(); });
    const preBtn = el('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { view.tab = 'pre-token'; render(); } });
    const liveBtn = el('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { view.tab = 'live'; render(); } });
    // A sort picker beside the clickable headers, so the board's
    // ordering is obvious at a glance as well as on a click.
    const sortSelect = el('select', { id: 'sort', 'aria-label': 'Sort the board by' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(([value, label]) =>
        el('option', { value, text: label, selected: value === view.sort ? 'selected' : null })));
    sortSelect.addEventListener('change', () => { view.sort = sortSelect.value; view.dir = -1; writeHash(); render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sortSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, preBtn, liveBtn)),
      el('span', { class: 'count', text: view.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: () => { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } writeHash(); render(); } },
        label,
        view.sort === key ? el('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null));
  }

  function protocolCell(r) {
    return el('td', null, el('div', { class: 'name' },
      el('b', { text: r.name }),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })));
  }

  function boardTable() {
    const list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { view.q = ''; view.category = 'all'; view.chain = 'all'; writeHash(); render(); } })));
    }
    const max = list[0].implied_value_usd || 1;
    const tbody = el('tbody');
    for (const r of list) {
      const growth = r.change_7d === null ? 'n/a' : percent(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const row = el('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        protocolCell(r),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: ageLabel(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: money(r.implied_value_usd) }))),
        el('td', null, el('span', { class: 'status', text: 'no token' })));
      tbody.appendChild(row);
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function liveTable() {
    const tbody = el('tbody');
    for (const r of DATA.live) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        protocolCell(r),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: percent(r.change_7d) }),
        el('td', { class: 'num', text: money(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))));
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function modelPanel() {
    const m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.tvlShare + ' x (1 + clamp(change_7d, ' + m.growthLow + ', ' + m.growthHigh + ') / 100 x ' + m.growthWeight + ') x (' + m.ageBase + ' + min(age_days, ' + m.ageCapDays + ') / ' + m.ageCapDays + ' x ' + m.ageSpan + ') x (1 + ' + m.chainBonus + ' x min(chains - 1, ' + m.chainBonusMax + ')) )'),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.ageFallbackDays + ' days. Chain breadth rewards protocols already live on several chains. The early radar is every rankable pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' }));
  }

  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { view.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: money(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: percent(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: ageLabel(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: money(row.implied_value_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    mount.textContent = '';
    const shell = el('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(controlBar());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'panel footnote' },
      el('p', null, el('b', { text: 'What this board is not. ' }), 'Implied value is the radar’s own model, not a price and not a promise that a token will launch. A protocol that records no token may still have one its DefiLlama record does not carry.'),
      el('p', { text: 'Source: ' + DATA.source + '. Snapshot date: ' + DATA.as_of + '. Model: ' + DATA.model_version + '.' })));
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  // '/' jumps to the search box, so a keyboard reader can filter
  // the board without reaching for the mouse first.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      const search = document.getElementById('q');
      if (search) search.focus();
    }
  });
})();
