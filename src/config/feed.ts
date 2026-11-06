/**
 * "reuse" keeps one player and loads each video into it. "recreate" makes a new player per video.
 * PROVISIONAL: real-phone testing (Phase 1, still open) decides this. Reuse is the default
 * because a browser ties permission for sound to the player the person touched, so it's
 * the likelier of the two to keep sound on between videos. This line is the only thing to change.
 */
export const FEED_PLAYER_STRATEGY: "reuse" | "recreate" = "reuse";

/**
 * OWNER'S DECISION, 2026-11-05, made knowing it breaks YouTube's rules. True puts our interface
 * and a touch layer in front of the player, crops YouTube's own interface out of view, covers
 * the player with a thumbnail until its first frame, and loops videos past YouTube's end screen.
 * This risks API access and embeds, and it won't pass the API Compliance Audit.
 * False restores the layout that follows the rules, and this line is the only thing to change.
 */
export const FEED_IMMERSIVE_OVERLAY: boolean = true;
/** Extra frame height above and below the video, clipped off. YouTube's bars and gradients land there. */
export const FEED_CROP_PIXELS = 140;

/**
 * A card counts as active at this share visible. YouTube requires over half before autoplay, so
 * that's what the compliant layout uses. The immersive one starts as soon as a finger moves, so the
 * video is already running by the time the card has settled. Scrolling back is handled when scrolling settles.
 */
export const FEED_ACTIVE_THRESHOLD = FEED_IMMERSIVE_OVERLAY ? 0.05 : 0.6;
/** Below this share visible, the playing video pauses. */
export const FEED_PAUSE_THRESHOLD = 0.5;
/** Fetches the next page while this many cards are still ahead. */
export const FEED_LOAD_AHEAD = 6;
/** How many of each kind Explore's grid asks for at a time. */
export const EXPLORE_LONG_PAGE = 24;
export const EXPLORE_SHORTS_PAGE = 12;

/** Thumbnails loaded ahead of the active card, which is further than players are buffered. */
export const FEED_PRELOAD_THUMBNAILS = 5;

/**
 * OWNER'S DECISION, 2026-11-06, made knowing it breaks YouTube's rules: real players stay buffered
 * on this many coming cards, so a swipe starts the next video in about 0.3 seconds rather than 1 to
 * 1.8. To buffer, each plays muted out of sight until its first frame. That may trigger hidden ads
 * or count as artificial playback, adds to the risk to API access, and won't pass the API
 * Compliance Audit. The pool also starts the feed with sound whenever the browser allows it. Zero
 * restores one player per page and muted autoplay, and this line is the only thing to change.
 */
export const FEED_BUFFER_AHEAD: number = FEED_IMMERSIVE_OVERLAY ? 4 : 0;

interface DeviceHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Each player is a whole iframe, so small phones keep fewer, and data saver is respected. */
export function feedBufferAheadForDevice(): number {
  if (FEED_BUFFER_AHEAD === 0) return 0;
  const { deviceMemory, connection } = navigator as Navigator & DeviceHints;
  if (connection?.saveData) return 1;
  if (deviceMemory !== undefined && deviceMemory <= 4) return Math.min(FEED_BUFFER_AHEAD, 3);
  return FEED_BUFFER_AHEAD;
}
