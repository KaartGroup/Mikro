"use client";

import type { ReactNode } from "react";
import { useRole } from "@/contexts/RoleContext";
import { isAnyAdmin, isOrgAdminOrAbove } from "@/types";

type Tier = "any-admin" | "org-admin" | "super-admin";

function UnauthorizedMessage() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Access Denied
        </h2>
        <p className="text-muted-foreground">
          You don&apos;t have permission to view this page.
        </p>
      </div>
    </div>
  );
}

export function RoleGate({
  tier,
  children,
}: {
  tier: Tier;
  children: ReactNode;
}) {
  const { role } = useRole();
  const allowed =
    tier === "any-admin"
      ? isAnyAdmin(role)
      : tier === "org-admin"
        ? isOrgAdminOrAbove(role)
        : role === "super_admin";
  if (!allowed) return <UnauthorizedMessage />;
  return <>{children}</>;
}
