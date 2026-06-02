/**
 * Парсит одну строку вида:
 * "[00:00:07.900 --> 00:00:10.900]   текст"
 * Возвращает объект с миллисекундами и исходными строками времени.
 */
export declare function parseCueLine(line: string): {
  startMs: number;
  endMs: number;
  start: string;
  end: string;
  text: string;
};
//# sourceMappingURL=parseCueLine.d.ts.map
