"use client";

import { RoleGate } from "@/components/RoleGate";
import { AdminReports } from "@/components/pages/reports/AdminReports";

export default function ReportsPage() {
  return (
    <RoleGate tier="any-admin">
      <AdminReports />
    </RoleGate>
  );
}
