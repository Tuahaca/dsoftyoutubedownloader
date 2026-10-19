# Spec: YouTube Downloader Chrome Extension
Derived from: intent.md. Status: approved (2026-10-20). v1 implemented.

## Requirements

### Functional (v1)
| ID | Requirement |
|----|-------------|
| F1 | On a YouTube video tab (`youtube.com/watch?v=`, `/shorts/`, `youtu.be/`, `m.youtube.com`), the toolbar popup shows the video's title, channel, duration and thumbnail. |
| F2 | The user picks **Video (MP4)** at an available height (144p up to the max, e.g. 2160p), or **Audio** as MP3 (best VBR) or M4A (original AAC, no re-encode). |
| F3 | Video downloads are merged into a single MP4 with H.264/AAC when available, so they play in Windows Media Player and QuickTime without extra codecs. |
| F4 | A download shows live progress (percent, speed, ETA) in the popup and as a badge on the toolbar icon. It can be cancelled, and a cancel removes the partial files. |
| F5 | A download keeps running when the popup is closed. A desktop notification fires when it finishes or fails. |
| F6 | Options page: output folder (default `~/Downloads/YouTube`), default mode/quality/audio format, and how many downloads can run at once (1–3, default 2). |
| F7 | The popup lists the last 20 downloads, each with "Show in folder". |
| F8 | If the helper app or yt-dlp/ffmpeg is missing, the popup shows a clear setup message with a link to the README, not a raw error. |
| F9 | Errors from yt-dlp (private, age-restricted, unavailable, geo-blocked, network) are shown as friendly messages. |
| F10 | Popup on a page that isn't a YouTube video: "Open a YouTube video to download it." |

### Non-functional
- **N1 Security:** the helper accepts only well-formed messages; URLs must pass a YouTube allow-list regex; the video ID must match `^[A-Za-z0-9_-]{11}$`. yt-dlp is started with an argument array (`spawn`, `shell: false`). The output path must resolve inside the configured folder. The extension ID is pinned in the host's `allowed_origins`.
- **N2 Permissions:** the extension asks only for `nativeMessaging`, `storage`, `notifications`, `activeTab`, and host permission `*://*.youtube.com/*` plus `*://youtu.be/*`. No `<all_urls>`, no `downloads` (the helper writes the files).
- **N3 Performance:** the popup shows video info in under 3 s on broadband (one `yt-dlp -J` call, cached per video ID for 10 min).
- **N4 Reliability:** YouTube-side breakage is fixed by updating yt-dlp, with no change to the extension. The options page shows the installed yt-dlp version and how to update it.
- **N5 Privacy:** no telemetry, no remote servers, nothing leaves the machine except yt-dlp's own requests to YouTube.

### Out of scope (v1)
Playlists, subtitles, thumbnails as files, cookies/sign-in, live streams, Chrome Web Store, Firefox.

## Design

```
YouTube tab ──activeTab URL──► Popup (TS) ◄──runtime messages──► Service worker (TS)
                                                                    │ chrome.runtime.connectNative
                                                                    ▼  (length-prefixed JSON over stdio)
                                                          Native host (Node 20, TS)
                                                                    │ spawn(argv[], shell:false)
                                                                    ▼
                                                           yt-dlp  +  ffmpeg  ──► output folder
```

- **Popup**: only UI. It reads the active tab URL, asks the service worker for `probe`, renders the format picker, and sends `download`/`cancel`. It subscribes to job updates through `chrome.storage.session` change events.
- **Service worker**: owns the single native port and the job table. It is the only component that talks to the host. It updates the badge and sends notifications. An open native port keeps the MV3 worker alive while downloads run. When the port drops, active jobs are marked `failed: host disconnected`.
- **Native host**: a stateless request/response layer plus a job runner. It validates every message, builds yt-dlp args, and parses `--progress-template` lines into `progress` messages. It enforces the concurrency limit and kills the process tree on cancel.
- **Format selection** (built only in the host):
  - Video: `-S "res:<H>,vcodec:h264,acodec:aac,ext:mp4:m4a" -f "bv*+ba/b" --merge-output-format mp4`
  - MP3: `-f ba -x --audio-format mp3 --audio-quality 0`
  - M4A: `-f "ba[ext=m4a]/ba" -x --audio-format m4a`
  - Always: `--no-playlist --newline --no-colors --restrict-filenames -o "<dir>/%(title).150B [%(id)s].%(ext)s"`
- **Install**: `npm run host:install` builds the host and writes the host manifest (`com.tuaha.ytdl.json`) next to `host.bat`. It registers it under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tuaha.ytdl` (no admin needed) and checks that `yt-dlp` and `ffmpeg` are on PATH.

## Interface

**Native messaging protocol** (`packages/shared/src/protocol.ts`, the single source of truth). Every request has `id` (a UUID). Every response echoes it.

| Ext → Host | Host → Ext |
|---|---|
| `{type:"hello"}` | `{type:"hello", hostVersion, ytDlpVersion\|null, ffmpeg:boolean, defaultOutputDir}` |
| `{type:"probe", url}` | `{type:"info", videoId, title, channel, durationSec, thumbnailUrl, heights:number[]}` |
| `{type:"download", url, mode:"video"\|"audio", height?, audioFormat?, outputDir?, maxConcurrent?}` (the request `id` is the job id) | `{type:"progress", percent, speed?, etaSec?, stage:"downloading"\|"merging"\|"converting"}` then `{type:"done", filePath}` |
| `{type:"cancel", jobId}` | `{type:"cancelled"}` with `id = jobId` |
| `{type:"reveal", filePath}` (for "Show in folder", F7) | `{type:"revealed"}` |
| — | `{type:"error", code, message}`. Codes: `INVALID_URL`, `INVALID_REQUEST`, `UNAVAILABLE`, `AGE_RESTRICTED`, `PRIVATE`, `GEO_BLOCKED`, `BOT_CHECK`, `LIVE_NOT_SUPPORTED`, `NETWORK`, `DEPENDENCY_MISSING`, `CANCELLED`, `UNKNOWN`. The extension adds `HOST_MISSING`, `HOST_FORBIDDEN` and `HOST_DISCONNECTED` for port failures. |

The host never passes the user's URL to yt-dlp. It rebuilds `https://www.youtube.com/watch?v=<id>` from the validated ID, and always puts it after `--`.

**UI surfaces:** toolbar popup (380×520), options page, badge (active-job count or `!`), and notifications.

## Data model
- `chrome.storage.local.settings`: `{ outputDir: string, defaultMode, defaultHeight: number, audioFormat: "mp3"|"m4a", maxConcurrent: 1|2|3 }`
- `chrome.storage.local.history`: `HistoryItem[]` (max 20): `{ jobId, videoId, title, mode, filePath, finishedAt, status }`
- `chrome.storage.session.jobs`: `Record<jobId, Job>`: `{ jobId, videoId, title, mode, status:"queued"|"running"|"done"|"failed"|"cancelled", percent, speed?, etaSec?, error? }`
- The host keeps no data on disk. It has an in-memory job map and a probe cache.

## Areas of concern
1. **Policy/legal:** this goes against YouTube's ToS for most content and can never go on the Chrome Web Store. Mitigation: a clear README disclaimer, GitHub-only distribution, and no circumvention beyond what yt-dlp does.
2. **Stable extension ID:** Native Messaging needs the ID in `allowed_origins`, but unpacked IDs depend on the folder path. **Decision:** commit a public `key` in `manifest.json` so every install gets the same ID. (The private key is not needed for unpacked loading. Don't commit it.)
3. **Bot checks:** YouTube sometimes demands sign-in ("confirm you're not a bot"). `--cookies-from-browser chrome` is unreliable on Windows because of Chrome's app-bound cookie encryption. v1 shows a friendly error. Cookie support is deferred.
4. **Extra setup step:** users must install Node 20, yt-dlp and ffmpeg. This is the biggest adoption risk. See Q1.
5. **Native messaging limits:** host→extension messages are capped at 1 MB. Progress is throttled to ≤ 4 msgs/s per job, and full `-J` JSON is never forwarded, only the trimmed `info` shape.
6. **Windows process kill:** cancelling must end the whole yt-dlp → ffmpeg process tree (`taskkill /T /F`), otherwise ffmpeg keeps running and the files stay locked.

## Decisions (approved 2026-10-20)
1. The user installs yt-dlp, ffmpeg and Deno. `winget install yt-dlp.yt-dlp` pulls in the other two. `host:install` checks for all three and records their absolute paths in `host-config.json`. The host passes `--ffmpeg-location` and `--js-runtimes deno:<path>` so nothing depends on Chrome's PATH. (Found during the first real run, 2026-10-20: current yt-dlp needs Deno for YouTube's player challenges.)
2. The in-page "Download" button comes in v1.1. v1 has the popup only.
3. Playlists, subtitles and thumbnails move to v2.
4. The host code is cross-platform. macOS and Linux install scripts come in v1.1.
