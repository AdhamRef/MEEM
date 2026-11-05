import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Run after a build. Secret names should never reach the browser, because that would mean
 * server code leaked into client code. Real values come from .env when it exists, so a value
 * inlined at build time is caught too. Nothing it reads is ever printed.
 */
const SECRET_NAMES = ["AUTH_SECRET", "AUTH_GOOGLE_SECRET", "YOUTUBE_API_KEY", "CRON_SECRET", "STORAGE_SECRET_KEY", "STORAGE_ACCESS_KEY", "DATABASE_URL"];

function readSecretValues(): string[] {
  try {
    return readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^([A-Z_]+)=["']?(.*?)["']?\s*$/.exec(line);
        return match && SECRET_NAMES.includes(match[1] as string) && (match[2] as string).length >= 8 ? [match[2] as string] : [];
      });
  } catch {
    return [];
  }
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(".next/static").filter((path) => /\.(js|css|map|json)$/.test(path));
const values = readSecretValues();
const problems: string[] = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const name of SECRET_NAMES) if (text.includes(name)) problems.push(`${file}: contains the name ${name}`);
  // Which secret isn't named, so even this message says nothing useful about it.
  if (values.some((value) => text.includes(value))) problems.push(`${file}: contains a value from .env`);
}

console.log(`Scanned ${files.length} client files, for ${SECRET_NAMES.length} secret names and ${values.length} values from .env.`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Nothing found.");
}
