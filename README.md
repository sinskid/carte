# Carte — world radio and TV map

**Carte** is a world map you open in your web browser. Click a country and you can:

- 📻 **listen to its radio stations**, live;
- 📺 **watch its TV channels**, live;
- ✅ **mark it as visited** (it turns green on the map);
- ❤️ **keep your favourite stations and channels** in a sidebar, to play them again in one click.

Everyone gets their own map: your favourites and visited countries are yours only.

Extra features (optional, they need a little setup, see [Part 4](#part-4--optional-music-features)):

- ♫ find out **which song is playing** on the radio;
- add that song to one of your **YouTube or Spotify playlists**, and manage your playlists from the map.

All of it is set up from inside the app (**⚙ Settings**), step by step.

The app's buttons and menus are in French (for example *Ajouter* = Add, *Rechercher* = Search,
*Ma musique* = My music).

---

## Contents

- [Part 1 — The quickest way: use it online, nothing to install](#part-1--the-quickest-way-use-it-online-nothing-to-install)
- [Part 2 — Run Carte on your own computer](#part-2--run-carte-on-your-own-computer)
- [Part 3 — Put your own Carte online (GitHub Pages)](#part-3--put-your-own-carte-online-github-pages)
- [Part 4 — Optional music features](#part-4--optional-music-features)
- [Part 5 — How to use the map](#part-5--how-to-use-the-map)
- [Problems and solutions](#problems-and-solutions)
- [For the curious: how it works](#for-the-curious-how-it-works)

### Which part do I need?

| I want to… | Read |
|---|---|
| just use the map, radio and TV | Part 1 (if someone already put it online) or Part 2 |
| have my own copy online, to open from any computer or phone | Part 3 |
| identify songs and use YouTube or Spotify playlists | Part 2, then Part 4 |

---

## Part 1 — The quickest way: use it online, nothing to install

If someone has already published Carte (Part 3), they will give you an address like
`https://someone.github.io/carte/`. Open it in your browser: that's all.

Your favourites and visited countries are saved **in your browser**, on that computer. Another
computer or another browser starts with an empty map. Clearing your browser's history and site
data also erases them.

The music features (Part 4) are not available this way; you need Part 2 for them.

---

## Part 2 — Run Carte on your own computer

You will type a few commands in a **terminal**: a window where you type instructions to the
computer instead of clicking. Each command is explained. Type it (or copy-paste it), then press
**Enter**.

### Step 1 — Open a terminal

- **Windows**: press the Windows key, type `PowerShell`, press Enter.
- **macOS**: press `Cmd + Space`, type `Terminal`, press Enter.
- **Linux**: press `Ctrl + Alt + T`, or look for "Terminal" in your applications.

### Step 2 — Check that Python is installed

Carte's small program is written in **Python** (version 3.9 or newer). Type:

```bash
python3 --version
```

This asks the computer which version of Python it has. You should see something like
`Python 3.12.3`.

- **On Windows**, type `python --version` instead (Windows calls it `python`, not `python3`).
  In every command below, replace `python3` with `python`.
- If you get *"command not found"*, *"not recognized"*, or a version lower than 3.9: install
  Python from https://www.python.org/downloads/ (on Windows, tick **"Add python.exe to PATH"** in
  the installer), then close and reopen the terminal and try again.

### Step 3 — Download Carte

**Option A, without git (simplest):**

1. On this project's GitHub page, click the green **Code** button, then **Download ZIP**.
2. Unzip the file (double-click it, or right-click → *Extract all*). You get a folder, for
   example `carte-main`, probably in your *Downloads* folder.

**Option B, with git** (if you already use git):

```bash
git clone https://github.com/<owner>/<repo>.git
```

This copies the whole project from GitHub into a new folder on your computer. Replace
`<owner>/<repo>` with the real address shown on the GitHub page.

### Step 4 — Go into the Carte folder

The terminal always works "inside" one folder. Move into Carte's folder with `cd` (*change
directory*):

```bash
cd Downloads/carte-main
```

Adapt the path to where your folder really is. Tips:

- type `cd ` (with a space), then **drag the folder from your file explorer into the terminal**:
  the path is written for you; press Enter;
- to check you are in the right place, type `ls` (macOS/Linux) or `dir` (Windows): you should see
  `server.py`, `README.md` and the `web` folder.

### Step 5 — Start Carte

```bash
python3 server.py
```

**On Windows**, type `python server.py` instead (Windows calls Python `python`, not `python3`;
this is true for every command in this guide). If Windows asks whether to allow Python on the
network, you can say no: Carte only talks to your own computer.

This starts Carte's small local server: a program that shows the map to your browser and saves
your favourites. You should see:

```
Carte on http://localhost:8765
```

**Leave this terminal window open**: Carte runs as long as it is open.

### Step 6 — Open the map

Open your web browser (Firefox, Chrome, Edge, Safari…) and go to:

**http://localhost:8765**

`localhost` means "this computer": the map comes from the program you just started, not from the
internet. Nobody else can reach it.

### Step 7 — Stop Carte

Go back to the terminal and press **`Ctrl + C`**. To use Carte again later, repeat steps 1, 4 and
5 (open a terminal, `cd` into the folder, `python3 server.py`, or `python server.py` on Windows).

Your favourites and visited countries are saved in the `data` folder inside the Carte folder.
Keep it if you move or update Carte.

---

## Part 3 — Put your own Carte online (GitHub Pages)

**GitHub** is a website that stores code projects. **GitHub Pages** is its free service to publish
a website from a project. Once done, your Carte has its own address, which you can open from any
computer or phone, and share with friends (each visitor has their own favourites, kept in their
browser).

The online version has the map, radio, TV, favourites and visited countries, but **not** the
music features of Part 4 (those need the program from Part 2, which keeps your secret keys on
your computer).

### Step 1 — Create a GitHub account

Go to https://github.com and sign up (free).

### Step 2 — Create an empty repository

A *repository* ("repo") is a project folder on GitHub.

1. Click **+** (top right) → **New repository**.
2. **Repository name**: for example `carte`.
3. Choose **Public** (GitHub Pages is free for public repositories).
4. Leave everything else as it is, and click **Create repository**.

### Step 3 — Put the Carte files in it

**Option A, in the browser (no git):**

1. On your new, empty repository page, click the link **"uploading an existing file"**.
2. Open the Carte folder on your computer, select **everything inside it** (including the `web`
   folder and the hidden `.github` folder, see the tip below) and drag it onto the page.
3. Click **Commit changes** at the bottom.

> **Tip:** `.github` starts with a dot, so it is hidden. Show hidden files: on Windows, in the file
> explorer, *View → Show → Hidden items*; on macOS, press `Cmd + Shift + .` in Finder. If you can't
> upload it, use Option B or follow the "Without the workflow" note in Step 4.

**Option B, with git** (from inside the Carte folder, see Part 2 step 4):

```bash
git init
```
Turns the folder into a git project (git records the history of your files).

```bash
git add .
```
Selects all the files (`.` means "everything here") for the next save.

```bash
git commit -m "My Carte"
```
Saves that selection as a version, with a short description. If git asks who you are, run these
two commands first, with your own name and the e-mail of your GitHub account, then retry:
`git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.

```bash
git branch -M main
```
Names the main version line `main`, as GitHub expects.

```bash
git remote add origin https://github.com/<your-username>/carte.git
```
Tells git where your GitHub repository is (copy the exact address from your repository page).

```bash
git push -u origin main
```
Sends your files to GitHub. Git asks for your GitHub username, and for the password **a personal
access token** (GitHub → your photo → *Settings → Developer settings → Personal access tokens*),
not your normal password.

### Step 4 — Switch GitHub Pages on

1. In your repository, click **Settings** (top) → **Pages** (left menu).
2. Under **Source**, choose **GitHub Actions**.
3. Click the **Actions** tab: a task named **Pages** runs (if not, push or upload any change).
   After about a minute it shows a green tick, and the address of your site, like
   `https://<your-username>.github.io/carte/`.

> **Without the workflow** (if you couldn't upload the hidden `.github` folder): in *Settings →
> Pages*, choose **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
> Your map is then at `https://<your-username>.github.io/carte/web/`.

Each time you change files in the repository, the site updates itself within a minute or two.

---

## Part 4 — Optional music features

These only work with Carte running on your computer (Part 2). Everything is set up **from inside
the app**, no typing in a terminal:

- **The first time you open Carte**, a welcome assistant asks for your language, shows what Carte
  does, and asks which music features you want; it then shows only the steps for those. You can
  stop at any point ("Later") and finish another day.
- **Later**, click **⚙ Settings** at the top of the screen, section **Music accounts** (or "Run the
  welcome assistant again"). Open a section, follow its numbered steps (each step has a direct
  link to the right page), and come back to the window between steps.

| Section | What it gives you | Cost | Time |
|---|---|---|---|
| **Song recognition** | ♫ on the radio player finds the song playing | free trial, then pay per use | 2 min |
| **YouTube** | add songs to your YouTube playlists, manage them, play them | free | ~10 min |
| **Spotify** | the same with your Spotify playlists | **needs Spotify Premium** (Spotify only lets developer apps work for Premium accounts) | ~5 min |

You can set up only one of them, or all three. YouTube and Spotify both need a "developer app"
that **you** create for yourself: these companies don't let a small open-source project sign in
everyone through one shared app. It's free, and only your own account can use it.

### 4.1 Before you start: install yt-dlp (for YouTube search)

To find the YouTube videos matching a song, Carte uses a free tool called **yt-dlp**. In a
terminal (a second one, if Carte is running in the first), type:

```bash
python3 -m pip install --user yt-dlp
```

(On Windows: `python -m pip install --user yt-dlp`.)

`pip` is Python's tool for installing extra programs; `--user` installs it for your account only
(no administrator rights needed). Not needed if you only use Spotify.

### 4.2 Identify songs (AudD)

When you press **♫** on the radio player, Carte first uses **the title sent by the station**
(free, instant, no setup; many independent stations send it, big commercial ones often don't). For
the others, it records about 10 seconds of the radio stream (not your microphone) and asks
**[AudD](https://audd.io)**, a recognition service like Shazam.

In **⚙ Settings → Reconnaître les titres**:

1. Click the link to **dashboard.audd.io**, create an account, and copy your **API token**.
2. Paste it in the field and click **Enregistrer** (save). The badge turns green: *clé enregistrée*.

### 4.3 Connect YouTube

In **⚙ Settings → YouTube**, each numbered step has a link that opens the right Google page in a
new tab. Sign in there with **the Google account of your YouTube channel**.

1. **Create a project** named `Carte`. Check it is selected at the top of the Google page.
2. **Enable "YouTube Data API v3"** (the blue *Enable* button).
3. **Consent screen**: *Get started*, app name `Carte`, your e-mail, audience **External**.
   (This is the page Google will show you when you approve Carte.)
4. **Audience → Test users → Add users**: add **your own Gmail address**.
   ⚠️ If you skip this, Google later refuses with *"Error 403: access_denied"*.
5. **Clients → Create client**: type **Desktop app**, then **Download JSON**. A file named like
   `client_secret_123….json` lands in your *Downloads* folder.
6. Back in Carte, click **Choisir le JSON…** (choose the JSON) and pick that file. Carte stores
   it safely; you can then delete the downloaded file.
7. Click **Se connecter avec Google** (sign in with Google). You go to Google's page:
   - choose your account;
   - Google warns *"Google hasn't verified this app"*: click **Advanced → Go to Carte**. It's your
     own app, so this is expected;
   - click **Continue / Allow**.

   Google sends you back to Carte, which says **"YouTube est connecté"**.

**Keep it working:** while your Google app is in **Testing** mode, Google cancels the access after
**7 days** (Carte will say the authorisation expired; just click *Se connecter avec Google* again).
To avoid that, use the link in the window: **Audience → Publish app → Confirm**.

### 4.4 Connect Spotify

In **⚙ Settings → Spotify**:

1. Open the **Spotify developer dashboard** (link in the window), sign in with your Spotify
   account and accept the terms.
2. **Create app**: name `Carte`, any short description. In **Redirect URIs**, paste the address
   shown in Carte's window (like `http://127.0.0.1:8765/oauth/spotify`; **click it in Carte to
   copy it**), then click **Add**. Tick **Web API**, accept, **Save**.
   The address must match exactly. If you start Carte on another port (`--port`), add that
   address too.
3. In your Spotify app: **Settings → User Management**: add your name and **the e-mail of your
   Spotify account**.
4. Still in **Settings**, copy the **Client ID** (32 characters), paste it in Carte and click
   **Enregistrer**. (Spotify's *Client secret* is **not** needed: Carte uses a method, called
   PKCE, that works without it.)
5. Click **Se connecter avec Spotify**, approve on Spotify's page, and you're back in Carte:
   **"Spotify est connecté"**.

**Playback:** Carte becomes a Spotify device called "Carte" (Spotify's Web Playback SDK) and plays
songs in full. The browser must allow DRM-protected content: Firefox asks once with a yellow bar
("Enable DRM"); Chrome allows it by default. If full playback cannot start, Carte falls back to
Spotify's 30-second extracts and says why in the video window.

### 4.5 Using the music features

- **Song on the radio → playlist:** press ♫ on the radio player. A card shows the song and the
  matching songs on YouTube or Spotify. Click one to **listen to it here** (the radio pauses, and
  resumes when you close the video window). Pick a playlist in the **Playlist** menu, then click
  **Ajouter** (add). The menu's last option, **↻ Actualiser**, reloads your playlists after you
  create one elsewhere.
- **"♫ Ma musique"** button (top of the screen):
  - if both YouTube and Spotify are connected, a **YouTube | Spotify** switch at the top chooses
    which one you're working with (the song card follows the same choice);
  - **Playlists** tab: your playlists A→Z. Create one (name + visibility → *Créer*). Click a
    playlist to open it: **▶ Tout lire** plays it all; click a song to play it; **↑ ↓** move a
    song; **+** copies a song to another playlist; **✕** removes it (an *Annuler* (undo) button
    appears for a few seconds). **Modifier** renames it or changes its visibility; **Supprimer**
    deletes the playlist (it asks first);
  - **Rechercher** tab: search; click a result to play it, **+** to add it to a playlist.
- YouTube videos play in the video window at the bottom left, one after another (**⏮ ⏭** to
  skip); videos that can't be played in your country are greyed out and skipped. Spotify plays in
  the same window with Spotify's own player.

### 4.6 Security, in plain words

- **Your keys stay on your computer.** What you paste in ⚙ Settings goes once to Carte's own
  program on your computer, which saves it in a hidden folder (`.config/carte` in your home
  folder) that only your user account can read. The web page can never read them back; it only
  knows *whether* something is set up. Nothing is put in the Carte folder or sent to GitHub.
- **No passwords.** Google and Spotify sign-in happens on their own pages (this is **OAuth**).
  Carte only receives a permission that you can cancel at any time.
- **No fake sign-ins.** Each sign-in carries a random one-time code made by Carte; Carte refuses
  any return from Google/Spotify it didn't start, so another website can't connect *its* account
  to your Carte.
- **Only your computer.** Carte's server only accepts connections from your own computer, and
  refuses requests from any other website open in your browser.
- **Limited access.** YouTube: YouTube only (not Gmail, Drive…). Spotify: your playlists and basic
  profile only. Carte only changes **your own** playlists. Before deleting a playlist, it saves
  its list of songs in `.config/carte/deleted_playlists/`; every change is written to
  `.config/carte/youtube_actions.log`.
- **To cancel access:** in ⚙ Settings, click **Déconnecter** (disconnect) under the service.
  To also remove it on the company's side: https://myaccount.google.com/permissions (Google) or
  https://www.spotify.com/account/apps/ (Spotify), and remove **Carte**.
- **Limits:** YouTube allows about **200 changes per day** (adding, moving, removing songs).
  Videos blocked **in France** are detected by default; if you live elsewhere, open
  `.config/carte/config.json` in a text editor and add `"region": "GB",` (your country's
  two-letter code) after the first `{`.

**Prefer the terminal?** The same setup works with `python3 tools/music_setup.py` (`audd`,
`youtube <client_secret.json>`, `playlists`, `status`).

---

## Part 5 — How to use the map

- **Move**: drag the map. **Zoom**: mouse wheel, pinch on a touchpad, or the **+ / − / ⤢**
  buttons at the bottom left (⤢ = whole world).
- **⚙ Settings** (top of the screen): language (Français, English, Español, 中文, العربية; Arabic
  reads right to left), appearance (automatic, light, dark), the music service to use (YouTube or
  Spotify, when both are connected) and the music accounts. Carte remembers your choices.
- **♫ My music** is red when it works with YouTube and green with Spotify; the song card (♫ on the
  radio player) has the same YouTube | Spotify switch at its top.
- **Find a country**: type its name in the search box at the top (in the interface's language, or
  in French or English; accents don't matter, and Enter on the first letters is enough: "jap"), or
  click it.
- **Country panel** (on the right): capital, languages, currency; the **I've been there** button
  marks it as visited (green on the map); tabs **Radio** and **TV**.
- **Radio**: click a station to play it. The player at the bottom keeps playing when you look at
  other countries; click the station's name in the player to go back to its country and list. **♡** next to a station adds it to your favourites.
- **TV**: click a channel; it plays in a small window at the bottom left. Some channels only work
  inside their own country, or are offline: Carte tries the next link automatically.
- **Favourites** (top left): all your favourite stations and channels from every
  country; click to play, click the heart to remove.
- **Escape** closes the panel.

---

## Problems and solutions

| Problem | Solution |
|---|---|
| `python3: command not found` / *not recognized* | Install Python (Part 2, step 2). On Windows use `python` instead of `python3`. |
| `can't open file 'server.py'` / `No such file or directory` | You are not in the Carte folder: do Part 2, step 4 again (`cd` into it, check with `ls` or `dir`). |
| `Port 8765 is already in use` | Carte (or another program) already uses that port. Use the Carte already running, stop it there with `Ctrl + C`, or start on another port: `python3 server.py --port 8766`, then open http://localhost:8766. |
| The page `http://localhost:8765` doesn't open | The server isn't running: is the terminal from Part 2 step 5 still open, without error? |
| A station or channel doesn't play | Streams come and go; try another one. Some TV channels only work inside their country. |
| The ♫ button, "Ma musique" or "⚙ Settings" doesn't appear | They only appear when Carte runs on your computer (Part 2); "Ma musique" only after connecting YouTube or Spotify (Part 4). |
| "Titre non reconnu" (song not recognised) | Try again during music (not during ads or talk). Without an AudD key (4.2), only stations that send their titles work. |
| "Recherche YouTube impossible" (YouTube search failed) | Install or update yt-dlp: `python3 -m pip install --user -U yt-dlp` (`-U` = upgrade; YouTube changes often, so an old yt-dlp can stop working). |
| Google: *Error 403: access_denied* | Add your Gmail address as a **test user** (Part 4.3, step 4), then click *Se connecter avec Google* again. |
| "Autorisation YouTube expirée" (expired) | Click *Se connecter avec Google* again in ⚙ Settings, and consider *Publish app* (Part 4.3). |
| Spotify: *INVALID_CLIENT: Invalid redirect URI* | The Redirect URI in your Spotify app must be exactly the one shown in ⚙ Settings (Part 4.4, step 2), including the port number. |
| Spotify: *403* / "user not registered" | Add your Spotify e-mail in your Spotify app's **User Management** (Part 4.4, step 3). |
| "YouTube a refusé (403) … quota" | The daily limit of changes is reached; it resets the next day. |
| My favourites disappeared | Online version: they live in one browser on one computer; clearing site data erases them. Local version: they are in the `data` folder of your Carte folder. |

---

## For the curious: how it works

- `web/` — the web page itself: `index.html` (layout), `app.js` (map, radio, TV, favourites,
  music), `style.css` (look), `data/` (country shapes and facts). This is what GitHub Pages
  publishes.
- `server.py` — the optional local server (Part 2): shows `web/`, saves favourites and visited
  countries in `data/`, and handles the music features.
- `music.py` — song recognition, YouTube search and the YouTube API.
- `spotify.py` — the same for Spotify.
- `connect.py` — the ⚙ Settings setup and the Google / Spotify sign-in (OAuth with PKCE).
- `tools/music_setup.py` — terminal alternative to ⚙ Settings.
- `tools/build_map.py`, `tools/build_facts.py` — rebuild `web/data/` from the original sources
  (not needed to use Carte).

**Where the data comes from**

- Country shapes: [Natural Earth](https://www.naturalearthdata.com) 1:50m (public domain).
- Capital, languages, currency: [mledoze/countries](https://github.com/mledoze/countries) (ODbL)
  and Wikidata (CC0).
- Radio stations: [Radio Browser](https://www.radio-browser.info), a free public directory.
- TV channels: [Famelack](https://github.com/famelack/famelack-data) (MIT licence, partly from
  iptv-org). Streams belong to their broadcasters.
- Included libraries (`web/vendor/`): [d3](https://d3js.org) 7.9.0 (ISC licence) for the map,
  [hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache 2.0) for live streams.
