# Intelligence vs Weights

[Artificial Analysis](https://artificialanalysis.ai/) Intelligence Index plotted against **parameter count** for every open-weights model it scores, plus a "What should I run?" guide: pick your hardware (GPU only, GPU + system RAM, or unified memory; GPU generation and VRAM; precision, with NVFP4 on RTX 5000 / Blackwell) and see what fits, how it would be placed (VRAM, system RAM, SSD), roughly how fast it decodes, and where it sits on a coding/agents vs knowledge/chat and speed vs intelligence quadrant.

Live site: https://mr-september.github.io/artificial-analysis-weights/

Unofficial. Not affiliated with or endorsed by Artificial Analysis or Hugging Face. All benchmark data is theirs; please credit them if you reuse it.

## How the dimensions are handled

| Dimension | Source | Notes |
|---|---|---|
| Intelligence Index, speed, release date, picker defaults | AA leaderboard + model pages | Best reasoning variant per weight family; hollow marker = AA marks the score as estimated |
| Total / active params | AA model pages (`parameters`, `inferenceParametersActiveBillions`) | Exact total from the Hugging Face safetensors header when within 8% of AA's figure; otherwise AA's and a note |
| Lookup params (n-gram / per-layer embeddings) | `data/overrides.json`, curated from model cards | Take memory, almost no bandwidth, so they are placed last and cost no decode time |
| Native size | Hugging Face repo AA links to | Quantized sizes are computed from effective bits per weight |
| Proprietary frontier | AA leaderboard (`data/aa_closed.json`) | Closed models have no sizes, so only their scores appear: the latest model of each product tier at the leading closed labs as horizontal reference lines (optional toggle) |
| Featured set | `data/curated.json` | Hand-curated default view and top of the model picker; the refresh log lists recent open models missing from it |
| Hardware | `assets/hardware.js` | Total VRAM / RAM / unified-memory buckets with representative bandwidths, approximate |
| Speed on your hardware | `assets/core.js` | Bandwidth roofline: tiered placement VRAM → RAM → SSD, 55% of peak bandwidth, MoE reads only active experts |

Limits worth knowing: the speed model is single-stream decode only; the quadrant's horizontal axis is coding/agentic percentile minus knowledge/instruction-following percentile because AA has no creative-writing or roleplay eval; quantized local copies score below AA's hosted numbers.

## Layout

```
index.html, assets/        static site, no build step
data/models.json           generated; what the site loads
data/aa_open.json          generated; open-weights rows from the AA leaderboard
data/hf_cache.json         generated; Hugging Face sizes (immutable per repo)
data/overrides.json        hand-curated corrections
scripts/update.py          refresh pipeline (stdlib-only Python 3.10+)
tests/*.test.html          open via a local server; they print PASS/FAIL
.github/workflows/pages.yml  refresh every 3 days + deploy to GitHub Pages
```

## Run locally

```
python scripts/update.py        # refresh data (optional)
python -m http.server 8000      # then open http://localhost:8000
```

Tests: open `http://localhost:8000/tests/core.test.html` and `.../tests/ui.test.html`.

## Corrections

Wrong parameter count, missing lookup-table size, or a model that fails to appear? Edit `data/overrides.json` (keyed by AA family id, e.g. `qwen3-8-flash-next`) and open a PR. The refresh job skips models it cannot resolve and refuses to publish if the scrape returns under 80% of the previous model count.
