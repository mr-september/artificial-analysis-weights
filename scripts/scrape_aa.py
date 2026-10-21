"""Scrape open-weights rows from the Artificial Analysis leaderboard page.

The page embeds its table as JSON inside Next.js RSC flight chunks, so no API
key is needed. Output: data/aa_open.json (sorted, stable, so diffs are minimal).
"""
import json, re, sys, urllib.request
from pathlib import Path

URL = "https://artificialanalysis.ai/leaderboards/models"
OUT = Path(__file__).resolve().parent.parent / "data" / "aa_open.json"
OUT_CLOSED = OUT.with_name("aa_closed.json")  # proprietary models: no parameter counts, used only for the frontier column
VARIANT = re.compile(r"-(non-reasoning|reasoning|low|medium|high|xhigh|minimal|adaptive|max)$")


def fetch(url=URL):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (aa-weights data refresh)"})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf8")


def flight_text(html):
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', html, re.S)
    return "".join(json.loads('"' + c + '"') for c in chunks)


def objects(text, marker='{"slug":"'):
    dec = json.JSONDecoder()
    for m in re.finditer(re.escape(marker), text):
        try:
            yield dec.raw_decode(text[m.start():])[0]
        except ValueError:
            pass


def family_of(slug):
    while VARIANT.search(slug):
        slug = VARIANT.sub("", slug)
    return slug


def main():
    text = flight_text(fetch())
    rows, dates = {}, {}
    for o in objects(text):
        if "intelligenceIndex" in o:
            rows[o["slug"]] = o
        elif "releaseDate" in o:
            dates[o["slug"]] = o["releaseDate"]
    if len(rows) < 50:
        sys.exit(f"parse looks wrong: only {len(rows)} model rows")
    out, closed = [], []
    for slug, o in rows.items():
        if o.get("deprecated"):
            continue
        fam = family_of(slug)
        (out if o.get("isOpenWeights") else closed).append({
            "slug": slug,
            "family": fam,
            "name": o["name"],
            "creator": o["modelCreatorName"],
            "reasoning": o["isReasoning"],
            "index": None if o["intelligenceIndex"] is None else round(o["intelligenceIndex"], 2),
            "estimated": bool(o.get("intelligenceIndexIsEstimated")),
            "context": o.get("contextWindowTokens"),
            "released": dates.get(slug) or dates.get(fam),
            "price_in": o.get("price1mInputTokens"),
            "price_out": o.get("price1mOutputTokens"),
            "tps": None if o.get("medianOutputTokensPerSecond") is None else round(o["medianOutputTokensPerSecond"], 1),
        })
    out.sort(key=lambda r: r["slug"])
    closed.sort(key=lambda r: r["slug"])
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    OUT_CLOSED.write_text(json.dumps(closed, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    miss = [r["slug"] for r in out if not r["released"]]
    print(f"{len(out)} open-weights rows ({len(rows)} total); no release date: {miss}")


if __name__ == "__main__":
    main()
