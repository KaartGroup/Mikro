export declare function createTimeoutError(
  timeoutMs: number,
  errorMessage: string,
): {
  timeoutError: () => Promise<void>;
  clear: () => void;
};
//# sourceMappingURL=timeoutError.d.ts.map
