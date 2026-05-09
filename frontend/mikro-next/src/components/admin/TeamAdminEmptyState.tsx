"use client";

import { Card, CardContent } from "@/components/ui";

/**
 * Empty-state card shown when a user with role=team_admin has zero
 * managed teams. A team_admin manages teams where Team.lead_id ===
 * their user id; until they're assigned as a lead they have no
 * scoped data to look at, but the layout guard still lets them
 * land on /admin/* pages. Each page renders this in place of its
 * normal table/content so the user has a clear next step instead
 * of an empty grid.
 *
 * Per F3 plan §7 decision 8: team_admins with no leadership rows
 * are a supported degenerate case; UI must show this empty state
 * rather than throwing or 403'ing.
 */
export function TeamAdminEmptyState({
  context,
}: {
  /** Optional one-line context string ("payments", "users", etc.). */
  context?: string;
}) {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6 text-muted-foreground"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          You don&apos;t manage any teams yet
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {context
            ? `There's no ${context} data to show until you're assigned as a team lead.`
            : "Contact your Org Admin to assign you as a team lead. Once you lead at least one team, scoped data will appear here."}
        </p>
      </CardContent>
    </Card>
  );
}
