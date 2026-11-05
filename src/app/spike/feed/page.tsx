import { notFound } from "next/navigation";
import { FeedSpike } from "./feed-spike";

/**
 * TEMPORARY Phase 1 device test, removed before Phase 2 work continues.
 * Unavailable in production builds.
 */
export default function FeedSpikePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FeedSpike />;
}
