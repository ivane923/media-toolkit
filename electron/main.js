import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Apps opened from Finder/Start menu don't get your terminal's PATH,
// so add the usual places yt-dlp and ffmpeg get installed.
const extraPaths =
  process.platform === "win32"
    ? [path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links")]
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(process.env.HOME || "", ".local", "bin")];
process.env.PATH = [process.env.PATH, ...extraPaths].join(path.delimiter);

let port;

async function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    title: "Media Toolkit",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Save files with a "Save as" dialog that starts in Downloads
  win.webContents.session.on("will-download", (_e, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    const label = { mp3: "MP3 audio", mp4: "MP4 video", webm: "WebM video", mov: "QuickTime video", mkv: "MKV video", zip: "ZIP archive", jpg: "JPEG image", jpeg: "JPEG image", png: "PNG image", webp: "WebP image" }[ext];
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: label ? [{ name: label, extensions: [ext] }] : [],
    });
  });

  // Links to other sites open in your normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  port = await startServer({ port: 0, staticDir: path.join(__dirname, "..", "client", "dist") });
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
