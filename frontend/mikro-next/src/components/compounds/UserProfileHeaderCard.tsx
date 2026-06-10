import { Card, CardContent, Skeleton } from "@/components/ui";
import { RoleBadge } from "@/components/atoms/RoleBadge";
import { UserInfoGrid } from "@/components/molecules/UserInfoGrid";
import Link from "next/link";
import type { UserProfileData } from "@/types";
import { ROUTES } from "@/lib/routes";

interface UserProfileHeaderCardProps {
  user: UserProfileData | null;
  deactivating: boolean;
  reactivating: boolean;
  syncing: boolean;
  onToggleActive: () => void;
  onSyncProjects: () => void;
  onOpenEdit: () => void;
}

export function UserProfileHeaderCard({
  user,
  deactivating,
  reactivating,
  syncing,
  onToggleActive,
  onSyncProjects,
  onOpenEdit,
}: UserProfileHeaderCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <Link
          href={ROUTES.users}
          className="text-kaart-orange hover:underline text-sm mb-4 inline-block"
        >
          {"←"} Back to Users
        </Link>

        {!user ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-kaart-orange flex items-center justify-center text-white text-xl font-bold shrink-0">
                  {(
                    user.first_name?.[0] ||
                    user.email?.[0] ||
                    "?"
                  ).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold tracking-tight">
                      {user.full_name || user.email || user.id}
                    </h1>
                    <RoleBadge role={user.role} />
                    {user.is_active === false && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        Deactivated
                      </span>
                    )}
                  </div>
                  {user.name_last_change && (
                    <p
                      className="text-xs text-muted-foreground mt-1"
                      title={`${user.name_last_change.old_first_name ?? ""} ${user.name_last_change.old_last_name ?? ""} → ${user.name_last_change.new_first_name ?? ""} ${user.name_last_change.new_last_name ?? ""}`}
                    >
                      Name last changed{" "}
                      {new Date(
                        user.name_last_change.changed_at,
                      ).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      via{" "}
                      <span className="font-mono">
                        {user.name_last_change.source}
                      </span>
                      {user.name_last_change.changed_by_name && (
                        <> by {user.name_last_change.changed_by_name}</>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleActive}
                  disabled={deactivating || reactivating}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    user.is_active === false
                      ? "bg-kaart-orange text-white hover:bg-kaart-orange-dark"
                      : "border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  }`}
                  title={
                    user.is_active === false
                      ? "Allow this user to log in again"
                      : "Block this user from logging in (data preserved)"
                  }
                >
                  {user.is_active === false
                    ? reactivating
                      ? "Reactivating..."
                      : "Reactivate"
                    : deactivating
                      ? "Deactivating..."
                      : "Deactivate"}
                </button>
                <button
                  onClick={onSyncProjects}
                  disabled={syncing}
                  className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-kaart-orange"
                  title="Sync all assigned projects"
                >
                  <svg
                    className={`w-5 h-5 ${syncing ? "animate-spin" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
                <button
                  onClick={onOpenEdit}
                  className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-kaart-orange"
                  title="Edit user"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="m15 5 4 4"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <UserInfoGrid user={user} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
