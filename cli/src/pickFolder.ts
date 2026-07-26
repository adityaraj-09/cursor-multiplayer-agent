import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";

const execFileAsync = promisify(execFile);

/**
 * Open a native OS folder picker and return an absolute path.
 * Returns null if the user cancels.
 */
export async function pickFolder(): Promise<string | null> {
  const os = platform();

  try {
    if (os === "darwin") {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Select a repository folder")',
      ]);
      const path = stdout.trim().replace(/\/$/, "");
      return path || null;
    }

    if (os === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        '$d.Description = "Select a repository folder"',
        "$d.ShowNewFolderButton = $true",
        "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
      ].join("; ");
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        script,
      ]);
      const path = stdout.trim();
      return path || null;
    }

    // Linux: prefer zenity, then kdialog
    try {
      const { stdout } = await execFileAsync("zenity", [
        "--file-selection",
        "--directory",
        "--title=Select a repository folder",
      ]);
      const path = stdout.trim();
      return path || null;
    } catch {
      const { stdout } = await execFileAsync("kdialog", [
        "--getexistingdirectory",
        process.env.HOME || "/",
        "--title",
        "Select a repository folder",
      ]);
      const path = stdout.trim();
      return path || null;
    }
  } catch (err) {
    const e = err as { code?: number | string; message?: string };
    // User cancel: osascript exit 1 / zenity exit 1
    if (e.code === 1 || e.code === "1") return null;
    throw new Error(
      e.message ||
        "Failed to open folder picker. On Linux install zenity or kdialog.",
    );
  }
}
