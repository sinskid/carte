"""Song identification for the radio player and adding songs to the user's YouTube playlist.

Used by server.py; stdlib only (yt-dlp is called as a program for the YouTube search).

Secrets live outside the project, in ~/.config/carte/ (folder 700, files 600), set up with
tools/music_setup.py:
    config.json          {"audd_token": "...", "youtube_playlists": [{"id", "title"}], "youtube_playlist": "PL..."}
                         (the playlists the page may add to, and the default one)
    youtube_token.json   {"client_id", "client_secret", "refresh_token"} from the OAuth consent
The browser never sees them: the page only asks the server for one of the actions below.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

CONF_DIR = Path.home() / ".config/carte"
CONFIG = CONF_DIR / "config.json"
YT_TOKEN = CONF_DIR / "youtube_token.json"
UA = {"User-Agent": "Carte/1.0"}
CLIP_SECONDS = 10
CLIP_MAX_BYTES = 400_000          # ~15-25 s at usual radio bitrates; servers send a burst at first
VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")


class MusicError(Exception):
    """Error with a message meant for the page (in French)."""


def config():
    return json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}


def write_private(path, obj):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CONF_DIR, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.chmod(path, 0o600)


def set_config(**kw):
    write_private(CONFIG, {**config(), **kw})


def status():
    """What is configured, for the page to show or hide the music features."""
    conf = config()
    return {"audd": bool(conf.get("audd_token")), "youtube": YT_TOKEN.exists()}


def _open(url, timeout=8, headers=None):
    if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        raise MusicError("Adresse de flux invalide.")
    return urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=timeout)


# ---------- 1. title sent by the station (ICY metadata, Icecast / Shoutcast streams) ----------
def icy_title(url, blocks=3):
    """'Artist - Title' from the stream's in-band metadata, or None (no metadata, empty, or an ad)."""
    try:
        with _open(url, headers={"Icy-MetaData": "1"}) as r:
            every = int(r.headers.get("icy-metaint") or 0)
            if not every:
                return None
            for _ in range(blocks):
                r.read(every)
                size = r.read(1)[0] * 16
                if not size:
                    continue
                raw = r.read(size).rstrip(b"\0")
                try:
                    meta = raw.decode("utf-8")
                except UnicodeDecodeError:                           # many Shoutcast servers send Latin-1
                    meta = raw.decode("latin-1")
                m = re.search(r"StreamTitle='(.*?)';", meta)
                title = (m.group(1) if m else "").strip()
                if " - " in title and "adw_ad='true'" not in meta:
                    artist, song = (s.strip() for s in title.split(" - ", 1))
                    if artist and song and artist != song:          # "7052 - 7052" style codes
                        return {"artist": artist, "title": song, "source": "radio"}
    except (OSError, ValueError, IndexError):
        pass
    return None


# ---------- 2. audio fingerprint (AudD) on a ~10 s clip of the stream ----------
def record_clip(url):
    """About CLIP_SECONDS of the stream as raw bytes (MP3/AAC as sent, or the last HLS segments)."""
    with _open(url) as r:
        head = r.read(7)
        if head == b"#EXTM3U":
            return _hls_clip(r.geturl(), (head + r.read()).decode("utf-8", "replace"))
        data, start = bytearray(head), time.time()
        while time.time() - start < CLIP_SECONDS and len(data) < CLIP_MAX_BYTES:
            chunk = r.read(8192)
            if not chunk:
                break
            data += chunk
        return bytes(data)


def _hls_clip(base, playlist):
    lines = [l.strip() for l in playlist.splitlines()]
    first = next((i for i, l in enumerate(lines) if l.startswith("#EXT-X-STREAM-INF")), None)
    if first is not None:                                           # master playlist: take its first variant
        variant = next(l for l in lines[first + 1:] if l and not l.startswith("#"))
        base = urllib.parse.urljoin(base, variant)
        with _open(base) as r:
            lines = [l.strip() for l in r.read().decode("utf-8", "replace").splitlines()]
    segments, total = [], 0.0
    for i in range(len(lines) - 1, -1, -1):                         # newest segments last in the list
        if lines[i] and not lines[i].startswith("#") and i and lines[i - 1].startswith("#EXTINF:"):
            segments.insert(0, urllib.parse.urljoin(base, lines[i]))
            total += float(lines[i - 1][8:].split(",")[0] or 0)
            if total >= CLIP_SECONDS:
                break
    if not segments:
        raise MusicError("Flux HLS illisible.")
    data = bytearray()
    for seg in segments:
        with _open(seg, timeout=10) as r:
            data += r.read(CLIP_MAX_BYTES)
    return bytes(data[-CLIP_MAX_BYTES:])


def audd_identify(clip):
    token = config().get("audd_token")
    if not token:
        raise MusicError("Clé AudD absente : ajoute-la dans ⚙ Paramètres.")
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"api_token\"\r\n\r\n{token}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + clip + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request("https://api.audd.io/", data=body, method="POST",
                                 headers={**UA, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read())
    if res.get("status") != "success":
        raise MusicError("AudD : " + str(res.get("error", {}).get("error_message", "erreur")))
    song = res.get("result")
    if not song:
        return None
    return {"artist": song.get("artist", ""), "title": song.get("title", ""), "source": "audd",
            "link": song.get("song_link")}


def identify(url, audio=False):
    """Station metadata first (free, instant), then AudD on a clip. audio=True skips the station's
    title (stations sometimes send the wrong one) and always listens."""
    song = None if audio else icy_title(url)
    if song:
        return song
    try:
        clip = record_clip(url)
    except OSError:
        raise MusicError("Impossible d'enregistrer un extrait du flux.")
    return audd_identify(clip)


# ---------- 3. YouTube: search without login (yt-dlp), add with OAuth ----------
def _clean(text):
    """Drop what radio titles add and YouTube titles lack: (Radio Edit), [2019], feat. X, odd symbols."""
    text = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text)
    text = re.sub(r"\b(feat|ft|featuring)\b\.?[^-]*", " ", text, flags=re.I)
    text = re.sub(r"[^\w'&]+", " ", text)
    return " ".join(text.split())


def _search(query, n):
    ytdlp = ["yt-dlp"] if shutil.which("yt-dlp") else [sys.executable, "-m", "yt_dlp"]   # pip --user, not on PATH
    out = subprocess.run([*ytdlp, "--flat-playlist", "-J", "--no-warnings", f"ytsearch{n}:{query}"],
                         capture_output=True, text=True, timeout=40)
    if out.returncode:
        print(f"yt-search failed for {query!r}: {out.stderr.strip()[-300:]}", file=sys.stderr, flush=True)
        return []
    entries = json.loads(out.stdout).get("entries") or []
    return [e for e in entries if VIDEO_ID_RE.match(e.get("id") or "")]   # videos only, no channels/playlists


def yt_search(query, n=3):
    """Top n videos for the query, trying cleaner variants of it until one gives results."""
    words = _clean(query)
    tries = dict.fromkeys(q for q in (query.strip(), words, " ".join(words.split()[:6])) if q)
    for q in tries:
        found = _search(q, n + 3)
        print(f"yt-search {q!r}: {len(found)} results", file=sys.stderr, flush=True)
        if found:
            return [{"id": e["id"], "title": e.get("title"), "channel": e.get("channel") or e.get("uploader"),
                     "duration": e.get("duration"), "thumb": f"https://i.ytimg.com/vi/{e['id']}/mqdefault.jpg"}
                    for e in found[:n]]
    return []


_access = {"token": None, "until": 0}


def _access_token():
    if _access["token"] and time.time() < _access["until"]:
        return _access["token"]
    if not YT_TOKEN.exists():
        raise MusicError("YouTube non connecté : ouvre ⚙ Paramètres.")
    t = json.loads(YT_TOKEN.read_text(encoding="utf-8"))
    data = urllib.parse.urlencode({"client_id": t["client_id"], "client_secret": t["client_secret"],
                                   "refresh_token": t["refresh_token"], "grant_type": "refresh_token"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data), timeout=15) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError:
        raise MusicError("Autorisation YouTube expirée ou révoquée : reconnecte-toi dans ⚙ Paramètres.")
    _access.update(token=res["access_token"], until=time.time() + res.get("expires_in", 3600) - 60)
    return _access["token"]


def _yt_api(method, path, params, body=None):
    url = f"https://www.googleapis.com/youtube/v3/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        try:
            reason = json.loads(e.read())["error"]["message"]
        except Exception:
            reason = ""
        raise MusicError(f"YouTube a refusé ({e.code}) {reason}".strip())


def allowed_playlists():
    """The playlists approved in the terminal (tools/music_setup.py), and the default one."""
    conf = config()
    lists = conf.get("youtube_playlists") or []
    default = conf.get("youtube_playlist")
    if default and default not in {p["id"] for p in lists}:
        lists = [{"id": default, "title": "Playlist par défaut"}] + lists
    return {"playlists": lists, "default": default or (lists[0]["id"] if lists else None)}


def sync_playlists():
    """Fetch all the user's playlists from YouTube (read-only call) and approve them for the page."""
    items, page = [], None
    while True:
        params = {"part": "snippet,contentDetails,status", "mine": "true", "maxResults": 50}
        if page:
            params["pageToken"] = page
        res = _yt_api("GET", "playlists", params)
        items += res.get("items", [])
        page = res.get("nextPageToken")
        if not page:
            break
    items.sort(key=lambda p: p["snippet"]["title"].casefold())         # alphabetical everywhere in the page
    set_config(youtube_playlists=[{"id": p["id"], "title": p["snippet"]["title"]} for p in items])
    return items


def set_default_playlist(playlist):
    if playlist not in {p["id"] for p in allowed_playlists()["playlists"]}:
        raise MusicError("Playlist non autorisée.")
    set_config(youtube_playlist=playlist)
    return allowed_playlists()


def youtube_add(video_id, playlist=None, position=None):
    """Add one video to one of the approved playlists; nothing else is possible from the page."""
    if not VIDEO_ID_RE.match(video_id or ""):
        raise MusicError("Vidéo invalide.")
    allowed = allowed_playlists()
    playlist = playlist or allowed["default"]
    if not playlist:
        raise MusicError("Aucune playlist : choisis « ↻ Actualiser » dans le menu des playlists.")
    if playlist not in {p["id"] for p in allowed["playlists"]}:
        raise MusicError("Playlist non autorisée : choisis « ↻ Actualiser » dans le menu des playlists.")
    if _yt_api("GET", "playlistItems", {"part": "id", "playlistId": playlist, "videoId": video_id}).get("items"):
        return {"ok": True, "already": True, "playlistId": playlist}
    snippet = {"playlistId": playlist, "resourceId": {"kind": "youtube#video", "videoId": video_id}}
    if isinstance(position, int) and position >= 0:                   # undo of a removal: back in its place
        snippet["position"] = position
    res = _yt_api("POST", "playlistItems", {"part": "snippet"}, {"snippet": snippet})
    _log("add_item", playlist=playlist, videoId=video_id)
    return {"ok": True, "already": False, "playlistId": playlist, "itemId": res.get("id")}   # itemId: to undo


# ---------- 4. playlist management for the "Ma musique" panel ----------
# Writes cost 50 units of the 10 000/day YouTube quota, reads 1. Every write is logged, and a
# playlist's content is saved before it is deleted, so it can be rebuilt by hand.
ACTIONS_LOG = CONF_DIR / "youtube_actions.log"
DELETED_DIR = CONF_DIR / "deleted_playlists"
PRIVACY = ("private", "unlisted", "public")


def _log(action, **kw):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    with open(ACTIONS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "action": action, **kw}, ensure_ascii=False) + "\n")


def _own(playlist):
    """Only the user's own playlists (as last synced) may be read or changed from the page."""
    if playlist not in {p["id"] for p in allowed_playlists()["playlists"]}:
        sync_playlists()
        if playlist not in {p["id"] for p in allowed_playlists()["playlists"]}:
            raise MusicError("Playlist inconnue.")
    return playlist


def _thumb(snippet):
    t = snippet.get("thumbnails") or {}
    return (t.get("medium") or t.get("default") or {}).get("url")


def list_playlists():
    items = sync_playlists()
    return {"playlists": [{
        "id": p["id"], "title": p["snippet"]["title"], "description": p["snippet"].get("description", ""),
        "count": p["contentDetails"]["itemCount"], "privacy": p.get("status", {}).get("privacyStatus"),
        "thumb": _thumb(p["snippet"]),
    } for p in items], "default": allowed_playlists()["default"]}


def _playlist_body(title, description, privacy):
    title = (title or "").strip()
    if not title or len(title) > 150:
        raise MusicError("Titre vide ou trop long.")
    if privacy not in PRIVACY:
        raise MusicError("Visibilité invalide.")
    return {"snippet": {"title": title, "description": (description or "")[:5000]}, "status": {"privacyStatus": privacy}}


def create_playlist(title, privacy="private", description=""):
    res = _yt_api("POST", "playlists", {"part": "snippet,status"}, _playlist_body(title, description, privacy))
    _log("create_playlist", id=res["id"], title=title)
    sync_playlists()
    return {"id": res["id"]}


def update_playlist(playlist, title, privacy, description=""):
    body = {"id": _own(playlist), **_playlist_body(title, description, privacy)}
    _yt_api("PUT", "playlists", {"part": "snippet,status"}, body)
    _log("update_playlist", id=playlist, title=title, privacy=privacy)
    sync_playlists()
    return {"ok": True}


def playlist_items(playlist, limit=500):
    items, page = [], None
    while len(items) < limit:
        params = {"part": "snippet,contentDetails", "playlistId": _own(playlist), "maxResults": 50}
        if page:
            params["pageToken"] = page
        res = _yt_api("GET", "playlistItems", params)
        items += res.get("items", [])
        page = res.get("nextPageToken")
        if not page:
            break
    ids = [i["contentDetails"]["videoId"] for i in items]
    playable = _playable(ids)
    return {"items": [{
        "itemId": i["id"], "videoId": i["contentDetails"]["videoId"], "title": i["snippet"]["title"],
        "channel": i["snippet"].get("videoOwnerChannelTitle", ""), "position": i["snippet"]["position"],
        "thumb": _thumb(i["snippet"]), "unavailable": playable.get(i["contentDetails"]["videoId"], "deleted"),
    } for i in items]}


def _playable(ids):
    """{videoId: None if it can play here in an embed, else the reason in French} (1 quota unit per 50)."""
    region = config().get("region", "FR")
    out = {}
    for k in range(0, len(ids), 50):
        res = _yt_api("GET", "videos", {"part": "status,contentDetails", "id": ",".join(ids[k:k + 50])})
        for v in res.get("items", []):
            r = v.get("contentDetails", {}).get("regionRestriction", {})
            st = v.get("status", {})
            out[v["id"]] = ("blocked" if region in r.get("blocked", []) or ("allowed" in r and region not in r["allowed"])
                            else "noembed" if not st.get("embeddable", True)
                            else "private" if st.get("privacyStatus") == "private" else None)   # codes, worded by the page
    return out


def delete_playlist(playlist):
    backup = playlist_items(_own(playlist))["items"]
    meta = next((p for p in allowed_playlists()["playlists"] if p["id"] == playlist), {})
    DELETED_DIR.mkdir(parents=True, exist_ok=True)
    write_private(DELETED_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}-{playlist}.json", {"playlist": meta, "items": backup})
    _yt_api("DELETE", "playlists", {"id": playlist})
    _log("delete_playlist", id=playlist, title=meta.get("title"), items=len(backup))
    if config().get("youtube_playlist") == playlist:
        set_config(youtube_playlist=None)
    sync_playlists()
    return {"ok": True, "backup": len(backup)}


def remove_item(playlist, item_id, video_id=""):
    _own(playlist)
    _yt_api("DELETE", "playlistItems", {"id": item_id})
    _log("remove_item", playlist=playlist, itemId=item_id, videoId=video_id)
    return {"ok": True}


def move_item(playlist, item_id, video_id, position):
    if not VIDEO_ID_RE.match(video_id or "") or not isinstance(position, int) or position < 0:
        raise MusicError("Déplacement invalide.")
    _yt_api("PUT", "playlistItems", {"part": "snippet"}, {"id": item_id, "snippet": {
        "playlistId": _own(playlist), "position": position,
        "resourceId": {"kind": "youtube#video", "videoId": video_id}}})
    _log("move_item", playlist=playlist, itemId=item_id, position=position)
    return {"ok": True}
