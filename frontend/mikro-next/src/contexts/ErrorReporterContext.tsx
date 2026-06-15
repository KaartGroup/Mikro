"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { ReportProblemModal } from "@/components/ReportProblemModal";

// A non-PII snapshot of a failed API call. We capture request KEYS only,
// never values, so a report can never leak user data.
export interface CapturedError {
  endpoint: string;
  method: string;
  httpStatus?: number;
  serverMessage?: string;
  requestKeys?: string[];
  at: string;
}

interface ErrorReporterValue {
  captureError: (e: CapturedError) => void;
  openReport: (prefill?: Partial<CapturedError>) => void;
}

// Default no-op value so consumers rendered outside the provider (or in
// tests) don't crash — they just get inert functions.
const ErrorReporterContext = createContext<ErrorReporterValue>({
  captureError: () => {},
  openReport: () => {},
});

export function ErrorReporterProvider({ children }: { children: ReactNode }) {
  const [lastError, setLastError] = useState<CapturedError | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const captureError = useCallback((e: CapturedError) => {
    setLastError({ ...e, at: e.at || new Date().toISOString() });
  }, []);

  const openReport = useCallback((prefill?: Partial<CapturedError>) => {
    if (prefill) {
      setLastError(
        (prev) =>
          ({
            endpoint: "",
            method: "",
            at: new Date().toISOString(),
            ...prev,
            ...prefill,
          }) as CapturedError,
      );
    }
    setReportOpen(true);
  }, []);

  return (
    <ErrorReporterContext.Provider value={{ captureError, openReport }}>
      {children}
      <ReportProblemModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        lastError={lastError}
      />
    </ErrorReporterContext.Provider>
  );
}

export function useErrorReporter(): ErrorReporterValue {
  return useContext(ErrorReporterContext);
}
