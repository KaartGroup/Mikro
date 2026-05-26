"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminProjects } from "@/components/pages/projects/AdminProjects";
import { UserProjects } from "@/components/pages/projects/UserProjects";
import { isAnyAdmin } from "@/types";

export default function ProjectsPage() {
  const { role } = useRole();
  if (isAnyAdmin(role) || role === "validator") return <AdminProjects />;
  return <UserProjects />;
}
