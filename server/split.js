import fs from "fs";
import path from "path";
import { parseTime, probe, receiveUpload, failJob, runJob } from "./jobs.js";

const MAX_SEGMENTS = 500;

// Containers that can hold whatever codecs came in, for "fast" mode (no re-encoding)
const COPY_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".ts", ".mts"]);

export function registerSplitter(app) {
  app.post("/api/split", async (req, res) => {
    const seconds = parseTime(req.query.every);
    const mode = req.query.mode === "fast" ? "fast" : "exact";
    if (!(seconds >= 1)) {
      req.resume();
      return res.status(400).json({ error: "Segment length must be at least 1 second (e.g. 20 or 1:30)." });
    }

    const job = await receiveUpload(req, res, "split");
    if (!job) return;

    const count = Math.ceil(job.duration / seconds);
    if (count > MAX_SEGMENTS) {
      return failJob(job, res, `That would make ${count} segments (max ${MAX_SEGMENTS}). Use a longer segment length.`);
    }

    const outExt = mode === "fast" ? (COPY_EXTS.has(job.ext) ? job.ext : ".mkv") : ".mp4";
    const outDir = path.join(job.dir, "segments");
    fs.mkdirSync(outDir);
    const pattern = path.join(outDir, `part%03d${outExt}`);

    const args = ["-i", job.input, "-map", "0:v:0", "-map", "0:a?"];
    if (mode === "exact") {
      // Re-encode with a keyframe exactly at every cut, so each part is exactly the chosen length
      args.push(
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-force_key_frames", `expr:gte(t,n_forced*${seconds})`,
        "-c:a", "aac", "-b:a", "160k",
        "-segment_format_options", "movflags=+faststart",
        // Forced keyframes can land a hair before the mark due to rounding; accept them
        "-segment_time_delta", "0.05",
      );
    } else {
      // Copy as-is: very fast, but cuts land on the nearest keyframe, so lengths vary a little
      args.push("-c", "copy");
    }
    args.push("-f", "segment", "-segment_time", String(seconds), "-reset_timestamps", "1", pattern);

    runJob(job, res, args, job.duration, async () => {
      const names = fs.readdirSync(outDir).filter((f) => f.startsWith("part")).sort();
      if (!names.length) throw new Error("No segments were created.");
      const digits = Math.max(2, String(names.length).length);
      return Promise.all(
        names.map(async (f, i) => {
          const p = path.join(outDir, f);
          const info = await probe(p);
          return {
            path: p,
            name: `${job.baseName}-part${String(i + 1).padStart(digits, "0")}${outExt}`,
            size: fs.statSync(p).size,
            duration: info?.duration || 0,
          };
        })
      );
    });
  });
}
