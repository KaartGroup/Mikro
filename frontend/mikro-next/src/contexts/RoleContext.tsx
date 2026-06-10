"use client";

import { createContext, useContext, useState, useEffect } from "react";
import type { UserRole } from "@/types";
import { isAnyAdmin } from "@/types";

const PREVIEW_KEY = "rolePreview";

interface RoleContextValue {
  role: UserRole;
  actualRole: UserRole;
  setPreviewRole: (r: UserRole | null) => void;
  isPreviewMode: boolean;
  paymentsVisible: boolean;
  sub: string;
  displayName: string;
  email: string;
}

const RoleContext = createContext<RoleContextValue>({
  role: "user",
  actualRole: "user",
  setPreviewRole: () => {},
  isPreviewMode: false,
  paymentsVisible: false,
  sub: "",
  displayName: "",
  email: "",
});

interface RoleProviderProps {
  initialRole: UserRole;
  initialActualRole: UserRole;
  initialPaymentsVisible: boolean;
  sub: string;
  displayName: string;
  email: string;
  children: React.ReactNode;
}

export function RoleProvider({
  initialRole,
  initialActualRole,
  initialPaymentsVisible,
  sub,
  displayName,
  email,
  children,
}: RoleProviderProps) {
  const [previewRole, setPreviewRoleState] = useState<UserRole | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(PREVIEW_KEY);
    if (stored && isAnyAdmin(initialActualRole)) {
      setPreviewRoleState(stored as UserRole);
    }
  }, [initialActualRole]);

  const role = previewRole ?? initialRole;
  const isPreviewMode = previewRole !== null;
  // Admin tiers always see payments; for users, honour the backend flag.
  const paymentsVisible = isAnyAdmin(role) ? true : initialPaymentsVisible;

  const setPreviewRole = (r: UserRole | null) => {
    setPreviewRoleState(r);
    if (r === null) {
      localStorage.removeItem(PREVIEW_KEY);
    } else {
      localStorage.setItem(PREVIEW_KEY, r);
    }
  };

  return (
    <RoleContext.Provider
      value={{
        role,
        actualRole: initialActualRole,
        setPreviewRole,
        isPreviewMode,
        paymentsVisible,
        sub,
        displayName,
        email,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
