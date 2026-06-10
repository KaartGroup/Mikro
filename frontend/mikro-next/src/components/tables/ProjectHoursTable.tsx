import type { UserStatsDateProjectBreakdown } from "@/types";

interface ProjectHoursTableProps {
  projects: UserStatsDateProjectBreakdown[];
}

export function ProjectHoursTable({ projects }: ProjectHoursTableProps) {
  if (projects.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-muted-foreground mb-2">
        Per-project hours
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 500 }}>
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Project
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Hours
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Sessions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {projects.map((proj) => (
              <tr key={proj.id}>
                <td className="px-4 py-2 font-medium">{proj.name}</td>
                <td className="px-4 py-2">{proj.total_hours.toFixed(1)}h</td>
                <td className="px-4 py-2">{proj.entries_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
