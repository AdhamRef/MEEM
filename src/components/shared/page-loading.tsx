import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";

/** General page placeholder. Pages with a known layout should use a closer-matching skeleton. */
export function PageLoading() {
  return (
    <div role="status" aria-label={strings.states.loading} className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Skeleton className="h-8 w-2/3" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Skeleton className="aspect-video w-full rounded-xl" />
    </div>
  );
}
