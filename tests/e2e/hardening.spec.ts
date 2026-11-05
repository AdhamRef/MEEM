import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { expect, settled, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);

const seedArticle = (overrides: Record<string, unknown> = {}) => {
  const id = unique();
  return prisma.article.create({
    data: { title: `مقال </script><b>${id}`, slug: `فضل-${id}`, excerpt: "مقتطف", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "نص" }] }] }, readingMinutes: 1, status: "PUBLISHED", publishedAt: new Date(), ...overrides },
  });
};
const seedTopic = (overrides: Record<string, unknown> = {}) => {
  const id = unique();
  return prisma.topic.create({ data: { title: `موضوع ${id}`, slug: `topic-${id}`, introduction: "مقدمة", status: "PUBLISHED", publishedAt: new Date(), ...overrides } });
};
const seedVideo = (overrides: Record<string, unknown> = {}) => {
  const id = `h${unique()}00`.slice(0, 11);
  return prisma.video.create({
    data: {
      youtubeVideoId: id,
      kind: "LONG_FORM",
      classification: "LONG_FORM_CANDIDATE",
      reviewedAt: new Date(),
      status: "PUBLISHED",
      publishedAt: new Date(),
      availability: "AVAILABLE",
      title: `مقطع ${id}`,
      channelTitle: "قناة",
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }],
      durationSeconds: 300,
      ytPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
      metadataFetchedAt: new Date(),
      feedKey: Math.floor(Math.random() * 1_000_000),
      ...overrides,
    },
  });
};

async function signIn(page: Page, role: Parameters<typeof createAccount>[0], baseURL: string) {
  const account = await createAccount(role);
  await signInBrowser(page.context(), baseURL, account.sessionToken);
  return account;
}

const robotsOf = (page: Page) => page.locator('meta[name="robots"]').getAttribute("content");

async function jsonLdOf(page: Page) {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts.map((text) => JSON.parse(text) as Record<string, unknown>);
}

test.describe("security headers", () => {
  test("public pages limit what can frame them and what they can load", async ({ request }) => {
    const response = await request.get("/explore");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // Without a referrer, the YouTube player fails with error 153.
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();

    const policy = headers["content-security-policy"] ?? "";
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-src https://www.youtube.com");
  });

  test("the dashboard has a stricter policy, with a fresh nonce each time and no inline scripts", async ({ request }) => {
    const policyOf = async () => (await request.get("/admin", { maxRedirects: 0 })).headers()["content-security-policy"] ?? "";
    const [first, second] = [await policyOf(), await policyOf()];
    expect(first).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(first).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(first).not.toBe(second);
  });

  test("the dashboard runs under its policy, with nothing blocked", async ({ page, baseURL }) => {
    const blocked: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) blocked.push(message.text());
    });
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "المجموعات" }).first()).toBeVisible();
    await page.goto("/admin/articles/new");
    // The editor proves scripts hydrated, since it only exists once they've run.
    await expect(page.locator(".ProseMirror")).toBeVisible();
    expect(blocked).toEqual([]);
  });

  test("public pages run under their policy, with nothing blocked", async ({ page }) => {
    const blocked: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) blocked.push(message.text());
    });
    const video = await seedVideo();
    await page.goto(`/videos/${video.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/explore");
    await settled(page);
    await expect(page.getByTestId("explore-page")).toBeVisible();
    expect(blocked).toEqual([]);
  });

  test("errors don't show internals", async ({ request }) => {
    const response = await request.get("/api/favorites?type=NOT_A_TYPE&ids=x");
    const text = await response.text();
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(text).not.toMatch(/prisma|stack|node_modules|\bat\s+\w+\s+\(/i);
  });

  test("a cross-site request can't delete an account", async ({ request, baseURL }) => {
    const account = await createAccount("USER");
    const response = await request.delete("/api/account", { headers: { origin: "https://evil.example", cookie: `next-auth.session-token=${account.sessionToken}` } });
    expect(response.status()).toBe(403);
    expect(await prisma.user.count({ where: { id: account.id } })).toBe(1);
    expect(baseURL).toBeTruthy();
  });
});

test.describe("search engines", () => {
  test("the sitemap lists public content, and leaves out drafts", async ({ request }) => {
    const article = await seedArticle();
    const draft = await seedArticle({ status: "DRAFT" });

    const response = await request.get("/sitemap/articles.xml");
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain(encodeURIComponent(article.slug));
    expect(xml).not.toContain(encodeURIComponent(draft.slug));

    expect(await (await request.get("/sitemap/pages.xml")).text()).toContain("/privacy");
  });

  test("robots lists each sitemap, and keeps private areas out", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    for (const path of ["/admin", "/api/", "/saved", "/history", "/account"]) expect(text).toContain(`Disallow: ${path}`);
    expect(text).toContain("/sitemap/articles.xml");
    // Every sitemap it names must exist.
    for (const match of text.matchAll(/Sitemap: \S*(\/sitemap\/\w+\.xml)/g)) expect((await request.get(match[1] as string)).status()).toBe(200);
  });

  test("private pages aren't indexed", async ({ page, request }) => {
    for (const path of ["/saved", "/history", "/account", "/interests", "/search", "/auth/signin"]) {
      await page.goto(path);
      await settled(page);
      expect(await robotsOf(page), path).toContain("noindex");
      expect((await request.get(path)).headers()["x-robots-tag"], path).toContain("noindex");
    }
    expect((await request.get("/admin", { maxRedirects: 0 })).headers()["x-robots-tag"]).toContain("noindex");
  });

  test("public pages can be indexed, with a canonical address and sharing details", async ({ page }) => {
    const topic = await seedTopic();
    await page.goto(`/topics/${topic.slug}`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/topics/${topic.slug}$`));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(topic.title));
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  });

  test("an article describes itself, and its title can't break out of the data", async ({ page }) => {
    const article = await seedArticle();
    await page.goto(`/articles/${encodeURIComponent(article.slug)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('b:has-text("' + article.slug.slice(4) + '")')).toHaveCount(0);

    const data = await jsonLdOf(page);
    const entry = data.find((item) => item["@type"] === "Article");
    expect(entry?.headline).toBe(article.title);
    expect(entry?.inLanguage).toBe("ar");
  });

  test("a video describes itself using YouTube's address and real upload date", async ({ page }) => {
    const video = await seedVideo();
    await page.goto(`/videos/${video.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const entry = (await jsonLdOf(page)).find((item) => item["@type"] === "VideoObject");
    expect(entry?.embedUrl).toBe(`https://www.youtube.com/embed/${video.youtubeVideoId}`);
    expect(entry?.uploadDate).toBe("2026-01-01T00:00:00.000Z");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/videos/${video.id}$`));
  });
});

test.describe("privacy and terms", () => {
  test("say what YouTube requires, with working links", async ({ page }) => {
    await page.goto("/privacy");
    const privacy = page.getByTestId("privacy-page");
    await expect(privacy).toContainText("YouTube API");
    await expect(privacy.getByRole("link", { name: "سياسة خصوصية Google" })).toHaveAttribute("href", "https://policies.google.com/privacy");
    await expect(privacy.getByRole("link", { name: "شروط خدمة YouTube" }).first()).toHaveAttribute("href", "https://www.youtube.com/t/terms");
    await expect(privacy.getByRole("link", { name: "إعدادات أمان Google" })).toHaveAttribute("href", /security\.google\.com/);
    await expect(privacy.getByRole("link", { name: "صفحة حسابي" })).toHaveAttribute("href", "/account");
    await expect(page.getByTestId("legal-contact")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);

    await page.goto("/terms");
    await expect(page.getByTestId("terms-page")).toContainText("YouTube");
  });

  test("the footer links to them, except on the feed", async ({ page }) => {
    await page.goto("/explore");
    await settled(page);
    await expect(page.getByTestId("site-footer").getByRole("link", { name: "سياسة الخصوصية" })).toHaveAttribute("href", "/privacy");
    await page.goto("/");
    await expect(page.getByTestId("site-footer")).toHaveCount(0);
  });

  test("the account menu links to them too", async ({ page }) => {
    await page.goto("/explore");
    await settled(page);
    await page.getByTestId("account-menu").locator("visible=true").click();
    await expect(page.getByRole("menuitem", { name: "سياسة الخصوصية" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("menuitem", { name: "شروط الاستخدام" })).toHaveAttribute("href", "/terms");
  });
});

// A context from the browser fixture has none of the shared setup, so it's a true first visit.
test.describe("first-visit privacy notice", () => {
  test("appears once, blocks nothing, and stays gone", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: "ar" });
    const page = await context.newPage();
    await page.goto("/explore");
    await settled(page);
    const notice = page.getByTestId("privacy-notice");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link")).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The page beneath it still works.
    await page.getByTestId("explore-category").first().click();
    await expect(page).toHaveURL(/\/topics/);

    await page.getByTestId("privacy-notice-dismiss").click();
    await expect(notice).toHaveCount(0);
    await page.goto("/explore");
    await settled(page);
    await expect(page.getByTestId("explore-page")).toBeVisible();
    await expect(page.getByTestId("privacy-notice")).toHaveCount(0);
    await context.close();
  });

  test("is part of the page, so it can't be in front of a player", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: "ar" });
    const page = await context.newPage();
    await page.goto("/explore");
    await settled(page);
    const position = await page.getByTestId("privacy-notice").evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe("static");
    await context.close();
  });
});

test.describe("your account", () => {
  test("a guest gets a real page, with signing in offered", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("link", { name: "تسجيل الدخول" }).last()).toHaveAttribute("href", /\/auth\/signin/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("deleting asks first, removes the account, and signs out", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    await page.goto("/account");
    await expect(page.getByTestId("account-page")).toContainText(account.email);

    await page.getByTestId("account-delete").click();
    const dialog = page.getByTestId("confirm-dialog");
    await dialog.getByRole("button", { name: "إلغاء" }).click();
    expect(await prisma.user.count({ where: { id: account.id } })).toBe(1);

    await page.getByTestId("account-delete").click();
    await page.getByTestId("confirm-yes").click();
    await expect.poll(() => prisma.user.count({ where: { id: account.id } })).toBe(0);
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/?$`));
    expect(await prisma.session.count({ where: { userId: account.id } })).toBe(0);
  });

  test("the super admin isn't offered it, and the server refuses it", async ({ page, baseURL }) => {
    const account = await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto("/account");
    await expect(page.getByTestId("account-delete-unavailable")).toBeVisible();
    await expect(page.getByTestId("account-delete")).toHaveCount(0);

    const status = await page.evaluate(async () => (await fetch("/api/account", { method: "DELETE" })).status);
    expect(status).toBe(403);
    expect(await prisma.user.count({ where: { id: account.id } })).toBe(1);
  });
});

test.describe("no dead controls", () => {
  async function checkPage(page: Page, path: string, visited: Map<string, number>) {
    await page.goto(path);
    await settled(page);
    await expect(page.locator("main, #admin-content").first()).toBeVisible();

    const links = await page.locator('a[href]:visible').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
    expect(links.filter((href) => href === "#" || href === "" || href.startsWith("javascript:")), `placeholder link on ${path}`).toEqual([]);

    for (const href of links.filter((link) => link.startsWith("/"))) {
      const key = href.split("#")[0] as string;
      if (!visited.has(key)) visited.set(key, (await page.request.get(key, { maxRedirects: 5 })).status());
      expect(visited.get(key), `${key}, linked from ${path}`).toBeLessThan(400);
    }

    const unnamed = await page.locator("button:visible").evaluateAll((buttons) => buttons.filter((button) => !(button.textContent?.trim() || button.getAttribute("aria-label") || button.getAttribute("title"))).length);
    expect(unnamed, `unnamed button on ${path}`).toBe(0);
    await expect(page.locator('[data-nav-item="unavailable"]')).toHaveCount(0);
  }

  test("every link a guest can see leads somewhere, on every main page", async ({ page }) => {
    test.setTimeout(240_000);
    const visited = new Map<string, number>();
    const topic = await seedTopic();
    for (const path of ["/explore", "/topics", `/topics/${topic.slug}`, "/libraries", "/playlists", "/search", "/saved", "/history", "/account", "/interests", "/privacy", "/terms"]) {
      await checkPage(page, path, visited);
    }
  });

  test("every link an admin can see in the dashboard leads somewhere", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await signIn(page, "SUPER_ADMIN", baseURL!);
    const visited = new Map<string, number>();
    for (const path of ["/admin", "/admin/shorts", "/admin/youtube-importer", "/admin/channels", "/admin/articles", "/admin/topics", "/admin/categories", "/admin/libraries", "/admin/playlists", "/admin/resources", "/admin/collections", "/admin/users", "/admin/audit-logs", "/admin/settings", "/admin/youtube-status"]) {
      await checkPage(page, path, visited);
    }
  });

  test("temporary and development pages don't exist in production", async ({ request }) => {
    test.skip(process.env.E2E_SERVER !== "production", "These only return 404 on a production build.");
    expect((await request.get("/spike/feed")).status()).toBe(404);
    expect((await request.get("/design-system")).status()).toBe(404);
  });
});
