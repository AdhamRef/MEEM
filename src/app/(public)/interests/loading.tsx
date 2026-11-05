import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

export default function InterestsLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
