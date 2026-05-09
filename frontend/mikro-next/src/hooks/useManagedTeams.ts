import { useState, useEffect, useCallback } from "react";

/**
 * Lightweight team summary for the "teams I lead" picker on
 * scoped admin pages (team_admin tier). The backend endpoint
 * `fetch_managed_teams` returns the curated subset where
 * `Team.lead_id == g.user.id` (Phase 2 of F3 plan).
 *
 * Until that endpoint ships, this hook silently returns an
 * empty list — pages should fall back to TeamAdminEmptyState.
 */
export interface ManagedTeam {
  id: number;
  name: string;
}

export function useManagedTeams(): {
  teams: ManagedTeam[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/backend/team/fetch_managed_teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        // 404 = backend endpoint not deployed yet, swallow.
        if (res.status === 404) {
          setTeams([]);
          return;
        }
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data?.teams)) {
        setTeams(
          data.teams.map((t: { id: number; name: string }) => ({
            id: t.id,
            name: t.name,
          })),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  return { teams, loading, error, refetch: fetchTeams };
}
