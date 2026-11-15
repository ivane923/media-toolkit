import express from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { registerOptimizer } from "./optimize.js";
import { registerSplitter } from "./split.js";
import { registerJobRoutes } from "./jobs.js";

const app = express();
registerOptimizer(app);
registerSplitter(app);
registerJobRoutes(app);
const YT_URL = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//;

function validUrl(req, res) {
  const url = String(req.query.url || "").trim();
  if (!YT_URL.test(url)) {
    res.status(400).json({ error: "Please paste a valid YouTube link." });
    return null;
  }
  return url;
}

const safeName = (s) =>
  (s || "audio").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 150) || "audio";

// Video details (title, thumbnail, length) for the preview card
app.get("/api/info", (req, res) => {
  const url = validUrl(req, res);
  if (!url) return;

  const proc = spawn("yt-dlp", ["--dump-json", "--no-playlist", "--no-warnings", url]);
  let out = "", err = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (err += d));
  proc.on("error", () => res.status(500).json({ error: "yt-dlp is not installed or not on PATH." }));
  proc.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0) {
      console.error(err);
      return res.status(500).json({ error: "Couldn't read that video. Try `yt-dlp -U` to update yt-dlp." });
    }
    const info = JSON.parse(out);
    res.json({
      title: info.title,
      uploader: info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
    });
  });
});

// Streams the MP3: yt-dlp (best audio) -> ffmpeg (mp3) -> browser
app.get("/api/convert", (req, res) => {
  const url = validUrl(req, res);
  if (!url) return;
  const bitrate = ["128", "192", "256", "320"].includes(req.query.bitrate) ? req.query.bitrate : "192";
  const name = safeName(req.query.title);

  const ytdlp = spawn("yt-dlp", ["-f", "bestaudio", "--no-playlist", "--no-warnings", "-o", "-", url]);
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0", "-vn", "-codec:a", "libmp3lame", "-b:a", `${bitrate}k`,
    "-f", "mp3", "pipe:1",
  ]);

  const fail = (msg) => {
    console.error(msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
    else res.end();
    ytdlp.kill(); ffmpeg.kill();
  };
  ytdlp.on("error", () => fail("yt-dlp is not installed or not on PATH."));
  ffmpeg.on("error", () => fail("ffmpeg is not installed or not on PATH."));
  ytdlp.stderr.on("data", (d) => console.error("[yt-dlp]", d.toString().trim()));
  ffmpeg.stderr.on("data", (d) => console.error("[ffmpeg]", d.toString().trim()));
  ytdlp.stdout.on("error", () => {});
  ffmpeg.stdin.on("error", () => {});

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ffmpeg.stdout.once("data", () => {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audio.mp3"; filename*=UTF-8''${encodeURIComponent(name)}.mp3`
    );
  });
  ffmpeg.stdout.pipe(res);

  ytdlp.on("close", (code) => {
    if (code !== 0 && !res.headersSent) fail("Download failed. Try `yt-dlp -U` to update yt-dlp.");
  });

  // Stop work if the user cancels the download
  res.on("close", () => { ytdlp.kill(); ffmpeg.kill(); });
});

// Starts the API (and, when staticDir is given, serves the built React app).
// Resolves with the port it's listening on. Port 0 picks a free port.
export function startServer({ port = 4000, staticDir } = {}) {
  if (staticDir) {
    app.use(express.static(staticDir));
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server.address().port));
    server.on("error", reject);
  });
}

// Running `node server/index.js` directly.
// With --web it also serves the built app, so everything is on one address.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = process.argv.includes("--web");
  const staticDir = web ? fileURLToPath(new URL("../client/dist", import.meta.url)) : undefined;
  startServer({ port: Number(process.env.PORT) || 4000, staticDir }).then((p) =>
    console.log(web ? `Open http://localhost:${p} in your browser` : `API running on http://localhost:${p}`)
  );
}
