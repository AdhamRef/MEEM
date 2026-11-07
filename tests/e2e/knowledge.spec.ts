import { randomUUID } from "node:crypto";
import { FEED_IMMERSIVE_OVERLAY } from "../../src/config/feed";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { SKIPPED_FIRST_VISIT } from "./support/seed-feed";
import { expect, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);
const png = () => sharp({ create: { width: 320, height: 200, channels: 3, background: "#335577" } }).png().toBuffer();

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

async function seedArticle(overrides: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.article.create({
    data: {
      title: `مقال الاختبار ${id}`,
      slug: `article-${id}`,
      excerpt: "مقتطف قصير للمقال",
      body: { type: "doc", content: [heading(2, "القسم الأول"), paragraph("فقرة أولى."), heading(2, "القسم الثاني"), paragraph("فقرة ثانية.")] },
      headings: [
        { anchor: "القسم-الأول", level: 2, text: "القسم الأول" },
        { anchor: "القسم-الثاني", level: 2, text: "القسم الثاني" },
      ],
      readingMinutes: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      ...overrides,
    },
  });
}

async function seedTopic(overrides: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.topic.create({ data: { title: `موضوع ${id}`, slug: `topic-${id}`, introduction: "مقدمة الموضوع", status: "PUBLISHED", ...overrides } });
}

async function seedLibrary(overrides: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.library.create({ data: { name: `مكتبة ${id}`, slug: `library-${id}`, description: "وصف المكتبة", introduction: "مقدمة تحريرية للمكتبة", status: "PUBLISHED", ...overrides } });
}

async function seedResource(overrides: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.externalResource.create({ data: { title: `مصدر ${id}`, slug: `resource-${id}`, sourceName: "موقع خارجي", url: `https://example.org/${id}`, description: "وصف المصدر", status: "PUBLISHED", ...overrides } });
}

async function seedShort(overrides: Record<string, unknown> = {}) {
  const id = `k${unique()}00`.slice(0, 11);
  return prisma.video.create({
    data: {
      youtubeVideoId: id,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      reviewedAt: new Date(),
      status: "PUBLISHED",
      publishedAt: new Date(),
      availability: "AVAILABLE",
      title: `مقطع ذو صلة ${id}`,
      channelTitle: "قناة الاختبار",
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }],
      durationSeconds: 40,
      metadataFetchedAt: new Date(),
      feedKey: Math.floor(Math.random() * 1_000_000),
      ...overrides,
    },
  });
}

async function signIn(page: Page, role: Parameters<typeof createAccount>[0], baseURL: string) {
  const account = await createAccount(role);
  await signInBrowser(page.context(), baseURL, account.sessionToken);
  return account;
}

async function axeViolations(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("writing and publishing an article", () => {
  test("a volunteer can draft, format, preview, and publish using only the editor", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(page, "ADMIN", baseURL!);
    const title = `مقال من المحرر ${unique()}`;

    await page.goto("/admin/articles");
    await page.getByTestId("admin-create").click();
    await page.waitForURL("**/admin/articles/new");

    await page.getByTestId("article-title").fill(title);
    await page.getByTestId("article-excerpt").fill("مقتطف كتبه المتطوع");

    const body = page.getByTestId("editor-content");
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute("dir", "rtl");
    await body.click();

    await page.getByTestId("tool-h2").click();
    await page.keyboard.type("العنوان الأول");
    await page.keyboard.press("Enter");
    await page.keyboard.type("فقرة عادية ثم ");
    await page.getByTestId("tool-bold").click();
    await page.keyboard.type("نص عريض");
    await page.getByTestId("tool-bold").click();
    await page.keyboard.press("Enter");

    await page.getByTestId("tool-h2").click();
    await page.keyboard.type("العنوان الثاني");
    await page.keyboard.press("Enter");

    await page.getByTestId("tool-h3").click();
    await page.keyboard.type("عنوان فرعي");
    await page.keyboard.press("Enter");

    await page.getByTestId("tool-quote").click();
    await page.keyboard.type("نص مقتبس");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.getByTestId("tool-bullet").click();
    await page.keyboard.type("عنصر في قائمة");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    // A footnote, entered through its own dialog.
    await page.keyboard.type("نص عليه حاشية");
    await page.getByTestId("tool-footnote").click();
    await page.getByTestId("footnote-input").fill("هذه حاشية توضيحية");
    await page.getByTestId("footnote-apply").click();
    await expect(page.getByTestId("footnote-dialog")).toHaveCount(0);
    await expect(body).toBeFocused();
    await page.keyboard.press("Enter");

    // A link, through its dialog, which rejects an unsafe address.
    await page.keyboard.type("رابط");
    await page.keyboard.press("Shift+Home");
    // The selection is what the link will wrap, so confirm it before opening the dialog.
    await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toBe("رابط");
    await page.getByTestId("tool-link").click();
    await page.getByTestId("link-input").fill("javascript:alert(1)");
    await page.getByTestId("link-apply").click();
    await expect(page.getByTestId("link-dialog").getByRole("alert")).toBeVisible();
    await page.getByTestId("link-input").fill("https://example.org/page");
    await page.getByTestId("link-apply").click();
    await expect(page.getByTestId("link-dialog")).toHaveCount(0);
    await expect(body).toBeFocused();
    // The cursor sits after the link, so writing continues without replacing it.
    await page.keyboard.type(" وبعده نص");
    await page.keyboard.press("Enter");

    // An image with a caption, uploaded and processed by the server.
    await page.getByTestId("editor-image-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: await png() });
    const figure = page.getByTestId("editor-figure");
    await expect(figure).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("figure-caption").fill("تعليق الصورة");
    await page.getByTestId("figure-alt").fill("وصف الصورة");

    // Preview shows the same rendering readers get.
    await page.getByTestId("tab-preview").click();
    const preview = page.getByTestId("article-preview");
    await expect(preview.getByRole("heading", { name: "العنوان الأول" })).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("نص عريض");
    await expect(preview.locator("blockquote")).toHaveText("نص مقتبس");
    await page.getByTestId("tab-write").click();
    await expect(body).toContainText("العنوان الأول");

    await page.getByTestId("article-save").click();
    await page.waitForURL(/\/admin\/articles\/[a-f\d]{24}$/);
    await expect(page.getByTestId("article-unsaved")).toHaveCount(0);

    // It's a draft, so the public can't see it yet.
    const article = await prisma.article.findFirstOrThrow({ where: { title } });
    expect(article.status).toBe("DRAFT");
    expect((await page.request.get(`/articles/${encodeURIComponent(article.slug)}`)).status()).toBe(404);

    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("action-unpublish")).toBeVisible();

    // The public page, as a guest.
    await page.context().clearCookies();
    const response = await page.goto(`/articles/${encodeURIComponent(article.slug)}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const reading = page.getByTestId("article-body");
    await expect(reading.getByRole("heading", { name: "العنوان الثاني" })).toHaveAttribute("id", "العنوان-الثاني");
    await expect(reading.locator("h3")).toHaveText("عنوان فرعي");
    await expect(reading.locator("strong")).toHaveText("نص عريض");
    await expect(reading.locator("blockquote")).toHaveText("نص مقتبس");
    await expect(reading.locator("ul li")).toHaveText("عنصر في قائمة");
    await expect(page.getByTestId("article-footnotes")).toContainText("هذه حاشية توضيحية");

    const link = reading.getByRole("link", { name: "رابط" });
    await expect(link).toHaveAttribute("href", "https://example.org/page");
    await expect(link).toHaveAttribute("rel", /noopener/);

    const image = reading.locator("figure img");
    await expect(image).toHaveAttribute("alt", "وصف الصورة");
    await expect(reading.locator("figcaption")).toHaveText("تعليق الصورة");
    const naturalWidth = await image.evaluate(async (element) => {
      const img = element as HTMLImageElement;
      await img.decode();
      return img.naturalWidth;
    });
    expect(naturalWidth).toBe(320);
  });

  test("an empty article can't be published, and says why", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const article = await seedArticle({ status: "DRAFT", publishedAt: null, body: { type: "doc", content: [{ type: "paragraph" }] } });
    await page.goto(`/admin/articles/${article.id}`);
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("status-message")).toContainText("لا يمكن نشر مقال بلا محتوى");
  });

  test("publishing waits until changes are saved", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const article = await seedArticle({ status: "DRAFT", publishedAt: null });
    await page.goto(`/admin/articles/${article.id}`);
    await expect(page.getByTestId("action-publish")).toBeEnabled();
    await page.getByTestId("article-title").fill("عنوان جديد لم يُحفظ");
    await expect(page.getByTestId("action-publish")).toBeDisabled();
    await page.getByTestId("article-save").click();
    await expect(page.getByTestId("article-message")).toHaveText("تم الحفظ.");
    await expect(page.getByTestId("action-publish")).toBeEnabled();
  });

  test("attaches a topic and a Short with search, and they appear for readers", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const topic = await seedTopic();
    const short = await seedShort({ titleSearch: `مقطع مميز ${unique()}` });
    const article = await seedArticle();
    await page.goto(`/admin/articles/${article.id}`);

    const topicPicker = page.getByTestId("content-picker-TOPIC");
    // Seeded topics have no search field, so the list of recent items shows them.
    await topicPicker.getByRole("searchbox").click();
    await topicPicker.getByRole("button", { name: topic.title }).click();

    const videoPicker = page.getByTestId("content-picker-VIDEO");
    await videoPicker.getByRole("searchbox").fill(short.titleSearch);
    await videoPicker.getByRole("button", { name: short.title }).click();

    await page.getByTestId("article-save").click();
    await expect(page.getByTestId("article-message")).toHaveText("تم الحفظ.");

    await page.goto(`/articles/${article.slug}`);
    await expect(page.getByTestId("section-related-shorts").getByText(short.title)).toBeVisible();
    await expect(page.getByTestId("section-related-shorts").getByText("المصدر: YouTube")).toBeVisible();
    await expect(page.getByTestId("section-related-topics").getByText(topic.title)).toBeVisible();
  });

  test("asks before deleting, and cancelling keeps the article", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const article = await seedArticle();
    await page.goto(`/admin/articles/${article.id}`);

    await page.getByTestId("action-delete").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "إلغاء" }).click();
    expect(await prisma.article.count({ where: { id: article.id } })).toBe(1);

    await page.getByTestId("action-delete").click();
    await page.getByTestId("confirm-yes").click();
    await page.waitForURL("**/admin/articles");
    expect(await prisma.article.count({ where: { id: article.id } })).toBe(0);
  });
});

test.describe("roles in the dashboard", () => {
  test("a contributor can write but sees no way to publish, and can't open someone else's draft", async ({ page, baseURL }) => {
    const account = await signIn(page, "CONTRIBUTOR", baseURL!);
    const mine = await seedArticle({ status: "DRAFT", publishedAt: null, authorId: account.id });
    const theirs = await seedArticle({ status: "DRAFT", publishedAt: null });

    await page.goto(`/admin/articles/${mine.id}`);
    await expect(page.getByTestId("article-form")).toBeVisible();
    await expect(page.getByTestId("action-publish")).toHaveCount(0);
    await expect(page.getByTestId("action-delete")).toHaveCount(0);

    await page.goto("/admin/articles");
    await expect(page.getByTestId("admin-list")).toContainText(mine.title);
    await expect(page.getByTestId("admin-list")).not.toContainText(theirs.title);

    await page.goto(`/admin/articles/${theirs.id}`);
    await expect(page.getByRole("heading", { name: "ليست لديك صلاحية الوصول" })).toBeVisible();
    await expect(page.getByTestId("article-form")).toHaveCount(0);
    await expect(page.getByText(theirs.title)).toHaveCount(0);
  });

  test("a contributor's navigation offers only what they can use", async ({ page, baseURL }) => {
    await signIn(page, "CONTRIBUTOR", baseURL!);
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "تنقل لوحة التحكم" });
    await expect(nav.getByRole("link", { name: "المقالات" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "الموضوعات" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "المكتبات" })).toHaveCount(0);
  });

  test("a reviewer can read and comment, but not edit or publish", async ({ page, baseURL }) => {
    await signIn(page, "SCIENTIFIC_REVIEWER", baseURL!);
    const article = await seedArticle({ status: "DRAFT", publishedAt: null });
    await page.goto(`/admin/articles/${article.id}`);

    await expect(page.getByTestId("article-readonly")).toBeVisible();
    await expect(page.getByTestId("article-form")).toHaveCount(0);
    await expect(page.getByTestId("action-publish")).toHaveCount(0);

    await page.getByTestId("note-input").fill("يرجى مراجعة المصدر");
    await page.getByTestId("note-add").click();
    await expect(page.getByTestId("review-note")).toContainText("يرجى مراجعة المصدر");
    await expect(page.getByTestId("action-publish")).toHaveCount(0);
  });

  test("non-staff are refused, and guests go to sign-in", async ({ page, baseURL }) => {
    await page.goto("/admin/articles");
    await expect(page).toHaveURL(/\/auth\/signin/);

    await signIn(page, "USER", baseURL!);
    await page.goto("/admin/articles");
    await expect(page.getByText("ليست لديك صلاحية الوصول")).toBeVisible();
    await expect(page.getByTestId("admin-list")).toHaveCount(0);
  });

  test("private dashboard pages are never indexed", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const response = await page.goto("/admin/articles");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  });
});

test.describe("managing topics and libraries", () => {
  test("an editor builds a topic, links content to it, and an admin publishes it", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await signIn(page, "EDITOR", baseURL!);
    const title = `موضوع جديد ${unique()}`;
    const article = await seedArticle();

    await page.goto("/admin/topics/new");
    await page.getByLabel("العنوان").fill(title);
    await page.getByLabel("المقدمة").fill("مقدمة كتبها المحرر");
    await page.getByTestId("form-save").click();
    await page.waitForURL(/\/admin\/topics\/[a-f\d]{24}$/);

    // Editors don't have the publish permission by default.
    await expect(page.getByTestId("action-publish")).toHaveCount(0);

    const links = page.getByTestId("links-topic.article");
    await expect(links.getByText("لا شيء مرتبط بعد.")).toBeVisible();
    await links.getByRole("searchbox").click();
    await links.getByRole("button", { name: article.title }).click();
    await expect(links.getByTestId("link-row")).toContainText(article.title);

    const topic = await prisma.topic.findFirstOrThrow({ where: { title } });
    expect((await page.request.get(`/topics/${encodeURIComponent(topic.slug)}`)).status()).toBe(404);

    await signIn(page, "ADMIN", baseURL!);
    await page.goto(`/admin/topics/${topic.id}`);
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("action-unpublish")).toBeVisible();

    await page.goto(`/topics/${encodeURIComponent(topic.slug)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("section-articles").getByText(article.title)).toBeVisible();
  });

  test("a form explains what's wrong instead of failing silently", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    await page.goto("/admin/resources/new");
    await page.getByTestId("form-save").click();
    await expect(page.getByText("هذا الحقل مطلوب.").first()).toBeVisible();

    await page.getByLabel("العنوان").fill("مصدر");
    await page.getByLabel("اسم المصدر").fill("موقع");
    await page.getByLabel("الرابط الخارجي").fill("javascript:alert(1)");
    await page.getByTestId("form-save").click();
    await expect(page.getByText("أدخل رابطًا صحيحًا")).toBeVisible();
    expect(page.url()).toContain("/new");
  });

  test("a duplicate external link is reported by the server", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const existing = await seedResource();
    await page.goto("/admin/resources/new");
    await page.getByLabel("العنوان").fill("مصدر مكرر");
    await page.getByLabel("اسم المصدر").fill("موقع");
    await page.getByLabel("الرابط الخارجي").fill(existing.url);
    await page.getByTestId("form-save").click();
    await expect(page.getByTestId("form-message")).toContainText("موجود بالفعل");
  });

  test("a library's featured item leads its page", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const library = await seedLibrary();
    const article = await seedArticle();
    await page.goto(`/admin/libraries/${library.id}`);

    const links = page.getByTestId("links-library.article");
    await links.getByRole("searchbox").click();
    await links.getByRole("button", { name: article.title }).click();
    await expect(links.getByTestId("link-row")).toContainText(article.title);
    await links.getByRole("button", { name: /إبرازه/ }).click();
    await expect(links.getByRole("button", { name: /إزالته من المختارات/ })).toBeVisible();

    await page.goto(`/libraries/${library.slug}`);
    await expect(page.getByTestId("section-featured").getByText(article.title)).toBeVisible();
    await expect(page.getByTestId("section-articles")).toHaveCount(0);
    await expect(page.getByTestId("library-introduction")).toHaveText("مقدمة تحريرية للمكتبة");
  });
});

test.describe("uploads", () => {
  test("rejects a file that only claims to be an image, and explains", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    await page.goto("/admin/resources/new");
    await page.getByTestId("image-field-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
    await expect(page.getByTestId("image-field-error")).toContainText("نوع الملف غير مدعوم");
    await expect(page.getByTestId("image-field-preview")).toHaveCount(0);
  });

  test("accepts a real image, and it's served safely", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    await page.goto("/admin/resources/new");
    await page.getByTestId("image-field-input").setInputFiles({ name: "../../evil name.png", mimeType: "image/png", buffer: await png() });
    const preview = page.getByTestId("image-field-preview");
    await expect(preview).toBeVisible({ timeout: 30_000 });

    const src = await preview.getAttribute("src");
    expect(src).toMatch(/^\/media\/images\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.webp$/);
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("refuses guests, non-staff, and other sites, directly", async ({ page, request, baseURL }) => {
    const multipart = { file: { name: "a.png", mimeType: "image/png", buffer: await png() } };
    expect((await request.post("/api/uploads", { headers: { Origin: baseURL! }, multipart })).status()).toBe(401);
    expect((await request.post("/api/uploads", { multipart })).status()).toBe(403);

    await signIn(page, "USER", baseURL!);
    expect((await page.request.post("/api/uploads", { headers: { Origin: baseURL! }, multipart })).status()).toBe(403);

    await signIn(page, "EDITOR", baseURL!);
    expect((await page.request.post("/api/uploads", { headers: { Origin: "https://evil.example" }, multipart })).status()).toBe(403);
    expect((await page.request.post("/api/uploads", { headers: { Origin: baseURL!, "Content-Type": "text/plain" }, data: "x" })).status()).toBe(400);
  });

  test("can't read anything but uploads through the media route", async ({ request }) => {
    for (const path of ["/media/..%2f..%2f.env", "/media/images/2026/01/not-a-file.webp", "/media/%2e%2e/%2e%2e/package.json", "/media/images/2026/01/00000000-0000-0000-0000-000000000000.webp"]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});

test.describe("reading an article", () => {
  test("offers contents that work in Arabic, dates, and sources", async ({ page }, testInfo) => {
    const article = await seedArticle({ bylineName: "كاتب الاختبار", sources: [{ title: "كتاب مرجعي", author: "مؤلف", url: "https://example.org/book", note: null }] });
    await page.goto(`/articles/${article.slug}`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("بقلم")).toBeVisible();
    await expect(page.getByTestId("article-updated")).toContainText("آخر تحديث");

    const sources = page.getByTestId("article-sources");
    await expect(sources.getByText("كتاب مرجعي")).toBeVisible();
    await expect(sources.getByRole("link")).toHaveAttribute("rel", /noopener/);

    if (testInfo.project.name === "mobile") {
      await page.getByTestId("contents-mobile").locator("summary").click();
      await page.getByTestId("contents-mobile").getByRole("link", { name: "القسم الثاني" }).click();
    } else {
      await page.getByTestId("contents-desktop").getByRole("link", { name: "القسم الثاني" }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${encodeURIComponent("القسم-الثاني")}$`));
    await expect(page.getByRole("heading", { name: "القسم الثاني" })).toBeInViewport();
  });

  test("hides the contents when there's nothing to navigate, and shows the progress bar", async ({ page }) => {
    const long = Array.from({ length: 60 }, () => paragraph("فقرة طويلة لاختبار شريط التقدم في القراءة داخل صفحة المقال. ".repeat(5)));
    const article = await seedArticle({ body: { type: "doc", content: long }, headings: [] });
    await page.goto(`/articles/${article.slug}`);
    await expect(page.getByTestId("contents-mobile")).toHaveCount(0);
    await expect(page.getByTestId("contents-desktop")).toHaveCount(0);

    const bar = page.getByTestId("reading-progress").locator("div");
    const width = () => bar.evaluate((element) => element.getBoundingClientRect().width);
    const before = await width();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await expect.poll(width).toBeGreaterThan(before);
  });

  test("neutralises hostile content that reached the database some other way", async ({ page }) => {
    const article = await seedArticle({
      title: '<img src=x onerror="window.__pwned=1">',
      excerpt: "<script>window.__pwned=1</script>",
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: '<img src=x onerror="window.__pwned=1">' }] },
          { type: "paragraph", attrs: { onclick: "window.__pwned=1" }, content: [{ type: "text", text: "رابط خبيث", marks: [{ type: "link", attrs: { href: "javascript:window.__pwned=1" } }] }] },
          { type: "script", content: [{ type: "text", text: "window.__pwned=1" }] },
          { type: "figure", attrs: { src: "javascript:window.__pwned=1", alt: "x" } },
          { type: "figure", attrs: { src: "https://cdn.example/a.webp", alt: '"><script>window.__pwned=1</script>', onerror: "window.__pwned=1" } },
        ],
      },
    });
    await page.route("https://cdn.example/**", (route) => route.abort());
    await page.goto(`/articles/${article.slug}`);

    const body = page.getByTestId("article-body");
    await expect(body.getByText("رابط خبيث")).toBeVisible();
    await expect(body.getByRole("link", { name: "رابط خبيث" })).toHaveCount(0);
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body.locator("[onclick], [onerror]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("onerror");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("a guest gets a link to the optional sign-in for saving, with no dialog", async ({ page }) => {
    const article = await seedArticle();
    await page.goto(`/articles/${article.slug}`);
    await expect(page.getByTestId("save-signin")).toHaveAttribute("href", /\/auth\/signin/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a signed-in reader can save, and it stays saved", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const article = await seedArticle();
    await page.goto(`/articles/${article.slug}`);

    const save = page.getByTestId("article-actions").getByTestId("save");
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => prisma.favorite.count({ where: { userId: account.id, entityId: article.id } })).toBe(1);

    await page.reload();
    await expect(page.getByTestId("article-actions").getByTestId("save")).toHaveAttribute("aria-pressed", "true");
  });

  test("a video's page lists the articles linked to it", async ({ page }) => {
    const short = await seedShort();
    const article = await seedArticle();
    await prisma.articleVideo.create({ data: { articleId: article.id, videoId: short.id } });
    await page.goto(`/videos/${short.id}`);
    await expect(page.getByTestId("video-articles").getByText(article.title)).toBeVisible();
  });

  test("a CTA to an article leads to it", async ({ page }) => {
    const article = await seedArticle();
    const short = await seedShort({ cta: { type: "INTERNAL_ARTICLE", targetId: article.id } });
    await page.goto(`/videos/${short.id}`);
    const cta = page.getByTestId("video-cta");
    await expect(cta).toBeVisible();
    // On a phone a stuck Short leaves only a narrow band below it, so this scrolls as a person would.
    await cta.evaluate((element) => {
      const frameBottom = document.querySelector("[data-testid=\"video-frame\"]")!.getBoundingClientRect().bottom;
      window.scrollBy({ top: element.getBoundingClientRect().top - frameBottom - 8, behavior: "instant" });
    });
    await cta.click();
    await expect(page).toHaveURL(new RegExp(`/articles/${article.slug}$`));
    await expect(page.getByTestId("article-page")).toBeVisible();
  });
});

test.describe("opening a related Short from an article", () => {
  test("opens over the article with one player, and returns to the same place", async ({ page }) => {
    const short = await seedShort();
    const article = await seedArticle();
    await prisma.articleVideo.create({ data: { articleId: article.id, videoId: short.id } });
    await page.goto(`/articles/${article.slug}`);

    await page.getByTestId("video-tile").click();
    await expect(page).toHaveURL(new RegExp(`/shorts/${short.id}$`));
    const modal = page.getByTestId("video-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("article-page")).toBeAttached();

    const frame = modal.locator("iframe");
    await expect(frame).toHaveCount(1);
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect(frame).toHaveAttribute("data-video-id", short.youtubeVideoId);

    const covered = await frame.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const points = [0.1, 0.5, 0.9].flatMap((x) => [0.1, 0.5, 0.9].map((y) => [box.left + box.width * x, box.top + box.height * y] as const));
      return points.filter(([x, y]) => document.elementFromPoint(x, y) !== element).length;
    });
    // Our controls sit in front of video pages only by the owner's decision of 2026-11-06, under this
    // switch. Turning it off for the compliance audit makes this strict again by itself.
    if (!FEED_IMMERSIVE_OVERLAY) expect(covered).toBe(0);

    const box = await frame.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(200);

    await page.getByTestId("video-modal-close").click();
    await expect(modal).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/articles/${article.slug}$`));
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("Escape closes it too", async ({ page }) => {
    const short = await seedShort();
    const article = await seedArticle();
    await prisma.articleVideo.create({ data: { articleId: article.id, videoId: short.id } });
    await page.goto(`/articles/${article.slug}`);
    await page.getByTestId("video-tile").click();
    await expect(page.getByTestId("video-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("video-modal")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/articles/${article.slug}$`));
  });

  test("opening the address directly shows the full feed, with no modal", async ({ page }) => {
    const short = await seedShort();
    await page.addInitScript(() => window.localStorage.setItem("preferences.v2", JSON.stringify({ version: 2, selectedTopicIds: [], channelChoices: {}, onboarding: "skipped" })));
    const response = await page.goto(`/shorts/${short.id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("video-modal")).toHaveCount(0);
  });
});

test.describe("topic pages", () => {
  test("show only sections with content", async ({ page }) => {
    const topic = await seedTopic();
    const article = await seedArticle();
    await prisma.articleTopic.create({ data: { articleId: article.id, topicId: topic.id } });
    await page.goto(`/topics/${topic.slug}`);

    await expect(page.getByTestId("section-articles")).toBeVisible();
    for (const hidden of ["shorts", "videos", "resources", "children", "related", "complementary", "libraries"]) {
      await expect(page.getByTestId(`section-${hidden}`), hidden).toHaveCount(0);
    }
  });

  test("say plainly when nothing is linked yet", async ({ page }) => {
    const topic = await seedTopic();
    await page.goto(`/topics/${topic.slug}`);
    await expect(page.getByText("لم يُربط بهذا الموضوع محتوى منشور بعد.")).toBeVisible();
  });

  test("connect to parents, children, relations, libraries, and resources", async ({ page }) => {
    const parent = await seedTopic();
    const topic = await seedTopic({ parentId: parent.id });
    const child = await seedTopic({ parentId: topic.id });
    const related = await seedTopic();
    const library = await seedLibrary();
    const resource = await seedResource();
    const [fromTopicId, toTopicId] = topic.id < related.id ? [topic.id, related.id] : [related.id, topic.id];
    await prisma.topicRelation.create({ data: { fromTopicId, toTopicId, type: "RELATED" } });
    await prisma.libraryTopic.create({ data: { libraryId: library.id, topicId: topic.id } });
    await prisma.resourceTopic.create({ data: { resourceId: resource.id, topicId: topic.id } });

    await page.goto(`/topics/${topic.slug}`);
    await expect(page.getByRole("link", { name: parent.title })).toBeVisible();
    await expect(page.getByTestId("section-children").getByText(child.title)).toBeVisible();
    await expect(page.getByTestId("section-related").getByText(related.title)).toBeVisible();
    await expect(page.getByTestId("section-libraries").getByText(library.name)).toBeVisible();
    await expect(page.getByTestId("section-resources").getByText("مصدر خارجي")).toBeVisible();

    await page.getByTestId("section-related").getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(related.title);
  });

  test("the destination in the navigation works, and lists published topics but not drafts", async ({ page }) => {
    const published = await seedTopic();
    const draft = await seedTopic({ status: "DRAFT" });

    await page.addInitScript((value) => window.localStorage.setItem("preferences.v2", value), SKIPPED_FIRST_VISIT);
    await page.goto("/");
    await page.locator('nav:visible a[href="/topics"]').first().click();
    await expect(page).toHaveURL(/\/topics$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الموضوعات");
    await expect(page.getByTestId("topic-card").filter({ hasText: published.title })).toHaveCount(1);
    await expect(page.getByTestId("topic-card").filter({ hasText: draft.title })).toHaveCount(0);
  });
});

test.describe("libraries and resources", () => {
  test("a library shows its introduction and sub-libraries, and is reachable from the list", async ({ page }) => {
    const library = await seedLibrary({ isFeatured: true, displayOrder: 0 });
    const child = await seedLibrary({ parentId: library.id });
    await page.goto("/libraries");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("المكتبات");
    await page.getByTestId("library-card").filter({ hasText: library.name }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(library.name);
    await expect(page.getByTestId("section-children").getByText(child.name)).toBeVisible();
    await expect(page.getByText("لم يُربط بهذه المكتبة محتوى منشور بعد.")).toHaveCount(0);
  });

  test("an external resource is clearly marked, and links out safely", async ({ page }) => {
    const resource = await seedResource();
    await page.goto(`/resources/${resource.slug}`);
    await expect(page.getByTestId("external-badge")).toHaveText("مصدر خارجي");
    await expect(page.getByText("لا تستضيفه المنصة")).toBeVisible();

    const link = page.getByTestId("resource-open");
    await expect(link).toHaveAttribute("href", resource.url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("anything unpublished or archived returns 404", async ({ request }) => {
    const items = [
      `/articles/${(await seedArticle({ status: "DRAFT" })).slug}`,
      `/articles/${(await seedArticle({ isArchived: true })).slug}`,
      `/topics/${(await seedTopic({ status: "DRAFT" })).slug}`,
      `/topics/${(await seedTopic({ isArchived: true })).slug}`,
      `/libraries/${(await seedLibrary({ status: "DRAFT" })).slug}`,
      `/resources/${(await seedResource({ status: "DRAFT" })).slug}`,
      "/articles/does-not-exist",
    ];
    for (const path of items) expect((await request.get(path)).status(), path).toBe(404);
  });
});

test("a malformed address reveals nothing about the server", async ({ request }) => {
  // Next.js rejects it before any application code runs, with a plain error and no details.
  const response = await request.get("/topics/%E0%A4%A");
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(await response.text()).not.toMatch(/node_modules|URIError|DecodeError/);
});

test.describe("layout and accessibility", () => {
  async function connectedArticle() {
    const short = await seedShort();
    const topic = await seedTopic();
    const article = await seedArticle({ sources: [{ title: "مرجع", author: null, url: "https://example.org/a", note: null }] });
    await prisma.articleVideo.create({ data: { articleId: article.id, videoId: short.id } });
    await prisma.articleTopic.create({ data: { articleId: article.id, topicId: topic.id } });
    return { article, topic };
  }

  test("public pages fit a phone and have no accessibility violations", async ({ page }) => {
    const { article, topic } = await connectedArticle();
    const library = await seedLibrary();
    const resource = await seedResource();
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of [`/articles/${article.slug}`, `/topics/${topic.slug}`, "/topics", "/libraries", `/libraries/${library.slug}`, `/resources/${resource.slug}`]) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      expect(await axeViolations(page), path).toEqual([]);
    }
  });

  test("dashboard screens fit a phone and have no accessibility violations", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await signIn(page, "ADMIN", baseURL!);
    const article = await seedArticle();
    const topic = await seedTopic();
    const library = await seedLibrary();
    const resource = await seedResource();
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of ["/admin/articles", "/admin/articles/new", `/admin/articles/${article.id}`, "/admin/topics", `/admin/topics/${topic.id}`, "/admin/libraries", `/admin/libraries/${library.id}`, "/admin/resources", `/admin/resources/${resource.id}`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      expect(await axeViolations(page), path).toEqual([]);
    }
  });

  test("the video modal has no accessibility violations", async ({ page }) => {
    const { article } = await connectedArticle();
    await page.goto(`/articles/${article.slug}`);
    await page.getByTestId("video-tile").click();
    await expect(page.getByTestId("video-modal")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("keeps screenshots for visual review", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Reviewed once, at desktop width");
    const { article, topic } = await connectedArticle();
    await page.goto(`/articles/${article.slug}`);
    await page.screenshot({ path: "test-results/screens/article.png", fullPage: true });
    await page.goto(`/topics/${topic.slug}`);
    await page.screenshot({ path: "test-results/screens/topic.png", fullPage: true });
  });
});
