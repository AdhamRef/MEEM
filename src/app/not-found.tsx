import { SearchX } from "lucide-react";
import Link from "next/link";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col">
      <StateMessage
        icon={SearchX}
        headingLevel="h1"
        title={strings.states.notFoundTitle}
        description={strings.states.notFoundDescription}
        action={
          <Button asChild>
            <Link href="/">{strings.navigation.goHome}</Link>
          </Button>
        }
      />
    </main>
  );
}
