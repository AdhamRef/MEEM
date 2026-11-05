import { BrandMark } from "@/components/shared/brand-mark";
import { strings } from "@/config/strings.ar";

/** The feed's opening moment. The animations are in globals.css, and stop for people who ask for less motion. */
export function FeedLoader() {
  return (
    <div role="status" aria-label={strings.states.loading} className="flex h-full snap-start flex-col items-center justify-center gap-6 bg-black" data-testid="feed-loading">
      <div className="feed-loader-mark relative flex size-32 items-center justify-center">
        <span aria-hidden className="feed-loader-ring absolute inset-0 rounded-full" />
        <span aria-hidden className="feed-loader-glow absolute inset-4 rounded-full" />
        <BrandMark className="feed-loader-logo relative size-20" />
      </div>
      <p className="feed-loader-name text-4xl font-bold tracking-wide" data-testid="feed-loader-name">
        {strings.app.name}
      </p>
    </div>
  );
}
