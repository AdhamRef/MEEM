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
 * that's what the compliant layout uses. The immersive one starts on the way in, so most of the
 * loading happens during the swipe. Scrolling back is handled when scrolling settles.
 */
export const FEED_ACTIVE_THRESHOLD = FEED_IMMERSIVE_OVERLAY ? 0.15 : 0.6;
/** Below this share visible, the playing video pauses. */
export const FEED_PAUSE_THRESHOLD = 0.5;
/** Fetches the next page while this many cards are still ahead. */
export const FEED_LOAD_AHEAD = 6;
/**
 * Thumbnails loaded ahead of the active card. Players aren't, because measuring the real player
 * showed no gain: YouTube downloads nothing until playback starts, a prepared player started
 * in 1.1 to 3.2 seconds against 0.9 to 1.4 for the reused one, and each costs a whole iframe.
 */
export const FEED_PRELOAD_THUMBNAILS = 5;
