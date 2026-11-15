// Shared plumbing for upload → ffmpeg → download jobs (used by the optimizer and the splitter).
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import archiver from "archiver";

// Temp folder for uploads and results. Cleared on start; each job is deleted 1 hour after it finishes.
const WORK_DIR = path.join(os.tmpdir(), "yt-mp3-jobs");
fs.rmSync(WORK_DIR, { recursive: true, force: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

const jobs = new Map();
const KEEP_MS = 60 * 60 * 1000;

export const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim();

// "90", "1:30", "01:02:03" -> seconds. Empty -> null, invalid -> NaN.
export function parseTime(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const parts = String(v).trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function probe(file) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "format=duration:stream=width,height",
      "-of", "json", file,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve({
          duration: Number(j.format?.duration) || 0,
          width: j.streams?.[0]?.width,
          height: j.streams?.[0]?.height,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

function publicJob(j) {
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    error: j.error,
    inputName: j.inputName,
    inputSize: j.inputSize,
    duration: j.duration,
    width: j.width,
    height: j.height,
    files: j.status === "done" ? j.files.map(({ name, size, duration }) => ({ name, size, duration })) : [],
  };
}

function cleanup(id) {
  const j = jobs.get(id);
  if (!j) return;
  j.proc?.kill("SIGKILL");
  clearTimeout(j.timer);
  fs.rm(j.dir, { recursive: true, force: true }, () => {});
  jobs.delete(id);
}

// Saves the uploaded body to disk and probes it. Returns the job, or sends an error and returns null.
export async function receiveUpload(req, res, kind) {
  const id = randomUUID();
  const dir = path.join(WORK_DIR, id);
  fs.mkdirSync(dir);
  const inputName = safeName(decodeURIComponent(String(req.get("x-filename") || "video"))) || "video";
  const ext = path.extname(inputName).toLowerCase() || ".mp4";
  const job = {
    id, kind, dir, inputName, ext,
    baseName: path.basename(inputName, path.extname(inputName)) || "video",
    input: path.join(dir, `input${ext}`),
    status: "uploading", progress: 0, files: [],
  };
  jobs.set(id, job);

  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(job.input);
      req.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
      req.on("aborted", () => reject(new Error("Upload cancelled.")));
    });
  } catch (e) {
    cleanup(id);
    res.status(400).json({ error: e.message });
    return null;
  }
  job.inputSize = fs.statSync(job.input).size;

  const info = await probe(job.input);
  if (!info || !info.width) {
    cleanup(id);
    res.status(400).json({ error: "That file doesn't look like a video (or ffprobe isn't installed)." });
    return null;
  }
  Object.assign(job, info);
  return job;
}

export function failJob(job, res, message) {
  cleanup(job.id);
  res.status(400).json({ error: message });
}

// Runs ffmpeg for a job and tracks progress. `collect` returns the output files when it succeeds.
export function runJob(job, res, args, outDuration, collect) {
  job.status = "processing";
  const proc = spawn("ffmpeg", ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", ...args]);
  job.proc = proc;
  let errLog = "";
  proc.stdout.on("data", (d) => {
    const all = [...d.toString().matchAll(/out_time_us=(\d+)/g)];
    if (all.length && outDuration > 0) {
      job.progress = Math.min(0.99, Number(all[all.length - 1][1]) / 1e6 / outDuration);
    }
  });
  proc.stderr.on("data", (d) => (errLog = (errLog + d).slice(-4000)));
  proc.on("error", () => {
    job.status = "error";
    job.error = "ffmpeg is not installed or not on PATH.";
  });
  proc.on("close", async (code) => {
    job.proc = null;
    if (job.status === "cancelled") return;
    if (code === 0) {
      try {
        job.files = await collect();
        job.status = "done";
        job.progress = 1;
      } catch (e) {
        job.status = "error";
        job.error = e.message;
      }
    } else {
      console.error(`[${job.kind}]`, errLog);
      job.status = "error";
      job.error = job.error || "Processing failed. Check the terminal for ffmpeg's error message.";
    }
    fs.rm(job.input, { force: true }, () => {});
    job.timer = setTimeout(() => cleanup(job.id), KEEP_MS);
  });
  res.json(publicJob(job));
}

export function registerJobRoutes(app) {
  app.get("/api/jobs/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found (it may have expired)." });
    res.json(publicJob(j));
  });

  // One output file by position (0 = first)
  app.get("/api/jobs/:id/files/:n", (req, res) => {
    const j = jobs.get(req.params.id);
    const f = j?.status === "done" && j.files[Number(req.params.n)];
    if (!f) return res.status(404).json({ error: "File not found (it may have expired)." });
    res.download(f.path, f.name);
  });

  // Every output file in one ZIP. Videos are already compressed, so files are stored as-is (fast).
  app.get("/api/jobs/:id/zip", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j || j.status !== "done") return res.status(404).json({ error: "Files not ready." });
    const zipName = `${j.baseName}-${j.kind === "split" ? "segments" : "files"}.zip`;
    res.attachment(zipName);
    const zip = archiver("zip", { store: true });
    zip.on("error", (e) => { console.error(e); res.destroy(e); });
    zip.pipe(res);
    for (const f of j.files) zip.file(f.path, { name: f.name });
    zip.finalize();
  });

  app.delete("/api/jobs/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (j) {
      j.status = "cancelled";
      cleanup(req.params.id);
    }
    res.json({ ok: true });
  });
}
