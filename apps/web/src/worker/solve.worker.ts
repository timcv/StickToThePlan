/**
 * Compute Web Worker: runs the full @stp/core race-plan pipeline off the main
 * thread so the UI stays responsive while solving.
 *
 * The pipeline body lives in the pure module src/lib/pipeline.ts and is
 * imported here for the worker message glue. That separation lets unit tests
 * import runPipeline directly without spinning up a real Worker or triggering
 * worker-only globals.
 *
 * Determinism: calm mode does zero network I/O, so it is fully reproducible.
 * Network access happens only in open-meteo mode (fetchOpenMeteo).
 */
import { runPipeline, type PipelineInput } from '../lib/pipeline';

export type { PipelineForm, PipelineInput, PipelineResult } from '../lib/pipeline';

// ---------------------------------------------------------------------------
// Worker glue
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<PipelineInput>) => {
  runPipeline(event.data).then(
    (result) => {
      (self as DedicatedWorkerGlobalScope).postMessage({ ok: true, result });
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      (self as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: message });
    },
  );
};
