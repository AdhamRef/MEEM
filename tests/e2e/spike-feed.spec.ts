import { expect, test, type Page } from "@playwright/test";

/**
 * TEMPORARY, removed with the /spike/feed page. It needs internet access to YouTube, so it
 * runs only when SPIKE_E2E=1. It checks structure in an emulated browser and is NOT a
 * substitute for testing gestures, autoplay, and sound on real phones.
 */
test.skip(!process.env.SPIKE_E2E, "Set SPIKE_E2E=1 to run the feed spike checks");
test.setTimeout(90_000);

// Public videos: YouTube's own IFrame API sample, and the first video uploaded to YouTube.
const VIDEO_IDS = ["M7lc1UVf-VE", "jNQXAC9IVRw", "M7lc1UVf-VE"];

const logText = (page: Page) => page.locator("pre").first().innerText();

for (const mode of ["recreate", "reuse"] as const) {
  test(`${mode} mode keeps one player, with nothing in front of it`, async ({ page }) => {
    await page.goto("/spike/feed");
    await page.getByLabel("Video IDs").fill(VIDEO_IDS.join("\n"));
    await page.getByLabel(mode).check();
    await page.getByRole("button", { name: "Start test" }).click();

    const player = page.locator("iframe");
    await expect(player).toHaveCount(1, { timeout: 30_000 });
    await expect(player).toHaveAttribute("src", /youtube\.com\/embed\/M7lc1UVf-VE/);

    const assertNothingCoversPlayer = async () => {
      const covered = await page.evaluate(() => {
        const frame = document.querySelector("iframe");
        if (!frame) return "no player";
        const box = frame.getBoundingClientRect();
        const points: [number, number][] = [
          [0.5, 0.5],
          [0.1, 0.1],
          [0.9, 0.1],
          [0.1, 0.9],
          [0.9, 0.9],
        ];
        for (const [x, y] of points) {
          const element = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
          if (element !== frame) return `covered at ${x},${y} by ${element?.tagName}`;
        }
        return box.width >= 200 && box.height >= 200 ? "ok" : `too small: ${box.width}x${box.height}`;
      });
      expect(covered).toBe("ok");
    };

    await assertNothingCoversPlayer();

    // The default state must not have produced the missing-referrer error.
    await expect.poll(() => logText(page), { timeout: 30_000 }).toContain("player ready");
    expect(await logText(page)).not.toContain("ERROR code 153");

    await page.getByRole("button", { name: "Next" }).first().click();

    await expect(player).toHaveCount(1);
    await expect.poll(() => logText(page), { timeout: 30_000 }).toContain("jNQXAC9IVRw");
    await page.waitForTimeout(1_000);
    await expect(player).toHaveCount(1);
    await assertNothingCoversPlayer();

    console.log(`--- ${mode} log (newest first) ---\n${await logText(page)}`);
  });

  // Someone can swipe before the first player has finished loading.
  test(`${mode} mode survives moving on before the player is ready`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/spike/feed");
    await page.getByLabel("Video IDs").fill(VIDEO_IDS.join("\n"));
    await page.getByLabel(mode).check();
    await page.getByRole("button", { name: "Start test" }).click();
    await page.getByRole("button", { name: "Next" }).first().click();

    await expect(page.locator("iframe")).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(() => logText(page), { timeout: 30_000 }).toContain("jNQXAC9IVRw");
    await expect(page.locator("iframe")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
