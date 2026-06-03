"use client";

import { useRole } from "@/contexts/RoleContext";
import { isAnyAdmin } from "@/types";
import { AdminPayments } from "@/components/pages/payments/AdminPayments";
import { UserPayments } from "@/components/pages/payments/UserPayments";

export default function PaymentsPage() {
  const { role } = useRole();
  if (isAnyAdmin(role)) return <AdminPayments />;
  return <UserPayments />;
}
