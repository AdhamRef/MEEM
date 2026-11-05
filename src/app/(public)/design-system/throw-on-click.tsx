"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Development-only way to see the error state and test that retrying recovers. */
export function ThrowOnClick({ icon }: { icon: ReactNode }) {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) throw new Error("Design system preview of the error state");

  return (
    <Button variant="outline" onClick={() => setShouldThrow(true)}>
      {icon}
      عرض حالة الخطأ
    </Button>
  );
}
