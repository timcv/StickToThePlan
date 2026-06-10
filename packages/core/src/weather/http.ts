/**
 * fetch with a hard timeout. A hung upstream weather provider must not tie up
 * the serverless function (or the CLI) indefinitely; after the deadline the
 * request is aborted and the rejection flows into each source's catch-and-
 * return-[] path, degrading gracefully instead of stalling the whole run.
 */

/** Default per-request upstream timeout (ms). */
export const FETCH_TIMEOUT_MS = 7000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
