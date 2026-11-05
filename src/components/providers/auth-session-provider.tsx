"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * The browser asks for the session after the page loads, rather than the server reading
 * it in a layout. Reading it on the server would make every public page dynamic.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
