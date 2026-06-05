interface TimeEntryStatusBadgeProps {
  status: "completed" | "active" | "voided";
}

export function TimeEntryStatusBadge({ status }: TimeEntryStatusBadgeProps) {
  if (status === "completed")
    return <span className="text-green-600">Completed</span>;
  if (status === "active")
    return <span className="text-yellow-600">Active</span>;
  return <span className="text-red-500">Voided</span>;
}
