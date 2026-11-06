import { expect, test, type Page } from "@playwright/test";
import { prisma } from "./support/accounts";
import { ONLY_REAL_GESTURES } from "./support/test";

/**
 * Runs the real feed against YouTube's real player, which the other tests stub. It needs
 * internet access, so it runs only when REAL_PLAYER_E2E=1. It uses no API key or quota.
 * It's emulated Chromium, so it still says nothing about real phones.
 */
test.skip(!process.env.REAL_PLAYER_E2E, "Set REAL_PLAYER_E2E=1 to run against the real YouTube player");
test.setTimeout(90_000);
// Headless Chromium otherwise allows sound on autoplay, which no visitor's browser does.
test.use({ launchOptions: { args: ["--autoplay-policy=document-user-activation-required"] } });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(ONLY_REAL_GESTURES);
});

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
  // A real browser refuses sound until this tap, so a new visitor always meets it.
  await page.getByTestId("sound-gate").click({ timeout: 30_000 });
  await page.getByTestId("feed-tabs").getByRole("button", { name: "اختبار المشغل" }).click();
}

const activeFrame = (page: Page) => page.locator('[data-player-role="active"] iframe');

test("the feed drives the real player: one active embed, and moving on works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openCategory(page);


  const src = await activeFrame(page).getAttribute("src");
  expect(src).toContain("enablejsapi=1");

  // Whatever the browser allows with sound, the video has to be running.
  await expect(page.getByTestId("feed-card").first().getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });

  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("feed-card").nth(1).getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
  await expect(activeFrame(page)).toHaveCount(1);

  // No player error reached the card, including error 153 from a missing referrer.
  await expect(page.getByText("تعذّر تشغيل هذا المقطع هنا.")).toHaveCount(0);
  await expect(page.getByText("تعذّر تحميل مشغل YouTube")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the sound control really changes the real player's state", async ({ page }) => {
  await openCategory(page);
  await expect(activeFrame(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("feed-card").first().getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });

  const sound = page.locator('[data-testid="sound"]:not([disabled])').first();
  const first = await sound.getAttribute("aria-label");
  const other = first === "كتم الصوت" ? "تشغيل الصوت" : "كتم الصوت";
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", other);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-label", first!);
});

test("the welcome tap gives the first video sound, on the real player", async ({ page }) => {
  await openCategory(page);
  await expect(page.getByTestId("feed-card").first()).toContainText("اختبار المشغل", { timeout: 30_000 });
  const first = page.getByTestId("feed-card").first();
  await expect(first.getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
  await expect(page.locator('[data-testid="sound"]:not([disabled])').first()).toHaveAttribute("aria-label", "كتم الصوت");
  await expect(page.getByTestId("sound-hint")).toHaveCount(0);
  await page.waitForTimeout(2000);
  // Still running with sound: a refused unmute would have paused it or fallen back to muted.
  await expect(page.locator('[data-testid="sound"]:not([disabled])').first()).toHaveAttribute("aria-label", "كتم الصوت");
  await expect(first.getByTestId("paused-indicator")).toHaveCount(0);
});

test("the video page shows the real player, without autoplay", async ({ page }) => {
  const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "jNQXAC9IVRw" } });
  await page.goto(`/videos/${video.id}`);

  const frame = page.locator('iframe[src*="youtube.com/embed/jNQXAC9IVRw"]');
  await expect(frame).toHaveCount(1, { timeout: 30_000 });
  expect(await frame.getAttribute("src")).toContain("autoplay=0");
  await expect(page.getByText("تعذّر تشغيل هذا المقطع هنا.")).toHaveCount(0);
});

test("moving on with the real player: a buffered video starts quickly, with nothing left on top", async ({ page }) => {
  await openCategory(page);
  await expect(activeFrame(page)).toHaveCount(1, { timeout: 30_000 });
  const first = page.getByTestId("feed-card").first();
  await expect(first.getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
  // Gives the next card's hidden player time to buffer, which is the case being measured.
  await page.waitForTimeout(3000);

  // Samples the second card from the moment of the swipe, so a brief wrong state can't slip by.
  await page.evaluate(() => {
    const samples: { poster: string | null; loader: boolean; paused: boolean; at: number; top: number }[] = [];
    const scroller = document.querySelector('[data-testid="feed-scroller"]')!;
    const card = document.querySelectorAll('[data-testid="feed-card"]')[1]!;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      samples.push({
        poster: card.querySelector('[data-testid="feed-poster"]')?.getAttribute("data-visible") ?? null,
        loader: Boolean(card.querySelector('[data-testid="video-loader"]')),
        paused: Boolean(card.querySelector('[data-testid="paused-indicator"]')),
        at: Math.round(performance.now() - startedAt),
        top: scroller.scrollTop,
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
  await page.waitForTimeout(4000);
  await page.screenshot({ path: test.info().outputPath("running-later.png") });

  const samples = await page.evaluate(() => {
    const target = window as unknown as { __samples: { poster: string | null; loader: boolean; paused: boolean; at: number; top: number }[]; __stopSampling: () => void };
    target.__stopSampling();
    return target.__samples;
  });
  const revealedAt = samples.find((sample) => sample.poster === "false")?.at ?? null;
  const finalTop = samples.at(-1)?.top;
  const settledAt = samples.find((sample) => sample.top === finalTop)?.at ?? null;
  console.log(`[real-player] after the key press: thumbnail left at ${revealedAt}ms, card settled at ${settledAt}ms`);

  expect(revealedAt).not.toBeNull();
  expect(samples.filter((sample) => sample.paused)).toEqual([]);
  // The loader never stays on a running video.
  expect(samples.filter((sample) => sample.poster === "false" && sample.loader)).toEqual([]);
});
