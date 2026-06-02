import { LoggerLevelsType } from "../utils/Logger";
import {
  WhisperWasmTranscriptionOptions,
  WhisperWasmServiceCallbackParams,
} from "./types";
import { WhisperWasmService } from "./WhisperWasmService";

interface ITranscriptionSessionOptions extends WhisperWasmTranscriptionOptions {
  sleepMsBetweenChunks?: number;
  restartModelOnError?: boolean;
  timeoutMs?: number;
}
export declare class TranscriptionSession {
  private whisperService;
  private logger;
  constructor(
    whisperService: WhisperWasmService,
    options?: {
      logLevel: LoggerLevelsType;
    },
  );
  streaming(
    audioData: Float32Array,
    options?: ITranscriptionSessionOptions,
  ): AsyncIterableIterator<WhisperWasmServiceCallbackParams>;
  /**
   * @deprecated Use `streaming()` instead.
   */
  streamimg(
    audioData: Float32Array,
    options?: ITranscriptionSessionOptions,
  ): AsyncIterableIterator<WhisperWasmServiceCallbackParams>;
}
export {};
//# sourceMappingURL=TranscriptionSession.d.ts.map
