"use client";

import { useEffect, useRef, useState } from "react";

// Load whisper.wasm from public/ via script tag to avoid Turbopack
// bundling issues with the library's Emscripten Worker syntax.

interface Segment {
  timeStart: number;
  timeEnd: number;
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getWhisperWasm(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).WhisperWasm;
}

export default function TranscribeWorkerClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whisperRef = useRef<any>(null);
  const [status, setStatus] = useState<string>("loading-script");
  const [scriptReady, setScriptReady] = useState(false);

  // Load the UMD script on mount
  useEffect(() => {
    if (getWhisperWasm()) {
      setScriptReady(true);
      setStatus("idle");
      return;
    }

    const script = document.createElement("script");
    script.src = "/whisper-wasm/index.umd.js";
    script.onload = () => {
      console.log(
        "[whisper-worker] UMD script loaded, WhisperWasm:",
        Object.keys(getWhisperWasm() || {}),
      );
      setScriptReady(true);
      setStatus("idle");
    };
    script.onerror = (e) => {
      console.error("[whisper-worker] Failed to load UMD script:", e);
      setStatus("error");
      postToParent({
        type: "error",
        message: "Failed to load Whisper WASM script",
      });
    };
    document.head.appendChild(script);
  }, []);

  // Listen for messages from parent
  useEffect(() => {
    if (!scriptReady) return;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const { type } = event.data;
      switch (type) {
        case "load-model":
          handleLoadModel(event.data.modelId);
          break;
        case "transcribe-file":
          handleTranscribeFile(event.data.fileData, event.data.fileName);
          break;
        case "transcribe-recording":
          handleTranscribeRecording(event.data.audioData);
          break;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [scriptReady]);

  function postToParent(message: Record<string, unknown>) {
    window.parent.postMessage(message, window.location.origin);
  }

  async function handleLoadModel(modelId: string) {
    try {
      setStatus("loading-model");
      const ww = getWhisperWasm();
      console.log(
        "[whisper-worker] Loading model:",
        modelId,
        "WhisperWasm available:",
        !!ww,
      );

      if (!ww) {
        throw new Error("WhisperWasm library not loaded");
      }

      console.log("[whisper-worker] Creating ModelManager...");
      const modelManager = new ww.ModelManager();

      console.log("[whisper-worker] Downloading model data...");
      const modelData = await modelManager.loadModel(
        modelId,
        true,
        (progress: number) => {
          postToParent({ type: "model-progress", percent: progress });
        },
      );
      console.log(
        "[whisper-worker] Model data loaded, size:",
        modelData?.length,
      );

      console.log("[whisper-worker] Creating WhisperWasmService...");
      const whisper = new ww.WhisperWasmService();

      console.log("[whisper-worker] Loading WASM script...");
      await whisper.loadWasmScript();

      // Work around library bug: initModel() calls FS_unlink("whisper.bin")
      // which throws ENOENT on first load. We call storeFS + init directly.
      console.log("[whisper-worker] Storing model in virtual FS...");
      const modelFileName = "whisper.bin";
      try {
        whisper.storeFS(modelFileName, modelData);
      } catch (e) {
        console.warn(
          "[whisper-worker] storeFS failed, retrying after short delay...",
          e,
        );
        await new Promise((r) => setTimeout(r, 200));
        whisper.storeFS(modelFileName, modelData);
      }

      console.log("[whisper-worker] Initializing WASM model...");
      // Access the internal wasmModule to call init directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = (whisper as any).wasmModule.init(modelFileName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (whisper as any).instance = instance;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (whisper as any).modelData = modelData;

      whisperRef.current = whisper;
      setStatus("ready");
      console.log("[whisper-worker] Model ready!");
      postToParent({ type: "model-ready" });
    } catch (err) {
      console.error("[whisper-worker] Model load failed:", err);
      setStatus("error");
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
      postToParent({ type: "error", message });
    }
  }

  // Split audio into chunks and transcribe sequentially to avoid WASM memory limits
  async function transcribeChunked(
    audioData: Float32Array,
  ): Promise<{ segments: Segment[]; transcribeDurationMs: number }> {
    const totalSamples = audioData.length;
    const chunkSamples = 300 * 16000; // 5 minutes at 16kHz
    const totalChunks = Math.ceil(totalSamples / chunkSamples);
    const allSegments: Segment[] = [];
    const startTime = performance.now();

    console.log(
      `[whisper-worker] Transcribing ${totalChunks} chunk(s), total duration: ${(totalSamples / 16000 / 60).toFixed(1)} min`,
    );

    for (let i = 0; i < totalChunks; i++) {
      const chunkStart = i * chunkSamples;
      const chunkEnd = Math.min(chunkStart + chunkSamples, totalSamples);
      const chunk = audioData.slice(chunkStart, chunkEnd);
      const timeOffsetSec = chunkStart / 16000;

      console.log(
        `[whisper-worker] Chunk ${i + 1}/${totalChunks}: ${(chunk.length / 16000).toFixed(1)}s, offset: ${timeOffsetSec.toFixed(0)}s`,
      );
      postToParent({
        type: "transcription-progress",
        chunk: i + 1,
        totalChunks,
      });

      await whisperRef.current.transcribe(chunk, (segment: Segment) => {
        // Adjust timestamps to account for chunk offset
        const adjusted: Segment = {
          timeStart: segment.timeStart + timeOffsetSec,
          timeEnd: segment.timeEnd + timeOffsetSec,
          text: segment.text,
        };
        allSegments.push(adjusted);
        postToParent({ type: "transcription-segment", segment: adjusted });
      });

      // Brief pause between chunks to let GC clean up
      await new Promise((r) => setTimeout(r, 100));
    }

    return {
      segments: allSegments,
      transcribeDurationMs: Math.round(performance.now() - startTime),
    };
  }

  async function handleTranscribeFile(
    fileData: ArrayBuffer,
    _fileName: string,
  ) {
    try {
      if (!whisperRef.current) {
        postToParent({ type: "error", message: "Model not loaded" });
        return;
      }

      setStatus("transcribing");
      postToParent({ type: "transcription-started" });

      console.log(
        "[whisper-worker] Converting audio, input size:",
        fileData.byteLength,
      );
      const ww = getWhisperWasm();
      const conversionResult = await ww.convertFromArrayBuffer(fileData);
      const audioData = conversionResult.audioData;
      console.log("[whisper-worker] Audio converted:", {
        samples: audioData.length,
        durationSec: (audioData.length / 16000).toFixed(1),
        sampleRate: conversionResult.audioInfo?.sampleRate,
        channels: conversionResult.audioInfo?.channels,
      });

      const { segments, transcribeDurationMs } =
        await transcribeChunked(audioData);
      const text = segments
        .map((s: Segment) => s.text)
        .join(" ")
        .trim();

      setStatus("ready");
      postToParent({
        type: "transcription-complete",
        segments,
        transcribeDurationMs,
        text,
      });
    } catch (err) {
      console.error("[whisper-worker] Transcription failed:", err);
      setStatus("error");
      postToParent({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : JSON.stringify(err),
      });
    }
  }

  async function handleTranscribeRecording(audioData: Float32Array) {
    try {
      if (!whisperRef.current) {
        postToParent({ type: "error", message: "Model not loaded" });
        return;
      }

      setStatus("transcribing");
      postToParent({ type: "transcription-started" });

      const startTime = performance.now();
      const segments: Segment[] = [];

      await whisperRef.current.transcribe(audioData, (segment: Segment) => {
        segments.push(segment);
        postToParent({ type: "transcription-segment", segment });
      });

      const transcribeDurationMs = Math.round(performance.now() - startTime);
      const text = segments
        .map((s: Segment) => s.text)
        .join(" ")
        .trim();

      setStatus("ready");
      postToParent({
        type: "transcription-complete",
        segments,
        transcribeDurationMs,
        text,
      });
    } catch (err) {
      setStatus("error");
      postToParent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return <p>Whisper Worker Active ({status})</p>;
}
