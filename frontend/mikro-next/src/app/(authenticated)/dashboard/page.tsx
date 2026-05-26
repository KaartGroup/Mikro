"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminDashboard } from "@/components/pages/dashboard/AdminDashboard";
import { MapperDashboard } from "@/components/pages/dashboard/MapperDashboard";
import { isAnyAdmin } from "@/types";

export default function DashboardPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminDashboard />;
  return <MapperDashboard isValidator={role === "validator"} />;
}
