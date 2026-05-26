"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminProjectProfile } from "@/components/pages/projects/AdminProjectProfile";
import { UserProjectProfile } from "@/components/pages/projects/UserProjectProfile";
import { isAnyAdmin } from "@/types";

export default function ProjectProfilePage() {
  const { role } = useRole();
  if (isAnyAdmin(role) || role === "validator") return <AdminProjectProfile />;
  return <UserProjectProfile />;
}
