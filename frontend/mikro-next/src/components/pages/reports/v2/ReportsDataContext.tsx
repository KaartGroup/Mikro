"use client";

import { createContext, useContext } from "react";
import type { ReportsData } from "./useReportsData";

/**
 * Provides the shared Reports v2 data to every Puck block, so blocks
 * *subscribe* to the single fetched dataset rather than each refetching.
 * This is the seam the (source, field, dimension) block contract will grow
 * on as blocks become configurable.
 */
const ReportsDataContext = createContext<ReportsData | null>(null);

export function ReportsDataProvider({
  value,
  children,
}: {
  value: ReportsData;
  children: React.ReactNode;
}) {
  return (
    <ReportsDataContext.Provider value={value}>
      {children}
    </ReportsDataContext.Provider>
  );
}

export function useReportsDataContext(): ReportsData {
  const ctx = useContext(ReportsDataContext);
  if (!ctx) {
    throw new Error(
      "useReportsDataContext must be used within a ReportsDataProvider",
    );
  }
  return ctx;
}
