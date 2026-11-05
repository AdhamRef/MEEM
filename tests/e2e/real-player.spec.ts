import { expect, test, type Page } from "@playwright/test";
import { prisma } from "./support/accounts";

/**
 * Runs the real feed against YouTube's real player, which the other tests stub. It needs
 * internet access, so it runs only when REAL_PLAYER_E2E=1. It uses no API key or quota.
 * It's emulated Chromium, so it still says nothing about real phones.
 */
test.skip(!process.env.REAL_PLAYER_E2E, "Set REAL_PLAYER_E2E=1 to run against the real YouTube player");
test.setTimeout(90_000);

// Public videos: YouTube's own IFrame API sample, and the first video uploaded to YouTube.
const REAL_VIDEOS = [
  { youtubeVideoId: "M7lc1UVf-VE", title: "YouTube Developers Live" },
  { youtubeVideoId: "jNQXAC9IVRw", title: "Me at the zoo" },
];
const CATEGORY_SLUG = "real-player-test";

test.beforeAll(async () => {
  const category = await prisma.category.upsert({
    where: { slug: CATEGORY_SLUG },
    update: {},
    create: { slug: CATEGORY_SLUG, title: "اختبار المشغل", displayOrder: 100_000 },
  });
  for (const [index, video] of REAL_VIDEOS.entries()) {
    const data = {
      ...video,
      kind: "SHORT" as const,
      classification: "SHORT_CANDIDATE" as const,
      reviewedAt: new Date(),
      status: "PUBLISHED" as const,
      availability: "AVAILABLE" as const,
      channelTitle: "YouTube",
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${video.youtubeVideoId}/hqdefault.jpg` }],
      durationSeconds: 60,
      metadataFetchedAt: new Date(),
      categoryId: category.id,
      feedKey: index,
    };
    await prisma.video.upsert({ where: { youtubeVideoId: video.youtubeVideoId }, update: data, create: data });
  }
});

async function openCategory(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));
  await page.goto("/");
  await page.getByTestId("feed-tabs").getByRole("button", { name: "اختبار المشغل" }).click();
}

const frameVideo = (page: Page) => page.locator("iframe").evaluate((frame) => new URL((frame as HTMLIFrameElement).src).pathname.split("/").pop());

test("the feed drives the real player: one embed, and moving on works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openCategory(page);

  const iframes = page.locator('iframe[src*="youtube.com/embed/"]');
  await expect(iframes).toHaveCount(1, { timeout: 30_000 });
  const firstVideo = await frameVideo(page);
  expect(REAL_VIDEOS.map((video) => video.youtubeVideoId)).toContain(firstVideo);

  const src = await page.locator("iframe").getAttribute("src");
  expect(src).toContain("enablejsapi=1");
  expect(src).toContain("mute=1");

  // The real player must report as ready and muted before the sound button can act on it.
  const sound = page.locator('[data-testid="sound"]:not([disabled])').first();
  await expect(sound).toHaveAttribute("aria-label", "تشغيل الصوت");

  await page.waitForTimeout(3000);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.locator("iframe").evaluate((frame) => (frame as HTMLIFrameElement).src), { timeout: 20_000 }).toBeTruthy();
  await expect(page.locator("iframe")).toHaveCount(1);

  // No player error reached the card, including error 153 from a missing referrer.
  await expect(page.getByText("تعذّر تشغيل هذا المقطع هنا.")).toHaveCount(0);
  await expect(page.getByText("تعذّر تحميل مشغل YouTube")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the sound control really changes the real player's state", async ({ page }) => {
  await openCategory(page);
  await expect(page.locator('iframe[src*="youtube.com/embed/"]')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const sound = page.locator('[data-testid="sound"]:not([disabled])').first();
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "كتم الصوت");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", "تشغيل الصوت");
});

test("the video page shows the real player, without autoplay", async ({ page }) => {
  const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "jNQXAC9IVRw" } });
  await page.goto(`/videos/${video.id}`);

  const frame = page.locator('iframe[src*="youtube.com/embed/jNQXAC9IVRw"]');
  await expect(frame).toHaveCount(1, { timeout: 30_000 });
  expect(await frame.getAttribute("src")).toContain("autoplay=0");
  await expect(page.getByText("تعذّر تشغيل هذا المقطع هنا.")).toHaveCount(0);
});

test("moving on with the real player: thumbnail and loader until it runs, then nothing on top", async ({ page }) => {
  await openCategory(page);
  await expect(page.locator('iframe[src*="youtube.com/embed/"]')).toHaveCount(1, { timeout: 30_000 });
  const first = page.getByTestId("feed-card").first();
  await expect(first.getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });

  // Samples the second card from the moment of the swipe, so a brief wrong state can't slip by.
  await page.evaluate(() => {
    const samples: { poster: string | null; loader: boolean; paused: boolean; at: number }[] = [];
    const card = document.querySelectorAll('[data-testid="feed-card"]')[1]!;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      samples.push({
        poster: card.querySelector('[data-testid="feed-poster"]')?.getAttribute("data-visible") ?? null,
        loader: Boolean(card.querySelector('[data-testid="video-loader"]')),
        paused: Boolean(card.querySelector('[data-testid="paused-indicator"]')),
        at: Math.round(performance.now() - startedAt),
      });
    }, 40);
    Object.assign(window, { __samples: samples, __stopSampling: () => clearInterval(timer) });
  });
  await page.keyboard.press("ArrowDown");
  const next = page.getByTestId("feed-card").nth(1);
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath("while-loading.png") });
  await expect(next.getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("just-started.png") });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: test.info().outputPath("running.png") });

  const samples = await page.evaluate(() => {
    const target = window as unknown as { __samples: { poster: string | null; loader: boolean; paused: boolean; at: number }[]; __stopSampling: () => void };
    target.__stopSampling();
    return target.__samples;
  });
  const revealedAt = samples.find((sample) => sample.poster === "false")?.at ?? null;
  console.log(`[real-player] thumbnail left after ${revealedAt}ms, ${samples.length} samples`);

  expect(revealedAt).not.toBeNull();
  expect(samples.filter((sample) => sample.paused)).toEqual([]);
  // The loader never stays on a running video, and is there until it runs.
  expect(samples.filter((sample) => sample.poster === "false" && sample.loader)).toEqual([]);
  expect(samples.filter((sample) => sample.poster === "true" && !sample.loader)).toEqual([]);
});
