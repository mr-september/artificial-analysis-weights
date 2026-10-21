"""Refresh data/models.json: AA leaderboard + AA model-page parameters + Hugging Face sizes + curated overrides.

Sources, in order of precedence for each field:
  total/active params : data/overrides.json > AA model page (`parameters`, `inferenceParametersActiveBillions`)
                        (exact total taken from the HF safetensors header when it agrees with AA within 8%)
  lookup params       : data/overrides.json only (sparse n-gram / per-layer embedding tables)
  stored size / dtype : Hugging Face repo named by AA's `modelWeightsSourceUrl`
Stdlib only. Exit code is 0 even when families are skipped; see data/models.json `skipped`.
"""
import datetime as dt, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hf, scrape_aa

DATA = Path(__file__).resolve().parent.parent / "data"
HF_CACHE = DATA / "hf_cache.json"
BENCH = ("terminalBench40", "terminalBench21", "terminalbenchHard", "tau2", "scicode", "apexAgents", "frontierCode", "livecodebench",
         "omniscienceAccuracy", "hle", "gpqa", "ifbench", "lcr", "mmmuPro", "gdpvalNormalized")
EFFORT = re.compile(r"non-reasoning|reasoning|\blow\b|medium|\bhigh\b|xhigh|minimal|adaptive|\bmax\b|effort", re.I)


def load(p, default):
    return json.loads(p.read_text(encoding="utf8")) if p.exists() else default


def aa_params(slugs):
    """slug -> AA model object (parameters etc.). Every model page embeds the whole catalogue."""
    for slug in slugs:
        try:
            text = scrape_aa.flight_text(scrape_aa.fetch(f"https://artificialanalysis.ai/models/{slug}"))
        except Exception as e:  # noqa: BLE001
            print(f"page {slug} failed: {e}", file=sys.stderr)
            continue
        out = {}
        for m in re.finditer(r'\{"id":"[0-9a-f-]{36}","slug":"', text):
            try:
                o = json.JSONDecoder().raw_decode(text[m.start():])[0]
            except ValueError:
                continue
            if "parameters" in o:
                out[o["slug"]] = o
        if len(out) > 100:
            return out
    sys.exit("could not read parameters from any AA model page")


def clean_name(name):
    m = re.search(r"\s*\(([^)]*)\)\s*$", name)
    return name[:m.start()] if m and EFFORT.search(m.group(1)) else name


def main():
    scrape_aa.main()
    rows = json.loads((DATA / "aa_open.json").read_text(encoding="utf8"))
    top = [r["slug"] for r in sorted(rows, key=lambda r: -(r["index"] or 0))]
    aa = aa_params(top[:5])
    overrides = {k: v for k, v in load(DATA / "overrides.json", {}).items() if not k.startswith("_")}
    cache = load(HF_CACHE, {})

    fams = {}
    for r in rows:
        fams.setdefault(r["family"], []).append(r)

    models, skipped = [], []
    for fam, vs in sorted(fams.items()):
        vs.sort(key=lambda r: -(r["index"] or -1))
        best = vs[0]
        if best["index"] is None:
            skipped.append({"family": fam, "why": "no intelligence index"})
            continue
        meta = next((aa[v["slug"]] for v in vs if v["slug"] in aa and aa[v["slug"]].get("parameters")), None) \
            or next((aa[v["slug"]] for v in vs if v["slug"] in aa), {})
        ov = overrides.get(fam, {})
        notes = []
        total = ov.get("total_b", meta.get("parameters"))
        active = ov.get("active_b", meta.get("inferenceParametersActiveBillions"))
        lookup = ov.get("lookup_b", 0)
        if ov.get("source"):
            notes.append(ov["source"])
        if ov.get("note"):
            notes.append(ov["note"])

        url = meta.get("modelWeightsSourceUrl") or ""
        repo = url.split("huggingface.co/")[-1].strip("/") if "huggingface.co/" in url else None
        info = None
        if repo:
            info = cache.get(repo)
            if not info or not info.get("total_b"):
                info = hf.info(repo) or info or {}
                cache[repo] = info
        info = info or {}
        hf_total = info.get("total_b")
        if total is None and hf_total:
            total = hf_total
            notes.append("total from Hugging Face safetensors header; AA lists no parameter count")
        if total is None:
            skipped.append({"family": fam, "why": "no parameter count", "repo": repo})
            continue
        if hf_total and "total_b" not in ov:
            if abs(hf_total - total) / total <= 0.08:
                total = hf_total
            else:
                notes.append(f"AA lists {total:g}B total but the HF safetensors header counts {hf_total:g}B")
        if active is None or active >= 0.97 * (total - lookup):
            active = total - lookup
            arch = "dense-lookup" if lookup else "dense"
        else:
            arch = "moe-lookup" if lookup else "moe"

        native_gb = None
        if info.get("stored_gb"):
            native_gb = round(min(info["stored_gb"], total * 2), 1)  # F32 checkpoints: assume BF16 was served
        models.append({
            "id": fam,
            "name": clean_name(best["name"]),
            "creator": best["creator"],
            "released": best["released"],
            "repo": repo,
            "license": meta.get("licenseName"),
            "total": round(total, 3), "active": round(active, 3), "lookup": lookup, "arch": arch,
            "native_gb": native_gb,
            "notes": notes,
            "best": best["index"],
            "featured": any(aa.get(v["slug"], {}).get("chartDefaultSelected") for v in vs),  # AA's own model-picker default
            "bench": {k: round(aa[best["slug"]][k], 4) for k in BENCH if isinstance(aa.get(best["slug"], {}).get(k), (int, float))},
            "variants": [{k: v[k] for k in ("slug", "name", "index", "estimated", "reasoning", "tps", "price_in", "price_out", "context")} for v in vs if v["index"] is not None],
        })

    models.sort(key=lambda m: -m["best"])
    old = load(DATA / "models.json", {})
    if old.get("count") and len(models) < 0.8 * old["count"]:
        sys.exit(f"refusing to overwrite: {len(models)} models vs {old['count']} before (scrape probably broke)")
    if old.get("models") == models and old.get("skipped") == skipped:
        print("no data changes")
        HF_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")
        return
    out = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "count": len(models), "skipped": skipped, "models": models}
    (DATA / "models.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf8")
    HF_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"{len(models)} models, skipped {skipped}")
    for m in models:
        for n in m["notes"]:
            if "HF safetensors header counts" in n:
                print(f"  ! {m['id']}: {n}")


if __name__ == "__main__":
    main()
