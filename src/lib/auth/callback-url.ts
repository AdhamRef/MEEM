const SIGN_IN_PATH = "/auth/signin";

/**
 * Only same-site paths are accepted, so a crafted sign-in link can't send someone to
 * another site after they authenticate.
 */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  // Browsers strip control characters, which could turn "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (raw === SIGN_IN_PATH || raw.startsWith(`${SIGN_IN_PATH}?`) || raw.startsWith(`${SIGN_IN_PATH}/`)) return "/";
  return raw;
}

export function signInHref(callbackPath?: string): string {
  const path = safeCallbackPath(callbackPath);
  return path === "/" ? SIGN_IN_PATH : `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(path)}`;
}
