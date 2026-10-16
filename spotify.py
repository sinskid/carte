"""Spotify, mirroring the YouTube functions of music.py so the page can switch service.

Same shapes as music.py: search results {id, title, channel, duration, thumb}, playlists
{id, title, description, count, privacy, thumb}, playlist items {itemId, videoId, title, channel,
position, thumb, unavailable} ("videoId" holds the Spotify track id, "channel" the artists).

Auth = Authorization Code with PKCE (no client secret), done by connect.py; the refresh token is in
~/.config/carte/spotify_token.json (600). Only playlists the user owns can be changed.
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from music import CONF_DIR, MusicError, _log, config, set_config, write_private

TOKEN = CONF_DIR / "spotify_token.json"
TRACK_ID_RE = re.compile(r"^[0-9A-Za-z]{22}$")
PLAYLIST_ID_RE = re.compile(r"^[0-9A-Za-z]{22}$")
API = "https://api.spotify.com/v1"

_access = {"token": None, "until": 0}
_me = {}


def connected():
    return TOKEN.exists()


def _access_token():
    if _access["token"] and time.time() < _access["until"]:
        return _access["token"]
    if not TOKEN.exists():
        raise MusicError("Spotify non connecté : ouvre ⚙ Paramètres.")
    t = json.loads(TOKEN.read_text(encoding="utf-8"))
    data = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": t["refresh_token"],
                                   "client_id": t["client_id"]}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request("https://accounts.spotify.com/api/token", data=data), timeout=15) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError:
        raise MusicError("Autorisation Spotify expirée ou révoquée : reconnecte-toi dans ⚙ Paramètres.")
    if res.get("refresh_token"):                                    # Spotify may rotate it
        write_private(TOKEN, {**t, "refresh_token": res["refresh_token"]})
    _access.update(token=res["access_token"], until=time.time() + res.get("expires_in", 3600) - 60)
    return _access["token"]


def player_token():
    """Short-lived access token for the page's Web Playback SDK (full tracks, Premium only). The SDK
    runs in the browser, so it needs the token there; the refresh token never leaves the server."""
    scope = json.loads(TOKEN.read_text(encoding="utf-8")).get("scope", "") if TOKEN.exists() else ""
    if "streaming" not in scope.split():                            # signed in before playback existed
        raise MusicError("Pour écouter les titres en entier, reconnecte Spotify dans ⚙ Paramètres.")
    token = _access_token()
    return {"token": token, "expiresIn": int(_access["until"] - time.time())}


def _api(method, path, params=None, body=None):
    url = f"{API}/{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
            try:
                return json.loads(data) if data else {}
            except ValueError:                                      # player routes may answer with plain text
                return {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            reason = json.loads(raw)["error"]["message"]
        except Exception:
            reason = raw[:200]                                      # some refusals are plain text
        if "premium" in reason.lower():
            reason = "il faut un abonnement Spotify Premium sur le compte qui a créé l'application (règle Spotify)."
        elif "not be registered" in reason:
            reason = ("ce compte n'est pas autorisé : ajoute son e-mail dans developer.spotify.com/dashboard → "
                      "ton application → Settings → User Management.")
        raise MusicError(f"Spotify a refusé ({e.code}) {reason}".strip())


def _my_id():
    if "id" not in _me:
        _me.update(_api("GET", "me"))
    return _me["id"]


def _image(images, small=False):
    images = images or []
    return (images[-2] if small and len(images) > 1 else images[0])["url"] if images else None


def _artists(track):
    return ", ".join(a["name"] for a in track.get("artists", []))


# ---------- search + add (song card, "Rechercher") ----------
def search(query, n=3):
    res = _api("GET", "search", {"q": query, "type": "track", "limit": max(1, min(n, 10)), "market": "from_token"})
    return [{"id": t["id"], "title": t["name"], "channel": _artists(t), "duration": t["duration_ms"] / 1000,
             "thumb": _image(t.get("album", {}).get("images"), small=True)}
            for t in res.get("tracks", {}).get("items", []) if t]


# Since 2026 Spotify refuses (403) the old playlist routes for new apps: entries are read and changed
# through /playlists/{id}/items (not /tracks) and playlists are created with POST /me/playlists.
def _all_tracks(playlist):
    """Raw playlist entries."""
    out, offset = [], 0
    while True:
        res = _api("GET", f"playlists/{playlist}/items", {"limit": 100, "offset": offset, "market": "from_token"})
        out += res.get("items", [])
        offset += 100
        if not res.get("next") or offset >= 1000:
            return out


# ---------- playlists ----------
def sync_playlists():
    items, offset = [], 0
    me = _my_id()
    while True:
        res = _api("GET", "me/playlists", {"limit": 50, "offset": offset})
        items += [p for p in res.get("items", []) if p and (p["owner"]["id"] == me or p.get("collaborative"))]
        offset += 50
        if not res.get("next"):
            break
    items.sort(key=lambda p: p["name"].casefold())
    set_config(spotify_playlists=[{"id": p["id"], "title": p["name"]} for p in items])
    return items


# The user's Liked Songs ("Titres likés") act as a playlist with the id "liked": read with GET
# /me/tracks, changed with PUT / DELETE /me/library. Spotify keeps them in order of liking, so they
# cannot be moved, renamed or deleted.
LIKED = {"id": "liked", "title": "Titres likés"}


def _has_scope(name):
    return TOKEN.exists() and name in json.loads(TOKEN.read_text(encoding="utf-8")).get("scope", "").split()


def _liked_entries():
    out, offset = [], 0
    while True:
        res = _api("GET", "me/tracks", {"limit": 50, "offset": offset, "market": "from_token"})
        out += res.get("items", [])
        offset += 50
        if not res.get("next") or offset >= 2000:
            return out


def _fixed(playlist):
    if playlist == "liked":
        raise MusicError("Les titres likés ne se renomment pas, ne se suppriment pas et gardent l'ordre des « J'aime ».")


def allowed_playlists():
    conf = config()
    lists = ([LIKED] if _has_scope("user-library-read") else []) + (conf.get("spotify_playlists") or [])
    default = conf.get("spotify_playlist")
    if default not in {p["id"] for p in lists}:
        default = None
    return {"playlists": lists, "default": default or (lists[0]["id"] if lists else None)}


def set_default_playlist(playlist):
    _own(playlist)
    set_config(spotify_playlist=playlist)
    return allowed_playlists()


def _own(playlist):
    if playlist == "liked":
        if not _has_scope("user-library-read"):
            raise MusicError("Pour les titres likés, reconnecte Spotify dans ⚙ Paramètres.")
        return playlist
    if not PLAYLIST_ID_RE.match(playlist or ""):
        raise MusicError("Playlist invalide.")
    if playlist not in {p["id"] for p in allowed_playlists()["playlists"]}:
        sync_playlists()
        if playlist not in {p["id"] for p in allowed_playlists()["playlists"]}:
            raise MusicError("Playlist inconnue.")
    return playlist


def list_playlists():
    items = sync_playlists()
    liked = []
    if _has_scope("user-library-read"):
        total = _api("GET", "me/tracks", {"limit": 1}).get("total", 0)
        liked = [{**LIKED, "description": "", "count": total, "privacy": None, "thumb": None}]
    return {"playlists": liked + [{
        "id": p["id"], "title": p["name"], "description": p.get("description") or "",
        "count": (p.get("tracks") or p.get("items") or {}).get("total", 0),
        "privacy": None, "thumb": _image(p.get("images"), small=True),
    } for p in items], "default": allowed_playlists()["default"]}


# Spotify's API reads every playlist as public (even ones just created private), so the real privacy
# is unknown: the page shows none, and an edit with no privacy chosen ("") leaves it as it is.
def _privacy(privacy):
    if privacy not in ("private", "unlisted", "public"):
        raise MusicError("Visibilité invalide.")
    return privacy == "public"                                      # Spotify has no "unlisted"


def create_playlist(title, privacy="private", description=""):
    title = (title or "").strip()
    if not title or len(title) > 100:
        raise MusicError("Titre vide ou trop long.")
    res = _api("POST", "me/playlists",
               body={"name": title, "public": _privacy(privacy), "description": (description or "")[:300]})
    _log("spotify_create_playlist", id=res["id"], title=title)
    sync_playlists()
    return {"id": res["id"]}


def update_playlist(playlist, title, privacy, description=""):
    _fixed(playlist)
    title = (title or "").strip()
    if not title or len(title) > 100:
        raise MusicError("Titre vide ou trop long.")
    body = {"name": title, "description": (description or "")[:300]}
    if privacy:
        body["public"] = _privacy(privacy)
    _api("PUT", f"playlists/{_own(playlist)}", body=body)
    _log("spotify_update_playlist", id=playlist, title=title, privacy=privacy)
    sync_playlists()
    return {"ok": True}


def playlist_items(playlist):
    entries = _liked_entries() if _own(playlist) == "liked" else _all_tracks(playlist)
    out = []
    for pos, e in enumerate(entries):
        t = e.get("track") or e.get("item") or {}
        if not t.get("id"):
            continue
        out.append({
            "itemId": f"{t['id']}#{pos}", "videoId": t["id"], "title": t.get("name", ""), "channel": _artists(t),
            "position": pos, "thumb": _image(t.get("album", {}).get("images"), small=True),
            "unavailable": None if t.get("is_playable", True) else "region",   # code, worded by the page
        })
    return {"items": out}


def delete_playlist(playlist):
    _fixed(playlist)
    backup = playlist_items(_own(playlist))["items"]
    meta = next((p for p in allowed_playlists()["playlists"] if p["id"] == playlist), {})
    deleted = CONF_DIR / "deleted_playlists"
    deleted.mkdir(parents=True, exist_ok=True)
    write_private(deleted / f"{time.strftime('%Y%m%d-%H%M%S')}-spotify-{playlist}.json", {"playlist": meta, "items": backup})
    _api("DELETE", f"playlists/{playlist}/followers")                 # Spotify "deletes" by unfollowing
    _log("spotify_delete_playlist", id=playlist, title=meta.get("title"), items=len(backup))
    if config().get("spotify_playlist") == playlist:
        set_config(spotify_playlist=None)
    sync_playlists()
    return {"ok": True, "backup": len(backup)}


def add(track_id, playlist=None, position=None):
    if not TRACK_ID_RE.match(track_id or ""):
        raise MusicError("Titre invalide.")
    playlist = _own(playlist or allowed_playlists()["default"] or "")
    uri = f"spotify:track:{track_id}"
    if playlist == "liked":
        if _api("GET", "me/library/contains", {"uris": uri}) == [True]:
            return {"ok": True, "already": True, "playlistId": playlist}
        _api("PUT", "me/library", {"uris": uri})
        _log("spotify_like", track=track_id)
        return {"ok": True, "already": False, "playlistId": playlist, "itemId": track_id}
    if any((e.get("track") or e.get("item") or {}).get("uri") == uri for e in _all_tracks(playlist)):
        return {"ok": True, "already": True, "playlistId": playlist}
    body = {"uris": [uri]}
    if isinstance(position, int) and position >= 0:
        body["position"] = position
    _api("POST", f"playlists/{playlist}/items", body=body)
    _log("spotify_add_item", playlist=playlist, track=track_id)
    return {"ok": True, "already": False, "playlistId": playlist, "itemId": track_id}   # itemId: to undo


def remove_item(playlist, item_id, track_id):
    if not TRACK_ID_RE.match(track_id or ""):
        raise MusicError("Titre invalide.")
    if _own(playlist) == "liked":
        _api("DELETE", "me/library", {"uris": f"spotify:track:{track_id}"})
    else:
        _api("DELETE", f"playlists/{playlist}/items", body={"items": [{"uri": f"spotify:track:{track_id}"}]})
    _log("spotify_remove_item", playlist=playlist, track=track_id)
    return {"ok": True}


def move_item(playlist, item_id, track_id, position, origin):
    if not (isinstance(position, int) and isinstance(origin, int) and position >= 0 and origin >= 0):
        raise MusicError("Déplacement invalide.")
    _fixed(playlist)
    _api("PUT", f"playlists/{_own(playlist)}/items",
         body={"range_start": origin, "insert_before": position + 1 if position > origin else position})
    _log("spotify_move_item", playlist=playlist, track=track_id, position=position)
    return {"ok": True}
