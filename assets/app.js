/* UI: intelligence-vs-weights chart, model picker, hardware box, fit/speed quadrant, picks, table. No build step. */
(async function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- state
  const DEFAULT = {
    set: { mode: 'curated', months: 6 }, pick: null, x: 'total', xscale: 'log', prec: 'q4', prop: { on: false, sel: null }, reserve: 4, filter: '',
    hw: { mode: 'offload', vram: 24, gpu: 'rtx20-40', ram: 64, uGB: 64, uClass: 'fast', ssd: false },
  };
  const merge = (a, b) => ({ ...a, ...b, set: { ...a.set, ...b.set }, hw: { ...a.hw, ...b.hw }, prop: { ...a.prop, ...b.prop } });
  let state = JSON.parse(JSON.stringify(DEFAULT));
  try { const s = JSON.parse(localStorage.getItem('aaw-state-v2') || 'null'); if (s) state = merge(state, s); } catch (e) { /* private mode */ }
  try { const u = new URLSearchParams(location.search).get('state'); if (u) state = merge(state, JSON.parse(u)); } catch (e) { /* bad share link */ }
  const save = () => { try { localStorage.setItem('aaw-state-v2', JSON.stringify(state)); } catch (e) { /* ignore */ } };

  let hl = null;  // id of the model highlighted via a pick card or a pinned tooltip (not persisted)
  let data;
  try { data = await (await fetch('data/models.json')).json(); }
  catch (e) { $('#chart').insertAdjacentHTML('beforeend', '<p class="empty">Could not load data/models.json. If you opened this file directly, serve the folder over HTTP.</p>'); return; }
  const models = data.models;
  Core.addLean(models);
  for (const m of models) {
    m.cls = m.lookup ? 'lookup' : m.arch.startsWith('moe') ? 'moe' : 'dense';
    m.slug = m.variants[0].slug;
  }
  $('#updated').textContent = `Data refreshed ${data.generated.slice(0, 10)}.`;

  // ---------------------------------------------------------------- helpers
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colorOf = m => css('--' + m.cls);
  const fmtB = v => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'T' : v >= 100 ? Math.round(v) + 'B' : v >= 10 ? +v.toFixed(1) + 'B' : +v.toFixed(2) + 'B');
  const fmtGB = v => (v >= 1000 ? (v / 1000).toFixed(1) + ' TB' : v >= 100 ? Math.round(v) + ' GB' : +v.toFixed(1) + ' GB');
  const DEFAULT_PROP_TIERS = ['Claude Opus', 'Claude Sonnet', 'GPT Astra', 'Claude Haiku', 'GPT Luna'];
  const PROP_COLORS = ['#e5484d', '#2f6fed', '#2a9d5c', '#d19200', '#c13ccf', '#0891b2', '#7c8b00', '#e0558a', '#5b6472', '#b4541a', '#3f8f8f', '#8a5cf6', '#c2410c', '#0e7490', '#4d7c0f'];
  const USABLE_TPS = 3;  // silent usability floor applied to the roofline estimate; speeds themselves are not shown
  const swatch = (c, hollow) => `<i class="dot${hollow ? ' hollow' : ''}" style="${hollow ? 'color' : 'background'}:${c}"></i>`;
  const legend = items => items.map(([sw, t]) => `<span>${sw}${t}</span>`).join('');
  const ARCH_KEY = [[swatch('var(--dense)'), 'Dense'], [swatch('var(--moe)'), 'Mixture of experts'], [swatch('var(--lookup)'), 'Lookup tables']];
  const CLS_SHORT = { fit: 'fits', offload: 'RAM offload', ssd: 'SSD paging', none: 'no fit' };

  function logTicks(a, b) {
    const out = [];
    for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= a && v <= b) out.push(v); }
    return out;
  }
  /** Drop ticks that would be closer than minGap px, preferring round ones (powers of ten, then 5s, then 2s). */
  function thin(ticks, px, minGap = 46) {
    const rank = t => { const m = t / 10 ** Math.floor(Math.log10(t)); return m === 1 ? 0 : m === 5 ? 1 : m === 2 ? 2 : 3; };
    const kept = [];
    for (const t of [...ticks].sort((a, b) => rank(a) - rank(b) || a - b)) if (kept.every(k => Math.abs(px(k) - px(t)) >= minGap)) kept.push(t);
    return kept.sort((a, b) => a - b);
  }
  function linTicks(a, b, n = 6) {
    const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  const hwNow = () => Hardware.build(state.hw);
  /** "4-bit" resolves to NVFP4 on FP4-capable hardware, otherwise GGUF-style Q4_K_M. */
  const quantNow = () => Core.quant(state.prec === 'q4' ? (hwNow().fp4 ? 'nvfp4' : 'q4') : state.prec);
  const evalAll = list => { const hw = hwNow(), o = { q: quantNow(), reserve: state.reserve }; for (const m of list) m.ev = Core.evaluate(m, hw, o); };
  const inSet = () => {
    if (state.pick) { const P = new Set(state.pick); return models.filter(m => P.has(m.id)); }
    return Core.modelSet(models, state.set);
  };
  // ---------------------------------------------------------------- generic scatter
  function scatter(el, c) {
    const W = Math.max(260, el.clientWidth), H = c.height(W);
    const M = { l: c.bare ? 14 : 48, r: 16, t: 12, b: c.bare ? 12 : 44 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const sx = c.xlog ? v => M.l + (Math.log(v / c.x0) / Math.log(c.x1 / c.x0)) * iw : v => M.l + ((v - c.x0) / (c.x1 - c.x0)) * iw;
    const sy = v => M.t + ih - ((v - c.y0) / (c.y1 - c.y0)) * ih;
    const pts = c.pts.map(p => ({ ...p, px: sx(p.x), py: sy(p.y) }));
    let g = '';
    if (!c.bare) {
      for (const t of thin(c.xTicks, sx)) g += `<line class="gridline" x1="${sx(t)}" x2="${sx(t)}" y1="${M.t}" y2="${M.t + ih}"/><text x="${sx(t)}" y="${M.t + ih + 16}" text-anchor="middle">${c.xFmt(t)}</text>`;
      for (const t of c.yTicks) g += `<line class="gridline" x1="${M.l}" x2="${M.l + iw}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${M.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`;
      g += `<line class="axisline" x1="${M.l}" x2="${M.l + iw}" y1="${M.t + ih}" y2="${M.t + ih}"/><line class="axisline" x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + ih}"/>`;
      g += `<text class="axtitle" x="${M.l + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(c.xTitle)}</text>`;
      g += `<text class="axtitle" transform="translate(13 ${M.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(c.yTitle)}</text>`;
    }
    const boxes = [];  // label boxes already taken: axis labels first, then point labels
    if (c.under) { const u = c.under({ sx, sy, M, iw, ih, W, H, pts }); g += u.svg ?? u; boxes.push(...(u.avoid ?? [])); }
    if (c.frontier) {
      const f = Core.frontier(pts.filter(p => p.linkX == null).map(p => ({ x: p.x, y: p.y, px: p.px, py: p.py })));
      if (f.length > 1) g += `<path class="front" d="${f.map((p, i) => (i ? 'L' : 'M') + p.px.toFixed(1) + ' ' + p.py.toFixed(1)).join('')}"/>`;
    }
    // tinted pill linking a lookup-table model's two points (without / with lookup tables)
    for (const p of pts) {
      if (p.linkX == null) continue;
      const x2 = sx(p.linkX), r = (p.r || 5.5) + 4, xa = Math.min(p.px, x2) - r;
      g += `<rect x="${xa}" y="${p.py - r}" width="${Math.abs(p.px - x2) + 2 * r}" height="${2 * r}" rx="${r}" fill="${p.color}" fill-opacity="${p.faded ? .05 : .16}" stroke="${p.color}" stroke-opacity="${p.faded ? .1 : .4}"/>`;
    }
    // faded points first so live ones stay on top
    const order = pts.map((p, i) => i).sort((a, b) => (pts[b].faded ? 1 : 0) - (pts[a].faded ? 1 : 0));
    for (const i of order) {
      const p = pts[i], col = p.color, r = p.r || 5.5;
      g += `<g class="pt${p.faded ? ' faded' : ''}" data-i="${i}">` +
        (p.hl ? `<circle cx="${p.px}" cy="${p.py}" r="${r + 5}" fill="none" stroke="var(--brand)" stroke-width="2"/>` : '') +
        (p.emph ? `<circle cx="${p.px}" cy="${p.py}" r="${r + 3.5}" fill="none" stroke="var(--fg)" stroke-opacity=".7" stroke-width="1.6"/>` : '') +
        `<circle cx="${p.px}" cy="${p.py}" r="${r}" fill="${p.hollow || p.ring ? 'var(--card)' : col}" fill-opacity="${p.hollow || p.ring ? 1 : .86}" stroke="${col}" stroke-width="${p.hollow ? 1.8 : p.ring ? 2 : 1}" ${p.hollow ? 'stroke-dasharray="3 2"' : ''}/></g>`;
    }
    // Labels, highest priority first. Each tries the four spots around its dot; if all are taken it becomes a callout:
    // the nearest free spot on widening rings around the dot, joined to it by a thin leader line.
    const placed = [], leaders = [];
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const inside = b => b.x >= M.l - 4 && b.x + b.w <= W - 2 && b.y >= 0 && b.y + b.h <= H - M.b + 14;
    const onDot = (b, p) => pts.some(q => q !== p && !q.faded && hit(b, { x: q.px - (q.r || 5.5), y: q.py - (q.r || 5.5), w: 2 * (q.r || 5.5), h: 2 * (q.r || 5.5) }));
    const free = (b, p) => inside(b) && !boxes.some(o => hit(b, o)) && !onDot(b, p);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const cand = pts.filter(p => p.label && !p.faded).sort((a, b) => b.label - a.label);
    const ANGLES = [-30, -150, 30, 150, -90, 90, 0, 180, -60, -120, 60, 120, -10, -170, 10, 170].map(d => (d * Math.PI) / 180);
    for (const p of cand.slice(0, c.maxLabels || 200)) {
      const w = p.name.length * 5.7 + 4, h = 13, r = (p.r || 5.5) + 3;
      let done = false;
      for (const [dx, dy, anchor] of [[r, 4, 'start'], [-r, 4, 'end'], [0, -r - 2, 'middle'], [0, r + 11, 'middle']]) {
        const x = anchor === 'start' ? p.px + dx : anchor === 'end' ? p.px + dx - w : p.px - w / 2;
        const bx = { x, y: p.py + dy - 10, w, h };
        if (!free(bx, p)) continue;
        boxes.push(bx); placed.push(`<text class="plabel" x="${p.px + dx}" y="${p.py + dy}" text-anchor="${anchor}">${esc(p.name)}</text>`); done = true; break;
      }
      for (let rad = r + 16; !done && rad <= r + 100; rad += 14) {
        for (const a of ANGLES) {
          const cx = p.px + Math.cos(a) * (rad + w / 2 * Math.abs(Math.cos(a))), cy = p.py + Math.sin(a) * rad;
          const bx = { x: cx - w / 2, y: cy - h / 2 - 1, w, h };
          if (!free(bx, p)) continue;
          const tx = clamp(p.px, bx.x, bx.x + bx.w), ty = clamp(p.py, bx.y, bx.y + bx.h), d = Math.hypot(tx - p.px, ty - p.py) || 1;
          boxes.push(bx);
          leaders.push(`<line class="leader" x1="${p.px + ((tx - p.px) / d) * (p.r || 5.5)}" y1="${p.py + ((ty - p.py) / d) * (p.r || 5.5)}" x2="${tx}" y2="${ty}"/>`);
          placed.push(`<text class="plabel" x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(p.name)}</text>`); done = true; break;
        }
      }
    }
    g += leaders.join('') + placed.join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.aria)}">${g}</svg><div class="tip" hidden></div>`;

    // hover / pin. The tooltip takes the pointer (so its text can be selected and its links clicked). While it is open the
    // pointer may roam a "safe zone" (dot + tooltip + the corridor between them, plus a margin); leaving it closes the tooltip at once.
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
    let pinned = null, safe = null, shown = null;  // shown: model currently in the tooltip (avoids re-rendering it, which would drop a text selection)
    const hide = () => { tip.hidden = true; tip.classList.remove('pinned'); safe = null; shown = null; };
    const show = (p, isPinned) => {
      shown = p.m; tip.innerHTML = c.tip(p.m); tip.hidden = false; tip.classList.toggle('pinned', !!isPinned);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = p.px + 10; const y = p.py - th / 2;
      if (x + tw > W) x = p.px - tw - 10;
      tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.min(Math.max(0, y), H - th) + 'px';
      const t = tip.getBoundingClientRect(), sv = svg.getBoundingClientRect(), k = sv.width / W, reach = ((p.r || 5.5) + 10) * k;
      const dx = sv.left + p.px * k, dy = sv.top + p.py * (sv.height / H), M = 12;
      safe = { l: Math.min(t.left, dx - reach) - M, r: Math.max(t.right, dx + reach) + M, t: Math.min(t.top, dy - reach) - M, b: Math.max(t.bottom, dy + reach) + M };
    };
    const nearest = ev => {
      const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * (W / r.width), my = (ev.clientY - r.top) * (H / r.height);
      let best = null, bd = 18 * 18;
      for (const p of pts) { const d = (p.px - mx) ** 2 + (p.py - my) ** 2; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    svg.addEventListener('mousemove', ev => { if (!pinned) { const p = nearest(ev); if (p && p.m !== shown) show(p); } });
    svg.addEventListener('click', ev => {
      const p = nearest(ev);
      if (p && p !== pinned) { pinned = p; show(p, true); hl = p.m.id; } else { pinned = null; hide(); hl = null; }
    });
    // one document-level listener per chart (replaced on every redraw, so they do not accumulate)
    document.removeEventListener('mousemove', el._away);
    document.documentElement.removeEventListener('mouseleave', el._gone);
    el._away = ev => { if (safe && !pinned && (ev.clientX < safe.l || ev.clientX > safe.r || ev.clientY < safe.t || ev.clientY > safe.b)) hide(); };
    el._gone = () => { if (!pinned) hide(); };
    document.addEventListener('mousemove', el._away);
    document.documentElement.addEventListener('mouseleave', el._gone);
  }

  const aaUrl = m => `https://artificialanalysis.ai/models/${m.slug}`;
  const aaLink = m => `<a href="${aaUrl(m)}" target="_blank" rel="noopener">Artificial Analysis ↗</a>`;
  function tipHTML(m, withHw = true) {
    const e = m.ev, q = quantNow(), gb = m.total * Core.gbPerB(m, q);
    const idx = m.best.toFixed(1) + (m.variants[0].estimated ? ' (AA est.)' : '');
    const params = `${fmtB(m.total)} total · ${fmtB(m.active)} active` + (m.lookup ? ` · ${fmtB(m.lookup)} lookup` : '');
    const rows = [['Intelligence', idx], ['Parameters', params]];
    if (m.lookup) rows.push(['Without lookup tables', fmtB(m.total - m.lookup)]);
    if (m.lookup && withHw && e && e.cls !== 'none') rows.push(['Lookup tables', e.lookupSsd > 0.5 ? 'on SSD' : 'in RAM / VRAM']);
    rows.push([`Weights @ ${q.label}`, fmtGB(gb)]);
    if (withHw) rows.push(['On your hardware', e ? `<span class="badge ${e.cls}">${CLS_SHORT[e.cls]}</span>` : '—']);
    if (withHw && m.lean != null) rows.push(['Lean', (m.lean > 0.12 ? 'coding / agents' : m.lean < -0.12 ? 'knowledge / chat' : 'balanced') + ` (${m.lean > 0 ? '+' : ''}${m.lean.toFixed(2)})`]);
    const links = `<div class="links">${aaLink(m)}` + (m.repo ? `<a href="https://huggingface.co/${m.repo}" target="_blank" rel="noopener">Hugging Face ↗</a>` : '') + '</div>';
    const note = m.notes.length ? `<div class="note">${esc(m.notes[0])}</div>` : '';
    return `<h4>${esc(m.name)}</h4><div class="by">${esc(m.creator)}${m.released ? ' · ' + m.released : ''}${m.license ? ' · ' + esc(m.license) : ''}</div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note}${links}`;
  }

  // ---------------------------------------------------------------- proprietary frontier (horizontal reference lines)
  const propColor = t => PROP_COLORS[data.frontier.indexOf(t) % PROP_COLORS.length];
  const propSel = () => new Set(state.prop.sel || data.frontier.filter(t => DEFAULT_PROP_TIERS.includes(t.tier)).map(t => t.id));
  const propLines = () => (state.prop.on ? data.frontier.filter(t => propSel().has(t.id)) : []);
  function propLinesSvg(lines, { sy, M, iw }) {
    let g = '', lastY = -99;
    for (const t of [...lines].sort((a, b) => b.best - a.best)) {
      const y = sy(t.best), c = propColor(t), ly = Math.max(y - 5, lastY + 12);  // nudge labels apart when scores are close
      lastY = ly;
      g += `<line x1="${M.l}" x2="${M.l + iw}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="1.6" stroke-dasharray="7 5" stroke-opacity=".9"/><text class="plabel" x="${M.l + 8}" y="${ly}" text-anchor="start" style="fill:${c};font-weight:600">${esc(t.name)} · ${t.best.toFixed(1)}</text>`;
    }
    return g;
  }
  function drawProp() {
    const P = state.prop, sel = propSel();
    $('#propbox').classList.toggle('on', P.on);
    $('#propbox').innerHTML = `<label class="tog"><input type="checkbox" id="propOn"${P.on ? ' checked' : ''}> Proprietary frontier</label>` +
      (P.on ? `<div class="pills sm">${data.frontier.map(t => `<button class="pill sm" data-id="${t.id}" aria-pressed="${sel.has(t.id)}" style="--pc:${propColor(t)}" title="${esc(t.name)} · ${t.best.toFixed(1)}">${esc(t.tier)}</button>`).join('')}</div>` : '');
    $('#propOn').addEventListener('change', e => { P.on = e.target.checked; changed(); });
    $('#propbox').querySelectorAll('.pill').forEach(b => b.addEventListener('click', () => {
      const cur = propSel(); cur.has(b.dataset.id) ? cur.delete(b.dataset.id) : cur.add(b.dataset.id); P.sel = [...cur]; changed();
    }));
  }

  // ---------------------------------------------------------------- main chart
  /** Models on the overall frontier (all open models, current x metric, lookup tables ignored) that the view would otherwise hide. */
  function frontierExtras(base) {
    if (state.pick) return [];
    const ids = new Set(base.map(m => m.id));
    const xOf = m => (state.x === 'active' ? m.active : m.total - m.lookup);
    return Core.frontier(models.map(m => ({ x: xOf(m), y: m.best, m }))).map(p => p.m).filter(m => !ids.has(m.id));
  }

  function drawMain() {
    const base = inSet(), extra = frontierExtras(base), set = base.concat(extra);
    const f = state.filter.trim().toLowerCase();
    const xv = m => (state.x === 'active' ? m.active : m.total);
    const pts = set.map(m => ({ x: xv(m), y: m.best, m, color: colorOf(m), hollow: m.variants[0].estimated, hl: hl === m.id }));
    const log = state.xscale === 'log';
    $('#setcount').textContent = state.pick ? `${base.length} chosen` : `${base.length} of ${models.length} open models` + (extra.length ? ` + ${extra.length} on the frontier` : '');
    if (!pts.length) { $('#main').innerHTML = '<p class="empty">No models match this view. Widen the model set above.</p>'; return; }
    const lk = state.x === 'total' ? set.filter(m => m.lookup > 0) : [];  // lookup tables: also plot the size without them
    const xmax = Math.max(...pts.map(p => p.x)), xmin = Math.min(...pts.map(p => p.x), ...lk.map(m => m.total - m.lookup));
    const x0 = log ? xmin / 1.5 : 0, x1 = xmax * (log ? 1.6 : 1.06);
    const rankIdx = Core.ranks(pts.map(p => p.y));
    const fx = p => (state.x === 'total' && p.m.lookup ? p.m.total - p.m.lookup : p.x);  // frontier uses the size without lookup tables
    const fr = new Set(Core.frontier(pts.map(p => ({ x: fx(p), y: p.y, m: p.m }))).map(p => p.m.id));
    pts.forEach((p, i) => { p.name = p.m.name; p.label = (fr.has(p.m.id) ? 2 : 0) + rankIdx[i]; p.faded = !!f && !(p.m.name + ' ' + p.m.creator).toLowerCase().includes(f); });
    for (const m of lk) {
      const par = pts.find(p => p.m === m); par.linkX = m.total - m.lookup;
      pts.push({ x: par.linkX, y: m.best, m, color: par.color, ring: true, faded: par.faded, hl: par.hl, r: 4.5 });
    }
    const lines = propLines();
    const ys = pts.map(p => p.y).concat(lines.map(l => l.best));
    const y0 = Math.max(0, Math.floor((Math.min(...ys) - 3) / 5) * 5), y1 = Math.ceil((Math.max(...ys) + 3) / 5) * 5;
    const xt = log ? logTicks(x0, x1) : linTicks(x0, x1);
    scatter($('#main'), {
      pts, xlog: log, x0, x1, y0, y1, xTicks: xt, yTicks: linTicks(y0, y1, 6), xFmt: fmtB,
      xTitle: `${state.x === 'active' ? 'Active' : 'Total'} parameters (billions, ${log ? 'log' : 'linear'} scale)`, yTitle: 'Artificial Analysis Intelligence Index',
      height: W => Math.round(Math.min(560, Math.max(360, W * 0.56))), frontier: true, tip: m => tipHTML(m, false), aria: 'Scatter plot of intelligence index versus parameter count',
      under: ctx => propLinesSvg(lines, ctx),
    });
    $('#mainLegend').innerHTML = legend([...ARCH_KEY.slice(0, 2), [ARCH_KEY[2][0], 'Lookup tables (ring: size without them, shaded span: the tables)'], [swatch('var(--muted)', true), 'Score estimated by AA']]);
  }

  // ---------------------------------------------------------------- quadrant
  const usable = m => m.ev.cls !== 'none' && m.ev.tps >= USABLE_TPS;

  function drawQuad() {
    const el = $('#quad'), set = inSet();
    const ok = set.filter(usable), rows = ok.filter(m => m.lean != null);
    const shown = `${rows.length} models shown` + (ok.length > rows.length ? `; ${ok.length - rows.length} more fit but lack enough benchmarks to place` : '');
    if (!rows.length) {
      $('#quadLegend').innerHTML = ''; el.innerHTML = `<p class="empty">Nothing fits with these settings. Try 3-bit, more memory, SSD paging (under Advanced), or a wider model set.</p>`; return; }
    // y is speed alone (fewer active parameters = faster, hardware-independent); intelligence is the dot size, and the models
    // on the speed/intelligence frontier (nothing is both faster and smarter) get a ring, so balanced picks stand out.
    const lo = Math.min(...rows.map(m => m.best)), hi = Math.max(...rows.map(m => m.best));
    const rOf = m => 3 + 14 * (hi > lo ? (m.best - lo) / (hi - lo) : 0.5);  // higher score, visibly bigger dot
    const best = new Set(Core.frontier(rows.map(m => ({ x: m.active, y: m.best, m }))).map(p => p.m.id));
    const pts = rows.map(m => ({ x: m.lean, y: -Math.log(m.active), m, color: colorOf(m), hollow: m.variants[0].estimated, hl: hl === m.id, name: m.name, r: rOf(m), emph: best.has(m.id), label: m.best + (best.has(m.id) ? 100 : 0) }));
    const sizeKey = `<svg width="52" height="22" aria-hidden="true"><circle cx="6" cy="11" r="3.5" fill="var(--muted)" fill-opacity=".5"/><circle cx="34" cy="11" r="10" fill="var(--muted)" fill-opacity=".5"/></svg>`;
    const ringKey = `<svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="5" fill="var(--muted)" fill-opacity=".5"/><circle cx="11" cy="11" r="8.5" fill="none" stroke="var(--fg)" stroke-opacity=".7" stroke-width="1.6"/></svg>`;
    $('#quadLegend').innerHTML = legend([...ARCH_KEY, [sizeKey, `bigger dot = higher Intelligence Index (${lo.toFixed(0)}–${hi.toFixed(0)})`], [ringKey, 'ring = best speed / intelligence trade-off'], ['', shown]]);
    // Centre the cross on the middle of the plotted range and scale so the points fill ~90% of each axis.
    const span = vals => { const lo = Math.min(...vals), hi = Math.max(...vals), c = (lo + hi) / 2, h = Math.max((hi - lo) / 2, 1e-6) / 0.9; return [c, c - h, c + h]; };
    const [cx0, x0, x1] = span(pts.map(p => p.x)), [cy0, y0, y1] = span(pts.map(p => p.y));
    scatter(el, {
      pts, bare: true, xlog: false, x0, x1, y0, y1, tip: m => tipHTML(m, true), aria: 'Quadrant chart of coding-versus-knowledge lean against speed, with dot size showing intelligence',       height: W => Math.round(Math.min(600, Math.max(400, W * 0.64))),
      under: ({ sx, sy, M, iw, ih, W, pts: placed }) => {
        const cx = sx(cx0), cy = sy(cy0), l = M.l, r = M.l + iw, t = M.t, b = M.t + ih;
        const narrow = W < 520, fs = narrow ? 12 : 14, avoid = [];
        // each label tries its candidate spots and takes the one with the fewest data points underneath
        const lab = (text, anchor, spots) => {
          const w = text.replace(/&amp;/g, '&').length * fs * 0.58 + 6, h = fs + 5;
          const boxOf = ([x, y]) => ({ x: anchor === 'end' ? x - w : x, y: y - fs, w, h });
          const under = b => placed.filter(p => p.px > b.x - p.r && p.px < b.x + b.w + p.r && p.py > b.y - p.r && p.py < b.y + b.h + p.r).length;
          const best = spots.reduce((a, sp) => (under(boxOf(sp)) < under(boxOf(a)) ? sp : a));
          avoid.push(boxOf(best));
          return `<text class="axlab" style="font-size:${fs}px" x="${best[0]}" y="${best[1]}" text-anchor="${anchor}">${text}</text>`;
        };
        const svg = `<rect x="${l}" y="${t}" width="${iw}" height="${ih}" fill="none" stroke="var(--border)"/>` +
          `<line class="axisline" x1="${cx}" x2="${cx}" y1="${t}" y2="${b}" stroke-dasharray="4 4"/><line class="axisline" x1="${l}" x2="${r}" y1="${cy}" y2="${cy}" stroke-dasharray="4 4"/>` +
          lab(narrow ? '← knowledge' : '← knowledge &amp; chat', 'start', [[l + 8, cy - 8], [l + 8, cy + fs + 8]]) +
          lab(narrow ? 'coding →' : 'coding &amp; agents →', 'end', [[r - 8, cy - 8], [r - 8, cy + fs + 8]]) +
          lab('↑ faster', 'start', [[cx + 8, t + fs + 6]]) + lab('↓ slower', 'start', [[cx + 8, b - 8]]);
        return { svg, avoid };
      },
    });
  }

  // ---------------------------------------------------------------- picks
  function drawPicks() {
    const set = inSet();
    const ok = set.filter(usable);
    const by = (list, key) => list.reduce((a, m) => (a == null || key(m) > key(a) ? m : a), null);
    const picks = [];
    const smart = by(ok, m => m.best);
    if (smart) picks.push(['Smartest that runs well', smart]);
    const inMem = by(ok.filter(m => m.ev.cls === 'fit'), m => m.best);
    if (inMem && inMem !== smart) picks.push(['Smartest that fits in fast memory', inMem]);
    const coder = by(ok.filter(m => m.lean != null && m.lean >= 0.1), m => m.best);
    if (coder) picks.push(['Best for coding & agents', coder]);
    const chat = by(ok.filter(m => m.lean != null && m.lean <= -0.05), m => m.best);
    if (chat) picks.push(['Best for knowledge & chat', chat]);
    if (smart) { const fast = by(ok.filter(m => m.best >= 0.6 * smart.best), m => -m.active); if (fast && fast !== smart) picks.push(['Lightest that is still capable', fast]); }
    $('#picks').innerHTML = picks.length ? picks.map(([t, m]) =>
      `<button class="pick" data-id="${m.id}"><small>${t}</small><b>${esc(m.name)}</b><div class="meta">Index ${m.best.toFixed(1)} · <span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span><br>${fmtB(m.total)} total · ${fmtB(m.active)} active · ${fmtGB(m.ev.total)}</div></button>`).join('')
      : '<p class="empty">No model in the current set runs usably on this hardware.</p>';
    $('#picks').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => { hl = b.dataset.id; drawQuad(); drawMain(); $('#quad').scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
  }

  // ---------------------------------------------------------------- hardware box
  const pill = (attr, val, label, pressed, extra = '') => `<button class="pill ${extra}" ${attr}="${val}" aria-pressed="${pressed}">${label}</button>`;
  function drawHw() {
    const h = state.hw, hw = hwNow(), q = quantNow();
    let rows = `<div class="hwrow"><span class="k">Hardware</span><div class="pills" id="pMode">${Hardware.MODES.map(([k, l]) => pill('data-v', k, l, h.mode === k)).join('')}</div></div>`;
    if (h.mode !== 'unified') {
      const last = Hardware.VRAM_SIZES[Hardware.VRAM_SIZES.length - 1];
      rows += `<div class="hwrow"><span class="k">Total VRAM</span><div class="pills" id="pVram">${Hardware.VRAM_SIZES.map(n => pill('data-v', n, n === last ? n + '+ GB' : n + ' GB', h.vram === n)).join('')}</div></div>`;
      rows += `<div class="hwrow"><span class="k">GPU family</span><div class="pills" id="pGpu">${Hardware.GPU_FAMILIES.map(([k, l]) => pill('data-v', k, l, h.gpu === k, k === 'rtx50' ? 'fp4' : '')).join('')}</div></div>`;
      if (h.mode === 'offload') rows += `<div class="hwrow"><span class="k">System RAM</span><div class="pills" id="pRam">${Hardware.RAM_SIZES.map(n => pill('data-v', n, n + ' GB', h.ram === n)).join('')}</div></div>`;
    } else {
      rows += `<div class="hwrow"><span class="k">Memory</span><div class="pills" id="pU">${Hardware.U_SIZES.map(n => pill('data-v', n, n + ' GB', h.uGB === n)).join('')}</div></div>`;
      rows += `<div class="hwrow"><span class="k">Memory speed</span><div class="pills" id="pUC">${Hardware.U_CLASSES.map(u => pill('data-v', u.id, u.label, h.uClass === u.id).replace('<button', `<button title="${esc(u.hint)} (~${u.bw} GB/s)"`)).join('')}</div></div>`;
    }
    const precNote = state.prec === 'q4' ? (hw.fp4 ? 'NVFP4: native 4-bit floats on this GPU' : 'GGUF Q4_K_M (no native FP4 on this GPU)') : q.label;
    rows += `<div class="hwrow"><span class="k">Precision</span><div class="pills" id="pPrec">${[['native', 'Unquantized'], ['q8', '8-bit'], ['q4', '4-bit'], ['q3', '3-bit']].map(([k, l]) => pill('data-v', k, l, state.prec === k)).join('')}<span class="note">${esc(precNote)}</span></div></div>`;
    rows += `<div class="hwsum"><span><b>${esc(hw.label)}</b></span><span>${fmtGB(hw.unified ? hw.usable : hw.vram)} ${hw.unified ? 'usable by GPU' : 'VRAM'}</span></div>`;
    rows += `<details class="adv"><summary>Advanced</summary><div class="row"><label class="tog">Headroom for context &amp; runtime <input type="range" id="hRes" min="1" max="32" value="${state.reserve}"> <b id="hResOut">${state.reserve} GB</b></label></div><div class="row"><label class="tog"><input type="checkbox" id="hSsd"${h.ssd ? ' checked' : ''}> Allow paging weights from an NVMe SSD (~6 GB/s, slow)</label></div></details>`;
    $('#hwbox').innerHTML = rows;
    const B = $('#hwbox'), on = (sel, fn) => B.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => fn(b)));
    on('#pMode .pill', b => { h.mode = b.dataset.v; changed({ hw: true }); });
    on('#pVram .pill', b => { h.vram = +b.dataset.v; changed({ hw: true }); });
    on('#pGpu .pill', b => { h.gpu = b.dataset.v; changed({ hw: true }); });
    on('#pRam .pill', b => { h.ram = +b.dataset.v; changed({ hw: true }); });
    on('#pU .pill', b => { h.uGB = +b.dataset.v; changed({ hw: true }); });
    on('#pUC .pill', b => { h.uClass = b.dataset.v; changed({ hw: true }); });
    on('#pPrec .pill', b => { state.prec = b.dataset.v; changed({ hw: true }); });
    const res = B.querySelector('#hRes'); res.addEventListener('input', () => { state.reserve = +res.value; $('#hResOut').textContent = state.reserve + ' GB'; changed({ controls: false }); });
    B.querySelector('#hSsd').addEventListener('change', e => { h.ssd = e.target.checked; changed(); });
  }

  // ---------------------------------------------------------------- model picker (AA-style checklist)
  const pp = () => $('#pickPanel');
  function openPicker() {
    const cur = new Set(inSet().map(m => m.id));
    // Featured (hand-curated, data/curated.json) first, in curated order; then everything else by lab, newest release first.
    const byId = Object.fromEntries(models.map(m => [m.id, m]));
    const featured = data.curated.map(g => ({ lab: g.lab, items: g.ids.map(i => byId[i]) }));
    const done = new Set(data.curated.flatMap(g => g.ids));
    const rest = {};
    for (const m of models) if (!done.has(m.id)) (rest[m.creator] = rest[m.creator] || []).push(m);
    const latest = l => Math.max(...rest[l].map(m => Date.parse(m.released || 0) || 0));
    const others = Object.keys(rest).sort((x, y) => latest(y) - latest(x)).map(l => ({ lab: l, items: rest[l].sort((x, y) => y.best - x.best) }));
    const section = (title, groups) => `<div class="sep">${title}</div>` + groups.map(g => `<div class="lab" data-lab="${esc(g.lab)}"><span>${esc(g.lab)}</span></div>` + g.items.map(m => `<label class="it" data-t="${esc((m.name + ' ' + m.creator).toLowerCase())}"><input type="checkbox" value="${m.id}"${cur.has(m.id) ? ' checked' : ''}> ${esc(m.name)}<span class="ix">${m.best.toFixed(1)}</span></label>`).join('')).join('');
    pp().innerHTML = `<div class="head"><input type="search" id="pkQ" placeholder="Search models or labs" aria-label="Search models"><button class="chip" id="pkAll">All shown</button><button class="chip" id="pkNone">None</button><button class="chip" id="pkReset">Reset to view</button><button class="chip" id="pkClose" aria-label="Close">✕</button></div>
      <div class="list">${section('Featured', featured)}${section('All other models · labs by newest release', others)}</div>`;
    pp().hidden = false; $('#pickBtn').setAttribute('aria-expanded', 'true');
    const P = pp(), boxes = () => [...P.querySelectorAll('input[type=checkbox]')];
    const commit = () => { state.pick = boxes().filter(b => b.checked).map(b => b.value); changed(); };
    P.onchange = commit;
    P.querySelector('#pkQ').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      P.querySelectorAll('label.it').forEach(l => { l.style.display = !q || l.dataset.t.includes(q) ? '' : 'none'; });
      P.querySelectorAll('.sep').forEach(s => { s.style.display = q ? 'none' : ''; });
      P.querySelectorAll('.lab').forEach(l => { let n = l.nextElementSibling, any = false; while (n && n.classList.contains('it')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; } l.style.display = any ? '' : 'none'; });
    });
    const visible = () => boxes().filter(b => b.closest('label').style.display !== 'none');
    P.querySelector('#pkAll').addEventListener('click', () => { visible().forEach(b => { b.checked = true; }); commit(); });
    P.querySelector('#pkNone').addEventListener('click', () => { boxes().forEach(b => { b.checked = false; }); commit(); });
    P.querySelector('#pkReset').addEventListener('click', () => { state.pick = null; closePicker(); changed(); });
    P.querySelector('#pkClose').addEventListener('click', closePicker);
    P.querySelector('#pkQ').focus();
  }
  function closePicker() { pp().hidden = true; $('#pickBtn').setAttribute('aria-expanded', 'false'); }
  $('#pickBtn').addEventListener('click', () => (pp().hidden ? openPicker() : closePicker()));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
  document.addEventListener('click', e => { if (!pp().hidden && !e.target.closest('#setbar')) closePicker(); });

  // ---------------------------------------------------------------- table
  let sort = { k: 'best', dir: -1 };
  function drawTable() {
    const set = inSet();
    const f = state.filter.trim().toLowerCase(), q = quantNow();
    const cols = [
      ['name', 'Model', m => m.name, m => `<a href="${aaUrl(m)}" target="_blank" rel="noopener">${esc(m.name)}</a>`], ['creator', 'Lab', m => m.creator, m => esc(m.creator)],
      ['best', 'Index', m => m.best, m => m.best.toFixed(1)], ['total', 'Total', m => m.total, m => fmtB(m.total)], ['active', 'Active', m => m.active, m => fmtB(m.active)],
      ['lookup', 'Lookup', m => m.lookup, m => (m.lookup ? fmtB(m.lookup) : '—')], ['gb', 'Weights @ ' + q.label, m => m.ev.total, m => fmtGB(m.ev.total)],
      ['fit', 'On your hardware', m => ({ fit: 3, offload: 2, ssd: 1, none: 0 }[m.ev.cls]), m => `<span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span>`],
      ['links', 'Links', null, m => `<a href="${aaUrl(m)}" target="_blank" rel="noopener">AA</a>` + (m.repo ? ` · <a href="https://huggingface.co/${m.repo}" target="_blank" rel="noopener">HF</a>` : '')],
    ];
    const col = cols.find(c => c[0] === sort.k && c[2]) || cols[2];
    const rows = set.filter(m => !f || (m.name + ' ' + m.creator).toLowerCase().includes(f)).sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    $('#table').innerHTML = `<thead><tr>${cols.map(c => `<th class="${c[0] === 'name' || c[0] === 'creator' ? 'l' : ''}" ${c[2] ? `data-k="${c[0]}"` : ''}${sort.k === c[0] ? ` aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c[1]}${sort.k === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(m => `<tr>${cols.map((c, i) => `<td class="${i === 0 ? 'name l' : i === 1 ? 'l' : ''}">${c[3](m)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#table').querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; sort = { k, dir: sort.k === k ? -sort.dir : (k === 'name' || k === 'creator' ? 1 : -1) }; drawTable(); }));
  }

  // ---------------------------------------------------------------- controls
  function seg(el, items, get, set) {
    el.innerHTML = items.map(([v, l]) => `<button aria-pressed="${get() === v}" data-v="${v}">${l}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); changed(); }));
  }
  function drawControls() {
    const modes = [['curated', 'Featured'], ['recent', 'Recent'], ['featured', 'AA picks'], ['all', 'All']];
    if (state.pick) modes.push(['custom', `Custom (${state.pick.length})`]);
    seg($('#setmode'), modes, () => (state.pick ? 'custom' : state.set.mode), v => { if (v !== 'custom') { state.pick = null; state.set.mode = v; } });
    seg($('#xmode'), [['total', 'Total params'], ['active', 'Active params']], () => state.x, v => { state.x = v; });
    seg($('#xscale'), [['log', 'Log'], ['linear', 'Linear']], () => state.xscale, v => { state.xscale = v; });
    const m = $('#months'); m.value = state.set.months; $('#monthsOut').textContent = state.set.months + (state.set.months === 1 ? ' month' : ' months');
    m.oninput = () => { state.set.months = +m.value; $('#monthsOut').textContent = m.value + (m.value === '1' ? ' month' : ' months'); changed({ controls: false }); };
    $('#monthsWrap').style.display = !state.pick && state.set.mode === 'recent' ? '' : 'none';
    drawProp();
    $('#q').oninput = e => { state.filter = e.target.value; drawMain(); drawTable(); };
    $('#q').value = state.filter;
  }

  /** Persist and redraw. hw: also rebuild the hardware box; controls: false while dragging a slider (keeps focus). */
  function changed({ hw = false, controls = true } = {}) {
    save();
    if (controls) drawControls();
    if (hw) drawHw();
    drawAll();
  }
  function drawAll() { evalAll(models); drawMain(); drawQuad(); drawPicks(); drawTable(); }

  $('#theme').addEventListener('click', () => {
    const root = document.documentElement, dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* ignore */ }
    drawAll();  // chart colours are read from CSS variables
  });
  // Charts are drawn at pixel width, so redraw when the width (not the height) changes.
  let rt, lastW = 0;
  new ResizeObserver(([e]) => {
    if (Math.abs(e.contentRect.width - lastW) < 1) return;
    lastW = e.contentRect.width; clearTimeout(rt); rt = setTimeout(() => { drawMain(); drawQuad(); }, 80);
  }).observe(document.querySelector('main'));

  drawControls(); drawHw(); drawAll();
  })();
