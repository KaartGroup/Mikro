"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminTime } from "@/components/pages/time/AdminTime";
import { UserTime } from "@/components/pages/time/UserTime";
import { isAnyAdmin } from "@/types";

export default function TimePage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminTime />;
  return <UserTime />;
}
