import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { SEEDED_SHORTS_PER_CATEGORY } from "./support/seed-feed";
import { FEED_CROP_PIXELS } from "../../src/config/feed";
import { expect, test } from "./support/test";

/** Opens the feed past the first-visit prompt, as someone who already skipped it. */
async function openFeed(page: Page, path = "/") {
  await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));
  await page.goto(path);
  await expect(activeFrame(page)).toHaveCount(1, { timeout: 15_000 });
}

/** The player on screen. Others stay buffered on the cards coming up. */
/** Undoes the test default of having muted, so this test sees what a new visitor does. */
async function withDefaultSound(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("keep-default-sound", "1");
    if (window.sessionStorage.getItem("keep-default-sound-set") === null) {
      window.sessionStorage.setItem("keep-default-sound-set", "1");
      window.localStorage.removeItem("feed.sound");
    }
  });
}

function activeFrame(page: Page) {
  return page.locator('[data-player-role="active"] iframe');
}

const activeFrameVideo = (page: Page) => activeFrame(page).getAttribute("data-video-id");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __ytCalls: { name: string; videoId: string; arg?: unknown }[] }).__ytCalls);
const fire = (page: Page, method: string, value?: number) =>
  page.evaluate(
    ([name, arg]) => {
      const players = (window as unknown as { __ytPlayers: (Record<string, (value?: unknown) => void> & { __frame: Element })[] }).__ytPlayers;
      players.find((player) => player.__frame.closest('[data-player-role="active"]'))![name as string]!(arg);
    },
    [method, value] as const,
  );

/** The card whose slot the player currently sits over. */
const activeCard = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-player-role="active"]')!.getBoundingClientRect();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="feed-card"]')];
    const card = cards.find((element) => {
      const box = element.getBoundingClientRect();
      return Math.abs(box.top - frame.top) < box.height / 2 && frame.top >= box.top - 1 && frame.bottom <= box.bottom + 1;
    });
    return card?.dataset.videoId ?? null;
  });

const scrollerPosition = (page: Page) => page.getByTestId("feed-scroller").evaluate((element) => element.scrollTop);

async function moveNext(page: Page) {
  const before = await scrollerPosition(page);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => scrollerPosition(page)).toBeGreaterThan(before);
  await expect.poll(async () => (await scrollerPosition(page)) % 1 === 0, { timeout: 5000 }).toBeTruthy();
}

test.describe("playback rules", () => {
  test("one player on screen, and real players buffered on the next cards, muted and paused", async ({ page }) => {
    await openFeed(page);

    await expect.poll(() => page.locator("iframe").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    await expect(activeFrame(page)).toHaveCount(1);
    expect(await page.locator("iframe").count()).toBeLessThanOrEqual(5);

    const states = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="feed-scroller"]')!.getBoundingClientRect();
      const players = (window as unknown as { __ytPlayers: { __frame: Element; isMuted(): boolean }[] }).__ytPlayers;
      return players
        .filter((player) => !player.__frame.closest('[data-player-role="active"]'))
        .map((player) => {
          // The player's window, since the frame itself runs past it and is cropped.
          const frame = player.__frame.closest('[data-testid="player-mount"]')!.getBoundingClientRect();
          return { isMuted: player.isMuted(), isOnScreen: frame.top < box.bottom && frame.bottom > box.top, isInert: Boolean(player.__frame.closest("[inert]")) };
        });
    });
    expect(states.length).toBeGreaterThanOrEqual(3);
    for (const state of states) expect(state).toEqual({ isMuted: true, isOnScreen: false, isInert: true });

    // Every card has a thumbnail, which also covers the active one until its first frame.
    const cardCount = await page.getByTestId("feed-card").count();
    expect(cardCount).toBeGreaterThan(1);
    await expect(page.locator('[data-testid="player-slot"] img')).toHaveCount(cardCount);
  });

  test("swiping onto a buffered card plays it at once, with no new load and no spinner", async ({ page }) => {
    await openFeed(page);
    await expect.poll(() => page.locator("iframe").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(500);

    const second = await page.getByTestId("feed-card").nth(1).getAttribute("data-video-id");
    await moveNext(page);
    await expect.poll(() => activeCard(page)).toBe(second);
    await expect(page.getByTestId("feed-card").nth(1).getByTestId("feed-poster")).toHaveAttribute("data-visible", "false", { timeout: 5000 });
    await expect(activeFrame(page)).toHaveCount(1);
    // It was already loaded, so its own video was never loaded again.
    const shown = await activeFrameVideo(page);
    expect((await calls(page)).filter((call) => call.name === "loadVideoById" && call.arg === shown)).toEqual([]);
  });

  test("the number of players stays capped however far someone goes", async ({ page }) => {
    await openFeed(page);
    for (let step = 0; step < 8; step += 1) {
      await moveNext(page);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1000);
    expect(await page.locator("iframe").count()).toBeLessThanOrEqual(5);
    await expect(activeFrame(page)).toHaveCount(1);
    expect(await page.locator('[data-testid="video-loader"]').count()).toBeLessThanOrEqual(1);
  });

  test("the waiting spinner stays out of sight unless a wait runs long", async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { __ytHoldFirstFrame: true }));
    await openFeed(page);
    const loader = page.locator('[data-testid="video-loader"]').first();
    await expect(loader).toBeAttached();
    expect(await loader.evaluate((element) => getComputedStyle(element).animationDelay)).toBe("1.2s");
  });

  test("buffering stops when the page is hidden, and nothing keeps playing", async ({ page }) => {
    await openFeed(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const lastCalls = (await calls(page)).slice(-1);
    expect(lastCalls[0]?.name).toBe("pauseVideo");
  });

  test("a first visit starts playing at once, with no button in the way, and the first touch brings sound", async ({ page }) => {
    await withDefaultSound(page);
    await openFeed(page);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();
    const hint = page.getByTestId("sound-hint");
    await expect(hint).toBeVisible();

    await page.mouse.click(5, 300);
    await expect(hint).toHaveCount(0);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "unMute")).toBeTruthy();
  });

  test("a first touch that's a swipe also brings sound, and moves to the next card", async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile" || browserName !== "chromium", "Touch events on a phone profile");
    await withDefaultSound(page);
    await openFeed(page);
    await expect(page.getByTestId("sound-hint")).toBeVisible();
    await page.waitForTimeout(300);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", y?: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: y === undefined ? [] : [{ x: 200, y }] });
    await touch("touchStart", 600);
    for (const y of [560, 500, 420, 340, 280]) await touch("touchMove", y);
    await touch("touchEnd");

    await expect.poll(async () => (await calls(page)).some((call) => call.name === "unMute")).toBeTruthy();
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
    await expect.poll(() => scrollerPosition(page), { timeout: 5000 }).toBeGreaterThan(100);
    const scroller = page.getByTestId("feed-scroller");
    await expect.poll(() => scroller.evaluate((element) => (element as HTMLElement).style.touchAction)).toBe("");
  });

  test("someone who chose to mute is left muted, with no hint", async ({ page }) => {
    await openFeed(page);
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
  });

  test("sound stays on for each video after that, and a chosen mute is remembered", async ({ page }) => {
    await withDefaultSound(page);
    await openFeed(page);
    await expect(page.getByTestId("sound-hint")).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
    const unmutes = (await calls(page)).filter((call) => call.name === "unMute").length;

    await moveNext(page);
    await expect.poll(async () => (await calls(page)).filter((call) => call.name === "unMute").length).toBeGreaterThan(unmutes);
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);

    await page.keyboard.press("m");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("feed.sound"))).toBe("off");
    await page.evaluate(() => window.sessionStorage.setItem("keep-default-sound", "1"));
    await page.reload();
    await expect(activeFrame(page)).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(300);
    await expect(page.getByTestId("sound-hint")).toHaveCount(0);
    const vars = await page.evaluate(() => (window as unknown as { __ytOptions: { playerVars: { mute: number } }[] }).__ytOptions[0]!.playerVars);
    expect(vars.mute).toBe(1);
  });

  test("a refused unmute falls back to muted playback, says so, and doesn't stop the video", async ({ page }) => {
    await withDefaultSound(page);
    await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));
    // The browser reports past activity while the player still refuses, as can happen on phones.
    await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true }));
    await page.goto("/");
    await expect(activeFrame(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("sound-hint")).toBeVisible();
    await expect(page.locator('[data-testid="paused-indicator"]')).toHaveCount(0);
    await expect(page.getByTestId("feed-poster").first()).toHaveAttribute("data-visible", "false");
  });

  test("the card being left keeps its picture while it slides out, and only then goes back to its thumbnail", async ({ page }) => {
    await openFeed(page);
    const cards = page.getByTestId("feed-card");
    await expect(cards.first().getByTestId("feed-poster")).toHaveAttribute("data-visible", "false");
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await page.getByTestId("feed-poster").nth(1).getAttribute("data-visible")) === "false").toBeTruthy();
    // The two are uncovered together for a moment, which is the whole point.
    await expect(cards.first().getByTestId("feed-poster")).toHaveAttribute("data-visible", "true", { timeout: 3000 });
  });

  // The owner's decision of 2026-11-05: see FEED_IMMERSIVE_OVERLAY. This describes that layout.
  test("the touch layer takes every touch on the video, and our interface is on top", async ({ page }) => {
    await openFeed(page);
    await expect.poll(() => activeCard(page)).not.toBeNull();

    const result = await page.evaluate(() => {
      const mount = document.querySelector('[data-player-role="active"]')!;
      const box = mount.getBoundingClientRect();
      const reached = [0.1, 0.5, 0.9].flatMap((x) => [0.1, 0.5].map((y) => document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)));
      return { reachesPlayer: reached.some((element) => element?.tagName === "IFRAME"), width: box.width, height: box.height };
    });
    expect(result.reachesPlayer).toBe(false);
    expect(result.width).toBeGreaterThanOrEqual(200);
    expect(result.height).toBeGreaterThanOrEqual(200);
  });

  test("a tap turns the sound on first, then pauses and resumes", async ({ page }) => {
    await openFeed(page);
    const card = page.locator('[data-testid="feed-card"]:has([data-testid="video-tap"]:not([disabled]))').first();
    const tap = card.getByTestId("video-tap");
    await expect(tap).toHaveAttribute("aria-label", "تشغيل الصوت");
    await tap.click();
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "unMute")).toBeTruthy();

    await expect(tap).toHaveAttribute("aria-label", "إيقاف مؤقت");
    await tap.click();
    await expect.poll(async () => (await calls(page)).at(-1)?.name).toBe("pauseVideo");
    await expect(card.getByTestId("paused-indicator")).toBeVisible();

    await tap.click();
    await expect.poll(async () => (await calls(page)).at(-1)?.name).toBe("playVideo");
    await expect(card.getByTestId("paused-indicator")).toHaveCount(0);
    await expect(card.getByTestId("video-loader")).toHaveCount(0);
  });

  test("a thumbnail covers the player until its first frame, then gets out of the way", async ({ page }) => {
    await openFeed(page);
    const poster = page.locator('[data-testid="feed-poster"]').first();
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();
    await expect(poster).toHaveAttribute("data-visible", "false");
    await expect(page.getByTestId("feed-card").first().getByTestId("video-loader")).toHaveCount(0);
  });

  test("moving onto a card that isn't buffered shows the thumbnail and loader until the time moves, then nothing on top", async ({ page }) => {
    // Held from the start, so the next card can't have finished buffering.
    await page.addInitScript(() => Object.assign(window, { __ytHoldFirstFrame: true }));
    await openFeed(page);
    const cards = page.getByTestId("feed-card");
    await expect(cards.first().getByTestId("video-loader")).toHaveCount(0, { timeout: 5000 });

    await moveNext(page);
    const next = cards.nth(1);
    await expect(next.getByTestId("video-tap")).toBeEnabled();

    // YouTube says "playing" and even "paused" during the swap. Neither reveals a black player.
    await fire(page, "__fireState", 2);
    await expect(next.getByTestId("paused-indicator")).toHaveCount(0);
    await fire(page, "__fireState", 1);
    await expect(next.getByTestId("feed-poster")).toHaveAttribute("data-visible", "true");
    await expect(next.getByTestId("video-loader")).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __ytHoldFirstFrame: boolean }).__ytHoldFirstFrame = false;
    });
    await expect(next.getByTestId("feed-poster")).toHaveAttribute("data-visible", "false");
    await expect(next.getByTestId("video-loader")).toHaveCount(0);
  });

  test("a video that never starts ends in a play button, not an endless loader", async ({ page }) => {
    // Muted by choice, so this pause can't be taken for the browser refusing sound.
    await page.addInitScript(() => window.localStorage.setItem("feed.sound", "off"));
    await openFeed(page);
    await page.evaluate(() => {
      (window as unknown as { __ytHoldFirstFrame: boolean }).__ytHoldFirstFrame = true;
    });
    await moveNext(page);
    const next = page.getByTestId("feed-card").nth(1);
    await expect(next.getByTestId("video-tap")).toBeEnabled();
    // Paused during the swap, so the time can't move and only the give-up timer is left.
    await fire(page, "__fireState", 2);
    await expect(next.getByTestId("paused-indicator")).toBeVisible({ timeout: 12_000 });
    await expect(next.getByTestId("video-loader")).toHaveCount(0);
  });

  test("the player uses YouTube's documented settings, and only the active one autoplays", async ({ page }) => {
    await openFeed(page);
    const allVars = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return (window as unknown as { __ytOptions: { playerVars: Record<string, unknown> }[] }).__ytOptions.map((options) => options.playerVars);
    });
    const vars = allVars[0]!;

    expect(vars).toMatchObject({ autoplay: 1, controls: 0, playsinline: 1, enablejsapi: 1 });
    expect(allVars.slice(1).every((other) => other.autoplay === 0 && other.mute === 1)).toBe(true);
    expect(vars.origin).toBe(new URL(page.url()).origin);
    // Options that would hide YouTube's own interface must never be set.
    expect(vars).not.toHaveProperty("modestbranding");
    expect(vars).not.toHaveProperty("rel");
    expect(vars).not.toHaveProperty("showinfo");
  });

  test("moving on starts the next video, and only one player is ever active", async ({ page }) => {
    await openFeed(page);
    const first = await activeFrameVideo(page);

    await moveNext(page);

    await expect.poll(() => activeFrameVideo(page)).not.toBe(first);
    await expect(activeFrame(page)).toHaveCount(1);
  });

  test("moving before the player is ready doesn't crash, and ends on the right video", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));

    await page.goto("/");
    await page.getByTestId("feed-card").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    await expect(activeFrame(page)).toHaveCount(1);
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
  });

  test("starts the next video on the way in, and goes back if the swipe turns back", async ({ page }) => {
    await openFeed(page);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();

    const scroller = page.getByTestId("feed-scroller");
    const scrollTo = (share: number) =>
      scroller.evaluate((element, value) => {
        element.style.scrollSnapType = "none";
        element.scrollTop = element.clientHeight * value;
      }, share);

    const first = await activeFrameVideo(page);
    // Scrolling that stops settles back within moments, so this records each change as it happens.
    await page.evaluate(() => {
      const seen: (string | null)[] = [];
      new MutationObserver(() => seen.push(document.querySelector('[data-player-role="active"] iframe')?.getAttribute("data-video-id") ?? null)).observe(document.querySelector('[data-testid="feed-scroller"]')!, { attributes: true, attributeFilter: ["data-player-role"], subtree: true });
      Object.assign(window, { __activeSeen: seen });
    });
    const seen = () => page.evaluate(() => (window as unknown as { __activeSeen: (string | null)[] }).__activeSeen);

    // Only a fifth of the next card is showing, and it has already started.
    await scrollTo(0.2);
    await expect.poll(async () => (await seen()).some((video) => video !== null && video !== first)).toBeTruthy();

    await scrollTo(0);
    await expect.poll(() => activeFrameVideo(page)).toBe(first);
    expect(await activeFrame(page).count()).toBe(1);
  });

  test("nothing plays in the background", async ({ page }) => {
    await openFeed(page);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await calls(page)).at(-1)?.name).toBe("pauseVideo");
  });

  test("a video that ends starts again, staying on the same card", async ({ page }) => {
    await openFeed(page);
    const before = await activeFrameVideo(page);

    await fire(page, "__fireState", 0);

    await expect.poll(async () => (await calls(page)).some((call) => call.name === "seekTo" && call.arg === 0)).toBeTruthy();
    expect(await activeFrameVideo(page)).toBe(before);
    expect(await scrollerPosition(page)).toBe(0);
  });

  test("explains a video that can't play, and people can move on", async ({ page }) => {
    await openFeed(page);
    await fire(page, "__fireError", 150);
    await expect(page.getByText("تعذّر تشغيل هذا المقطع هنا.")).toBeVisible();
    await expect(page.getByTestId("next").first()).toBeEnabled();
  });

  test("explains when the browser blocks autoplay", async ({ page }) => {
    await openFeed(page);
    await fire(page, "__fireAutoplayBlocked");
    await expect(page.getByText("منع المتصفح التشغيل التلقائي")).toBeVisible();
  });

  test("explains when YouTube's player can't load at all", async ({ page, context }) => {
    await context.unroute("https://www.youtube.com/iframe_api");
    await context.route("https://www.youtube.com/iframe_api", (route) => route.abort());
    await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));

    await page.goto("/");
    await expect(page.getByText("تعذّر تحميل مشغل YouTube")).toBeVisible({ timeout: 15_000 });
  });

  test("the sound control uses the documented methods, and carries to the next video", async ({ page }) => {
    await openFeed(page);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();

    const sound = page.locator('article:has([data-testid="card-status"]) [data-testid="sound"]:not([disabled])').first();
    await expect(sound).toHaveAttribute("aria-label", "تشغيل الصوت");
    await sound.click();
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "unMute")).toBeTruthy();

    await moveNext(page);
    await expect.poll(async () => (await calls(page)).filter((call) => call.name === "unMute").length).toBeGreaterThanOrEqual(2);
  });

  test("leaving the feed removes the player", async ({ page }) => {
    await openFeed(page);
    await page.locator('nav a[href="/"]').first().waitFor({ state: "attached" });
    await page.goto("/interests");
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});

test.describe("the feed content", () => {
  test("every card credits YouTube and shows the channel, with no invented numbers", async ({ page }) => {
    await openFeed(page);

    for (const card of await page.getByTestId("feed-card").all()) {
      const attribution = card.getByTestId("youtube-attribution");
      await expect(attribution).toContainText("المصدر: YouTube");
      await expect(attribution).toContainText("قناة الاختبار");
      await expect(attribution.locator('a[href^="https://www.youtube.com/watch?v="]')).toHaveCount(1);
      // Statistics are off, so no count may appear.
      await expect(card.getByTestId("view-count")).toHaveCount(0);
    }
  });

  test("shows everything once before anything repeats, never ends, and never shows hidden videos", async ({ page }) => {
    test.setTimeout(120_000);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("googleapis.com")) requests.push(request.url());
    });
    await openFeed(page);

    const expected = await prisma.video.count({ where: { status: "PUBLISHED", isArchived: false, availability: "AVAILABLE", kind: "SHORT", category: { isActive: true } } });
    const cards = page.getByTestId("feed-card");
    for (let step = 0; step < 60; step += 1) {
      if ((await cards.count()) > expected) break;
      const scroller = page.getByTestId("feed-scroller");
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.waitForTimeout(250);
    }

    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(expected);

    const ids = await cards.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.videoId!));
    expect(new Set(ids.slice(0, expected)).size).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(SEEDED_SHORTS_PER_CATEGORY * 4);

    const titles = (await cards.locator("h2").allTextContents()).join(" ");
    expect(titles).not.toContain("مخفي");
    expect(titles).not.toContain("محاضرة كاملة");

    expect(requests).toEqual([]);
  });

  test("the tabs switch to one category, and back", async ({ page }) => {
    await openFeed(page);

    await page.getByTestId("feed-tabs").getByRole("button", { name: "النبوة", exact: true }).click();
    await expect(page.getByTestId("feed-tabs").getByRole("button", { name: "النبوة", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("feed-card").first()).toContainText("النبوة");

    const badges = await page.getByTestId("feed-card").locator("h2").allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((title) => title.includes("النبوة"))).toBe(true);

    await page.getByTestId("feed-tabs").getByRole("button", { name: "لك", exact: true }).click();
    await expect(page.getByTestId("feed-tabs").getByRole("button", { name: "لك", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(activeFrame(page)).toHaveCount(1);
  });

  test("the first tab stays reachable when there are more tabs than fit", async ({ page }) => {
    const created = await Promise.all(Array.from({ length: 30 }, (_, index) => prisma.category.create({ data: { title: `مجال طويل الاسم للتجربة ${index} ${randomUUID().slice(0, 4)}`, slug: `many-tabs-${randomUUID()}` } })));
    try {
      await openFeed(page);
      const forYou = page.getByTestId("feed-tabs").getByRole("button", { name: "لك", exact: true });
      await page.getByTestId("feed-tabs").getByRole("button", { name: created[29]!.title }).click();
      await forYou.click();
      await expect(forYou).toHaveAttribute("aria-pressed", "true");
    } finally {
      await prisma.category.deleteMany({ where: { id: { in: created.map((category) => category.id) } } });
    }
  });

  test("a category with nothing in it says so", async ({ page }) => {
    await openFeed(page);
    await page.getByTestId("feed-tabs").getByRole("button", { name: "الآداب الإسلامية" }).click();
    await expect(page.getByText("لا توجد مقاطع منشورة في هذا المجال بعد.")).toBeVisible();
    // Nothing active, and no player left sitting over the message.
    await expect(activeFrame(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="player-mount"]:visible')).toHaveCount(0);
  });

  test("shows an honest empty state with no videos", async ({ page }) => {
    await page.route("**/api/feed*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
    await page.goto("/");
    await expect(page.getByText("لا توجد مقاطع بعد")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("recovers from a failed load", async ({ page }) => {
    let shouldFail = true;
    await page.route("**/api/feed*", (route) => (shouldFail ? route.fulfill({ status: 500, json: {} }) : route.continue()));
    await page.addInitScript(() => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [], onboarding: "skipped" })));

    await page.goto("/");
    await expect(page.getByText("تعذّر تحميل المقاطع")).toBeVisible();

    shouldFail = false;
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
  });

  test("the first-visit prompt is one slide, and scrolling past it starts the feed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("onboarding")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByTestId("feed-scroller").evaluate((element) => {
      element.scrollTop = element.clientHeight;
    });
    await expect(activeFrame(page)).toHaveCount(1);
  });

  test("a guest's interests shape the feed they see", async ({ page }) => {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "النبوة" } });
    await page.addInitScript((id) => window.localStorage.setItem("preferences.v1", JSON.stringify({ version: 1, selectedCategoryIds: [id], onboarding: "completed" })), category.id);

    const feedRequest = page.waitForRequest((request) => request.url().includes("/api/feed"));
    await page.goto("/");
    expect(new URL((await feedRequest).url()).searchParams.get("interests")).toBe(category.id);

    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    const titles = await page.getByTestId("feed-card").locator("h2").allTextContents();
    expect(titles.filter((title) => title.includes("النبوة")).length).toBe(SEEDED_SHORTS_PER_CATEGORY);
  });
});

test.describe("CTAs, saving, and sharing", () => {
  test("a CTA only appears where assigned, and works", async ({ page }) => {
    const shortWithCta = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eCtaFull0" } });
    await openFeed(page, `/shorts/${shortWithCta.id}`);

    const card = page.locator(`[data-video-id="${shortWithCta.id}"]`);
    await card.getByRole("link", { name: "شاهد المحاضرة" }).click();
    await expect(page).toHaveURL(/\/videos\//);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("محاضرة كاملة للاختبار");
  });

  test("an external CTA opens safely in a new tab", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eCtaExt00" } });
    await openFeed(page, `/shorts/${video.id}`);

    const link = page.locator(`[data-video-id="${video.id}"]`).getByRole("link", { name: "اقرأ المقال" });
    await expect(link).toHaveAttribute("href", "https://example.org/read");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("a guest who wants to save is sent to the optional sign-in, not blocked", async ({ page }) => {
    await openFeed(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const save = page.getByTestId("save-signin").first();
    await expect(save).toHaveAttribute("href", /\/auth\/signin\?callbackUrl=%2Fshorts%2F/);
  });

  test("a signed-in person can save and unsave, and it persists", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.addInitScript(() => window.localStorage.removeItem("preferences.v1"));
    await prisma.userPreference.create({ data: { userId: account.id, onboardingSkipped: true } });

    await page.goto("/");
    const card = page.getByTestId("feed-card").first();
    const videoId = (await card.getAttribute("data-video-id"))!;
    const save = card.getByTestId("save");

    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityId: videoId } })).toBe(1);

    await page.goto(`/shorts/${videoId}`);
    await expect(page.locator(`[data-video-id="${videoId}"]`).getByTestId("save")).toHaveAttribute("aria-pressed", "true");

    await page.locator(`[data-video-id="${videoId}"]`).getByTestId("save").click();
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityId: videoId } })).toBe(0);
  });

  test("a failed save goes back and says so", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await prisma.userPreference.create({ data: { userId: account.id, onboardingSkipped: true } });
    await page.route("**/api/favorites", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, json: {} }) : route.continue()));

    await page.goto("/");
    const save = page.getByTestId("feed-card").first().getByTestId("save");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("تعذّر الحفظ")).toBeVisible();
  });

  test("sharing copies a working link when the system share isn't available", async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void ((window as unknown as { __copied: string }).__copied = text) },
      });
    });
    await openFeed(page);

    const card = page.getByTestId("feed-card").first();
    const videoId = await card.getAttribute("data-video-id");
    await card.getByTestId("share").click();

    await expect(page.getByText("نُسخ الرابط.")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(`${baseURL}/shorts/${videoId}`);
  });

  test("a guest's watching stays in their browser", async ({ page }) => {
    await openFeed(page);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();

    const signalRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/signals")) signalRequests.push(request.url());
    });

    await fire(page, "__fireState", 0);
    await moveNext(page);

    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("signals.v1"))).toContain("score");
    expect(signalRequests).toEqual([]);
  });

  test("a signed-in person's completed video counts for that category", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await prisma.userPreference.create({ data: { userId: account.id, onboardingSkipped: true } });

    await page.goto("/");
    await expect(activeFrame(page)).toHaveCount(1);
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "playVideo")).toBeTruthy();

    await fire(page, "__fireState", 0);
    await moveNext(page);

    await expect.poll(() => prisma.userActivity.count({ where: { userId: account.id, action: "COMPLETE" } })).toBe(1);
    const interest = await prisma.userInterest.findFirstOrThrow({ where: { userId: account.id } });
    expect(interest.behaviourScore).toBeGreaterThan(0);
  });
});

test.describe("shareable pages", () => {
  const short = () => prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2ec0000000" } });

  test("a shared Short opens first, with the feed behind it and no repeat of it", async ({ page }) => {
    const video = await short();
    await openFeed(page, `/shorts/${video.id}`);

    const first = page.getByTestId("feed-card").first();
    await expect(first).toHaveAttribute("data-video-id", video.id);
    await expect(activeFrame(page)).toHaveAttribute("data-video-id", video.youtubeVideoId);
    await expect(page.locator(`[data-video-id="${video.id}"]`)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(video.title));
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
  });

  test("hidden, removed, or invalid videos return 404", async ({ request }) => {
    for (const youtubeVideoId of ["e2eDraft000", "e2eArchive0", "e2eNoEmbed0", "e2eGone0000"]) {
      const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId } });
      expect((await request.get(`/shorts/${video.id}`)).status(), youtubeVideoId).toBe(404);
      expect((await request.get(`/videos/${video.id}`)).status(), youtubeVideoId).toBe(404);
    }
    expect((await request.get("/shorts/not-an-id")).status()).toBe(404);
    expect((await request.get(`/shorts/${"f".repeat(24)}`)).status()).toBe(404);
  });

  test("a long video's Short address leads to its own page", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.goto(`/shorts/${video.id}`);
    await expect(page).toHaveURL(`/videos/${video.id}`);
  });

  test("the video page plays by itself behind our own controls, stays at the top, and credits YouTube", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.goto(`/videos/${video.id}`);

    await expect(page.locator("iframe")).toHaveCount(1);
    const vars = await page.evaluate(() => (window as unknown as { __ytOptions: { playerVars: Record<string, unknown> }[] }).__ytOptions[0]!.playerVars);
    expect(vars).toMatchObject({ autoplay: 1, controls: 0 });
    await expect(page.getByTestId("youtube-attribution")).toContainText("المصدر: YouTube");

    // Nothing reaches YouTube's player, and our controls really drive it.
    await expect(page.getByTestId("video-tap")).toBeVisible();
    await expect(page.getByTestId("video-poster")).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId("control-play").click();
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "pauseVideo")).toBeTruthy();
    await page.getByTestId("control-play").click();
    await page.getByTestId("control-seek").fill("30");
    await expect.poll(async () => (await calls(page)).some((call) => call.name === "seekTo" && call.arg === 30)).toBeTruthy();

    // It stays at the top while the page scrolls under it.
    const top = await page.getByTestId("video-frame").evaluate((element) => {
      window.scrollTo(0, 400);
      return element.getBoundingClientRect().top;
    });
    await expect.poll(async () => page.getByTestId("video-frame").evaluate((element) => element.getBoundingClientRect().bottom)).toBeGreaterThan(100);
    expect(top).toBeLessThanOrEqual(120);

    const box = await page.locator("iframe").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(200);
  });

  test("comments are labelled as YouTube's, read-only, and explain when unavailable", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.goto(`/videos/${video.id}#comments`);

    const section = page.getByTestId("youtube-comments");
    await expect(section.getByRole("heading")).toHaveText("تعليقات YouTube");
    await expect(section.locator("textarea, input")).toHaveCount(0);

    await section.getByRole("button", { name: "عرض تعليقات YouTube" }).click();
    await expect(section.getByText("التعليقات غير متاحة حاليًا")).toBeVisible();
  });

  test("comments show as plain text, so nothing in them can run", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.route("**/api/comments/**", (route) =>
      route.fulfill({
        json: {
          state: "available",
          nextPageToken: null,
          comments: [{ id: "1", author: "<b>كاتب</b>", authorUrl: null, text: '<img src=x onerror="window.__xss=1">نص', publishedAt: null }],
        },
      }),
    );
    await page.goto(`/videos/${video.id}`);
    const section = page.getByTestId("youtube-comments");
    await section.getByRole("button", { name: "عرض تعليقات YouTube" }).click();

    await expect(section.getByText('<img src=x onerror="window.__xss=1">نص')).toBeVisible();
    await expect(section.locator("li img, li b")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("shows when comments are disabled on YouTube", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.route("**/api/comments/**", (route) => route.fulfill({ json: { state: "disabled" } }));
    await page.goto(`/videos/${video.id}`);
    const section = page.getByTestId("youtube-comments");
    await section.getByRole("button", { name: "عرض تعليقات YouTube" }).click();
    await expect(section.getByText("التعليقات معطلة")).toBeVisible();
  });
});

test.describe("the refresh job", () => {
  const SECRET = "e2e-only-cron-secret-not-used-anywhere-else";

  test("the scheduled endpoint needs the secret", async ({ request }) => {
    expect((await request.post("/api/cron/youtube-refresh")).status()).toBe(401);
    expect((await request.post("/api/cron/youtube-refresh", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);

    const response = await request.post("/api/cron/youtube-refresh", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ stoppedBy: "NOT_CONFIGURED", checked: 0 });
  });

  test("staff with permission see a clear disabled state without an API key", async ({ page, context, baseURL }) => {
    const account = await createAccount("ADMIN");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/admin/youtube-status");

    const panel = page.getByTestId("youtube-panel");
    await expect(panel.getByText("مفتاح YouTube API لم يُضبط بعد")).toBeVisible();
    await expect(panel.getByRole("button", { name: "تحديث البيانات الآن" })).toBeDisabled();
  });

  test("staff without permission don't get the panel, and can't call it directly", async ({ page, context, baseURL }) => {
    const account = await createAccount("EDITOR");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");
    await expect(page.getByTestId("youtube-panel")).toHaveCount(0);

    const response = await page.request.post("/api/admin/youtube/refresh", { headers: { Origin: baseURL! } });
    expect(response.status()).toBe(403);
  });

  test("a guest can't trigger it, or save, or send signals", async ({ request, baseURL }) => {
    const headers = { Origin: baseURL!, "Content-Type": "application/json" };
    expect((await request.post("/api/admin/youtube/refresh", { headers })).status()).toBe(401);
    expect((await request.post("/api/signals", { headers, data: "{}" })).status()).toBe(401);
    expect((await request.put("/api/favorites", { headers, data: "{}" })).status()).toBe(401);
    expect((await request.get("/api/favorites?ids=")).status()).toBe(401);
  });
});

test.describe("layout and accessibility", () => {
  async function scan(page: Page) {
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);
  }

  test("the feed has no WCAG A or AA violations", async ({ page }) => {
    await openFeed(page);
    expect(await scan(page)).toEqual([]);
  });

  test("the video page has no WCAG A or AA violations", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2eLong0000" } });
    await page.goto(`/videos/${video.id}`);
    await expect(page.locator("iframe")).toHaveCount(1);
    expect(await scan(page)).toEqual([]);
  });

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    test(`the feed fits at ${viewport.width}px, with a usable player and all controls reachable`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await openFeed(page);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const box = await page.locator('[data-player-role="active"] iframe').boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(200);
      expect(box!.height).toBeGreaterThanOrEqual(200);

      const card = page.getByTestId("feed-card").first();
      const cardBox = await card.boundingBox();
      // A phone swipes, so its arrows are hidden. Tests below use them on desktop.
      for (const control of testInfo.project.name === "desktop" && viewport.width >= 768 ? ["next", "share", "sound"] : ["share", "sound"]) {
        const controlBox = await card.getByTestId(control).boundingBox();
        expect(controlBox!.height, control).toBeGreaterThanOrEqual(44);
        expect(controlBox!.y + controlBox!.height, `${control} stays in the card`).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
      }

      if (testInfo.project.name === "desktop") await page.screenshot({ path: `test-results/screens/feed-${viewport.width}.png` });
    });
  }
});

test.describe("sizing the video to the screen", () => {
  const seed = async (aspectRatio: number | null) => {
    const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
    const id = `z${randomUUID().slice(0, 10)}`.slice(0, 11);
    return prisma.video.create({
      data: { youtubeVideoId: id, kind: "SHORT", classification: "SHORT_CANDIDATE", reviewedAt: new Date(), status: "PUBLISHED", publishedAt: new Date(), availability: "AVAILABLE", title: `مقاس ${id}`, channelTitle: "قناة الاختبار", thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }], durationSeconds: 40, aspectRatio, metadataFetchedAt: new Date(), feedKey: 1, categoryId: category.id },
    });
  };

  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`at ${viewport.width}×${viewport.height}, each video shows whole, as large as fits, keeping its shape`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const vertical = await seed(608 / 1080);
      const wide = await seed(1920 / 1080);

      for (const [video, ratio] of [[vertical, 608 / 1080], [wide, 1920 / 1080]] as const) {
        await page.goto(`/shorts/${video.id}`);
        const card = page.locator(`[data-testid="feed-card"][data-video-id="${video.id}"]`);
        const slot = card.getByTestId("player-slot");
        await expect(page.locator("iframe")).toHaveCount(1);
        await expect.poll(async () => (await activeFrame(page).boundingBox())?.width ?? 0).toBeGreaterThan(0);

        const [slotBox, cardBox, frameBox] = await Promise.all([slot.boundingBox(), card.boundingBox(), activeFrame(page).boundingBox()]);
        // No part of the video is lost: its width fits inside the slot, and it's centred.
        expect(frameBox!.width).toBeLessThanOrEqual(slotBox!.width + 1);
        expect(Math.abs(frameBox!.x + frameBox!.width / 2 - (slotBox!.x + slotBox!.width / 2))).toBeLessThanOrEqual(1);
        // The frame is taller than the video by a fixed strip, which is what holds YouTube's bars.
        const videoHeight = frameBox!.height - 2 * FEED_CROP_PIXELS;
        expect(Math.abs(frameBox!.width / videoHeight - ratio)).toBeLessThan(0.02);
        expect(videoHeight).toBeLessThanOrEqual(slotBox!.height + 1);
        // Height comes first: it fills the height, unless that would run past the sides.
        expect(slotBox!.height - videoHeight < 2 || slotBox!.width - frameBox!.width < 2).toBe(true);
        expect(slotBox!.y + slotBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
      }
    });
  }

  test("a video with no known shape falls back on its kind", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const video = await seed(null);
    await page.goto(`/shorts/${video.id}`);
    await expect(page.locator(`[data-testid="feed-card"][data-video-id="${video.id}"]`)).toHaveAttribute("data-shape", "vertical");
  });

  test("gives the phone's top bar to the video on the feed only, and keeps the account menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("top-bar")).toBeHidden();
    await expect(page.getByTestId("feed-tabs").or(page.locator("[data-immersive-feed]")).getByTestId("account-menu").first()).toBeVisible();
    await page.goto("/explore");
    await expect(page.getByTestId("top-bar")).toBeVisible();
  });
});

test("loads the next five thumbnails ahead", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByTestId("feed-card");
  await cards.first().waitFor();
  await expect(activeFrame(page)).toHaveCount(1);
  const count = await cards.count();
  const eager = await page.locator('[data-testid="feed-poster"][loading="eager"]').count();
  // The active card, and the five after it.
  expect(eager).toBe(Math.min(6, count));
});

test("opens with the animated logo and the name, not skeletons", async ({ page }) => {
  await page.route("**/api/feed*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  const loader = page.getByTestId("feed-loading");
  await expect(loader).toBeVisible();
  await expect(page.getByTestId("feed-loader-name")).toHaveText("ميم");
  await expect(loader.locator("img")).toBeVisible();
  await expect(loader).toBeHidden({ timeout: 15_000 });
});
