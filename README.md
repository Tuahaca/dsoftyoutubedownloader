# Dynamicsoft Youtube downloader — Chrome Extension

Download YouTube videos as **MP4** (choose 360p–1080p, higher when available) or as audio (**MP3 / M4A**) straight from the Chrome toolbar.

The extension doesn't download anything itself. It hands each job to a small local helper app, and the helper runs [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/). When YouTube changes something, updating yt-dlp usually fixes it. The extension itself doesn't need an update.

> **Status:** v0.1.0 (v1 feature set). See [intent.md](intent.md) and [spec.md](spec.md).

---

## ⚠️ Disclaimer — read first

- This project is for **personal use only**. Only download content you **own** or have **permission** to download, such as your own uploads or videos under a Creative Commons license.
- Downloading most YouTube content breaks [YouTube's Terms of Service](https://www.youtube.com/t/terms). You are responsible for how you use this tool.
- It does **not** get around DRM. It does not support paid, private or members-only content.
- **It is not on the Chrome Web Store**, because store policy bans YouTube downloaders. You install it from this repo with "Load unpacked".

---

## Features (v1)

- Toolbar popup on any YouTube video page (`/watch`, `/shorts/`, `youtu.be`). It shows the title, channel, length and thumbnail.
- **Video:** a single MP4 file (H.264 + AAC when available) that plays almost anywhere.
- **Audio:** MP3 (best quality) or M4A (original AAC, no re-encoding).
- Live progress (percent, speed, ETA), a badge on the toolbar icon, and a cancel button.
- Downloads keep running after you close the popup. A desktop notification tells you when one finishes.
- Options: output folder, default quality and format, number of downloads at once.
- A list of your last 20 downloads with **Show in folder**.
- No tracking, accounts or servers. Everything runs on your computer.

## How it works

```
Popup ─► Service worker ─► Native helper (Node.js) ─► yt-dlp + ffmpeg ─► your folder
                   ◄── progress / done / error ──┘
```

The extension talks to the helper through Chrome's [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). The helper only accepts messages from this extension, only accepts YouTube URLs, and never runs commands through a shell.

---

## Installation (Windows)

> macOS and Linux setup scripts are planned. The helper code is already cross-platform.

### 1. Install the prerequisites

| Tool | Version | Install command |
|---|---|---|
| Google Chrome | 116+ | — |
| Node.js | 20.19+ | `winget install OpenJS.NodeJS.LTS` |
| yt-dlp | latest | `winget install yt-dlp.yt-dlp` |
| ffmpeg | any recent | Installed automatically with yt-dlp via winget. Otherwise: `winget install Gyan.FFmpeg` |
| Deno | any recent | Installed automatically with yt-dlp via winget. Otherwise: `winget install DenoLand.Deno` |

> yt-dlp needs a JavaScript runtime (Deno) to read YouTube's player. The winget `yt-dlp.yt-dlp` package installs ffmpeg and Deno as dependencies, so one command is usually enough.

Open a **new** terminal and check that they're on your PATH:

```bash
node --version
```

```bash
yt-dlp --version
```

```bash
ffmpeg -version
```

### 2. Clone and build

```bash
git clone https://github.com/Tuahaca/dsoftyoutubedownloader.git
```

```bash
cd dsoftyoutubedownloader
```

```bash
npm install
```

```bash
npm run build
```

### 3. Register the native helper

```bash
npm run host:install
```

This writes the helper manifest and registers it under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tuaha.ytdl`. It needs no admin rights. It also checks that yt-dlp and ffmpeg can be found.

### 4. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `packages/extension/dist`.
4. Pin the extension to the toolbar.

### 5. Use it

Open a YouTube video, click the extension icon, choose **Video** or **Audio** and the quality, then click **Download**. By default, files go to `Downloads\YouTube`. You can change this in the extension's **Options**.

---

## Updating

- **yt-dlp** (do this first if downloads start failing): `winget upgrade yt-dlp.yt-dlp`
- **Extension:** `git pull` → `npm install` → `npm run build` → click ⟳ on the extension in `chrome://extensions`

## Uninstalling

```bash
npm run host:uninstall
```

Then remove the extension in `chrome://extensions` and delete the folder.

---

## Troubleshooting

| Message / symptom | Fix |
|---|---|
| "Chrome can't find the helper app" | Run `npm run host:install`, then type `chrome://restart` in the address bar. Closing the windows isn't enough: Chrome keeps running in the background (system tray) and only sees a newly registered helper after a full restart. |
| "yt-dlp or ffmpeg is missing" | Install them (step 1), then run `npm run host:install` again. It also searches winget's install folders, so an old terminal is fine. No Chrome restart is needed; just reopen the popup. In PowerShell, use `npm.cmd run host:install` if scripts are blocked. |
| "Sign in to confirm you're not a bot" | YouTube is rate-limiting you. Wait and try again later. Signed-in (cookie) downloads aren't supported in v1. |
| Download stuck or fails on many videos | Update yt-dlp: `winget upgrade yt-dlp.yt-dlp` |
| Private / age-restricted / unavailable | These aren't supported. |
| Video has no sound | Make sure ffmpeg is installed. It merges the video and audio streams. |

Helper logs go to `%LOCALAPPDATA%\ytdl-host\host.log`.

---

## Development

| Task | Command |
|---|---|
| Watch build (extension) | `npm run dev` |
| Unit tests | `npm test` |
| Integration tests (real yt-dlp) | `npm run test:integration` (set `YTDL_TEST_URL` to a Creative Commons video) |
| Lint / type-check | `npm run lint` · `npm run typecheck` |

Project layout:

```
packages/
  extension/   MV3 extension (service worker, popup, options)
  host/        Native Messaging helper (Node.js + TypeScript)
  shared/      Protocol types shared by both
```

Read [CLAUDE.md](CLAUDE.md) for conventions and [spec.md](spec.md) for the message protocol before contributing.

## Roadmap

- v1.1: a "Download" button inside the YouTube page; macOS/Linux setup scripts
- v2: playlists, subtitles (.srt), thumbnails

## License

[MIT](LICENSE). yt-dlp (Unlicense) and ffmpeg (LGPL/GPL) are separate projects that you install yourself. They are not bundled with this repo.
