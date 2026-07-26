#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { createInterface } from "readline";
import { login, logout } from "./auth.js";
import { loadConfig } from "./config.js";
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

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        process.stdout.write("\n");
        resolve(input);
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007F" || c === "\b") {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

program
  .name("steer")
  .description("CLI worker for Steer — run local Cursor agents")
  .version("0.1.0");

program
  .command("login")
  .description("Log in to the Steer server")
  .action(async () => {
    try {
      const serverUrl = await prompt("Server URL: ");
      const email = await prompt("Email: ");
      const password = await promptSecret("Password: ");

      if (!serverUrl || !email || !password) {
        console.error(chalk.red("All fields are required."));
        process.exit(1);
      }

      const spinner = ora("Logging in…").start();
      try {
        const config = await login(serverUrl, email, password);
        spinner.succeed(`Logged in as ${chalk.cyan(config.email)}`);
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
