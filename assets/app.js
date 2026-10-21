/* UI: two charts (intelligence vs weights; fit-and-speed quadrant), hardware picker, picks, table. No build step. */
(async function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- state
  const DEFAULT = {
    set: { mode: 'recent', months: 6 }, x: 'total', xscale: 'log', q: 'q4', yaxis: 'aa', minspeed: 3, reserve: 4, filter: '',
    hw: { kind: 'gpu', gpu: 'rtx4090', n: 1, ram: 64, ramType: 'ddr5', ssd: false, chip: 'm4max', uGB: 128, vram: 8, bw: 300 },
  };
  let state = JSON.parse(JSON.stringify(DEFAULT));
  try { const s = JSON.parse(localStorage.getItem('aaw-state') || 'null'); if (s) state = { ...state, ...s, set: { ...state.set, ...s.set }, hw: { ...state.hw, ...s.hw } }; } catch (e) { /* private mode */ }
  try { const u = new URLSearchParams(location.search).get('state'); if (u) { const s = JSON.parse(u); state = { ...state, ...s, set: { ...state.set, ...s.set }, hw: { ...state.hw, ...s.hw } }; } } catch (e) { /* bad share link */ }
  const save = () => { try { localStorage.setItem('aaw-state', JSON.stringify(state)); } catch (e) { /* ignore */ } };

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
  const CLS_LABEL = { fit: 'Fits in fast memory', offload: 'Offloads to RAM', ssd: 'Pages from SSD', none: "Doesn't fit" };
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
  const evalOpts = () => ({ q: Core.quant(state.q), reserve: state.reserve });
  const evalAll = list => { const hw = hwNow(), o = evalOpts(); for (const m of list) m.ev = Core.evaluate(m, hw, o); };
  const inSet = () => Core.modelSet(models, state.set);

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
    // points, faded ones first so live ones stay on top
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
    if (c.over) g += c.over({ sx, sy, M, iw, ih, W, H });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.aria)}">${g}</svg><div class="tip" hidden></div>`;

    // hover / pin
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
    const show = (p, pinned) => {
      tip.innerHTML = c.tip(p.m); tip.hidden = false; tip.classList.toggle('pinned', !!pinned);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = p.px + 14, y = p.py - th / 2;
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
    return { sx, sy, M, iw, ih };
  }

  function tipHTML(m) {
    const e = m.ev, q = Core.quant(state.q), gb = m.total * Core.gbPerB(m, q);
    const idx = m.best.toFixed(1) + (m.variants[0].estimated ? ' (AA est.)' : '');
    const params = `${fmtB(m.total)} total · ${fmtB(m.active)} active` + (m.lookup ? ` · ${fmtB(m.lookup)} lookup` : '');
    const rows = [
      ['Intelligence', idx], ['Parameters', params], [`Weights @ ${q.label}`, fmtGB(gb)],
      ['On your hardware', e ? `<span class="badge ${e.cls}">${CLS_SHORT[e.cls]}</span>${e.cls !== 'none' ? ' ~' + fmtT(e.tps) + ' tok/s' : ''}` : '—'],
      ['AA measured speed', m.tpsAA ? fmtT(m.tpsAA) + ' tok/s' : 'n/a'],
    ];
    if (m.lean != null) rows.push(['Lean', (m.lean > 0.12 ? 'coding / agents' : m.lean < -0.12 ? 'knowledge / chat' : 'balanced') + ` (${m.lean > 0 ? '+' : ''}${m.lean.toFixed(2)})`]);
    const links = `<div class="links"><a href="https://artificialanalysis.ai/models/${m.slug}" target="_blank" rel="noopener">Artificial Analysis ↗</a>` + (m.repo ? `<a href="https://huggingface.co/${m.repo}" target="_blank" rel="noopener">Hugging Face ↗</a>` : '') + '</div>';
    const note = m.notes.length ? `<div class="note">${esc(m.notes[0])}</div>` : '';
    return `<h4>${esc(m.name)}</h4><div class="by">${esc(m.creator)}${m.released ? ' · ' + m.released : ''}${m.license ? ' · ' + esc(m.license) : ''}</div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note}${links}`;
  }

  // ---------------------------------------------------------------- main chart
  function drawMain() {
    const set = inSet(); evalAll(set);
    const f = state.filter.trim().toLowerCase();
    const xv = m => (state.x === 'active' ? m.active : m.total);
    const pts = set.map(m => ({ x: xv(m), y: m.best, m, color: colorOf(m), hollow: m.variants[0].estimated, hl: state.hl === m.id }));
    const rankIdx = Core.ranks(pts.map(p => p.y));
    const fr = new Set(Core.frontier(pts).map(p => p.m.id));
    pts.forEach((p, i) => { p.name = p.m.name; p.label = (fr.has(p.m.id) ? 2 : 0) + rankIdx[i]; p.faded = f && !(p.m.name + ' ' + p.m.creator).toLowerCase().includes(f); });
    $('#setcount').textContent = `${set.length} of ${models.length} models`;
    $('#chartSub').textContent = `${state.x === 'active' ? 'Active' : 'Total'} parameters against Artificial Analysis Intelligence Index, best reasoning setting per model. Dashed line: Pareto frontier.`;
    if (!pts.length) { $('#main').innerHTML = '<p class="empty">No models match this view. Widen the model set above.</p>'; return; }
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const log = state.xscale === 'log';
    const x0 = log ? Math.min(...xs) / 1.5 : 0, x1 = Math.max(...xs) * (log ? 1.6 : 1.06);
    const y0 = Math.max(0, Math.floor((Math.min(...ys) - 3) / 5) * 5), y1 = Math.ceil((Math.max(...ys) + 3) / 5) * 5;

    // where the selected hardware runs out, in this chart's units (total-params mode only)
    const q = Core.quant(state.q), hw = hwNow();
    const capLines = [];
    if (state.x === 'total' && q.bpw) {
      const toB = gb => (gb * 8) / q.bpw;
      const v = Math.max(0, hw.vram - state.reserve), all = v + (hw.unified ? 0 : Math.max(0, hw.ram - 6));
      capLines.push([toB(v), 'fits in ' + (hw.unified ? 'memory' : 'VRAM')]);
      if (!hw.unified && all > v + 1) capLines.push([toB(all), '+ RAM']);
    }
    scatter($('#main'), {
      pts, xlog: log, x0, x1, y0, y1, xTicks: log ? logTicks(x0, x1) : linTicks(x0, x1), yTicks: linTicks(y0, y1, 6), xFmt: fmtB,
      xTitle: `${state.x === 'active' ? 'Active' : 'Total'} parameters (billions, ${log ? 'log' : 'linear'} scale)`, yTitle: 'Artificial Analysis Intelligence Index',
      height: W => Math.round(Math.min(560, Math.max(360, W * 0.56))), frontier: true, tip: tipHTML, aria: 'Scatter plot of intelligence index versus parameter count',
      under: ctx => capLines.filter(([b]) => b > x0 && b < x1).map(([b, t], i) => `<line class="cap" x1="${ctx.sx(b)}" x2="${ctx.sx(b)}" y1="${ctx.M.t}" y2="${ctx.M.t + ctx.ih}"/><text class="captext" x="${ctx.sx(b) - 5}" y="${ctx.M.t + 12 + i * 13}" text-anchor="end">${t} at ${q.label}</text>`).join(''),
    });
    $('#mainLegend').innerHTML = `<span><i class="dot" style="background:var(--dense)"></i>Dense</span><span><i class="dot" style="background:var(--moe)"></i>Mixture of experts</span><span><i class="dot" style="background:var(--lookup)"></i>Has lookup tables (n-gram / per-layer embeddings)</span><span><i class="dot hollow" style="color:var(--muted)"></i>Score estimated by AA</span>` + (capLines.length ? `<span style="color:var(--brand)">┆ capacity of your hardware (set below)</span>` : '');
  }

  // ---------------------------------------------------------------- quadrant
  function quadPoints() {
    const set = inSet(); evalAll(set);
    const minS = state.minspeed;
    const fits = set.filter(m => m.ev.cls !== 'none' && m.ev.tps >= minS && m.lean != null);
    const useAA = state.yaxis === 'aa';
    const rows = fits.filter(m => (useAA ? m.tpsAA : m.ev.tps));
    const speed = m => (useAA ? m.tpsAA : m.ev.tps);
    const ri = Core.ranks(rows.map(m => m.best)), rs = Core.ranks(rows.map(m => Math.log(speed(m))));
    return { rows, y: rows.map((m, i) => ri[i] - rs[i]), speed, total: set.length, fitsN: fits.length, noAA: fits.length - rows.length };
  }

  function drawQuad() {
    const el = $('#quad'), Q = quadPoints();
    const hasAA = Q.rows.length;
    $('#quadLegend').innerHTML = `<span><i class="dot" style="background:var(--dense)"></i>Dense</span><span><i class="dot" style="background:var(--moe)"></i>MoE</span><span><i class="dot" style="background:var(--lookup)"></i>Lookup tables</span><span>${Q.rows.length} models shown` + (state.yaxis === 'aa' && Q.noAA ? `; ${Q.noAA} fit but have no AA speed (switch to "Estimated")` : '') + `</span>`;
    if (!hasAA) { el.innerHTML = `<p class="empty">Nothing fits with these settings. Try a smaller quantization, more RAM, allowing SSD paging, a lower minimum speed, or a wider model set.</p>`; return; }
    const pts = Q.rows.map((m, i) => ({ x: m.lean, y: Q.y[i], m, color: colorOf(m), hollow: m.variants[0].estimated, hl: state.hl === m.id, name: m.name, r: 5 + Math.min(4, Math.log10(1 + m.total) * 1.1), label: m.best }));
    scatter(el, {
      pts, bare: true, xlog: false, x0: -0.75, x1: 0.75, y0: -1.1, y1: 1.1, tip: tipHTML, aria: 'Quadrant chart of coding-versus-knowledge lean against speed-versus-intelligence', maxLabels: 28,
      height: W => Math.round(Math.min(560, Math.max(380, W * 0.7))),
      under: ({ sx, sy, M, iw, ih }) => {
        const cx = sx(0), cy = sy(0), l = M.l, r = M.l + iw, t = M.t, b = M.t + ih;
        return `<rect x="${l}" y="${t}" width="${iw}" height="${ih}" fill="none" stroke="var(--border)"/>` +
          `<line class="axisline" x1="${cx}" x2="${cx}" y1="${t}" y2="${b}" stroke-dasharray="4 4"/><line class="axisline" x1="${l}" x2="${r}" y1="${cy}" y2="${cy}" stroke-dasharray="4 4"/>` +
          `<text class="quad" x="${l + 10}" y="${t + 18}">Brainy generalists</text><text class="quad" x="${r - 10}" y="${t + 18}" text-anchor="end">Smart coders &amp; agents</text>` +
          `<text class="quad" x="${l + 10}" y="${b - 10}">Quick chat</text><text class="quad" x="${r - 10}" y="${b - 10}" text-anchor="end">Quick coders</text>` +
          `<text class="axtitle" x="${l}" y="${b + 24}">← knowledge &amp; chat</text><text class="axtitle" x="${r}" y="${b + 24}" text-anchor="end">coding &amp; agents →</text>` +
          `<text class="axtitle" x="${cx}" y="${b + 24}" text-anchor="middle" style="fill:var(--muted);font-weight:400">relative strength</text>` +
          `<text class="axtitle" transform="translate(${l - 3} ${cy}) rotate(-90)" text-anchor="middle" style="fill:var(--muted);font-weight:400">${state.yaxis === 'aa' ? 'AA measured speed vs intelligence' : 'estimated speed vs intelligence'}</text>` +
          `<text class="axtitle" x="${l + 6}" y="${t - 1}" style="display:none"></text>`;
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
    const all = ok.filter(m => m.ev.cls === 'fit');
    const inMem = by(all, m => m.best);
    if (inMem && inMem !== smart) picks.push(['Smartest that fits entirely in fast memory', inMem]);
    const coder = by(ok.filter(m => m.lean != null && m.lean >= 0.1), m => m.best);
    if (coder) picks.push(['Best for coding & agents', coder]);
    const chat = by(ok.filter(m => m.lean != null && m.lean <= -0.05), m => m.best);
    if (chat) picks.push(['Best for knowledge & chat', chat]);
    if (smart) { const fast = by(ok.filter(m => m.best >= 0.6 * smart.best), m => m.ev.tps); if (fast && fast !== smart) picks.push(['Fastest that is still capable', fast]); }
    const seen = new Set();
    $('#picks').innerHTML = picks.length ? picks.map(([t, m], i) => {
      const dup = seen.has(m.id); seen.add(m.id);
      return `<button class="pick" data-id="${m.id}"><small>${t}</small><b>${esc(m.name)}</b><div class="meta">Index ${m.best.toFixed(1)} · <span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span> · ~${fmtT(m.ev.tps)} tok/s<br>${fmtB(m.total)} total · ${fmtB(m.active)} active · ${fmtGB(m.ev.total)}</div></button>`;
    }).join('') : '<p class="empty" style="grid-column:1/-1">No model meets the speed floor on this hardware in the current model set.</p>';
    $('#picks').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => { state.hl = b.dataset.id; drawQuad(); drawMain(); document.querySelector('#quad').scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
  }

  // ---------------------------------------------------------------- hardware panel
  function opts(list, cur, f = x => x) { return list.map(x => `<option value="${esc(x.id ?? x)}"${(x.id ?? x) == cur ? ' selected' : ''}>${esc(f(x))}</option>`).join(''); }
  function drawHw() {
    const h = state.hw, hw = hwNow();
    const kinds = [['gpu', 'Discrete GPU'], ['unified', 'Unified memory'], ['cpu', 'CPU only'], ['custom', 'Custom']];
    const ramSel = `<div class="field"><label class="k" for="hRam">System RAM</label><div class="row"><select id="hRam">${opts(Hardware.RAM_SIZES, h.ram, x => x + ' GB')}</select><select id="hRamT" aria-label="RAM type">${opts(Hardware.RAM_TYPES, h.ramType, x => x.label)}</select></div></div>`;
    let body = '';
    if (h.kind === 'gpu') body = `<div class="field"><label class="k" for="hGpu">GPU</label><div class="row"><select id="hGpu">${opts(Hardware.GPUS, h.gpu, g => `${g.label}`)}</select><select id="hN" aria-label="GPU count">${[1, 2, 3, 4, 6, 8].map(n => `<option${n == h.n ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="note">×</span></div></div>` + ramSel;
    if (h.kind === 'unified') { const u = Hardware.by(Hardware.UNIFIED, h.chip); const sizes = u.sizes; if (!sizes.includes(h.uGB)) h.uGB = sizes[sizes.length - 1]; body = `<div class="field"><label class="k" for="hChip">Chip</label><div class="row"><select id="hChip">${opts(Hardware.UNIFIED, h.chip, c => c.label)}</select><select id="hU" aria-label="Memory">${opts(sizes, h.uGB, s => s + ' GB')}</select></div></div>`; }
    if (h.kind === 'cpu') body = ramSel;
    if (h.kind === 'custom') body = `<div class="field"><label class="k">GPU memory &amp; bandwidth</label><div class="row"><input type="number" id="hV" min="0" max="2048" value="${h.vram}" style="width:80px"> GB <input type="number" id="hB" min="20" max="10000" value="${h.bw}" style="width:90px"> GB/s</div></div>` + ramSel;
    $('#hwpanel').innerHTML = `
      <div class="field"><label class="k">Quick picks</label><div class="chips">${Hardware.QUICK.map((p, i) => `<button class="chip" data-q="${i}">${esc(p.label)}</button>`).join('')}</div></div>
      <div class="field"><label class="k">Hardware</label><div class="seg" id="hKind">${kinds.map(([k, l]) => `<button aria-pressed="${h.kind === k}" data-k="${k}">${l}</button>`).join('')}</div></div>
      ${body}
      <div class="field"><label class="k" for="hQ">Quantization</label><div class="row"><select id="hQ">${opts(Core.QUANTS, state.q, q => q.label + (q.bpw ? ` (${q.bpw} bpw)` : ''))}</select></div></div>
      <div class="field"><label class="k" for="hRes">Context &amp; runtime headroom: <b id="hResOut">${state.reserve} GB</b></label><input type="range" id="hRes" min="1" max="32" value="${state.reserve}" style="width:100%"></div>
      <label class="tog"><input type="checkbox" id="hSsd"${h.ssd ? ' checked' : ''}> Allow paging weights from NVMe SSD (~6 GB/s, slow)</label>
      <div class="readout"><div><b>${fmtGB(hw.vram)}</b><span>${hw.unified ? 'usable memory' : hw.vram ? 'VRAM' : 'GPU memory'}</span></div><div><b>${hw.unified ? '—' : fmtGB(hw.ram)}</b><span>system RAM</span></div><div><b>${Math.round(hw.bwV)}${hw.unified || !hw.ram ? '' : ' / ' + Math.round(hw.bwR)}</b><span>GB/s${hw.unified || !hw.ram ? '' : ' (GPU / RAM)'}</span></div></div>
      <p class="note">Speeds are a bandwidth-roofline estimate for single-user decoding; see Method.</p>`;
    const P = $('#hwpanel'), on = (sel, ev, fn) => { const e = P.querySelector(sel); if (e) e.addEventListener(ev, fn); };
    P.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { const p = Hardware.QUICK[b.dataset.q]; state.hw = { ...state.hw, ...p }; delete state.hw.label; changed(true); }));
    P.querySelectorAll('#hKind button').forEach(b => b.addEventListener('click', () => { state.hw.kind = b.dataset.k; changed(true); }));
    const num = (id, key, parse = Number) => on(id, 'change', e => { state.hw[key] = parse(e.target.value); changed(id === '#hChip'); });
    num('#hGpu', 'gpu', String); num('#hN', 'n'); num('#hRam', 'ram'); num('#hRamT', 'ramType', String); num('#hChip', 'chip', String); num('#hU', 'uGB'); num('#hV', 'vram'); num('#hB', 'bw');
    on('#hQ', 'change', e => { state.q = e.target.value; changed(); });
    on('#hRes', 'input', e => { state.reserve = +e.target.value; $('#hResOut').textContent = state.reserve + ' GB'; changed(false, true); });
    on('#hSsd', 'change', e => { state.hw.ssd = e.target.checked; changed(); });
  }

  // ---------------------------------------------------------------- table
  let sort = { k: 'best', dir: -1 };
  function drawTable() {
    const set = inSet(); evalAll(set);
    const f = state.filter.trim().toLowerCase();
    const q = Core.quant(state.q);
    const cols = [
      ['name', 'Model', m => m.name, m => esc(m.name)], ['creator', 'Lab', m => m.creator, m => esc(m.creator)],
      ['best', 'Index', m => m.best, m => m.best.toFixed(1)], ['total', 'Total', m => m.total, m => fmtB(m.total)], ['active', 'Active', m => m.active, m => fmtB(m.active)],
      ['lookup', 'Lookup', m => m.lookup, m => (m.lookup ? fmtB(m.lookup) : '—')], ['gb', 'Weights @ ' + q.label, m => m.ev.total, m => fmtGB(m.ev.total)],
      ['fit', 'On your hardware', m => ({ fit: 3, offload: 2, ssd: 1, none: 0 }[m.ev.cls]), m => `<span class="badge ${m.ev.cls}">${CLS_SHORT[m.ev.cls]}</span>`],
      ['tps', 'Est. tok/s', m => m.ev.tps || 0, m => (m.ev.cls === 'none' ? '—' : fmtT(m.ev.tps))], ['aa', 'AA tok/s', m => m.tpsAA || 0, m => (m.tpsAA ? fmtT(m.tpsAA) : '—')],
    ];
    const col = cols.find(c => c[0] === sort.k) || cols[3];
    const rows = set.filter(m => !f || (m.name + ' ' + m.creator).toLowerCase().includes(f)).sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    $('#table').innerHTML = `<thead><tr>${cols.map(c => `<th class="${c[0] === 'name' || c[0] === 'creator' ? 'l' : ''}" data-k="${c[0]}"${sort.k === c[0] ? ` aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c[1]}${sort.k === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(m => `<tr>${cols.map((c, i) => `<td class="${i === 0 ? 'name l' : i === 1 ? 'l' : ''}">${c[3](m)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#table').querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; sort = { k, dir: sort.k === k ? -sort.dir : (k === 'name' || k === 'creator' ? 1 : -1) }; drawTable(); }));
  }

  // ---------------------------------------------------------------- controls wiring
  function seg(el, items, get, set) {
    el.innerHTML = items.map(([v, l]) => `<button aria-pressed="${get() === v}" data-v="${v}">${l}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); seg(el, items, get, set); changed(); }));
  }
  function drawControls() {
    seg($('#setmode'), [['recent', 'Recent'], ['featured', 'AA picks'], ['latest', 'Latest per lab'], ['all', 'All']], () => state.set.mode, v => { state.set.mode = v; });
    seg($('#xmode'), [['total', 'Total params'], ['active', 'Active params']], () => state.x, v => { state.x = v; });
    seg($('#xscale'), [['log', 'Log'], ['linear', 'Linear']], () => state.xscale, v => { state.xscale = v; });
    seg($('#yaxis'), [['aa', 'AA measured speed'], ['est', 'Estimated on my hardware']], () => state.yaxis, v => { state.yaxis = v; });
    const m = $('#months'); m.value = state.set.months; $('#monthsOut').textContent = state.set.months + (state.set.months === 1 ? ' month' : ' months');
    m.oninput = () => { state.set.months = +m.value; $('#monthsOut').textContent = m.value + (m.value === '1' ? ' month' : ' months'); changed(false, true); };
    $('#monthsWrap').style.display = state.set.mode === 'recent' ? '' : 'none';
    $('#minspeed').value = String(state.minspeed);
    $('#minspeed').onchange = e => { state.minspeed = +e.target.value; changed(); };
    $('#q').oninput = e => { state.filter = e.target.value; drawMain(); drawTable(); };
    $('#q').value = state.filter;
  }

  function changed(rebuildHw, light) {
    save();
    if (!light) drawControls();
    if (rebuildHw) drawHw();
    else if (!light) { /* panel keeps focus */ }
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
