"use client";

import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import type { User } from "@auth0/nextjs-auth0/types";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/components/ui";
import { ErrorReporterProvider } from "@/contexts/ErrorReporterContext";

interface ProvidersProps {
  children: React.ReactNode;
  user?: User;
}

export function Providers({ children, user }: ProvidersProps) {
  return (
    <Auth0Provider user={user}>
      <ThemeProvider>
        <ToastProvider>
          <ErrorReporterProvider>{children}</ErrorReporterProvider>
        </ToastProvider>
      </ThemeProvider>
    </Auth0Provider>
  );
}
