"use client";

import { RoleGate } from "@/components/RoleGate";
import { AdminUserProfile } from "@/components/pages/users/AdminUserProfile";

export default function UserProfilePage() {
  return (
    <RoleGate tier="any-admin">
      <AdminUserProfile />
    </RoleGate>
  );
}
