/**
 * Chunked multipart upload direct to DO Spaces via Flask-issued presigned
 * URLs. Used by the transcription page to upload hour-long recordings
 * without hitting the DO App Platform 5-minute request timeout.
 *
 * Flow:
 *   1. POST /backend/transcribe/upload-init → { uploadId, partUrls[], ... }
 *   2. PUT each slice of the file to its presigned URL (concurrency + retry)
 *   3. POST /backend/transcribe/upload-complete → { jobId }
 *   4. On abort/fatal error → POST /backend/transcribe/upload-abort
 */

export interface ChunkedUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  partsUploaded: number;
  totalParts: number;
}

export interface ChunkedUploadOptions {
  file: File | Blob;
  fileName: string;
  contentType?: string;
  concurrency?: number; // default 3
  maxRetriesPerPart?: number; // default 3
  onProgress?: (p: ChunkedUploadProgress) => void;
  signal?: AbortSignal;
}

interface InitResponse {
  jobId: string;
  uploadId: string;
  spacesKey: string;
  partSize: number;
  partCount: number;
  partUrls: string[];
  status: number;
  message?: string;
}

interface CompleteResponse {
  jobId: string;
  status: number;
  message?: string;
}

class AbortedError extends Error {
  constructor() {
    super("Upload aborted");
    this.name = "AbortedError";
  }
}

/** Sleep that respects an AbortSignal by rejecting early. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AbortedError());
      },
      { once: true },
    );
  });
}

/** PUT one chunk with retries. Returns the ETag string from the response. */
async function uploadPart(
  url: string,
  chunk: Blob,
  maxRetries: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    if (signal?.aborted) throw new AbortedError();
    try {
      const res = await fetch(url, { method: "PUT", body: chunk, signal });
      if (!res.ok) {
        throw new Error(
          `Chunk PUT ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      const etag = res.headers.get("ETag");
      if (!etag) {
        throw new Error(
          "Missing ETag on chunk response — check bucket CORS ExposeHeaders",
        );
      }
      return etag;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError")
        throw new AbortedError();
      lastErr = err;
      attempt += 1;
      if (attempt > maxRetries) break;
      await delay(500 * Math.pow(2, attempt - 1), signal); // 500ms, 1s, 2s
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function chunkedUpload(
  opts: ChunkedUploadOptions,
): Promise<{ jobId: string }> {
  const {
    file,
    fileName,
    contentType = file.type || "application/octet-stream",
    concurrency = 3,
    maxRetriesPerPart = 3,
    onProgress,
    signal,
  } = opts;

  // 1. Init
  const initRes = await fetch("/backend/transcribe/upload-init", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      fileSize: file.size,
      contentType,
    }),
    signal,
  });
  if (!initRes.ok) {
    const txt = await initRes.text();
    throw new Error(
      `Upload init failed (${initRes.status}): ${txt.slice(0, 300)}`,
    );
  }
  const init = (await initRes.json()) as InitResponse;
  if (init.status !== 200) {
    throw new Error(init.message || "Upload init failed");
  }

  const { jobId, uploadId, spacesKey, partSize, partUrls } = init;

  // Helper: best-effort abort on the backend
  const remoteAbort = async () => {
    try {
      await fetch("/backend/transcribe/upload-abort", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, spacesKey }),
      });
    } catch {
      // best-effort
    }
  };

  // 2. Upload parts with bounded concurrency
  const etags: string[] = new Array(partUrls.length);
  let bytesUploaded = 0;
  let partsUploaded = 0;
  const totalBytes = file.size;
  const totalParts = partUrls.length;

  const emitProgress = () => {
    onProgress?.({ bytesUploaded, totalBytes, partsUploaded, totalParts });
  };
  emitProgress();

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (signal?.aborted) throw new AbortedError();
      const i = nextIndex++;
      if (i >= totalParts) return;
      const start = i * partSize;
      const end = Math.min(start + partSize, totalBytes);
      const chunk = file.slice(start, end);
      const etag = await uploadPart(
        partUrls[i],
        chunk,
        maxRetriesPerPart,
        signal,
      );
      etags[i] = etag;
      bytesUploaded += end - start;
      partsUploaded += 1;
      emitProgress();
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, totalParts) }, () => worker()),
    );
  } catch (err) {
    await remoteAbort();
    throw err;
  }

  // 3. Complete
  const parts = etags.map((ETag, idx) => ({ PartNumber: idx + 1, ETag }));
  const completeRes = await fetch("/backend/transcribe/upload-complete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, spacesKey, jobId, fileName, parts }),
    signal,
  });
  if (!completeRes.ok) {
    await remoteAbort();
    const txt = await completeRes.text();
    throw new Error(
      `Upload complete failed (${completeRes.status}): ${txt.slice(0, 300)}`,
    );
  }
  const complete = (await completeRes.json()) as CompleteResponse;
  if (complete.status !== 200) {
    await remoteAbort();
    throw new Error(complete.message || "Upload complete failed");
  }

  return { jobId: complete.jobId };
}
