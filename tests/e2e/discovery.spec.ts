import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { expect, settled, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);

const normalized = (text: string) =>
  text
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
const searchFields = (title: string) => {
  const words = normalized(title).split(" ");
  const forms = words.flatMap((word) => (word.startsWith("ال") && word.length > 3 ? [word, word.slice(2)] : [word]));
  return { titleSearch: normalized(title), searchText: [...new Set(forms)].join(" ") };
};

async function seedArticle(title: string, overrides: Record<string, unknown> = {}) {
  return prisma.article.create({
    data: { title, slug: `article-${unique()}`, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "نص" }] }] }, readingMinutes: 1, status: "PUBLISHED", publishedAt: new Date(), ...searchFields(title), ...overrides },
  });
}
const seedTopic = (title: string, overrides: Record<string, unknown> = {}) => prisma.topic.create({ data: { title, slug: `topic-${unique()}`, status: "PUBLISHED", publishedAt: new Date(), ...searchFields(title), ...overrides } });
const seedPlaylist = (title: string, overrides: Record<string, unknown> = {}) => {
  const id = unique();
  return prisma.playlist.create({ data: { type: "CURATED", title, slug: `playlist-${id}`, sourceKey: `cur:${id}`, status: "PUBLISHED", publishedAt: new Date(), ...searchFields(title), ...overrides } });
};
const seedLibrary = (name: string, overrides: Record<string, unknown> = {}) => prisma.library.create({ data: { name, slug: `library-${unique()}`, status: "PUBLISHED", publishedAt: new Date(), ...searchFields(name), ...overrides } });
const seedVideo = (title: string, overrides: Record<string, unknown> = {}) => {
  const id = `d${unique()}00`.slice(0, 11);
  return prisma.video.create({
    data: {
      youtubeVideoId: id,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      reviewedAt: new Date(),
      status: "PUBLISHED",
      publishedAt: new Date(),
      availability: "AVAILABLE",
      title,
      channelTitle: "قناة الاختبار",
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }],
      durationSeconds: 60,
      metadataFetchedAt: new Date(),
      feedKey: Math.floor(Math.random() * 1_000_000),
      ...searchFields(title),
      ...overrides,
    },
  });
};

async function signIn(page: Page, role: Parameters<typeof createAccount>[0], baseURL: string) {
  const account = await createAccount(role);
  await signInBrowser(page.context(), baseURL, account.sessionToken);
  return account;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await settled(page);
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("navigation", () => {
  test("every destination is a working link", async ({ page }) => {
    await open(page, "/explore");
    for (const href of ["/explore", "/search", "/saved", "/topics", "/"]) {
      await expect(page.locator(`a[href="${href}"][data-nav-item]`).first()).toBeAttached();
    }
    await expect(page.locator('[data-nav-item="unavailable"]')).toHaveCount(0);
  });
});

test.describe("explore", () => {
  test("a guest sees editorial sections, labelled and with real links", async ({ page }) => {
    const id = unique();
    const category = await prisma.category.create({ data: { title: `مجال ${id}`, slug: `category-${id}` } });
    const topic = await seedTopic(`موضوع مميز ${id}`, { isFeatured: true, categoryId: category.id });
    const article = await seedArticle(`مقال مختار ${id}`, { isFeatured: true });
    const library = await seedLibrary(`مكتبة ${id}`, { isFeatured: true });
    const playlist = await seedPlaylist(`قائمة مميزة ${id}`, { isFeatured: true });
    await seedPlaylist(`قائمة عادية ${id}`);
    await seedVideo(`مقطع جديد ${id}`);

    await open(page, "/explore");
    await expect(page.getByTestId("explore-page")).toBeVisible();

    await expect(page.getByTestId("section-categories").getByRole("link", { name: category.title })).toHaveAttribute("href", /\/explore\?category=/);
    await expect(page.getByTestId("section-featured-topics").getByText(topic.title)).toBeVisible();
    await expect(page.getByTestId("section-selected-articles").getByText(article.title)).toBeVisible();
    await expect(page.getByTestId("section-libraries").getByText(library.name)).toBeVisible();
    await expect(page.getByTestId("section-playlists").getByText(playlist.title)).toBeVisible();
    await expect(page.getByTestId("section-playlists").getByText(`قائمة عادية ${id}`)).toHaveCount(0);
    const newest = page.getByTestId("section-new-content");
    await expect(newest.getByText(`مقطع جديد ${id}`)).toBeVisible();
    await expect(newest.getByTestId("video-tile").first()).toContainText("YouTube");

    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test("shows no popularity section without enough real use", async ({ page }) => {
    await open(page, "/explore");
    await expect(page.getByTestId("section-popular")).toHaveCount(0);
  });

  test("recommends topics only from interests a guest chose, and offers changing them", async ({ page }) => {
    const id = unique();
    const chosen = await prisma.category.create({ data: { title: `مختار ${id}`, slug: `chosen-${id}` } });
    await seedTopic(`موضوع من اهتمامك ${id}`, { categoryId: chosen.id });

    await open(page, "/explore");
    await expect(page.getByTestId("explore-page")).toBeVisible();
    await expect(page.getByTestId("section-recommended-topics")).toHaveCount(0);

    await open(page, "/interests");
    await page.getByRole("button", { name: new RegExp(chosen.title) }).click();
    await page.getByRole("button", { name: "حفظ التغييرات" }).click();
    await expect(page.getByText("تم حفظ اهتماماتك.")).toBeVisible();
    await open(page, "/explore");
    const section = page.getByTestId("section-recommended-topics");
    await expect(section.getByText(`موضوع من اهتمامك ${id}`)).toBeVisible();
    await expect(section.getByRole("link", { name: /تعديل اهتماماتي/ })).toHaveAttribute("href", "/interests");
  });
});

test.describe("search", () => {
  test("finds content through a plain form, whichever way the word is spelled", async ({ page }) => {
    const id = unique();
    const article = await seedArticle(`الصلاة${id} للمبتدئين`);
    await seedArticle(`مقال آخر ${id}`);

    await open(page, "/search");
    await page.getByTestId("search-input").fill(`صلاه${id}`);
    await page.getByTestId("search-submit").click();

    await expect(page).toHaveURL(/\/search\?q=/);
    await settled(page);
    const group = page.getByTestId("search-group-ARTICLE");
    await expect(group.getByText(article.title)).toBeVisible();
    await expect(group.getByText(`مقال آخر ${id}`)).toHaveCount(0);
    await expect(page.getByTestId("search-summary")).toContainText(`صلاه${id}`);
  });

  test("works before the page's scripts have loaded", async ({ page }) => {
    const id = unique();
    const article = await seedArticle(`الزكاة${id}`);
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await open(page, "/search");
    await page.getByTestId("search-input").fill(`زكاة${id}`);
    await page.getByTestId("search-submit").click();
    await page.waitForURL(/\/search\?q=/);
    await settled(page);
    await expect(page.getByTestId("search-group-ARTICLE").getByText(article.title)).toBeVisible();
  });

  test("groups results by type, filters by type, and credits YouTube", async ({ page }) => {
    const id = unique();
    await seedVideo(`مقطع${id} قصير`);
    await seedArticle(`مقال${id} طويل مقطع${id}`);

    await open(page, `/search?q=${encodeURIComponent(`مقطع${id}`)}`);
    await expect(page.getByTestId("search-group-SHORT")).toContainText("YouTube");
    await expect(page.getByTestId("search-group-ARTICLE")).toBeVisible();

    await page.getByTestId("search-type-SHORT").click();
    await expect(page).toHaveURL(/type=SHORT/);
    await expect(page.getByTestId("search-type-SHORT")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("video-tile")).toHaveCount(1);
    await expect(page.getByTestId("article-card")).toHaveCount(0);
    await expectAccessible(page);
  });

  test("filters by category, and explains which types that leaves out", async ({ page }) => {
    const id = unique();
    const category = await prisma.category.create({ data: { title: `مجال ${id}`, slug: `filter-${id}` } });
    await seedArticle(`بحث${id} داخل`, { categoryId: category.id });
    await seedArticle(`بحث${id} خارج`);
    await seedLibrary(`بحث${id} مكتبة`);

    await open(page, `/search?q=${encodeURIComponent(`بحث${id}`)}`);
    await page.getByTestId("search-category").selectOption(category.slug);
    await page.getByTestId("search-submit").click();

    await expect(page).toHaveURL(/category=/);
    await settled(page);
    await expect(page.getByText(`بحث${id} داخل`)).toBeVisible();
    await expect(page.getByText(`بحث${id} خارج`)).toHaveCount(0);
    await expect(page.getByTestId("search-group-LIBRARY")).toHaveCount(0);
    await expect(page.getByTestId("search-type-LIBRARY")).toHaveCount(0);
  });

  test("pages through more results than fit", async ({ page }) => {
    const id = unique();
    await prisma.article.createMany({
      data: Array.from({ length: 14 }, (_, index) => ({ title: `كثير${id} ${index}`, slug: `many-${id}-${index}`, body: { type: "doc", content: [] }, status: "PUBLISHED" as const, publishedAt: new Date(), ...searchFields(`كثير${id} ${index}`) })),
    });

    await open(page, `/search?q=${encodeURIComponent(`كثير${id}`)}`);
    await page.getByTestId("search-more-ARTICLE").click();
    await expect(page.getByTestId("article-card")).toHaveCount(12);

    await page.getByTestId("search-next").click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId("article-card")).toHaveCount(2);
    await expect(page.getByTestId("search-next")).toHaveCount(0);
    await page.getByTestId("search-first").click();
    await expect(page.getByTestId("article-card")).toHaveCount(12);
  });

  test("shows empty states with a real way forward", async ({ page }) => {
    await open(page, "/search");
    await expect(page.getByRole("heading", { name: "عمَّ تبحث؟" })).toBeVisible();

    await open(page, `/search?q=${encodeURIComponent(`لايوجد${unique()}`)}`);
    await expect(page.getByRole("heading", { name: "لا توجد نتائج مطابقة" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تصفح قسم استكشف" })).toHaveAttribute("href", "/explore");
    await expectNoSidewaysScroll(page);
  });

  test("suggests titles while typing, by mouse and by keyboard", async ({ page }) => {
    const id = unique();
    const topic = await seedTopic(`الصيام${id} وأحكامه`);

    await open(page, "/search");
    const input = page.getByTestId("search-input");
    await input.pressSequentially(`صيام${id}`);
    const list = page.getByTestId("search-suggestions");
    await expect(list.getByText(topic.title)).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");

    await input.press("ArrowDown");
    await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/topics/${topic.slug}`));
  });

  test("closes suggestions with Escape, and searching still submits", async ({ page }) => {
    const id = unique();
    await seedTopic(`الحج${id}`);

    await open(page, "/search");
    const input = page.getByTestId("search-input");
    await input.pressSequentially(`حج${id}`);
    await expect(page.getByTestId("search-suggestions").getByRole("option").first()).toBeVisible();
    await input.press("Escape");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=/);
  });

  test("isn't indexed, because results aren't pages worth listing", async ({ page }) => {
    await open(page, "/search");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

test.describe("saved content", () => {
  test("a guest gets a real page and an optional way to sign in, not a wall", async ({ page }) => {
    await open(page, "/saved");
    await expect(page.getByTestId("library-signin")).toHaveAttribute("href", /\/auth\/signin/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await open(page, "/history");
    await expect(page.getByTestId("library-signin")).toBeVisible();
  });

  test("saves a topic and a playlist, keeps them on another device, and removes them", async ({ page, baseURL, browser }) => {
    const account = await signIn(page, "USER", baseURL!);
    const id = unique();
    const topic = await seedTopic(`موضوع للحفظ ${id}`);
    const playlist = await seedPlaylist(`قائمة للحفظ ${id}`);

    await open(page, `/topics/${topic.slug}`);
    await page.getByTestId("topic-actions").getByTestId("save").click();
    await expect(page.getByTestId("topic-actions").getByTestId("save")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityType: "TOPIC" } })).toBe(1);

    await open(page, `/playlists/${playlist.slug}`);
    await page.getByTestId("playlist-actions").getByTestId("save").click();
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityType: "PLAYLIST" } })).toBe(1);

    // Another browser with the same account, standing in for a second device.
    const second = await browser.newContext({ baseURL });
    await signInBrowser(second, baseURL!, account.sessionToken);
    const other = await second.newPage();
    await other.goto("/saved");
    await expect(other.getByTestId("library-row")).toHaveCount(2);
    await expect(other.getByTestId("saved-list").getByText(topic.title)).toBeVisible();
    await second.close();

    await open(page, "/saved");
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
    await page.getByTestId("saved-filters").getByRole("link", { name: "الموضوعات" }).click();
    await expect(page).toHaveURL(/type=TOPIC/);
    await expect(page.getByTestId("library-row")).toHaveCount(1);

    await page.getByRole("button", { name: new RegExp(`إزالة: موضوع للحفظ ${id}`) }).click();
    await expect(page.getByRole("heading", { name: "لم تحفظ شيئًا بعد" })).toBeVisible();
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityType: "TOPIC" } })).toBe(0);

    await open(page, `/topics/${topic.slug}`);
    await expect(page.getByTestId("topic-actions").getByTestId("save")).toHaveAttribute("aria-pressed", "false");
  });

  test("a check already on its way doesn't undo pressing save", async ({ page, baseURL }) => {
    await signIn(page, "USER", baseURL!);
    const topic = await seedTopic(`موضوع ${unique()}`);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/favorites?*", async (route) => {
      await held;
      await route.continue();
    });

    await open(page, `/topics/${topic.slug}`);
    const save = page.getByTestId("topic-actions").getByTestId("save");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    const answered = page.waitForResponse("**/api/favorites?*");
    release();
    await answered;
    await page.waitForTimeout(200);
    await expect(save).toHaveAttribute("aria-pressed", "true");
  });

  test("filter chips stay on one line on a narrow screen", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, `/search?q=${encodeURIComponent("صلاة")}`);
    const singleLine = async (locator: ReturnType<Page["getByTestId"]>) => {
      for (const chip of await locator.getByRole("link").all()) expect((await chip.boundingBox())?.height).toBeLessThan(60);
    };
    await singleLine(page.getByTestId("search-types"));
    await open(page, "/topics");
    await singleLine(page.getByTestId("topic-categories"));
    await signIn(page, "USER", baseURL!);
    await open(page, "/saved");
    await singleLine(page.getByTestId("saved-filters"));
  });

  test("a guest's save button leads to sign-in, on topics and playlists too", async ({ page }) => {
    const topic = await seedTopic(`موضوع ${unique()}`);
    await open(page, `/topics/${topic.slug}`);
    await expect(page.getByTestId("topic-actions").getByTestId("save-signin")).toHaveAttribute("href", /\/auth\/signin/);
  });

  test("offers removal for something no longer available, without showing what it was", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const article = await seedArticle(`مقال سيُسحب ${unique()}`, { status: "DRAFT" });
    await prisma.favorite.create({ data: { userId: account.id, entityType: "ARTICLE", entityId: article.id } });

    await open(page, "/saved");
    const row = page.getByTestId("library-row-unavailable");
    await expect(row).toContainText("لم يعد متاحًا");
    await expect(page.getByText(article.title)).toHaveCount(0);
    await row.getByTestId("library-remove").click();
    await expect(page.getByTestId("library-row-unavailable")).toHaveCount(0);
  });
});

test.describe("history", () => {
  test("records what a signed-in person opens, and lets them remove it or clear it all", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const id = unique();
    const article = await seedArticle(`مقال مقروء ${id}`);
    const topic = await seedTopic(`موضوع مفتوح ${id}`);

    await open(page, `/articles/${article.slug}`);
    await expect.poll(() => prisma.userActivity.count({ where: { userId: account.id, action: "VIEW", entityId: article.id } })).toBe(1);
    await open(page, `/topics/${topic.slug}`);
    await expect.poll(() => prisma.userActivity.count({ where: { userId: account.id, action: "VIEW", entityId: topic.id } })).toBe(1);

    await open(page, "/history");
    await expect(page.getByTestId("library-row")).toHaveCount(2);
    await expect(page.getByTestId("library-row").first()).toContainText(topic.title);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);

    await page.getByRole("button", { name: new RegExp(`إزالة: موضوع مفتوح ${id}`) }).click();
    await expect(page.getByTestId("library-row")).toHaveCount(1);

    await page.getByTestId("history-clear").click();
    const dialog = page.getByTestId("confirm-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "إلغاء" }).click();
    await expect(page.getByTestId("library-row")).toHaveCount(1);

    await page.getByTestId("history-clear").click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByRole("heading", { name: "السجل فارغ" })).toBeVisible();
    await expect.poll(() => prisma.userActivity.count({ where: { userId: account.id, action: "VIEW" } })).toBe(0);
  });

  test("records nothing for a guest", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/history") requests.push(request.url());
    });
    const article = await seedArticle(`مقال ${unique()}`);
    await open(page, `/articles/${article.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });

  test("offers continuing an unfinished video, with its real progress", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const video = await seedVideo(`درس طويل ${unique()}`, { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE", durationSeconds: 600 });
    await prisma.viewingProgress.create({ data: { userId: account.id, videoId: video.id, scopeKey: "video", positionSeconds: 150, durationSeconds: 600 } });

    await open(page, "/history");
    const card = page.getByTestId("continue-card");
    await expect(card).toHaveAttribute("href", `/videos/${video.id}`);
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    await expect(card).toContainText("YouTube");
  });
});

test.describe("editorial tools", () => {
  test("an editor builds a collection, and it appears on Explore once published", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const id = unique();
    const article = await seedArticle(`مقال المجموعة ${id}`);
    const draft = await seedArticle(`مسودة المجموعة ${id}`, { status: "DRAFT" });
    const topic = await seedTopic(`موضوع المجموعة ${id}`);
    const title = `باقة ${id}`;

    await open(page, "/admin/collections");
    await page.getByTestId("admin-create").click();
    await page.getByTestId("collection-form").getByLabel("العنوان").fill(title);
    await page.getByTestId("form-save").click();
    await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f]{24}/);

    const items = page.getByTestId("collection-items");
    const add = async (type: string, text: string) => {
      await items.getByTestId("collection-item-type").selectOption(type);
      const picker = items.getByTestId(`picker-${type}`);
      await picker.getByRole("searchbox").fill(text);
      await picker.getByRole("button", { name: new RegExp(text) }).click();
    };
    await add("ARTICLE", article.title);
    await expect(items.getByTestId("collection-item")).toHaveCount(1);
    await add("TOPIC", topic.title);
    await expect(items.getByTestId("collection-item")).toHaveCount(2);
    await add("ARTICLE", draft.title);
    await expect(items.getByTestId("collection-item")).toHaveCount(3);

    await items.getByRole("button", { name: new RegExp(`تقديم: ${topic.title}`) }).click();
    await expect(items.getByTestId("collection-item").first()).toContainText(topic.title);

    // Not on Explore until published.
    const explore = await page.context().newPage();
    await explore.goto("/explore");
    await expect(explore.getByText(title)).toHaveCount(0);

    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("status-message")).toHaveText(/./);

    await explore.reload();
    await settled(explore);
    const section = explore.locator("section", { hasText: title });
    await expect(section.getByText(topic.title)).toBeVisible();
    await expect(section.getByText(article.title)).toBeVisible();
    await expect(section.getByText(draft.title)).toHaveCount(0);
    await explore.close();
  });

  test("an editor can feature an article, and a contributor isn't offered it", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const article = await seedArticle(`مقال ${unique()}`);

    await open(page, `/admin/articles/${article.id}`);
    await page.getByTestId("article-featured-input").check();
    await expect.poll(async () => (await prisma.article.findUnique({ where: { id: article.id } }))?.isFeatured).toBe(true);

    await open(page, "/explore");
    await expect(page.getByTestId("section-selected-articles").getByText(article.title)).toBeVisible();

    await page.context().clearCookies();
    const contributor = await createAccount("CONTRIBUTOR");
    await signInBrowser(page.context(), baseURL!, contributor.sessionToken);
    const own = await seedArticle(`مسودة ${unique()}`, { status: "DRAFT", authorId: contributor.id, assigneeIds: [contributor.id] });
    await open(page, `/admin/articles/${own.id}`);
    await expect(page.getByTestId("article-edit-page")).toBeVisible();
    await expect(page.getByTestId("article-featured")).toHaveCount(0);
  });

  test("a contributor doesn't get the collections section", async ({ page, baseURL }) => {
    await signIn(page, "CONTRIBUTOR", baseURL!);
    await open(page, "/admin");
    await expect(page.getByRole("link", { name: "المجموعات" })).toHaveCount(0);
    await open(page, "/admin/collections/new");
    await expect(page.getByTestId("collection-form")).toHaveCount(0);
  });
});
