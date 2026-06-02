import { ModelID, WhisperModel } from "./ModelConfig";
import { LoggerLevelsType } from "../utils/Logger";

export interface ModelListConfig {
  models: WhisperModel[];
  cacheEnabled?: boolean;
  maxCacheSize?: number;
}
export interface ProgressCallback {
  (progress: number): void;
}
export interface ModelManagerOptions {
  logLevel: LoggerLevelsType;
}
export declare class ModelManager {
  private cacheEnabled;
  private models;
  private logger;
  constructor(options?: ModelManagerOptions);
  /**
   * Loads model by name
   */
  loadModel(
    modelId: ModelID,
    saveToIndexedDB?: boolean,
    progressCallback?: ProgressCallback,
  ): Promise<Uint8Array>;
  /**
   * Loads WASM model by URL and saves it to IndexedDB using the URL itself as key.
   */
  loadModelByUrl(
    modelUrl: string,
    progressCallback?: ProgressCallback,
  ): Promise<Uint8Array>;
  /**
   * Get model from IndexedDB by URL (key is the URL itself)
   */
  private getCachedModelByUrl;
  /**
   * Saves model to IndexedDB by URL (key is the URL itself)
   */
  private saveModelToCacheByUrl;
  /**
   * Gets list of available models with cache information
   */
  getAvailableModels(): Promise<WhisperModel[]>;
  /**
   * Gets list of available models without cache check (synchronously)
   */
  getAvailableModelsSync(): WhisperModel[];
  /**
   * Gets model by name from config
   */
  getModelConfig(modelName: ModelID): WhisperModel | undefined;
  /**
   * Saves model to IndexedDB
   */
  private saveModelToCache;
  /**
   * Gets model from IndexedDB cache
   */
  private getCachedModel;
  /**
   * Gets list of model names loaded in cache
   */
  private getCachedModelNames;
  /**
   * Opens IndexedDB for model caching
   */
  private openIndexedDB;
  /**
   * Clears model cache
   */
  clearCache(): Promise<void>;
  /**
   * Gets cache information
   */
  getCacheInfo(): Promise<{
    count: number;
    totalSize: number;
  }>;
}
//# sourceMappingURL=ModelManager.d.ts.map
