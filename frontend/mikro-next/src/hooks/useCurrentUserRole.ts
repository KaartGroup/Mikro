import { useRole } from "@/contexts/RoleContext";
import type { UserRole } from "@/types";

/**
 * Hook returning the current user's effective role.
 * Role is seeded from SSR via RoleContext — no backend fetch needed.
 * `loading` is always false; kept for API compatibility with existing callers.
 */
export function useCurrentUserRole(): { role: UserRole; loading: boolean } {
  const { role } = useRole();
  return { role, loading: false };
}
