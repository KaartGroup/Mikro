"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  AdminDashboardStats,
  UserDashboardStats,
  UsersResponse,
  ProjectsResponse,
  TransactionsResponse,
  TrainingsResponse,
  ChecklistsResponse,
  UserPayableResponse,
  UserDetailsResponse,
  TimeEntry,
  TimeTrackingSessionResponse,
  TimeTrackingHistoryResponse,
  TimeTrackingActiveSessionsResponse,
  TimeHistoryFilterParams,
  SubcategoryListResponse,
  SubcategoryMutationResponse,
  UserProfileResponse,
  UserStatsDateResponse,
  UserPaymentSummaryResponse,
  ChangesetsResponse,
  ActivityChartResponse,
  TaskHistoryResponse,
  TeamsResponse,
  TeamMembersResponse,
  ProjectTeamsResponse,
  TeamTrainingsResponse,
  TeamChecklistsResponse,
  TeamProfileData,
  UserTeamsResponse,
  EditingStatsResponse,
  TimekeepingStatsResponse,
  ChangesetHeatmapResponse,
  FilterOptionsResponse,
  RegionsResponse,
  CountriesResponse,
  MapillaryStatsResponse,
  ProjectProfileResponse,
  PunksResponse,
  PunkDetailResponse,
  FriendsResponse,
  FriendDetailResponse,
  WeeklyReportDraft,
  WeeklyReportDraftsResponse,
  CommunityEntriesResponse,
  CommunitySheetConfigResponse,
  ChannelsResponse,
  ChannelSummariesResponse,
  HourlySummaryResponse,
  MyMonthlySummaryResponse,
  PaymentCycleResponse,
  PaymentCycleKpisResponse,
  PaymentContributorDetailResponse,
  PaymentStatusRow,
  PaymentAdjustment,
} from "@/types";

/**
 * Generic hook for fetching data from the backend API
 */
export function useApiCall<T>(
  endpoint: string,
  options?: {
    immediate?: boolean;
    body?: Record<string, unknown>;
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(options?.immediate !== false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (overrideBody?: Record<string, unknown>) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/backend${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(overrideBody || options?.body || {}),
        });

        // Auth failure — retry once before giving up. Transient 401s can
        // happen right after login when the backend proxy hasn't yet
        // refreshed the access token; a quick retry lets that finish
        // instead of blindly kicking the user back to login.
        if (response.status === 401) {
          await new Promise((r) => setTimeout(r, 400));
          const retryResponse = await fetch(`/backend${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(overrideBody || options?.body || {}),
          });
          if (retryResponse.status === 401) {
            console.warn("[useApi] 401 after retry on", endpoint, "— logging out");
            try { localStorage.clear(); } catch {}
            try { sessionStorage.clear(); } catch {}
            window.location.href = "/auth/logout";
            return undefined as unknown as T;
          }
          // Retry succeeded — use its response instead of the original 401
          const retryResult = await retryResponse.json();
          if (retryResponse.ok || retryResult.status === 200) {
            return retryResult as T;
          }
        }

        const result = await response.json();

        if (result.status === 200 || response.ok) {
          setData(result);
          return result as T;
        } else {
          const errorMsg = result.message || "An error occurred";
          setError(errorMsg);
          throw new Error(errorMsg);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, options?.body]
  );

  useEffect(() => {
    if (options?.immediate !== false) {
      fetchData().catch(() => {});
    }
  }, [fetchData, options?.immediate]);

  return { data, loading, error, refetch: fetchData };
}

// Admin Dashboard Stats
export function useAdminDashboardStats() {
  return useApiCall<AdminDashboardStats>("/project/fetch_admin_dash_stats");
}

// User Dashboard Stats
export function useUserDashboardStats() {
  return useApiCall<UserDashboardStats>("/project/fetch_user_dash_stats");
}

// Validator Dashboard Stats
export function useValidatorDashboardStats() {
  return useApiCall<UserDashboardStats>("/project/fetch_validator_dash_stats");
}

// Users List (Admin)
export function useUsersList() {
  return useApiCall<UsersResponse>("/user/fetch_users");
}

// Projects List (Admin)
export function useOrgProjects() {
  return useApiCall<ProjectsResponse>("/project/fetch_org_projects");
}

// User's Projects
export function useUserProjects() {
  return useApiCall<ProjectsResponse>("/project/fetch_user_projects");
}

// Validator's Projects
export function useValidatorProjects() {
  return useApiCall<ProjectsResponse>("/project/fetch_validator_projects");
}

// Transactions (Admin)
export function useOrgTransactions() {
  return useApiCall<TransactionsResponse>("/transaction/fetch_org_transactions");
}

// User Transactions
export function useUserTransactions() {
  return useApiCall<TransactionsResponse>("/transaction/fetch_user_transactions");
}

// User Payable Amount
export function useUserPayable() {
  return useApiCall<UserPayableResponse>("/transaction/fetch_user_payable");
}

// Trainings (Admin)
export function useOrgTrainings() {
  return useApiCall<TrainingsResponse>("/training/fetch_org_trainings");
}

// User Trainings
export function useUserTrainings() {
  return useApiCall<TrainingsResponse>("/training/fetch_user_trainings");
}

// Checklists (Admin)
export function useAdminChecklists() {
  return useApiCall<ChecklistsResponse>("/checklist/fetch_admin_checklists");
}

// User Checklists
export function useUserChecklists() {
  return useApiCall<ChecklistsResponse>("/checklist/fetch_user_checklists");
}

// Validator Checklists
export function useValidatorChecklists() {
  return useApiCall<ChecklistsResponse>("/checklist/fetch_validator_checklists");
}

// User Details
export function useUserDetails() {
  return useApiCall<UserDetailsResponse>("/user/fetch_user_details");
}

/**
 * Hook for API mutations (POST with custom body)
 */
export function useApiMutation<TResponse = { message: string; status: number }>(
  endpoint: string
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (body: Record<string, unknown>): Promise<TResponse> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/backend${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        // Auth failure — retry once before redirecting. Handles transient
        // 401s during post-login token refresh.
        if (response.status === 401) {
          await new Promise((r) => setTimeout(r, 400));
          const retryResponse = await fetch(`/backend${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (retryResponse.status === 401) {
            console.warn("[useApi] mutation 401 after retry on", endpoint);
            window.location.href = "/auth/login";
            return undefined as unknown as TResponse;
          }
          const retryResult = await retryResponse.json();
          if (retryResponse.ok || retryResult.status === 200) {
            return retryResult as TResponse;
          }
        }

        const result = await response.json();

        // Check JSON body status first (backend embeds status in response),
        // then fall back to HTTP status
        const jsonStatus = result.status;
        const isJsonError = jsonStatus && jsonStatus >= 300;
        if (isJsonError) {
          const errorMsg = result.message || "An error occurred";
          setError(errorMsg);
          throw new Error(errorMsg);
        }
        if (response.ok || jsonStatus === 200) {
          return result as TResponse;
        } else {
          const errorMsg = result.message || "An error occurred";
          setError(errorMsg);
          throw new Error(errorMsg);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [endpoint]
  );

  return { mutate, loading, error };
}

// Common mutations
export function useUpdateUserDetails() {
  return useApiMutation("/user/update_user_details");
}

export function useSubmitPaymentRequest() {
  return useApiMutation("/transaction/submit_payment_request");
}

export function useProcessPaymentRequest() {
  return useApiMutation("/transaction/process_payment_request");
}

export function useRejectPaymentRequest() {
  return useApiMutation("/transaction/delete_transaction");
}

export function useDeletePayment() {
  return useApiMutation("/transaction/delete_transaction");
}

export interface PaymentRequestTaskDetail {
  task_id: number;
  internal_id: number;
  mapped_by: string;
  validated_by: string;
  mapping_rate: number;
  validation_rate: number;
  validated: boolean;
  invalidated: boolean;
  is_mapping_earning: boolean;
  is_validation_earning: boolean;
  self_validated?: boolean;
}

export interface PaymentRequestProjectDetail {
  project_id: number;
  project_name: string;
  project_url: string | null;
  tasks: PaymentRequestTaskDetail[];
  mapping_count: number;
  validation_count: number;
  mapping_earnings: number;
  validation_earnings: number;
  self_validated_count?: number;
}

export interface PaymentRequestDetailsResponse {
  message: string;
  request_id: number;
  user_name: string;
  osm_username: string;
  amount_requested: number;
  date_requested: string;
  payment_email: string;
  notes: string | null;
  projects: PaymentRequestProjectDetail[];
  summary: {
    total_tasks: number;
    total_projects: number;
    mapping_earnings: number;
    validation_earnings: number;
    total_earnings: number;
    self_validated_count?: number;
  };
  status: number;
}

export function useFetchPaymentRequestDetails() {
  return useApiMutation<PaymentRequestDetailsResponse>("/transaction/fetch_payment_request_details");
}

export function useCompleteTraining() {
  return useApiMutation("/training/complete_training");
}

export function useCreateProject() {
  return useApiMutation<{ message: string; project_id: number; status: number }>("/project/create_project");
}

export function useUpdateProject() {
  return useApiMutation("/project/update_project");
}

export function useDeleteProject() {
  return useApiMutation("/project/delete_project");
}

export function useFetchProjectUsers() {
  return useApiMutation<{ users: Array<{ id: string; name: string; email: string; assigned: string }> }>("/user/fetch_project_users");
}

export function useAssignUser() {
  return useApiMutation("/user/assign_user");
}

export function useUnassignUser() {
  return useApiMutation("/user/unassign_user");
}

export function useModifyUserRole() {
  return useApiMutation("/user/modify_users");
}

export function useRemoveUser() {
  return useApiMutation("/user/remove_users");
}

// Admin: deactivate a user (soft-disable; data preserved; auth gate
// blocks them until reactivated).
export function useDeactivateUser() {
  return useApiMutation<{ message: string; status: number; user_id: string; is_active: boolean }>("/user/deactivate_user");
}

// Admin: reactivate a deactivated user.
export function useReactivateUser() {
  return useApiMutation<{ message: string; status: number; user_id: string; is_active: boolean }>("/user/reactivate_user");
}

// Task sync - pulls latest task data from TM4
export function useSyncUserTasks() {
  return useApiMutation("/task/update_user_tasks");
}

export function useAdminSyncAllTasks() {
  return useApiMutation("/task/admin_update_all_user_tasks");
}
export function useSyncProject() {
  return useApiMutation<{ message: string; job_id?: number; status: number }>(
    "/task/sync_project"
  );
}

export function useSyncUserProjects() {
  return useApiMutation<{ message: string; syncs?: Array<{ project_id: number; project_name: string; job_id: number }>; status: number }>(
    "/task/sync_user_projects"
  );
}

export function useCheckSyncStatus() {
  return useApiMutation<{
    job_id?: number;
    sync_status?: string;
    progress?: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
    message?: string;
  }>("/task/check_sync_status");
}

// Element analysis - background worker-powered OSM tag analysis
export function useFetchElementAnalysis() {
  return useApiMutation<{
    status: number;
    categories: Array<{
      title: string;
      data: Array<{ day: string; deleted: number; added: number; modified: number }>;
    }>;
    lastUpdated: string | null;
  }>("/reports/fetch_element_analysis");
}

export function useQueueElementAnalysis() {
  return useApiMutation<{
    status: number;
    job_id?: number;
    message?: string;
  }>("/reports/queue_element_analysis");
}

export function useCheckElementAnalysisStatus() {
  return useApiMutation<{
    status: number;
    job_id?: number;
    sync_status?: string;
    progress?: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
    message?: string;
  }>("/reports/check_element_analysis_status");
}

export function useFetchMapillaryStats() {
  return useApiMutation<MapillaryStatsResponse>("/reports/fetch_mapillary_stats");
}

export function useCreateTraining() {
  return useApiMutation("/training/create_training");
}

export function useDeleteTraining() {
  return useApiMutation("/training/delete_training");
}

export function useCreateChecklist() {
  return useApiMutation("/checklist/create_checklist");
}

export function useDeleteChecklist() {
  return useApiMutation("/checklist/delete_checklist");
}

export function useStartChecklist() {
  return useApiMutation("/checklist/start_checklist");
}

export function useCompleteChecklistItem() {
  return useApiMutation("/checklist/complete_list_item");
}

export function useConfirmChecklistItem() {
  return useApiMutation("/checklist/confirm_list_item");
}

export function useUpdateTraining() {
  return useApiMutation("/training/update_training");
}

export function useModifyTraining() {
  return useApiMutation("/training/modify_training");
}

export function useUpdateChecklist() {
  return useApiMutation("/checklist/update_checklist");
}

export function useSubmitChecklist() {
  return useApiMutation("/checklist/submit_checklist");
}

export function useConfirmChecklist() {
  return useApiMutation("/checklist/confirm_checklist");
}

export function useSubmitTrainingQuiz() {
  return useApiMutation<{ score: number; passed: boolean; status: number }>(
    "/training/submit_quiz"
  );
}

export function useAddChecklistComment() {
  return useApiMutation("/checklist/add_comment");
}

export function useAssignUserChecklist() {
  return useApiMutation("/checklist/assign_user_checklist");
}

export function useUnassignUserChecklist() {
  return useApiMutation("/checklist/unassign_user_checklist");
}

export function useFetchChecklistUsers() {
  return useApiMutation<{
    users: Array<{
      id: string;
      name: string;
      role: string;
      assigned: string;
    }>;
    status: number;
  }>("/checklist/fetch_checklist_users");
}

// DEV ONLY: Purge all task stats
export function usePurgeTaskStats() {
  return useApiMutation<{
    message: string;
    users_reset: number;
    projects_reset: number;
    status: number;
  }>("/task/purge_all_task_stats");
}

// DEV ONLY: Purge all checklists
export function usePurgeChecklists() {
  return useApiMutation<{
    message: string;
    checklists_deleted: number;
    users_reset: number;
    status: number;
  }>("/checklist/purge_all_checklists");
}

// DEV ONLY: Purge all trainings
export function usePurgeTrainings() {
  return useApiMutation<{
    message: string;
    trainings_deleted: number;
    users_reset: number;
    status: number;
  }>("/training/purge_all_trainings");
}

// Archive a transaction (soft delete)
export function useArchiveTransaction() {
  return useApiMutation("/transaction/archive_transaction");
}

// Fetch archived transactions
export function useFetchArchivedTransactions() {
  return useApiMutation<{
    message: string;
    archived_requests: Array<{
      id: number;
      amount_requested: number;
      user: string;
      osm_username: string;
      user_id: number;
      payment_email: string;
      task_ids: number[];
      date_requested: string;
      notes: string | null;
      archived_date: string | null;
    }>;
    archived_payments: Array<{
      id: number;
      payoneer_id: string;
      amount_paid: number;
      user: string;
      osm_username: string;
      user_id: number;
      payment_email: string;
      task_ids: number[];
      date_paid: string;
      notes: string | null;
      archived_date: string | null;
    }>;
    status: number;
  }>("/transaction/fetch_archived_transactions");
}

// DEV ONLY: Purge all transactions
export function usePurgeTransactions() {
  return useApiMutation<{
    message: string;
    requests_deleted: number;
    payments_deleted: number;
    users_reset: number;
    status: number;
  }>("/transaction/purge_all_transactions");
}

// DEV ONLY: Purge all projects
export function usePurgeProjects() {
  return useApiMutation<{
    message: string;
    projects_deleted: number;
    tasks_deleted: number;
    users_reset: number;
    status: number;
  }>("/project/purge_all_projects");
}

// DEV ONLY: Purge all users (except initiating admin)
export function usePurgeUsers() {
  return useApiMutation<{
    message: string;
    users_deleted: number;
    admin_preserved: number;
    status: number;
  }>("/user/purge_all_users");
}

// ─── Time Tracking ───────────────────────────────────────────

// User: clock in
export function useClockIn() {
  return useApiMutation<TimeTrackingSessionResponse>("/timetracking/clock_in");
}

// User: clock out
export function useClockOut() {
  return useApiMutation<TimeTrackingSessionResponse>("/timetracking/clock_out");
}

// User: get active session (fires on mount)
export function useActiveTimeSession() {
  return useApiCall<TimeTrackingSessionResponse>("/timetracking/my_active_session");
}

// User: get history (auto-fetches on mount; call refetch(params) with filters)
export function useMyTimeHistory() {
  const result = useApiCall<TimeTrackingHistoryResponse>("/timetracking/my_history");
  const refetch = result.refetch as (params?: TimeHistoryFilterParams) => Promise<TimeTrackingHistoryResponse>;
  return { ...result, refetch };
}

export function useFetchMyTimeHistory() {
  return useApiMutation<TimeTrackingHistoryResponse>("/timetracking/my_history");
}

// User: self-scoped monthly pay+hours summary (F13). Accepts
// { startDate, endDate } ISO UTC instants aligned to the viewer's
// local month.
export function useMyMonthlySummary() {
  return useApiMutation<MyMonthlySummaryResponse>("/timetracking/my_monthly_summary");
}

// Admin: get all active sessions
export function useAdminActiveSessions() {
  return useApiCall<TimeTrackingActiveSessionsResponse>("/timetracking/active_sessions");
}

// Admin: get every entry with a pending adjustment request, regardless
// of date — for the prominent "needs your attention" strip on /admin/time.
export function useAdminPendingAdjustments() {
  return useApiCall<{ status: number; entries: TimeEntry[] }>("/timetracking/pending_adjustments");
}

// Admin: get history for org (auto-fetches on mount; call refetch(params) with filters)
export function useAdminTimeHistory() {
  const result = useApiCall<TimeTrackingHistoryResponse>("/timetracking/history");
  const refetch = result.refetch as (params?: TimeHistoryFilterParams) => Promise<TimeTrackingHistoryResponse>;
  return { ...result, refetch };
}

// Admin: force clock out
export function useForceClockOut() {
  return useApiMutation<TimeTrackingSessionResponse>("/timetracking/force_clock_out");
}

// Admin: void entry
export function useVoidTimeEntry() {
  return useApiMutation<{ message: string; status: number; entry: TimeTrackingSessionResponse }>("/timetracking/void_entry");
}

// Admin: edit entry
export function useEditTimeEntry() {
  return useApiMutation<{ message: string; status: number; entry: TimeTrackingSessionResponse }>("/timetracking/edit_entry");
}

// User: request adjustment to a time entry
export function useRequestTimeAdjustment() {
  return useApiMutation<{ message: string; status: number }>("/timetracking/request_adjustment");
}

// User: update user_notes on one of their own entries (owner-scoped)
export function useUpdateMyNotes() {
  return useApiMutation<TimeTrackingSessionResponse>("/timetracking/update_my_notes");
}

// User: hard-discard the active session within the 5-min window
export function useDiscardActiveSession() {
  return useApiMutation<{ message: string; status: number; elapsed_seconds?: number; max_seconds?: number }>("/timetracking/discard_active");
}

// Admin: add new time entry
export function useAdminAddTimeEntry() {
  return useApiMutation<{ message: string; status: number; entry: TimeTrackingSessionResponse }>("/timetracking/admin_add_entry");
}

// Admin: add 8-hour test entry (dev only)
export function useAdminAddTestEntry() {
  return useApiMutation<{ message: string; status: number; entry: TimeTrackingSessionResponse }>("/timetracking/admin_add_test_entry");
}

// Custom topics for "Other" time tracking category
export function useCustomTopics() {
  return useApiCall<{
    status: number;
    topics: Array<{ id: number; name: string; createdBy: string }>;
  }>("/timetracking/fetch_custom_topics");
}

// ── Time-tracking subcategory catalog (tier-2) ─────────────────
// All consumers should go through these hooks rather than
// hand-rolling fetches against the subcategory endpoints —
// keeps the visibility / permission model consistent (the
// backend is the SSOT but the endpoint paths live in exactly
// one place here).

/**
 * Fetch tier-2 subcategories VISIBLE to the calling user (the union
 * of global + their org + teams they're a member of). Used by the
 * clock-in dropdowns; pass `activity` to narrow.
 */
export function useFetchSubcategories() {
  return useApiMutation<SubcategoryListResponse>(
    "/timetracking/subcategories_list",
  );
}

/**
 * Admin management view — returns the subcategories the caller can
 * MANAGE (subset varies by role: super_admin sees all, admin sees
 * their org, team_admin sees only their led teams' subs). Used by
 * the Time Categories admin page.
 */
export function useAdminFetchSubcategories() {
  return useApiMutation<SubcategoryListResponse>(
    "/timetracking/subcategories_admin_list",
  );
}

export function useCreateSubcategory() {
  return useApiMutation<SubcategoryMutationResponse>(
    "/timetracking/subcategories_create",
  );
}

export function useUpdateSubcategory() {
  return useApiMutation<SubcategoryMutationResponse>(
    "/timetracking/subcategories_update",
  );
}

export function useDeleteSubcategory() {
  return useApiMutation<SubcategoryMutationResponse>(
    "/timetracking/subcategories_delete",
  );
}

// Admin/User: export time entries as CSV/XLSX file download
export function useExportTimeEntries() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportEntries = useCallback(
    async (params: TimeHistoryFilterParams & { format?: "csv" | "json" | "pdf"; omit_columns?: string[] }) => {
      setLoading(true);
      setError(null);

      try {
        let response = await fetch("/backend/timetracking/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        // Auth failure — retry once before redirecting. Handles transient
        // 401s during post-login token refresh.
        if (response.status === 401) {
          await new Promise((r) => setTimeout(r, 400));
          response = await fetch("/backend/timetracking/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          if (response.status === 401) {
            console.warn("[useApi] export 401 after retry");
            window.location.href = "/auth/login";
            return;
          }
        }

        if (!response.ok) {
          // Try to parse error JSON from the response body
          let errorMsg = `Export failed (${response.status})`;
          try {
            const errJson = await response.json();
            errorMsg = errJson.message || errorMsg;
          } catch {
            // response wasn't JSON, use status text
          }
          setError(errorMsg);
          throw new Error(errorMsg);
        }

        // Extract filename from Content-Disposition header, or fall back to default
        const disposition = response.headers.get("Content-Disposition");
        let filename = `time_entries.${params.format || "csv"}`;
        if (disposition) {
          const match = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/);
          if (match?.[1]) {
            filename = match[1];
          }
        }

        // Download the blob
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Export failed";
        setError(errorMsg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { exportEntries, loading, error };
}

// Admin: fetch full user profile by ID
export function useFetchUserProfile() {
  return useApiMutation<UserProfileResponse>("/user/fetch_user_profile_by_id");
}

// Admin: fetch date-filtered user stats
export function useFetchUserStatsByDate() {
  return useApiMutation<UserStatsDateResponse>("/user/fetch_user_stats_by_date");
}

// Admin: fetch read-only payment summary for one user (Payment tab)
export function useFetchUserPaymentSummary() {
  return useApiMutation<UserPaymentSummaryResponse>("/user/fetch_user_payment_summary");
}

// DEV ONLY: Purge all time entries
export function usePurgeTimeEntries() {
  return useApiMutation<{
    message: string;
    entries_deleted: number;
    status: number;
  }>("/timetracking/purge_all_time_entries");
}

// Admin: fetch OSM changesets for a user
export function useFetchUserChangesets() {
  return useApiMutation<ChangesetsResponse>("/user/fetch_user_changesets");
}

// Admin: fetch daily activity chart data for a user
export function useFetchUserActivityChart() {
  return useApiMutation<ActivityChartResponse>("/user/fetch_user_activity_chart");
}

// Admin: fetch task-level history for a user
export function useFetchUserTaskHistory() {
  return useApiMutation<TaskHistoryResponse>("/user/fetch_user_task_history");
}

// ─── Teams ─────────────────────────────────────────────────

export function useFetchTeams() {
  return useApiCall<TeamsResponse>("/team/fetch_teams");
}

export function useCreateTeam() {
  return useApiMutation("/team/create_team");
}

export function useUpdateTeam() {
  return useApiMutation("/team/update_team");
}

export function useDeleteTeam() {
  return useApiMutation("/team/delete_team");
}

export function useFetchTeamMembers() {
  return useApiMutation<TeamMembersResponse>("/team/fetch_team_members");
}

export function useAssignTeamMember() {
  return useApiMutation("/team/assign_team_member");
}

export function useUnassignTeamMember() {
  return useApiMutation("/team/unassign_team_member");
}

export function useFetchProjectTeams() {
  return useApiMutation<ProjectTeamsResponse>("/team/fetch_project_teams");
}

export function useAssignTeamToProject() {
  return useApiMutation<{ message: string; assigned: number; skipped: number; status: number }>(
    "/team/assign_team_to_project"
  );
}

export function useUnassignTeamFromProject() {
  return useApiMutation<{ message: string; removed: number; status: number }>(
    "/team/unassign_team_from_project"
  );
}

export function useFetchTeamTrainings() {
  return useApiMutation<TeamTrainingsResponse>("/team/fetch_team_trainings");
}

export function useAssignTrainingToTeam() {
  return useApiMutation<{ message: string; status: number }>("/team/assign_training_to_team");
}

export function useUnassignTrainingFromTeam() {
  return useApiMutation<{ message: string; status: number }>("/team/unassign_training_from_team");
}

export function useFetchTeamChecklists() {
  return useApiMutation<TeamChecklistsResponse>("/team/fetch_team_checklists");
}

export function useAssignChecklistToTeam() {
  return useApiMutation<{ message: string; status: number }>("/team/assign_checklist_to_team");
}

export function useUnassignChecklistFromTeam() {
  return useApiMutation<{ message: string; status: number }>("/team/unassign_checklist_from_team");
}

export function useFetchTeamProfile() {
  return useApiMutation<TeamProfileData>("/team/fetch_team_profile");
}

export function useFetchUserTeams() {
  return useApiCall<UserTeamsResponse>("/team/fetch_user_teams");
}

export function useFetchUserTeamProfile() {
  return useApiMutation<TeamProfileData>("/team/fetch_user_team_profile");
}

// Admin: update user profile (country/timezone)
export function useAdminUpdateUserProfile() {
  return useApiMutation<{ status: number; message: string }>("/user/admin_update_user_profile");
}

// ─── Reports ────────────────────────────────────────────────

export function useFetchEditingStats() {
  return useApiMutation<EditingStatsResponse>("/reports/fetch_editing_stats");
}

export function useFetchMrStats() {
  return useApiMutation<EditingStatsResponse>("/reports/fetch_mr_stats");
}

export function useFetchTimekeepingStats() {
  return useApiMutation<TimekeepingStatsResponse>("/reports/fetch_timekeeping_stats");
}

export function useFetchChangesetHeatmap() {
  return useApiMutation<ChangesetHeatmapResponse>("/reports/fetch_changeset_heatmap");
}

// ─── Region & Filter hooks ──────────────────────────────────

export function useFetchFilterOptions() {
  return useApiCall<FilterOptionsResponse>("/region/fetch_filter_options");
}

export function useFetchRegions() {
  return useApiCall<RegionsResponse>("/region/fetch_regions");
}

export function useFetchCountries() {
  return useApiCall<CountriesResponse>("/region/fetch_countries");
}

// ─── Location Assignment hooks ──────────────────────────────

export interface LocationsResponse {
  status: number;
  assigned_countries: Array<{
    id: number;
    name: string;
    iso_code: string | null;
    region_name: string | null;
  }>;
  all_countries: Array<{
    id: number;
    name: string;
    iso_code: string | null;
    region_id: number | null;
  }>;
  all_regions: Array<{ id: number; name: string }>;
}

// Project locations
export function useFetchProjectLocations() {
  return useApiMutation<LocationsResponse>("/region/fetch_project_locations");
}
export function useAssignProjectLocations() {
  return useApiMutation<{ message: string; created: number; skipped: number; status: number }>(
    "/region/assign_project_locations"
  );
}
export function useUnassignProjectLocation() {
  return useApiMutation("/region/unassign_project_location");
}

// Training locations
export function useFetchTrainingLocations() {
  return useApiMutation<LocationsResponse>("/region/fetch_training_locations");
}
export function useAssignTrainingLocations() {
  return useApiMutation<{ message: string; created: number; skipped: number; status: number }>(
    "/region/assign_training_locations"
  );
}
export function useUnassignTrainingLocation() {
  return useApiMutation("/region/unassign_training_location");
}

// Checklist locations
export function useFetchChecklistLocations() {
  return useApiMutation<LocationsResponse>("/region/fetch_checklist_locations");
}
export function useAssignChecklistLocations() {
  return useApiMutation<{ message: string; created: number; skipped: number; status: number }>(
    "/region/assign_checklist_locations"
  );
}
export function useUnassignChecklistLocation() {
  return useApiMutation("/region/unassign_checklist_location");
}

// Project trainings
export function useFetchProjectTrainings() {
  return useApiMutation<{
    assigned_trainings: Array<{ id: number; title: string; training_type: string; difficulty: string }>;
    available_trainings: Array<{ id: number; title: string; training_type: string; difficulty: string }>;
    status: number;
  }>("/project/fetch_project_trainings");
}
export function useAssignProjectTraining() {
  return useApiMutation("/project/assign_project_training");
}
export function useUnassignProjectTraining() {
  return useApiMutation("/project/unassign_project_training");
}

// Project Profile
export function useFetchProjectProfile() {
  return useApiMutation<ProjectProfileResponse>("/project/fetch_project_profile");
}

// ─── Punks List (Admin) ────────────────────────────────
export function usePunksList() {
  return useApiCall<PunksResponse>("/punk/fetch_punks");
}
export function useCreatePunk() {
  return useApiMutation("/punk/create_punk");
}
export function useUpdatePunk() {
  return useApiMutation("/punk/update_punk");
}
export function useDeletePunk() {
  return useApiMutation("/punk/delete_punk");
}
export function usePunkDetail() {
  return useApiMutation<PunkDetailResponse>("/punk/fetch_punk_detail");
}
export function useRefreshPunkActivity() {
  return useApiMutation("/punk/refresh_punk_activity");
}
export function useToggleDiscussionFlag() {
  return useApiMutation("/punk/toggle_discussion_flag");
}
export function usePurgeAllDiscussions() {
  return useApiMutation("/punk/purge_all_discussions");
}

// Friends List
export function useFriendsList() {
  return useApiCall<FriendsResponse>("/friend/fetch_friends");
}
export function useCreateFriend() {
  return useApiMutation("/friend/create_friend");
}
export function useUpdateFriend() {
  return useApiMutation("/friend/update_friend");
}
export function useDeleteFriend() {
  return useApiMutation("/friend/delete_friend");
}
export function useFriendDetail() {
  return useApiMutation<FriendDetailResponse>("/friend/fetch_friend_detail");
}
export function useRefreshFriendActivity() {
  return useApiMutation("/friend/refresh_friend_activity");
}
export function useToggleFriendDiscussionFlag() {
  return useApiMutation("/friend/toggle_discussion_flag");
}

// Weekly Reports
export function useSaveWeeklyReport() {
  return useApiMutation<{ message: string; id: number; status: number }>("/weeklyreport/save_draft");
}
export function useFetchWeeklyDrafts() {
  return useApiCall<WeeklyReportDraftsResponse>("/weeklyreport/fetch_drafts");
}
export function useFetchWeeklyDraft() {
  return useApiMutation<{ draft: WeeklyReportDraft; status: number }>("/weeklyreport/fetch_draft");
}
export function useDeleteWeeklyDraft() {
  return useApiMutation<{ message: string; status: number }>("/weeklyreport/delete_draft");
}

// Community Data
export function useSyncCommunitySheet() {
  return useApiMutation<{ message: string; synced: number; skipped: number; total: number; status: number }>("/community/sync_from_sheet");
}
export function useFetchCommunityEntries() {
  return useApiMutation<CommunityEntriesResponse>("/community/fetch_entries");
}
export function useUpdateCommunityEntry() {
  return useApiMutation("/community/update_entry");
}
export function useFetchSheetConfig() {
  return useApiCall<CommunitySheetConfigResponse>("/community/fetch_sheet_config");
}

// Channel Monitor
export function useFetchChannels() {
  return useApiCall<ChannelsResponse>("/channel/fetch_channels");
}
export function useAddChannel() {
  return useApiMutation("/channel/add_channel");
}
export function useUpdateChannel() {
  return useApiMutation("/channel/update_channel");
}
export function useRemoveChannel() {
  return useApiMutation("/channel/remove_channel");
}
export function useFetchChannelContent() {
  return useApiMutation("/channel/fetch_channel_content");
}
export function useSummarizeChannel() {
  return useApiMutation<{ message: string; summary: string; status: number }>("/channel/summarize_channel");
}
export function useFetchAllSummaries() {
  return useApiMutation<ChannelSummariesResponse>("/channel/fetch_all_summaries");
}

// ─── Hourly Contractor Payments ────────────────────────────
export function useHourlySummary() {
  return useApiCall<HourlySummaryResponse>("/timetracking/hourly_summary", { immediate: false });
}

export function useSetHourlyRate() {
  return useApiMutation<{ message: string; status: number }>("/timetracking/set_hourly_rate");
}

export function useMarkHourlyPaid() {
  return useApiMutation<{ message: string; status: number }>("/timetracking/mark_hourly_paid");
}

// ─── Payments v1 (admin payroll workspace, Trello DWAbQFlL) ──────────

export function useFetchPaymentCycle() {
  return useApiMutation<PaymentCycleResponse>("/payments/cycle");
}

export function useFetchPaymentCycleKpis() {
  return useApiMutation<PaymentCycleKpisResponse>("/payments/cycle/kpis");
}

export function useFetchPaymentContributor() {
  return useApiMutation<PaymentContributorDetailResponse>("/payments/contributor");
}

export function useFetchProjectDispensation() {
  return useApiMutation<import("@/types").ProjectDispensationResponse>(
    "/payments/project-dispensation",
  );
}

export function useFetchPaymentForecast() {
  return useApiMutation<import("@/types").PayrollForecastResponse>(
    "/payments/forecast",
  );
}

export function useFetchPayrollConfig() {
  return useApiMutation<import("@/types").PayrollConfigResponse>(
    "/payments/config/fetch",
  );
}

export function useSavePayrollConfig() {
  return useApiMutation<import("@/types").PayrollConfigResponse>(
    "/payments/config",
  );
}

export function useCreatePaymentAdjustment() {
  return useApiMutation<{ adjustment: PaymentAdjustment; status: number }>(
    "/payments/adjustment/create",
  );
}

export function useDeletePaymentAdjustment() {
  return useApiMutation<{ message: string; adjustment_id: number; status: number }>(
    "/payments/adjustment/delete",
  );
}

export function useSetPaymentCycleStatus() {
  return useApiMutation<{ status_row: PaymentStatusRow; status: number }>(
    "/payments/status/set",
  );
}

/**
 * Download the cycle CSV. Not a useApiMutation — the response is a
 * text/csv blob, not JSON. Calling ``download(cycleStart, cycleEnd)``
 * fetches the file and triggers a browser download.
 */
export function useExportPaymentCycle() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(
    async (
      cycleStart: string,
      cycleEnd: string,
      filters?: Record<string, string[]>,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/backend/payments/cycle/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cycle_start: cycleStart,
            cycle_end: cycleEnd,
            ...(filters && Object.keys(filters).length > 0 ? { filters } : {}),
          }),
        });
        if (!response.ok) {
          const msg = `Export failed (${response.status})`;
          setError(msg);
          throw new Error(msg);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mikro-payments-${cycleStart}-${cycleEnd}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { download, loading, error };
}
