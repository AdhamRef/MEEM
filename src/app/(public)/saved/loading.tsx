import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

export default function SavedLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
