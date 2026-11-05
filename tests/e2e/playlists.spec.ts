import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createAccount, prisma, signInBrowser } from "./support/accounts";
import { expect, test } from "./support/test";

const unique = () => randomUUID().slice(0, 8);

async function seedVideo(overrides: Record<string, unknown> = {}) {
  const id = `p${unique()}00`.slice(0, 11);
  return prisma.video.create({
    data: {
      youtubeVideoId: id,
      kind: "LONG_FORM",
      classification: "LONG_FORM_CANDIDATE",
      reviewedAt: new Date(),
      status: "PUBLISHED",
      publishedAt: new Date(),
      availability: "AVAILABLE",
      title: `درس ${id}`,
      titleSearch: `درس ${id}`.toLowerCase(),
      channelTitle: `قناة ${id.slice(1, 4)}`,
      thumbnails: [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }],
      durationSeconds: 600,
      metadataFetchedAt: new Date(),
      feedKey: Math.floor(Math.random() * 1_000_000),
      ...overrides,
    },
  });
}

async function seedPlaylist(videos: { id: string }[], overrides: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.playlist.create({
    data: {
      type: "CURATED",
      title: `سلسلة ${id}`,
      slug: `series-${id}`,
      sourceKey: `cur:${id}`,
      introduction: "مقدمة السلسلة",
      status: "PUBLISHED",
      publishedAt: new Date(),
      itemCount: videos.length,
      items: { create: videos.map((video, position) => ({ videoId: video.id, position })) },
      ...overrides,
    },
  });
}

const seedYouTubePlaylist = (videos: { id: string }[]) => {
  const listId = `PL${unique()}${unique()}${unique()}`;
  return seedPlaylist(videos, {
    type: "YOUTUBE",
    youtubePlaylistId: listId,
    sourceKey: `yt:${listId}`,
    channelTitle: "قناة القائمة",
    thumbnails: [{ quality: "high", url: "https://i.ytimg.com/vi/list/hqdefault.jpg" }],
    syncStatus: "SYNCED",
    metadataFetchedAt: new Date(),
  });
};

async function signIn(page: Page, role: Parameters<typeof createAccount>[0], baseURL: string) {
  const account = await createAccount(role);
  await signInBrowser(page.context(), baseURL, account.sessionToken);
  return account;
}

const playerState = (page: Page) => page.evaluate(() => (window as unknown as { __ytCalls: { name: string; arg: unknown; videoId: string }[] }).__ytCalls);
const items = (page: Page) => page.getByTestId("playlist-item");
const readyPlayer = (page: Page) => expect(page.getByTestId("playlist-next").or(page.getByTestId("playlist-previous")).first()).toBeVisible();

async function waitForPlayer(page: Page) {
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(items(page).first()).toBeEnabled();
  await readyPlayer(page);
}

test.describe("a curated playlist", () => {
  test("plays any item in any order, in one player that nothing covers and that never starts by itself", async ({ page }) => {
    const videos = [await seedVideo(), await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/playlists/${playlist.slug}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(playlist.title);
    await expect(page.getByTestId("playlist-introduction")).toHaveText("مقدمة السلسلة");
    await waitForPlayer(page);

    const frame = page.locator("iframe");
    await expect(frame).toHaveAttribute("data-video-id", videos[0]!.youtubeVideoId);
    expect((await playerState(page)).filter((call) => call.name === "playVideo" || call.name === "loadVideoById")).toEqual([]);
    const options = await page.evaluate(() => (window as unknown as { __ytOptions: { playerVars: Record<string, unknown> }[] }).__ytOptions[0]!.playerVars);
    expect(options.autoplay).toBe(0);

    // Jump straight to the last one: there's no required order.
    await items(page).nth(2).click();
    await expect(frame).toHaveAttribute("data-video-id", videos[2]!.youtubeVideoId);
    await expect(items(page).nth(2)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("playlist-next")).toBeDisabled();

    await page.getByTestId("playlist-previous").click();
    await expect(frame).toHaveAttribute("data-video-id", videos[1]!.youtubeVideoId);
    await expect(page.locator("iframe")).toHaveCount(1);

    const covered = await frame.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const points = [0.1, 0.5, 0.9].flatMap((x) => [0.1, 0.5, 0.9].map((y) => [box.left + box.width * x, box.top + box.height * y] as const));
      return points.filter(([x, y]) => document.elementFromPoint(x, y) !== element).length;
    });
    expect(covered).toBe(0);
    const box = await frame.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(200);
  });

  test("stays on YouTube's end screen when a video ends, and offers next outside the player", async ({ page }) => {
    const videos = [await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);

    await page.evaluate(() => (window as unknown as { __ytPlayers: { __fireState: (state: number) => void }[] }).__ytPlayers[0]!.__fireState(0));
    await expect(page.getByTestId("playlist-message")).toContainText("انتهى المقطع");
    await expect(page.locator("iframe")).toHaveAttribute("data-video-id", videos[0]!.youtubeVideoId);
    expect((await playerState(page)).filter((call) => call.name === "loadVideoById")).toEqual([]);

    await page.getByTestId("playlist-next").click();
    await expect(page.locator("iframe")).toHaveAttribute("data-video-id", videos[1]!.youtubeVideoId);
  });

  test("credits YouTube on every item, and shows no statistics", async ({ page }) => {
    const videos = [await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/playlists/${playlist.slug}`);
    await expect(items(page)).toHaveCount(2);
    for (const item of await items(page).all()) await expect(item).toContainText("المصدر: YouTube");
    await expect(page.getByTestId("playlist-source")).toContainText("YouTube");
    await expect(page.getByTestId("playlist-count")).toHaveText("مقطعان");
  });

  test("a video that becomes unavailable simply leaves the list", async ({ page }) => {
    const live = await seedVideo();
    const gone = await seedVideo({ availability: "UNAVAILABLE" });
    const playlist = await seedPlaylist([gone, live]);
    await page.goto(`/playlists/${playlist.slug}`);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText(live.title);
  });

  test("with nothing available says so, and creates no player", async ({ page }) => {
    const playlist = await seedPlaylist([await seedVideo({ availability: "UNAVAILABLE" })]);
    await page.goto(`/playlists/${playlist.slug}`);
    await expect(page.getByText("لا توجد مقاطع متاحة في هذه القائمة حاليًا.")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});

test.describe("a YouTube playlist", () => {
  test("plays through YouTube's own playlist player, and credits its channel", async ({ page }) => {
    const videos = [await seedVideo({ status: "DRAFT" }), await seedVideo({ status: "DRAFT" })];
    const playlist = await seedYouTubePlaylist(videos);
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);

    await expect(page.locator("iframe")).toHaveAttribute("data-list", playlist.youtubePlaylistId!);
    await expect(page.getByTestId("playlist-source")).toContainText("قناة القائمة");
    await expect(page.getByTestId("playlist-on-youtube")).toHaveAttribute("href", `https://www.youtube.com/playlist?list=${playlist.youtubePlaylistId}`);

    await items(page).nth(1).click();
    const call = (await playerState(page)).find((entry) => entry.name === "playVideoAt");
    expect(call?.arg).toBe(1);
    await expect(items(page).nth(1)).toHaveAttribute("aria-current", "true");
  });

  test("follows YouTube's player when it moves on by itself", async ({ page }) => {
    const videos = [await seedVideo({ status: "DRAFT" }), await seedVideo({ status: "DRAFT" })];
    const playlist = await seedYouTubePlaylist(videos);
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);

    await page.evaluate((id) => {
      const player = (window as unknown as { __ytPlayers: { __setVideoId: (id: string) => void; __fireState: (state: number) => void }[] }).__ytPlayers[0]!;
      player.__setVideoId(id);
      player.__fireState(1);
    }, videos[1]!.youtubeVideoId);
    await expect(items(page).nth(1)).toHaveAttribute("aria-current", "true");
  });

  test("its videos don't appear elsewhere until reviewed", async ({ request }) => {
    const video = await seedVideo({ status: "DRAFT" });
    await seedYouTubePlaylist([video]);
    expect((await request.get(`/videos/${video.id}`)).status()).toBe(404);
  });

  test("the importer explains why it's unavailable with no API key", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    await page.goto("/admin/playlists/new");
    await expect(page.getByTestId("import-unavailable")).toContainText("مفتاح YouTube API");
    await expect(page.getByTestId("import-url")).toHaveCount(0);
  });

  test("its details can't be edited, and its order isn't editable", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const playlist = await seedYouTubePlaylist([await seedVideo(), await seedVideo()]);
    await page.goto(`/admin/playlists/${playlist.id}`);

    await expect(page.getByTestId("youtube-details")).toContainText(playlist.title);
    await expect(page.getByTestId("sync-status")).toContainText("متزامنة");
    await expect(page.getByTestId("youtube-form").getByLabel("العنوان")).toHaveCount(0);
    await expect(page.getByTestId("managed-item")).toHaveCount(2);
    await expect(page.getByTestId("drag-handle")).toHaveCount(0);
    await expect(page.getByTestId("move-up")).toHaveCount(0);

    await page.getByTestId("sync-now").click();
    await expect(page.getByTestId("sync-message")).toContainText("مفتاح YouTube API");
  });
});

test.describe("progress for signed-in people", () => {
  test("is saved as they watch, and resumes in another session", async ({ page, baseURL, browser }) => {
    const account = await signIn(page, "USER", baseURL!);
    const videos = [await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    const progressLoaded = page.waitForResponse((response) => response.url().includes("/api/progress?playlistId="));
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);
    // Only reports once it knows who is signed in.
    await progressLoaded;

    await items(page).nth(1).click();
    await page.evaluate(() => {
      const player = (window as unknown as { __ytPlayers: { __setTime: (seconds: number) => void; __fireState: (state: number) => void }[] }).__ytPlayers[0]!;
      player.__setTime(120);
      player.__fireState(2);
    });
    await expect.poll(() => prisma.viewingProgress.count({ where: { userId: account.id, videoId: videos[1]!.id, positionSeconds: 120 } })).toBe(1);
    await expect(items(page).nth(1).getByTestId("item-progress")).toBeVisible();

    // Another device, with the same account.
    const context = await browser.newContext({ baseURL });
    const other = await context.newPage();
    await context.route("https://www.youtube.com/iframe_api", (route) => page.context().request.get(`${baseURL}/`).then(() => route.fulfill({ contentType: "text/javascript", body: "window.YT={Player:function(el,o){var f=document.createElement('iframe');f.dataset.videoId=o.videoId||'';el.replaceWith(f);var t=0;this.loadVideoById=function(v){f.dataset.videoId=v.videoId;t=v.startSeconds;window.__resumedAt=t};this.getCurrentTime=function(){return t};this.getDuration=function(){return 600};this.getVideoUrl=function(){return ''};this.pauseVideo=function(){};this.destroy=function(){};setTimeout(function(){o.events.onReady({target:this})}.bind(this),0)}};window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();" })));
    await context.route("https://i.ytimg.com/**", (route) => route.abort());
    await signInBrowser(context, baseURL!, account.sessionToken);
    await other.goto(`/playlists/${playlist.slug}`);

    await other.getByTestId("playlist-resume").click();
    await expect(other.locator("iframe")).toHaveAttribute("data-video-id", videos[1]!.youtubeVideoId);
    expect(await other.evaluate(() => (window as unknown as { __resumedAt: number }).__resumedAt)).toBe(120);
    await context.close();
  });

  test("marks finished items", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const videos = [await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await prisma.viewingProgress.create({ data: { userId: account.id, videoId: videos[0]!.id, playlistId: playlist.id, scopeKey: `playlist:${playlist.id}`, positionSeconds: 600, durationSeconds: 600, isCompleted: true } });

    await page.goto(`/playlists/${playlist.slug}`);
    await expect(items(page).nth(0).getByTestId("item-completed")).toBeVisible();
    await expect(items(page).nth(1).getByTestId("item-completed")).toHaveCount(0);
    await expect(page.getByTestId("playlist-resume")).toHaveCount(0);
  });

  test("a guest is never asked to sign in by a dialog, and nothing is sent for them", async ({ page }) => {
    const playlist = await seedPlaylist([await seedVideo()]);
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/progress")) sent.push(request.method());
    });
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);
    await page.evaluate(() => {
      const player = (window as unknown as { __ytPlayers: { __setTime: (seconds: number) => void; __fireState: (state: number) => void }[] }).__ytPlayers[0]!;
      player.__setTime(120);
      player.__fireState(2);
    });

    await expect(page.getByTestId("progress-signin")).toHaveAttribute("href", /\/auth\/signin/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(sent).toEqual([]);
  });

  test("a long video's own page resumes too", async ({ page, baseURL }) => {
    const account = await signIn(page, "USER", baseURL!);
    const video = await seedVideo();
    await prisma.viewingProgress.create({ data: { userId: account.id, videoId: video.id, scopeKey: "video", positionSeconds: 95, durationSeconds: 600 } });

    await page.goto(`/videos/${video.id}`);
    await expect(page.getByTestId("video-resume")).toContainText("1:35");
    await page.getByTestId("video-resume").click();
    const call = (await playerState(page)).find((entry) => entry.name === "seekTo");
    expect(call?.arg).toBe(95);
  });

  test("refuses guests, other sites, and hidden content directly", async ({ page, request, baseURL }) => {
    const video = await seedVideo();
    const hidden = await seedVideo({ status: "DRAFT" });
    const data = { videoId: video.id, positionSeconds: 10 };
    const headers = { Origin: baseURL!, "Content-Type": "application/json" };

    expect((await request.put("/api/progress", { headers, data })).status()).toBe(401);
    expect((await request.get(`/api/progress?videoId=${video.id}`)).status()).toBe(401);

    const account = await signIn(page, "USER", baseURL!);
    expect((await page.request.put("/api/progress", { headers: { ...headers, Origin: "https://evil.example" }, data })).status()).toBe(403);
    expect((await page.request.put("/api/progress", { headers, data: { ...data, userId: "507f1f77bcf86cd799439011" } })).status()).toBe(400);
    expect((await page.request.put("/api/progress", { headers, data: { videoId: hidden.id, positionSeconds: 10 } })).status()).toBe(404);
    expect((await page.request.put("/api/progress", { headers, data })).status()).toBe(204);
    expect(await prisma.viewingProgress.count({ where: { userId: account.id } })).toBe(1);
  });
});

test.describe("managing a curated playlist", () => {
  const titles = (page: Page) => page.getByTestId("managed-title").allTextContents();

  test("an editor builds one from different channels, and an admin publishes it", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await signIn(page, "EDITOR", baseURL!);
    const [first, second] = [await seedVideo(), await seedVideo()];
    const title = `سلسلة جديدة ${unique()}`;

    await page.goto("/admin/playlists");
    await page.getByTestId("admin-create").click();
    await page.getByTestId("curated-form").getByLabel("العنوان").fill(title);
    await page.getByTestId("curated-form").getByLabel("المقدمة").fill("مقدمة كتبها المحرر");
    await page.getByTestId("form-save").click();
    await page.waitForURL(/\/admin\/playlists\/[a-f\d]{24}$/);

    const manager = page.getByTestId("playlist-items-manager");
    for (const video of [first, second]) {
      await manager.getByRole("searchbox").fill(video.titleSearch);
      await manager.getByRole("button", { name: video.title }).click();
      await expect(page.getByTestId("managed-item").filter({ hasText: video.title })).toBeVisible();
    }
    await expect.poll(() => titles(page)).toEqual([first.title, second.title]);

    // Editors can build but not publish.
    await expect(page.getByTestId("action-publish")).toHaveCount(0);
    const playlist = await prisma.playlist.findFirstOrThrow({ where: { title } });
    expect((await page.request.get(`/playlists/${encodeURIComponent(playlist.slug)}`)).status()).toBe(404);

    await signIn(page, "ADMIN", baseURL!);
    await page.goto(`/admin/playlists/${playlist.id}`);
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("action-unpublish")).toBeVisible();

    await page.goto(`/playlists/${encodeURIComponent(playlist.slug)}`);
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).first()).toContainText(first.title);
  });

  test("reorders with the arrows, and the order survives a reload and reaches readers", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const videos = [await seedVideo(), await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/admin/playlists/${playlist.id}`);

    await page.getByTestId("managed-item").nth(2).getByTestId("move-up").click();
    await expect.poll(() => titles(page)).toEqual([videos[0]!.title, videos[2]!.title, videos[1]!.title]);
    await expect(page.getByTestId("items-message")).toHaveText("تم الحفظ.");

    await page.reload();
    await expect.poll(() => titles(page)).toEqual([videos[0]!.title, videos[2]!.title, videos[1]!.title]);

    await page.goto(`/playlists/${playlist.slug}`);
    await expect(items(page).nth(1)).toContainText(videos[2]!.title);
  });

  test("reorders by keyboard alone, using drag and drop", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const videos = [await seedVideo(), await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/admin/playlists/${playlist.id}`);
    await expect(page.getByTestId("drag-handle")).toHaveCount(3);

    await page.waitForLoadState("networkidle");

    // Each announcement, in Arabic, confirms the step took effect before the next key.
    const announcer = page.locator("[aria-live]").filter({ hasText: /./ });
    await page.getByTestId("drag-handle").nth(0).focus();
    await page.keyboard.press("Space");
    await expect(announcer).toContainText("الموضع 1");
    await page.keyboard.press("ArrowDown");
    await expect(announcer).toContainText("الموضع 2");
    await page.keyboard.press("ArrowDown");
    await expect(announcer).toContainText("الموضع 3");
    await page.keyboard.press("Space");
    await expect(announcer).toContainText("أُفلت في الموضع 3");

    await expect.poll(() => titles(page)).toEqual([videos[1]!.title, videos[2]!.title, videos[0]!.title]);
    await expect(page.getByTestId("items-message")).toHaveText("تم الحفظ.");
    await expect.poll(async () => (await prisma.playlistItem.findMany({ where: { playlistId: playlist.id }, orderBy: { position: "asc" } })).map((item) => item.videoId)).toEqual([videos[1]!.id, videos[2]!.id, videos[0]!.id]);
  });

  test("reorders by mouse drag", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "A mouse drag is a desktop gesture. Phones use the arrows.");
    await signIn(page, "EDITOR", baseURL!);
    const videos = [await seedVideo(), await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/admin/playlists/${playlist.id}`);

    await page.waitForLoadState("networkidle");

    // The list sits below the form, and a mouse can only act on what is on screen.
    await page.getByTestId("playlist-items-manager").scrollIntoViewIfNeeded();
    const source = (await page.getByTestId("drag-handle").nth(2).boundingBox())!;
    const target = (await page.getByTestId("drag-handle").nth(0).boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, source.y - 10, { steps: 5 });
    await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 15 });
    await page.mouse.up();

    await expect.poll(() => titles(page)).toEqual([videos[2]!.title, videos[0]!.title, videos[1]!.title]);
    await expect(page.getByTestId("items-message")).toHaveText("تم الحفظ.");
  });

  test("a stale screen is told, and nothing is lost", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const videos = [await seedVideo(), await seedVideo()];
    const playlist = await seedPlaylist(videos);
    await page.goto(`/admin/playlists/${playlist.id}`);
    await expect(page.getByTestId("managed-item")).toHaveCount(2);

    const added = await seedVideo();
    await prisma.playlistItem.create({ data: { playlistId: playlist.id, videoId: added.id, position: 2 } });

    await page.getByTestId("managed-item").nth(1).getByTestId("move-up").click();
    await expect(page.getByTestId("items-message")).toContainText("تغيّرت القائمة");
    await expect.poll(() => titles(page)).toEqual([videos[0]!.title, videos[1]!.title]);
    expect(await prisma.playlistItem.count({ where: { playlistId: playlist.id } })).toBe(3);
  });

  test("removes an item, and the same video stays in other playlists", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const shared = await seedVideo();
    const [a, b] = [await seedPlaylist([shared, await seedVideo()]), await seedPlaylist([shared])];
    await page.goto(`/admin/playlists/${a.id}`);

    await page.getByTestId("managed-item").nth(0).getByTestId("remove-item").click();
    await expect(page.getByTestId("managed-item")).toHaveCount(1);
    expect(await prisma.playlistItem.count({ where: { playlistId: b.id, videoId: shared.id } })).toBe(1);
  });

  test("attaches a note, and it reaches readers", async ({ page, baseURL }) => {
    await signIn(page, "EDITOR", baseURL!);
    const playlist = await seedPlaylist([await seedVideo()]);
    await page.goto(`/admin/playlists/${playlist.id}`);
    await page.getByTestId("item-note").fill("ابدأ بهذا الدرس");
    await page.getByTestId("item-note").blur();
    await expect(page.getByTestId("items-message")).toHaveText("تم الحفظ.");

    await page.goto(`/playlists/${playlist.slug}`);
    await expect(items(page).first()).toContainText("ابدأ بهذا الدرس");
  });

  test("an empty playlist can't be published, and says why", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const playlist = await seedPlaylist([], { status: "DRAFT", publishedAt: null });
    await page.goto(`/admin/playlists/${playlist.id}`);
    await page.getByTestId("action-publish").click();
    await expect(page.getByTestId("status-message")).toContainText("لا يمكن نشر قائمة بلا مقاطع");
  });

  test("a contributor has no way in, and can't call the server directly", async ({ page, baseURL }) => {
    await signIn(page, "CONTRIBUTOR", baseURL!);
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "تنقل لوحة التحكم" }).getByRole("link", { name: "قوائم التشغيل" })).toHaveCount(0);

    const playlist = await seedPlaylist([await seedVideo()]);
    await page.goto(`/admin/playlists/${playlist.id}`);
    await expect(page.getByTestId("drag-handle")).toHaveCount(0);
    await expect(page.getByTestId("form-save")).toHaveCount(0);
    await expect(page.getByTestId("action-delete")).toHaveCount(0);
  });

  test("asks before deleting", async ({ page, baseURL }) => {
    await signIn(page, "ADMIN", baseURL!);
    const video = await seedVideo();
    const playlist = await seedPlaylist([video]);
    await page.goto(`/admin/playlists/${playlist.id}`);

    await page.getByTestId("action-delete").click();
    await page.getByTestId("confirm-yes").click();
    await page.waitForURL("**/admin/playlists");
    expect(await prisma.playlist.count({ where: { id: playlist.id } })).toBe(0);
    expect(await prisma.video.count({ where: { id: video.id } })).toBe(1);
  });
});

test.describe("connections", () => {
  test("a playlist shows related articles, topics, and playlists, and they link back", async ({ page }) => {
    const id = unique();
    const topic = await prisma.topic.create({ data: { title: `موضوع ${id}`, slug: `pt-${id}`, status: "PUBLISHED" } });
    const article = await prisma.article.create({ data: { title: `مقال ${id}`, slug: `pa-${id}`, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "نص" }] }] }, status: "PUBLISHED", publishedAt: new Date() } });
    const library = await prisma.library.create({ data: { name: `مكتبة ${id}`, slug: `pl-${id}`, status: "PUBLISHED" } });
    const clip = await seedVideo();
    const [main, sibling] = [await seedPlaylist([clip]), await seedPlaylist([clip])];
    for (const playlist of [main, sibling]) await prisma.playlistTopic.create({ data: { playlistId: playlist.id, topicId: topic.id } });
    await prisma.articlePlaylist.create({ data: { articleId: article.id, playlistId: main.id } });
    await prisma.playlistLibrary.create({ data: { playlistId: main.id, libraryId: library.id } });

    await page.goto(`/playlists/${main.slug}`);
    await expect(page.getByTestId("section-playlist-articles").getByText(article.title)).toBeVisible();
    await expect(page.getByTestId("section-playlist-topics").getByText(topic.title)).toBeVisible();
    await expect(page.getByTestId("section-playlist-related").getByText(sibling.title)).toBeVisible();
    await expect(page.getByTestId("section-playlist-libraries").getByText(library.name)).toBeVisible();

    await page.goto(`/topics/${topic.slug}`);
    await expect(page.getByTestId("section-playlists").getByText(main.title)).toBeVisible();
    await page.goto(`/libraries/${library.slug}`);
    await expect(page.getByTestId("section-playlists").getByText(main.title)).toBeVisible();
    await page.goto(`/articles/${article.slug}`);
    await expect(page.getByTestId("section-related-playlists").getByText(main.title)).toBeVisible();
  });

  test("a CTA to a playlist leads to it", async ({ page }) => {
    const playlist = await seedPlaylist([await seedVideo()]);
    const clip = await seedVideo({ cta: { type: "CURATED_PLAYLIST", targetId: playlist.id } });
    await page.goto(`/videos/${clip.id}`);
    await page.getByTestId("video-cta").click();
    await expect(page).toHaveURL(new RegExp(`/playlists/${playlist.slug}$`));
  });

  test("is reachable from the topics page, and the list shows only public playlists", async ({ page, request }) => {
    const live = await seedPlaylist([await seedVideo()], { isFeatured: true });
    const draft = await seedPlaylist([await seedVideo()], { status: "DRAFT" });
    const archived = await seedPlaylist([await seedVideo()], { isArchived: true });

    await page.goto("/topics");
    await page.getByRole("link", { name: "تصفّح قوائم التشغيل" }).click();
    await expect(page).toHaveURL(/\/playlists$/);
    await expect(page.getByTestId("playlist-card").filter({ hasText: live.title })).toHaveCount(1);
    await expect(page.getByTestId("playlist-card").filter({ hasText: draft.title })).toHaveCount(0);

    expect((await request.get(`/playlists/${draft.slug}`)).status()).toBe(404);
    expect((await request.get(`/playlists/${archived.slug}`)).status()).toBe(404);
    expect((await request.get("/playlists/does-not-exist")).status()).toBe(404);
  });
});

test.describe("layout and accessibility", () => {
  async function violations(page: Page) {
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);
  }
  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("public and dashboard screens fit a phone, with no accessibility violations", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const videos = [await seedVideo(), await seedVideo()];
    const curated = await seedPlaylist(videos, { description: "وصف" });
    const youtube = await seedYouTubePlaylist(videos);
    await page.setViewportSize({ width: 360, height: 740 });

    for (const path of ["/playlists", `/playlists/${curated.slug}`, `/playlists/${youtube.slug}`]) {
      await page.goto(path);
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
      expect(await violations(page), path).toEqual([]);
    }

    await signIn(page, "ADMIN", baseURL!);
    for (const path of ["/admin/playlists", "/admin/playlists/new", `/admin/playlists/${curated.id}`, `/admin/playlists/${youtube.id}`]) {
      await page.goto(path);
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
      expect(await violations(page), path).toEqual([]);
    }
  });

  test("on a phone, the player stays in view above the list, with nothing over it", async ({ page }) => {
    const videos = await Promise.all(Array.from({ length: 12 }, () => seedVideo()));
    const playlist = await seedPlaylist(videos);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const frame = page.locator("iframe");
    await expect(frame).toBeInViewport();
    const covered = await frame.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) !== element;
    });
    expect(covered).toBe(false);
  });

  test("keeps screenshots for visual review", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Reviewed once, at desktop width");
    const videos = await Promise.all(Array.from({ length: 5 }, () => seedVideo()));
    const playlist = await seedPlaylist(videos, { description: "وصف السلسلة" });
    await page.goto(`/playlists/${playlist.slug}`);
    await waitForPlayer(page);
    await page.screenshot({ path: "test-results/screens/playlist.png", fullPage: true });
  });
});
