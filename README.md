# Carte 🌍

A world map you can listen to. Click a country to hear its radio stations live, watch its TV
channels, and keep your favourites. In French, English, Spanish, Chinese and Arabic.

**Just want to try it?** Open **https://sinskid.github.io/carte/**. Nothing to install.

Install it on your computer only if you also want the music extras: find out which song is playing
on the radio, and save it to your YouTube or Spotify playlists.

---

## Install it in 4 steps

### 1. Install Python (once)

Carte needs Python, a free program.

- **Windows**: download it from **https://www.python.org/downloads/** and run the installer.
  ⚠️ On the first screen, tick **"Add python.exe to PATH"**, then click *Install Now*.
- **Mac**: download it from **https://www.python.org/downloads/** and run the installer.
- **Linux**: it is already installed.

### 2. Download Carte

1. Go to **https://github.com/sinskid/carte**
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip the file (double-click it on Mac, right-click → *Extract All* on Windows).

You now have a folder called `carte-main`.

### 3. Start Carte

Open a terminal **inside** the `carte-main` folder:

- **Windows**: open the folder, click in the address bar at the top, type `cmd` and press Enter.
- **Mac**: right-click the folder → *Services* → **New Terminal at Folder**.
- **Linux**: open the folder, right-click in it → **Open in Terminal**.

Then type this and press Enter:

| Windows | Mac and Linux |
|---|---|
| `python server.py` | `python3 server.py` |

You should see `Carte on http://localhost:8765`. **Leave this window open** while you use Carte.

### 4. Open the map

In your browser, go to **http://localhost:8765**

That's it! The first time, Carte welcomes you and asks for your language and which music
features you want. It then walks you through each step, with a link for every one.

---

## Every other time

Open a terminal in the `carte-main` folder again (step 3), type the same command, and go to
**http://localhost:8765**.

To stop Carte, go back to the terminal and press **Ctrl + C** (or just close it).

---

## Updating to a new version

The online version updates by itself. If you installed Carte:

1. Stop Carte (**Ctrl + C**).
2. Download the ZIP again (step 2) and unzip it.
3. Copy the **`data`** folder from your old `carte-main` folder into the new one: it holds your
   favourites and visited countries.
4. Delete the old folder and start Carte from the new one (step 3).

Your music accounts stay connected: they are saved outside the Carte folder.

---

## Using YouTube?

To find songs on YouTube, Carte needs one more free tool. In a terminal, type once:

| Windows | Mac and Linux |
|---|---|
| `python -m pip install yt-dlp` | `python3 -m pip install yt-dlp` |

Spotify and song recognition don't need it.

---

## Something's wrong?

| What you see | What to do |
|---|---|
| `python` is not recognized / command not found | Python isn't installed, or on Windows "Add python.exe to PATH" wasn't ticked. Reinstall it (step 1). |
| `can't open file 'server.py'` | The terminal isn't in the `carte-main` folder. Redo step 3. |
| `Port 8765 is already in use` | Carte is already running in another window: just use it. Or type `python server.py --port 8766` and go to http://localhost:8766 |
| The page doesn't open | Check that the terminal window is still open and shows `Carte on http://localhost:8765`. |
| `externally-managed-environment` when installing yt-dlp (Linux) | Type `sudo apt install yt-dlp` instead (or `pipx install yt-dlp`). |
| Spotify only plays 30-second clips | In your browser's settings, allow **protected content (DRM)**, then reload the page. |
| Anything else about music | Click **⚙ Settings** at the top of the map: everything can be redone from there. |

---

<details>
<summary>Privacy, and how it works (for the curious)</summary>

- Your favourites stay on your computer (in the `data` folder, or in your browser for the online
  version). Your music keys stay in a private folder on your computer (`~/.config/carte/`); the
  page can never read them back, and Carte only listens to your own computer.
- Radio stations come from [Radio Browser](https://www.radio-browser.info), TV channels from
  [Famelack](https://famelack.com), country facts from
  [mledoze/countries](https://github.com/mledoze/countries) and Wikidata, the map from
  [Natural Earth](https://www.naturalearthdata.com).
- `server.py` is a small Python server (standard library only). Without it, the `web/` folder works
  on its own as a static site: this is what the online version is (published by
  `.github/workflows/pages.yml`).

</details>
