/**
 * Audio converter module for whisper.wasm
 *
 * This module provides utilities for converting various audio formats
 * and sources into the Float32Array format required by whisper.wasm.
 */
export {
  convertFromFile,
  convertFromMediaStream,
  convertFromAudioElement,
  convertFromFloat32Array,
  convertFromArrayBuffer,
  isWebAudioSupported,
  getSupportedFormats,
} from "./AudioConverter";
export { AudioFormat } from "./types";
export type {
  AudioInfo,
  AudioConverterOptions,
  AudioConversionResult,
  AudioConverterCallbacks,
  AudioSource,
  AudioContextConfig,
} from "./types";
//# sourceMappingURL=index.d.ts.map
