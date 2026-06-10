import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, fetchSmhi } from '../src/weather/fetchAll.js';

// A hung upstream provider must not tie up the request: fetchWithTimeout aborts
// after the deadline, and the per-source wrappers degrade to [] on that failure.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  it('aborts a request that exceeds the timeout', async () => {
    // Stub fetch to hang until its abort signal fires, then reject (like real fetch).
    vi.stubGlobal(
      'fetch',
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    await expect(fetchWithTimeout('https://example.test', {}, 20)).rejects.toThrow();
  });

  it('a per-source wrapper returns [] when the upstream hangs', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    // fetchSmhi swallows the abort and yields no samples.
    await expect(fetchSmhi({ lat: 58.5, lon: 14.5 }, 20)).resolves.toEqual([]);
  });
});
