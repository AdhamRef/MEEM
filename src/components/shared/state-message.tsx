import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface StateMessageProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Only pass real actions. A state with nothing useful to do should offer no button. */
  action?: ReactNode;
  /** Use "h1" when this message is the whole page. */
  headingLevel?: "h1" | "h2";
  role?: "alert" | "status";
}

/** Shared layout for empty, error, and not-found states, so they all look and read alike. */
export function StateMessage({ icon: Icon, title, description, action, headingLevel: Heading = "h2", role }: StateMessageProps) {
  return (
    <div role={role} className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border bg-surface text-text-secondary">
        <Icon aria-hidden className="size-6" strokeWidth={1.75} />
      </span>
      <div className="space-y-2">
        <Heading className="text-xl">{title}</Heading>
        {description ? <p className="text-text-secondary">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
