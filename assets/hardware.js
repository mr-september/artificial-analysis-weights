/* Hardware model. Deliberately coarse: users pick a mode, a GPU generation + VRAM, and a RAM size; bandwidths below are
   representative spec-sheet values for the cards sold in each (series, VRAM) slot, recalled from memory (approximate).
   `fp4` marks hardware with native 4-bit float tensor cores (NVFP4 / MXFP4), which decides the default 4-bit format. */
const Hardware = (() => {
  const c = (gb, bw) => ({ gb, bw });
  const SERIES = [
    { id: 'rtx5000', label: 'RTX 5000', fp4: true, cards: [c(8, 448), c(12, 672), c(16, 960), c(32, 1792)] },
    { id: 'rtx4000', label: 'RTX 4000', cards: [c(8, 288), c(12, 504), c(16, 672), c(24, 1008)] },
    { id: 'rtx3000', label: 'RTX 3000', cards: [c(8, 448), c(10, 760), c(12, 360), c(24, 936)] },
    { id: 'rtx2000', label: 'RTX 2000', cards: [c(8, 448), c(11, 616)] },
    { id: 'rx9000', label: 'Radeon RX 9000', cards: [c(16, 640), c(32, 640)] },
    { id: 'rx7000', label: 'Radeon RX 7000', cards: [c(12, 432), c(16, 576), c(20, 800), c(24, 960)] },
    { id: 'arc', label: 'Intel Arc', cards: [c(12, 456), c(16, 560)] },
    { id: 'pro', label: 'Workstation (Blackwell)', fp4: true, cards: [c(48, 1344), c(96, 1792)] },
    { id: 'dc', label: 'Data center', cards: [c(48, 864), c(80, 3350), c(141, 4800)] },
  ];
  const COUNTS = [1, 2, 3, 4, 8];
  const RAM_SIZES = [16, 32, 64, 96, 128, 192, 256, 512];
  const U_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512];
  const U_CLASSES = [
    { id: 'std', label: 'Standard', bw: 120, hint: 'base-tier chips and thin-and-light laptops' },
    { id: 'fast', label: 'Fast', bw: 270, hint: 'mid-tier chips; mini-PC APUs with 128 GB' },
    { id: 'max', label: 'Fastest', bw: 600, hint: 'top-tier workstation chips' },
  ];
  const MODES = [['gpu', 'GPU only'], ['offload', 'GPU + system RAM'], ['unified', 'Unified memory']];

  const series = id => SERIES.find(s => s.id === id) || SERIES[1];
  /** Nearest offered card size for a series (used when switching series). */
  function nearestCard(sr, gb) { return sr.cards.reduce((a, k) => (Math.abs(k.gb - gb) < Math.abs(a.gb - gb) ? k : a)); }
  const ramBw = gb => (gb >= 192 ? 200 : 80);  // dual-channel desktop vs. workstation/server platform

  /** state -> {vram, ram, bwV, bwR, unified, ssd, fp4, label, usable} consumed by Core.evaluate */
  function build(s) {
    const ssd = !!s.ssd;
    if (s.mode === 'unified') {
      const u = U_CLASSES.find(x => x.id === s.uClass) || U_CLASSES[1];
      const pool = Math.round(s.uGB * 0.75);  // default GPU-addressable share of unified memory
      return { vram: pool, ram: 0, bwV: u.bw, bwR: u.bw, unified: true, ssd, fp4: false, label: `${s.uGB} GB unified memory`, usable: pool };
    }
    const sr = series(s.series), card = sr.cards.find(k => k.gb === s.vram) || nearestCard(sr, s.vram), n = s.n;
    const ram = s.mode === 'offload' ? s.ram : 0;
    return { vram: card.gb * n, ram, bwV: card.bw, bwR: ramBw(ram), unified: false, ssd, fp4: !!sr.fp4,
      label: `${n > 1 ? n + '× ' : ''}${card.gb} GB ${sr.label}${ram ? ' + ' + ram + ' GB RAM' : ''}`, usable: card.gb * n };
  }

  return { SERIES, COUNTS, RAM_SIZES, U_SIZES, U_CLASSES, MODES, series, nearestCard, build };
})();
