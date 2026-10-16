// Carte: flat world map (Equal Earth) drawn on a canvas, with a side panel per country.
// World space = projected coordinates in a W×H box; "base screen" = world fitted to the
// window (ox + s·x); d3.zoom's transform t maps base screen to screen.
const W = 1000, H = 500;
const projection = d3.geoEqualEarth().fitExtent([[16, 16], [W - 16, H - 16]], { type: "Sphere" });
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const sel = d3.select(canvas);
const $ = (id) => document.getElementById(id);

// Outline detail per zoom level: points closer than eps world units are dropped (1 unit ≈ 1.4 px at zoom 1).
const LEVELS = [{ below: 2, eps: 1 }, { below: 4, eps: 0.45 }, { below: 8, eps: 0.2 }, { below: Infinity, eps: 0 }];

let features = [], selected = null, hovered = null;
let visited = new Set(), colors = {}, sphere, graticule;
let view = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0 };
let t = d3.zoomIdentity, gesture = false, selectedAt = 0;
let inertia = null, samples = [], wheel = null;

// ---------- geometry ----------
// Path2D in world space; eps > 0 drops points closer than eps (cheap simplification for low zoom).
function buildPath(geo, eps = 0) {
  const p = new Path2D();
  let lx = 0, ly = 0;
  const target = !eps ? p : {
    moveTo(x, y) { p.moveTo(x, y); lx = x; ly = y; },
    lineTo(x, y) { if (Math.abs(x - lx) + Math.abs(y - ly) > eps) { p.lineTo(x, y); lx = x; ly = y; } },
    closePath() { p.closePath(); },
    arc() {},
  };
  d3.geoPath(projection, target)(geo);
  return p;
}

// Largest polygon only, so France zooms on mainland France rather than on French Guiana too.
function mainPart(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  const parts = f.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
  return d3.greatest(parts, (p) => d3.geoArea(p));
}

// ---------- drawing ----------
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bg", "sea", "sea-shadow", "land", "land-visited", "land-hover", "accent", "border", "grid"])
    colors[k] = cs.getPropertyValue("--" + k).trim();
  redraw();
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const s = Math.min(r.width / W, r.height / H);
  view = { w: r.width, h: r.height, dpr, s, ox: (r.width - W * s) / 2, oy: (r.height - H * s) / 2 };
  zoom.translateExtent([[-0.3 * r.width, -0.3 * r.height], [1.3 * r.width, 1.3 * r.height]]);
  redraw();
}

let frame = 0;
function redraw() { if (!frame) frame = requestAnimationFrame(draw); }

function draw() {
  frame = 0;
  const { w, h, dpr, s, ox, oy } = view;
  const k = t.k * s;                                  // css px per world unit
  const moving = gesture || inertia || wheel;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (t.x + t.k * ox), dpr * (t.y + t.k * oy));

  if (!moving) {                                      // the blur is the costly part: skip it mid-gesture
    ctx.shadowColor = colors["sea-shadow"];
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
  }
  ctx.fillStyle = colors.sea;
  ctx.fill(sphere);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 0.6 / k;
  ctx.strokeStyle = colors.grid;
  ctx.stroke(graticule);

  // visible world rectangle, to skip countries off screen
  const vx0 = (-t.x / t.k - ox) / s, vy0 = (-t.y / t.k - oy) / s;
  const vx1 = vx0 + w / k, vy1 = vy0 + h / k;
  const shown = features.filter(({ bounds: [[x0, y0], [x1, y1]] }) => x1 > vx0 && x0 < vx1 && y1 > vy0 && y0 < vy1);
  const level = LEVELS.findIndex((l) => t.k < l.below);
  const fade = selected ? Math.min(1, (performance.now() - selectedAt) / 350) : 1;

  for (const f of shown) {
    const id = f.properties.id;
    let c = visited.has(id) ? colors["land-visited"] : colors.land;   // notes no longer tint the map
    if (f === hovered && f !== selected) c = colors["land-hover"];
    if (f === selected) c = d3.interpolateRgb(c, colors.accent)(fade);
    ctx.globalAlpha = selected && f !== selected ? 1 - 0.45 * fade : 1;
    ctx.fillStyle = c;
    ctx.fill(f.paths[level]);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 0.7 / k;
  ctx.strokeStyle = colors.border;
  for (const f of shown) ctx.stroke(f.paths[level]);

  if (fade < 1) redraw();
}

// Country under a screen point, or null.
function hit(mx, my) {
  const { s, ox, oy } = view;
  const [bx, by] = t.invert([mx, my]);
  const x = (bx - ox) / s, y = (by - oy) / s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return features.find(({ bounds: [[x0, y0], [x1, y1]], full }) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1 && ctx.isPointInPath(full, x, y)) ?? null;
}

// ---------- movement: drag + inertia, smooth wheel, animated fly-to ----------
const zoom = d3.zoom()
  .scaleExtent([1, 16])
  .clickDistance(4)
  .filter((e) => !e.ctrlKey && !e.button && e.type !== "wheel")   // wheel handled below
  .on("start", (e) => { if (e.sourceEvent) { stopInertia(); gesture = true; } })
  .on("zoom", (e) => { t = e.transform; trackVelocity(e.sourceEvent); redraw(); })
  .on("end", (e) => { if (e.sourceEvent) { gesture = false; startInertia(); } redraw(); });
sel.call(zoom).on("dblclick.zoom", null);

function trackVelocity(se) {
  if (!se || !/move$/.test(se.type)) return;
  const now = performance.now();
  samples.push({ x: t.x, y: t.y, time: now });
  while (now - samples[0].time > 100) samples.shift();
}

function startInertia() {
  const a = samples[0], b = samples[samples.length - 1];
  samples = [];
  if (!a || a === b || performance.now() - b.time > 50) return;  // released without a throw
  let vx = (b.x - a.x) / (b.time - a.time), vy = (b.y - a.y) / (b.time - a.time);   // px/ms
  let last = performance.now();
  inertia = d3.timer(() => {
    const now = performance.now(), dt = now - last;
    last = now;
    const decay = Math.pow(0.994, dt);
    vx *= decay; vy *= decay;
    if (Math.hypot(vx, vy) < 0.02) return stopInertia();
    sel.call(zoom.translateBy, (vx * dt) / t.k, (vy * dt) / t.k);
  });
}

function stopInertia() {
  if (!inertia) return;
  inertia.stop();
  inertia = null;
  redraw();
}

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  stopInertia();
  sel.interrupt();
  const delta = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002) * (e.ctrlKey ? 10 : 1);
  const [lo, hi] = zoom.scaleExtent();
  const target = Math.max(lo, Math.min(hi, (wheel?.target ?? t.k) * Math.pow(2, delta)));
  const anchor = d3.pointer(e, canvas);
  if (wheel) { Object.assign(wheel, { target, anchor }); return; }
  wheel = { target, anchor };
  let last = performance.now();
  wheel.timer = d3.timer(() => {
    const now = performance.now(), ease = 1 - Math.pow(0.8, (now - last) / 16);
    last = now;
    const done = Math.abs(wheel.target - t.k) < 0.002 * wheel.target;
    sel.call(zoom.scaleTo, done ? wheel.target : t.k + (wheel.target - t.k) * ease, wheel.anchor);
    if (done) { wheel.timer.stop(); wheel = null; redraw(); }
  });
}, { passive: false });

function zoomTo(f) {
  const [[x0, y0], [x1, y1]] = f.main;
  const { w, h, s, ox, oy } = view;
  const panelW = window.innerWidth > 640 ? $("panel").offsetWidth + 32 : 0;
  const k = Math.min(8, 0.6 * Math.min((w - panelW) / ((x1 - x0) * s), h / ((y1 - y0) * s)));
  const target = d3.zoomIdentity
    .translate((w - panelW) / 2, h / 2)              // centre of the area left of the panel
    .scale(k)
    .translate(-(ox + s * (x0 + x1) / 2), -(oy + s * (y0 + y1) / 2));
  stopInertia();
  sel.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform, target);
}

// ---------- pointer ----------
canvas.addEventListener("pointermove", (e) => {
  if (e.buttons || inertia || wheel) return hideTooltip();
  const f = hit(e.offsetX, e.offsetY);
  if (f !== hovered) { hovered = f; canvas.style.cursor = f ? "pointer" : ""; redraw(); }
  f ? showTooltip(e, nameOf(f)) : hideTooltip();
});
canvas.addEventListener("pointerleave", () => { hovered = null; hideTooltip(); redraw(); });
sel.on("click", (e) => {
  const f = hit(e.offsetX, e.offsetY);
  f ? select(f) : closePanel();
});

async function init() {
  const [geo, factsData] = await Promise.all([
    d3.json("data/countries.geojson"),
    fetch("data/facts.json").then((r) => r.json()).catch(() => ({})),
    loadState(),
  ]);
  facts = factsData;
  features = geo.features;
  const path = d3.geoPath(projection);
  sphere = buildPath({ type: "Sphere" });
  graticule = buildPath(d3.geoGraticule10());
  for (const f of features) {
    f.paths = LEVELS.map((l) => buildPath(f, l.eps));
    f.full = f.paths[LEVELS.length - 1];
    f.bounds = path.bounds(f);
    f.main = path.bounds(mainPart(f));
  }
  readColors();
  fillCountryList();
  renderFavbar();
  if (server?.music[svc]) loadPlaylists();
  const saved = readLocal("carte.wizard", null);           // assistant left for Google / Spotify's sign-in page
  if (saved) { openWizard(saved); if (server && location.hash.startsWith("#connexions")) signInResult().then(showWizPage); }
  else if (server && location.hash.startsWith("#connexions")) openSettings();
  else if (!readLocal("carte.onboarded", false)) openWizard();
  resize();
  window.addEventListener("resize", resize);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

  const fromHash = features.find((f) => f.properties.id === location.hash.slice(1));
  if (fromHash) select(fromHash);
}

// Country names in the interface language (i18n.js); the search list follows it.
const nameOf = (f) => countryName(f.properties, facts[f.properties.id]?.iso2);
function fillCountryList() {
  $("country-list").replaceChildren(...features.map(nameOf).sort((a, b) => a.localeCompare(b, lang))
    .map((n) => { const o = el("option"); o.value = n; return o; }));
}

// The country a station / channel belongs to: known for new favourites, else found from the saved
// name (any language: favourites saved earlier carry the name only).
function countryIdOf(item, country) {
  if (item.countryId) return item.countryId;
  if (selected && country === nameOf(selected)) return selected.properties.id;
  return features.find((f) => [f.properties.fr, f.properties.en, nameOf(f)].includes(country))?.properties.id ?? null;
}

// Clicking the radio player (or the TV window's title) opens that country on the right tab, the
// station or channel scrolled into view once its list has loaded.
let revealPlaying = null;                             // "radio" | "tv" while waiting for that list
function openPlayingCountry(kind) {
  const id = kind === "radio" ? playing?.countryId : watching?.countryId;
  const f = id && features.find((x) => x.properties.id === id);
  if (!f) return;
  revealPlaying = kind;
  if (f !== selected) select(f);
  document.querySelector(`[data-tab=${kind}]`).click();
  kind === "radio" ? renderStations() : renderChannels();   // already loaded: reveal now
}
function revealRow(kind, list) {
  if (revealPlaying !== kind) return;
  const row = list.querySelector(".playing");
  if (row) { revealPlaying = null; row.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

function showTooltip(e, text) {
  const tip = $("tooltip");
  tip.textContent = text; tip.hidden = false;
  tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px";
}
function hideTooltip() { $("tooltip").hidden = true; }

// ---------- personal state: favourites + visited countries ----------
// With the local server (python3 server.py) they are files in data/ and the music features are
// on; on a static host (GitHub Pages) they live in this browser's localStorage.
let server = null;                                    // null = static mode, else {music: {audd, youtube}}

async function loadState() {
  try {
    const r = await fetch("/api/state", { headers: { "X-Carte-Lang": lang } });
    if (r.ok && r.headers.get("Content-Type")?.includes("json")) {
      const st = await r.json();
      server = st;
      favs = st.favorites;
      visited = new Set(st.visited);
    }
  } catch {}
  if (!server) {
    favs = readLocal("carte.favorites", { radio: [], tv: [] });
    visited = new Set(readLocal("carte.visited", []));
  }
  document.body.classList.toggle("with-server", !!server);
  applyMusicState();
}

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveState(kind) {
  const value = kind === "favorites" ? favs : [...visited];
  if (server) {
    fetch(`/api/${kind}`, { method: "PUT", body: JSON.stringify(value) }).catch(() => {});
  } else {
    try { localStorage.setItem(`carte.${kind}`, JSON.stringify(value)); } catch {}
  }
}

// Which music services are connected: shows "Ma musique", the YouTube / Spotify switch.
function applyMusicState() {
  const m = server?.music ?? {};
  if (!m[svc]) svc = m.youtube ? "youtube" : m.spotify ? "spotify" : svc;
  document.body.classList.toggle("with-music", !!(m.youtube || m.spotify));
  document.querySelectorAll(".svc-pick").forEach((e) => { e.hidden = !(m.youtube && m.spotify); });   // 3 switches
  document.body.dataset.svc = m.youtube || m.spotify ? svc : "";   // ♫ button: red = YouTube, green = Spotify
  document.querySelectorAll("[data-svc]").forEach((b) => b.classList.toggle("active", b.dataset.svc === svc));
}

// ---------- panel ----------
async function select(f) {
  if (f !== selected) closeSongCard();
  selected = f;
  selectedAt = performance.now();
  hovered = null;
  const p = f.properties;
  renderPanelHead();
  $("panel").classList.add("open");
  $("panel").setAttribute("aria-hidden", "false");
  history.replaceState(null, "", "#" + p.id);
  zoomTo(f);
  redraw();
  if (!$("tab-radio").hidden) loadRadio();
  if (!$("tab-tv").hidden) loadTv();
}

// Continent, name (+ English, or French when the page is in English), facts, visited button.
function renderPanelHead() {
  const p = selected.properties;
  $("continent").textContent = tr("continent." + p.continent);
  const name = nameOf(selected), other = lang === "en" ? p.fr : p.en;
  $("name").textContent = name;
  $("name-en").textContent = other !== name ? other : "";
  renderFacts(p.id);
  renderVisited();
}

function closePanel() {
  if (!selected) return;
  selected = null;
  history.replaceState(null, "", location.pathname);
  $("panel").classList.remove("open");
  $("panel").setAttribute("aria-hidden", "true");
  redraw();
}

// Capital, languages, currency (web/data/facts.json).
function renderFacts(id) {
  const f = factsIn(facts[id] ?? {});
  const rows = [[tr("facts.capital"), f.capitale], [tr("facts.languages"), f.langues], [tr("facts.currency"), f.monnaie]].filter(([, v]) => v);
  $("facts").replaceChildren(...rows.map(([k, v]) => {
    const row = el("div", "fact");
    row.append(el("span", "muted", k), el("span", null, v));
    return row;
  }));
}

function renderVisited() {
  const on = visited.has(selected.properties.id);
  $("visited").classList.toggle("on", on);
  $("visited").textContent = tr(on ? "visited.yes" : "visited.no");
}
$("visited").onclick = () => {
  const id = selected.properties.id;
  visited.has(id) ? visited.delete(id) : visited.add(id);
  saveState("visited");
  renderVisited();
  redraw();
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

// ---------- radio (stations from the public Radio Browser API) ----------
// Same idea as tvgarden.world's radio: stations per country, a player that keeps playing
// across countries, and fallback to the station's next URL when a stream fails.
const RADIO_API = "https://all.api.radio-browser.info/json";
const audio = $("audio");
let facts = {}, stations = [], radioFor = null, playing = null;

async function loadRadio() {
  const p = selected?.properties;
  if (!p || radioFor === p.id) return;
  radioFor = p.id;
  stations = [];
  $("radio-filter").value = "";
  renderStations();
  const iso2 = facts[p.id]?.iso2;
  if (!iso2) return setRadioStatus(tr("radio.noCode"));
  setRadioStatus(tr("radio.loading"));
  try {
    const url = `${RADIO_API}/stations/bycountrycodeexact/${iso2}?hidebroken=true&order=clickcount&reverse=true&limit=500`;
    const list = await fetch(url).then((r) => r.json());
    if (radioFor !== p.id) return;                    // another country was selected meanwhile
    const seen = new Set();                           // the API has many duplicates: keep the most played
    stations = list.filter((s) => {
      const key = s.name.trim().toLowerCase();
      return key && !seen.has(key) && seen.add(key);
    });
    renderStations();
    if (!stations.length) setRadioStatus(tr("radio.none"));
  } catch {
    if (radioFor === p.id) { radioFor = null; setRadioStatus(tr("radio.down")); }
  }
}

function stationRow(s, country, showCountry) {
  const li = el("li", "station" + (playing?.stationuuid === s.stationuuid ? " playing" : ""));
  const icon = el("div", "station-icon", "♪");
  if (s.favicon?.startsWith("https://")) {
    const img = el("img"); img.src = s.favicon; img.alt = ""; img.loading = "lazy";
    img.onerror = () => img.remove();
    icon.replaceChildren(img);
  }
  const text = el("div", "station-text");
  text.append(el("div", "station-name", s.name.trim()));
  const tags = (s.tags ?? "").split(",").filter(Boolean).slice(0, 3).join(", ");
  text.append(el("div", "station-meta", [showCountry && country, tags, s.codec !== "UNKNOWN" && s.codec, s.bitrate && `${s.bitrate} kb/s`].filter(Boolean).join(" · ")));
  li.append(icon, text, favButton("radio", s, country));
  li.onclick = () => play(s, country);
  return li;
}

function setRadioStatus(text) { $("radio-status").textContent = text; }

function renderStations() {
  const q = $("radio-filter").value.trim().toLowerCase();
  const shown = stations.filter((s) => !q || `${s.name} ${s.tags}`.toLowerCase().includes(q));
  const country = selected && nameOf(selected);
  $("radio-list").replaceChildren(...shown.slice(0, 200).map((s) => stationRow(s, country)));
  revealRow("radio", $("radio-list"));
  renderFavbar();
  if (stations.length)
    setRadioStatus(tr("radio.count", { n: shown.length }) + (shown.length > 200 ? tr("radio.first200") : ""));
}

// ---------- favourites (content/favorites.json via the server), shared by radio and TV ----------
// Each favourite keeps what is needed to play it from any country: the station / channel
// fields plus the country's name, so the "Favoris" list at the top of each tab works everywhere.
let favs = { radio: [], tv: [] };
const FAV_KEY = { radio: "stationuuid", tv: "nanoid" };
const FAV_FIELDS = {
  radio: ["stationuuid", "name", "url", "url_resolved", "hls", "favicon", "tags", "codec", "bitrate"],
  tv: ["nanoid", "name", "sources", "languages", "isGeoBlocked"],
};

const isFav = (kind, item) => favs[kind].some((f) => f[FAV_KEY[kind]] === item[FAV_KEY[kind]]);

let justLiked = null;                                 // id of the item just added: its heart "pops" once

function toggleFav(kind, item, country) {
  const key = FAV_KEY[kind];
  justLiked = isFav(kind, item) ? null : item[key];
  if (isFav(kind, item)) favs[kind] = favs[kind].filter((f) => f[key] !== item[key]);
  else favs[kind].push({ ...Object.fromEntries(FAV_FIELDS[kind].map((k) => [k, item[k]])), country, countryId: countryIdOf(item, country) });
  saveState("favorites");
  kind === "radio" ? renderStations() : renderChannels();
  justLiked = null;
}

// Solid rounded heart, as in Spotify's "liked" button (path: Material Icons "favorite", Apache 2.0).
const HEART = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

function favButton(kind, item, country) {
  const on = isFav(kind, item);
  const b = el("button", "fav" + (on ? " on" : "") + (on && item[FAV_KEY[kind]] === justLiked ? " pop" : ""));
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`;
  b.setAttribute("aria-pressed", on);
  b.title = tr(on ? "fav.remove" : "fav.add");
  b.onclick = (e) => { e.stopPropagation(); toggleFav(kind, item, country); };
  return b;
}

// Left sidebar: every favourite, whatever country is open; a click plays it.
function favRow(kind, item) {
  const now = kind === "radio" ? playing?.stationuuid === item.stationuuid : watching?.nanoid === item.nanoid;
  const li = el("li", "station" + (now ? " playing" : ""));
  const icon = el("div", "station-icon", kind === "radio" ? "♪" : "▶");
  if (item.favicon?.startsWith("https://")) {
    const img = el("img"); img.src = item.favicon; img.alt = ""; img.loading = "lazy";
    img.onerror = () => img.remove();
    icon.replaceChildren(img);
  }
  const text = el("div", "station-text");
  const f = features.find((x) => x.properties.id === countryIdOf(item, item.country));   // shown in today's language
  text.append(el("div", "station-name", item.name.trim()), el("div", "station-meta", f ? nameOf(f) : item.country ?? ""));
  li.append(icon, text, favButton(kind, item, item.country));
  li.onclick = () => (kind === "radio" ? play(item, item.country) : watch(item, item.country));
  return li;
}

function renderFavbar() {
  const n = favs.radio.length + favs.tv.length;
  $("favbar").hidden = !n;
  $("favbar-count").textContent = n;
  for (const kind of ["radio", "tv"]) {
    const box = $(`favbar-${kind}`);
    box.hidden = !favs[kind].length;
    box.querySelector("ul").replaceChildren(...favs[kind].map((f) => favRow(kind, f)));
  }
}

$("favbar-heart").setAttribute("d", HEART);
$("favbar-toggle").onclick = () => {
  const open = !$("favbar").classList.toggle("collapsed");
  $("favbar-toggle").setAttribute("aria-expanded", open);
};
if (matchMedia("(max-width: 640px)").matches) $("favbar-toggle").onclick();   // folded on phones

// ---------- playback shared by radio and TV ----------
function stopMedia(media) {
  media.unwatch?.(); media.unwatch = null;
  if (media.hls) { media.hls.destroy(); media.hls = null; }
  media.removeAttribute("src");
  media.load();
}

// Resolves true once the media element is actually playing url, false on error or timeout.
// HLS goes through hls.js when the browser has no native HLS (Firefox).
function tryUrl(media, url, isHls, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;                              // later errors are watchStream's business, not this
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); media.onplaying = media.onerror = null;
      if (!ok) stopMedia(media);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    media.onplaying = () => done(true);
    media.onerror = () => done(false);
    const needsHls = (isHls || /\.m3u8(\?|$)/i.test(url)) && !media.canPlayType("application/vnd.apple.mpegurl");
    if (needsHls && window.Hls?.isSupported()) {
      media.hls = new Hls({ manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6 });
      media.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) done(false); });
      media.hls.loadSource(url);
      media.hls.attachMedia(media);
    } else {
      media.src = url;
    }
    media.play().catch(() => {});                     // failures arrive through onerror / the timeout
  });
}

function setPlayer(state) {
  $("player").hidden = !playing;
  if (!playing) return;
  $("player-name").textContent = playing.name.trim();
  $("player").querySelector(".player-text").title = tr("player.openCountry", { country: playing.country });
  $("player-state").textContent = playing.song ? `♪ ${playing.song.artist} – ${playing.song.title}` : state;
  $("player-toggle").textContent = audio.paused ? "▶" : "❚❚";
  $("player-toggle").title = tr(audio.paused ? "player.play" : "player.pause");
}

// Live streams drop now and then (a network blip, the station's server closing the connection):
// once a stream plays, this watches it, and an error, its end, or 10 s without data → onDrop, once.
// Passing HLS errors are repaired in place. A drop while paused only marks the stream as dead:
// it reconnects when ▶ is pressed, not by itself.
function watchStream(media, isCurrent, onDrop) {
  let stall = null;
  const drop = () => {
    if (!isCurrent()) return;
    if (media.paused && !media.ended) { media.dead = onDrop; return; }
    stopMedia(media);
    onDrop();
  };
  const waiting = () => { clearTimeout(stall); stall = setTimeout(drop, 10000); };
  const flowing = () => clearTimeout(stall);
  const onHls = (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) media.hls.recoverMediaError();
    else drop();
  };
  const events = { error: drop, ended: drop, waiting, stalled: waiting, playing: flowing, timeupdate: flowing };
  for (const [e, h] of Object.entries(events)) media.addEventListener(e, h);
  media.hls?.on(Hls.Events.ERROR, onHls);
  media.dead = null;
  media.unwatch = () => {
    clearTimeout(stall);
    for (const [e, h] of Object.entries(events)) media.removeEventListener(e, h);
    media.hls?.off(Hls.Events.ERROR, onHls);
  };
}

// Try each URL of the station in turn until one plays; reconnect the same way if it drops later.
async function play(s, country) {
  closeSongCard();
  closeTv();
  stopMedia(audio);
  playing = { ...s, country, countryId: countryIdOf(s, country) };
  renderStations();
  fetch(`${RADIO_API}/url/${s.stationuuid}`).catch(() => {});   // counts the click, as the API asks clients to
  connectRadio(s, country, 0);
}

const RETRY_WAIT = [2, 4, 8, 15];                     // seconds before reconnection attempts 1, 2, 3, 4
async function connectRadio(s, country, attempt) {
  const mine = () => playing?.stationuuid === s.stationuuid;    // another station may be chosen meanwhile
  const urls = [...new Set([s.url_resolved, s.url].filter(Boolean))];
  for (const url of urls) {
    if (!mine()) return;
    setPlayer(`${country} · ${tr(attempt ? "state.reconnecting" : "state.connecting")}`);
    if (await tryUrl(audio, url, s.hls)) {
      if (!mine()) return;
      playing.streamUrl = url;
      setPlayer(`${country} · ${tr("state.live")}`);
      nowPlaying();
      watchStream(audio, mine, () => connectRadio(s, country, 1));
      return;
    }
  }
  if (!mine()) return;
  if (attempt && attempt <= RETRY_WAIT.length) {      // it was playing: keep trying for a while
    setPlayer(`${country} · ${tr("state.reconnecting")}`);
    setTimeout(() => mine() && connectRadio(s, country, attempt + 1), RETRY_WAIT[attempt - 1] * 1000);
  } else setPlayer(`${country} · ${tr("state.unavailable")}`);
}

$("radio-filter").addEventListener("input", renderStations);
$("player-toggle").onclick = () => {
  if (audio.dead) { const again = audio.dead; audio.dead = null; stopMedia(audio); again(); }   // dropped while paused
  else if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
};
function stopRadio() { if (playing) { stopMedia(audio); playing = null; setPlayer(); renderStations(); closeSongCard(); } }
$("player-stop").onclick = stopRadio;
audio.addEventListener("playing", () => playing && setPlayer(`${playing.country} · ${tr("state.live")}`));
audio.addEventListener("pause", () => playing && setPlayer(`${playing.country} · ${tr("state.paused")}`));

// ---------- song identification + YouTube playlist (server side: music.py) ----------
// The station's own "now playing" title is polled while the radio plays; the ♫ button asks the
// server to identify the song (station title, else AudD on a 10 s clip), then shows YouTube
// matches that can be added to the user's playlist. Tokens stay on the server.
// Music routes take the chosen service (YouTube or Spotify).
let svc = readLocal("carte.service", "youtube");
const mApi = (path, body = {}) => api(path, { ...body, service: svc });
const svcName = (s = svc) => (s === "spotify" ? "Spotify" : "YouTube");
// Search results and playlist songs remember their service: a Spotify id must never reach the
// YouTube player ("vidéo indisponible") or a YouTube playlist, even after switching service.
const tagged = (items) => items.map((v) => ({ ...v, service: svc }));

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Carte-Lang": lang },
                                body: JSON.stringify(body) });                // errors come back in this language
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || tr("error.http", { status: r.status }));
  return data;
}

async function nowPlaying() {
  const p = playing;
  if (!server || !p?.streamUrl || audio.paused) return;
  try {
    const { song } = await api("/api/nowplaying", { url: p.streamUrl });
    if (playing === p) { p.song = song; setPlayer(`${p.country} · ${tr("state.live")}`); }
  } catch {}
}
setInterval(nowPlaying, 20000);

function closeSongCard() {
  $("song-card").hidden = true;
  if (queue?.preview) closeTv();
}
$("song-close").onclick = closeSongCard;

// ♫ asks what is playing: the station's own title if it sends one, else AudD listens to a clip.
// "🎤 Reconnaître l'audio" always listens (like Shazam), for stations that send a wrong title.
async function identifySong(audio = false) {
  const p = playing;
  if (!p?.streamUrl) return;
  const card = $("song-card");
  card.hidden = false;
  if (!audio) { $("song-title").hidden = true; $("song-search").hidden = true; $("song-source").hidden = true; }
  $("song-results").replaceChildren();
  const listen = $("song-listen");
  listen.hidden = false; listen.disabled = true; listen.textContent = tr("song.listening");
  $("song-status").textContent = audio ? "" : tr("song.finding");
  try {
    const { song } = await api("/api/identify", { url: p.streamUrl, audio });
    if (playing !== p || card.hidden) return;
    if (!song) {
      $("song-status").textContent = tr("song.notFound");
      $("song-search").hidden = false;
      return;
    }
    p.song = song; setPlayer(`${p.country} · ${tr("state.live")}`);
    $("song-title").textContent = `${song.artist} – ${song.title}`;
    $("song-title").hidden = false;
    const fromRadio = song.source === "radio";
    $("song-source").textContent = tr(fromRadio ? "song.fromRadio" : "song.byEar");
    $("song-source").hidden = false;
    $("song-query").value = `${song.artist} ${song.title}`;
    $("song-search").hidden = false;
    await ytSearch();
  } catch (e) {
    if (!card.hidden) { $("song-status").textContent = e.message; $("song-search").hidden = false; }
  } finally {
    listen.disabled = false; listen.textContent = tr("song.listen");
  }
}
$("player-identify").onclick = () => identifySong();
$("song-listen").onclick = () => identifySong(true);

// The query is editable: radio titles are sometimes truncated or odd, so the user can fix it.
async function ytSearch() {
  const q = $("song-query").value.trim();
  if (!q) return;
  $("song-status").textContent = tr("song.searching", { svc: svcName() });
  $("song-results").replaceChildren();
  try {
    const results = tagged((await mApi("/api/yt-search", { q })).results);
    if ($("song-card").hidden) return;
    $("song-status").textContent = tr(results.length ? "song.results" : "song.nothing", { svc: svcName() });
    $("song-results").replaceChildren(...results.map(songResult));
  } catch (e) {
    $("song-status").textContent = e.message;
  }
}
$("song-search").onsubmit = (e) => { e.preventDefault(); ytSearch(); };

// Playlist menu: the choice is saved on the server as the default (config.json); the last
// option re-reads the playlists from YouTube, for ones created since.
const SYNC = "__sync";
function fillPlaylists({ playlists, default: def }) {
  const sel = $("song-playlist");
  const opts = playlists.map((p) => { const o = el("option", null, plTitle(p)); o.value = p.id; return o; });
  const sync = el("option", null, tr("song.refresh", { svc: svcName() })); sync.value = SYNC;
  sel.replaceChildren(...opts, sync);
  sel.value = def ?? playlists[0]?.id ?? SYNC;
  sel.dataset.current = sel.value;
}
async function loadPlaylists() {
  try { fillPlaylists(await mApi("/api/playlists", {})); } catch {}
}
$("song-playlist").onchange = async () => {
  const sel = $("song-playlist");
  sel.disabled = true;
  try {
    fillPlaylists(sel.value === SYNC ? await mApi("/api/playlists/sync", {})
                                     : await mApi("/api/playlists/default", { playlistId: sel.value }));
  } catch (e) {
    sel.value = sel.dataset.current;
    $("song-status").textContent = e.message;
  }
  sel.disabled = false;
};
loadPlaylists();

function songResult(v) {
  const li = el("li", "song-result");
  const img = el("img"); img.src = v.thumb; img.alt = ""; img.loading = "lazy";
  const link = el("div", "song-text"); link.title = tr("song.listenHere");
  li.dataset.videoId = v.id;
  li.onclick = () => previewSong(v);
  const mins = v.duration ? ` · ${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, "0")}` : "";
  link.append(el("div", "station-name", v.title), el("div", "station-meta", (v.channel ?? "") + mins));
  const add = el("button", "song-add", tr("add"));
  add.onclick = async (e) => {
    e.stopPropagation();
    add.disabled = true; add.textContent = "…";
    try {
      const r = await api("/api/playlist/add", { videoId: v.id, service: v.service,
                                                 playlistId: $("song-playlist").dataset.current || undefined });
      add.textContent = tr(r.already ? "already" : "added");
      add.classList.add("done");
      if (!r.already) add.after(undoButton(r, v, add));
    } catch (e) {
      add.disabled = false; add.textContent = tr("add");
      $("song-status").textContent = e.message;
    }
  };
  li.append(img, link, add);
  return li;
}

// "Annuler" next to "Ajouté ✓": takes back an add made by mistake.
const undoAdd = (r, videoId, service) =>
  api("/api/yt/item/remove", { service, playlistId: r.playlistId, itemId: r.itemId, videoId });
function undoButton(r, v, add) {
  const undo = el("button", "song-undo", tr("cancel"));
  undo.title = tr("song.undoTitle");
  undo.onclick = async (e) => {
    e.stopPropagation();
    undo.disabled = true;
    try {
      await undoAdd(r, v.id, v.service);
      undo.remove();
      add.disabled = false; add.textContent = tr("add"); add.classList.remove("done");
    } catch (err) { undo.disabled = false; $("song-status").textContent = err.message; }
  };
  return undo;
}

// Trying a proposed song: the radio is paused (not stopped, so the card stays) and the video plays
// in the local video window; closing that window resumes the radio.
function previewSong(v) {
  playQueue([v], 0, v.title, v.id, { preview: true });
  $("song-results").querySelectorAll(".song-result").forEach((li) => li.classList.toggle("previewing", li.dataset.videoId === v.id));
}

// ---------- "Ma musique": the user's YouTube playlists (server side: music.py section 4) ----------
// Lists, creates, edits and deletes playlists, removes / moves songs, searches YouTube (yt-dlp)
// and plays videos or whole playlists in the TV window (youtube.com embed, so private playlists
// play when the browser is signed in to YouTube).
// "12 vidéos · Privée"; Spotify: "12 titres", privacy unknown (its API reads every playlist as public)
const countLabel = (n) => tr(svc === "spotify" ? "count.tracks" : "count.videos", { n });
const metaLine = (p) => [countLabel(p.count), p.privacy && tr("privacy." + p.privacy)].filter(Boolean).join(" · ");
const plTitle = (p) => (p.id === "liked" ? tr("liked") : p.title);   // Spotify's Liked Songs, named by the page
let ytLists = [], ytOpen = null, ytItems = [];

// Music playback: our own queue in YouTube's IFrame player, one video at a time. (YouTube's own
// playlist embed fails for private playlists, the embed not seeing the user's login.) Videos known
// to be unplayable here are skipped, and so are those the player reports as failing.
let ytApi = null, ytPlayer = null, queue = null;
function loadYtApi() {
  ytApi ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
  });
  return ytApi;
}

// Spotify: full tracks through the Web Playback SDK, which makes this page a Spotify device
// ("Carte"; Premium only, and the browser must allow DRM). The SDK needs an access token in the
// page: the server hands out short-lived ones (/api/spotify/token). If anything fails (old sign-in
// without the playback rights, no Premium, DRM off), Spotify's embed plays 30 s extracts instead.
let spReady = null, spPlayer = null, spTok = null;
async function spToken() {
  if (!spTok || Date.now() > spTok.until) {
    const { token, expiresIn } = await api("/api/spotify/token", {});
    spTok = { token, until: Date.now() + (expiresIn - 30) * 1000 };
  }
  return spTok.token;
}
function loadSpotify() {
  spReady ??= spToken().then(() => new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error(tr("sp.noResponse"))), 15000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      spPlayer = new Spotify.Player({ name: "Carte", volume: 0.8,
                                      getOAuthToken: (cb) => spToken().then(cb, () => cb("")) });
      spPlayer.addListener("ready", ({ device_id }) => resolve(device_id));
      for (const ev of ["initialization_error", "authentication_error", "account_error"])
        spPlayer.addListener(ev, ({ message }) => reject(new Error(message)));
      spPlayer.addListener("player_state_changed", spState);
      spPlayer.connect();
    };
    const sdk = document.createElement("script");
    sdk.src = "https://sdk.scdn.co/spotify-player.js";
    sdk.onerror = () => reject(new Error(tr("sp.missing")));
    document.head.append(sdk);
  }));
  spReady.catch(() => { spReady = null; });           // try again next time (e.g. after reconnecting)
  return spReady;
}

// Track shown in the TV window, kept in sync with what Spotify plays (it moves through the playlist itself).
let spPos = null;                                     // {position, duration, paused, at}: drives the time bar
function spState(st) {
  if (st && queue?.spotify && st.track_window.current_track.id !== queue.trackId) {
    queue.trackId = st.track_window.current_track.id;
    resetTvAdd();
  }
  if (!st) return;
  if (!queue?.spotify) { if (!st.paused) spPlayer.pause(); return; }   // started from elsewhere while YouTube plays
  spPos = { position: st.position, duration: st.duration, paused: st.paused, at: performance.now() };
  spTick();
  const t = st.track_window.current_track;
  $("tv-name").textContent = t.name;
  $("tv-state").textContent = t.artists.map((a) => a.name).join(", ");
  $("sp-cover").src = t.album.images.at(-1)?.url ?? "";
  $("sp-toggle").textContent = st.paused ? "▶" : "⏸";
  const i = queue.items.findIndex((v) => (v.videoId ?? v.id) === t.id);
  if (i >= 0 && i !== queue.i) { queue.i = i; markPlaying(); }
}
// Play / pause. The click also "activates" the SDK's audio element: without it the browser's
// autoplay block leaves a song started by code paused at 0:00.
$("sp-toggle").onclick = async () => {
  if (!spPlayer) return;
  spPlayer.activateElement();
  const st = await spPlayer.getCurrentState();
  if (!st) return queue?.spotify && replaySpotify();   // Carte is no longer the active device: take it back
  await (st.paused ? spPlayer.resume() : spPlayer.pause());
};

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
function spTick() {                                   // the SDK reports changes only: interpolate in between
  if (!spPos || $("tv-sp").hidden) return;
  const pos = Math.min(spPos.duration, spPos.position + (spPos.paused ? 0 : performance.now() - spPos.at));
  if (!seeking) $("sp-seek").value = spPos.duration ? Math.round(pos / spPos.duration * 1000) : 0;
  $("sp-time").textContent = mmss(seeking ? $("sp-seek").value / 1000 * spPos.duration : pos);
  $("sp-dur").textContent = mmss(spPos.duration);
}
setInterval(spTick, 500);
let seeking = false;
$("sp-seek").oninput = () => { seeking = true; spTick(); };
$("sp-seek").onchange = () => {
  seeking = false;
  if (!spPos) return;
  const ms = Math.round($("sp-seek").value / 1000 * spPos.duration);
  spPlayer?.seek(ms);
  spPos = { ...spPos, position: ms, at: performance.now() };
};

function replaySpotify() {
  const q = queue;
  playSpotify(q.kind, q.key, q.name, q.preview, q.items, q.i);
}

async function spShuffle() {
  const device = await loadSpotify();
  await fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${shuffleOn}&device_id=${device}`,
              { method: "PUT", headers: { Authorization: `Bearer ${await spToken()}` } });
}

async function playSpotify(kind, id, name, preview, items = [{ title: name }], start = 0) {
  stopQueue(false);                                   // stops YouTube (and any earlier Spotify track)
  if (preview) audio.pause();
  else { stopRadio(); closeSongCard(); }
  spPlayer?.activateElement();                        // lets the browser start sound from this click
  stopMedia(video);
  video.hidden = true;
  $("tv-yt").hidden = true;
  const frame = $("tv-youtube");
  frame.hidden = true; frame.removeAttribute("src");
  queue = { items, i: start, name, key: id, preview, spotify: true, kind, trackId: kind === "track" ? id : null };
  spPos = null;
  resetTvAdd();
  watching = { nanoid: `sp:${id}`, name, country: "Spotify" };
  setTv(tr("sp.connecting"));
  renderChannels();
  markPlaying();
  try {
    const device = await loadSpotify();
    if (queue?.key !== id) return;
    const uri = `spotify:${kind}:${id}`;
    const body = id === "liked"                       // Liked Songs have no playable context: send the tracks
      ? { uris: items.slice(start, start + 100).map((v) => `spotify:track:${v.videoId}`) }
      : kind === "playlist" ? { context_uri: uri, offset: { position: items[start]?.position ?? 0 } } : { uris: [uri] };
    const r = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device}`, {
      method: "PUT", body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${await spToken()}`, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(tr("sp.refused", { status: r.status }));
    if (queue?.key !== id) return;
    $("tv-sp").hidden = false;
    $("tv-queue").hidden = kind !== "playlist";
    if (kind === "playlist") spShuffle().catch(() => {});
    setTimeout(async () => {                          // blocked by autoplay: ask for one click on ▶
      const st = await spPlayer.getCurrentState();
      if (queue?.key === id && st?.paused && st.position < 1500) {
        $("sp-toggle").textContent = "▶";
        $("tv-state").textContent = tr("sp.clickPlay");
      }
    }, 2500);
  } catch (e) {
    if (queue?.key !== id) return;
    frame.src = `https://open.spotify.com/embed/${kind}/${id}`;
    frame.hidden = false;
    const drm = !navigator.requestMediaKeySystemAccess || /initiali|EME|DRM/i.test(e.message) || e.message === tr("sp.noResponse");
    setTv(tr("sp.extracts", { reason: drm ? tr("sp.drm") : e.message }));
  }
}

async function playQueue(items, start, name, key, { preview = false } = {}) {
  if ((items[start].service ?? svc) === "spotify") {   // a playlist's song (key = playlist id) or a lone track
    const id = items[start].videoId ?? items[start].id;
    return key === id ? playSpotify("track", id, items[start].title, preview)
                      : playSpotify("playlist", key, name, preview, items, start);
  }
  stopQueue(false);                                   // stops Spotify (and any earlier YouTube queue)
  if (preview) audio.pause();
  else { stopRadio(); closeSongCard(); }
  stopMedia(video);
  video.hidden = true;
  $("tv-youtube").hidden = true; $("tv-youtube").removeAttribute("src");
  queue = { items, orig: items, i: start, name, key, preview };
  if (shuffleOn) shuffleQueue(queue);
  watching = { nanoid: `yt:${key}`, name, country: "YouTube" };
  setTv(tr("state.loading"));
  $("tv-queue").hidden = items.length < 2;
  renderChannels();
  await loadYtApi();
  if (queue?.key === key) playAt(queue.i, 1);
}

// Shuffle (🔀, remembered): Spotify shuffles its own queue; for YouTube, the songs after the current
// one are put in random order (q.orig keeps the playlist order, restored when shuffle is turned off).
let shuffleOn = readLocal("carte.shuffle", false);
const shuffled = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function shuffleQueue(q) {
  const cur = q.items[q.i];
  if (shuffleOn) { q.items = [cur, ...shuffled(q.orig.filter((v) => v !== cur))]; q.i = 0; }
  else { q.items = q.orig; q.i = q.orig.indexOf(cur); }
}
function showShuffle() {
  $("q-shuffle").classList.toggle("on", shuffleOn);
  $("q-shuffle").title = tr(shuffleOn ? "shuffle.on" : "shuffle.off");
}
showShuffle();
$("q-shuffle").onclick = () => {
  shuffleOn = !shuffleOn;
  try { localStorage.setItem("carte.shuffle", JSON.stringify(shuffleOn)); } catch {}
  showShuffle();
  if (queue?.spotify) spShuffle().catch(() => {});
  else if (queue?.orig) shuffleQueue(queue);
};
// Starting a whole playlist with shuffle on begins at a random song.
const firstSong = (count) => (shuffleOn && count > 1 ? Math.floor(Math.random() * count) : 0);

function playAt(i, step) {
  const q = queue;
  while (i >= 0 && i < q.items.length && q.items[i].unavailable) i += step;    // skip known-unplayable
  if (i < 0 || i >= q.items.length) { setTv(tr(i < 0 ? "yt.start" : "yt.end")); return; }
  q.i = i;
  const v = q.items[i];
  $("tv-yt").hidden = false;
  if (!ytPlayer) {
    ytPlayer = new YT.Player("tv-yt", {
      videoId: v.videoId ?? v.id,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
      events: {
        onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED && queue) playAt(queue.i + 1, 1); },
        onError: () => { if (queue) { queue.items[queue.i].unavailable = "unplayable"; markPlaying(); playAt(queue.i + 1, 1); } },
      },
    });
  } else ytPlayer.loadVideoById(v.videoId ?? v.id);
  setTv(q.items.length > 1 ? `${q.name} · ${i + 1}/${q.items.length}` : "YouTube");
  $("tv-name").textContent = v.title;
  resetTvAdd();
  markPlaying();
}
$("q-prev").onclick = () => queue && (queue.spotify ? spPlayer?.previousTrack() : playAt(queue.i - 1, -1));
$("q-next").onclick = () => queue && (queue.spotify ? spPlayer?.nextTrack() : playAt(queue.i + 1, 1));

function stopQueue(resumeRadio = true) {
  const resume = resumeRadio && queue?.preview && playing;   // a song preview paused the radio: resume it
  if (queue?.spotify) spPlayer?.pause();
  $("tv-sp").hidden = true;
  queue = null;
  $("tv-add").hidden = true;
  if (resume) audio.play().catch(() => {});
  $("song-results").querySelectorAll(".previewing").forEach((li) => li.classList.remove("previewing"));
  ytPlayer?.stopVideo?.();
  $("tv-yt").hidden = true;
  $("tv-queue").hidden = true;
  markPlaying();
}

// Highlight the playing song in the open playlist.
function markPlaying() {
  const playingId = queue && queue.items[queue.i]?.itemId;
  $("m-items").querySelectorAll(".m-row").forEach((li) => {
    li.classList.toggle("playing", !!playingId && li.dataset.itemId === playingId);
  });
}

const playPlaylist = async (p) => {
  if (svc === "spotify") {
    if (ytOpen?.id === p.id && ytItems.length) return playSpotify("playlist", p.id, p.title, false, ytItems, firstSong(ytItems.length));
    if (p.id !== "liked") return playSpotify("playlist", p.id, p.title, false, [{ title: p.title, position: firstSong(p.count) }], 0);
  }
  if (ytOpen?.id === p.id && ytItems.length) return playQueue(ytItems, firstSong(ytItems.length), p.title, p.id);
  try {
    const items = tagged((await mApi("/api/yt/items", { playlistId: p.id })).items);
    playQueue(items, firstSong(items.length), p.title, p.id);
  } catch (e) { $("m-status").textContent = e.message; }
};

function openMusic() {
  $("music").hidden = false;
  document.body.classList.add("music-open");
  if (!ytLists.length) loadMyPlaylists();
  if (svc === "spotify") loadSpotify().catch(() => {});   // ready before the first click
}
function closeMusic() { $("music").hidden = true; document.body.classList.remove("music-open"); }
$("music-open").onclick = () => ($("music").hidden ? openMusic() : closeMusic());
$("music-close").onclick = closeMusic;

document.querySelectorAll("[data-mtab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-mtab]").forEach((x) => x.classList.toggle("active", x === b));
  $("m-lists").hidden = b.dataset.mtab !== "lists";
  $("m-search").hidden = b.dataset.mtab !== "search";
  if (b.dataset.mtab === "search") $("m-q").focus();
}));

function thumbBox(url) {
  const box = el("div", "m-thumb");
  if (url) { const img = el("img"); img.src = url; img.alt = ""; img.loading = "lazy"; box.append(img); }
  return box;
}
function iconButton(label, title, onclick, cls = "") {
  const b = el("button", "m-icon " + cls, label);
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); onclick(b); };
  return b;
}

async function loadMyPlaylists() {
  $("m-status").textContent = tr("loading");
  try {
    const { playlists, default: def } = await mApi("/api/yt/playlists", {});
    ytLists = playlists;
    $("m-status").textContent = tr("count.playlists", { n: playlists.length });
    $("m-playlists").replaceChildren(...playlists.map((p) => {
      const li = el("li", "m-row");
      const text = el("div", "station-text");
      text.append(el("div", "station-name", plTitle(p)),
                  el("div", "station-meta", metaLine(p) + (p.id === def ? ` · ${tr("default")}` : "")));
      li.append(thumbBox(p.thumb), text,
        iconButton("▶", tr("playAll"), () => playPlaylist(p)));
      li.onclick = () => openPlaylist(p);
      return li;
    }));
    fillPlaylists({ playlists, default: def });             // the song card's menu too
  } catch (e) {
    $("m-status").textContent = e.message;
  }
}

$("m-create").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("m-new-title").value.trim();
  if (!title) return;
  $("m-status").textContent = tr("creating");
  try {
    await mApi("/api/yt/playlist/create", { title, privacy: $("m-new-privacy").value });
    $("m-new-title").value = "";
    await loadMyPlaylists();
  } catch (err) { $("m-status").textContent = err.message; }
};

async function openPlaylist(p) {
  ytOpen = p;
  $("m-overview").hidden = true;
  $("m-detail").hidden = false;
  $("m-edit-form").hidden = true;
  $("m-title").textContent = plTitle(p);
  $("m-edit").hidden = $("m-delete").hidden = p.id === "liked";    // Spotify's Liked Songs: fixed list
  setMeta();
  await loadItems();
}
$("m-back").onclick = () => { ytOpen = null; $("m-detail").hidden = true; $("m-overview").hidden = false; loadMyPlaylists(); };

async function loadItems() {
  const p = ytOpen;
  $("m-detail-status").textContent = tr("loading");
  $("m-items").replaceChildren();
  try {
    const items = tagged((await mApi("/api/yt/items", { playlistId: p.id })).items);
    if (ytOpen !== p) return;
    ytItems = items;
    p.count = items.length; setMeta();                         // the provider's total can lag after a change
    $("m-detail-status").textContent = items.length ? "" : tr("emptyPlaylist");
    $("m-items").replaceChildren(...items.map(itemRow));
    refreshArrows();
    markPlaying();
  } catch (e) { $("m-detail-status").textContent = e.message; }
}

function itemRow(v) {
  const li = el("li", "m-row" + (v.unavailable ? " unavailable" : ""));
  li.dataset.itemId = v.itemId;
  const text = el("div", "station-text");
  text.append(el("div", "station-name", v.title),
              el("div", "station-meta", v.unavailable ? `${v.channel} · ${tr("unavail." + v.unavailable)}` : v.channel));
  li.append(thumbBox(v.thumb), text,
    iconButton("+", tr("item.addOther"), (b) => openPicker(b, v.videoId, ytOpen.id)),
    iconButton("↑", tr("item.up"), () => moveItem(v, -1), "up" + (ytOpen.id === "liked" ? " gone" : "")),
    iconButton("↓", tr("item.down"), () => moveItem(v, 1), "down" + (ytOpen.id === "liked" ? " gone" : "")),
    iconButton("✕", tr("item.remove"), () => removeItem(v, li), "danger"));
  li.onclick = () => !v.unavailable && playQueue(ytItems, ytItems.indexOf(v), ytOpen.title, ytOpen.id);
  return li;
}

function refreshArrows() {
  const rows = [...$("m-items").children];
  rows.forEach((li, i) => {
    li.querySelector(".up").classList.toggle("invisible", i === 0);
    li.querySelector(".down").classList.toggle("invisible", i === rows.length - 1);
  });
}

function setMeta() {
  const p = ytOpen;
  $("m-meta").textContent = metaLine(p) + (p.description ? ` · ${p.description}` : "");
}

// Moves and removals change the list right away; the server call follows, and the list is
// reloaded only if it fails.
async function moveItem(v, delta) {
  const i = ytItems.indexOf(v), j = i + delta;
  if (j < 0 || j >= ytItems.length) return;
  [ytItems[i], ytItems[j]] = [ytItems[j], ytItems[i]];
  const rows = $("m-items").children;
  const li = rows[i];
  delta < 0 ? rows[j].before(li) : rows[j].after(li);
  refreshArrows();
  li.classList.remove("moved"); void li.offsetWidth; li.classList.add("moved");
  try {
    await mApi("/api/yt/item/move", { playlistId: ytOpen.id, itemId: v.itemId, videoId: v.videoId, position: j, from: i });
  } catch (e) { $("m-detail-status").textContent = e.message; loadItems(); }
}

async function removeItem(v, li) {
  const i = ytItems.indexOf(v);
  ytItems.splice(i, 1);
  if (queue?.items === ytItems && queue.i > i) queue.i--;
  li.classList.add("leaving");
  li.addEventListener("transitionend", () => { li.remove(); refreshArrows(); }, { once: true });
  ytOpen.count--; setMeta();
  try {
    await mApi("/api/yt/item/remove", { playlistId: ytOpen.id, itemId: v.itemId, videoId: v.videoId });
    toast(tr("item.removed", { title: v.title }), tr("cancel"), async () => {
      await mApi("/api/playlist/add", { videoId: v.videoId, playlistId: ytOpen.id, position: i });
      loadItems();
    });
  } catch (e) { $("m-detail-status").textContent = e.message; loadItems(); }
}

function toast(text, action, onAction) {
  const t = $("toast");
  t.replaceChildren(el("span", null, text));
  if (action) {
    const b = el("button", null, action);
    b.onclick = () => { t.hidden = true; onAction().catch((e) => toast(e.message)); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2500);
}

$("m-play").onclick = () => ytOpen && playPlaylist(ytOpen);
$("m-edit").onclick = () => {
  $("m-edit-form").hidden = !$("m-edit-form").hidden;
  $("m-edit-title").value = ytOpen.title;
  $("m-edit-desc").value = ytOpen.description ?? "";
  $("m-edit-privacy").value = ytOpen.privacy ?? "";            // Spotify: none shown = left unchanged
};
$("m-edit-cancel").onclick = () => { $("m-edit-form").hidden = true; };
$("m-edit-form").onsubmit = async (e) => {
  e.preventDefault();
  const p = { ...ytOpen, title: $("m-edit-title").value.trim(), description: $("m-edit-desc").value, privacy: $("m-edit-privacy").value };
  try {
    await mApi("/api/yt/playlist/update", { id: p.id, title: p.title, description: p.description, privacy: p.privacy });
    ytOpen = p;
    const known = ytLists.find((x) => x.id === p.id);          // the "+" menus read this list: keep it current
    if (known) Object.assign(known, { title: p.title, description: p.description, privacy: p.privacy || known.privacy });
    loadPlaylists();                                            // and the song card's menu
    $("m-edit-form").hidden = true;
    $("m-title").textContent = p.title;
    $("m-meta").textContent = metaLine(p) + (p.description ? ` · ${p.description}` : "");
  } catch (err) { $("m-detail-status").textContent = err.message; }
};
$("m-delete").onclick = async () => {
  const p = ytOpen;
  if (!confirm(tr("delete.confirm", { title: p.title, count: countLabel(p.count), svc: svcName() }))) return;
  $("m-detail-status").textContent = tr("deleting");
  try {
    await mApi("/api/yt/playlist/delete", { id: p.id });
    $("m-back").onclick();
  } catch (e) { $("m-detail-status").textContent = e.message; }
};

// Search tab: yt-dlp results; ▶ plays, + adds to the playlist chosen in "Ajouter dans".
// "+" buttons open this menu of the user's playlists (alphabetical, filterable, the last one used
// first); picking one adds the video there. The player's "+" may concern the other service than the
// one shown in "Ma musique": its playlists are then fetched for the menu.
let pickerFor = null, otherLists = null;
function openPicker(btn, videoId, exclude, service = svc) {
  if (service === svc && !ytLists.length) loadMyPlaylists();
  if (service !== svc) {
    otherLists = null;
    api("/api/playlists", { service }).then((r) => { otherLists = r.playlists; renderPicker(); }, () => {});
  }
  const box = $("pl-picker");
  pickerFor = { btn, videoId, exclude, service };
  $("pl-filter").value = "";
  renderPicker();
  box.hidden = false;
  const r = btn.getBoundingClientRect();
  box.style.top = `${Math.min(r.bottom + 4, innerHeight - box.offsetHeight - 8)}px`;
  box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  $("pl-filter").focus();
}
function closePicker() { $("pl-picker").hidden = true; pickerFor = null; }

function renderPicker() {
  let last = null;
  try { last = localStorage.getItem("carte.lastPlaylist"); } catch {}
  const q = $("pl-filter").value.trim().toLowerCase();
  const all = pickerFor?.service === svc ? ytLists : otherLists ?? [];
  const lists = all.filter((p) => p.id !== pickerFor?.exclude && (!q || plTitle(p).toLowerCase().includes(q)));
  lists.sort((a, b) => (b.id === last) - (a.id === last));            // last used on top, the rest stays alphabetical
  $("pl-options").replaceChildren(...lists.map((p) => {
    const li = el("li", "pl-option", plTitle(p));
    li.onclick = () => addTo(p);
    return li;
  }));
  if (!lists.length) $("pl-options").append(el("li", "pl-empty", tr(all.length ? "picker.none" : "loading")));
}

async function addTo(p) {
  const { btn, videoId, service } = pickerFor;
  closePicker();
  try { localStorage.setItem("carte.lastPlaylist", p.id); } catch {}
  btn.disabled = true; btn.textContent = "…";
  try {
    const r = await api("/api/playlist/add", { videoId, playlistId: p.id, service });
    btn.textContent = "✓"; btn.title = tr(r.already ? "picker.alreadyIn" : "picker.addedTo", { title: plTitle(p) });
    btn.classList.add("done");
    const known = ytLists.find((x) => x.id === p.id);
    if (known && !r.already) known.count++;
    if (!r.already) toast(tr("picker.addedTo", { title: plTitle(p) }), tr("cancel"), async () => {   // added by mistake
      await undoAdd(r, videoId, service);
      btn.textContent = "+"; btn.title = ""; btn.classList.remove("done");
      if (known) known.count--;
    });
  } catch (err) { btn.textContent = "+"; alert(err.message); }
  btn.disabled = false;
}

$("pl-filter").addEventListener("input", renderPicker);

function resetTvAdd() {
  const b = $("tv-add");
  b.hidden = !queue;
  b.textContent = "+"; b.title = tr("tv.addSong"); b.classList.remove("done");
}
$("tv-add").onclick = () => {
  if (!queue) return;
  const service = queue.spotify ? "spotify" : "youtube";
  const v = queue.items[queue.i];
  const id = queue.spotify ? queue.trackId ?? v?.videoId ?? queue.key : v?.videoId ?? v?.id;
  if (id) openPicker($("tv-add"), id, undefined, service);
};
$("pl-filter").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closePicker(); }
  if (e.key === "Enter") $("pl-options").querySelector(".pl-option")?.click();
});
document.addEventListener("pointerdown", (e) => {
  if (pickerFor && !$("pl-picker").contains(e.target) && e.target !== pickerFor.btn) closePicker();
});

$("m-search-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("m-q").value.trim();
  if (!q) return;
  if (!ytLists.length) loadMyPlaylists();
  $("m-search-status").textContent = tr("searching");
  $("m-results").replaceChildren();
  try {
    const results = tagged((await mApi("/api/yt-search", { q, n: 12 })).results);
    $("m-search-status").textContent = results.length ? "" : tr("search.none", { svc: svcName() });
    $("m-results").replaceChildren(...results.map((v) => {
      const li = el("li", "m-row");
      const text = el("div", "station-text");
      const mins = v.duration ? ` · ${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, "0")}` : "";
      text.append(el("div", "station-name", v.title), el("div", "station-meta", (v.channel ?? "") + mins));
      li.append(thumbBox(v.thumb), text, iconButton("+", tr("search.addTo", { svc: svcName(v.service) }), (b) => openPicker(b, v.id, undefined, v.service)));
      li.onclick = () => playQueue([v], 0, v.title, v.id);
      return li;
    }));
  } catch (err) { $("m-search-status").textContent = err.message; }
};

// ---------- "⚙ Paramètres" → music accounts: in-app setup of AudD, YouTube and Spotify (server side: connect.py) ----------
// Each key is sent once to the local server, which stores it in ~/.config/carte/; the page only ever
// gets back what is configured. "Se connecter" sends the browser to Google / Spotify, which send it
// back to the server; the server then returns here with #connexions-<service>.
function renderSetup() {
  const m = server?.music ?? {};
  const label = { audd: tr(m.audd ? "chip.keySaved" : "chip.notConfigured"),
                  youtube: tr(m.youtube ? "chip.connected" : "chip.notConnected"), spotify: tr(m.spotify ? "chip.connected" : "chip.notConnected") };
  document.querySelectorAll("[data-chip]").forEach((c) => {
    c.textContent = label[c.dataset.chip];
    c.classList.toggle("on", !!m[c.dataset.chip]);
  });
  document.querySelectorAll("[data-ok]").forEach((e) => { e.textContent = m[e.dataset.ok] ? tr("chip.saved") : ""; });
  document.querySelectorAll(".disconnect").forEach((b) => { b.hidden = !m[b.dataset.service]; });
  $("spotify-redirect").textContent = m.spotifyRedirect ?? "";
}

async function refreshServerState() {
  if (!server) return null;
  try {
    const st = await fetch("/api/state", { headers: { "X-Carte-Lang": lang } }).then((r) => r.json());
    server.music = st.music;
    applyMusicState();
    renderSetup();
    return st.music;
  } catch { return server.music; }
}

function setupMessage(text, ok) {
  const msg = $("setup-msg");
  msg.textContent = text;
  msg.className = ok ? "setup-ok" : "setup-error";
  msg.hidden = !text;
}

// ---------- ⚙ Paramètres and the first-run assistant ----------
// One dialog. Paramètres: language, appearance, music service, connections. The assistant runs on a
// first visit (nothing saved in this browser) and from "Relancer l'assistant": language → what Carte
// does → which music features → their connection steps → done. Its progress is saved, so coming
// back from Google's or Spotify's sign-in page resumes it. The connection cards (#cards) are moved
// into whichever mode is shown.
const placeCards = (mode) => mode.querySelector(".cards-slot")?.append($("cards"));
const openCard = (service) => document.querySelectorAll(".setup-card").forEach((d) => { d.open = d.dataset.service === service; });

// After the sign-in page sends the browser back here (#connexions-<service>): what got connected.
async function signInResult() {
  const m = await refreshServerState();
  let done = location.hash.match(/^#connexions-(youtube|spotify)$/)?.[1];
  if (done && !m?.[done]) done = undefined;           // only trust the server's state, not the link
  if (m?.lastError) setupMessage(m.lastError, false);
  else if (done) setupMessage(tr("setup.connectedMsg", { svc: svcName(done) }), true);
  else setupMessage("");
  if (done) { svc = done; try { localStorage.setItem("carte.service", JSON.stringify(svc)); } catch {} applyMusicState(); loadPlaylists(); }
  if (location.hash.startsWith("#connexions")) history.replaceState(null, "", location.pathname);
  return done;
}

async function openSettings() {
  wiz = null;
  $("setup").hidden = false; $("wiz").hidden = true; $("settings").hidden = false;
  placeCards($("settings"));
  document.querySelectorAll(".setup-card").forEach((d) => { d.hidden = false; });
  setupMessage("");
  renderSetup();
  if (server) { const done = await signInResult(); if (done) openCard(done); }
}

let wiz = null;                                       // {page, wants: ["audd", "youtube", "spotify"]}
const wizPages = () => (server ? ["lang", "intro", "wants", "connect", "done"] : ["lang", "intro", "wants", "done"]);
function openWizard(state = { page: "lang", wants: [] }) {
  wiz = state;
  $("setup").hidden = false; $("settings").hidden = true; $("wiz").hidden = false;
  placeCards($("wiz"));
  setupMessage("");
  showWizPage();
}
function showWizPage() {
  if (!wiz) return;
  try { localStorage.setItem("carte.wizard", JSON.stringify(wiz)); } catch {}
  const pages = wizPages(), i = pages.indexOf(wiz.page);
  document.querySelectorAll(".wiz-page").forEach((p) => { p.hidden = p.dataset.page !== wiz.page; });
  $("wiz").querySelector(".wiz-dots").replaceChildren(...pages.map((_, j) => el("li", j <= i ? "on" : "")));
  $("wiz-back").hidden = i === 0;
  $("wiz-skip").hidden = !["wants", "connect"].includes(wiz.page);
  $("wiz-next").hidden = wiz.page === "lang";          // a language button moves on by itself
  $("wiz-next").textContent = tr(wiz.page === "done" ? "wiz.start" : "wiz.next");
  document.querySelectorAll(".wiz-option input").forEach((c) => { c.checked = wiz.wants.includes(c.value); c.disabled = !server; });
  if (wiz.page === "connect") {
    const m = server?.music ?? {};
    renderSetup();
    document.querySelectorAll(".setup-card").forEach((d) => { d.hidden = !wiz.wants.includes(d.dataset.service); });
    openCard(wiz.wants.find((x) => !m[x]) ?? null);    // the first one still to do
  }
}
function wizGo(step) {
  const pages = wizPages();
  if (wiz.page === "wants" && step > 0) wiz.wants = [...document.querySelectorAll(".wiz-option input:checked")].map((c) => c.value);
  let i = pages.indexOf(wiz.page) + step;
  if (pages[i] === "connect" && !wiz.wants.length) i += step;      // nothing chosen: no connection page
  if (i >= pages.length) return closeSetup();
  wiz.page = pages[Math.max(0, i)];
  setupMessage("");
  showWizPage();
}
$("wiz-next").onclick = () => wizGo(1);
$("wiz-back").onclick = () => wizGo(-1);
$("wiz-skip").onclick = () => { wiz.page = "done"; setupMessage(""); showWizPage(); };
$("wiz-restart").onclick = () => openWizard();
$("wiz").querySelector(".lang-choices").replaceChildren(...Object.entries(LANGS).map(([code, label]) => {
  const b = el("button", "lang-choice", label);
  b.lang = code;
  b.onclick = () => { setLang(code); wizGo(1); };
  return b;
}));

// Closing the assistant, finished or not, counts as done: it does not come back by itself.
function closeSetup() {
  if ($("setup").hidden) return;
  $("setup").hidden = true;
  if (wiz) { wiz = null; try { localStorage.setItem("carte.onboarded", "true"); localStorage.removeItem("carte.wizard"); } catch {} }
}
$("setup-open").onclick = openSettings;
$("setup-close").onclick = closeSetup;
$("setup").addEventListener("pointerdown", (e) => { if (e.target === $("setup") && !wiz) closeSetup(); });

// Appearance: automatic (follows the computer), light or dark; remembered in this browser.
function setTheme(mode, redrawMap = true) {
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  try { mode === "auto" ? localStorage.removeItem("carte.theme") : localStorage.setItem("carte.theme", mode); } catch {}
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.classList.toggle("active", b.dataset.themeSet === mode));
  if (redrawMap) readColors();
}
document.querySelectorAll("[data-theme-set]").forEach((b) => { b.onclick = () => setTheme(b.dataset.themeSet); });
setTheme((() => { try { return localStorage.getItem("carte.theme") || "auto"; } catch { return "auto"; } })(), false);

async function setupCall(path, body, okText) {
  try {
    await api(path, body);
    setupMessage(okText, true);
  } catch (e) { setupMessage(e.message, false); }
  await refreshServerState();
}

document.querySelectorAll(".setup-form").forEach((f) => f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = f.querySelector("input");
  const value = input.value.trim();
  if (!value) return;
  if (f.dataset.action === "audd") await setupCall("/api/setup/audd", { key: value }, tr("setup.auddSaved"));
  else await setupCall("/api/setup/spotify-client", { clientId: value }, tr("setup.clientIdSaved"));
  input.value = "";
}));

document.querySelector('[data-action="google-client"]').addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await setupCall("/api/setup/google-client", { json: await file.text() },
                  tr("setup.googleSaved"));
  e.target.value = "";
});

document.querySelectorAll(".connect").forEach((b) => b.addEventListener("click", async () => {
  try {
    const { url } = await api("/api/setup/connect", { service: b.dataset.service });
    location.href = url;                              // Google / Spotify, then back here
  } catch (e) { setupMessage(e.message, false); }
}));

document.querySelectorAll(".disconnect").forEach((b) => b.addEventListener("click", async () => {
  const what = { audd: tr("setup.what.audd"), youtube: "YouTube", spotify: "Spotify" }[b.dataset.service];
  if (!confirm(tr("setup.removeConfirm", { what }))) return;
  await setupCall("/api/setup/disconnect", { service: b.dataset.service },
                  tr("setup.removed", { what: what[0].toUpperCase() + what.slice(1) }));
}));

$("spotify-redirect").onclick = async () => {
  try { await navigator.clipboard.writeText($("spotify-redirect").textContent); toast(tr("copied")); } catch {}
};

// YouTube / Spotify switch in "Ma musique" (shown when both are connected)
document.querySelectorAll("[data-svc]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.svc === svc) return;
  svc = b.dataset.svc;
  try { localStorage.setItem("carte.service", JSON.stringify(svc)); } catch {}
  applyMusicState();
  ytLists = []; ytOpen = null;
  $("m-detail").hidden = true; $("m-overview").hidden = false;
  $("m-results").replaceChildren(); $("m-search-status").textContent = "";
  loadMyPlaylists();
  loadPlaylists();
  if (svc === "spotify") loadSpotify().catch(() => {});
  if (!$("song-card").hidden && !$("song-search").hidden) ytSearch();   // results of the new service
}));

// ---------- TV (channels from the Famelack dataset, the public data behind tvgarden.world) ----------
// Like tvgarden: channels per country, HLS streams tried in turn, then the YouTube live embed
// as a fallback; the video window stays open across countries.
// Two mirrors of the same files, asked in parallel: jsDelivr is sometimes down (503) or slow.
const TV_DATA = [
  "https://cdn.jsdelivr.net/gh/famelack/famelack-data@main/tv/raw/countries",
  "https://raw.githubusercontent.com/famelack/famelack-data/main/tv/raw/countries",
];
const video = $("video");
let channels = [], tvFor = null, watching = null;
const deadStreams = new Set();                        // URLs that failed this session: skipped next time

function fetchTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

// First mirror that answers with a channel list (a 404 means: no channels for this country).
function fetchChannels(iso2) {
  return Promise.any(TV_DATA.map(async (base) => {
    const r = await fetchTimeout(`${base}/${iso2}.json`, 10000);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }));
}

// Quick check that an HLS playlist answers, so dead streams are skipped in a few seconds
// instead of waiting for the player's timeout. hls.js needs the same CORS access, so a
// failed fetch also means hls.js would fail; native HLS (Safari) does not, hence "unknown".
async function probeStream(url) {
  if (deadStreams.has(url)) return "dead";
  try {
    const r = await fetchTimeout(url, 5000);
    return r.ok && (await r.text()).trimStart().startsWith("#EXTM3U") ? "ok" : "dead";
  } catch {
    return video.canPlayType("application/vnd.apple.mpegurl") ? "unknown" : "dead";
  }
}

async function loadTv() {
  const p = selected?.properties;
  if (!p || tvFor === p.id) return;
  tvFor = p.id;
  channels = [];
  $("tv-filter").value = "";
  renderChannels();
  const iso2 = facts[p.id]?.iso2;
  if (!iso2) return setTvStatus(tr("tv.noCode"));
  setTvStatus(tr("tv.loading"));
  try {
    const list = await fetchChannels(iso2.toLowerCase());
    if (tvFor !== p.id) return;
    channels = list.filter((c) => c.sources?.streams?.length || c.sources?.youtube?.length);
    renderChannels();
    if (!channels.length) setTvStatus(tr("tv.none"));
  } catch {
    if (tvFor === p.id) { tvFor = null; setTvStatus(tr("tv.down")); }
  }
}

function setTvStatus(text) { $("tv-status").textContent = text; }

function renderChannels() {
  const q = $("tv-filter").value.trim().toLowerCase();
  const shown = channels.filter((c) => !q || c.name.toLowerCase().includes(q));
  const country = selected && nameOf(selected);
  $("tv-list").replaceChildren(...shown.map((c) => channelRow(c, country)));
  revealRow("tv", $("tv-list"));
  renderFavbar();
  if (channels.length) setTvStatus(tr("tv.count", { n: shown.length }));
}

function channelRow(c, country, showCountry) {
  const li = el("li", "station" + (watching?.nanoid === c.nanoid ? " playing" : ""));
  const text = el("div", "station-text");
  text.append(el("div", "station-name", c.name));
  const meta = el("div", "station-meta", [
    showCountry && country,
    (c.languages ?? []).join(", ").toUpperCase(),
    !c.sources.streams?.length && "YouTube",
  ].filter(Boolean).join(" · "));
  if (c.isGeoBlocked) meta.append(el("span", "warn", (meta.textContent ? " · " : "") + tr("tv.geo")));
  text.append(meta);
  li.append(el("div", "station-icon", "▶"), text, favButton("tv", c, country));
  li.onclick = () => watch(c, country);
  return li;
}

function setTv(state) {
  $("tv-window").hidden = !watching;
  if (!watching) return;
  $("tv-name").textContent = watching.name;
  $("tv-state").textContent = state;
  $("tv-window").querySelector(".player-text").title = watching.countryId && !queue ? tr("player.openCountry", { country: watching.country }) : "";
  $("tv-window").classList.toggle("from-country", !!watching.countryId && !queue);
}

async function watch(c, country) {
  closeSongCard();
  stopRadio();
  stopQueue();
  stopMedia(video);
  const yt = $("tv-youtube");
  yt.hidden = true; yt.removeAttribute("src");
  video.hidden = false;
  watching = { ...c, country, countryId: countryIdOf(c, country) };
  renderChannels();
  const streams = c.sources.streams ?? [];
  if (streams.length) setTv(`${country} · ${tr("state.connecting")}`);
  const probes = streams.map(probeStream);            // all checked at once, then tried in order
  for (const [i, url] of streams.entries()) {
    const state = await probes[i];
    if (watching?.nanoid !== c.nanoid) return;
    if (state === "dead") { deadStreams.add(url); continue; }
    if (await tryUrl(video, url, true, 10000)) {
      if (watching?.nanoid === c.nanoid) {
        setTv(`${country} · ${tr("state.live")}`);
        watchStream(video, () => watching?.nanoid === c.nanoid && !queue, () => {   // dropped: start again
          setTv(`${country} · ${tr("state.reconnecting")}`);
          setTimeout(() => watching?.nanoid === c.nanoid && watch(c, country), 2000);
        });
      }
      return;
    }
    deadStreams.add(url);
  }
  if (watching?.nanoid !== c.nanoid) return;
  const ytUrl = c.sources.youtube?.[0];
  if (ytUrl) {                                        // the embed reports no errors to us: shown as is
    video.hidden = true;
    yt.src = ytUrl + (ytUrl.includes("?") ? "&" : "?") + "autoplay=1";
    yt.hidden = false;
    setTv(`${country} · YouTube`);
  } else {
    setTv(`${country} · ${tr("state.unavailable")}` + (c.isGeoBlocked ? tr("tv.geoLikely") : ""));
  }
}

function closeTv() {
  if (!watching) return;
  stopQueue();
  stopMedia(video);
  $("tv-youtube").removeAttribute("src");
  watching = null;
  setTv();
  renderChannels();
}

$("tv-filter").addEventListener("input", renderChannels);
$("tv-close").onclick = closeTv;
$("player").querySelector(".player-text").onclick = () => openPlayingCountry("radio");
$("tv-window").querySelector(".player-text").onclick = () => watching?.countryId && !queue && openPlayingCountry("tv");

// ---------- language (i18n.js) ----------
// Switching redraws what is on screen; texts set by a past action (a status line) change at the next one.
$("lang").replaceChildren(...Object.entries(LANGS).map(([code, label]) => { const o = el("option", null, label); o.value = code; return o; }));
$("lang").value = lang;
applyI18n();
$("lang").onchange = () => setLang($("lang").value);
function setLang(code) {
  lang = code;
  $("lang").value = code;
  try { localStorage.setItem("carte.lang", lang); } catch {}
  applyI18n();
  showWizPage();
  showShuffle();
  if (features.length) fillCountryList();
  if (selected) { renderPanelHead(); renderStations(); renderChannels(); }
  renderFavbar();
  renderSetup();
  if (playing) setPlayer(`${playing.country} · ${tr(audio.paused ? "state.paused" : "state.live")}`);
  if (server?.music[svc]) { loadPlaylists(); if (!$("music").hidden) loadMyPlaylists(); }
  if (ytOpen) { $("m-title").textContent = plTitle(ytOpen); setMeta(); $("m-items").replaceChildren(...ytItems.map(itemRow)); refreshArrows(); markPlaying(); }
  if (queue) resetTvAdd();
}

// ---------- wiring ----------
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
  $("tab-radio").hidden = b.dataset.tab !== "radio";
  $("tab-tv").hidden = b.dataset.tab !== "tv";
  if (b.dataset.tab === "radio") loadRadio();
  if (b.dataset.tab === "tv") loadTv();
}));
$("close").onclick = closePanel;
// + / − zoom around the centre of the visible map: left of the country panel when it is open, so
// the selected country stays in view.
const zoomCentre = () => {
  const panelW = selected && window.innerWidth > 640 ? $("panel").offsetWidth + 32 : 0;
  return [(view.w - panelW) / 2, view.h / 2];
};
$("zoom-in").onclick = () => sel.transition().duration(400).call(zoom.scaleBy, 1.8, zoomCentre());
$("zoom-out").onclick = () => sel.transition().duration(400).call(zoom.scaleBy, 1 / 1.8, zoomCentre());
$("zoom-reset").onclick = () => { closePanel(); sel.transition().duration(800).call(zoom.transform, d3.zoomIdentity); };
// Country search: the name in the current language, French or English; accents and capitals don't
// matter, and Enter on the start of a name ("jap", "bresil") opens the first country it fits.
const fold = (x) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function findCountry(text, prefix) {
  const q = fold(text.trim());
  if (!q) return null;
  const names = (x) => [nameOf(x), x.properties.fr, x.properties.en].map(fold);
  return features.find((x) => names(x).includes(q))
    ?? (prefix ? [...features].sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang)).find((x) => names(x).some((n) => n.startsWith(q))) : null);
}
function goSearch(prefix) {
  const f = findCountry($("search").value, prefix);
  if (f) { select(f); $("search").value = ""; $("search").blur(); }
}
$("search").addEventListener("change", () => goSearch(false));      // a name picked in the list
$("search").addEventListener("keydown", (e) => { if (e.key === "Enter") goSearch(true); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.activeElement.tagName !== "TEXTAREA") { closePanel(); closeMusic(); closeSetup(); }
});

init();
