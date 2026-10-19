# Intent: YouTube Downloader Chrome Extension
Author: Tuaha. Status: approved (2026-10-20).

## Problem
I want to save YouTube videos (or just their audio) to my computer straight from Chrome. Right now that means copying the link into a website full of ads or running yt-dlp in a terminal. Web-only downloaders break often and usually stop at low quality. I want a one-click way to do it from the video page.

## Proposed outcome
A Chrome extension that does this on any YouTube video page (watch, Shorts, youtu.be links):
- One click opens a popup with the video's title, thumbnail and length.
- I pick **Video (MP4)** with a quality (360p, 480p, 720p, 1080p, plus higher when available) or **Audio (MP3 / M4A)**.
- The file downloads to a folder I choose, with a progress bar, and I can cancel it.
- It keeps working when YouTube changes things, because the real work is done by **yt-dlp** (which gets updated often) running through a small local helper app.

Success means:
- A 10-minute 1080p video downloads as one playable MP4 with sound.
- Audio downloads as a valid MP3 or M4A.
- A new user can set it up from the GitHub README in under 10 minutes.

## Affected users and systems
- **Users:** me first. Then anyone who installs it from the public GitHub repo (load unpacked).
- **Systems:** Chrome (Manifest V3), YouTube pages, a local helper app (Node.js) connected through Chrome Native Messaging, and yt-dlp + ffmpeg installed on the user's machine.

## Constraints
- **Distribution:** GitHub only, installed with "Load unpacked". It is **not** going on the Chrome Web Store, because its policy bans YouTube downloaders.
- **Legal:** for personal use, and for content the user owns or is allowed to download (for example their own uploads or Creative Commons videos). The README must say this. No DRM circumvention, and no paid, private or members-only content.
- **Stack:** TypeScript + Vite for the extension; TypeScript on Node.js 20+ for the helper.
- **Platform:** Windows first, since that's what I use. Keep the code cross-platform so macOS and Linux can follow.
- **Security:** the helper only accepts messages from this extension, only accepts YouTube URLs, and never runs commands through a shell.
- **Budget/timeline:** a hobby project. No servers, no accounts, no analytics.

## Decisions (2026-10-20)
1. The user installs yt-dlp and ffmpeg (for example with `winget`). The setup script only checks for them and prints the exact commands.
2. v1 has the toolbar popup only. The in-page "Download" button comes in v1.1.
3. Playlists, subtitles and thumbnails move to v2.
4. The host code is cross-platform. macOS and Linux setup scripts come in v1.1.
