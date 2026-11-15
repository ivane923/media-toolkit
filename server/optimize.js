import fs from "fs";
import path from "path";
import { parseTime, receiveUpload, failJob, runJob } from "./jobs.js";

// Quality presets as CRF values (lower = better quality, bigger file)
const CRF = {
  h264: { small: 30, balanced: 26, high: 21 },
  h265: { small: 33, balanced: 29, high: 25 },
  vp9: { small: 40, balanced: 34, high: 28 },
};

function readOptions(q) {
  const height = [2160, 1440, 1080, 720, 480, 360].includes(Number(q.height)) ? Number(q.height) : null;
  const fps = [24, 30, 60].includes(Number(q.fps)) ? Number(q.fps) : null;
  const start = parseTime(q.start);
  const end = parseTime(q.end);
  const targetMB = Number(q.targetMB);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Trim times must look like 90, 1:30 or 1:02:03.");
  if (end !== null && end <= (start || 0)) throw new Error("Trim end must be after trim start.");
  const mode = q.mode === "target" ? "target" : "quality";
  if (mode === "target" && !(targetMB > 0 && targetMB <= 10000)) throw new Error("Target size must be a number of MB.");
  return {
    mode,
    quality: ["small", "balanced", "high"].includes(q.quality) ? q.quality : "balanced",
    targetMB,
    format: q.format === "webm" ? "webm" : "mp4",
    codec: q.codec === "h265" ? "h265" : "h264",
    height,
    fps,
    removeAudio: q.removeAudio === "1",
    start,
    end,
  };
}

function buildArgs(input, output, o, duration) {
  const args = [];
  if (o.start) args.push("-ss", String(o.start));
  args.push("-i", input);
  if (o.end) args.push("-t", String(o.end - (o.start || 0)));

  const webm = o.format === "webm";
  const codec = webm ? "vp9" : o.codec === "h265" ? "h265" : "h264";
  const audioKbps = 128;

  if (codec === "h264") args.push("-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p");
  if (codec === "h265") args.push("-c:v", "libx265", "-preset", "medium", "-tag:v", "hvc1", "-pix_fmt", "yuv420p");
  if (codec === "vp9") args.push("-c:v", "libvpx-vp9", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2");

  if (o.mode === "target" && duration > 0) {
    // Aim for a file size: pick a bitrate that fits, with a 7% safety margin
    const totalKbps = (o.targetMB * 8 * 1024) / duration;
    const videoKbps = Math.max(100, Math.floor(totalKbps * 0.93 - (o.removeAudio ? 0 : audioKbps)));
    args.push("-b:v", `${videoKbps}k`, "-maxrate", `${Math.floor(videoKbps * 1.2)}k`, "-bufsize", `${videoKbps * 2}k`);
  } else {
    args.push("-crf", String(CRF[codec][o.quality] ?? CRF[codec].balanced));
    if (codec === "vp9") args.push("-b:v", "0");
  }

  const filters = [];
  if (o.height) filters.push(`scale=-2:'min(${o.height},ih)'`); // never upscale
  if (o.fps) filters.push(`fps='min(${o.fps},source_fps)'`);
  if (filters.length) args.push("-vf", filters.join(","));

  if (o.removeAudio) args.push("-an");
  else if (webm) args.push("-c:a", "libopus", "-b:a", `${audioKbps}k`);
  else args.push("-c:a", "aac", "-b:a", `${audioKbps}k`);

  if (!webm) args.push("-movflags", "+faststart");
  args.push(output);
  return args;
}

export function registerOptimizer(app) {
  // Upload the raw file body (no form encoding), options in the query string
  app.post("/api/optimize", async (req, res) => {
    let opts;
    try {
      opts = readOptions(req.query);
    } catch (e) {
      req.resume();
      return res.status(400).json({ error: e.message });
    }

    const job = await receiveUpload(req, res, "optimize");
    if (!job) return;

    const start = opts.start || 0;
    const end = opts.end ? Math.min(opts.end, job.duration) : job.duration;
    const outDuration = Math.max(0, end - start);
    if (outDuration <= 0) return failJob(job, res, "Trim start is past the end of the video.");

    const outExt = opts.format === "webm" ? ".webm" : ".mp4";
    const output = path.join(job.dir, `output${outExt}`);
    const name = `${job.baseName}-optimized${outExt}`;

    runJob(job, res, buildArgs(job.input, output, opts, outDuration), outDuration, async () => [
      { path: output, name, size: fs.statSync(output).size, duration: outDuration },
    ]);
  });
}
