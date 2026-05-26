"use client";

import { RoleGate } from "@/components/RoleGate";
import { AdminReportsWeekly } from "@/components/pages/reports/AdminReportsWeekly";

export default function ReportsWeeklyPage() {
  return (
    <RoleGate tier="any-admin">
      <AdminReportsWeekly />
    </RoleGate>
  );
}
