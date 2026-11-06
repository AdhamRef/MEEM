import { VideoCardSkeleton, videoGridClass } from "@/components/explore/explore-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

export default function ExploreLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="w-full">
      <div className="space-y-3 px-4 pt-3 pb-3 md:px-6">
        <Skeleton className="mx-auto h-10 w-full max-w-2xl rounded-full" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-24 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
      <div className={`${videoGridClass} px-4 pt-4 md:px-6`}>
        {Array.from({ length: 12 }, (_, index) => (
          <VideoCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
