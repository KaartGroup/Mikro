"use client";

import { useRole } from "@/contexts/RoleContext";
import { AdminTraining } from "@/components/pages/training/AdminTraining";
import { UserTraining } from "@/components/pages/training/UserTraining";
import { isAnyAdmin } from "@/types";

export default function TrainingPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminTraining />;
  return <UserTraining />;
}
