/* Hardware model. Deliberately coarse: the user states total VRAM (any mix of cards), system RAM and a GPU family (only
   RTX 50 / Blackwell, with native FP4, changes anything), or a unified-memory size and speed class. Bandwidths are representative values recalled from
   spec sheets (approximate); the speed estimates built on them are order-of-magnitude. */
const Hardware = (() => {
  const VRAM_SIZES = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];  // the last means "256 or more"
  /** GPU family: only RTX 50 / Blackwell changes behaviour (native FP4 -> NVFP4); the rest is context for the reader. */
  const GPU_FAMILIES = [['rtx50', 'RTX 5000 / Blackwell'], ['rtx20-40', 'RTX 2000–4000'], ['gtx', 'GTX'], ['amd-intel', 'AMD / Intel']];
  const RAM_SIZES = [16, 32, 64, 96, 128, 192, 256, 512];
  const U_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512];
  const U_CLASSES = [
    { id: 'std', label: 'Standard', bw: 120, hint: 'base-tier chips and thin-and-light laptops' },
    { id: 'fast', label: 'Fast', bw: 270, hint: 'mid-tier chips; mini-PC APUs with 128 GB' },
    { id: 'max', label: 'Fastest', bw: 600, hint: 'top-tier workstation chips' },
  ];
  const MODES = [['gpu', 'GPU only'], ['offload', 'GPU + system RAM'], ['unified', 'Unified memory']];

  /** Representative GPU bandwidth (GB/s) for a total-VRAM figure: single cards up to 32 GB, 24 GB-class cards layer-split beyond. */
  const VRAM_BW = [[4, 200], [6, 280], [8, 360], [12, 450], [16, 600], [24, 950], [32, 1500], [64, 950], [Infinity, 1500]];
  const vramBw = gb => VRAM_BW.find(([cap]) => gb <= cap)[1];
  const ramBw = gb => (gb >= 192 ? 200 : 80);  // dual-channel desktop vs. workstation/server platform

  /** state -> {vram, ram, bwV, bwR, unified, ssd, fp4, label, usable} consumed by Core.evaluate */
  function build(s) {
    const ssd = !!s.ssd;
    if (s.mode === 'unified') {
      const u = U_CLASSES.find(x => x.id === s.uClass) || U_CLASSES[1];
      const pool = Math.round(s.uGB * 0.75);  // default GPU-addressable share of unified memory
      return { vram: pool, ram: 0, bwV: u.bw, bwR: u.bw, unified: true, ssd, fp4: false, label: `${s.uGB} GB unified memory`, usable: pool };
    }
    const ram = s.mode === 'offload' ? s.ram : 0;
    return { vram: s.vram, ram, bwV: vramBw(s.vram), bwR: ramBw(ram), unified: false, ssd, fp4: s.gpu === 'rtx50',
      label: `${s.vram} GB VRAM${ram ? ' + ' + ram + ' GB RAM' : ''}`, usable: s.vram };
  }

  return { VRAM_SIZES, GPU_FAMILIES, RAM_SIZES, U_SIZES, U_CLASSES, MODES, build };
})();
