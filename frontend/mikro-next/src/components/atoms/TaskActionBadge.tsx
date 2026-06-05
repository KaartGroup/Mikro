interface TaskActionBadgeProps {
  action: string;
}

export function TaskActionBadge({ action }: TaskActionBadgeProps) {
  const colorClass =
    action === "mapped"
      ? "bg-orange-100 text-orange-800"
      : action === "validated"
        ? "bg-blue-100 text-blue-800"
        : "bg-red-100 text-red-800";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {action}
    </span>
  );
}
