import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Local development database for machines without Docker or MongoDB installed.
 * Data persists in .data/mongodb. The first run downloads a MongoDB binary.
 */
const dbPath = resolve(".data/mongodb");
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ port: 27017, dbPath }],
});

console.log(`MongoDB replica set is running. Data directory: ${dbPath}`);
console.log(`DATABASE_URL="mongodb://127.0.0.1:27017/muslim?replicaSet=rs0&directConnection=true"`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
