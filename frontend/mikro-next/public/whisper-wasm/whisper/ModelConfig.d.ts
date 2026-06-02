export type ModelID =
  | "tiny.en"
  | "tiny"
  | "base.en"
  | "base"
  | "small.en"
  | "small"
  | "tiny.en-q5_1"
  | "tiny-q5_1"
  | "base.en-q5_1"
  | "base-q5_1"
  | "small.en-q5_1"
  | "small-q5_1"
  | "medium.en-q5_0"
  | "medium-q5_0"
  | "large-q5_0";
export interface WhisperModel {
  id: ModelID;
  name: string;
  size: number;
  language: "en" | "multilingual";
  quantized: boolean;
  cached?: boolean;
}
export declare const MODEL_CONFIG: Record<
  ModelID,
  WhisperModel & {
    url: string;
  }
>;
export declare function getModelInfo(modelId: ModelID): WhisperModel | null;
export declare function getAllModels(): WhisperModel[];
export declare function getModelConfig(modelId: ModelID): WhisperModel & {
  url: string;
};
//# sourceMappingURL=ModelConfig.d.ts.map
