import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const execFileAsync = promisify(execFile);

/**
 * Starts a throwaway replica set and applies the real schema to it.
 *
 * db push must stay asynchronous: this process reads mongod's output, so blocking it
 * fills that pipe, stalls mongod, and makes db push hang forever.
 */
export default async function setup() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
    // The default 10 seconds is too short for mongod to start on a machine under memory pressure.
    instanceOpts: [{ launchTimeout: 120_000 }],
  });

  const databaseUrl = replSet.getUri("muslim_test");
  process.env.DATABASE_URL = databaseUrl;

  await execFileAsync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    // Creating about 100 indexes is slow on a nearly full disk.
    timeout: 400_000,
  });

  return async () => {
    await replSet.stop();
  };
}
