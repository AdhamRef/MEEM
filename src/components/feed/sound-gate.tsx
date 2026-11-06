import { Play } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { strings } from "@/config/strings.ar";

/**
 * The opening screen. No browser allows sound until a person has touched the page, so this one
 * tap is what lets the very first video play out loud, and every video after it.
 * The whole screen is the button, and it only appears where the browser would refuse.
 */
export function SoundGate({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      autoFocus
      onClick={onStart}
      data-testid="sound-gate"
      className="group fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black text-white outline-none"
    >
      <span className="feed-loader-mark relative flex size-32 items-center justify-center">
        <span aria-hidden className="feed-loader-glow absolute inset-4 rounded-full" />
        <BrandMark className="feed-loader-logo relative size-20" />
      </span>
      <span className="text-4xl font-bold tracking-wide">{strings.app.name}</span>
      <span className="mt-2 flex min-h-12 items-center gap-2 rounded-full bg-brand px-8 text-lg font-semibold text-primary-foreground group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
        <Play aria-hidden className="size-5 fill-current" />
        {strings.feed.startWatching}
      </span>
      <span className="text-sm text-white/70">{strings.feed.startWatchingHint}</span>
    </button>
  );
}
