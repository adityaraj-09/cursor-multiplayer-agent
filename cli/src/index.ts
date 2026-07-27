#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createInterface } from "readline";
import { loginWithPairingCode, logout } from "./auth.js";
import { DEFAULT_SERVER_URL, loadConfig } from "./config.js";
import { ensureCursorAuth } from "./cursorAuth.js";
import { startWorker } from "./worker.js";

const program = new Command();

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

program
  .name("steer")
  .description("CLI worker for Steer — run local Cursor agents")
  .version("0.1.1");

program
  .command("login")
  .description("Pair CLI with your Steer account (Clerk via web pairing code)")
  .action(async () => {
    try {
      console.log(
        chalk.gray(
          "\n  1. Sign in on the web app\n  2. Open /cli-pair and generate a code\n  3. Enter that code below\n",
        ),
      );
      const serverUrlRaw = await prompt(
        `Server URL [${DEFAULT_SERVER_URL}]: `,
      );
      const serverUrl = serverUrlRaw || DEFAULT_SERVER_URL;
      const code = await prompt("Pairing code: ");

      if (!code) {
        console.error(chalk.red("Pairing code is required."));
        process.exit(1);
      }

      const spinner = ora("Pairing…").start();
      try {
        const config = await loginWithPairingCode(serverUrl, code);
        spinner.succeed(`Paired as ${chalk.cyan(config.email)}`);
      } catch (err) {
        spinner.fail((err as Error).message);
        process.exit(1);
      }
    } catch {
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    logout();
    console.log(chalk.green("Logged out."));
  });

program
  .command("status")
  .description("Show connection status and logged-in user")
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow("Not logged in."));
      return;
    }

    console.log(chalk.blue("Logged in as:"), chalk.cyan(config.email));
    console.log(chalk.blue("Server:"), config.serverUrl);

    const spinner = ora("Checking server…").start();
    try {
      const res = await fetch(`${config.serverUrl}/api/rooms`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) {
        spinner.fail(`Server returned ${res.status}`);
        return;
      }
      const rooms = (await res.json()) as Array<{ id: string; name: string }>;
      spinner.succeed(`Server online — ${rooms.length} room(s)`);
      for (const room of rooms) {
        console.log(chalk.gray(`  • ${room.name || room.id}`));
      }
    } catch (err) {
      spinner.fail(`Cannot reach server: ${(err as Error).message}`);
    }
  });

program
  .command("start")
  .description("Start the worker daemon")
  .option("--repo <path>", "Override repository path for all prompts")
  .action(async (opts: { repo?: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error(chalk.red("Not logged in. Run `steer login` first."));
      process.exit(1);
    }

    // Require Cursor CLI login before accepting Local prompts
    await ensureCursorAuth();

    console.log(
      chalk.blue.bold("\n  Steer Worker\n"),
    );
    console.log(chalk.gray(`  Server: ${config.serverUrl}`));
    console.log(chalk.gray(`  User:   ${config.email}`));
    if (opts.repo) console.log(chalk.gray(`  Repo:   ${opts.repo}`));
    console.log();

    startWorker(opts.repo);
  });

program.parse();
