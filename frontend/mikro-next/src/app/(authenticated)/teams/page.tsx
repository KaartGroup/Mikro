"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminTeams } from "@/components/pages/teams/AdminTeams";
import { UserTeams } from "@/components/pages/teams/UserTeams";
import { isAnyAdmin } from "@/types";

export default function TeamsPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminTeams />;
  return <UserTeams />;
}
