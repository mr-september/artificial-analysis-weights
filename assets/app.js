/* UI: intelligence-vs-weights chart, model picker, hardware box, fit/speed quadrant, picks, table. No build step. */
(async function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- state
  const DEFAULT = {
    set: { mode: 'recent', months: 6 }, pick: null, x: 'total', xscale: 'log', prec: 'q4', yaxis: 'aa', minspeed: 3, reserve: 4, filter: '', showProp: false,
    hw: { mode: 'offload', series: 'rtx4000', vram: 24, n: 1, ram: 64, uGB: 64, uClass: 'fast', ssd: false },
  };
  const merge = (a, b) => ({ ...a, ...b, set: { ...a.set, ...b.set }, hw: { ...a.hw, ...b.hw } });
  let state = JSON.parse(JSON.stringify(DEFAULT));
  try { const s = JSON.parse(localStorage.getItem('aaw-state-v2') || 'null'); if (s) state = merge(state, s); } catch (e) { /* private mode */ }
  try { const u = new URLSearchParams(location.search).get('state'); if (u) state = merge(state, JSON.parse(u)); } catch (e) { /* bad share link */ }
  const save = () => { try { localStorage.setItem('aaw-state-v2', JSON.stringify(state)); } catch (e) { /* ignore */ } };

  let data;
  try { data = await (await fetch('data/models.json')).json(); }
  catch (e) { $('#chart').insertAdjacentHTML('beforeend', '<p class="empty">Could not load data/models.json. If you opened this file directly, serve the folder over HTTP.</p>'); return; }
  const models = data.models;
  Core.addLean(models);
  for (const m of models) {
    m.cls = m.lookup ? 'lookup' : m.arch.startsWith('moe') ? 'moe' : 'dense';
    m.tpsAA = (m.variants.find(v => v.tps) || {}).tps ?? null;
    m.slug = m.variants[0].slug;
  }
  $('#updated').textContent = `Data refreshed ${data.generated.slice(0, 10)}.`;

  // ---------------------------------------------------------------- helpers
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colorOf = m => css('--' + m.cls);
  const fmtB = v => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'T' : v >= 100 ? Math.round(v) + 'B' : v >= 10 ? +v.toFixed(1) + 'B' : +v.toFixed(2) + 'B');
  const fmtGB = v => (v >= 1000 ? (v / 1000).toFixed(1) + ' TB' : v >= 100 ? Math.round(v) + ' GB' : +v.toFixed(1) + ' GB');
  const fmtT = v => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1));
  const CLS_SHORT = { fit: 'fits', offload: 'RAM offload', ssd: 'SSD paging', none: 'no fit' };

  function logTicks(a, b) {
    const out = [];
    for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= a && v <= b) out.push(v); }
    return out;
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
  const bestProp = () => data.proprietary[0] || null;
  /** Frontier proprietary models: best per lab within the recent window, top 8. */
  function propSet() {
    const months = state.set.mode === 'recent' ? state.set.months : 12, cut = Date.now() - months * 30.44 * 864e5, byLab = {};
    for (const p of data.proprietary) if (p.released && Date.parse(p.released) >= cut && (!byLab[p.creator] || p.best > byLab[p.creator].best)) byLab[p.creator] = p;
    return Object.values(byLab).sort((a, b) => b.best - a.best).slice(0, 8);
  }

  // ---------------------------------------------------------------- generic scatter
  function scatter(el, c) {
    const W = Math.max(320, el.clientWidth), H = c.height(W);
    const M = { l: c.bare ? 14 : 48, r: 16, t: 12, b: c.bare ? 34 : 44 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const sx = c.xlog ? v => M.l + (Math.log(v / c.x0) / Math.log(c.x1 / c.x0)) * iw : v => M.l + ((v - c.x0) / (c.x1 - c.x0)) * iw;
    const sy = v => M.t + ih - ((v - c.y0) / (c.y1 - c.y0)) * ih;
    const pts = c.pts.map(p => ({ ...p, px: sx(p.x), py: sy(p.y) }));
    let g = '';
    if (!c.bare) {
      for (const t of c.xTicks) g += `<line class="gridline" x1="${sx(t)}" x2="${sx(t)}" y1="${M.t}" y2="${M.t + ih}"/><text x="${sx(t)}" y="${M.t + ih + 16}" text-anchor="middle">${c.xFmt(t)}</text>`;
      for (const t of c.yTicks) g += `<line class="gridline" x1="${M.l}" x2="${M.l + iw}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${M.l - 8}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`;
      g += `<line class="axisline" x1="${M.l}" x2="${M.l + iw}" y1="${M.t + ih}" y2="${M.t + ih}"/><line class="axisline" x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + ih}"/>`;
      g += `<text class="axtitle" x="${M.l + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(c.xTitle)}</text>`;
      g += `<text class="axtitle" transform="translate(13 ${M.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(c.yTitle)}</text>`;
    }
    if (c.under) g += c.under({ sx, sy, M, iw, ih, W, H });
    if (c.frontier) {
      const f = Core.frontier(pts.map(p => ({ x: p.x, y: p.y, px: p.px, py: p.py })));
      if (f.length > 1) g += `<path class="front" d="${f.map((p, i) => (i ? 'L' : 'M') + p.px.toFixed(1) + ' ' + p.py.toFixed(1)).join('')}"/>`;
    }
    // faded points first so live ones stay on top
    const order = pts.map((p, i) => i).sort((a, b) => (pts[b].faded ? 1 : 0) - (pts[a].faded ? 1 : 0));
    for (const i of order) {
      const p = pts[i], col = p.color, r = p.r || 5.5;
      g += `<g class="pt${p.faded ? ' faded' : ''}" data-i="${i}">` +
        (p.hl ? `<circle cx="${p.px}" cy="${p.py}" r="${r + 5}" fill="none" stroke="var(--brand)" stroke-width="2"/>` : '') +
        `<circle cx="${p.px}" cy="${p.py}" r="${r}" fill="${p.hollow ? 'var(--card)' : col}" fill-opacity="${p.hollow ? 1 : .86}" stroke="${col}" stroke-width="${p.hollow ? 1.8 : 1}" ${p.hollow ? 'stroke-dasharray="3 2"' : ''}/></g>`;
    }
    // labels: greedy, priority-ordered, avoiding earlier labels and every point
    const boxes = [], placed = [];
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const cand = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.label && !p.faded).sort((a, b) => b.p.label - a.p.label);
    for (const { p } of cand.slice(0, c.maxLabels || 40)) {
      const w = p.name.length * 5.7 + 4, h = 13, r = (p.r || 5.5) + 3;
      for (const [dx, dy, anchor] of [[r, 4, 'start'], [-r, 4, 'end'], [0, -r - 2, 'middle'], [0, r + 11, 'middle']]) {
        const x = anchor === 'start' ? p.px + dx : anchor === 'end' ? p.px + dx - w : p.px - w / 2;
        const b = { x, y: p.py + dy - 10, w, h };
        if (b.x < M.l - 4 || b.x + w > W - 2 || b.y < 0 || b.y + h > H - M.b + 14) continue;
        if (boxes.some(o => hit(b, o))) continue;
        if (pts.some(q => q !== p && !q.faded && hit(b, { x: q.px - 5, y: q.py - 5, w: 10, h: 10 }))) continue;
        boxes.push(b); placed.push(`<text class="plabel" x="${p.px + dx}" y="${p.py + dy}" text-anchor="${anchor}">${esc(p.name)}</text>`); break;
      }
    }
    g += placed.join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.aria)}">${g}</svg><div class="tip" hidden></div>`;

    // hover / pin
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
    const show = (p, pinned) => {
      tip.innerHTML = c.tip(p.m); tip.hidden = false; tip.classList.toggle('pinned', !!pinned);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = p.px + 14; const y = p.py - th / 2;
      if (x + tw > W) x = p.px - tw - 14;
      tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.min(Math.max(0, y), H - th) + 'px';
    };
    const nearest = ev => {
      const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * (W / r.width), my = (ev.clientY - r.top) * (H / r.height);
      let best = null, bd = 18 * 18;
      for (const p of pts) { const d = (p.px - mx) ** 2 + (p.py - my) ** 2; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    let pinned = null;
    svg.addEventListener('mousemove', ev => { if (pinned) return; const p = nearest(ev); if (p) show(p); else tip.hidden = true; });
    svg.addEventListener('mouseleave', () => { if (!pinned) tip.hidden = true; });
    svg.addEventListener('click', ev => {
      const p = nearest(ev);
      if (p && p !== pinned) { pinned = p; show(p, true); state.hl = p.m.id; } else { pinned = null; tip.hidden = true; tip.classList.remove('pinned'); state.hl = null; }
    });
  }

  const aaLink = m => `<a href="https://artificialanalysis.ai/models/${m.slug}" target="_blank" rel="noopener">Artificial Analysis ↗</a>`;
  function tipHTML(m, withHw = true) {
    if (m.prop) return `<h4>${esc(m.name)}</h4><div class="by">${esc(m.creator)}${m.released ? ' · ' + m.released : ''} · proprietary</div><dl><dt>Intelligence</dt><dd>${m.best.toFixed(1)}</dd><dt>Parameters</dt><dd>not published</dd></dl><div class="links">${aaLink(m)}</div>`;
    const e = m.ev, q = quantNow(), gb = m.total * Core.gbPerB(m, q);
    const idx = m.best.toFixed(1) + (m.variants[0].estimated ? ' (AA est.)' : '');
    const params = `${fmtB(m.total)} total · ${fmtB(m.active)} active` + (m.lookup ? ` · ${fmtB(m.lookup)} lookup` : '');
    const rows = [['Intelligence', idx], ['Parameters', params], [`Weights @ ${q.label}`, fmtGB(gb)]];
    if (withHw) rows.push(['On your hardware', e ? `<span class="badge ${e.cls}">${CLS_SHORT[e.cls]}</span>${e.cls !== 'none' ? ' ~' + fmtT(e.tps) + ' tok/s' : ''}` : '—']);
    rows.push(['AA measured speed', m.tpsAA ? fmtT(m.tpsAA) + ' tok/s' : 'n/a']);
    if (withHw && m.lean != null) rows.push(['Lean', (m.lean > 0.12 ? 'coding / agents' : m.lean < -0.12 ? 'knowledge / chat' : 'balanced') + ` (${m.lean > 0 ? '+' : ''}${m.lean.toFixed(2)})`]);
    const links = `<div class="links">${aaLink(m)}` + (m.repo ? `<a href="https://huggingface.co/${m.repo}" target="_blank" rel="noopener">Hugging Face ↗</a>` : '') + '</div>';
    const note = m.notes.length ? `<div class="note">${esc(m.notes[0])}</div>` : '';
    return `<h4>${esc(m.name)}</h4><div class="by">${esc(m.creator)}${m.released ? ' · ' + m.released : ''}${m.license ? ' · ' + esc(m.license) : ''}</div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note}${links}`;
  }

  // ---------------------------------------------------------------- main chart
  function drawMain() {
    const set = inSet(); evalAll(set);
    const f = state.filter.trim().toLowerCase();
    const xv = m => (state.x === 'active' ? m.active : m.total);
    const pts = set.map(m => ({ x: xv(m), y: m.best, m, color: colorOf(m), hollow: m.variants[0].estimated, hl: state.hl === m.id }));
    const log = state.xscale === 'log';
    $('#setcount').textContent = state.pick ? `${set.length} chosen` : `${set.length} of ${models.length} open models`;
    $('#chartSub').textContent = `${state.x === 'active' ? 'Active' : 'Total'} parameters against the Intelligence Index (best reasoning setting per model). Dashed line: frontier.`;
    if (!pts.length) { $('#main').innerHTML = '<p class="empty">No models match this view. Widen the model set above.</p>'; return; }
    const xmax = Math.max(...pts.map(p => p.x)), xmin = Math.min(...pts.map(p => p.x));
    const top = bestProp();
    let x0 = log ? xmin / 1.5 : 0, x1 = xmax * (log ? 1.6 : 1.06), uX = null;
    if (state.showProp) {
      uX = xmax * (log ? 2.6 : 1.14); x1 = uX * (log ? 1.45 : 1.05);
      for (const p of propSet()) pts.push({ x: uX, y: p.best, m: { ...p, prop: true }, color: css('--axis'), hollow: false, hl: false, r: 5.5 });
    }
    const rankIdx = Core.ranks(pts.map(p => p.y));
    const fr = new Set(Core.frontier(pts).map(p => p.m.id));
    pts.forEach((p, i) => { p.name = p.m.name; p.label = (fr.has(p.m.id) ? 2 : 0) + rankIdx[i] + (p.m.prop ? 1 : 0); p.faded = !!f && !p.m.prop && !(p.m.name + ' ' + p.m.creator).toLowerCase().includes(f); });
    const ys = pts.map(p => p.y).concat(!state.showProp && top ? [top.best] : []);
    const y0 = Math.max(0, Math.floor((Math.min(...ys) - 3) / 5) * 5), y1 = Math.ceil((Math.max(...ys) + 3) / 5) * 5;
    const xt = (log ? logTicks(x0, x1) : linTicks(x0, x1)).filter(t => uX == null || t <= xmax * 1.25);
    scatter($('#main'), {
      pts, xlog: log, x0, x1, y0, y1, xTicks: xt, yTicks: linTicks(y0, y1, 6), xFmt: fmtB,
      xTitle: `${state.x === 'active' ? 'Active' : 'Total'} parameters (billions, ${log ? 'log' : 'linear'} scale)`, yTitle: 'Artificial Analysis Intelligence Index',
      height: W => Math.round(Math.min(560, Math.max(360, W * 0.56))), frontier: true, tip: m => tipHTML(m, false), aria: 'Scatter plot of intelligence index versus parameter count',
      under: ctx => {
        if (state.showProp) {
          const mid = log ? Math.sqrt(xmax * 1.25 * uX / 1.3) : (xmax + uX) / 2, L = ctx.sx(mid);
          return `<rect class="undisc" x="${L}" y="${ctx.M.t}" width="${ctx.M.l + ctx.iw - L}" height="${ctx.ih}" rx="6"/><text class="undisc-l" x="${(L + ctx.M.l + ctx.iw) / 2}" y="${ctx.M.t + ctx.ih + 16}" text-anchor="middle">size undisclosed</text>`;
        }
        if (top) { const y = ctx.sy(top.best); return `<line class="front" x1="${ctx.M.l}" x2="${ctx.M.l + ctx.iw}" y1="${y}" y2="${y}"/><text class="undisc-l" x="${ctx.M.l + ctx.iw}" y="${y - 6}" text-anchor="end">best proprietary: ${esc(top.name)} · ${top.best.toFixed(1)}</text>`; }
        return '';
      },
    });
    $('#mainLegend').innerHTML = `<span><i class="dot" style="background:var(--dense)"></i>Dense</span><span><i class="dot" style="background:var(--moe)"></i>Mixture of experts</span><span><i class="dot" style="background:var(--lookup)"></i>Has lookup tables</span><span><i class="dot hollow" style="color:var(--muted)"></i>Score estimated by AA</span>` + (state.showProp ? `<span><i class="dot" style="background:var(--axis)"></i>Proprietary</span>` : '');
  }

  // ---------------------------------------------------------------- quadrant
  function quadPoints() {
    const set = inSet(); evalAll(set);
    const fits = set.filter(m => m.ev.cls !== 'none' && m.ev.tps >= state.minspeed && m.lean != null);
    const useAA = state.yaxis === 'aa';
    const speed = m => (useAA ? m.tpsAA : m.ev.tps);
    const rows = fits.filter(m => speed(m));
    const ri = Core.ranks(rows.map(m => m.best)), rs = Core.ranks(rows.map(m => Math.log(speed(m))));
    return { rows, y: rows.map((m, i) => ri[i] - rs[i]), noAA: fits.length - rows.length };
  }

  function drawQuad() {
    const el = $('#quad'), Q = quadPoints();
    $('#quadLegend').innerHTML = `<span><i class="dot" style="background:var(--dense)"></i>Dense</span><span><i class="dot" style="background:var(--moe)"></i>MoE</span><span><i class="dot" style="background:var(--lookup)"></i>Lookup tables</span><span>${Q.rows.length} models shown` + (state.yaxis === 'aa' && Q.noAA ? `; ${Q.noAA} more fit but have no AA speed (try "Estimated")` : '') + `</span>`;
    if (!Q.rows.length) { el.innerHTML = `<p class="empty">Nothing fits with these settings. Try 3-bit, more memory, SSD paging (under Advanced), a lower minimum speed, or a wider model set.</p>`; return; }
    const pts = Q.rows.map((m, i) => ({ x: m.lean, y: Q.y[i], m, color: colorOf(m), hollow: m.variants[0].estimated, hl: state.hl === m.id, name: m.name, r: 5 + Math.min(4, Math.log10(1 + m.total) * 1.1), label: m.best }));
    scatter(el, {
      pts, bare: true, xlog: false, x0: -0.75, x1: 0.75, y0: -1.1, y1: 1.1, tip: m => tipHTML(m, true), aria: 'Quadrant chart of coding-versus-knowledge lean against speed-versus-intelligence', maxLabels: 28,
      height: W => Math.round(Math.min(560, Math.max(380, W * 0.6))),
      under: ({ sx, sy, M, iw, ih }) => {
        const cx = sx(0), cy = sy(0), l = M.l, r = M.l + iw, t = M.t, b = M.t + ih;
        return `<rect x="${l}" y="${t}" width="${iw}" height="${ih}" fill="none" stroke="var(--border)"/>` +
          `<line class="axisline" x1="${cx}" x2="${cx}" y1="${t}" y2="${b}" stroke-dasharray="4 4"/><line class="axisline" x1="${l}" x2="${r}" y1="${cy}" y2="${cy}" stroke-dasharray="4 4"/>` +
          `<text class="quad" x="${l + 10}" y="${t + 18}">Brainy generalists</text><text class="quad" x="${r - 10}" y="${t + 18}" text-anchor="end">Smart coders &amp; agents</text>` +
          `<text class="quad" x="${l + 10}" y="${b - 10}">Quick chat</text><text class="quad" x="${r - 10}" y="${b - 10}" text-anchor="end">Quick coders</text>` +
          `<text class="axtitle" x="${l}" y="${b + 24}">← knowledge &amp; chat</text><text class="axtitle" x="${r}" y="${b + 24}" text-anchor="end">coding &amp; agents →</text>` +
          `<text class="axtitle" x="${cx}" y="${b + 24}" text-anchor="middle" style="fill:var(--muted);font-weight:400">relative strength</text>` +
          `<text class="axtitle" transform="translate(${l - 3} ${cy}) rotate(-90)" text-anchor="middle" style="fill:var(--muted);font-weight:400">${state.yaxis === 'aa' ? 'smarter ↑ · faster ↓ (AA measured speed)' : 'smarter ↑ · faster ↓ (estimated speed)'}</text>`;
      },
    });
  }

  // ---------------------------------------------------------------- picks
  function drawPicks() {
    const set = inSet(); evalAll(set);
    const ok = set.filter(m => m.ev.cls !== 'none' && m.ev.tps >= state.minspeed);
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
    if (smart) { const fast = by(ok.filter(m => m.best >= 0.6 * smart.best), m => m.ev.tps); if (fast && fast !== smart) picks.push(['Fastest that is still capable', fast]); }
    $('#picks').innerHTML = picks.length ? picks.map(([t, m]) =>
      `<button class="pick" data-id="${m.id}"><small>${t}</small><b>${esc(m.name)}</b><div class="meta">Index ${m.best.toFixed(1)} · <span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span> · ~${fmtT(m.ev.tps)} tok/s<br>${fmtB(m.total)} total · ${fmtB(m.active)} active · ${fmtGB(m.ev.total)}</div></button>`).join('')
      : '<p class="empty" style="grid-column:1/-1">No model meets the speed floor on this hardware in the current model set.</p>';
    $('#picks').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => { state.hl = b.dataset.id; drawQuad(); drawMain(); $('#quad').scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
  }

  // ---------------------------------------------------------------- hardware box
  const pill = (attr, val, label, pressed, extra = '') => `<button class="pill ${extra}" ${attr}="${val}" aria-pressed="${pressed}">${label}</button>`;
  function drawHw() {
    const h = state.hw, sr = Hardware.series(h.series), hw = hwNow(), q = quantNow();
    let rows = `<div class="hwrow"><span class="k">Hardware</span><div class="pills" id="pMode">${Hardware.MODES.map(([k, l]) => pill('data-v', k, l, h.mode === k)).join('')}</div></div>`;
    if (h.mode !== 'unified') {
      rows += `<div class="hwrow"><span class="k">GPU</span><div class="pills" id="pSeries">${Hardware.SERIES.map(s => pill('data-v', s.id, s.label + (s.fp4 ? '<small>FP4</small>' : ''), h.series === s.id, s.fp4 ? 'fp4' : '')).join('')}</div></div>`;
      rows += `<div class="hwrow"><span class="k">VRAM</span><div class="pills" id="pVram">${sr.cards.map(k => pill('data-v', k.gb, k.gb + ' GB', k.gb === hw.vram / h.n)).join('')}<span style="width:8px"></span>${Hardware.COUNTS.map(n => pill('data-n', n, '×' + n, h.n === n)).join('')}</div></div>`;
      if (h.mode === 'offload') rows += `<div class="hwrow"><span class="k">System RAM</span><div class="pills" id="pRam">${Hardware.RAM_SIZES.map(n => pill('data-v', n, n + ' GB', h.ram === n)).join('')}</div></div>`;
    } else {
      rows += `<div class="hwrow"><span class="k">Memory</span><div class="pills" id="pU">${Hardware.U_SIZES.map(n => pill('data-v', n, n + ' GB', h.uGB === n)).join('')}</div></div>`;
      rows += `<div class="hwrow"><span class="k">Memory speed</span><div class="pills" id="pUC">${Hardware.U_CLASSES.map(u => pill('data-v', u.id, u.label, h.uClass === u.id).replace('<button', `<button title="${esc(u.hint)} (~${u.bw} GB/s)"`)).join('')}</div></div>`;
    }
    const precNote = state.prec === 'q4' ? (hw.fp4 ? 'NVFP4: native 4-bit floats on this GPU' : 'GGUF Q4_K_M (this GPU has no native FP4)') : q.label;
    rows += `<div class="hwrow"><span class="k">Precision</span><div class="pills" id="pPrec">${[['native', 'As released'], ['q8', '8-bit'], ['q4', '4-bit'], ['q3', '3-bit']].map(([k, l]) => pill('data-v', k, l, state.prec === k)).join('')}<span class="note" style="align-self:center;margin-left:6px">${esc(precNote)}</span></div></div>`;
    rows += `<div class="hwsum"><span><b>${esc(hw.label)}</b></span><span>${fmtGB(hw.unified ? hw.usable : hw.vram)} ${hw.unified ? 'usable by GPU' : 'VRAM'}</span><span>~${Math.round(hw.bwV)} GB/s</span></div>`;
    rows += `<details class="adv"><summary>Advanced</summary><div class="row"><label class="tog">Headroom for context &amp; runtime <input type="range" id="hRes" min="1" max="32" value="${state.reserve}"> <b id="hResOut">${state.reserve} GB</b></label></div><div class="row"><label class="tog"><input type="checkbox" id="hSsd"${h.ssd ? ' checked' : ''}> Allow paging weights from an NVMe SSD (~6 GB/s, slow)</label></div></details>`;
    $('#hwbox').innerHTML = rows;
    const B = $('#hwbox'), on = (sel, fn) => B.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => fn(b)));
    on('#pMode .pill', b => { h.mode = b.dataset.v; changed(true); });
    on('#pSeries .pill', b => { h.series = b.dataset.v; h.vram = Hardware.nearestCard(Hardware.series(h.series), h.vram).gb; changed(true); });
    on('#pVram .pill[data-v]', b => { h.vram = +b.dataset.v; changed(true); });
    on('#pVram .pill[data-n]', b => { h.n = +b.dataset.n; changed(true); });
    on('#pRam .pill', b => { h.ram = +b.dataset.v; changed(true); });
    on('#pU .pill', b => { h.uGB = +b.dataset.v; changed(true); });
    on('#pUC .pill', b => { h.uClass = b.dataset.v; changed(true); });
    on('#pPrec .pill', b => { state.prec = b.dataset.v; changed(true); });
    const res = B.querySelector('#hRes'); res.addEventListener('input', () => { state.reserve = +res.value; $('#hResOut').textContent = state.reserve + ' GB'; changed(false, true); });
    B.querySelector('#hSsd').addEventListener('change', e => { h.ssd = e.target.checked; changed(); });
  }

  // ---------------------------------------------------------------- model picker (AA-style checklist)
  const pp = () => $('#pickPanel');
  function openPicker() {
    const cur = new Set(inSet().map(m => m.id));
    const labs = {};
    for (const m of models) (labs[m.creator] = labs[m.creator] || []).push(m);
    const order = Object.keys(labs).sort((a, b) => a.localeCompare(b));
    pp().innerHTML = `<div class="head"><input type="search" id="pkQ" placeholder="Search models or labs" aria-label="Search models"><button class="chip" id="pkAll">All shown</button><button class="chip" id="pkNone">None</button><button class="chip" id="pkReset">Reset to view</button><button class="chip" id="pkClose" aria-label="Close">✕</button></div>
      <div class="list">${order.map(l => `<div class="lab" data-lab="${esc(l)}"><span>${esc(l)}</span></div>` + labs[l].sort((a, b) => b.best - a.best).map(m => `<label class="it" data-t="${esc((m.name + ' ' + m.creator).toLowerCase())}"><input type="checkbox" value="${m.id}"${cur.has(m.id) ? ' checked' : ''}> ${esc(m.name)}<span class="ix">${m.best.toFixed(1)}</span></label>`).join('')).join('')}</div>`;
    pp().hidden = false; $('#pickBtn').setAttribute('aria-expanded', 'true');
    const P = pp(), boxes = () => [...P.querySelectorAll('input[type=checkbox]')];
    const commit = () => { state.pick = boxes().filter(b => b.checked).map(b => b.value); changed(false, true, true); };
    P.onchange = commit;
    P.querySelector('#pkQ').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      P.querySelectorAll('label.it').forEach(l => { l.style.display = !q || l.dataset.t.includes(q) ? '' : 'none'; });
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
    const set = inSet(); evalAll(set);
    const f = state.filter.trim().toLowerCase(), q = quantNow();
    const cols = [
      ['name', 'Model', m => m.name, m => esc(m.name)], ['creator', 'Lab', m => m.creator, m => esc(m.creator)],
      ['best', 'Index', m => m.best, m => m.best.toFixed(1)], ['total', 'Total', m => m.total, m => fmtB(m.total)], ['active', 'Active', m => m.active, m => fmtB(m.active)],
      ['lookup', 'Lookup', m => m.lookup, m => (m.lookup ? fmtB(m.lookup) : '—')], ['gb', 'Weights @ ' + q.label, m => m.ev.total, m => fmtGB(m.ev.total)],
      ['fit', 'On your hardware', m => ({ fit: 3, offload: 2, ssd: 1, none: 0 }[m.ev.cls]), m => `<span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span>`],
      ['tps', 'Est. tok/s', m => m.ev.tps || 0, m => (m.ev.cls === 'none' ? '—' : fmtT(m.ev.tps))], ['aa', 'AA tok/s', m => m.tpsAA || 0, m => (m.tpsAA ? fmtT(m.tpsAA) : '—')],
    ];
    const col = cols.find(c => c[0] === sort.k) || cols[2];
    const rows = set.filter(m => !f || (m.name + ' ' + m.creator).toLowerCase().includes(f)).sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    $('#table').innerHTML = `<thead><tr>${cols.map(c => `<th class="${c[0] === 'name' || c[0] === 'creator' ? 'l' : ''}" data-k="${c[0]}"${sort.k === c[0] ? ` aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c[1]}${sort.k === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(m => `<tr>${cols.map((c, i) => `<td class="${i === 0 ? 'name l' : i === 1 ? 'l' : ''}">${c[3](m)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#table').querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; sort = { k, dir: sort.k === k ? -sort.dir : (k === 'name' || k === 'creator' ? 1 : -1) }; drawTable(); }));
  }

  // ---------------------------------------------------------------- controls
  function seg(el, items, get, set) {
    el.innerHTML = items.map(([v, l]) => `<button aria-pressed="${get() === v}" data-v="${v}">${l}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); changed(); }));
  }
  function drawControls() {
    const modes = [['recent', 'Recent'], ['featured', 'AA picks'], ['latest', 'Latest per lab'], ['all', 'All']];
    if (state.pick) modes.push(['custom', `Custom (${state.pick.length})`]);
    seg($('#setmode'), modes, () => (state.pick ? 'custom' : state.set.mode), v => { if (v !== 'custom') { state.pick = null; state.set.mode = v; } });
    seg($('#xmode'), [['total', 'Total params'], ['active', 'Active params']], () => state.x, v => { state.x = v; });
    seg($('#xscale'), [['log', 'Log'], ['linear', 'Linear']], () => state.xscale, v => { state.xscale = v; });
    seg($('#yaxis'), [['aa', 'AA measured speed'], ['est', 'Estimated on my hardware']], () => state.yaxis, v => { state.yaxis = v; });
    const m = $('#months'); m.value = state.set.months; $('#monthsOut').textContent = state.set.months + (state.set.months === 1 ? ' month' : ' months');
    m.oninput = () => { state.set.months = +m.value; $('#monthsOut').textContent = m.value + (m.value === '1' ? ' month' : ' months'); changed(false, true); };
    $('#monthsWrap').style.display = !state.pick && state.set.mode === 'recent' ? '' : 'none';
    $('#minspeed').value = String(state.minspeed);
    $('#minspeed').onchange = e => { state.minspeed = +e.target.value; changed(); };
    $('#showProp').checked = state.showProp;
    $('#showProp').onchange = e => { state.showProp = e.target.checked; changed(); };
    $('#q').oninput = e => { state.filter = e.target.value; drawMain(); drawTable(); };
    $('#q').value = state.filter;
  }

  /** rebuildHw: redraw the hardware box; light: skip the control redraw (sliders); keepPicker: still refresh the set-mode pills */
  function changed(rebuildHw, light, keepPicker) {
    save();
    if (!light || keepPicker) drawControls();
    if (rebuildHw) drawHw();
    drawAll();
  }
  function drawAll() { drawMain(); drawQuad(); drawPicks(); drawTable(); }

  $('#theme').addEventListener('click', () => {
    const d = document.documentElement, next = (d.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark';
    d.dataset.theme = next; try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    drawAll();
  });
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { drawMain(); drawQuad(); }, 80); }).observe(document.querySelector('main'));

  drawControls(); drawHw(); drawAll();
  window.__aaw = { state, models, Core, Hardware };   // handy for debugging in the console
})();
