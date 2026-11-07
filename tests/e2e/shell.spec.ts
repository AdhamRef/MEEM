import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { SKIPPED_FIRST_VISIT } from "./support/seed-feed";

// Past the first-visit choices, which are a dialog of their own and take the focus when they open.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem("preferences.v2", value), SKIPPED_FIRST_VISIT);
});

const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const PAGES = [
  { name: "home", path: "/" },
  { name: "design-system", path: "/design-system" },
  { name: "not-found", path: "/this-page-does-not-exist" },
];

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("responsive layout", () => {
  for (const viewport of WIDTHS) {
    for (const target of PAGES) {
      test(`${target.name} fits a ${viewport.name} at ${viewport.width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(target.path);
        await page.evaluate(() => document.fonts.ready);

        await assertNoHorizontalOverflow(page);

        // Kept for visual review in test-results, not compared pixel by pixel.
        if (testInfo.project.name === "desktop") {
          await page.screenshot({ path: `test-results/screens/${target.name}-${viewport.width}.png`, fullPage: true });
        }
      });
    }
  }
});

test.describe("navigation", () => {
  test("phones get a bottom bar and no rail", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");

    const bar = page.getByTestId("navigation-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("navigation-rail")).toBeHidden();

    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeCloseTo(740, 0);
  });

  for (const width of [768, 1440]) {
    test(`at ${width}px the rail sits on the right, the start side in Arabic`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const rail = page.getByTestId("navigation-rail");
      await expect(rail).toBeVisible();
      await expect(page.getByTestId("navigation-bar")).toBeHidden();

      const box = await rail.boundingBox();
      expect(box!.x + box!.width).toBeCloseTo(width, 0);

      const main = await page.locator("main").boundingBox();
      expect(main!.x + main!.width).toBeLessThanOrEqual(box!.x + 1);
    });
  }

  test("every enabled item leads to a real page", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const links = page.getByTestId("navigation-rail").locator('a[data-nav-item="available"]');
    const hrefs = await links.evaluateAll((elements) => elements.map((element) => element.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });

  test("the five destinations all appear, and unbuilt ones are not links", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const rail = page.getByTestId("navigation-rail");
    await expect(rail.locator("[data-nav-item]")).toHaveCount(5);
    // Every destination has shipped, so none may be left disabled.
    await expect(rail.locator('[data-nav-item="unavailable"]')).toHaveCount(0);

    const unavailable = rail.locator('[data-nav-item="unavailable"]');
    for (const element of await unavailable.all()) {
      await expect(element).toHaveAttribute("aria-disabled", "true");
      await expect(element).not.toHaveAttribute("href");
      await expect(element.locator("a")).toHaveCount(0);
    }
  });

  test("marks the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("navigation-rail").locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("enabled items meet the 44px touch target on phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");

    for (const link of await page.getByTestId("navigation-bar").locator("a").all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("the skip link is first for keyboard users and moves focus to the content", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "تخطَّ إلى المحتوى" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });
});

test.describe("typography", () => {
  test("uses the self-hosted Arabic font with no request to Google", async ({ page }) => {
    const externalFontRequests: string[] = [];
    page.on("request", (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFontRequests.push(request.url());
    });

    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toMatch(/plex/i);
    expect(externalFontRequests).toEqual([]);
  });

  test("article quotes put their rule on the right, the start side", async ({ page }) => {
    await page.goto("/design-system");
    const styles = await page.locator(".prose-article blockquote").evaluate((element) => {
      const computed = getComputedStyle(element);
      return { right: computed.borderRightWidth, left: computed.borderLeftWidth };
    });
    expect(styles.right).toBe("3px");
    expect(styles.left).toBe("0px");
  });

  test("an English name keeps its order inside Arabic text", async ({ page }) => {
    await page.goto("/design-system");
    const paragraph = page.getByText("على منصة", { exact: false });
    await expect(paragraph.locator("bdi").first()).toHaveText("Yaqeen Institute");
  });
});

test.describe("error and not-found states", () => {
  test("the not-found page returns 404 in Arabic, with a working way home", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الصفحة غير موجودة");

    await page.getByRole("link", { name: "العودة إلى الرئيسية" }).click();
    await expect(page).toHaveURL("/");
  });

  test("the error state shows no internal details, and retrying recovers", async ({ page }) => {
    await page.goto("/design-system");
    await page.getByRole("button", { name: "عرض حالة الخطأ" }).click();

    const alert = page.getByRole("alert").filter({ hasText: "حدث خطأ غير متوقع" });
    await expect(alert).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Design system preview");

    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expect(page.getByRole("button", { name: "عرض حالة الخطأ" })).toBeVisible();
  });
});

test.describe("accessibility", () => {
  for (const target of PAGES) {
    test(`${target.name} has no WCAG A or AA violations`, async ({ page }) => {
      await page.goto(target.path);
      await page.evaluate(() => document.fonts.ready);

      const results = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

      const summary = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);
      expect(summary).toEqual([]);
    });
  }
});
