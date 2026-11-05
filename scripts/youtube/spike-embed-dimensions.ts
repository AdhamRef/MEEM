import "../load-env";

/**
 * TEMPORARY Phase 1 test: does videos.list report usable player dimensions that help
 * tell vertical Shorts from wide videos? If so, it becomes a review signal in the importer.
 *
 * Usage: npm exec tsx scripts/youtube/spike-embed-dimensions.ts <id> <id> ...
 * Include some known Shorts and some normal wide videos. Costs 1 quota unit per 50 IDs.
 */
const key = process.env.YOUTUBE_API_KEY;
const ids = process.argv.slice(2);

if (!key || ids.length === 0) {
  console.error("Set YOUTUBE_API_KEY in .env and pass at least one video ID.");
  process.exit(1);
}

const url = new URL("https://www.googleapis.com/youtube/v3/videos");
url.searchParams.set("part", "player,contentDetails,status");
url.searchParams.set("id", ids.slice(0, 50).join(","));
url.searchParams.set("maxHeight", "720");
url.searchParams.set("key", key);

const response = await fetch(url);
if (!response.ok) {
  // Reads only the error status. The URL contains the API key, so it is never printed.
  console.error(`YouTube API responded with ${response.status}`);
  process.exit(1);
}

const data = (await response.json()) as {
  items: {
    id: string;
    player?: { embedWidth?: string; embedHeight?: string };
    contentDetails?: { duration?: string };
    status?: { embeddable?: boolean };
  }[];
};

console.table(
  data.items.map((item) => {
    const width = Number(item.player?.embedWidth);
    const height = Number(item.player?.embedHeight);
    return {
      id: item.id,
      duration: item.contentDetails?.duration,
      embeddable: item.status?.embeddable,
      width,
      height,
      shape: !width || !height ? "not reported" : height > width ? "vertical" : height === width ? "square" : "wide",
    };
  }),
);
