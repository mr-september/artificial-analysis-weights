/* Pure model logic: memory footprint, tiered placement, decode-speed roofline, filters, quadrant axes.
   No DOM access, so it can be unit-tested in any JS runtime (see tests/core.test.html). */
const Core = (() => {
  // Effective bits per weight of common GGUF-style quants (approximate, recalled from llama.cpp tables).
  const QUANTS = [
    { id: 'native', label: 'As released', bpw: null },
    { id: 'bf16', label: 'BF16', bpw: 16 },
    { id: 'q8', label: 'Q8_0 / FP8', bpw: 8.5 },
    { id: 'q6', label: 'Q6_K', bpw: 6.56 },
    { id: 'q5', label: 'Q5_K_M', bpw: 5.7 },
    { id: 'q4', label: 'Q4_K_M', bpw: 4.85 },
    { id: 'nvfp4', label: 'NVFP4', bpw: 4.5 },  // 4-bit E2M1 + one FP8 scale per 16 weights
    { id: 'q3', label: 'Q3_K_M', bpw: 3.9 },
    { id: 'q2', label: 'Q2_K', bpw: 2.63 },
  ];
  const quant = id => QUANTS.find(q => q.id === id) || QUANTS[5];

  const DEFAULTS = {
    reserve: 4,      // GB of fast memory kept back for KV cache, activations, runtime
    osReserve: 6,    // GB of system RAM kept back for the OS
    shared: 0.3,     // share of a MoE's active params that are always read (attention, shared experts, dense layers)
    eff: 0.55,       // fraction of peak memory bandwidth reached while decoding
    ssdGB: 2000, bwS: 6,
  };

  /** GB per billion params at a quant. A quant never inflates a checkpoint that is already smaller. */
  function gbPerB(m, q) {
    const nat = m.native_gb ? (m.native_gb * 8) / m.total : 16;
    return Math.min(q.bpw ?? nat, nat) / 8;
  }

  /**
   * Place a model's weights into VRAM -> system RAM -> SSD and estimate decode speed.
   * hw: {vram, ram, bwV, bwR, unified, ssd}   (GB, GB/s)
   * Reads per token: always-read ("hot") weights, plus the active share of routed experts spread
   * uniformly over wherever the expert pool lives. Lookup tables (n-gram / per-layer embeddings)
   * are placed last and cost no bandwidth.
   */
  function evaluate(m, hw, o) {
    o = { ...DEFAULTS, ...o };
    const b = gbPerB(m, o.q);
    const moe = m.arch.startsWith('moe');
    const s = moe ? o.shared : 1;
    const hot = s * m.active * b;
    const cold = Math.max(0, (m.total - m.lookup) * b - hot);
    const coldRead = moe ? (1 - s) * m.active * b : 0;
    const lookup = m.lookup * b;
    const pool = {
      v: Math.max(0, hw.vram - o.reserve),
      r: hw.unified ? 0 : Math.max(0, hw.ram - o.osReserve),
      s: hw.ssd ? o.ssdGB : 0,
    };
    const take = (need, order) => {
      const got = { v: 0, r: 0, s: 0 };
      for (const t of order) { const x = Math.min(need, pool[t]); pool[t] -= x; got[t] += x; need -= x; }
      return { got, left: need };
    };
    const H = take(hot, ['v', 'r', 's']);
    const C = take(cold, ['v', 'r', 's']);
    // Lookup tables are sparse random-row reads (a few KB per token), so they page from SSD at negligible cost even when
    // SSD paging of weights is off; they are placed last so they never displace weights that are read every token.
    if (!hw.ssd) pool.s = o.ssdGB;
    const L = take(lookup, ['r', 'v', 's']);
    const total = (m.total) * b;
    if (H.left > 1e-6 || C.left > 1e-6 || L.left > 1e-6) return { cls: 'none', total, tps: 0 };

    const readFrom = t => H.got[t] + (cold > 0 ? (coldRead * C.got[t]) / cold : 0);
    const time = readFrom('v') / hw.bwV + readFrom('r') / hw.bwR + readFrom('s') / o.bwS;
    const tps = time > 0 ? o.eff / time : Infinity;
    const slow = H.got.s + C.got.s;
    const spill = hw.vram > 0 || hw.unified ? H.got.r + C.got.r : H.got.s + C.got.s;
    const cls = slow > 1e-6 ? 'ssd' : spill > 1e-6 ? 'offload' : 'fit';
    return {
      cls, tps, total,
      v: H.got.v + C.got.v + L.got.v, r: H.got.r + C.got.r + L.got.r, s: H.got.s + C.got.s + L.got.s,
      lookupOff: L.got.r + L.got.s, lookupSsd: L.got.s,
    };
  }

  /** Upper-left Pareto frontier: points not dominated by a smaller-x, higher-y point. */
  function frontier(pts) {
    const s = [...pts].sort((a, b) => a.x - b.x || b.y - a.y);
    const out = []; let best = -Infinity;
    for (const p of s) if (p.y > best) { out.push(p); best = p.y; }
    return out;
  }

  // ---- model-set filters (shared by both charts) -------------------------------------------------
  const DAY = 864e5;
  function modelSet(models, f, now = Date.now()) {
    if (f.mode === 'curated') return models.filter(m => m.curated);
    if (f.mode === 'featured') return models.filter(m => m.featured);
    if (f.mode === 'recent') {
      const cut = now - f.months * 30.44 * DAY;
      return models.filter(m => m.released && Date.parse(m.released) >= cut);
    }
    return models;
  }

  // ---- quadrant axes -------------------------------------------------------------------------------
  // x: relative strength in coding / agentic evals vs knowledge / instruction-following evals.
  // AA publishes no creative-writing or roleplay eval, so the left end is "knowledge & chat", not "creative".
  const CODING = [['terminalBench40', 'terminalBench21', 'terminalbenchHard'], ['tau2'], ['scicode'], ['apexAgents'], ['frontierCode'], ['livecodebench']];
  const GENERAL = [['omniscienceAccuracy'], ['ifbench'], ['lcr'], ['gpqa'], ['hle']];

  function percentiles(models, keys) {
    const tables = {};
    for (const k of keys) {
      const vals = models.map(m => m.bench[k]).filter(v => v != null).sort((a, b) => a - b);
      tables[k] = v => (vals.length < 5 ? null : vals.filter(x => x <= v).length / vals.length);
    }
    return tables;
  }

  /** Adds m.lean in [-1, 1] (+ = coding/agentic) where enough benchmarks exist, else null. */
  function addLean(models) {
    const keys = [...CODING.flat(), ...GENERAL.flat()];
    const pct = percentiles(models, keys);
    const group = (m, g) => {
      const v = [];
      for (const alts of g) {
        const k = alts.find(k => m.bench[k] != null);
        if (k) { const p = pct[k](m.bench[k]); if (p != null) v.push(p); }
      }
      return v;
    };
    for (const m of models) {
      const c = group(m, CODING), g = group(m, GENERAL);
      m.lean = c.length >= 1 && g.length >= 2 ? c.reduce((a, b) => a + b) / c.length - g.reduce((a, b) => a + b) / g.length : null;
    }
  }

  /** Average-rank percentile of each value in the array, 0..1. */
  function ranks(vals) {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(vals.length);
    idx.forEach(([, i], r) => { out[i] = vals.length > 1 ? r / (vals.length - 1) : 0.5; });
    return out;
  }

  return { QUANTS, quant, DEFAULTS, gbPerB, evaluate, frontier, modelSet, addLean, ranks };
})();
if (typeof module !== 'undefined') module.exports = Core;
