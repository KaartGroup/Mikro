import { useState, useEffect } from "react";
import type { UserRole } from "@/types";

/**
 * Hook returning the current user's role string from the backend.
 * Used by client-side admin pages to scope UI per role tier.
 *
 * Returns "user" until the fetch resolves; consumers should generally
 * gate role-specific UI on `loading === false` to avoid flashing wrong
 * controls on first render.
 */
export function useCurrentUserRole(): { role: UserRole; loading: boolean } {
  const [role, setRole] = useState<UserRole>("user");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/backend/user/fetch_user_role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (typeof data.role === "string") {
            setRole(data.role as UserRole);
          }
        }
      } catch {
        // keep default "user" on failure — admin pages have layout guard.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { role, loading };
}
