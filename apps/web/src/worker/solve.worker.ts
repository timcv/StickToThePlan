/**
 * Compute Web Worker: runs the full @stp/core race-plan pipeline off the main
 * thread so the UI stays responsive while solving.
 *
 * The pipeline body lives in the pure module src/lib/pipeline.ts and is
 * imported here for the worker message glue. That separation lets unit tests
 * import runPipeline directly without spinning up a real Worker or triggering
 * worker-only globals.
 *
 * Determinism: the worker performs zero network I/O. Any weather field is
 * fetched and built on the main thread and injected via PipelineInput.field,
 * so the worker is fully reproducible.
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
