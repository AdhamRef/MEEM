import { HomeFeed } from "@/components/preferences/home-feed";
import { strings } from "@/config/strings.ar";

/** Static, so it's fast and cacheable. The feed loads in the browser, personalised there. */
export default function HomePage() {
  return (
    <>
      <h1 className="sr-only">{strings.feed.title}</h1>
      <HomeFeed />
    </>
  );
}
