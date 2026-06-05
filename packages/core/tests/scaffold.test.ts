import { describe, it, expect } from 'vitest';
import type { Config } from '../src/types.js';
describe('scaffold', () => {
  it('compiles and runs', () => {
    const x: Pick<Config, 'ftp'> = { ftp: 272 };
    expect(x.ftp).toBe(272);
  });
});
