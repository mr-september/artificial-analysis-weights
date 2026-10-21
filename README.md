<div align="center">

# Open-weights: intelligence vs size

[Artificial Analysis](https://artificialanalysis.ai/) scores open-weights models on its Intelligence Index, but plots it against price and speed, not size. This site plots the index against **parameter count** for every open-weights model it scores, then shows which ones your GPU, RAM or unified memory can run. Unofficial: not affiliated with Artificial Analysis or Hugging Face.

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen.svg)](https://mr-september.github.io/artificial-analysis-weights/)
[![Deploy](https://github.com/mr-september/artificial-analysis-weights/actions/workflows/pages.yml/badge.svg)](https://github.com/mr-september/artificial-analysis-weights/actions/workflows/pages.yml)
[![Data: Artificial Analysis](https://img.shields.io/badge/Data-Artificial%20Analysis-7c3aed.svg)](https://artificialanalysis.ai/)

**Intelligence vs size** · **What fits your hardware** · **Refreshed every 3 days**

### [Try it live](https://mr-september.github.io/artificial-analysis-weights/)

<a href="https://mr-september.github.io/artificial-analysis-weights/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/chart-dark.png">
    <img src="docs/screenshots/chart-light.png" alt="Artificial Analysis Intelligence Index against parameter count for open-weights models, with Claude Opus and GPT Astra as dashed reference lines" width="900">
  </picture>
</a>

</div>

---

## What it shows

- **Intelligence vs parameters.** The Intelligence Index against total or active parameters, log or linear. The dashed line is the frontier: no smaller model scores higher. Frontier models are always shown, whichever model set you pick. A MoE's *active* parameters set its speed, its *total* parameters set its memory.
- **Lookup-table models** (n-gram or per-layer embedding tables, such as Qwen3.8-Flash-Next) appear as two linked points: the ring is the size without the tables, the filled dot the full size. The tables take memory but almost no bandwidth, so they can sit on SSD. The frontier uses the ring.
- **Closed models.** They publish no sizes, so the optional "Closed models" switch draws the latest model of each product tier at the leading closed labs as dashed score lines.
- **Model sets.** Featured (hand-curated), Recent, Artificial Analysis's own picks, All, or choose models one by one.

## What should I run?

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/run-dark.png">
  <img src="docs/screenshots/run-light.png" alt="Hardware picker, a quadrant of coding versus knowledge strength against speed, and top picks for the chosen hardware" width="700">
</picture>
</div>

- **Pick your hardware:** GPU only, GPU plus system RAM, or unified memory; total VRAM, RAM size and precision. Weights fill VRAM, then RAM, then SSD if you allow it. A model counts as usable if a bandwidth estimate gives it a few tokens per second; the estimate is rough and not shown.
- **Precision.** On RTX 5000 / Blackwell, "4-bit" means NVFP4, elsewhere GGUF Q4_K_M. Artificial Analysis scored hosted endpoints, so quantized local copies will score lower.
- **Quadrant.** Horizontal: coding and agentic percentile minus knowledge and instruction-following percentile (Artificial Analysis has no creative-writing eval). Vertical: speed, approximated by fewer active parameters. Dot size: Intelligence Index. A ring marks models that nothing beats on both speed and intelligence.

## Where the data comes from

| What | Source |
|---|---|
| Scores, release dates, total and active parameters, model-picker defaults | Artificial Analysis leaderboard and model pages |
| Exact total sizes, stored sizes, repos, licenses | Hugging Face (safetensors headers); AA's figure is kept where the two differ by more than 8%, with a note |
| Lookup-table sizes, the Featured set | Hand-curated: `data/overrides.json`, `data/curated.json` |
| Hardware capacities and bandwidths | Rough representative values in `assets/hardware.js` |

A GitHub Action refreshes `data/` every three days and redeploys. It refuses to publish if a scrape returns under 80% of the previous model count, and its log lists recent open models that are not in the Featured set.

## Getting started

No build step: a static site, with stdlib-only Python for the data refresh.

```
python scripts/update.py        # refresh data (optional)
python -m http.server 8000      # then open http://localhost:8000
```

Open these via the local server; each prints PASS or FAIL:

- `tests/core.test.html`: fit and placement maths
- `tests/ui.test.html`: interactions
- `tests/responsive.test.html`: no overflow from 320 to 2560 px

```
index.html, assets/          the site (core.js: fit logic, hardware.js: presets, app.js: UI)
data/                        models.json (generated), curated.json and overrides.json (hand-edited), caches
docs/screenshots/            README images
scripts/                     scrape_aa.py, hf.py, update.py
.github/workflows/pages.yml  refresh and deploy
```

## Corrections and curation

- Wrong parameter count or missing lookup-table size: edit `data/overrides.json` (keyed by Artificial Analysis family id, for example `qwen3-8-flash-next`).
- Featured set and picker order: edit `data/curated.json`.
- Hardware numbers: `assets/hardware.js`. Fit logic: `assets/core.js`.

Pull requests welcome.

<div align="center">

## Support

Free and open source. If it saved you time, you can chip in toward its upkeep.

<a href="https://ko-fi.com/Q5Q11I49GI"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Ko-fi" height="32"></a>
<a href="https://liberapay.com/mr-september/donate"><img src="https://liberapay.com/assets/widgets/donate.svg" alt="Liberapay" height="32"></a>
<a href="https://www.paypal.com/donate/?hosted_button_id=WFXL2T42BBCRN"><img src="https://raw.githubusercontent.com/mr-september/central_automation_hub/refs/heads/main/bluePayPalbutton.svg" alt="PayPal" height="32"></a>
<a href="https://nowpayments.io/donation?api_key=5b5fabd5-2c33-4525-99a3-bf27f587780c"><img src="https://nowpayments.io/images/embeds/donation-button-black.svg" alt="Crypto donation button by NOWPayments" height="32"></a>

Stars, bug reports (wrong sizes, missing models) and suggestions for the Featured list help just as much.

</div>

## License and credits

The code and hand-curated files in this repository are [MIT](LICENSE) licensed. Benchmark data belongs to [Artificial Analysis](https://artificialanalysis.ai/); sizes and model metadata come from [Hugging Face](https://huggingface.co/). Please credit them if you reuse it, and follow their terms.
