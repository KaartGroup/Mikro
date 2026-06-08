"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminDashboard } from "@/components/pages/dashboard/AdminDashboard";
import { UserDashboard } from "@/components/pages/time/UserTime";
import { isAnyAdmin } from "@/types";

export default function DashboardPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminDashboard />;
  return <UserDashboard />;
}
