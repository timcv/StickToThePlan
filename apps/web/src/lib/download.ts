/**
 * Trigger a browser download for in-memory data.
 *
 * Wraps the data in a Blob, creates a temporary object URL, clicks a synthetic
 * anchor to save it under `filename`, then revokes the URL so the blob can be
 * garbage-collected. All four plan outputs (FIT workout, course GPX, plan JSON,
 * Connect IQ source) are built on the main thread and saved through here.
 *
 * `Uint8Array` is accepted explicitly: under TS 5.7+ its generic
 * `Uint8Array<ArrayBufferLike>` no longer assigns to the `BlobPart` view type
 * (which pins `ArrayBuffer`), yet `new Blob([uint8array])` is valid at runtime.
 */
export function downloadBlob(
  filename: string,
  data: BlobPart | Uint8Array,
  mime: string,
): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
