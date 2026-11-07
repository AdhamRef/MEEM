/** The documented parts of the IFrame Player API this application uses, and no others. */
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  loadVideoById(video: string | { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoUrl(): string;
  playVideoAt(index: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(suggestedRate: number): void;
  destroy(): void;
}

interface PlayerEvent {
  target: YouTubePlayer;
  data?: number;
}

export interface YouTubePlayerOptions {
  /** Left out for a playlist, which is named in playerVars instead. */
  videoId?: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady: (event: PlayerEvent) => void;
    onStateChange: (event: PlayerEvent) => void;
    onError: (event: PlayerEvent) => void;
    onAutoplayBlocked: (event: PlayerEvent) => void;
  };
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

interface YouTubeWindow {
  YT?: YouTubeNamespace;
  onYouTubeIframeAPIReady?: () => void;
}

export const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

let loading: Promise<YouTubeNamespace> | undefined;

/** Loads YouTube's script once. */
export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  const target = window as unknown as YouTubeWindow;

  loading ??= new Promise((resolve, reject) => {
    if (target.YT?.Player) {
      resolve(target.YT);
      return;
    }
    target.onYouTubeIframeAPIReady = () => resolve(target.YT!);

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      // Allows another attempt, for example after a dropped connection.
      loading = undefined;
      reject(new Error("The YouTube player script failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
