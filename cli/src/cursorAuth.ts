import { spawn, execFile } from "child_process";
import { promisify } from "util";
import chalk from "chalk";
import ora from "ora";

const execFileAsync = promisify(execFile);

interface WhoamiResult {
  status?: string;
  isAuthenticated?: boolean;
  userInfo?: {
    email?: string;
    firstName?: string;
    lastName?: string;
  };
}

export async function getCursorAuth(): Promise<{
  authenticated: boolean;
  email?: string;
  error?: string;
}> {
  try {
    const { stdout } = await execFileAsync(
      "cursor",
      ["agent", "whoami", "--format", "json"],
      {
        timeout: 30_000,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    const data = JSON.parse(stdout.trim()) as WhoamiResult;
    if (data.isAuthenticated || data.status === "authenticated") {
      return {
        authenticated: true,
        email: data.userInfo?.email,
      };
    }
    return { authenticated: false };
  } catch (err) {
    const e = err as {
      code?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    // cursor sometimes prints JSON on stdout even with non-zero exit
    if (e.stdout) {
      try {
        const data = JSON.parse(String(e.stdout).trim()) as WhoamiResult;
        if (data.isAuthenticated || data.status === "authenticated") {
          return {
            authenticated: true,
            email: data.userInfo?.email,
          };
        }
        return { authenticated: false };
      } catch {
        // fall through
      }
    }
    if (e.code === "ENOENT") {
      return {
        authenticated: false,
        error:
          "`cursor` CLI not found. Install Cursor CLI first: https://cursor.com",
      };
    }
    return {
      authenticated: false,
      error: e.stderr?.trim() || e.message || "Failed to check Cursor auth",
    };
  }
}

function runCursorLogin(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("cursor", ["agent", "login"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (err) => {
      console.error(chalk.red(`Failed to start cursor login: ${err.message}`));
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Ensure the Cursor CLI is logged in before starting the worker.
 * Prompts interactive `cursor agent login` if not authenticated.
 */
export async function ensureCursorAuth(): Promise<void> {
  const spinner = ora("Checking Cursor CLI login…").start();
  let auth = await getCursorAuth();

  if (auth.error && auth.error.includes("not found")) {
    spinner.fail(auth.error);
    process.exit(1);
  }

  if (auth.authenticated) {
    spinner.succeed(
      `Cursor CLI logged in as ${chalk.cyan(auth.email || "unknown")}`,
    );
    return;
  }

  spinner.warn("Cursor CLI is not logged in");
  console.log(
    chalk.yellow(
      "\n  Local agents need Cursor CLI auth. Opening login…\n",
    ),
  );

  const code = await runCursorLogin();
  if (code !== 0) {
    console.error(
      chalk.red(
        "\nCursor login failed or was cancelled. Run `cursor agent login` and try again.",
      ),
    );
    process.exit(1);
  }

  const verify = ora("Verifying Cursor login…").start();
  auth = await getCursorAuth();
  if (!auth.authenticated) {
    verify.fail(
      "Still not logged into Cursor. Run `cursor agent login` and try again.",
    );
    process.exit(1);
  }
  verify.succeed(
    `Cursor CLI logged in as ${chalk.cyan(auth.email || "unknown")}`,
  );
}
