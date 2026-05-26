"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminChecklists } from "@/components/pages/checklists/AdminChecklists";
import { UserChecklists } from "@/components/pages/checklists/UserChecklists";
import { ValidatorChecklists } from "@/components/pages/checklists/ValidatorChecklists";
import { isAnyAdmin } from "@/types";

export default function ChecklistsPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminChecklists />;
  if (role === "validator") return <ValidatorChecklists />;
  return <UserChecklists />;
}
