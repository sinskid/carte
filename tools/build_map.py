"""Build web/data/countries.geojson from a Natural Earth admin-0 GeoJSON.

Usage: python3 tools/build_map.py ne_50m_admin_0_countries.geojson
Source: github.com/nvkelso/natural-earth-vector (geojson/). Country id = ADM0_A3
(ISO_A3 is -99 for France and Norway in Natural Earth).
"""
import json
import sys
from pathlib import Path


def rnd(c):
    return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 3), round(c[1], 3)]


src = json.load(open(sys.argv[1]))
feats = []
for f in src["features"]:
    p = f["properties"]
    feats.append({
        "type": "Feature",
        "properties": {"id": p["ADM0_A3"], "fr": p["NAME_FR"], "en": p["NAME"], "continent": p["CONTINENT"]},
        "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])},
    })
out = Path(__file__).resolve().parent.parent / "web/data/countries.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(feats)} countries -> {out} ({out.stat().st_size // 1024} KB)")
