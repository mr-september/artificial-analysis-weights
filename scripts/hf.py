"""Hugging Face helpers: repo discovery and parameter/size metadata (stdlib only)."""
import json, os, re, time, urllib.parse, urllib.request

API = "https://huggingface.co/api"
BAD = re.compile(r"gguf|awq|gptq|mlx|bnb|exl2|exl3|fp8|fp4|nvfp4|int4|int8|w4a|w8a|quant|mxfp|eagle|speculat|draft|-lora|adapter|unsloth|bartowski|dynamic", re.I)


def get(path, params=None, raw=False):
    url = f"{API}/{path}" if not raw else path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": "aa-weights"}
    if os.environ.get("HF_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["HF_TOKEN"]
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=40) as r:
                body = r.read().decode("utf8", "replace")
                return body if raw else json.loads(body)
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.5 * (attempt + 1))


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def info(repo):
    """Parameter counts (billions) per dtype, total, and stored size (GB) for a repo."""
    d = get(f"models/{repo}", {"blobs": "true"})
    if not d:
        return None
    st = d.get("safetensors") or {}
    sib = d.get("siblings") or []
    size = sum(s.get("size") or 0 for s in sib if s["rfilename"].endswith(".safetensors"))
    return {
        "repo": repo,
        "total_b": round(st["total"] / 1e9, 3) if st.get("total") else None,
        "dtypes_b": {k: round(v / 1e9, 3) for k, v in (st.get("parameters") or {}).items()},
        "stored_gb": round(size / 1e9, 1) if size else None,
        "created": (d.get("createdAt") or "")[:10],
        "license": next((t[8:] for t in d.get("tags", []) if t.startswith("license:")), None),
        "downloads": d.get("downloads"),
    }


def readme(repo):
    return get(f"https://huggingface.co/{repo}/raw/main/README.md", raw=True) or ""


def config(repo):
    t = get(f"https://huggingface.co/{repo}/raw/main/config.json", raw=True)
    try:
        return json.loads(t) if t else None
    except ValueError:
        return None


ACTIVE = re.compile(r"(\d+(?:\.\d+)?)\s*([BT])\s*(?:\(?\s*)?(?:active(?:ated)?|activated parameters)|(?:active(?:ated)?)\s*(?:parameters|params)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*([BT])", re.I)


def active_from_text(text):
    out = []
    for m in ACTIVE.finditer(text[:30000]):
        n, u = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        out.append(round(float(n) * (1000 if u.upper() == "T" else 1), 2))
    return out


def discover(family, name, limit=12):
    """Rank non-quantized HF repos that plausibly hold the original checkpoint of an AA family."""
    q = re.sub(r"\(.*?\)", "", name).strip()
    seen, cands = set(), []
    for query in (q, family.replace("-", " ")):
        for r in get("models", {"search": query, "sort": "downloads", "direction": -1, "limit": limit}) or []:
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            tail = r["id"].split("/")[-1]
            if BAD.search(tail) or "quantized" in " ".join(r.get("tags", [])) or "gguf" in r.get("tags", []):
                continue
            fam, t = norm(family), norm(tail)
            score = (2 if t == fam else 1 if fam in t else 0) + (1 if r.get("downloads", 0) > 1000 else 0)
            if score:
                cands.append((score, r.get("downloads", 0), r["id"]))
    cands.sort(reverse=True)
    return [c[2] for c in cands]
