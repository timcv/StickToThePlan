/**
 * useSolver: drive the compute Web Worker from React.
 *
 * The worker runs the full @stp/core pipeline off the main thread so the UI
 * stays responsive while solving. This hook owns the worker lifecycle, posts
 * the PipelineInput, and exposes the run status, the result, and any error.
 *
 * The worker is created lazily on the first run and reused for subsequent runs.
 * On a worker-level error we terminate and drop the instance so the next run
 * starts from a clean worker.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineInput, PipelineResult } from './worker/solve.worker';

export type SolverStatus = 'idle' | 'running' | 'done' | 'error';

/** Shape posted back by the worker glue (see solve.worker.ts). */
type WorkerReply =
  | { ok: true; result: PipelineResult }
  | { ok: false; error: string };

export interface UseSolver {
  run: (input: PipelineInput) => void;
  status: SolverStatus;
  result: PipelineResult | null;
  error: string | null;
}

export function useSolver(): UseSolver {
  const [status, setStatus] = useState<SolverStatus>('idle');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  // Tear the worker down when the component unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('./worker/solve.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.ok) {
        setResult(reply.result);
        setError(null);
        setStatus('done');
      } else {
        setResult(null);
        setError(reply.error);
        setStatus('error');
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      // A worker-level error (e.g. an uncaught throw or a module load failure)
      // leaves the worker in an unknown state, so drop it and recreate next run.
      setResult(null);
      setError(event.message || 'Worker error');
      setStatus('error');
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };

    workerRef.current = worker;
    return worker;
  }, []);

  const run = useCallback(
    (input: PipelineInput) => {
      setStatus('running');
      setError(null);
      setResult(null);
      const worker = ensureWorker();
      worker.postMessage(input);
    },
    [ensureWorker],
  );

  return { run, status, result, error };
}
