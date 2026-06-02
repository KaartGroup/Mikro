export type LoggerLevelsType =
  (typeof Logger.levels)[keyof typeof Logger.levels];
export declare class Logger {
  static levels: {
    DEBUG: number;
    INFO: number;
    WARN: number;
    ERROR: number;
  };
  private level;
  private prefix;
  constructor(level?: number, prefix?: string);
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  setLevel(level: LoggerLevelsType): void;
  getLevel(): number;
}
//# sourceMappingURL=Logger.d.ts.map
