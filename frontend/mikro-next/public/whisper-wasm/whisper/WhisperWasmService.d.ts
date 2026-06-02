import { LoggerLevelsType } from "../utils/Logger";
import {
  WhisperWasmModule,
  WhisperWasmServiceCallback,
  WhisperWasmServiceCallbackParams,
  WhisperWasmTranscriptionOptions,
} from "./types";
import { TranscriptionSession } from "./TranscriptionSession";

declare global {
  interface Window {
    Module: WhisperWasmModule;
    WhisperWasmService: WhisperWasmService;
  }
}
interface WhisperWasmServiceOptions {
  logLevel?: LoggerLevelsType;
  init?: boolean;
}
export declare class WhisperWasmService {
  private wasmModule;
  private instance;
  private modelFileName;
  private isTranscribing;
  private bus;
  private logger;
  private modelData;
  constructor(options?: WhisperWasmServiceOptions);
  checkWasmSupport(): Promise<boolean>;
  loadWasmScript(): Promise<void>;
  initModel(model: Uint8Array): Promise<void>;
  restartModel(): Promise<void>;
  storeFS(fname: string, buf: Uint8Array): void;
  transcribe(
    audioData: Float32Array,
    callback?: WhisperWasmServiceCallback,
    options?: WhisperWasmTranscriptionOptions,
  ): Promise<{
    segments: WhisperWasmServiceCallbackParams[];
    transcribeDurationMs: number;
  }>;
  createSession(): TranscriptionSession;
}
export {};
//# sourceMappingURL=WhisperWasmService.d.ts.map
