"use client";

import { RoleGate } from "@/components/RoleGate";
import { AdminUsers } from "@/components/pages/users/AdminUsers";

export default function UsersPage() {
  return (
    <RoleGate tier="any-admin">
      <AdminUsers />
    </RoleGate>
  );
}
