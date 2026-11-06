import { expect, test as base, type Page } from "@playwright/test";

export { expect };

/**
 * Stands in for YouTube's script. It follows the documented API, including that methods only
 * work after onReady, and records every call. A real iframe element is created, so tests can
 * check what's in front of it and how many exist. Sound follows what was measured on the real
 * player without a click or key press: playing unmuted fires onAutoplayBlocked and doesn't start,
 * and unmuting a running video pauses it. This proves how the application behaves, and says
 * nothing about real autoplay, sound, or gestures, which need real phones.
 */
const FAKE_IFRAME_API = `
(() => {
  window.__ytPlayers = [];
  window.__ytCalls = [];
  window.__ytOptions = [];
  function FakePlayer(element, options) {
    const self = this;
    const frame = document.createElement("iframe");
    frame.src = "about:blank";
    frame.title = "YouTube video player";
    frame.dataset.videoId = options.videoId || "";
    frame.dataset.list = (options.playerVars && options.playerVars.list) || "";
    frame.style.cssText = "width:100%;height:100%;border:0;display:block";
    element.replaceWith(frame);
    let ready = false, muted = Boolean(options.playerVars.mute), time = 0;
    self.__frame = frame;
    const record = (name, arg) => window.__ytCalls.push({ name, arg, videoId: frame.dataset.videoId });
    const guarded = (name, fn) => (...args) => {
      if (!ready) throw new TypeError("player." + name + " is not a function");
      record(name, args[0]);
      return fn(...args);
    };
    // Time moves while playing, as it does in the real player, unless a test holds the first frame back.
    let clock;
    const fire = (state) => {
      clearInterval(clock);
      if (state === 1) clock = setInterval(() => { if (!window.__ytHoldFirstFrame) time += 0.1; }, 100);
      options.events.onStateChange({ target: self, data: state });
    };
    self.playVideo = guarded("playVideo", () => {
      if (!muted && !window.__ytActivated) { options.events.onAutoplayBlocked({ target: self }); return; }
      fire(1);
    });
    self.pauseVideo = guarded("pauseVideo", () => fire(2));
    self.mute = guarded("mute", () => { muted = true; });
    self.unMute = guarded("unMute", () => {
      muted = false;
      if (!window.__ytActivated) setTimeout(() => fire(2), 20);
    });
    self.isMuted = () => muted;
    self.getCurrentTime = () => time;
    let duration = 600;
    self.getDuration = () => duration;
    self.getVideoUrl = () => "https://www.youtube.com/watch?v=" + frame.dataset.videoId;
    self.playVideoAt = guarded("playVideoAt", (index) => { fire(1); return index; });
    self.seekTo = guarded("seekTo", (seconds) => { time = seconds; });
    self.__setDuration = (value) => { duration = value; };
    self.__setVideoId = (id) => { frame.dataset.videoId = id; };
    self.loadVideoById = guarded("loadVideoById", (video) => { const id = typeof video === "string" ? video : video.videoId; frame.dataset.videoId = id; time = (video && video.startSeconds) || 0; fire(1); });
    self.destroy = () => { clearInterval(clock); record("destroy"); frame.remove(); window.__ytPlayers = window.__ytPlayers.filter((p) => p !== self); };
    self.__fireState = fire;
    self.__fireError = (code) => options.events.onError({ target: self, data: code });
    self.__fireAutoplayBlocked = () => options.events.onAutoplayBlocked({ target: self });
    self.__setTime = (value) => { time = value; };
    window.__ytPlayers.push(self);
    window.__ytOptions.push(options);
    setTimeout(() => { ready = true; options.events.onReady({ target: self }); }, 0);
  }
  window.YT = { Player: FakePlayer };
  window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
})();
`;

/**
 * Playwright's own checks count as a person's gesture, which would make the page believe someone had
 * touched it. This reports only real clicks and key presses, as a browser would for a visitor.
 */
export const ONLY_REAL_GESTURES = () => {
  const target = window as unknown as { __ytActivated: boolean };
  target.__ytActivated = false;
  for (const name of ["click", "keydown"]) {
    window.addEventListener(name, () => {
      target.__ytActivated = true;
    }, true);
  }
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: {
      get hasBeenActive() {
        return target.__ytActivated;
      },
    },
  });
};

const ONE_PIXEL_GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

/** A streamed page briefly exists twice, with the copy still in its hidden holder, until it's swapped in. */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
}

export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_IFRAME_API }));
    await context.route("https://i.ytimg.com/**", (route) => route.fulfill({ contentType: "image/gif", body: ONE_PIXEL_GIF }));
    // The first-visit notice has tests of its own. Elsewhere it would only shift layouts being measured.
    await context.addInitScript(() => window.localStorage.setItem("privacy-notice.v1", "seen"));
    await context.addInitScript(ONLY_REAL_GESTURES);
    // The welcome screen has tests of its own too. Everywhere else it would cover what's being tested.
    await context.addInitScript(() => {
      try {
        if (!window.sessionStorage.getItem("keep-default-sound")) window.localStorage.setItem("feed.sound", "off");
      } catch {
        // The stub's blank frames have no storage, and don't need it.
      }
    });
    await provide(context);
  },
});

