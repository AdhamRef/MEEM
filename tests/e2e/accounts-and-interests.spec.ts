import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, selectedTopicTitles, signInBrowser } from "./support/accounts";
import { expect, test } from "./support/test";

const accountMenu = (page: Page) => page.locator('[data-testid="account-menu"]:visible');
const interest = (page: Page, title: string) => page.getByTestId("topic-tile").filter({ hasText: title });

/** Chooses topics on the first visit, and takes the default channels. */
async function chooseOnFirstVisit(page: Page, ...titles: string[]) {
  await page.goto("/");
  for (const title of titles) await interest(page, title).click();
  await page.getByTestId("first-run-next").click();
  await page.getByTestId("first-run-finish").click();
  await expect(page.getByTestId("first-run")).toHaveCount(0);
}

test.describe("guests", () => {
  test("can use the site with no sign-in prompt in the way", async ({ page }) => {
    // The first-visit choices are the one dialog on the home page, covered in first-run.spec.ts.
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeAttached();
    await expect(page.getByTestId("first-run").getByText("تسجيل الدخول")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await page.goto("/topics"))?.status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await page.goto("/interests"))?.status()).toBe(200);
  });

  test("find first-visit choices again on the interests page", async ({ page }) => {
    await chooseOnFirstVisit(page, "الفقه", "التزكية");

    await page.goto("/interests");
    await expect(interest(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect(interest(page, "التزكية")).toHaveAttribute("aria-pressed", "true");
    await expect(interest(page, "النبوة")).toHaveAttribute("aria-pressed", "false");
  });

  test("can edit and reset interests, and resetting asks first", async ({ page }) => {
    await page.goto("/interests");
    const save = page.getByRole("button", { name: "حفظ التغييرات" });
    await expect(save).toBeDisabled();

    await interest(page, "العقيدة").click();
    await save.click();
    await expect(page.getByText("تم حفظ اختياراتك.")).toBeVisible();

    await page.reload();
    await expect(interest(page, "العقيدة")).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "إعادة ضبط الاختيارات" }).click();
    await page.getByRole("button", { name: "إلغاء" }).click();
    await expect(interest(page, "العقيدة")).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "إعادة ضبط الاختيارات" }).click();
    await page.getByRole("button", { name: "نعم، أعد الضبط" }).click();
    await expect(interest(page, "العقيدة")).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await expect(interest(page, "العقيدة")).toHaveAttribute("aria-pressed", "false");
  });

  test("survive damaged browser storage", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("preferences.v2", '{"role":"SUPER_ADMIN"'));
    await page.goto("/interests");
    await expect(interest(page, "الفقه")).toHaveAttribute("aria-pressed", "false");
  });

  test("see sign-in and interests in the account menu, and nothing for accounts", async ({ page }) => {
    await page.goto("/interests");
    await accountMenu(page).click();
    await expect(page.getByRole("menuitem", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "موضوعاتي وقنواتي" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "تسجيل الخروج" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "لوحة التحكم" })).toHaveCount(0);

    await page.getByRole("menuitem", { name: "تسجيل الدخول" }).click();
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Finterests$/);
  });
});

test.describe("sign-in page", () => {
  test("is optional, and isn't indexed", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تسجيل الدخول");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await page.getByRole("link", { name: "المتابعة دون تسجيل الدخول" }).click();
    await expect(page).toHaveURL("/");
  });

  test("goes to Google asking only for identity scopes, with none for YouTube", async ({ page }) => {
    let googleUrl: URL | undefined;
    await page.route("https://accounts.google.com/**", async (route) => {
      googleUrl = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "<html lang='en'><title>stub</title></html>" });
    });

    await page.goto("/auth/signin?callbackUrl=%2Finterests");
    await page.getByRole("button", { name: "المتابعة بحساب Google" }).click();
    await expect.poll(() => googleUrl?.hostname, { timeout: 30_000 }).toBe("accounts.google.com");

    expect(googleUrl!.searchParams.get("client_id")).toBe("e2e-client-id");
    expect(googleUrl!.searchParams.get("scope")).toBe("openid email profile");
    expect(googleUrl!.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);
    expect(googleUrl!.toString()).not.toMatch(/youtube/i);
  });

  test("ignores a crafted return address", async ({ page }) => {
    await page.goto("/auth/signin?callbackUrl=https%3A%2F%2Fevil.example");
    await expect(page.getByRole("link", { name: "المتابعة دون تسجيل الدخول" })).toHaveAttribute("href", "/");
  });

  test("shows only fixed error messages, never what's in the address", async ({ page }) => {
    await page.goto("/auth/signin?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    const alert = page.getByRole("alert").filter({ hasText: "تعذّر إكمال تسجيل الدخول" });
    await expect(alert).toBeVisible();
    await expect(page.locator("main")).not.toContainText("script");
  });

  test("explains a refused account", async ({ page }) => {
    await page.goto("/auth/signin?error=AccessDenied");
    await expect(page.getByRole("alert").filter({ hasText: "الحساب غير موقوف" })).toBeVisible();
  });

  test("sends someone already signed in onward", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/auth/signin?callbackUrl=%2Finterests");
    await expect(page).toHaveURL("/interests");
  });
});

test.describe("signed-in people", () => {
  test("keep what they chose as a guest, and it leaves the browser only after saving (§8.2)", async ({ page, context, baseURL }) => {
    await chooseOnFirstVisit(page, "الفقه", "النبوة");

    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/interests");
    await expect(interest(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect(interest(page, "النبوة")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("تُحفظ اختياراتك في حسابك")).toBeVisible();

    await expect.poll(() => selectedTopicTitles(account.id)).toEqual(["النبوة", "الفقه"].sort());
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("preferences.v2"))).toBeNull();

    const preference = await prisma.userPreference.findUniqueOrThrow({ where: { userId: account.id } });
    expect(preference.onboardingDoneAt).toBeInstanceOf(Date);
  });

  test("keep guest choices in the browser when the merge can't reach the server", async ({ page, context, baseURL }) => {
    await chooseOnFirstVisit(page, "الفقه");

    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.route("**/api/preferences/merge", (route) => route.fulfill({ status: 500, body: "{}" }));

    await page.goto("/interests");
    await expect(page.getByRole("alert").filter({ hasText: "حدث خطأ غير متوقع" })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("preferences.v2"))).toContain("completed");

    await page.unroute("**/api/preferences/merge");
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expect(interest(page, "الفقه")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => selectedTopicTitles(account.id)).toEqual(["الفقه"]);
  });

  test("get the same interests on another device", async ({ page, context, baseURL, browser }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/interests");
    await interest(page, "النبوة").click();
    await page.getByRole("button", { name: "حفظ التغييرات" }).click();
    await expect(page.getByText("تم حفظ اختياراتك.")).toBeVisible();

    const otherDevice = await browser.newContext({ baseURL });
    await signInBrowser(otherDevice, baseURL!, account.sessionToken);
    const otherPage = await otherDevice.newPage();
    await otherPage.goto("/interests");
    await expect(interest(otherPage, "النبوة")).toHaveAttribute("aria-pressed", "true");
    await otherDevice.close();
  });

  test("aren't asked again after finishing onboarding on another device", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await prisma.userPreference.create({ data: { userId: account.id, onboardingDoneAt: new Date() } });
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/");
    await expect(page.getByTestId("feed-card").first()).toBeVisible();
    await expect(page.getByTestId("first-run")).toHaveCount(0);
  });

  test("see their account in the menu, and signing out really ends the session", async ({ page, context, baseURL }) => {
    const account = await createAccount("USER", "سارة");
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/interests");
    await expect(page.getByText("تُحفظ اختياراتك في حسابك")).toBeVisible();
    await accountMenu(page).click();
    await expect(page.getByRole("menu")).toContainText("سارة");
    await expect(page.getByRole("menu")).toContainText(account.email);
    await expect(page.getByRole("menuitem", { name: "لوحة التحكم" })).toHaveCount(0);

    await page.getByRole("menuitem", { name: "تسجيل الخروج" }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => prisma.session.count({ where: { sessionToken: account.sessionToken } })).toBe(0);
  });

  test("receive nothing about roles or permissions in the browser's session data", async ({ page, context, baseURL }) => {
    const account = await createAccount("EDITOR");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/");

    const response = await page.request.get("/api/auth/session");
    const session = await response.json();
    expect(session.user).toEqual({ name: account.name, email: account.email, hasAdminAccess: true });
    expect(JSON.stringify(session)).not.toMatch(/EDITOR|permissionGrants|"role"|"id"/);
  });
});

test.describe("dashboard access", () => {
  test("sends a guest to sign-in, returning to the dashboard afterwards", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fadmin$/);
  });

  test("refuses a normal user, showing nothing from the dashboard", async ({ page, context, baseURL }) => {
    const account = await createAccount("USER");
    await signInBrowser(context, baseURL!, account.sessionToken);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ليست لديك صلاحية الوصول");
    await expect(page.getByText("كل المقالات")).toHaveCount(0);
  });

  for (const role of ["CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const) {
    test(`opens for ${role}, with real counts`, async ({ page, context, baseURL }) => {
      const account = await createAccount(role);
      await signInBrowser(context, baseURL!, account.sessionToken);

      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");
      const articles = await prisma.article.count({ where: { isArchived: false } });
      await expect(page.getByTestId("stat-articles")).toHaveText(String(articles));
    });
  }

  test("offers the dashboard link only to staff", async ({ page, context, baseURL }) => {
    const account = await createAccount("EDITOR");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/interests");
    await expect(page.getByText("تُحفظ اختياراتك في حسابك")).toBeVisible();
    await accountMenu(page).click();
    await page.getByRole("menuitem", { name: "لوحة التحكم" }).click();
    await expect(page).toHaveURL("/admin");
  });

  test("a removed role stops working on the very next request", async ({ page, context, baseURL }) => {
    const account = await createAccount("ADMIN");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");

    await prisma.user.update({ where: { id: account.id }, data: { role: "USER" } });

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ليست لديك صلاحية الوصول");
  });

  test("a deactivated person loses access immediately, with their session still stored", async ({ page, context, baseURL }) => {
    const account = await createAccount("ADMIN");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");

    await prisma.user.update({ where: { id: account.id }, data: { isDeactivated: true } });
    expect(await prisma.session.count({ where: { sessionToken: account.sessionToken } })).toBe(1);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/signin/);
    expect(await (await page.request.get("/api/auth/session")).json()).toEqual({});
    expect((await page.request.get("/api/preferences")).status()).toBe(401);
  });

  test("a made-up or expired session counts as a guest", async ({ page, context, baseURL }) => {
    await signInBrowser(context, baseURL!, "made-up-token");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/signin/);

    const account = await createAccount("ADMIN");
    await prisma.session.update({ where: { sessionToken: account.sessionToken }, data: { expires: new Date(Date.now() - 1000) } });
    await signInBrowser(context, baseURL!, account.sessionToken);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test("a role in a cookie or header from the client means nothing", async ({ page, context, baseURL }) => {
    const account = await createAccount("USER");
    await signInBrowser(context, baseURL!, account.sessionToken);
    await context.addCookies([{ name: "role", value: "SUPER_ADMIN", url: baseURL! }]);
    await page.setExtraHTTPHeaders({ "x-user-role": "SUPER_ADMIN", "x-role": "SUPER_ADMIN" });

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ليست لديك صلاحية الوصول");
  });

  test("is never indexed", async ({ page, context, baseURL, request }) => {
    const account = await createAccount("ADMIN");
    await signInBrowser(context, baseURL!, account.sessionToken);
    const response = await page.goto("/admin");
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    expect((await request.get("/interests")).headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await request.get("/auth/signin")).headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await request.get("/")).headers()["x-robots-tag"]).toBeUndefined();
  });
});

test.describe("preferences API, called directly", () => {
  const body = (topicIds: string[]) => JSON.stringify({ topicIds, channelChoices: {} });

  test("refuses guests with a safe message", async ({ page, baseURL }) => {
    const headers = { Origin: baseURL!, "Content-Type": "application/json" };

    const read = await page.request.get("/api/preferences");
    expect(read.status()).toBe(401);
    const payload = await read.json();
    expect(payload).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.stringMatching(/تسجيل الدخول/) } });

    expect((await page.request.put("/api/preferences", { headers, data: body([]) })).status()).toBe(401);
    expect((await page.request.delete("/api/preferences", { headers })).status()).toBe(401);
    expect((await page.request.post("/api/preferences/merge", { headers, data: "{}" })).status()).toBe(401);
    expect((await page.request.post("/api/preferences/onboarding", { headers, data: "{}" })).status()).toBe(401);
  });

  test("refuses writes from another site, or with no origin", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);

    const put = (origin?: string) =>
      page.request.put("/api/preferences", {
        headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
        data: body([]),
      });

    expect((await put("https://evil.example")).status()).toBe(403);
    expect((await put()).status()).toBe(403);
    expect((await put("not a url")).status()).toBe(403);
    expect((await put(baseURL!)).status()).toBe(200);
  });

  test("rejects bad input, and can't be pointed at someone else", async ({ page, context, baseURL }) => {
    const owner = await createAccount();
    const other = await createAccount();
    const topic = await prisma.topic.findFirstOrThrow({ where: { status: "PUBLISHED", isArchived: false } });
    await signInBrowser(context, baseURL!, owner.sessionToken);

    const put = (data: string) => page.request.put("/api/preferences", { headers: { Origin: baseURL!, "Content-Type": "application/json" }, data });

    expect((await put("{not json")).status()).toBe(400);
    expect((await put(JSON.stringify({ topicIds: ["nope"], channelChoices: {} }))).status()).toBe(400);
    expect((await put(JSON.stringify({ topicIds: [topic.id], channelChoices: { nope: true } }))).status()).toBe(400);
    expect((await put(JSON.stringify({ topicIds: [topic.id], channelChoices: {}, userId: other.id }))).status()).toBe(400);
    expect((await put(JSON.stringify({ topicIds: [topic.id], channelChoices: {}, role: "ADMIN" }))).status()).toBe(400);

    expect(await selectedTopicTitles(other.id)).toEqual([]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("USER");
  });

  test("slows down repeated writes", async ({ page, context, baseURL }) => {
    const account = await createAccount();
    await signInBrowser(context, baseURL!, account.sessionToken);

    let lastStatus = 0;
    // More than one window's limit twice over, so crossing a window boundary can't hide it.
    for (let attempt = 0; attempt < 65 && lastStatus !== 429; attempt += 1) {
      const response = await page.request.delete("/api/preferences", { headers: { Origin: baseURL! } });
      lastStatus = response.status();
    }
    expect(lastStatus).toBe(429);
  });

  test("the public catalogue needs no sign-in and exposes only what's public", async ({ request }) => {
    const response = await request.get("/api/topics");
    expect(response.status()).toBe(200);
    const { topics, channels } = await response.json();
    expect(topics.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(topics[0]).sort()).toEqual(["channelIds", "coverImage", "id", "introduction", "slug", "title"]);
    expect(Object.keys(channels[0]).sort()).toEqual(["handle", "id", "thumbnailUrl", "title", "topicIds", "videoCount"]);
  });
});

test.describe("layout and accessibility", () => {
  test("the account control fits a phone and meets the touch target", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/topics");
    const box = await accountMenu(page).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("top-bar")).toBeVisible();
  });

  test("desktop has no top bar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("top-bar")).toBeHidden();
    await expect(accountMenu(page)).toBeVisible();
  });

  async function scan(page: Page) {
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);
  }

  test("the first-visit prompt has no WCAG A or AA violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("topic-tile").first()).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("the interests page has no WCAG A or AA violations", async ({ page }) => {
    await page.goto("/interests");
    await expect(interest(page, "الفقه")).toBeVisible();
    await interest(page, "الفقه").click();
    expect(await scan(page)).toEqual([]);
  });

  test("the sign-in page has no WCAG A or AA violations", async ({ page }) => {
    await page.goto("/auth/signin?error=AccessDenied");
    expect(await scan(page)).toEqual([]);
  });

  test("the open account menu has no WCAG A or AA violations", async ({ page }) => {
    await page.goto("/interests");
    await accountMenu(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("the dashboard and the refusal page have no WCAG A or AA violations", async ({ page, context, baseURL }) => {
    const admin = await createAccount("ADMIN");
    await signInBrowser(context, baseURL!, admin.sessionToken);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");
    expect(await scan(page)).toEqual([]);

    const user = await createAccount("USER");
    await signInBrowser(context, baseURL!, user.sessionToken);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ليست لديك صلاحية الوصول");
    expect(await scan(page)).toEqual([]);
  });

  for (const width of [360, 768, 1440]) {
    test(`new pages don't overflow at ${width}px`, async ({ page, context, baseURL }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const admin = await createAccount("ADMIN");

      for (const path of ["/", "/interests", "/auth/signin"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
        if (testInfo.project.name === "desktop") {
          await page.screenshot({ path: `test-results/screens/phase3${path.replaceAll("/", "-")}-${width}.png`, fullPage: true });
        }
      }

      await signInBrowser(context, baseURL!, admin.sessionToken);
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "/admin").toBeLessThanOrEqual(0);
      if (testInfo.project.name === "desktop") {
        await page.screenshot({ path: `test-results/screens/phase3-admin-${width}.png`, fullPage: true });
      }
    });
  }
});
