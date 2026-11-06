import type { WatchSummary } from "@/features/recommendations/watch-rules";
import type { PlaybackState } from "@/hooks/useActivePlayer";
import { loadYouTubeIframeApi, PLAYER_STATE, type YouTubePlayer } from "./iframe-api";

export interface PoolTarget {
  /** Identifies this card, since a video can come round again later in an endless feed. */
  key: string;
  index: number;
  videoId: string;
}

export interface PoolEvents {
  place: (mount: HTMLElement, index: number) => void;
  onPlayback: (videoId: string | null, state: PlaybackState, errorCode: number | null) => void;
  onMuted: (isMuted: boolean) => void;
  /** True while sound is wanted but the browser won't allow it until the person acts. */
  onSoundLocked: (isLocked: boolean) => void;
  /** The card sliding away, still running so it doesn't turn back into its thumbnail on the way out. */
  onLeaving: (key: string | null) => void;
  onWatchFinished: (videoId: string, watch: Omit<WatchSummary, "durationSeconds"> & { timesEnded: number }) => void;
}

type Phase = "empty" | "priming" | "primed" | "active" | "leaving";

interface Slot {
  mount: HTMLElement;
  player: YouTubePlayer | null;
  isReady: boolean;
  key: string | null;
  index: number;
  videoId: string | null;
  /** What the player itself holds, which can lag behind what it's assigned. */
  loadedVideoId: string | null;
  /** It has really shown this video's picture, so its card needs no thumbnail once it plays. */
  hasFrame: boolean;
  phase: Phase;
  errorCode: number | null;
  usedAt: number;
  stopPriming: (() => void) | null;
}

interface WatchTracker {
  videoId: string;
  didStartPlaying: boolean;
  timesEnded: number;
  hasFirstFrame: boolean;
}

const SOUND_PREFERENCE_KEY = "feed.sound";
/** Long enough for a slow connection. After this, the person gets a play button, not an endless loader. */
const LOADING_GIVE_UP_MS = 8000;
const CLOCK_CHECK_MS = 50;
/** If the time never seems to move, showing the player beats hiding a video that may be running. */
const FIRST_FRAME_GIVE_UP_MS = 2500;
/** A prepared player that hasn't started by now is left paused, so an ad or a stall can't run on unseen. */
const PRIMING_GIVE_UP_MS = 6000;
/** Buffering waits this long for the card on screen to start, as it shouldn't compete with it. */
const PRIMING_WAITS_FOR_ACTIVE_MS = 1500;
/** Longer than a swipe takes to settle. The card left behind keeps moving, muted, until it's out of sight. */
const LEAVING_MS = 600;
/** Measured on the real player: a refused unMute pauses the video within about this time. */
const SOUND_REFUSAL_WINDOW_MS = 2000;

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSoundPreference(isOn: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, isOn ? "on" : "off");
  } catch {
    // Blocked storage only means the choice isn't remembered next time.
  }
}

export const hasBrowserActivation = () => navigator.userActivation?.hasBeenActive === true;

/**
 * OWNER'S DECISION, 2026-11-06, made knowing it breaks YouTube's rules: the feed keeps real players
 * buffered ahead on the coming cards, so swiping onto one starts it at once. YouTube fetches nothing
 * until a video plays, so each one plays muted out of sight until its first frame, then rewinds
 * and waits. Measured on the real player, that starts a video in about 0.3 seconds against 1 to 1.8.
 * See FEED_BUFFER_AHEAD. The one active player is the only one ever heard or seen.
 */
export class FeedPlayerPool {
  private readonly slots: Slot[];
  private activeSlot: Slot | null = null;
  private tracker: WatchTracker | null = null;
  private upcoming: PoolTarget[] = [];
  private isDestroyed = false;
  private wantsSound = readSoundPreference();
  private soundIsAllowed = false;
  private isLocked = false;
  private soundRefusalUntil = 0;
  private isExpectingPause = false;
  private wasPausedForView = false;
  private isActiveStarted = false;
  private isPlayingNow = false;
  private isMutedNow = true;
  private stopFirstFrameCheck: (() => void) | null = null;
  private loadingGiveUp: ReturnType<typeof setTimeout> | null = null;
  private primingWait: ReturnType<typeof setTimeout> | null = null;
  private leavingSlot: Slot | null = null;
  private leavingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    mounts: HTMLElement[],
    private readonly events: PoolEvents,
  ) {
    this.slots = mounts.map((mount) => ({ mount, player: null, isReady: false, key: null, index: -1, videoId: null, loadedVideoId: null, hasFrame: false, phase: "empty", errorCode: null, usedAt: 0, stopPriming: null }));
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    // Bubbling, so a tap's own handler acts first and this only catches what it left undone.
    window.addEventListener("click", this.onGesture);
    window.addEventListener("keydown", this.onKeyGesture);
  }

  setTargets(active: PoolTarget | null, upcoming: PoolTarget[]): void {
    this.upcoming = upcoming;
    if ((active?.key ?? null) !== (this.activeSlot?.key ?? null)) this.activate(active);
    if (!active && upcoming.length === 0) this.releaseAll();
    this.primeNext();
  }

  /** Nothing to show, such as an empty tab. A player left in place would sit over that tab's message. */
  private releaseAll(): void {
    for (const slot of this.slots) {
      if (slot.phase === "priming") {
        slot.stopPriming?.();
        if (slot.isReady) slot.player?.pauseVideo();
      }
      slot.hasFrame = false;
      slot.key = null;
      slot.phase = "empty";
      slot.mount.style.display = "none";
    }
  }

  setInView(isInView: boolean): void {
    const slot = this.activeSlot;
    if (!slot?.player || !slot.isReady) return;
    if (!isInView) {
      this.wasPausedForView = true;
      this.isExpectingPause = true;
      slot.player.pauseVideo();
    } else if (this.wasPausedForView) {
      this.wasPausedForView = false;
      slot.player.playVideo();
    }
  }

  reposition(): void {
    for (const slot of this.slots) if (slot.key !== null) this.events.place(slot.mount, slot.index);
  }

  /**
   * The tap on the welcome screen, which is what lets a browser allow sound. The video has been
   * running silently behind it, so it goes back to its start and is heard from the first moment.
   */
  beginWithSound(): void {
    this.wantsSound = true;
    this.soundIsAllowed = true;
    const slot = this.activeSlot;
    if (!slot?.player || !slot.isReady) return;
    slot.player.seekTo(0, true);
    this.turnSoundOn(slot.player);
    slot.player.playVideo();
  }

  /** From a person's action, using the documented mute and unMute methods. */
  toggleSound(): void {
    const player = this.activeSlot?.player;
    if (!player || !this.activeSlot?.isReady) return;
    // Acts on what the button shows. The player reports its state late, so asking it could undo a quick second tap.
    if (this.isMutedNow) {
      this.wantsSound = true;
      saveSoundPreference(true);
      this.turnSoundOn(player);
    } else {
      this.wantsSound = false;
      saveSoundPreference(false);
      player.mute();
      this.report(true, false);
    }
  }

  togglePlay(): void {
    const slot = this.activeSlot;
    if (!slot?.player || !slot.isReady) return;
    if (this.isPlayingNow) {
      this.isExpectingPause = true;
      slot.player.pauseVideo();
    } else {
      slot.player.playVideo();
    }
  }

  destroy(): void {
    this.finishWatch();
    this.isDestroyed = true;
    this.clearWaits();
    if (this.leavingTimer) clearTimeout(this.leavingTimer);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("click", this.onGesture);
    window.removeEventListener("keydown", this.onKeyGesture);
    for (const slot of this.slots) {
      slot.stopPriming?.();
      try {
        slot.player?.destroy();
      } catch {
        // Nothing to clean up if YouTube already removed it.
      }
      slot.mount.replaceChildren();
    }
  }

  private report(isMuted: boolean, isLocked: boolean): void {
    this.isMutedNow = isMuted;
    this.isLocked = isLocked;
    this.events.onMuted(isMuted);
    this.events.onSoundLocked(isLocked);
  }

  private clearWaits(): void {
    this.stopFirstFrameCheck?.();
    if (this.loadingGiveUp) clearTimeout(this.loadingGiveUp);
    if (this.primingWait) clearTimeout(this.primingWait);
    this.loadingGiveUp = null;
    this.primingWait = null;
  }

  private activate(target: PoolTarget | null): void {
    const previous = this.activeSlot;
    if (previous) this.leave(previous);
    this.activeSlot = null;
    this.isActiveStarted = false;
    this.isPlayingNow = false;
    this.wasPausedForView = false;
    if (!target) return;

    const slot = this.slots.find((candidate) => candidate.key === target.key) ?? this.slotToReuse(target);
    if (slot === this.leavingSlot) this.stopLeaving();
    if (slot.key !== target.key) this.assign(slot, target);
    this.activeSlot = slot;
    slot.usedAt = Date.now();
    slot.mount.dataset.playerRole = "active";
    slot.mount.inert = false;

    const tracker: WatchTracker = { videoId: target.videoId, didStartPlaying: false, timesEnded: 0, hasFirstFrame: false };
    this.tracker = tracker;
    this.events.onPlayback(target.videoId, "loading", null);
    this.loadingGiveUp = setTimeout(() => {
      if (this.tracker === tracker && !tracker.hasFirstFrame) this.events.onPlayback(target.videoId, "blocked", null);
    }, LOADING_GIVE_UP_MS);
    this.primingWait = setTimeout(() => this.onActiveStarted(), PRIMING_WAITS_FOR_ACTIVE_MS);

    if (!slot.player) this.createPlayer(slot, target.videoId, true);
    else if (slot.isReady) this.startActive(slot);
  }

  private leave(slot: Slot): void {
    const wasPlaying = this.isPlayingNow && this.tracker?.hasFirstFrame === true;
    this.finishWatch();
    this.clearWaits();
    slot.mount.dataset.playerRole = "buffer";
    slot.mount.inert = true;
    this.isExpectingPause = false;
    this.settleLeaving();
    if (slot.phase === "active") slot.phase = "primed";
    if (!slot.player || !slot.isReady) return;
    if (!wasPlaying) {
      this.rewind(slot);
      return;
    }
    // Silent at once, but still moving while it slides out, which is what a thumbnail would break.
    slot.player.mute();
    slot.phase = "leaving";
    this.leavingSlot = slot;
    this.events.onLeaving(slot.key);
    this.leavingTimer = setTimeout(() => this.settleLeaving(), LEAVING_MS);
  }

  /** Coming back within moments carries on where it was, so a small wobble of a finger changes nothing. */
  private stopLeaving(): void {
    if (this.leavingTimer) clearTimeout(this.leavingTimer);
    this.leavingTimer = null;
    this.leavingSlot = null;
    this.events.onLeaving(null);
  }

  private settleLeaving(): void {
    const slot = this.leavingSlot;
    if (!slot) return;
    this.stopLeaving();
    if (slot.phase !== "leaving") return;
    slot.phase = "primed";
    this.rewind(slot);
  }

  /** Swiping back starts it from the top, as a fresh card does, with its buffer still there. */
  private rewind(slot: Slot): void {
    try {
      slot.player?.mute();
      slot.player?.pauseVideo();
      slot.player?.seekTo(0, true);
      slot.player?.pauseVideo();
    } catch {
      // Being torn down.
    }
  }

  /** The slot holding whatever matters least: an empty one, then a card no longer needed, then the farthest ahead. */
  private slotToReuse(target: PoolTarget): Slot {
    return this.freeSlot(target.key) ?? [...this.slots].reverse().find((slot) => slot.key !== null) ?? this.slots[0]!;
  }

  private freeSlot(forKey: string): Slot | null {
    const empty = this.slots.find((slot) => slot.key === null);
    if (empty) return empty;
    const needed = new Set([forKey, ...this.upcoming.map((target) => target.key)]);
    const unneeded = this.slots.filter((slot) => slot !== this.activeSlot && !needed.has(slot.key!) && slot.phase !== "priming" && slot.phase !== "leaving");
    return unneeded.sort((a, b) => a.usedAt - b.usedAt)[0] ?? null;
  }

  private assign(slot: Slot, target: PoolTarget): void {
    slot.stopPriming?.();
    slot.key = target.key;
    slot.index = target.index;
    slot.videoId = target.videoId;
    slot.errorCode = null;
    slot.hasFrame = false;
    slot.phase = "empty";
    slot.mount.dataset.playerRole = "buffer";
    slot.mount.inert = true;
    this.events.place(slot.mount, target.index);
  }

  private startActive(slot: Slot): void {
    const player = slot.player!;
    const wasLeaving = slot.phase === "leaving";
    slot.stopPriming?.();
    slot.phase = "active";

    if (this.wantsSound && this.canHaveSound()) {
      this.turnSoundOn(player);
    } else {
      player.mute();
      this.report(true, this.wantsSound);
    }

    if (slot.loadedVideoId === slot.videoId) {
      player.playVideo();
    } else {
      slot.loadedVideoId = slot.videoId;
      player.loadVideoById(slot.videoId!);
    }
    if (slot.errorCode !== null) this.events.onPlayback(slot.videoId, "error", slot.errorCode);
    // Still running, so YouTube won't report a change of state to go by.
    if (wasLeaving && this.tracker) this.revealNow(this.tracker);
  }

  /** The picture is already there, so nothing is waited for and the thumbnail goes this instant. */
  private revealNow(tracker: WatchTracker): void {
    this.stopFirstFrameCheck?.();
    if (this.loadingGiveUp) clearTimeout(this.loadingGiveUp);
    this.loadingGiveUp = null;
    tracker.didStartPlaying = true;
    tracker.hasFirstFrame = true;
    this.isPlayingNow = true;
    this.events.onPlayback(tracker.videoId, "playing", null);
    this.onActiveStarted();
  }

  private canHaveSound(): boolean {
    return this.soundIsAllowed || hasBrowserActivation();
  }

  private turnSoundOn(player: YouTubePlayer): void {
    player.unMute();
    this.soundRefusalUntil = Date.now() + SOUND_REFUSAL_WINDOW_MS;
    this.report(false, false);
  }

  /** The browser said no. The video keeps going muted, and the next tap anywhere asks again. */
  private fallBackToMuted(player: YouTubePlayer): void {
    // The window stays open, because the refusal's own pause can still arrive after this.
    this.soundIsAllowed = false;
    player.mute();
    player.playVideo();
    this.report(true, this.wantsSound);
  }

  private primeNext(): void {
    if (this.isDestroyed || document.hidden) return;
    if (this.activeSlot && !this.isActiveStarted) return;
    // One at a time, nearest first, so buffering never crowds the network or the phone.
    if (this.slots.some((slot) => slot.phase === "priming")) return;

    for (const target of this.upcoming) {
      if (this.slots.some((slot) => slot.key === target.key)) continue;
      const slot = this.freeSlot(target.key);
      if (!slot) return;
      this.assign(slot, target);
      slot.phase = "priming";
      slot.usedAt = Date.now();
      if (!slot.player) this.createPlayer(slot, target.videoId, false);
      else if (slot.isReady) this.beginPriming(slot);
      return;
    }
  }

  private beginPriming(slot: Slot): void {
    const player = slot.player!;
    player.mute();
    if (slot.loadedVideoId === slot.videoId) {
      player.playVideo();
    } else {
      slot.loadedVideoId = slot.videoId;
      player.loadVideoById(slot.videoId!);
    }

    const videoId = slot.videoId!;
    const startedAt = Date.now();
    let firstTime: number | null = null;
    const timer = setInterval(() => {
      let hasMoved = false;
      try {
        if (player.getVideoUrl().includes(videoId)) {
          const time = player.getCurrentTime();
          firstTime ??= time;
          hasMoved = time !== firstTime;
        }
      } catch {
        // Time running out below settles it.
      }
      if (hasMoved) slot.hasFrame = true;
      if (hasMoved || Date.now() - startedAt > PRIMING_GIVE_UP_MS) this.finishPriming(slot);
    }, CLOCK_CHECK_MS);
    slot.stopPriming = () => {
      clearInterval(timer);
      slot.stopPriming = null;
    };
  }

  private finishPriming(slot: Slot): void {
    slot.stopPriming?.();
    slot.phase = "primed";
    try {
      slot.player?.pauseVideo();
      slot.player?.seekTo(0, true);
      slot.player?.pauseVideo();
    } catch {
      // Being torn down.
    }
    this.primeNext();
  }

  private onActiveStarted(): void {
    if (this.primingWait) clearTimeout(this.primingWait);
    this.primingWait = null;
    this.isActiveStarted = true;
    this.primeNext();
  }

  private createPlayer(slot: Slot, videoId: string, isActive: boolean): void {
    slot.isReady = false;
    slot.loadedVideoId = videoId;
    // A phone never allows sound before a touch, so asking would only delay the first video.
    const asksForSound = isActive && this.wantsSound && (hasBrowserActivation() || !window.matchMedia("(pointer: coarse)").matches);

    loadYouTubeIframeApi().then(
      (youtube) => {
        if (this.isDestroyed) return;
        const element = document.createElement("div");
        slot.mount.replaceChildren(element);
        slot.player = new youtube.Player(element, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: isActive ? 1 : 0,
            mute: asksForSound ? 0 : 1,
            playsinline: 1,
            controls: 0,
            enablejsapi: 1,
            // A documented setting: no annotations over the video.
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => this.onReady(slot, asksForSound),
            onStateChange: ({ data, target }) => this.onStateChange(slot, target, data),
            onError: ({ data }) => this.onError(slot, data ?? null),
            onAutoplayBlocked: ({ target }) => this.onAutoplayBlocked(slot, target),
          },
        });
      },
      () => {
        if (this.activeSlot === slot) this.events.onPlayback(videoId, "error", null);
      },
    );
  }

  private onReady(slot: Slot, askedForSound: boolean): void {
    slot.isReady = true;
    if (this.activeSlot === slot) {
      if (askedForSound && !this.canHaveSound() && slot.loadedVideoId === slot.videoId) {
        // Already asked for sound. The browser answers with onAutoplayBlocked if it refuses.
        slot.phase = "active";
        this.report(false, false);
        slot.player!.playVideo();
      } else {
        this.startActive(slot);
      }
    } else if (slot.phase === "priming") {
      this.beginPriming(slot);
    }
  }

  private onStateChange(slot: Slot, player: YouTubePlayer, state: number | undefined): void {
    if (slot !== this.activeSlot) {
      // A prepared player stays still until its card arrives.
      if (slot.phase === "primed" && state === PLAYER_STATE.PLAYING) player.pauseVideo();
      return;
    }
    const tracker = this.tracker;
    if (!tracker) return;

    if (state === PLAYER_STATE.PLAYING) {
      tracker.didStartPlaying = true;
      this.isPlayingNow = true;
      this.isExpectingPause = false;
      if (tracker.hasFirstFrame) this.events.onPlayback(tracker.videoId, "playing", null);
      // Buffered ahead, so its picture has already been seen. Waiting for the clock only costs time.
      else if (slot.hasFrame) this.revealNow(tracker);
      else this.waitForFirstFrame(player, tracker);
      return;
    }

    this.isPlayingNow = false;
    this.stopFirstFrameCheck?.();
    if (state === PLAYER_STATE.PAUSED) {
      if (!this.isExpectingPause && Date.now() < this.soundRefusalUntil) {
        this.fallBackToMuted(player);
        return;
      }
      if (tracker.hasFirstFrame) this.events.onPlayback(tracker.videoId, "paused", null);
    } else if (state === PLAYER_STATE.ENDED) {
      tracker.timesEnded += 1;
      player.seekTo(0, true);
      player.playVideo();
    }
  }

  private waitForFirstFrame(player: YouTubePlayer, tracker: WatchTracker): void {
    this.stopFirstFrameCheck?.();
    const startedAt = Date.now();
    let firstTime: number | null = null;
    const check = () => {
      let hasMoved = false;
      try {
        // A reused player can still be reporting the previous video.
        if (player.getVideoUrl().includes(tracker.videoId)) {
          const time = player.getCurrentTime();
          firstTime ??= time;
          hasMoved = time !== firstTime;
        }
      } catch {
        // Being torn down. Time running out below settles it.
      }
      if (!hasMoved && Date.now() - startedAt < FIRST_FRAME_GIVE_UP_MS) return;
      this.stopFirstFrameCheck?.();
      if (this.loadingGiveUp) clearTimeout(this.loadingGiveUp);
      this.loadingGiveUp = null;
      tracker.hasFirstFrame = true;
      if (this.tracker !== tracker) return;
      if (hasMoved && !this.isMutedNow) this.soundIsAllowed = true;
      if (hasMoved && this.activeSlot) this.activeSlot.hasFrame = true;
      this.events.onPlayback(tracker.videoId, "playing", null);
      this.onActiveStarted();
    };
    const timer = setInterval(check, CLOCK_CHECK_MS);
    this.stopFirstFrameCheck = () => {
      clearInterval(timer);
      this.stopFirstFrameCheck = null;
    };
  }

  private onError(slot: Slot, code: number | null): void {
    slot.errorCode = code;
    if (slot === this.activeSlot) {
      this.clearWaits();
      this.events.onPlayback(slot.videoId, "error", code);
      this.onActiveStarted();
    } else if (slot.phase === "priming") {
      this.finishPriming(slot);
    }
  }

  private onAutoplayBlocked(slot: Slot, player: YouTubePlayer): void {
    if (slot !== this.activeSlot) {
      // It'll be started when its card arrives, when that's allowed.
      if (slot.phase === "priming") this.finishPriming(slot);
      return;
    }
    if (!this.isMutedNow) {
      this.fallBackToMuted(player);
      return;
    }
    this.clearWaits();
    this.events.onPlayback(slot.videoId, "blocked", null);
    this.onActiveStarted();
  }

  private finishWatch(): void {
    const tracker = this.tracker;
    this.tracker = null;
    if (!tracker) return;

    let watchedSeconds = 0;
    const slot = this.activeSlot;
    if (slot?.player && slot.isReady) {
      try {
        watchedSeconds = slot.player.getCurrentTime();
      } catch {
        // The summary just reports what's known.
      }
    }
    this.events.onWatchFinished(tracker.videoId, { didStartPlaying: tracker.didStartPlaying, didEnd: tracker.timesEnded > 0, watchedSeconds, timesEnded: tracker.timesEnded });
  }

  private readonly onGesture = (): void => {
    const slot = this.activeSlot;
    if (!this.isLocked || !this.wantsSound || !slot?.player || !slot.isReady) return;
    this.turnSoundOn(slot.player);
  };

  private readonly onKeyGesture = (event: KeyboardEvent): void => {
    // M is the sound key, with a handler of its own.
    if (event.key.toLowerCase() !== "m") this.onGesture();
  };

  // Nothing plays in the background (policy III.E). The video on screen stays paused on return until asked.
  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) {
      this.primeNext();
      return;
    }
    this.settleLeaving();
    for (const slot of this.slots) {
      if (slot.phase === "priming") {
        slot.stopPriming?.();
        slot.phase = "empty";
        slot.key = null;
      }
      if (!slot.player || !slot.isReady) continue;
      if (slot === this.activeSlot) this.isExpectingPause = true;
      slot.player.pauseVideo();
    }
  };
}
