import { useRef } from "react";
import { useMapContext } from "../MapContext";

/**
 * Headless upload wiring: shares the `uploading` flag and `handleUpload` logic
 * from context, but owns a *local* file input ref so every call site renders
 * its own trigger and `<input>`. Lets components reuse the upload behaviour
 * while styling the UI however they like.
 */
export function useUpload() {
  const { uploading, handleUpload } = useMapContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const open = () => fileInput.current?.click();

  return { uploading, fileInput, handleUpload, open };
}
