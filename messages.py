"""Server messages in the page's language (fr, en, es, zh, ar).

The code raises its errors in French; messages.json maps each French text to its translations.
Texts with variable parts ("Spotify a refusé (403) …") are listed as templates with {0}, {1}; the
variable parts are translated in turn when they are themselves known messages. Unknown texts (for
instance a provider's own error) are returned unchanged.
"""
import json
import re
from pathlib import Path

LANGS = ("fr", "en", "es", "zh", "ar")
TABLE = json.loads((Path(__file__).resolve().parent / "messages.json").read_text(encoding="utf-8"))


def _pattern(fr):
    """Regex for a template: {0} = any text, a trailing " {1}" = optional text."""
    out = ""
    for piece in re.split(r"( ?\{[01]\})", fr):
        out += {"{0}": "(.*?)", " {0}": " (.*?)", " {1}": "(?: (.*?))?"}.get(piece, re.escape(piece))
    return re.compile("^" + out + "$", re.S)


TEMPLATES = [(_pattern(fr), fr) for fr in TABLE if "{0}" in fr]


def lang_of(header):
    """The page sends X-Carte-Lang; anything else falls back to French."""
    code = (header or "").strip().lower()[:2]
    return code if code in LANGS else "fr"


def tr(text, lang):
    if lang == "fr" or not text:
        return text
    if text in TABLE:
        return TABLE[text].get(lang, text)
    for pattern, fr in TEMPLATES:
        m = pattern.match(text)
        if m:
            parts = [tr(g or "", lang) for g in m.groups()]
            return TABLE[fr].get(lang, fr).format(*parts).strip()
    return text
