// Token Radar dashboard: static, no network. Reads window.RADAR (../data.js, written by main.ts from board.json's own rows).
(function () {
  'use strict';
  var D = window.RADAR;
  var board = document.getElementById('board');
  if (!D) { board.textContent = 'data.js did not load: the radar has no data.'; return; }
  var rows = D.rows, M = D.model;
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: '', chain: '', watch: false, showx: true, key: 'rank', dir: 1, sel: null };

  function money(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function exact(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return n == null ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function yrs(r) { return r.model.years_tokenless == null ? null : r.model.years_tokenless; }
  function x4(n) { return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }

  // ---------- header
  $('asof').textContent = 'Snapshot ' + D.as_of + ' / ' + D.source.replace(/^DefiLlama /, 'DefiLlama ') + ' / model ' + D.model_version;
  var stats = [
    ['Candidates ranked', String(D.board_size)],
    ['Excluded products', String(D.excluded_size)],
    ['Watchlist', D.watchlist_covered + '/' + D.watchlist_size],
    ['Combined TVL', money(D.total_tvl_usd)],
    ['Token-bearing peers', String(D.token_peers)]
  ];
  stats.forEach(function (s) { add($('stats'), add(el('div'), el('dt', 0, s[0]), el('dd', 0, s[1]))); });
  var mp = $('model');
  [['Value model. ', 'b'],
   ['Every protocol in the snapshot with no token (no CoinGecko id, no symbol) gets ', 0],
   ['implied value = round(TVL x category multiple x momentum x age factor)', 'code'],
   ['. The category multiple is the median market cap / TVL of the token-bearing protocols in the same category in this snapshot (global median ' + D.global_multiple + ' when a category has fewer than ' + M.min_peers + ' peers, clamped to ' + M.multiple_min + '-' + M.multiple_max + '). Momentum is 1 + 7-day TVL change (clamped ' + M.growth_floor + '% to +' + M.growth_cap + '%) x ' + M.growth_weight + ', held within ' + M.momentum_min + '-' + M.momentum_max + '. Age factor rises from ' + M.age_min + ' to ' + (M.age_min + M.age_range).toFixed(2) + ' with years tracked and still tokenless (cap ' + M.age_cap_years + 'y; unknown = 1). Wrapped, staked, bridged and exchange products of a token that already trades (WBTC, bridges, liquid staking, exchanges) and versioned deployments of an existing protocol (names ending in V2, 2.0 and the like) are not launch candidates, so they are excluded from the ranking and listed separately below with the reason. Tokens that already trade are not ranked either: they are the peers the multiples come from.', 0]
  ].forEach(function (p) {
    if (p[1] === 'b') mp.appendChild(el('b', 0, p[0]));
    else if (p[1] === 'code') mp.appendChild(el('code', 0, p[0]));
    else mp.appendChild(document.createTextNode(p[0]));
  });

  // ---------- filters
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    cats[r.category || 'Uncategorised'] = (cats[r.category || 'Uncategorised'] || 0) + 1;
    r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
  });
  function fill(sel, map, all) {
    sel.appendChild(new Option(all, ''));
    Object.keys(map).sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); })
      .forEach(function (k) { sel.appendChild(new Option(k + ' (' + map[k] + ')', k)); });
  }
  fill($('cat'), cats, 'All categories');
  fill($('chain'), chains, 'All chains');

  // ---------- columns
  var cols = [
    { k: 'rank', t: 'Rank', n: 1, v: function (r) { return r.rank; } },
    { k: 'name', t: 'Protocol', v: function (r) { return r.name.toLowerCase(); } },
    { k: 'cat', t: 'Category', v: function (r) { return (r.category || '').toLowerCase(); } },
    { k: 'chains', t: 'Chains', v: function (r) { return r.chains.length ? r.chains[0].toLowerCase() : ''; } },
    { k: 'tvl', t: 'TVL', n: 1, v: function (r) { return r.tvl_usd; } },
    { k: 'chg', t: '7d', n: 1, v: function (r) { return r.change_7d; } },
    { k: 'iv', t: 'Implied value', n: 1, v: function (r) { return r.implied_value_usd; } },
    { k: 'ratio', t: 'Implied / TVL', n: 1, v: function (r) { return r.implied_to_tvl; } },
    { k: 'yrs', t: 'Yrs no token', n: 1, v: yrs },
    { k: 'watch', t: 'Watchlist', v: function (r) { return r.on_watchlist ? 0 : 1; } }
  ];
  var byKey = {};
  cols.forEach(function (c) { byKey[c.k] = c; });
  var thead = document.querySelector('#tbl thead'), tbody = document.querySelector('#tbl tbody');
  var htr = el('tr');
  cols.forEach(function (c) {
    var th = el('th', c.n ? 'n' : '');
    th.scope = 'col';
    th.dataset.k = c.k;
    var b = el('button', 0, c.t);
    b.type = 'button';
    b.addEventListener('click', function () { sortBy(c.k); });
    htr.appendChild(add(th, b));
  });
  thead.appendChild(htr);

  function sortBy(k) {
    if (state.key === k) state.dir = -state.dir;
    else { state.key = k; state.dir = (k === 'name' || k === 'cat' || k === 'chains' || k === 'rank' || k === 'watch') ? 1 : -1; }
    render();
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ') + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var v = byKey[state.key].v, d = state.dir;
    out.sort(function (a, b) {
      var x = v(a), y = v(b);
      if (x == null && y == null) return a.rank - b.rank;
      if (x == null) return 1;   // missing values sort last either way
      if (y == null) return -1;
      return (x < y ? -d : x > y ? d : a.rank - b.rank);
    });
    return out;
  }

  var cbody = document.querySelector('#ctbl tbody');
  $('cnote').textContent = 'Each category multiple is the median market cap / TVL of the ' + D.token_peers + ' token-bearing protocols in this snapshot, taken per category. A category with fewer than ' + M.min_peers + ' peers falls back to the global median (' + D.global_multiple + '). All figures are clamped to ' + M.multiple_min + '-' + M.multiple_max + '. Categories with no token-bearing peer at all use the global median too.';
  D.comparables.forEach(function (c) {
    var own = c.source === 'category';
    cbody.appendChild(add(el('tr'), el('td', 0, c.category), el('td', 'n', String(c.peers)), el('td', 'n', c.multiple.toFixed(4)),
      el('td', own ? 'c' : 'g', own ? 'own category median' : 'global fallback (under ' + M.min_peers + ' peers)')));
  });
  var xbody = document.querySelector('#xtbl tbody');
  $('xnote').textContent = D.excluded_size + ' tokenless protocols are wrapped, staked, bridged or exchange products of a token that already trades, or versioned deployments of an existing protocol (a name ending in V2, 2.0 and the like). Their launch would mostly price the parent asset or repeat an existing one, so they get no rank, no implied value and no farm plan. Search, category and chain filters apply here too.';
  function renderExcluded() {
    var q = state.q.trim().toLowerCase();
    var list = D.excluded.filter(function (r) {
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      return !q || (r.name + ' ' + r.slug + ' ' + r.chains.join(' ') + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0;
    });
    $('excl').hidden = !state.showx || state.watch;
    xbody.textContent = '';
    list.forEach(function (r) {
      var ch = el('td', 0, r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''));
      ch.title = r.chains.join(', ');
      xbody.appendChild(add(el('tr'), el('td', 0, r.name), el('td', 0, r.category || 'n/a'), ch, el('td', 'n', money(r.tvl_usd)), el('td', 'why', r.reason)));
    });
    if (!list.length) { var td = el('td', 'empty', 'No excluded product matches these filters.'); td.colSpan = 5; xbody.appendChild(add(el('tr'), td)); }
  }

  function render() {
    var list = visible();
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    tbody.textContent = '';
    Array.prototype.forEach.call(thead.querySelectorAll('th'), function (th) {
      if (th.dataset.k === state.key) th.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    var frag = document.createDocumentFragment();
    list.forEach(function (r) {
      var tr = el('tr', r.slug === state.sel ? 'sel' : '');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', 'Open ' + r.name + ' detail');
      tr.dataset.slug = r.slug;
      var name = el('td', 'nm', r.name);
      var chg = el('td', 'n ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'up' : 'dn'), pct(r.change_7d));
      var iv = el('td', 'n iv', exact(r.implied_value_usd));
      var bar = el('i');
      bar.style.width = Math.max(2, Math.sqrt(r.implied_value_usd / max) * 100) + '%';
      iv.appendChild(bar);
      var ch = el('td', 'ch', r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''));
      ch.title = r.chains.join(', ');
      var wl = el('td');
      if (r.on_watchlist) wl.appendChild(el('span', 'tag w', 'watchlist'));
      var y = yrs(r);
      add(tr, el('td', 'rk n', '#' + r.rank), name, el('td', 'ct', r.category || 'n/a'), ch,
        el('td', 'n', money(r.tvl_usd)), chg, iv, el('td', 'n', r.implied_to_tvl.toFixed(2) + 'x'),
        el('td', 'n', y == null ? 'n/a' : y.toFixed(1)), wl);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    if (!list.length) {
      var e = el('tr'), td = el('td', 'empty', 'No protocol matches these filters.');
      td.colSpan = cols.length;
      tbody.appendChild(add(e, td));
    }
    var tv = 0, iv2 = 0, w = 0;
    list.forEach(function (r) { tv += r.tvl_usd; iv2 += r.implied_value_usd; if (r.on_watchlist) w++; });
    $('count').textContent = list.length + ' of ' + rows.length + ' rows / ' + w + ' watchlist / TVL ' + money(tv) + ' / implied ' + money(iv2);
    $('foot').textContent = 'Ranks are over all ' + D.board_size + ' launch candidates, so a filtered view keeps its global rank. Click a row for the model breakdown and the farm plan.';
    renderExcluded();
    board.setAttribute('aria-busy', 'false');
  }

  // ---------- detail panel
  var panel = $('panel'), scrim = $('scrim'), lastFocus = null;
  function kv(dl, k, v) { add(dl, el('dt', 0, k), el('dd', 0, v)); }
  function moneyText(p, text) {
    var re = /\$[\d,.]+(?:-\$?[\d,.]+)?M?/g, i = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > i) p.appendChild(document.createTextNode(text.slice(i, m.index)));
      p.appendChild(el('span', 'cost', m[0]));
      i = m.index + m[0].length;
    }
    if (i < text.length) p.appendChild(document.createTextNode(text.slice(i)));
  }
  function open(slug) {
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    if (!state.sel) lastFocus = document.activeElement;
    state.sel = slug;
    var m = r.model;
    panel.textContent = '';
    var x = el('button', 'x', 'Close');
    x.type = 'button';
    x.addEventListener('click', close);
    var h = el('h2', 0, r.name);
    h.id = 'pt';
    add(panel, x, h, el('p', 'lead', '#' + r.rank + ' of ' + D.board_size + ' / ' + (r.category || 'no category') + ' / ' + r.slug));

    panel.appendChild(el('h3', 0, 'Snapshot fields'));
    var dl = el('dl', 'kv');
    kv(dl, 'slug', r.slug); kv(dl, 'name', r.name); kv(dl, 'category', r.category || 'null');
    kv(dl, 'chains (' + r.chains.length + ')', r.chains.join(', ') || 'none');
    kv(dl, 'tvl_usd', exact(r.tvl_usd)); kv(dl, 'change_7d', r.change_7d == null ? 'null' : pct(r.change_7d));
    kv(dl, 'listed_at', r.listed_at || 'null (age unknown)');
    kv(dl, 'years tokenless', m.years_tokenless == null ? 'n/a' : m.years_tokenless.toFixed(2));
    kv(dl, 'token', 'none recorded (gecko_id null, symbol null, mcap null)');
    kv(dl, 'watchlist', r.on_watchlist ? 'yes: on the house watchlist' : 'no: found by the radar below the floor or outside the rule');
    panel.appendChild(dl);

    panel.appendChild(el('h3', 0, 'Model breakdown'));
    var src = m.multiple_source === 'category'
      ? 'median mcap/TVL of ' + m.peer_count + ' token-bearing ' + (r.category || '') + ' peers'
      : 'global median (' + m.peer_count + ' category peers, fewer than ' + M.min_peers + ')';
    var t = el('table', 'calc');
    function line(a, b, c, cls) { var tr = add(el('tr', cls || ''), el('td', 0, a), el('td', 0, b), el('td', 'n', c)); t.appendChild(tr); }
    line('TVL', exact(r.tvl_usd), exact(r.tvl_usd));
    line('Category multiple', src, 'x ' + x4(m.category_multiple));
    line('Momentum', r.change_7d == null ? 'no 7d figure: neutral' : '1 + clamp(' + pct(r.change_7d) + ', ' + M.growth_floor + '..' + M.growth_cap + ')/100 x ' + M.growth_weight + ', within ' + M.momentum_min + '-' + M.momentum_max, 'x ' + x4(m.momentum));
    line('Age factor', m.years_tokenless == null ? 'no listing date: neutral' : M.age_min + ' + ' + M.age_range + ' x min(' + m.years_tokenless.toFixed(2) + 'y, ' + M.age_cap_years + ')/' + M.age_cap_years, 'x ' + x4(m.age_factor));
    line('Implied value', 'rounded to whole dollars', exact(r.implied_value_usd), 'sum');
    panel.appendChild(t);
    panel.appendChild(el('div', 'eq', exact(r.tvl_usd) + ' x ' + x4(m.category_multiple) + ' x ' + x4(m.momentum) + ' x ' + x4(m.age_factor) + '\n= ' + m.formula_value.toLocaleString('en-US') + '  ->  ' + exact(r.implied_value_usd) + '  (' + r.implied_to_tvl.toFixed(2) + 'x TVL)'));

    panel.appendChild(el('h3', 0, 'Farm plan (' + r.farm_steps.length + ' steps)'));
    var last = 0, cap = null;
    r.farm_steps.forEach(function (s) {
      var w = /^Weeks? (\d+)(?:-(\d+))?/.exec(s);
      if (w) last = Math.max(last, +(w[2] || w[1]));
      var c = /\$[\d,]+-\$[\d,]+ of capital/.exec(s);
      if (c && !cap) cap = c[0].replace(' of capital', '');
    });
    var chips = el('div', 'chips');
    add(chips, el('span', 0, 'Duration: ~' + last + ' weeks'), cap ? el('span', 0, 'Capital: ' + cap) : null);
    panel.appendChild(chips);
    var ol = el('ol', 'plan');
    r.farm_steps.forEach(function (s) {
      var li = el('li'), w = /^(Weeks? \d+(?:-\d+)?): /.exec(s);
      if (w) { li.appendChild(el('span', 'when', w[1])); s = s.slice(w[0].length); }
      moneyText(li, s);
      ol.appendChild(li);
    });
    panel.appendChild(ol);
    panel.hidden = false; scrim.hidden = false;
    if (location.hash !== '#' + slug) history.replaceState(null, '', '#' + slug);
    panel.scrollTop = 0;
    x.focus();
    Array.prototype.forEach.call(tbody.children, function (tr) { tr.classList.toggle('sel', tr.dataset.slug === slug); });
  }
  function close() {
    panel.hidden = true; scrim.hidden = true; state.sel = null;
    history.replaceState(null, '', location.pathname + location.search);
    Array.prototype.forEach.call(tbody.children, function (tr) { tr.classList.remove('sel'); });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  tbody.addEventListener('click', function (e) { var tr = e.target.closest('tr[data-slug]'); if (tr) open(tr.dataset.slug); });
  tbody.addEventListener('keydown', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-slug]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(tr.dataset.slug); }
  });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) close();
    if (e.key === 'Tab' && !panel.hidden) { // keep focus inside the dialog
      var f = panel.querySelectorAll('button'); if (f.length) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- wiring
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  $('showx').addEventListener('change', function (e) { state.showx = e.target.checked; render(); });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.watch = false; state.showx = true; state.key = 'rank'; state.dir = 1;
    $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('watch').checked = false; $('showx').checked = true;
    render();
  });
  render();
  var h0 = decodeURIComponent(location.hash.slice(1));
  if (h0) {
    open(h0);
  }
})();
