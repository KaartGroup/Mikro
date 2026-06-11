"use client";

import { RoleGate } from "@/components/RoleGate";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RoleGate tier="any-admin">{children}</RoleGate>;
}
