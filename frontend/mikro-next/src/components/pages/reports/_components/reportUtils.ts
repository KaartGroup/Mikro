import { formatNumber } from "@/lib/utils";

export const ROWS_PER_PAGE = 10;

// Numeric axis-tick + tooltip formatter — keeps large numbers readable in charts.
export const chartNumberFmt = (n: number) => formatNumber(n).text;
export const chartTooltipFmt = (v: number | string | undefined) => {
  if (typeof v === "number") return formatNumber(v).text;
  if (v == null) return "";
  return String(v);
};

// Calendar-aligned date range semantics (locked 2026-04-21 meeting):
//   Daily   = today (single day)
//   Weekly  = Sun → Sat of the CURRENT week (calendar week, NOT rolling 7-day)
//   Monthly = month-to-date (1st of current month → today, NOT rolling 30-day)
export function getDateRange(preset: "daily" | "weekly" | "monthly"): {
  start: string;
  end: string;
} {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const now = new Date();
  const today = ymd(now);

  switch (preset) {
    case "daily":
      return { start: today, end: today };
    case "weekly": {
      const day = now.getDay();
      const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 6);
      return { start: ymd(sunday), end: ymd(saturday) };
    }
    case "monthly": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: ymd(firstOfMonth), end: today };
    }
  }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getProjectStatus(proj: {
  percent_mapped: number;
  percent_validated: number;
  status: boolean;
}): { label: string; className: string } {
  if (proj.percent_mapped >= 95 && proj.percent_validated >= 90)
    return { label: "Complete", className: "bg-green-100 text-green-800" };
  if (!proj.status)
    return { label: "Inactive", className: "bg-muted text-muted-foreground" };
  if (proj.percent_mapped < 15)
    return { label: "Stagnant", className: "bg-yellow-100 text-yellow-800" };
  return { label: "In Progress", className: "bg-blue-100 text-blue-800" };
}

export const MOCK_COMMUNITY_OUTREACH = [
  {
    week: "1/19",
    "Wiki / OSM Documentation": 20,
    "Community QC": 40,
    "Community Events / Trainings / Meetings": 120,
    "Community Outreach - General": 231,
    newParticipants: 15,
    returnParticipants: 10,
  },
  {
    week: "1/26",
    "Wiki / OSM Documentation": 15,
    "Community QC": 35,
    "Community Events / Trainings / Meetings": 166,
    "Community Outreach - General": 244,
    newParticipants: 20,
    returnParticipants: 12,
  },
  {
    week: "2/2",
    "Wiki / OSM Documentation": 25,
    "Community QC": 50,
    "Community Events / Trainings / Meetings": 140,
    "Community Outreach - General": 177,
    newParticipants: 18,
    returnParticipants: 15,
  },
  {
    week: "2/9",
    "Wiki / OSM Documentation": 30,
    "Community QC": 45,
    "Community Events / Trainings / Meetings": 150,
    "Community Outreach - General": 200,
    newParticipants: 22,
    returnParticipants: 14,
  },
];
