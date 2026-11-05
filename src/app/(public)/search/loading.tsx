import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

export default function SearchLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-16/9 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
