import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { seedTaxonomy } from "../../../src/features/categories/seed-taxonomy";
import { ensureMongoIndexes } from "../../../src/lib/prisma/ensure-indexes";
import { E2E_DATABASE_PORT, E2E_DATABASE_READY_PORT, E2E_DATABASE_URL } from "./constants";
import { seedFeed } from "./seed-feed";

/**
 * A throwaway replica set for browser tests, started by Playwright before the app.
 * It answers on the "ready" port only after the schema and categories are in place,
 * because mongod accepting connections isn't enough for the tests to begin.
 */
const replSet = await MongoMemoryReplSet.create({
  replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
  // The default 10 seconds is too short for mongod to start on a machine under memory pressure.
  instanceOpts: [{ port: E2E_DATABASE_PORT, launchTimeout: 120_000 }],
});

// Asynchronous, because blocking this process would stall the mongod whose output it reads.
await promisify(execFile)(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
  env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  // Creating about 100 indexes is slow on a nearly full disk.
  timeout: 400_000,
});

const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
// What npm run db:sync does after pushing. Search needs these text indexes.
await ensureMongoIndexes(prisma);
await seedTaxonomy(prisma);
await seedFeed(prisma);
await prisma.$disconnect();

createServer((_request, response) => response.end("ready")).listen(E2E_DATABASE_READY_PORT, "127.0.0.1");

const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
