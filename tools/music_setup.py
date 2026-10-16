"""Set up song identification (AudD) and the YouTube playlist for Carte's radio player.

    python3 tools/music_setup.py status                     what is configured
    python3 tools/music_setup.py audd                       asks for the AudD API key (hidden input)
    python3 tools/music_setup.py youtube <client_secret.json>
        opens Google's consent page in the browser (OAuth for a "Desktop app" client, PKCE,
        loopback redirect), then stores the refresh token and lists your playlists
    python3 tools/music_setup.py playlists                  approves all your playlists for the page (rerun
                                                            after creating a new one) and lists them
    python3 tools/music_setup.py playlist <id>              the playlist selected by default in the page

Everything is written to ~/.config/carte/ (folder 700, files 600), never into the project.
Revoke access at any time: https://myaccount.google.com/permissions, then delete youtube_token.json.
"""
import base64
import getpass
import hashlib
import http.server
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import music  # noqa: E402

SCOPE = "https://www.googleapis.com/auth/youtube"   # narrowest scope that allows adding to a playlist


write_private, set_config = music.write_private, music.set_config


def youtube(client_file):
    c = json.loads(Path(client_file).read_text(encoding="utf-8"))
    c = c.get("installed") or c.get("web") or c
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    got = {}

    class Catch(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
            if q.get("state") == state:
                got.update(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<p>Carte : autorisation reçue, tu peux fermer cet onglet.</p>".encode())

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Catch)
    redirect = f"http://127.0.0.1:{srv.server_port}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    print("Ouvre cette page si le navigateur ne s'ouvre pas :\n" + url)
    webbrowser.open(url)
    while "code" not in got and "error" not in got:
        srv.handle_request()
    if "error" in got:
        sys.exit(f"Refusé : {got['error']}")
    data = urllib.parse.urlencode({
        "code": got["code"], "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
        "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier,
    }).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=data)) as r:
        tok = json.loads(r.read())
    if "refresh_token" not in tok:
        sys.exit("Google n'a pas renvoyé de refresh token ; révoque l'accès et recommence.")
    write_private(music.YT_TOKEN, {"client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
                                   "refresh_token": tok["refresh_token"]})
    print(f"Connecté. Jeton enregistré dans {music.YT_TOKEN} (lisible par toi seul).\n")
    playlists()


def playlists():
    items = music.sync_playlists()
    for p in items:
        print(f"{p['id']}  {p['snippet']['title']}  ({p['contentDetails']['itemCount']} vidéos)")
    print(f"\n{len(items)} playlists autorisées ; le choix se fait dans la page (menu Playlist).")


def status():
    conf = music.config()
    print("AudD     :", "clé enregistrée" if conf.get("audd_token") else "absente")
    print("YouTube  :", "connecté" if music.YT_TOKEN.exists() else "non connecté")
    print("Playlists:", len(conf.get("youtube_playlists") or []), "autorisées ; par défaut :", conf.get("youtube_playlist") or "aucune")


if __name__ == "__main__":
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else "status"), sys.argv[2:]
    try:
        if cmd == "audd":
            set_config(audd_token=(args[0] if args else getpass.getpass("Clé API AudD : ")).strip())
            print("Clé AudD enregistrée.")
        elif cmd == "youtube" and args:
            youtube(args[0])
        elif cmd == "playlists":
            playlists()
        elif cmd == "playlist" and args:
            set_config(youtube_playlist=args[0])
            print(f"Playlist {args[0]} enregistrée.")
        elif cmd == "status":
            status()
        else:
            print(__doc__)
    except music.MusicError as e:
        sys.exit(str(e))
