import { roleLabel } from "@/types";

interface RoleBadgeProps {
  role: string;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const colorClass =
    role === "super_admin"
      ? "bg-pink-100 text-pink-800"
      : role === "admin"
        ? "bg-purple-100 text-purple-800"
        : role === "team_admin"
          ? "bg-indigo-100 text-indigo-800"
          : role === "validator"
            ? "bg-blue-100 text-blue-800"
            : "bg-gray-100 text-gray-800";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {roleLabel(role)}
    </span>
  );
}
