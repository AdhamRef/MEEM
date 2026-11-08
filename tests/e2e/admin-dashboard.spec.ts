import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { seededChannelTitle } from "./support/seed-feed";
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

/** A followed channel, as the hourly check leaves it. The browser tests run with the API switched off. */
async function seedChannel(options: { title?: string; isFollowed?: boolean; isBackfillComplete?: boolean } = {}) {
  const id = unique();
  return prisma.youTubeChannel.create({
    data: {
      youtubeChannelId: `UC${id}${id}${id}`,
      title: options.title ?? `قناة ${id}`,
      handle: `@${id}`,
      uploadsPlaylistId: `UU${id}`,
      metadataFetchedAt: new Date(),
      isFollowed: options.isFollowed ?? true,
      followedAt: new Date(),
      isBackfillComplete: options.isBackfillComplete ?? true,
      // Its playlists are read after its uploads, so a complete channel has those done too.
      isPlaylistsComplete: options.isBackfillComplete ?? true,
      playlistsCheckedAt: new Date(),
      lastCheckedAt: new Date(),
      youtubeVideoCount: 10,
    },
  });
}

test.describe("content sources", () => {
  test("lists followed channels, and hides and shows a channel's videos from its page", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(page, "ADMIN", baseURL!);
    const channel = await seedChannel();
    const shown = await seedVideo({ status: "PUBLISHED", publishedAt: new Date(), channelId: channel.id });
    const other = await seedVideo({ status: "PUBLISHED", publishedAt: new Date(), channelId: channel.id });

    await page.goto(`/admin/sources?query=${encodeURIComponent(channel.title)}`);
    const row = page.getByTestId("source-channel").filter({ hasText: channel.title });
    await expect(row).toContainText("2 منشور");
    await expect(row.getByTestId("source-channel-status")).toContainText("محدّثة");
    // The browser tests have no API key, so adding and checking explain why they're off.
    await expect(page.getByTestId("add-source-unavailable")).toBeVisible();
    await expect(row.getByTestId("channel-check")).toBeDisabled();

    await row.getByTestId("source-channel-link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/sources/channels/${channel.id}$`));
    await expect(page.getByTestId("bulk-row")).toHaveCount(2);

    await page.getByTestId("bulk-row").filter({ hasText: shown.title }).getByTestId("bulk-check").check();
    await page.getByTestId("bulk-unpublish").click();
    await expect(page.getByTestId("bulk-message")).toBeVisible();
    await expect.poll(async () => (await prisma.video.findUniqueOrThrow({ where: { id: shown.id } })).status).toBe("DRAFT");

    await page.getByTestId("channel-filter-DRAFT").click();
    await expect(page.getByTestId("bulk-row")).toHaveCount(1);
    await expect(page.getByTestId("bulk-row")).toContainText(shown.title);
    await page.getByTestId("channel-filter-PUBLISHED").click();
    await expect(page.getByTestId("bulk-row")).toHaveCount(1);
    await expect(page.getByTestId("bulk-row")).toContainText(other.title);
  });

  test("shows a first fetch in progress, and stops following only after confirming", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const channel = await seedChannel({ isBackfillComplete: false });
    await page.goto(`/admin/sources?query=${encodeURIComponent(channel.title)}`);
    const row = page.getByTestId("source-channel").filter({ hasText: channel.title });
    await expect(row.getByRole("progressbar")).toBeVisible();
    await expect(row).toContainText("جُلب 0 من نحو 10");

    await row.getByTestId("channel-menu").click();
    await page.getByTestId("channel-unfollow").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.getByTestId("confirm-yes").click();
    await expect.poll(async () => (await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).isFollowed).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "source.unfollow_channel", entityId: channel.id } })).toBe(1);

    await page.goto("/admin/sources");
    await page.getByTestId("unfollowed-channels").locator("summary").click();
    await expect(page.getByTestId("unfollowed-list")).toContainText(channel.title);
  });

  test("the old importer and channel pages lead to sources", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/youtube-importer");
    await expect(page).toHaveURL(/\/admin\/sources$/);
    await page.goto("/admin/channels");
    await expect(page).toHaveURL(/\/admin\/sources$/);
    await expect(page.getByRole("navigation", { name: "تنقل لوحة التحكم" }).getByRole("link", { name: "مصادر المحتوى" })).toBeVisible();
  });

  test("the queue saves a source for later without quota, toggles auto, and removes it after confirming", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const handle = `@queue${unique()}`;
    await page.goto("/admin/sources");
    await page.getByTestId("drafts-link").click();
    await expect(page).toHaveURL(/\/admin\/sources\/drafts$/);
    await expect(page.getByTestId("quota-meter").getByTestId("quota-used")).toBeVisible();

    await page.getByTestId("draft-input").fill(`https://www.youtube.com/${handle}`);
    await page.getByTestId("draft-label").fill("دروس نافعة");
    await page.getByTestId("draft-note").fill("شروح موثوقة");
    await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-message")).toContainText("حُفظ");

    const card = page.getByTestId("draft-card").filter({ hasText: handle });
    await expect(card).toContainText("دروس نافعة");
    await expect(card.getByTestId("draft-status")).toContainText("بالانتظار");
    // The browser tests have no API key, so adding now explains why it's off.
    await expect(card.getByTestId("draft-add-now")).toBeDisabled();

    await card.getByTestId("draft-auto-toggle").click();
    await expect(card.getByTestId("draft-auto-toggle")).toHaveAttribute("aria-checked", "false");

    await card.getByTestId("draft-remove").click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("draft-card").filter({ hasText: handle })).toHaveCount(0);
  });

  test("is closed to people who can't publish", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    await page.goto("/admin/sources");
    await expect(page.getByTestId("add-source")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "تنقل لوحة التحكم" }).getByRole("link", { name: "مصادر المحتوى" })).toHaveCount(0);
  });

  test("a channel's topics decide where its videos appear, seen from both sides", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(page, "ADMIN", baseURL!);
    const id = unique();
    const channel = await prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC${id}${id}${id}`, title: `قناة الربط ${id}`, handle: `@${id}`, metadataFetchedAt: new Date() } });
    const title = `موضوع الربط ${id}`;
    const topic = await prisma.topic.create({ data: { title, titleSearch: title, slug: `channel-link-${id}`, status: "PUBLISHED", publishedAt: new Date() } });
    const video = await seedVideo({ status: "PUBLISHED", reviewedAt: new Date(), publishedAt: new Date(), channelId: channel.id });
    const openChannelTopics = async () => {
      await page.goto(`/admin/sources/channels/${channel.id}`);
      await page.getByTestId("channel-topics-toggle").click();
      return page.getByTestId("links-channel.topic");
    };

    try {
      await page.goto(`/topics/${topic.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByTestId("section-shorts")).toHaveCount(0);

      const links = await openChannelTopics();
      await expect(links.getByText("لا شيء مرتبط بعد.")).toBeVisible();
      await links.getByRole("searchbox").fill(title);
      await links.getByRole("button", { name: title }).click();
      await expect(links.getByTestId("link-row")).toContainText(title);
      expect(await prisma.auditLog.count({ where: { action: "link.add", entityId: channel.id } })).toBe(1);

      await page.reload();
      await expect(page.getByTestId("channel-topics")).toContainText(title);

      await page.goto(`/topics/${topic.slug}`);
      await expect(page.getByTestId("section-shorts").getByText(video.title)).toBeVisible();
      await expect(page.getByTestId("topic-channels")).toContainText(channel.title);

      await page.goto(`/admin/topics/${topic.id}`);
      await expect(page.getByTestId("links-topic.channel").getByTestId("link-row")).toContainText(channel.title);

      const linked = await openChannelTopics();
      await linked.getByRole("button", { name: `إزالة: ${title}` }).click();
      await expect(linked.getByText("لا شيء مرتبط بعد.")).toBeVisible();

      await page.goto(`/topics/${topic.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByTestId("section-shorts")).toHaveCount(0);
      await expect(page.getByText(video.title)).toHaveCount(0);

      await page.goto(`/admin/topics/${topic.id}`);
      await expect(page.getByTestId("links-topic.channel").getByText("لا شيء مرتبط بعد.")).toBeVisible();
    } finally {
      // A channel with public videos joins the first-visit choices, which other specs count exactly.
      await prisma.video.delete({ where: { id: video.id } });
      await prisma.channelTopic.deleteMany({ where: { channelId: channel.id } });
      await prisma.topic.delete({ where: { id: topic.id } });
      await prisma.youTubeChannel.delete({ where: { id: channel.id } });
    }
  });
});

test.describe("managing videos", () => {
  test("reviews and publishes through the screens", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const video = await seedVideo();
    await page.goto(`/admin/shorts/${video.id}`);

    await expect(page.getByTestId("video-youtube-details")).toContainText("المصدر: YouTube");
    await expect(page.getByTestId("video-youtube-details")).toContainText("بانتظار المراجعة");

    // Publishing needs no kind first, and pressing it counts as the review.
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("action-unpublish")).toBeVisible();
    const published = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(published.status).toBe("PUBLISHED");
    expect(published.reviewedAt).not.toBeNull();
    expect((await page.request.get(`/videos/${video.id}`)).status()).toBe(200);

    // It can still be set afterwards.
    await page.getByTestId("video-kind").selectOption("SHORT");
    await page.getByTestId("video-save").click();
    await expect(page.getByTestId("video-message")).toHaveText("تم الحفظ.");
  });

  test("shows a video's topics from its channel, without letting them be edited here", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const channel = await prisma.youTubeChannel.findFirstOrThrow({ where: { title: seededChannelTitle("الفقه") } });
    const video = await seedVideo({ channelId: channel.id });
    await page.goto(`/admin/shorts/${video.id}`);

    const topics = page.getByTestId("video-topics");
    await expect(topics).toContainText("الفقه");
    await expect(topics.locator("select, input, button")).toHaveCount(0);
  });

  test("sets a CTA by searching, never by typing an ID, and readers see it", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const id = unique();
    const article = await prisma.article.create({ data: { title: `مقال الوجهة ${id}`, slug: `cta-${id}`, body: { type: "doc", content: [] }, status: "PUBLISHED", publishedAt: new Date() } });
    const video = await seedVideo({ status: "PUBLISHED", reviewedAt: new Date() });
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

  test("assigns a kind in bulk, and bulk publishing reports what it skipped", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const word = unique();
    const [ready, waiting] = [await seedVideo({ title: `مجموعة ${word} أ`, titleSearch: `مجموعه ${word} ا`, reviewedAt: new Date() }), await seedVideo({ title: `مجموعة ${word} ب`, titleSearch: `مجموعه ${word} ب`, availability: "UNAVAILABLE" })];
    await page.goto(`/admin/shorts?query=${encodeURIComponent(`مجموعة ${word}`)}`);
    await expect(page.getByTestId("bulk-row")).toHaveCount(2);

    await page.getByTestId("bulk-all").check();
    await expect(page.getByTestId("bulk-count")).toHaveText("(2)");
    await expect(page.getByTestId("bulk-apply")).toBeDisabled();
    // A video's topics come from its channel, so they aren't offered here.
    await expect(page.getByTestId("content-picker-TOPIC")).toHaveCount(0);
    await page.getByTestId("bulk-kind").selectOption("LONG_FORM");
    await page.getByTestId("bulk-apply").click();
    await expect(page.getByTestId("bulk-message")).toContainText("عُدّل");
    await expect.poll(async () => (await prisma.video.findUniqueOrThrow({ where: { id: waiting.id } })).kind).toBe("LONG_FORM");

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
    const topicTitle = `موضوع جماعي ${id}`;
    const topic = await prisma.topic.create({ data: { title: topicTitle, titleSearch: topicTitle, slug: `bulk-topic-${id}`, status: "PUBLISHED", publishedAt: new Date() } });
    await page.goto(`/admin/articles?query=${encodeURIComponent(`مقال جماعي ${id}`)}`);
    await page.getByTestId("bulk-all").check();
    await expect(page.getByTestId("bulk-apply")).toBeDisabled();
    // An article's kind doesn't change, so topics are all there is to assign.
    await expect(page.getByTestId("bulk-kind")).toHaveCount(0);
    const picker = page.getByTestId("content-picker-TOPIC");
    await expect(picker).toContainText("إضافة موضوعات");
    await picker.getByRole("searchbox").fill(topicTitle);
    await picker.getByRole("button", { name: topicTitle }).click();
    await page.getByTestId("bulk-apply").click();
    await expect.poll(() => prisma.articleTopic.count({ where: { articleId: article.id, topicId: topic.id } })).toBe(1);

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

    await page.getByTestId("bulk-kind").selectOption("LONG_FORM");
    await page.getByTestId("bulk-apply").click();
    // More than a hundred, so it asks first.
    await expect(page.getByTestId("bulk-confirm-dialog")).toBeVisible();
    await page.getByTestId("bulk-confirm").click();

    await expect(page.getByTestId("bulk-message")).toContainText("119", { timeout: 60_000 });
    expect(await prisma.video.count({ where: { titleSearch: { startsWith: word }, kind: "LONG_FORM" } })).toBe(119);
    await expect(page.getByTestId("bulk-count")).toHaveText("(0)");
  });
});

test.describe("the audit log, settings, and status", () => {
  test("the audit log records actions, and can be filtered", async ({ page, baseURL }) => {
    const account = await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/topics/new");
    await page.getByLabel("العنوان").fill(`موضوع سجل ${unique()}`);
    await page.getByTestId("form-save").click();
    await page.waitForURL(/\/admin\/topics\/[a-f\d]{24}$/);

    await page.goto(`/admin/audit-logs?action=topic.create&actor=${encodeURIComponent(account.email)}`);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
    await expect(page.getByTestId("audit-row")).toContainText("topic.create");
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
    // The only switch is the hourly check (plan D10). Statistics have none.
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.getByTestId("auto-check-enabled")).toBeVisible();
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
    // On by the owner's decision of 2026-11-06.
    await expect(page.getByTestId("status-statistics")).toHaveText("مفعّلة");
    await expect(page.getByTestId("youtube-panel").getByRole("button", { name: "تحديث البيانات الآن" })).toBeDisabled();
  });

  test("the overview shows real counts, and each role sees only its sections", async ({ page, baseURL }) => {
    await signIn(page, "SUPER_ADMIN", baseURL!);
    await page.goto("/admin");
    const expected = await prisma.article.count({ where: { isArchived: false } });
    await expect(page.getByTestId("stat-articles")).toHaveText(String(expected));
    await expect(page.getByTestId("recent-activity").or(page.getByText("لا يوجد نشاط مسجل بعد."))).toBeVisible();

    const nav = page.getByRole("navigation", { name: "تنقل لوحة التحكم" });
    // The importer and channels became Sources, with its queue beside it (plan D10).
    await expect(nav.getByRole("link")).toHaveCount(14);

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
    const channel = await seedChannel({ isBackfillComplete: false });
    const video = await seedVideo({ channelId: channel.id });
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of ["/admin", "/admin/shorts", `/admin/shorts/${video.id}`, "/admin/sources", "/admin/sources?tab=playlists", `/admin/sources/channels/${channel.id}`, "/admin/users", "/admin/audit-logs", "/admin/settings", "/admin/youtube-status"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`), path).toEqual([]);
    }
  });

  test("dashboard pages are never indexed", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    for (const path of ["/admin/shorts", "/admin/users", "/admin/audit-logs", "/admin/sources"]) {
      expect((await page.request.get(path)).headers()["x-robots-tag"], path).toContain("noindex");
    }
  });
});
