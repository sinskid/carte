"""Build web/data/facts.json: capital, official languages and currency of every map country,
in French (top-level keys) and in English, Spanish, Chinese and Arabic (under "i18n", same keys),
plus its ISO 3166-1 alpha-2 code (iso2, used by the radio tab). Used to pre-fill the "En bref" section of a country's note.

    python3 tools/build_facts.py

Sources: which currencies / languages / capitals a country has comes from the mledoze/countries
dataset (ISO codes, clean and current); their French names come from Wikidata (currency by
ISO 4217 code P498, language by ISO 639-3 code P220, capital as the country's P36). If Wikidata
has no French name, the English one from mledoze is kept.
Keys are Natural Earth ADM0_A3 ids (as in countries.geojson); ids that differ from ISO alpha-3
are listed in ISO_FOR.
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web/data/facts.json"
COUNTRIES_URL = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json"
ISO_FOR = {"KOS": "XKX", "SDS": "SSD", "PSX": "PSE", "SAH": "ESH"}   # ADM0_A3 -> ISO alpha-3
UA = {"User-Agent": "carte-news/1.0 (local map app)"}
# Names Wikidata has no French label for (English from mledoze otherwise).
FR_NAMES = {"Berber": "berbère", "Sami": "same", "Khoisan": "khoïsan", "alémanique": "allemand",
            "Faroese króna": "couronne féroïenne", "Guernsey pound": "livre de Guernesey",
            "Jersey pound": "livre de Jersey", "Manx pound": "livre mannoise",
            "Cook Islands dollar": "dollar des îles Cook", "Kiribati dollar": "dollar des Kiribati",
            "Tuvaluan dollar": "dollar tuvaluan", "Zimbabwean bonds": "dollar zimbabwéen"}
# Map ids absent from mledoze/countries, or with a missing field there.
EXTRA = {
    "KOS": {"capitale": "Pristina", "langues": "albanais, serbe", "monnaie": "euro (€)", "iso2": "XK"},
    "SOL": {"capitale": "Hargeisa", "langues": "somali, arabe", "monnaie": "shilling du Somaliland"},
    "CYN": {"capitale": "Nicosie-Nord", "langues": "turc", "monnaie": "livre turque (₺)"},
    "ALD": {"capitale": "Mariehamn", "langues": "suédois", "monnaie": "euro (€)", "iso2": "AX"},
    "FSM": {"monnaie": "dollar des États-Unis ($)"},
    "MAC": {"capitale": "Macao"},
}


def get_json(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120))


def sparql(query):
    rows = get_json("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query))
    return [(r["code"]["value"], r["label"]["value"]) for r in rows["results"]["bindings"]]


LANGS = ["fr", "en", "es", "zh", "ar"]


def fr_labels(prop, codes, lang="fr"):
    """{code: label in `lang`} for Wikidata items whose `prop` is one of `codes`."""
    values = " ".join(f'"{c}"' for c in sorted(codes))
    out = {}
    for code, label in sparql(f"""SELECT ?code ?label WHERE {{
          VALUES ?code {{ {values} }}
          ?item wdt:{prop} ?code ; rdfs:label ?label . FILTER(LANG(?label) = "{lang}") }}"""):
        out.setdefault(code, label)
    return out


def fr_capitals(isos, lang="fr"):
    """{iso3: [capital labels in `lang`]} from Wikidata P36 (best-rank statements only)."""
    values = " ".join(f'"{c}"' for c in sorted(isos))
    out = {}
    for code, label in sparql(f"""SELECT ?code ?label WHERE {{
          VALUES ?code {{ {values} }}
          ?c wdt:P298 ?code ; wdt:P36 ?v . ?v rdfs:label ?label . FILTER(LANG(?label) = "{lang}") }}"""):
        if label not in out.setdefault(code, []):
            out[code].append(label)
    return out


def main():
    ids = [f["properties"]["id"] for f in
           json.loads((ROOT / "web/data/countries.geojson").read_text(encoding="utf-8"))["features"]]
    src = {c["cca3"]: c for c in get_json(COUNTRIES_URL)}
    isos = {cid: ISO_FOR.get(cid, cid) for cid in ids if ISO_FOR.get(cid, cid) in src}

    cur_codes = {k for i in isos.values() for k in src[i].get("currencies", {})}
    lang_codes = {k for i in isos.values() for k in src[i].get("languages", {})}
    sep = {"zh": "、", "ar": "، "}

    def best(fetch, lang):
        """Labels in `lang`; Chinese prefers simplified script (zh-hans, zh-cn) over plain "zh"."""
        out = {}
        for variant in (["zh-hans", "zh-cn", "zh"] if lang == "zh" else [lang]):
            for code, label in fetch(variant).items():
                out.setdefault(code, label)
        return out

    def lines(lang):
        cur_l = best(lambda v: fr_labels("P498", cur_codes, v), lang)
        lang_l = best(lambda v: fr_labels("P220", lang_codes, v), lang)
        cap_l = best(lambda v: fr_capitals(isos.values(), v), lang)
        # French and Spanish write these names in lower case ("euro", "inglés"); unknown French names have fixes
        low = (lambda n: n[:1].lower() + n[1:]) if lang in ("fr", "es") else (lambda n: n)
        name = (lambda n: FR_NAMES.get(n, low(n))) if lang == "fr" else low
        j = sep.get(lang, ", ")
        out = {}
        for cid, iso in isos.items():
            c = src[iso]
            langs = [name(lang_l.get(k, v)) for k, v in c.get("languages", {}).items()]
            curs = [name(cur_l.get(k, v["name"])) + (f" ({v['symbol']})" if v.get("symbol") else "")
                    for k, v in c.get("currencies", {}).items()]
            caps = cap_l.get(iso) or c.get("capital", [])
            out[cid] = {k: v for k, v in (("capitale", j.join(caps)), ("langues", j.join(langs)),
                                          ("monnaie", j.join(curs))) if v}
        return out

    per_lang = {lang: lines(lang) for lang in LANGS}
    facts = {}
    for cid, iso in isos.items():
        facts[cid] = {**per_lang["fr"][cid], **({"iso2": src[iso]["cca2"]} if src[iso].get("cca2") else {})}
        facts[cid]["i18n"] = {lang: per_lang[lang][cid] for lang in LANGS[1:] if per_lang[lang][cid]}
    for cid, extra in EXTRA.items():
        facts.setdefault(cid, {}).update(extra)          # French only: other languages keep what they have
    facts = {cid: f for cid, f in facts.items() if f}
    OUT.write_text(json.dumps(facts, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    missing = [cid for cid in ids if cid not in facts]
    print(f"{len(facts)} countries written to {OUT.relative_to(ROOT)}; not in the dataset: {' '.join(missing)}")


if __name__ == "__main__":
    main()
