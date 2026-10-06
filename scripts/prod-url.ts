import { createInterface } from "node:readline";

/**
 * `--prod` on a script: ask for the production database URL, typed without echo, instead of
 * taking it from the shell. Two attempts to pass it through the shell ended with the URL on the
 * screen and in the history; a prompt that shows nothing cannot.
 *
 * Call it before the database client is imported — the client reads DATABASE_URL the moment it
 * is created, so the import has to be a dynamic one after this:
 *
 *   await prodIfAsked();
 *   const { prisma } = await import("../src/lib/db");
 */
export async function prodIfAsked(argv = process.argv): Promise<boolean> {
  if (!argv.includes("--prod")) return false;
  const url = await askHidden("Paste the production database URL and press Enter (nothing will show): ");
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error(`That is not a database URL (${url.length} characters read). Nothing was done.`);
    process.exit(2);
  }
  process.env.DATABASE_URL = url;
  console.log(`\u001b[33m⚠ REMOTE db\u001b[0m → ${/@([^/?]+)/.exec(url)?.[1]}`);
  return true;
}

/** A line typed without echo, so a secret never lands on the screen or in history. */
export function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // readline has no "silent" mode; muting its echo is the documented way around that
    const r = rl as unknown as { _writeToOutput: (s: string) => void };
    const echo = r._writeToOutput;
    process.stdout.write(prompt);
    r._writeToOutput = () => {};
    rl.question("", (answer) => {
      r._writeToOutput = echo;
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
