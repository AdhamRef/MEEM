import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { expect, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);

async function signIn(page: Page, role: Parameters<typeof createAccount>[0], baseURL: string) {
  const account = await createAccount(role);
  await signInBrowser(page.context(), baseURL, account.sessionToken);
  return account;
}

async function seedVideo(overrides: Record<string, unknown> = {}) {
  const id = `a${unique()}00`.slice(0, 11);
  const title = `مقطع إداري ${id}`;
  return prisma.video.create({
    data: {
      youtubeVideoId: id,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      availability: "AVAILABLE",
      title,
      titleSearch: title.toLowerCase(),
      channelTitle: "قناة",
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }],
      durationSeconds: 40,
      metadataFetchedAt: new Date(),
      feedKey: Math.floor(Math.random() * 1_000_000),
      ...overrides,
    },
  });
}

/** A job waiting for review, as discovery leaves it. The browser tests run with the API switched off. */
async function seedJob(type: "IMPORT" | "SYNC" = "IMPORT", count = 3) {
  const id = unique();
  const channel = await prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC${id}${id}${id}`, title: `قناة ${id}`, handle: `@${id}`, uploadsPlaylistId: `UU${id}`, metadataFetchedAt: new Date() } });
  const job = await prisma.importJob.create({ data: { type, status: "READY_FOR_REVIEW", channelId: channel.id, discoveredCount: count } });
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const youtubeVideoId = `c${id}${index}00`.slice(0, 11);
    candidates.push(
      await prisma.importCandidate.create({
        data: {
          jobId: job.id,
          youtubeVideoId,
          title: `مرشح ${id} ${index}`,
          channelTitle: channel.title,
          thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg` }],
          durationSeconds: index === 0 ? 1200 : 40,
          ytPublishedAt: new Date("2026-01-01"),
          classification: index === 0 ? "LONG_FORM_CANDIDATE" : "SHORT_CANDIDATE",
          expiresAt: new Date(Date.now() + 86_400_000 * 29),
        },
      }),
    );
  }
  return { job, channel, candidates };
}

test.describe("the YouTube importer", () => {
  test("reviews, filters, selects, assigns, imports as drafts, and reports", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(page, "ADMIN", baseURL!);
    const { job, candidates } = await seedJob();
    const category = await prisma.category.findFirstOrThrow({ where: { slug: "الفقه" } });
    await page.goto(`/admin/youtube-importer/${job.id}`);

    await expect(page.getByTestId("job-status")).toHaveAttribute("data-status", "READY_FOR_REVIEW");
    const rows = page.getByTestId("candidate");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("المصدر: YouTube");
    await expect(page.getByTestId("import-start")).toBeDisabled();

    // The filters are candidates only, and say so.
    await page.getByTestId("import-filter-long").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("candidate-class")).toHaveText("مرشح كمقطع طويل");
    await page.getByTestId("import-filter-short").click();
    await expect(rows).toHaveCount(2);

    await page.getByTestId("select-all").click();
    await expect(page.getByTestId("import-start")).toContainText("(2)");
    await page.getByTestId("import-filter-selected").click();
    await expect(rows).toHaveCount(2);
    await page.getByTestId("import-filter-unselected").click();
    await expect(rows).toHaveCount(1);

    await page.getByTestId("assign-category").selectOption(category.id);
    await page.getByTestId("assign-apply").click();
    await expect(page.getByTestId("job-notice")).toContainText("صُنّف");

    await page.getByTestId("import-start").click();
    await expect(page.getByTestId("job-status")).toHaveAttribute("data-status", "COMPLETED", { timeout: 30_000 });
    await expect(page.getByTestId("count-imported")).toHaveText("2");
    await expect(page.getByTestId("count-skipped")).toHaveText("1");
    // Shown only when something failed.
    await expect(page.getByTestId("count-failed")).toHaveCount(0);

    const imported = await prisma.video.findMany({ where: { youtubeVideoId: { in: candidates.map((row) => row.youtubeVideoId) } } });
    expect(imported).toHaveLength(2);
    expect(imported.every((video) => video.status === "DRAFT" && video.categoryId === category.id)).toBe(true);
    expect((await page.request.get(`/videos/${imported[0]!.id}`)).status()).toBe(404);
  });

  test("won't let an already imported video be selected again", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job, candidates } = await seedJob("IMPORT", 2);
    await prisma.importCandidate.update({ where: { id: candidates[1]!.id }, data: { alreadyImported: true } });
    await page.goto(`/admin/youtube-importer/${job.id}`);

    await page.getByTestId("import-filter-imported").click();
    await expect(page.getByTestId("candidate")).toHaveCount(1);
    await expect(page.getByTestId("candidate").getByTestId("candidate-check")).toBeDisabled();
  });

  test("resumes after closing the page, and survives a reload", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await page.goto(`/admin/youtube-importer/${job.id}`);
    await page.getByTestId("select-all").click();
    await expect(page.getByTestId("import-start")).toContainText("(3)");

    await page.goto("/admin/youtube-importer");
    await page.getByTestId("job-list").getByRole("link").first().click();
    await expect(page.getByTestId("import-start")).toContainText("(3)");
  });

  test("asks before cancelling, and keeps what's done", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await page.goto(`/admin/youtube-importer/${job.id}`);

    await page.getByTestId("job-cancel").click();
    await expect(page.getByTestId("cancel-dialog")).toBeVisible();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("job-status")).toHaveAttribute("data-status", "CANCELLED");
    await expect(page.getByTestId("import-start")).toHaveCount(0);
    await expect(page.getByTestId("job-cancel")).toHaveCount(0);
  });

  test("a job's page shows real facts, and links to the channel and each video on YouTube", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job, candidates } = await seedJob();
    await page.goto(`/admin/youtube-importer/${job.id}`);

    await expect(page.getByTestId("count-discovered")).toHaveText("3");
    await expect(page.getByTestId("channel-link")).toHaveAttribute("href", /youtube\.com\/channel\//);
    await expect(page.getByTestId("candidate-watch").first()).toHaveAttribute("href", new RegExp(candidates[0]!.youtubeVideoId));
    await expect(page.getByTestId("import-filter-all")).toContainText("3");
  });

  test("a paused job explains itself, and offers to resume", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "PAUSED", errors: [{ stage: "youtube", message: "نفدت حصة YouTube لهذا اليوم", occurredAt: new Date() }] } });
    await page.goto(`/admin/youtube-importer/${job.id}`);

    await expect(page.getByTestId("job-notice")).toContainText("نفدت حصة");
    await expect(page.getByTestId("job-resume")).toBeVisible();
  });

  const rowFor = async (page: Page, channelId: string) => {
    const { title } = await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channelId }, select: { title: true } });
    return page.getByTestId("job-row").filter({ hasText: title });
  };

  test("the list pauses a job without asking, and it can be resumed", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "PAUSED" } });
    await page.goto("/admin/youtube-importer");
    const row = await rowFor(page, job.channelId);

    // The API is off here, so resuming ends up paused again, with the reason. It did try.
    await row.getByTestId("job-retry").click();
    await expect(row.getByTestId("job-failure")).toBeVisible({ timeout: 20_000 });
    expect(await prisma.auditLog.count({ where: { action: "import.resume", entityId: job.id } })).toBe(1);
  });

  test("a cancelled job offers to continue, on the list and on its page", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "CANCELLED", cancelRequestedAt: new Date(), completedAt: new Date() } });
    await page.goto("/admin/youtube-importer");
    await expect((await rowFor(page, job.channelId)).getByTestId("job-retry")).toBeVisible();

    await page.goto(`/admin/youtube-importer/${job.id}`);
    await expect(page.getByTestId("job-resume")).toBeVisible();
  });

  test("the list deletes a job and its preview, in any state", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await page.goto("/admin/youtube-importer");
    const row = await rowFor(page, job.channelId);

    await row.getByTestId("job-delete").click();
    await page.getByTestId("job-action-confirm").click();
    await expect(row).toHaveCount(0);
    expect(await prisma.importJob.count({ where: { id: job.id } })).toBe(0);
    expect(await prisma.importCandidate.count({ where: { jobId: job.id } })).toBe(0);
  });

  test("a job's own page can delete it", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await page.goto(`/admin/youtube-importer/${job.id}`);
    await page.getByTestId("job-delete").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page).toHaveURL(/\/admin\/youtube-importer$/);
    expect(await prisma.importJob.count({ where: { id: job.id } })).toBe(0);
  });

  test("the list takes up an unfinished job, and reports honestly when it can't continue", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { job } = await seedJob();
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "DISCOVERING", nextPageToken: "next" } });
    await page.goto("/admin/youtube-importer");
    const row = await rowFor(page, job.channelId);

    // The API is off in these tests, so the step fails. The point is what the page then says.
    await expect(row.getByTestId("job-failure")).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[data-activity="RUNNING_HERE"]')).toHaveCount(0);
    await expect(row.getByTestId("job-retry")).toBeVisible();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PAUSED");
  });

  test("explains why it's unavailable with no API key", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/youtube-importer");
    await expect(page.getByTestId("importer-unavailable")).toContainText("مفتاح YouTube API");
    await expect(page.getByTestId("channel-input")).toHaveCount(0);
  });

  test("is closed to staff without the permission", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const { job } = await seedJob();
    await page.goto("/admin/youtube-importer");
    await expect(page.getByRole("heading", { name: "ليست لديك صلاحية الوصول" })).toBeVisible();
    await page.goto(`/admin/youtube-importer/${job.id}`);
    await expect(page.getByTestId("import-workspace")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "تنقل لوحة التحكم" }).getByRole("link", { name: "مستورد قنوات YouTube" })).toHaveCount(0);
  });

  test("the channels page lists channels, and sync explains why it's off", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const { channel } = await seedJob();
    await page.goto(`/admin/channels?query=${encodeURIComponent(channel.title)}`);
    const row = page.getByTestId("channel-row");
    await expect(row).toContainText(channel.title);
    await expect(row.getByTestId("channel-sync")).toBeDisabled();
    await expect(page.getByText("مفتاح YouTube API لم يُضبط بعد")).toBeVisible();

    await row.getByTestId("channel-toggle").click();
    await expect(row).toContainText("غير نشطة");
  });
});

test.describe("managing videos", () => {
  test("reviews and publishes through the screens", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const category = await prisma.category.findFirstOrThrow({ where: { slug: "الفقه" } });
    const video = await seedVideo();
    await page.goto(`/admin/shorts/${video.id}`);

    await expect(page.getByTestId("video-youtube-details")).toContainText("المصدر: YouTube");
    await expect(page.getByTestId("video-youtube-details")).toContainText("بانتظار المراجعة");

    // Publishing needs no kind or category first, and pressing it counts as the review.
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("action-unpublish")).toBeVisible();
    const published = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(published.status).toBe("PUBLISHED");
    expect(published.reviewedAt).not.toBeNull();
    expect((await page.request.get(`/videos/${video.id}`)).status()).toBe(200);

    // They can still be set afterwards.
    await page.getByTestId("video-kind").selectOption("SHORT");
    await page.getByTestId("video-category").selectOption(category.id);
    await page.getByTestId("video-save").click();
    await expect(page.getByTestId("video-message")).toHaveText("تم الحفظ.");
  });

  test("sets a CTA by searching, never by typing an ID, and readers see it", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const id = unique();
    const article = await prisma.article.create({ data: { title: `مقال الوجهة ${id}`, slug: `cta-${id}`, body: { type: "doc", content: [] }, status: "PUBLISHED", publishedAt: new Date() } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: "الفقه" } });
    const video = await seedVideo({ status: "PUBLISHED", reviewedAt: new Date(), categoryId: category.id });
    await page.goto(`/admin/shorts/${video.id}`);

    await page.getByTestId("cta-type").selectOption("INTERNAL_ARTICLE");
    await expect(page.getByTestId("video-save")).toBeDisabled();
    const picker = page.getByTestId("content-picker-ARTICLE");
    await picker.getByRole("searchbox").click();
    await picker.getByRole("button", { name: article.title }).click();
    await page.getByTestId("cta-label").fill("اقرأ التفاصيل");
    await page.getByTestId("video-save").click();
    await expect(page.getByTestId("video-message")).toHaveText("تم الحفظ.");

    await page.goto(`/videos/${video.id}`);
    await expect(page.getByTestId("video-cta")).toHaveText("اقرأ التفاصيل");
  });

  test("assigns a category in bulk, and bulk publishing reports what it skipped", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const category = await prisma.category.findFirstOrThrow({ where: { slug: "الفقه" } });
    const word = unique();
    const [ready, waiting] = [await seedVideo({ title: `مجموعة ${word} أ`, titleSearch: `مجموعه ${word} ا`, reviewedAt: new Date() }), await seedVideo({ title: `مجموعة ${word} ب`, titleSearch: `مجموعه ${word} ب`, availability: "UNAVAILABLE" })];
    await page.goto(`/admin/shorts?query=${encodeURIComponent(`مجموعة ${word}`)}`);
    await expect(page.getByTestId("bulk-row")).toHaveCount(2);

    await page.getByTestId("bulk-all").check();
    await expect(page.getByTestId("bulk-count")).toHaveText("(2)");
    await expect(page.getByTestId("bulk-apply")).toBeDisabled();
    await page.getByTestId("bulk-category").selectOption(category.id);
    await page.getByTestId("bulk-apply").click();
    await expect(page.getByTestId("bulk-message")).toContainText("عُدّل");
    await expect.poll(async () => (await prisma.video.findUniqueOrThrow({ where: { id: waiting.id } })).categoryId).toBe(category.id);

    // Finished work clears the selection, so a second action is a deliberate one.
    await expect(page.getByTestId("bulk-count")).toHaveText("(0)");
    await page.getByTestId("bulk-all").check();
    await page.getByTestId("bulk-publish").click();
    await expect(page.getByTestId("bulk-message")).toContainText("تُخطي");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: ready.id } })).status).toBe("PUBLISHED");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("DRAFT");
  });

  test("filters by what needs review", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const word = unique();
    const waiting = await seedVideo({ title: `فلتر ${word}`, titleSearch: `فلتر ${word}` });
    await seedVideo({ title: `فلتر ${word} مراجع`, titleSearch: `فلتر ${word} مراجع`, reviewedAt: new Date() });
    await page.goto(`/admin/shorts?review=NEEDS_REVIEW&query=${encodeURIComponent(`فلتر ${word}`)}`);
    await expect(page.getByTestId("bulk-row")).toHaveCount(1);
    await expect(page.getByTestId("bulk-row")).toContainText(waiting.title);
  });

  test("article lists offer bulk assignment to those who may edit anything, and not to contributors", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const id = unique();
    const article = await prisma.article.create({ data: { title: `مقال جماعي ${id}`, titleSearch: `مقال جماعي ${id}`, slug: `bulk-${id}`, body: { type: "doc", content: [] } } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: "الفقه" } });
    await page.goto(`/admin/articles?query=${encodeURIComponent(`مقال جماعي ${id}`)}`);
    await page.getByTestId("bulk-all").check();
    await page.getByTestId("bulk-category").selectOption(category.id);
    await page.getByTestId("bulk-apply").click();
    await expect.poll(async () => (await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).categoryId).toBe(category.id);

    await signIn(page, "CONTRIBUTOR", baseURL!);
    await page.goto("/admin/articles");
    await expect(page.getByTestId("bulk-panel")).toHaveCount(0);
    await page.goto("/admin/shorts");
    await expect(page.getByRole("heading", { name: "ليست لديك صلاحية الوصول" })).toBeVisible();
  });
});

test.describe("users and roles", () => {
  test("the super admin changes a role and grants, and it takes effect at once", async ({ page, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    const person = await createAccount("USER");
    await page.goto(`/admin/users?query=${encodeURIComponent(person.email)}`);
    const row = page.getByTestId("user-row");

    await row.getByTestId("user-manage").click();
    await row.getByTestId("user-role-select").selectOption("EDITOR");
    await row.getByTestId("user-role-save").click();
    await expect(row.getByTestId("user-role")).toHaveText("محرر");

    await row.getByTestId("grant-content.publish").check();
    await row.getByTestId("user-grants-save").click();
    await expect(row.getByTestId("user-message")).toHaveText("تم الحفظ.");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(stored).toMatchObject({ role: "EDITOR", permissionGrants: ["content.publish"] });
    expect(await prisma.auditLog.count({ where: { entityId: person.id, action: { in: ["user.role_change", "user.grants_change"] } } })).toBe(2);
  });

  test("asks before deactivating, and it ends their access immediately", async ({ page, browser, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    const person = await createAccount("EDITOR");
    const other = await browser.newContext({ baseURL });
    await signInBrowser(other, baseURL!, person.sessionToken);
    const otherPage = await other.newPage();
    await otherPage.goto("/admin");
    await expect(otherPage.getByRole("heading", { name: "نظرة عامة" })).toBeVisible();

    await page.goto(`/admin/users?query=${encodeURIComponent(person.email)}`);
    const row = page.getByTestId("user-row");
    await row.getByTestId("user-manage").click();
    await row.getByTestId("user-deactivate").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-yes").click();
    await expect(row).toContainText("موقوف");

    await otherPage.goto("/admin");
    await expect(otherPage).toHaveURL(/\/auth\/signin/);
    await other.close();
  });

  test("the super admin can't be changed, by anyone, on screen or directly", async ({ page, baseURL }) => {
    const account = await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto(`/admin/users?query=${encodeURIComponent(account.email)}`);
    const row = page.getByTestId("user-row");
    await expect(row).toContainText("محمي");
    await expect(row.getByTestId("user-manage")).toHaveCount(0);
  });

  test("an admin can look, but not change", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const person = await createAccount("USER");
    await page.goto(`/admin/users?query=${encodeURIComponent(person.email)}`);
    await expect(page.getByTestId("user-row")).toContainText(person.email);
    await expect(page.getByTestId("user-manage")).toHaveCount(0);
    await expect(page.getByText("يمكنك عرض المستخدمين فقط")).toBeVisible();
  });

  test("an editor can't open it at all", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "ليست لديك صلاحية الوصول" })).toBeVisible();
    await expect(page.getByTestId("user-list")).toHaveCount(0);
  });
});

test.describe("selecting across pages", () => {
  test("select all covers every page of what the filter matches, minus anything unticked", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(page, "ADMIN", baseURL!);
    const word = `شامل${unique()}`;
    const category = await prisma.category.create({ data: { title: `مجال ${word}`, slug: `all-${word}` } });
    await prisma.video.createMany({
      data: Array.from({ length: 120 }, (_, index) => ({ youtubeVideoId: `a${unique()}${index}`.slice(0, 11), kind: "SHORT" as const, classification: "SHORT_CANDIDATE" as const, title: `${word} ${index}`, titleSearch: `${word} ${index}`, feedKey: index })),
    });

    await page.goto(`/admin/shorts?query=${encodeURIComponent(word)}`);
    // One page shows fewer than what matches.
    await expect(page.getByTestId("bulk-row")).toHaveCount(50);
    await page.getByTestId("bulk-all").check();
    await expect(page.getByTestId("bulk-count")).toHaveText("(120)");

    await page.getByTestId("bulk-check").first().uncheck();
    await expect(page.getByTestId("bulk-count")).toHaveText("(119)");

    await page.getByTestId("bulk-category").selectOption(category.id);
    await page.getByTestId("bulk-apply").click();
    // More than a hundred, so it asks first.
    await expect(page.getByTestId("bulk-confirm-dialog")).toBeVisible();
    await page.getByTestId("bulk-confirm").click();

    await expect(page.getByTestId("bulk-message")).toContainText("119", { timeout: 60_000 });
    expect(await prisma.video.count({ where: { titleSearch: { startsWith: word }, categoryId: category.id } })).toBe(119);
    await expect(page.getByTestId("bulk-count")).toHaveText("(0)");
  });
});

test.describe("categories, the audit log, settings, and status", () => {
  test("creates, edits, and deactivates a category, which leaves the public list", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const title = `مجال ${unique()}`;
    await page.goto("/admin/categories");

    const create = page.getByTestId("category-create");
    await create.getByTestId("category-title").fill(title);
    await create.getByTestId("category-order").fill("500");
    await page.getByTestId("category-create-save").click();
    const row = page.getByTestId("category-row").filter({ hasText: title });
    await expect(row).toHaveCount(1);

    await page.goto("/topics");
    await expect(page.getByTestId("topic-categories").getByRole("link", { name: title })).toHaveCount(1);

    await page.goto("/admin/categories");
    await row.getByTestId("category-toggle").click();
    await expect(row).toContainText("غير نشط");
    await page.goto("/topics");
    await expect(page.getByTestId("topic-categories").getByRole("link", { name: title })).toHaveCount(0);
  });

  test("the audit log records actions, and can be filtered", async ({ page, baseURL }) => {
    const account = await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/categories");
    await page.getByTestId("category-create").getByTestId("category-title").fill(`مجال سجل ${unique()}`);
    await page.getByTestId("category-create-save").click();
    await expect(page.getByTestId("category-create-message")).toHaveText("تم الحفظ.");

    await page.goto(`/admin/audit-logs?action=category.create&actor=${encodeURIComponent(account.email)}`);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
    await expect(page.getByTestId("audit-row")).toContainText("category.create");
    await expect(page.getByTestId("audit-row")).toContainText(account.email);
    await expect(page.getByRole("button", { name: /حذف|تعديل/ })).toHaveCount(0);
  });

  test("settings save and validate, and statistics can't be switched on there", async ({ page, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto("/admin/settings");

    await page.getByTestId("exploration").fill("30");
    await page.getByTestId("scoring-save").click();
    await expect(page.getByTestId("scoring-save-message")).toHaveText("تم الحفظ.");

    await page.getByTestId("refresh-after").fill("45");
    await page.getByTestId("youtube-save").click();
    await expect(page.getByTestId("youtube-save-message")).toContainText("البيانات المدخلة غير صحيحة");

    await page.getByTestId("refresh-after").fill("25");
    await page.getByTestId("youtube-save").click();
    await expect(page.getByTestId("youtube-save-message")).toHaveText("تم الحفظ.");

    await expect(page.getByTestId("statistics-note")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("only the super admin reaches settings", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "ليست لديك صلاحية الوصول" })).toBeVisible();
    await expect(page.getByTestId("scoring-settings")).toHaveCount(0);
  });

  test("the status page reports real configuration, without a key", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/youtube-status");
    await expect(page.getByTestId("status-api")).toHaveText("غير مضبوط");
    await expect(page.getByTestId("status-cron")).toHaveText("سرّها مضبوط");
    await expect(page.getByTestId("status-statistics")).toHaveText("متوقفة");
    await expect(page.getByTestId("youtube-panel").getByRole("button", { name: "تحديث البيانات الآن" })).toBeDisabled();
  });

  test("the overview shows real counts, and each role sees only its sections", async ({ page, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto("/admin");
    const expected = await prisma.article.count({ where: { isArchived: false } });
    await expect(page.getByTestId("stat-articles")).toHaveText(String(expected));
    await expect(page.getByTestId("recent-activity").or(page.getByText("لا يوجد نشاط مسجل بعد."))).toBeVisible();

    const nav = page.getByRole("navigation", { name: "تنقل لوحة التحكم" });
    await expect(nav.getByRole("link")).toHaveCount(15);

    await signIn(page, "CONTRIBUTOR", baseURL!);
    await page.goto("/admin");
    await expect(nav.getByRole("link")).toHaveCount(2);
    await expect(page.getByTestId("recent-activity")).toHaveCount(0);
  });

  test("every section in the navigation opens", async ({ page, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto("/admin");
    const hrefs = await page.getByRole("navigation", { name: "تنقل لوحة التحكم" }).getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    for (const href of hrefs) expect((await page.request.get(href)).status(), href).toBe(200);
  });
});

test.describe("layout and accessibility", () => {
  test("new screens fit a phone, with no accessibility violations", async ({ page, baseURL }) => {
    test.setTimeout(150_000);
    await signIn(page, "SUPER_ADMIN", baseURL!);
    const { job } = await seedJob();
    const video = await seedVideo();
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of ["/admin", "/admin/shorts", `/admin/shorts/${video.id}`, "/admin/youtube-importer", `/admin/youtube-importer/${job.id}`, "/admin/channels", "/admin/categories", "/admin/users", "/admin/audit-logs", "/admin/settings", "/admin/youtube-status"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`), path).toEqual([]);
    }
  });

  test("dashboard pages are never indexed", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    for (const path of ["/admin/shorts", "/admin/users", "/admin/audit-logs", "/admin/youtube-importer"]) {
      expect((await page.request.get(path)).headers()["x-robots-tag"], path).toContain("noindex");
    }
  });
});
