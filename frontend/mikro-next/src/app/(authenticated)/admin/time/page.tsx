"use client";

import AdminTime from "@/components/pages/time/AdminTime";
import { RoleGate } from "@/components/RoleGate";

export default function AdminTimePage() {
  return (
    <RoleGate tier="any-admin">
      <AdminTime />
    </RoleGate>
  );
}
