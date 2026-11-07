import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const res = (await prisma.$runCommandRaw({
    aggregate: "UserActivity",
    pipeline: [
      { $match: { action: "VIEW" } },
      { $sort: { occurredAt: -1, _id: -1 } },
      { $group: { _id: { u: "$userId", t: "$entityType", e: "$entityId" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ],
    cursor: { batchSize: 100000 },
    allowDiskUse: true,
  })) as { cursor: { firstBatch: Array<{ ids: Array<{ $oid: string }> }> } };

  const groups = res.cursor.firstBatch;
  const extra = groups.flatMap((g) => g.ids.slice(1).map((id) => id.$oid));
  console.log(`duplicate groups ${groups.length}, extra copies ${extra.length}`);
  if (process.argv.includes("--apply") && extra.length) {
    const { count } = await prisma.userActivity.deleteMany({ where: { id: { in: extra } } });
    console.log("deleted", count);
  }
}

main().finally(() => prisma.$disconnect());
