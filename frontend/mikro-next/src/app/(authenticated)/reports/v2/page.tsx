"use client";

import { RoleGate } from "@/components/RoleGate";
import { ReportsV2 } from "@/components/pages/reports/v2/ReportsV2";

export default function ReportsV2Page() {
  return (
    <RoleGate tier="any-admin">
      <ReportsV2 />
    </RoleGate>
  );
}
