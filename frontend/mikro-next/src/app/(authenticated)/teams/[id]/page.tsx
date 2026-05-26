"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminTeamProfile } from "@/components/pages/teams/AdminTeamProfile";
import { UserTeamProfile } from "@/components/pages/teams/UserTeamProfile";
import { isAnyAdmin } from "@/types";

export default function TeamProfilePage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminTeamProfile />;
  return <UserTeamProfile />;
}
