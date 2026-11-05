import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

export default function ExploreLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 md:px-8">
      <div className="space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="aspect-16/9 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
