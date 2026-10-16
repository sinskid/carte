"""Optional local server for Carte: serves web/ and adds what a static page cannot do.

    python3 server.py              # http://localhost:8765
    python3 server.py --port 8766  # another port, if 8765 is taken

Without it (web/ opened from GitHub Pages or any static host) the map, radio, TV, favourites and
visited countries still work, saved in the browser. With it they are saved in data/ instead, and
song recognition + YouTube playlists become available (they need private keys, kept server side).

API:
    GET  /api/state              {"favorites": {"radio": [], "tv": []}, "visited": [ids], "music": {...}}
    PUT  /api/favorites          body = {"radio": [...], "tv": [...]} -> data/favorites.json
    PUT  /api/visited            body = [ids] -> data/visited.json
    POST /api/nowplaying         {"url"} -> {"song"}: title sent by the radio station, or null
    POST /api/identify           {"url", "audio"?} -> {"song"}: station title, else (or if "audio") AudD on a 10 s clip
    POST /api/yt-search          {"q", "n"} -> {"results": [{id, title, channel, duration, thumb}]}
    POST /api/playlists          {} -> {"playlists": [{id, title}], "default"}
    POST /api/playlists/sync     re-reads the user's playlists from YouTube
    POST /api/playlists/default  {"playlistId"} -> the one selected in the page from now on
    POST /api/playlist/add       {"videoId", "playlistId", "position"?} -> adds it to one of the user's playlists
    POST /api/yt/...             "Ma musique" panel: playlists (list, create, update, delete), items (list,
                                 remove, move); see music.py section 4. Deleting saves a backup first.
    Every playlist / search route takes "service": "youtube" (default) or "spotify" (spotify.py).
    POST /api/spotify/token      {} -> {"token", "expiresIn"}: short-lived, for the page's Spotify player (full tracks)
    POST /api/setup/...          "⚙ Paramètres": audd {key}, google-client {json}, spotify-client {clientId},
                                 connect {service} -> {url}, disconnect {service} (connect.py)
    GET  /oauth/spotify, GET /?state=…   OAuth redirects from Spotify / Google, handled by connect.py

Error messages are written in French and translated (messages.py) into the language the page sends in
the X-Carte-Lang header.

Requests whose Host or Origin is not this server are refused (other web pages open in the browser,
DNS rebinding), since some routes act on the user's YouTube account. It listens on 127.0.0.1 only.
"""
import argparse
import json
import re
import sys
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import connect
import messages
import music
import spotify

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
FAVORITES = DATA / "favorites.json"
VISITED = DATA / "visited.json"
ID_RE = re.compile(r"^[A-Z0-9]{3}$")
PORT = 8765
SELF = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
connect_errors = []                                  # last sign-in error, shown once by the page


def read(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write(path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and self.command != "GET":
            super().log_message(fmt, *args)

    def end_headers(self):
        # Static files are revalidated on every load, so edits to web/ show up on a normal reload.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def foreign(self):
        """True (and answers 403) when the request does not come from the Carte page itself."""
        origin = self.headers.get("Origin")
        if self.headers.get("Host") in SELF and (origin is None or origin.split("://", 1)[-1] in SELF):
            return False
        self.send_json({"error": "forbidden"}, 403)
        return True

    def lang(self):
        return messages.lang_of(self.headers.get("X-Carte-Lang"))

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")

    def do_GET(self):
        if self.foreign():
            return
        if self.path == "/api/state":
            return self.send_json({
                "favorites": read(FAVORITES, {"radio": [], "tv": []}),
                "visited": read(VISITED, []),
                "music": {**connect.status(PORT),
                          "lastError": messages.tr(connect_errors.pop(), self.lang()) if connect_errors else None},
            })
        url = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/oauth/spotify" or (url.path == "/" and connect.is_callback(query)):
            try:
                back, error = connect.finish(query)
            except Exception as e:                                       # network trouble during the exchange
                back, error = "/#connexions", f"Erreur pendant la connexion : {type(e).__name__}"
            if error:
                connect_errors.append(error)
            self.send_response(302)
            self.send_header("Location", back)
            self.end_headers()
            return
        return super().do_GET()

    def do_PUT(self):
        if self.foreign():
            return
        try:
            data = json.loads(self.body() or "null")
        except ValueError:
            return self.send_json({"error": "bad json"}, 400)
        if self.path == "/api/favorites":
            if not (isinstance(data, dict) and all(isinstance(data.get(k), list) for k in ("radio", "tv"))):
                return self.send_json({"error": "expected {radio: [], tv: []}"}, 400)
            write(FAVORITES, {k: data[k] for k in ("radio", "tv")})
            return self.send_json({"ok": True})
        if self.path == "/api/visited":
            if not (isinstance(data, list) and all(isinstance(i, str) and ID_RE.match(i) for i in data)):
                return self.send_json({"error": "expected a list of country ids"}, 400)
            write(VISITED, sorted(set(data)))
            return self.send_json({"ok": True})
        return self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.foreign():
            return
        origin = self.headers.get("Origin") or f"http://localhost:{PORT}"
        sp = lambda b: b.get("service") == "spotify"
        routes = {
            "/api/nowplaying": lambda b: {"song": music.icy_title(b["url"])},
            "/api/identify": lambda b: {"song": music.identify(b["url"], bool(b.get("audio")))},
            "/api/yt-search": lambda b: {"results": (spotify.search if sp(b) else music.yt_search)(
                b["q"], max(1, min(int(b.get("n", 3)), 20)))},
            "/api/playlists": lambda b: (spotify if sp(b) else music).allowed_playlists(),
            "/api/playlists/sync": lambda b: ((spotify if sp(b) else music).sync_playlists(),
                                              (spotify if sp(b) else music).allowed_playlists())[1],
            "/api/playlists/default": lambda b: (spotify if sp(b) else music).set_default_playlist(b["playlistId"]),
            "/api/playlist/add": lambda b: (spotify.add if sp(b) else music.youtube_add)(
                b["videoId"], b.get("playlistId"), b.get("position")),
            "/api/yt/playlists": lambda b: (spotify if sp(b) else music).list_playlists(),
            "/api/yt/playlist/create": lambda b: (spotify if sp(b) else music).create_playlist(
                b["title"], b.get("privacy", "private"), b.get("description", "")),
            "/api/yt/playlist/update": lambda b: (spotify if sp(b) else music).update_playlist(
                b["id"], b["title"], b["privacy"], b.get("description", "")),
            "/api/yt/playlist/delete": lambda b: (spotify if sp(b) else music).delete_playlist(b["id"]),
            "/api/yt/items": lambda b: (spotify if sp(b) else music).playlist_items(b["playlistId"]),
            "/api/yt/item/remove": lambda b: (spotify if sp(b) else music).remove_item(
                b["playlistId"], b["itemId"], b.get("videoId", "")),
            "/api/yt/item/move": lambda b: spotify.move_item(b["playlistId"], b["itemId"], b["videoId"], b["position"], b["from"])
                                           if sp(b) else music.move_item(b["playlistId"], b["itemId"], b["videoId"], b["position"]),
            "/api/spotify/token": lambda b: spotify.player_token(),
            "/api/setup/audd": lambda b: connect.save_audd(b["key"]),
            "/api/setup/google-client": lambda b: connect.save_google_client(b["json"]),
            "/api/setup/spotify-client": lambda b: connect.save_spotify_client(b["clientId"]),
            "/api/setup/connect": lambda b: connect.start(b["service"], PORT, origin),
            "/api/setup/disconnect": lambda b: connect.disconnect(b["service"]),
        }
        if self.path not in routes:
            return self.send_json({"error": "not found"}, 404)
        try:
            return self.send_json(routes[self.path](json.loads(self.body() or "{}")))
        except music.MusicError as e:
            return self.send_json({"error": messages.tr(str(e), self.lang())}, 502)
        except (KeyError, TypeError, ValueError):
            return self.send_json({"error": messages.tr("requête invalide", self.lang())}, 400)
        except Exception as e:                                       # network trouble with AudD / YouTube
            return self.send_json({"error": messages.tr(f"Erreur : {type(e).__name__}", self.lang())}, 502)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Carte's local server")
    parser.add_argument("--port", type=int, default=PORT, help=f"port to listen on (default {PORT})")
    PORT = parser.parse_args().port
    SELF = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
    DATA.mkdir(exist_ok=True)
    handler = partial(Handler, directory=str(ROOT / "web"))
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        sys.exit(f"Port {PORT} is already in use (is Carte already running in another terminal?).\n"
                 f"Use that one, or start this one on another port: python3 server.py --port {PORT + 1}")
    print(f"Carte on http://localhost:{PORT}  (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nCarte stopped.")
