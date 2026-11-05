import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getVideoComments } from "@/features/youtube/comments.service";
import { runMetadataRefresh } from "@/features/youtube/metadata-refresh.service";
import { importVideosByInput } from "@/features/youtube/video-import.service";
import { clearDatabase, createTestClient } from "./helpers";

process.env.APP_URL = "http://localhost:3000";
process.env.YOUTUBE_API_ENABLED = "false";
delete process.env.YOUTUBE_API_KEY;

let prisma: PrismaClient;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("with no API key", () => {
  const video = (metadataFetchedAt: Date) => ({
    youtubeVideoId: "aaaaaaaaaa1",
    kind: "SHORT" as const,
    classification: "SHORT_CANDIDATE" as const,
    status: "PUBLISHED" as const,
    availability: "AVAILABLE" as const,
    title: "t",
    feedKey: 1,
    metadataFetchedAt,
  });

  it("makes no API calls, and importing fails clearly rather than inventing data", async () => {
    await expect(importVideosByInput(["aaaaaaaaaa1"])).rejects.toMatchObject({ reason: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.video.count()).toBe(0);
  });

  it("comments report unavailable", async () => {
    const { id } = await prisma.video.create({ data: video(new Date()) });
    expect(await getVideoComments(id)).toEqual({ state: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the 30-day limit still applies: old data is withdrawn even though it can't be refreshed", async () => {
    const { id } = await prisma.video.create({ data: video(new Date(Date.now() - 31 * 86_400_000)) });

    const report = await runMetadataRefresh();

    expect(report).toMatchObject({ stoppedBy: "NOT_CONFIGURED", checked: 0, withdrawn: 1 });
    expect(await prisma.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ availability: "UNKNOWN", title: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
