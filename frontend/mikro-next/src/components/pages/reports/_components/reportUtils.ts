import { formatNumber } from "@/lib/utils";
// Numeric axis-tick + tooltip formatter — keeps large numbers readable in charts.
export const chartNumberFmt = (n: number) => formatNumber(n).text;
export const chartTooltipFmt = (v: number | string | undefined) => {
  if (typeof v === "number") return formatNumber(v).text;
  if (v == null) return "";
  return String(v);
};
