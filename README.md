# Media Toolkit (personal use)

Desktop or browser app (Electron + React) with four tools:
- **YouTube → MP3**: converts a video's audio to MP3 using **yt-dlp** and **ffmpeg**
- **Optimize Video**: shrinks, resizes, trims and converts your own videos using **ffmpeg**
- **Split Video**: cuts a long video into equal parts (e.g. every 20 seconds); download each part or all as a ZIP
- **Optimize Images**: compresses, resizes and converts images (JPEG, PNG, WebP) in batches, right in the app (no ffmpeg needed)

## Requirements
- Node.js 18+
- yt-dlp: `pip install -U yt-dlp` (or `brew install yt-dlp` / `winget install yt-dlp`)
- ffmpeg: `brew install ffmpeg` / `winget install ffmpeg` / `sudo apt install ffmpeg`

## Run as a desktop app
```bash
npm install
npm start
```

## Run in your browser (no desktop window)
```bash
npm run web
```
Then open http://localhost:4000. Stop it with Ctrl+C.

## Build an installer (double-click app)
```bash
npm run dist
```
Output goes to `release/`: a `.dmg` on macOS, a `.exe` installer on Windows, an `.AppImage` on Linux.
Build on the same OS you want the app for.

## Browser dev mode (hot reload while editing the UI)
```bash
npm run dev
```
Then open http://localhost:5173.

## Project layout
- `electron/main.js`: opens the app window and starts the backend inside it
- `server/index.js`: yt-dlp to ffmpeg to MP3 backend
- `server/jobs.js`: shared upload, progress, download and ZIP handling
- `server/optimize.js`: video optimizer
- `server/split.js`: video splitter
- `client/src/App.jsx`: tabs; `Mp3Tab.jsx`, `OptimizeTab.jsx`, `SplitTab.jsx` and `ImageTab.jsx` hold each tool
- `client/src/zip.js`: builds the image ZIP in the browser

## Optimizer presets
| Preset | What it does |
|---|---|
| Small file | 720p, strong compression |
| Balanced | 1080p, good quality/size trade-off |
| High quality | Original resolution, light compression |
| Discord (≤10 MB) | 720p, aims for a 9.5 MB file |

Videos are never upscaled. Temp files go to your system temp folder and are deleted 1 hour after each job finishes.

## Image optimizer presets
| Preset | What it does |
|---|---|
| Web (WebP) | WebP, max 1920 px, quality 80 |
| Email (JPEG) | JPEG, max 1280 px, quality 75 |
| Thumbnail | WebP, max 640 px, quality 75 |
| Light touch | Same format and size, quality 85 |

Images are processed in the app itself and never uploaded. Photos are rotated upright and EXIF data (including location) is removed. If a re-saved image comes out no smaller than the original (same format and size), the original is kept.

## Splitter modes
- **Exact**: every part is exactly the length you choose (the last part holds whatever is left). Re-encodes, so it takes a while on long videos.
- **Fast**: no re-encoding, so it finishes in seconds even for hour-long videos. Cuts land on the nearest keyframe, so parts can be a second or two longer or shorter.

## Troubleshooting
- Downloads suddenly fail: YouTube changed something, so run `yt-dlp -U`.
- "not installed or not on PATH": check that `yt-dlp --version` and `ffmpeg -version` work in your terminal.
- Optimizing is slow: H.265 and WebM are much slower than H.264, so use H.264 for speed.
- macOS says the app is from an unidentified developer: right-click the app, then choose Open.
