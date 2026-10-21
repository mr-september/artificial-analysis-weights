/* Hardware presets. Capacities and memory bandwidths are public spec-sheet figures recalled from memory (approximate);
   treat the decode-speed estimates built on them as order-of-magnitude. Edit freely: this file is the only place they live. */
const Hardware = (() => {
  const GPUS = [
    // id, label, VRAM GB, bandwidth GB/s
    ['arcb580', 'Intel Arc B580', 12, 456],
    ['rtx3060', 'RTX 3060 12GB', 12, 360],
    ['rtx4060ti', 'RTX 4060 Ti 16GB', 16, 288],
    ['rtx4070', 'RTX 4070 12GB', 12, 504],
    ['rtx4070tis', 'RTX 4070 Ti Super 16GB', 16, 672],
    ['rtx5070ti', 'RTX 5070 Ti 16GB', 16, 896],
    ['rtx5080', 'RTX 5080 16GB', 16, 960],
    ['rx7900xtx', 'RX 7900 XTX 24GB', 24, 960],
    ['rtx3090', 'RTX 3090 24GB', 24, 936],
    ['rtx4090', 'RTX 4090 24GB', 24, 1008],
    ['rtx5090', 'RTX 5090 32GB', 32, 1792],
    ['r9700', 'Radeon AI PRO R9700 32GB', 32, 640],
    ['rtxpro6000', 'RTX PRO 6000 96GB', 96, 1792],
    ['a100', 'A100 80GB', 80, 2039],
    ['h100', 'H100 80GB', 80, 3350],
    ['h200', 'H200 141GB', 141, 4800],
  ].map(([id, label, vram, bw]) => ({ id, label, vram, bw }));

  // Unified-memory machines: pool sizes offered, bandwidth, and the share of the pool the GPU may use by default.
  const UNIFIED = [
    { id: 'm4', label: 'Apple M4', sizes: [16, 24, 32], bw: 120, usable: 0.67 },
    { id: 'm4pro', label: 'Apple M4 Pro', sizes: [24, 48, 64], bw: 273, usable: 0.7 },
    { id: 'm4max', label: 'Apple M4 Max', sizes: [36, 48, 64, 128], bw: 546, usable: 0.75 },
    { id: 'm3ultra', label: 'Apple M3 Ultra', sizes: [96, 256, 512], bw: 819, usable: 0.75 },
    { id: 'strix', label: 'AMD Ryzen AI Max+ 395 (Strix Halo)', sizes: [32, 64, 96, 128], bw: 256, usable: 0.8 },
    { id: 'spark', label: 'NVIDIA DGX Spark (GB10)', sizes: [128], bw: 273, usable: 0.85 },
    { id: 'snapx', label: 'Snapdragon X Elite laptop', sizes: [16, 32, 64], bw: 135, usable: 0.7 },
    { id: 'lunar', label: 'Intel Core Ultra (Lunar Lake) laptop', sizes: [16, 32], bw: 136, usable: 0.65 },
    { id: 'igpu', label: 'Generic laptop iGPU, DDR5', sizes: [16, 32, 64], bw: 90, usable: 0.6 },
  ];

  const RAM_TYPES = [
    { id: 'ddr4', label: 'DDR4-3200, dual channel', bw: 50 },
    { id: 'ddr5', label: 'DDR5-5600, dual channel', bw: 90 },
    { id: 'ddr5q', label: 'DDR5, quad channel (workstation)', bw: 180 },
    { id: 'ddr5o', label: 'DDR5, 8-channel (Threadripper Pro)', bw: 330 },
    { id: 'ddr5e', label: 'DDR5, 12-channel (EPYC)', bw: 460 },
  ];
  const RAM_SIZES = [16, 32, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

  /** One-click presets, "bands" of common setups. */
  const QUICK = [
    { label: '8 GB GPU', kind: 'custom', vram: 8, bw: 300, ram: 32, ramType: 'ddr5' },
    { label: '12 GB GPU', kind: 'gpu', gpu: 'rtx3060', n: 1, ram: 32, ramType: 'ddr5' },
    { label: '16 GB GPU', kind: 'gpu', gpu: 'rtx4070tis', n: 1, ram: 64, ramType: 'ddr5' },
    { label: '24 GB GPU', kind: 'gpu', gpu: 'rtx4090', n: 1, ram: 64, ramType: 'ddr5' },
    { label: '32 GB GPU', kind: 'gpu', gpu: 'rtx5090', n: 1, ram: 128, ramType: 'ddr5' },
    { label: '2× 24 GB', kind: 'gpu', gpu: 'rtx3090', n: 2, ram: 128, ramType: 'ddr5' },
    { label: '96 GB workstation', kind: 'gpu', gpu: 'rtxpro6000', n: 1, ram: 256, ramType: 'ddr5q' },
    { label: 'Mac 64 GB', kind: 'unified', chip: 'm4pro', uGB: 64 },
    { label: 'Mac 128 GB', kind: 'unified', chip: 'm4max', uGB: 128 },
    { label: 'Strix Halo 128 GB', kind: 'unified', chip: 'strix', uGB: 128 },
    { label: 'Mac Studio 512 GB', kind: 'unified', chip: 'm3ultra', uGB: 512 },
    { label: 'CPU only, 64 GB', kind: 'cpu', ram: 64, ramType: 'ddr5' },
  ];

  const by = (arr, id) => arr.find(x => x.id === id) || arr[0];

  /** hw state -> {vram, ram, bwV, bwR, unified, ssd, label, pool} consumed by Core.evaluate */
  function build(s) {
    const ram = by(RAM_TYPES, s.ramType);
    const ssd = !!s.ssd;
    if (s.kind === 'unified') {
      const u = by(UNIFIED, s.chip);
      const pool = Math.round(s.uGB * u.usable);
      return { vram: pool, ram: 0, bwV: u.bw, bwR: u.bw, unified: true, ssd, label: `${u.label} ${s.uGB} GB`, pool, nominal: s.uGB };
    }
    if (s.kind === 'cpu') {
      return { vram: 0, ram: s.ram, bwV: ram.bw, bwR: ram.bw, unified: false, ssd, label: `CPU only, ${s.ram} GB ${ram.label.split(',')[0]}`, nominal: s.ram };
    }
    const g = s.kind === 'custom' ? { label: `${s.vram} GB GPU`, vram: s.vram, bw: s.bw } : by(GPUS, s.gpu);
    const n = s.kind === 'custom' ? 1 : s.n;
    // Layer-split multi-GPU: one card streams its slice at a time, so bandwidth is that of a single card.
    return { vram: g.vram * n, ram: s.ram, bwV: g.bw, bwR: ram.bw, unified: false, ssd, label: `${n > 1 ? n + '× ' : ''}${g.label} + ${s.ram} GB RAM`, nominal: g.vram * n };
  }

  return { GPUS, UNIFIED, RAM_TYPES, RAM_SIZES, QUICK, build, by };
})();
