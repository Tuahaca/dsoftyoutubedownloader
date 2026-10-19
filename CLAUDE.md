# Dynamicsoft Youtube downloader (Chrome extension)

Before any feature work, read `intent.md` (why) and `spec.md` (what). If they conflict with this file, ask the user. Don't guess.

## Commands
- Install: `npm install` (npm workspaces, run from the repo root)
- Build: `npm run build` (all packages → `packages/extension/dist`, `packages/host/dist`)
- Dev: `npm run dev` (Vite watch for the extension; reload it in `chrome://extensions` after a change)
- Test: `npm test` (Vitest unit tests, no network), `npm run test:integration` (real yt-dlp; needs `YTDL_TEST_URL` set to a Creative Commons video)
- Lint / types: `npm run lint`, `npm run typecheck`. Both must pass before you call a task done.
- Register the native host (Windows): `npm run host:install`. Remove it with `npm run host:uninstall`.
- Run: Chrome → `chrome://extensions` → Developer mode → Load unpacked → `packages/extension/dist`

## Conventions
- TypeScript `strict`, ES2022 modules, Node 20+ for the host. Never use `any`. Use `unknown` and narrow it.
- **All message shapes live in `packages/shared/src/protocol.ts`**. Never redefine a message type somewhere else. Validate anything coming from outside (native port, storage, yt-dlp output) with type guards in `shared/src/guards.ts`.
- File names are kebab-case (`job-runner.ts`). Types/interfaces are PascalCase, constants are UPPER_SNAKE.
- Chrome APIs: use the promise forms (`await chrome.storage.local.get`). Don't use callbacks.
- Styling: plain CSS with custom properties in `popup.css`. No UI framework in v1.
- Each pure function (URL parsing, arg building, progress parsing, error mapping) gets a unit test next to it as `*.test.ts`.
- Commits use the Conventional Commits format (`feat:`, `fix:`, `chore:`).

## Architecture
- `packages/extension/` holds the MV3 extension.
  - `src/background/` is the service worker. It is the **only** place that calls `connectNative`, and it owns the job table and badge.
  - `src/popup/` and `src/options/` are UI only. They talk to the worker through `chrome.runtime.sendMessage` and read jobs from `chrome.storage.session`.
  - `public/manifest.json` contains the pinned `key` (this fixes the extension ID). Never remove or regenerate it.
- `packages/host/` is the Native Messaging host (Node).
  - `src/stdio.ts` handles 4-byte native-endian length-prefixed framing. `src/ytdlp.ts` builds args and parses progress and errors (pure). `src/process.ts` spawns and kills process trees. `src/validate.ts` holds the URL/ID allow-list. `src/jobs.ts` handles the queue, concurrency and cancel. `src/main.ts` dispatches messages.
  - `install/install.mjs` generates `dist/host.bat`, `dist/com.tuaha.ytdl.json` and `dist/host-config.json` (the absolute yt-dlp/ffmpeg paths), then writes the HKCU registry key. Generated files live only in `dist/`.
  - Tests are `src/**/*.test.ts` with fake child processes and `src/__fixtures__/`. `test/*.integration.test.ts` uses real yt-dlp.
- `packages/shared/` contains the protocol types, guards and constants shared by both packages.
- External tools: `yt-dlp`, `ffmpeg` and `deno` (yt-dlp's JS runtime for YouTube). They are never bundled or committed. The host resolves each one from `host-config.json` first, then PATH.

## Things Claude gets wrong
- **Writing to stdout in the host.** Stdout is the protocol channel, so any `console.log` corrupts it. Use `log()` from `host/src/log.ts`, which writes to stderr and a log file.
- **Using `shell: true` or building a command string for yt-dlp.** Always use `spawn(bin, argsArray, { shell: false })`, and only build args with `buildArgs()` in `ytdlp.ts`.
- **Downloading in the extension.** The extension never fetches googlevideo URLs or uses `chrome.downloads`. The host and yt-dlp do all downloading.
- **Assuming the service worker stays alive.** Keep state in `chrome.storage.session`, not in module variables. Rebuild on startup.
- **Cancelling only the yt-dlp PID on Windows.** Kill the whole tree (`taskkill /PID <pid> /T /F`) so ffmpeg stops too.
- **Forwarding raw `yt-dlp -J` JSON.** It can exceed the 1 MB native message limit. Send only the trimmed `info` shape.
- **Adding permissions.** Don't add `<all_urls>`, `downloads`, `tabs` or `scripting` without updating spec.md and asking first.
- **Tests that hit YouTube.** Unit tests must use fixtures in `__fixtures__/`. Network tests belong only in `test:integration`.
- **Hardcoding the extension ID.** `install/lib.mjs` derives it from the manifest `key`. If the key changes, the ID changes and users must re-run `host:install`.
- **Passing the raw tab URL to yt-dlp.** Use `parseYouTubeVideoId()`, then `canonicalWatchUrl()`. Shared code stays free of DOM/Node APIs; it only uses the `URL` global.
- **Trusting PATH to find winget tools.** Chrome (and the host it launches) keeps the PATH it started with, and `chrome://restart` doesn't refresh it. `which()` also scans `%LOCALAPPDATA%\Microsoft\WinGet\Packages`, and `install.mjs` keeps the previous path instead of writing `null`.
- **Icons.** They come from `npm run icons` (`scripts/generate-icons.mjs`). Don't hand-edit the PNGs.
