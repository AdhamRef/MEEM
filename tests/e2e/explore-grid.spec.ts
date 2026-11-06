import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { prisma } from "./support/accounts";
import { expect, settled, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);

async function seedVideos(count: number, kind: "LONG_FORM" | "SHORT", categoryId: string, label: string) {
  const channel = await prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC${unique()}`, title: `قناة ${label}` } });
  for (let index = 0; index < count; index += 1) {
    await prisma.video.create({
      data: {
        youtubeVideoId: `g${unique()}`.slice(0, 11),
        kind,
        classification: kind === "SHORT" ? "SHORT_CANDIDATE" : "LONG_FORM_CANDIDATE",
        reviewedAt: new Date(),
        status: "PUBLISHED",
        availability: "AVAILABLE",
        title: `${label} ${index}`,
        channelId: channel.id,
        channelTitle: `قناة ${label}`,
        durationSeconds: 725,
        ytPublishedAt: new Date("2026-01-01T00:00:00Z"),
        thumbnails: [{ quality: "high", url: "https://i.ytimg.com/vi/x/hqdefault.jpg" }],
        feedKey: Math.floor(Math.random() * 2 ** 31),
        categoryId,
        metadataFetchedAt: new Date(),
      },
    });
  }
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe("explore's video grid", () => {
  // Seeding dozens of videos is slow on a busy machine.
  test.setTimeout(120_000);

  test("keeps loading as people scroll, far past one screenful, crediting YouTube on each", async ({ page }) => {
    const id = unique();
    const category = await prisma.category.create({ data: { title: `شبكة ${id}`, slug: `grid-${id}` } });
    await seedVideos(40, "LONG_FORM", category.id, `طويل ${id}`);

    await page.goto(`/explore?category=grid-${id}`);
    const tiles = page.getByTestId("video-tile");
    await expect(tiles.first()).toContainText("YouTube");
    await expect(tiles.first().getByTestId("video-duration")).toHaveText("12:05");
    await expect(tiles).toHaveCount(24);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(tiles).toHaveCount(40, { timeout: 15_000 });
    await expect(page.getByTestId("explore-sentinel")).toHaveCount(0);

    // Statistics are off, so no count may appear.
    await expect(page.getByTestId("explore-feed")).not.toContainText("مشاهدة على YouTube");
    await noSidewaysScroll(page);
  });

  test("chips narrow to a category, and show which is chosen", async ({ page }) => {
    const id = unique();
    const [first, second] = await Promise.all([prisma.category.create({ data: { title: `أول ${id}`, slug: `chip-a-${id}` } }), prisma.category.create({ data: { title: `ثان ${id}`, slug: `chip-b-${id}` } })]);
    await seedVideos(2, "LONG_FORM", first.id, `فيه ${id}`);
    await seedVideos(2, "LONG_FORM", second.id, `غيره ${id}`);

    await page.goto("/explore");
    await page.getByTestId("section-categories").getByRole("link", { name: first.title }).click();
    await expect(page).toHaveURL(new RegExp(`category=chip-a-${id}`));
    await expect(page.getByRole("link", { name: first.title })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(`فيه ${id} 0`)).toBeVisible();
    await expect(page.getByText(`غيره ${id} 0`)).toHaveCount(0);
  });

  test("an empty category says so honestly", async ({ page }) => {
    const id = unique();
    await prisma.category.create({ data: { title: `فارغ ${id}`, slug: `empty-${id}` } });
    await page.goto(`/explore?category=empty-${id}`);
    await expect(page.getByText("لا توجد مقاطع هنا بعد")).toBeVisible();
  });

  test("a failed page offers to try again, and trying again works", async ({ page }) => {
    const id = unique();
    const category = await prisma.category.create({ data: { title: `خطأ ${id}`, slug: `retry-${id}` } });
    await seedVideos(30, "LONG_FORM", category.id, `تجربة ${id}`);

    let shouldFail = true;
    let failures = 0;
    await page.route("**/api/explore/videos*", (route) => {
      if (!shouldFail) return route.continue();
      failures += 1;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto(`/explore?category=retry-${id}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const retry = page.getByTestId("explore-retry");
    await expect(retry).toBeVisible({ timeout: 15_000 });

    // It waits to be asked, rather than hammering a server that's in trouble.
    const failuresSoFar = failures;
    await page.waitForTimeout(1500);
    expect(failures).toBe(failuresSoFar);
    await expect(retry).toBeVisible();

    shouldFail = false;
    await retry.click();
    await expect(page.getByTestId("video-tile")).toHaveCount(30, { timeout: 15_000 });
  });

  test("the three-dot menu shares, and links to YouTube", async ({ page }) => {
    const id = unique();
    const category = await prisma.category.create({ data: { title: `قائمة ${id}`, slug: `menu-${id}` } });
    await seedVideos(1, "LONG_FORM", category.id, `خيارات ${id}`);

    await page.goto(`/explore?category=menu-${id}`);
    await page.getByTestId("video-menu").first().click();
    await expect(page.getByRole("menuitem", { name: "مشاركة" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "المشاهدة على YouTube" })).toHaveAttribute("href", /youtube\.com\/watch/);
  });

  test("Explore plays nothing by itself", async ({ page }) => {
    await page.goto("/explore");
    await settled(page);
    await expect(page.getByTestId("explore-page")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
