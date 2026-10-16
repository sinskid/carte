"""In-app setup ("⚙ Paramètres"): AudD key, Google (YouTube) and Spotify sign-in.

The page sends each key once to this local server, which stores it in ~/.config/carte/ (600); the
page can then only see *whether* something is configured, never the value. Sign-in uses OAuth 2.0
with PKCE and a random `state`: the server builds the provider's URL, the browser goes there, the
provider sends the browser back to http://127.0.0.1:<port>/… with a one-time code, and the server
swaps that code for a refresh token. A callback whose `state` was not issued here is refused, so
another site cannot plant its own account.
"""
import base64
import hashlib
import json
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import music
import spotify
from music import CONF_DIR, MusicError, write_private

GOOGLE_CLIENT = CONF_DIR / "google_client.json"
SPOTIFY_CLIENT = CONF_DIR / "spotify_client.json"
SCOPES = {
    "youtube": "https://www.googleapis.com/auth/youtube",
    "spotify": "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-private"
               " streaming user-read-email user-read-playback-state user-modify-playback-state"   # full playback
               " user-library-read user-library-modify",                                          # "Titres likés"
}
_pending = {}                                       # state -> {service, verifier, redirect, back, ts}


def redirect_uri(service, port):
    # Google "Desktop app" clients accept any loopback port on the root path; Spotify needs the exact
    # URI registered in its dashboard (and refuses "localhost", hence 127.0.0.1).
    return f"http://127.0.0.1:{port}/" if service == "youtube" else f"http://127.0.0.1:{port}/oauth/spotify"


def status(port):
    conf = music.config()
    return {
        "audd": bool(conf.get("audd_token")),
        "youtube": music.YT_TOKEN.exists(), "youtubeClient": GOOGLE_CLIENT.exists() or music.YT_TOKEN.exists(),
        "spotify": spotify.connected(), "spotifyClient": SPOTIFY_CLIENT.exists(),
        "spotifyRedirect": redirect_uri("spotify", port),
    }


# ---------- keys typed in the page ----------
def save_audd(key):
    key = (key or "").strip()
    if not re.fullmatch(r"[0-9A-Za-z]{20,64}", key):
        raise MusicError("Ça ne ressemble pas à une clé AudD (une longue suite de chiffres et de lettres).")
    music.set_config(audd_token=key)
    return {"ok": True}


def save_google_client(text):
    try:
        c = json.loads(text)
    except ValueError:
        raise MusicError("Ce n'est pas le fichier JSON téléchargé depuis Google.")
    c = c.get("installed") or c.get("web") or c
    if not str(c.get("client_id", "")).endswith(".apps.googleusercontent.com") or not c.get("client_secret"):
        raise MusicError("Fichier incomplet : télécharge le JSON du client « Application de bureau ».")
    write_private(GOOGLE_CLIENT, {"client_id": c["client_id"], "client_secret": c["client_secret"]})
    return {"ok": True}


def save_spotify_client(client_id):
    client_id = (client_id or "").strip()
    if not re.fullmatch(r"[0-9a-f]{32}", client_id):
        raise MusicError("Le Client ID Spotify fait 32 caractères (chiffres et lettres a-f).")
    write_private(SPOTIFY_CLIENT, {"client_id": client_id})
    return {"ok": True}


def disconnect(service):
    path = {"youtube": music.YT_TOKEN, "spotify": spotify.TOKEN}.get(service)
    if path and path.exists():
        path.unlink()
    if service == "audd":
        music.set_config(audd_token=None)
    music._access.update(token=None, until=0)
    spotify._access.update(token=None, until=0)
    spotify._me.clear()
    return {"ok": True}


# ---------- OAuth ----------
def _client(service):
    if service == "youtube":
        if GOOGLE_CLIENT.exists():
            return json.loads(GOOGLE_CLIENT.read_text(encoding="utf-8"))
        if music.YT_TOKEN.exists():                  # set up earlier with tools/music_setup.py
            t = json.loads(music.YT_TOKEN.read_text(encoding="utf-8"))
            return {"client_id": t["client_id"], "client_secret": t["client_secret"]}
    elif service == "spotify" and SPOTIFY_CLIENT.exists():
        return json.loads(SPOTIFY_CLIENT.read_text(encoding="utf-8"))
    raise MusicError("Étape précédente manquante : enregistre d'abord la clé de l'application.")


def start(service, port, back):
    """URL of the provider's consent page; `back` = page origin to return to afterwards."""
    if service not in SCOPES:
        raise MusicError("Service inconnu.")
    client = _client(service)
    for s, p in list(_pending.items()):              # forget attempts older than 15 min
        if time.time() - p["ts"] > 900:
            del _pending[s]
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    redirect = redirect_uri(service, port)
    _pending[state] = {"service": service, "verifier": verifier, "redirect": redirect, "back": back, "ts": time.time()}
    params = {"client_id": client["client_id"], "redirect_uri": redirect, "response_type": "code",
              "scope": SCOPES[service], "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    if service == "youtube":
        params.update(access_type="offline", prompt="consent")
        return {"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)}
    return {"url": "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(params)}


def is_callback(query):
    return query.get("state") in _pending


def finish(query):
    """Handle the provider's redirect. Returns (page URL to send the browser back to, error or None)."""
    p = _pending.pop(query.get("state"), None)
    if not p:
        return "/", "Lien de connexion inconnu ou expiré : recommence depuis ⚙ Paramètres."
    service, back = p["service"], p["back"]
    if "error" in query or "code" not in query:
        return f"{back}/#connexions", f"Connexion refusée ({query.get('error', 'annulée')})."
    client = _client(service)
    form = {"grant_type": "authorization_code", "code": query["code"], "redirect_uri": p["redirect"],
            "client_id": client["client_id"], "code_verifier": p["verifier"]}
    if service == "youtube":
        form["client_secret"] = client["client_secret"]
    url = "https://oauth2.googleapis.com/token" if service == "youtube" else "https://accounts.spotify.com/api/token"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=urllib.parse.urlencode(form).encode()), timeout=15) as r:
            tok = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return f"{back}/#connexions", f"Échange du code refusé ({e.code})."
    if "refresh_token" not in tok:
        return f"{back}/#connexions", "Pas de jeton durable reçu : retire l'accès de Carte dans ton compte puis recommence."
    if service == "youtube":
        write_private(music.YT_TOKEN, {**client, "refresh_token": tok["refresh_token"]})
        music._access.update(token=None, until=0)
        music.sync_playlists()
    else:
        write_private(spotify.TOKEN, {"client_id": client["client_id"], "refresh_token": tok["refresh_token"],
                                      "scope": tok.get("scope", "")})
        spotify._access.update(token=None, until=0)
        spotify._me.clear()
        spotify.sync_playlists()
    music._log("connect", service=service)
    return f"{back}/#connexions-{service}", None
