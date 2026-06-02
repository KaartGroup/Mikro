import {
  AudioFormat,
  AudioConverterOptions,
  AudioConversionResult,
  AudioConverterCallbacks,
} from "./types";

/**
 * Проверка поддержки Web Audio API
 */
export declare function isWebAudioSupported(): boolean;
/**
 * Получение списка поддерживаемых форматов
 */
export declare function getSupportedFormats(): AudioFormat[];
/**
 * Конвертация аудио из файла (поддерживает как аудио, так и видео файлы)
 */
export declare function convertFromFile(
  file: File,
  options?: AudioConverterOptions,
  callbacks?: AudioConverterCallbacks,
): Promise<AudioConversionResult>;
/**
 * Конвертация аудио из MediaStream (микрофон)
 */
export declare function convertFromMediaStream(
  stream: MediaStream,
  options?: AudioConverterOptions,
  callbacks?: AudioConverterCallbacks,
): Promise<AudioConversionResult>;
/**
 * Конвертация аудио из HTMLAudioElement
 */
export declare function convertFromAudioElement(
  element: HTMLAudioElement,
  options?: AudioConverterOptions,
  callbacks?: AudioConverterCallbacks,
): Promise<AudioConversionResult>;
/**
 * Конвертация аудио из Float32Array
 */
export declare function convertFromFloat32Array(
  data: Float32Array,
  options?: AudioConverterOptions,
  callbacks?: AudioConverterCallbacks,
): Promise<AudioConversionResult>;
/**
 * Конвертация аудио из ArrayBuffer
 */
export declare function convertFromArrayBuffer(
  buffer: ArrayBuffer,
  options?: AudioConverterOptions,
  callbacks?: AudioConverterCallbacks,
): Promise<AudioConversionResult>;
//# sourceMappingURL=AudioConverter.d.ts.map
