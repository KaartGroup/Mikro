"use client";

import { useRole } from "@/contexts/RoleContext";
import { TeamProfile } from "@/components/pages/teams/TeamProfile";
import { isAnyAdmin } from "@/types";

export default function TeamProfilePage() {
  const { role } = useRole();
  return <TeamProfile isAdmin={isAnyAdmin(role)} />;
}
