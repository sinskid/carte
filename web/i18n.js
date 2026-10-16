// Interface language: French, English, Spanish, Chinese or Arabic (right to left).
// Texts live in strings.js; static ones are marked in index.html with data-i18n* attributes,
// dynamic ones go through tr(). Country names come from the browser (Intl.DisplayNames) and the
// capital / languages / currency from facts.json's "i18n" entries.
const LANGS = { fr: "Français", en: "English", es: "Español", zh: "中文", ar: "العربية" };

let lang = (() => {
  try {
    const saved = localStorage.getItem("carte.lang");
    if (saved in LANGS) return saved;
  } catch {}
  const browser = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2)).find((l) => l in LANGS);
  return browser ?? "fr";
})();

// tr("key", {n: 3, svc: "Spotify"}): the text in the current language (English, then the key, if missing).
function tr(key, vars = {}) {
  let s = STRINGS[key]?.[lang] ?? STRINGS[key]?.en ?? key;
  if (typeof s === "object") s = s[new Intl.PluralRules(lang).select(vars.n ?? 0)] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  const each = (attr, fn) => document.querySelectorAll(`[${attr}]`).forEach((n) => fn(n, tr(n.getAttribute(attr))));
  each("data-i18n", (n, v) => { n.textContent = v; });
  each("data-i18n-html", (n, v) => { n.innerHTML = v; });     // only our own strings.js texts (links, bold)
  each("data-i18n-ph", (n, v) => { n.placeholder = v; });
  each("data-i18n-title", (n, v) => { n.title = v; });
  each("data-i18n-aria", (n, v) => { n.setAttribute("aria-label", v); });
}

// Country name in the current language: Natural Earth's French / English names, else the browser's
// own translation of the ISO code.
const regionNames = {};
function countryName(p, iso2) {
  if (lang === "fr") return p.fr;
  if (lang !== "en" && iso2) {
    try {
      regionNames[lang] ??= new Intl.DisplayNames([lang], { type: "region", fallback: "none" });
      const name = regionNames[lang].of(iso2);
      if (name) return name;
    } catch {}
  }
  return p.en;
}

// Capital / languages / currency in the current language (French at the top level of facts.json).
const factsIn = (f) => (lang === "fr" ? f : { ...f, ...(f.i18n?.[lang] ?? {}) });
