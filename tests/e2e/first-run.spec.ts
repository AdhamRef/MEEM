import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, selectedTopicTitles, signInBrowser } from "./support/accounts";
import { seededChannelTitle } from "./support/seed-feed";
import { expect, test } from "./support/test";

const flow = (page: Page) => page.getByTestId("first-run");
const tile = (page: Page, title: string) => page.getByTestId("topic-tile").filter({ hasText: title });
const channel = (page: Page, slug: string) => page.getByRole("switch", { name: seededChannelTitle(slug) });
const next = (page: Page) => page.getByTestId("first-run-next");
const finish = (page: Page) => page.getByTestId("first-run-finish");
const skip = (page: Page) => page.getByTestId("first-run-skip");

const feedParams = (page: Page) => page.waitForRequest((request) => request.url().includes("/api/feed")).then((request) => new URL(request.url()).searchParams);

test.describe("the first visit", () => {
  test("opens over everything, with no player behind it and no sign-in in the way", async ({ page }) => {
    await page.goto("/");
    await expect(flow(page)).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(flow(page).getByText("تسجيل الدخول")).toHaveCount(0);
    // A modal dialog takes the rest of the page out of reach, including by keyboard.
    expect(await flow(page).evaluate((element) => element.matches(":modal"))).toBe(true);
  });

  test("offers only topics with channels to watch", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topic-tile")).toHaveCount(4);
    await expect(tile(page, "الفقه")).toBeVisible();
    await expect(tile(page, "الآداب الإسلامية")).toHaveCount(0);
  });

  test("needs a topic to go on, but can always be skipped", async ({ page }) => {
    await page.goto("/");
    await expect(next(page)).toBeDisabled();
    await expect(skip(page)).toBeEnabled();

    await tile(page, "الفقه").click();
    await expect(tile(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect(next(page)).toBeEnabled();

    await tile(page, "الفقه").click();
    await expect(next(page)).toBeDisabled();
  });

  test("turns on the channels of the chosen topics and leaves the others off", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await tile(page, "التزكية").click();
    await next(page).click();

    await expect(channel(page, "الفقه")).toHaveAttribute("aria-checked", "true");
    await expect(channel(page, "التزكية")).toHaveAttribute("aria-checked", "true");
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "false");
    await expect(channel(page, "العقيدة")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("channels-matching").getByRole("switch")).toHaveCount(2);
    await expect(page.getByTestId("channels-other").getByRole("switch")).toHaveCount(2);
    await expect(page.getByTestId("first-run-channels-on")).toContainText("2");
  });

  test("a pressed card stays in its place", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();

    await channel(page, "النبوة").click();
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("channels-other").getByRole("switch", { name: seededChannelTitle("النبوة") })).toBeVisible();
  });

  test("won't start with every channel off, and says why", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();

    await channel(page, "الفقه").click();
    await expect(finish(page)).toBeDisabled();
    await expect(page.getByTestId("first-run-channels-on")).toContainText("فعّل قناة واحدة على الأقل");
    await expect(skip(page)).toBeEnabled();
  });

  test("going back keeps what was picked", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();
    await channel(page, "النبوة").click();

    await page.getByTestId("first-run-back").click();
    await expect(tile(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await next(page).click();
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "true");
  });

  test("finishing shapes the feed, and it isn't asked again", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();
    await channel(page, "النبوة").click();

    const request = feedParams(page);
    await finish(page).click();
    const params = await request;
    expect(params.get("interests")).toBeTruthy();
    expect(params.get("channelsOn")).toBeTruthy();

    await expect(flow(page)).toHaveCount(0);
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    const channels = await page.getByTestId("feed-card").evaluateAll((cards) => cards.map((card) => card.textContent ?? ""));
    expect(channels.some((text) => text.includes(seededChannelTitle("العقيدة")))).toBe(false);
    expect(channels.some((text) => text.includes(seededChannelTitle("التزكية")))).toBe(false);

    await page.reload();
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    await expect(flow(page)).toHaveCount(0);
  });

  test("skipping leaves everything on, and isn't asked again", async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await skip(page).click();
    await expect(flow(page)).toHaveCount(0);
    await expect(page.getByTestId("feed-card").first()).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    await expect(flow(page)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("preferences.v2")!).selectedTopicIds)).toEqual([]);
  });

  test("still lets someone in when the browser refuses to store anything", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    });
    await page.goto("/");
    await skip(page).click();
    await expect(flow(page)).toHaveCount(0);
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
  });

  test("the feed simply opens when the choices can't load", async ({ page }) => {
    await page.route("**/api/topics", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    await expect(flow(page)).toHaveCount(0);
  });

  test("a shared video opens directly, never behind the choices", async ({ page }) => {
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "e2ec0000000" } });
    await page.goto(`/shorts/${video.id}`);
    await expect(page.getByTestId("feed-card").first()).toHaveAttribute("data-video-id", video.id);
    await expect(flow(page)).toHaveCount(0);
  });

  test("fits a phone with nothing sideways, and passes an accessibility scan on both steps", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await expect(page.getByTestId("topic-tile").first()).toBeVisible();

    const noSidewaysScroll = () => flow(page).evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(await noSidewaysScroll()).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-testid="first-run"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

    await tile(page, "الفقه").click();
    await next(page).click();
    await expect(page.getByTestId("channel-card").first()).toBeVisible();
    expect(await noSidewaysScroll()).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-testid="first-run"]').withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });
});

test.describe("changing choices later", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();
    await finish(page).click();
    await expect(flow(page)).toHaveCount(0);
  });

  test("is one tap from the feed", async ({ page }) => {
    await page.getByTestId("feed-customize").click();
    await expect(page).toHaveURL(/\/interests$/);
    await expect(tile(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect(channel(page, "الفقه")).toHaveAttribute("aria-checked", "true");
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "false");
  });

  test("choosing another topic turns its channels on, and removing it turns them off", async ({ page }) => {
    await page.goto("/interests");
    await tile(page, "النبوة").click();
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "true");
    await tile(page, "النبوة").click();
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "false");
  });

  test("a saved switch survives a reload and reaches the feed", async ({ page }) => {
    await page.goto("/interests");
    await expect(page.getByTestId("interests-save")).toBeDisabled();

    await channel(page, "العقيدة").click();
    await page.getByTestId("interests-save").click();
    await expect(page.getByText("تم حفظ اختياراتك.")).toBeVisible();

    await page.reload();
    await expect(channel(page, "العقيدة")).toHaveAttribute("aria-checked", "true");

    const request = feedParams(page);
    await page.goto("/");
    expect((await request).get("channelsOn")).toBeTruthy();
  });

  test("turning a whole group on or off works, and warns when nothing is left", async ({ page }) => {
    await page.goto("/interests");
    await page.getByTestId("channels-other-all").click();
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "true");
    await expect(channel(page, "العقيدة")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("channels-other-all").click();
    await page.getByTestId("channels-matching-all").click();
    await expect(page.getByTestId("interests-bar")).toContainText("لا توجد قنوات مفعّلة");
  });

  test("with everything off, the feed explains and leads back here", async ({ page }) => {
    await page.goto("/interests");
    await channel(page, "الفقه").click();
    await page.getByTestId("interests-save").click();
    await expect(page.getByText("تم حفظ اختياراتك.")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("feed-empty")).toContainText("لا توجد مقاطع في القنوات المفعّلة لديك");
    await page.getByTestId("feed-empty-edit").click();
    await expect(page).toHaveURL(/\/interests$/);
  });

  test("switched-off channels stay on Explore", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByTestId("section-topics")).toContainText("النبوة");
    await page.getByTestId("section-topics").getByRole("link", { name: "النبوة" }).click();
    await expect(page).toHaveURL(/\/explore\?topic=/);
    await expect(page.getByText("مقطع النبوة 1")).toBeVisible();
  });
});

test.describe("with an account", () => {
  test("choices made as a guest carry over at sign-in, including switches", async ({ page, context, baseURL }) => {
    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();
    await channel(page, "النبوة").click();
    await finish(page).click();
    await expect(flow(page)).toHaveCount(0);

    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/interests");
    await expect(tile(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect(channel(page, "النبوة")).toHaveAttribute("aria-checked", "true");

    await expect.poll(() => selectedTopicTitles(account.id)).toEqual(["الفقه"]);
    await expect.poll(() => prisma.userChannelChoice.count({ where: { userId: account.id, isEnabled: true } })).toBe(1);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("preferences.v2"))).toBeNull();
  });

  test("finishing is saved to the account, and another device isn't asked", async ({ page, context, baseURL, browser }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/");
    await tile(page, "العقيدة").click();
    await next(page).click();
    await finish(page).click();
    await expect(flow(page)).toHaveCount(0);
    await expect.poll(() => selectedTopicTitles(account.id)).toEqual(["العقيدة"]);

    const otherDevice = await browser.newContext({ baseURL });
    await signInBrowser(otherDevice, baseURL!, account.sessionToken);
    const otherPage = await otherDevice.newPage();
    await otherPage.goto("/");
    await expect(otherPage.getByTestId("feed-card").first()).toBeVisible();
    await expect(flow(otherPage)).toHaveCount(0);
    await otherDevice.close();
  });

  test("a failed save says so and loses nothing", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.route("**/api/preferences", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));

    await page.goto("/");
    await tile(page, "الفقه").click();
    await next(page).click();
    await finish(page).click();

    await expect(flow(page).getByRole("alert")).toContainText("تعذّر حفظ اختياراتك");
    await expect(channel(page, "الفقه")).toHaveAttribute("aria-checked", "true");
    await expect(finish(page)).toBeEnabled();
  });
});
