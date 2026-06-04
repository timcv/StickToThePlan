/**
 * Back-compat shim. The multi-source fetch now lives in @stp/core
 * (weather/fetchAll.ts) so the Vercel function and the CLI share one path.
 */
export { gatherWindSamples, fetchSmhi, fetchMetNorway } from '@stp/core';
