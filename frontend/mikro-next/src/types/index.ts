/**
 * Type definitions for Mikro application.
 * Updated to match backend API response formats.
 */

/**
 * Role taxonomy. Matches the backend's `User.role` string column.
 * - "super_admin" → Kaart-internal app-level admin (cross-org capable)
 * - "admin"       → Org Admin (full read/write within their org_id)
 * - "team_admin"  → Team-scoped admin; manages teams where they are lead
 * - "validator"   → Can validate tasks
 * - "user"        → Mapper (base role)
 *
 * UI labels MUST distinguish the admin tiers explicitly: "Super Admin",
 * "Org Admin", "Team Admin". Never show a bare "Admin" label.
 */
export type UserRole =
  | "super_admin"
  | "admin"
  | "team_admin"
  | "validator"
  | "user";

/** True if the role is any admin tier (any of the three). */
export function isAnyAdmin(role: string | undefined): boolean {
  return role === "super_admin" || role === "admin" || role === "team_admin";
}

/** True if the role is Org Admin or Super Admin (NOT team_admin). */
export function isOrgAdminOrAbove(role: string | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

/** Human-readable label for a role string. Always use this for UI display. */
export function roleLabel(role: string | undefined): string {
  switch (role) {
    case "super_admin":
      return "Super Admin";
    case "admin":
      return "Org Admin";
    case "team_admin":
      return "Team Admin";
    case "validator":
      return "Validator";
    case "user":
      return "Mapper";
    default:
      return role || "Unknown";
  }
}

// User types
export interface User {
  id: string; // Auth0 sub (string, not number)
  name: string;
  email: string;
  role: UserRole;
  osm_username?: string;
  payment_email?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  country?: string;
  assigned_projects?: number;
  total_tasks_mapped?: number;
  total_tasks_validated?: number;
  awaiting_payment?: number;
  total_payout?: number;
  org_id?: string;
  first_login?: boolean;
  needs_onboarding?: boolean;
  joined?: string;
  requesting_payment?: boolean;
  validated_tasks_amounts?: number;
  country_name?: string;
  region_name?: string;
  timezone?: string;
  is_tracked_only?: boolean;
  mapillary_username?: string;
  micropayments_visible?: boolean;
  hourly_rate?: number | null;
  /** False = deactivated. Blocked from auth gate; visible in
   *  admin user list under the "Deactivated" tab. */
  is_active?: boolean;
}

export interface UserListItem extends User {
  assigned?: "Yes" | "No";
}

// Project types
export interface Project {
  id: number;
  name: string;
  short_name?: string;
  url: string;
  total_tasks: number;
  source?: "tm4" | "mr";
  created_by?: string;
  // Backend-computed: true if the current viewer may delete this project
  // (Org Admin/Super Admin for any, Team Admin only for ones they created).
  can_delete?: boolean;
  total_mapped?: number;
  total_validated?: number;
  total_invalidated?: number;
  mapping_rate_per_task: number;
  validation_rate_per_task: number;
  max_payment?: number;
  payment_due?: number;
  total_payout?: number;
  total_editors?: number;
  visibility?: boolean;
  status?: boolean;
  payments_enabled?: boolean;
  difficulty?: "Easy" | "Medium" | "Hard";
  community?: boolean;
  priority?: "Low" | "Medium" | "High";
  // MR status breakdown: {status_code: count} for MR projects
  mr_status_breakdown?: Record<string, number>;
  // Last sync timestamp — null means never synced
  last_synced?: string | null;
  // User-specific stats (for user/validator dashboards)
  tasks_mapped?: number;
  tasks_validated?: number;
  tasks_invalidated?: number;
  user_earnings?: number;
}

export interface ProjectsResponse {
  // Admin/Validator response format
  org_active_projects?: Project[];
  org_inactive_projects?: Project[];
  // Validator response: projects where user validated tasks but isn't assigned
  unassigned_validation_projects?: Project[];
  // User response format
  user_projects?: Project[];
  message: string;
  status: number;
}

/** One sorted/filtered page of projects for a single status tab. */
export interface ProjectsPagedResponse {
  projects: Project[];
  total: number;
  page: number;
  page_size: number;
  status: number;
}

/** One sorted/filtered page of the current user's assigned projects. */
export interface UserProjectsPagedResponse {
  user_projects: Project[];
  total: number;
  page: number;
  page_size: number;
  status: number;
}

/** Aggregate counts for the stat cards + tab badges (over the filtered set,
 *  ignoring the status tab so both active/inactive are reported). */
export interface ProjectStatsResponse {
  active_count: number;
  inactive_count: number;
  total_tasks: number;
  tm4_count: number;
  mr_count: number;
  status: number;
}

/** Request body for the paginated projects list. */
export interface ProjectPageParams {
  status?: boolean;
  search?: string;
  community?: boolean | null;
  priority?: string | null;
  country_id?: number;
  region_id?: number;
  team_id?: number;
  created_by_me?: boolean;
  filters?: Record<string, string[]>;
  sort_key?: string;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

// Task types
export interface Task {
  id: number;
  task_id: number;
  project_id: number;
  project_name?: string;
  project_url?: string;
  org_id?: string;
  mapping_rate?: number;
  validation_rate?: number;
  mapped?: boolean;
  validated?: boolean;
  invalidated?: boolean;
  paid_out?: boolean;
  mapped_by?: string;
  validated_by?: string;
  date_mapped?: string;
  date_validated?: string;
}

// Payment types
export interface PayRequest {
  id: number;
  user_id: string;
  user: string;
  osm_username: string;
  amount_requested: number;
  date_requested: string;
  payment_email?: string;
  task_ids?: number[];
  notes?: string;
}

export interface Payment {
  id: number;
  user_id: string;
  user: string;
  osm_username?: string;
  amount_paid: number;
  date_paid: string;
  payment_email?: string;
  payoneer_id?: string;
  task_ids?: number[];
  notes?: string;
}

export interface TransactionsResponse {
  requests: PayRequest[];
  payments: Payment[];
  message: string;
  status: number;
}

export interface UserPayableResponse {
  message: string;
  mapping_earnings: number;
  validation_earnings: number;
  payable_total: number;
  status: number;
}

// Training types
export interface Training {
  id: number;
  title: string;
  training_url: string;
  point_value: number;
  difficulty: "Easy" | "Medium" | "Hard";
  training_type?:
    | "Mapping"
    | "Validation"
    | "Project"
    | "mapping"
    | "validation"
    | "project";
  project_id?: number;
  created_by?: string;
  questions?: TrainingQuestion[];
}

export interface TrainingQuestion {
  id: number;
  question: string;
  answers: TrainingAnswer[];
}

export interface TrainingAnswer {
  id: number;
  answer: string;
  correct: boolean;
}

export interface TrainingsResponse {
  // Admin response format
  org_mapping_trainings?: Training[];
  org_validation_trainings?: Training[];
  org_project_trainings?: Training[];
  // User response format
  mapping_trainings?: Training[];
  validation_trainings?: Training[];
  project_trainings?: Training[];
  user_completed_trainings?: Training[];
  status: number;
}

// Dashboard Stats types
export interface AdminDashboardStats {
  month_contribution_change: number;
  total_contributions_for_month: number;
  weekly_contributions_array: number[];
  active_projects: number;
  inactive_projects: number;
  completed_projects: number;
  mapped_tasks: number;
  validated_tasks: number;
  invalidated_tasks: number;
  payable_total: number;
  requests_total: number;
  payouts_total: number;
  self_validated_count?: number;
  message: string;
  status: number;
}

export interface UserDashboardStats {
  month_contribution_change: number;
  total_contributions_for_month: number;
  weekly_contributions_array: number[];
  mapped_tasks: number;
  validated_tasks: number;
  invalidated_tasks: number;
  validator_validated: number;
  validator_invalidated: number;
  mapping_payable_total: number;
  validation_payable_total: number;
  payable_total: number;
  requests_total: number;
  payouts_total: number;
  message: string;
  status: number;
}

// Validator Dashboard Stats (snake_case to match backend API response)
export interface ValidatorDashboardStats {
  // Project counts
  active_projects: number;
  inactive_projects: number;
  completed_projects: number;
  // Mapped tasks (as mapper)
  tasks_mapped: number;
  mapped_tasks: number; // Legacy alias
  // Tasks validated by others (where user was mapper)
  tasks_validated: number;
  validated_tasks: number; // Legacy alias
  tasks_invalidated: number;
  invalidated_tasks: number; // Legacy alias
  // Validation work done BY this user (as validator)
  validator_validated: number;
  validator_invalidated: number;
  self_validated_count?: number;
  // Payment totals
  mapping_payable_total: number;
  validation_payable_total: number;
  calculated_validation_earnings: number;
  payable_total: number;
  paid_total: number;
  requests_total: number;
  payouts_total: number;
  // API response
  message: string;
  status: number;
}

// Time Tracking types

/**
 * Visibility scope for a tier-2 activity subcategory.
 * - `global`: org_id IS NULL, team_id IS NULL — every user, every org.
 * - `org`:    org_id set, team_id IS NULL — every user in that org.
 * - `team`:   org_id + team_id set — members of that team + admins above.
 */
export type SubcategoryScope = "global" | "org" | "team";

/**
 * A row from the `activity_subcategories` table — the configurable
 * tier-2 catalog under each hardcoded tier-1 activity. Behavior flags
 * (`requiresProject`, `allowEventFields`) drive the clock-in form
 * without code changes.
 */
export interface Subcategory {
  id: number;
  /** Parent activity slug. */
  activity: string;
  /** Display label rendered in dropdowns + snapshotted onto entries. */
  name: string;
  /** Stable internal slug (snake_case). */
  slug: string;
  scope: SubcategoryScope;
  orgId: string | null;
  teamId: number | null;
  isActive: boolean;
  sortOrder: number;
  requiresProject: boolean;
  allowEventFields: boolean;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SubcategoryListResponse {
  status: number;
  subcategories: Subcategory[];
  message?: string;
}

export interface SubcategoryMutationResponse {
  status: number;
  subcategory?: Subcategory;
  message?: string;
}

export interface TimeEntry {
  id: number;
  userId: string;
  userName: string;
  firstName?: string;
  lastName?: string;
  projectId: number | null;
  projectName: string;
  projectShortName?: string;
  /** Display label of the tier-1 activity (e.g. "Editing"). */
  category: string;
  /** Raw activity slug (preferred over `category` for filters). */
  activity?: string;
  /** Selected tier-2 subcategory row id; null for legacy entries. */
  subcategoryId?: number | null;
  /** Snapshot of the subcategory's display label at write time. */
  subcategoryName?: string | null;
  /** Event-attendance counts. Populated only when the chosen sub has
   *  allowEventFields=true. */
  retainedParticipants?: number | null;
  newParticipants?: number | null;
  taskName?: string | null;
  taskRefType?: string | null; // "project" | "training" | null
  taskRefId?: number | null;
  clockIn: string | null;
  clockOut: string | null;
  duration: string | null;
  durationSeconds: number | null;
  /** Session length in seconds — for open sessions it's now−clockIn, for
   *  closed ones the recorded duration. Populated by the long_sessions
   *  endpoint; optional elsewhere. */
  effectiveDurationSeconds?: number | null;
  elapsedSeconds?: number;
  status: "active" | "completed" | "voided";
  changesetCount: number;
  changesCount: number;
  notes: string | null;
  userNotes: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  editedBy: string | null;
  editedAt: string | null;
  forceClockedOutBy: string | null;
}

export interface TimeTrackingSessionResponse {
  status: number;
  session: TimeEntry | null;
  message?: string;
  session_id?: number;
  duration_seconds?: number;
}

export interface TimeTrackingHistoryResponse {
  status: number;
  entries: TimeEntry[];
  nextCursor?: { clockIn: string; id: number } | null;
  total?: number;
}

export interface TimeHistoryFilterParams {
  startDate?: string;
  endDate?: string;
  userId?: string;
  teamId?: number;
  /** Activity slug. JSON key stays "category" for backend compat. */
  category?: string;
  /** Snapshot subcategory name filter (matches entry.subcategoryName). */
  subcategoryName?: string;
  /** Free-text search matched server-side against the user's full name. */
  search?: string;
  filters?: Record<string, string[]>;
  cursor?: { clockIn: string; id: number };
  limit?: number;
  offset?: number;
}

export interface TimeTrackingActiveSessionsResponse {
  status: number;
  sessions: TimeEntry[];
}

export interface MyMonthlySummaryResponse {
  status: number;
  start_date: string;
  end_date: string;
  total_seconds: number;
  total_hours: number;
  hourly_rate: number | null;
  hourly_earnings: number | null;
  tasks_mapped: number;
  tasks_validated: number;
  mapping_earnings: number;
  validation_earnings: number;
  amount_owed: number;
  pay_mode: "hourly" | "per_task" | "none";
}

// User Profile types
export interface UserProjectBreakdown {
  id: number;
  name: string;
  url: string;
  tasks_mapped: number;
  tasks_validated: number;
  tasks_invalidated: number;
  mapping_earnings: number;
  validation_earnings: number;
}

/**
 * Row shape for the Assigned Projects table on the admin user profile.
 * Returned by `_get_assigned_projects()` in backend/api/views/Users.py.
 */
export interface AssignedProject {
  id: number;
  name: string;
  short_name?: string | null;
  source?: string | null;
  status?: boolean;
  hours_logged: number;
  last_worked_on: string | null;
  task_count: number;
}

export interface UserProfileData {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  payment_email: string;
  osm_username: string;
  role: string;
  city: string;
  country: string;
  country_id: number | null;
  country_name: string | null;
  region_name: string | null;
  timezone: string | null;
  is_tracked_only?: boolean;
  micropayments_visible?: boolean;
  hourly_rate?: number | null;
  hourly_rate_start_date?: string | null;
  compensation_model?: CompensationModel | null;
  mapillary_username?: string;
  is_active?: boolean;
  joined: string;
  total_tasks_mapped: number;
  total_tasks_validated: number;
  validator_tasks_validated: number;
  validator_tasks_invalidated: number;
  mapping_payable_total: number;
  validation_payable_total: number;
  payable_total: number;
  requested_total: number;
  paid_total: number;
  mapper_points: number;
  validator_points: number;
  projects: UserProjectBreakdown[];
  assigned_projects?: AssignedProject[];
  time_entries: TimeEntry[];
  /**
   * Most recent name-change audit row. Added 2026-04 for debugging
   * reports of admin-set names reverting to email. Null if the user
   * has never had a name change recorded. Drop alongside the
   * user_name_audits table when the regression is confirmed fixed.
   */
  name_last_change?: {
    changed_at: string;
    source: string;
    changed_by: string | null; // raw id, kept for debugging
    changed_by_name: string | null; // resolved friendly name for UI
    old_first_name: string | null;
    old_last_name: string | null;
    new_first_name: string | null;
    new_last_name: string | null;
  } | null;
}

export interface UserProfileResponse {
  user: UserProfileData;
  status: number;
}

export interface UserStatsDateProjectBreakdown {
  id: number;
  name: string;
  total_hours: number;
  entries_count: number;
}

export interface UserStatsDateResponse {
  stats: {
    startDate: string;
    endDate: string;
    total_hours: number;
    entries_count: number;
    time_entries: TimeEntry[];
    projects: UserStatsDateProjectBreakdown[];
    tasks_mapped: number;
    tasks_validated: number;
    tasks_invalidated: number;
    validator_validated: number;
    mapping_earnings: number;
    validation_earnings: number;
  };
  status: number;
}

// Admin Payment tab response (sibling to UserStatsDateResponse, fed by
// /user/fetch_user_payment_summary). Read-only view of one user's
// payment data: lifetime totals, recent payments, open requests, and
// an anomaly list of validated tasks unpaid > 30 days.
export interface PaymentTabRecentPayment {
  id: number;
  date: string | null;
  amount: number | null;
  projects: string[];
  task_count: number;
  notes: string;
}

export interface PaymentTabOpenRequest {
  id: number;
  date_requested: string | null;
  amount_requested: number | null;
  task_count: number;
  notes: string;
}

export interface PaymentTabLastPayment {
  date: string | null;
  amount: number | null;
  payment_email: string;
  notes: string;
}

export interface PaymentTabAnomalyTask {
  task_id: number;
  project_id: number | null;
  project: string;
  date_validated: string | null;
  rate: number | null;
  type: "mapping" | "validation";
}

export interface UserPaymentSummaryResponse {
  summary: {
    lifetime_paid: number;
    pending_balance: number;
    open_request_total: number;
    last_payment: PaymentTabLastPayment | null;
    hourly_rate: number | null;
    recent_payments: PaymentTabRecentPayment[];
    open_requests: PaymentTabOpenRequest[];
    anomalies: {
      unpaid_over_30d_count: number;
      unpaid_over_30d_amount: number;
      tasks: PaymentTabAnomalyTask[];
    };
  };
  status: number;
}

// Team types
export interface TeamLeadSummary {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
}

export interface Team {
  id: number;
  name: string;
  description: string | null;
  /** Legacy "primary lead" pointer — first item in lead_ids. */
  lead_id: string | null;
  /** Legacy "primary lead" display name — first item in lead_names. */
  lead_name: string | null;
  /** All leads of this team (V2 multi-lead). */
  lead_ids: string[];
  lead_names: string[];
  leads?: TeamLeadSummary[];
  member_count: number;
  created_at: string;
}

export interface TeamsResponse {
  teams: Team[];
  status: number;
}

export interface TeamMemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  assigned: string;
}

export interface TeamMembersResponse {
  users: TeamMemberItem[];
  status: number;
}

export interface ProjectTeamItem {
  id: number;
  name: string;
  member_count: number;
  lead_name: string | null;
  lead_names?: string[];
  assigned: string;
}

export interface ProjectTeamsResponse {
  teams: ProjectTeamItem[];
  status: number;
}

export interface TeamTrainingItem {
  id: number;
  title: string;
  training_type: string;
  difficulty: string;
  point_value: number;
  assigned: string;
}

export interface TeamTrainingsResponse {
  trainings: TeamTrainingItem[];
  status: number;
}

// Team Profile types
export interface TeamProfileMember {
  id: string;
  name: string;
  email?: string;
  role: string;
  osm_username: string | null;
  total_tasks_mapped: number;
  total_tasks_validated: number;
  payable_total?: number;
}

export interface TeamProfileProject {
  id: number;
  name: string;
  url: string;
  team_tasks_mapped: number;
  team_tasks_validated: number;
  team_earnings?: number;
}

export interface TeamProfileTraining {
  id: number;
  title: string;
  training_type: string;
  difficulty: string;
  point_value: number;
}

export interface TeamProfileData {
  team: {
    id: number;
    name: string;
    description: string | null;
    lead_id: string | null;
    lead_name: string | null;
    lead_ids: string[];
    lead_names: string[];
    leads?: TeamLeadSummary[];
    member_count: number;
    created_at: string;
  };
  members: TeamProfileMember[];
  aggregated_stats: {
    total_tasks_mapped: number;
    total_tasks_validated: number;
    mapping_payable_total?: number;
    validation_payable_total?: number;
    payable_total?: number;
    requested_total?: number;
    paid_total?: number;
  };
  projects: TeamProfileProject[];
  assigned_trainings: TeamProfileTraining[];
  status: number;
}

export interface UserTeamsResponse {
  teams: Array<{
    id: number;
    name: string;
    description: string | null;
    lead_name: string | null;
    lead_names?: string[];
    member_count: number;
  }>;
  status: number;
}

// ─── Reports Types ──────────────────────────────────────────

export interface EditingStatsResponse {
  status: number;
  snapshot_timestamp: string;
  summary: {
    total_mapped: number;
    total_validated: number;
    total_invalidated: number;
    active_projects: number;
    completed_projects: number;
    mr_status_summary?: Record<string, number> | null;
  };
  tasks_over_time: Array<{
    week: string;
    mapped: number;
    validated: number;
    invalidated: number;
  }>;
  tasks_over_time_daily: Array<{
    day: string;
    mapped: number;
    validated: number;
    invalidated: number;
  }>;
  mr_status_over_time?: Array<{
    week: string;
    fixed: number;
    already_fixed: number;
    false_positive: number;
    skipped: number;
    cant_complete: number;
  }> | null;
  mr_status_over_time_daily?: Array<{
    day: string;
    fixed: number;
    already_fixed: number;
    false_positive: number;
    skipped: number;
    cant_complete: number;
  }> | null;
  projects: Array<{
    id: number;
    name: string;
    url: string;
    total_tasks: number;
    tasks_mapped: number;
    tasks_validated: number;
    tasks_invalidated: number;
    percent_mapped: number;
    percent_validated: number;
    mapping_rate: number;
    validation_rate: number;
    avg_time_per_task: number | null;
    status: boolean;
    difficulty: string;
    mr_status_breakdown?: Record<string, number>;
  }>;
  top_contributors: Array<{
    user_id: string | null;
    user_name: string;
    osm_username: string;
    tasks_mapped: number;
    tasks_validated: number;
    tasks_invalidated: number;
    total_hours: number;
    mr_status_breakdown?: Record<string, number>;
  }>;
  comparison?: {
    summary: {
      total_mapped: number;
      total_validated: number;
      total_invalidated: number;
    };
    tasks_over_time: Array<{
      week: string;
      mapped: number;
      validated: number;
      invalidated: number;
    }>;
    tasks_over_time_daily: Array<{
      day: string;
      mapped: number;
      validated: number;
      invalidated: number;
    }>;
  } | null;
}

// ─── Project Profile Types ──────────────────────────────────

export interface ProjectProfileUser {
  id: string;
  name: string;
  email: string;
  role: string;
  osm_username: string | null;
  tasks_mapped: number;
  tasks_validated: number;
  time_logged_seconds: number;
  earnings: number;
  is_assigned: boolean;
}

export interface ProjectProfileTeam {
  id: number;
  name: string;
  member_count: number;
}

export interface ProjectProfileTask {
  task_id: number;
  mapped_by: string;
  validated_by: string | null;
  date_mapped: string | null;
  date_validated: string | null;
  paid_out: boolean;
  mr_status: number | null;
}

export interface ProjectProfileTimeEntry {
  user_name: string;
  /** Display label of the tier-1 activity (e.g. "QC / Validation"). */
  category: string;
  /** Raw activity slug (added 2026-05-21 alongside the category fix; mirrors
   *  the global TimeEntry shape from TimeTracking.py:444-449). Optional for
   *  backward compatibility with older API rollouts. */
  activity?: string;
  clock_in: string | null;
  clock_out: string | null;
  duration_seconds: number | null;
  user_notes: string | null;
}

export interface ProjectProfileTraining {
  id: number;
  title: string;
  difficulty: string;
  point_value: number;
  training_type: string;
}

export interface ProjectProfileLocation {
  id: number;
  name: string;
  code: string;
}

export interface ProjectProfileResponse {
  status: number;
  project: Project & {
    created_by_name: string | null;
    effective_mapped: number;
    effective_validated: number;
    effective_invalidated: number;
    raw_mapped: number;
    raw_validated: number;
    raw_invalidated: number;
    split_task_groups: number;
    split_task_count: number;
    mr_status_breakdown: Record<string, number>;
  };
  assigned_users: ProjectProfileUser[];
  assigned_teams: ProjectProfileTeam[];
  tasks: ProjectProfileTask[];
  time_summary: {
    total_seconds: number;
    by_category: Record<string, number>;
  };
  recent_time_entries: ProjectProfileTimeEntry[];
  assigned_trainings: ProjectProfileTraining[];
  assigned_locations: ProjectProfileLocation[];
  avg_time_per_task: number | null;
}

export interface AdminAggregateStatsResponse {
  status: number;
  totalHours: number;
  pendingAdjustments: number;
  voidedEntries: number;
}

export interface AdminTimeStatsResponse {
  status: number;
  weekHours: number;
  lastWeekHours: number;
  pendingAdjustments: number;
  lastWeekPendingAdjustments: number;
  shortSessionClusters: number;
}

export interface TimekeepingStatsResponse {
  status: number;
  snapshot_timestamp: string;
  summary: {
    total_hours: number;
    total_entries: number;
    total_changesets: number;
    total_changes: number;
    active_users: number;
    avg_hours_per_user: number;
    weekly_rate_change_percent: number;
  };
  hours_by_category: Array<{
    category: string;
    hours: number;
  }>;
  weekly_activity: Array<{
    week: string;
    hours: number;
    changesets: number;
    changes: number;
    changes_per_changeset: number;
    changes_per_hour: number;
  }>;
  daily_activity: Array<{
    day: string;
    hours: number;
    changesets: number;
    changes: number;
    changes_per_changeset: number;
    changes_per_hour: number;
  }>;
  weekly_category_hours: Array<Record<string, string | number>>;
  weekly_category_names: string[];
  daily_category_hours: Array<Record<string, string | number>>;
  user_breakdown: Array<{
    user_id: string;
    user_name: string;
    osm_username: string;
    total_hours: number;
    entries_count: number;
    changeset_count: number;
    changes_count: number;
    category_hours: Record<string, number>;
  }>;
  comparison?: {
    summary: {
      total_hours: number;
      total_entries: number;
      total_changesets: number;
      total_changes: number;
      active_users: number;
      avg_hours_per_user: number;
    };
    weekly_activity: Array<{
      week: string;
      hours: number;
      changesets: number;
      changes: number;
      changes_per_changeset: number;
      changes_per_hour: number;
    }>;
    daily_activity: Array<{
      day: string;
      hours: number;
      changesets: number;
      changes: number;
      changes_per_changeset: number;
      changes_per_hour: number;
    }>;
  } | null;
}

export interface ChangesetHeatmapResponse {
  status: number;
  heatmapPoints: [number, number, number][];
}

export interface StandardAnalysisCategory {
  title: string;
  type: "standard";
  data: Array<{
    day: string;
    added: number;
    modified: number;
    deleted: number;
  }>;
}

export interface HprAnalysisCategory {
  title: string;
  type: "hpr";
  data: Array<{
    day: string;
    upgraded: number;
    downgraded: number;
    links: number;
    construction: number;
  }>;
}

export type ElementAnalysisCategory =
  | StandardAnalysisCategory
  | HprAnalysisCategory;

export interface ElementAnalysisResponse {
  status: number;
  categories: ElementAnalysisCategory[];
  lastUpdated: string | null;
}

export interface MapillaryTrip {
  user_name: string;
  mapillary_username: string;
  date: string;
  image_count: number;
  sequence_count: number;
}

export interface MapillaryStatsResponse {
  status: number;
  message?: string;
  summary: {
    total_images: number;
    total_trips: number;
    total_sequences: number;
    active_contributors: number;
    images_by_user: Array<{ username: string; name: string; count: number }>;
  };
  trips: MapillaryTrip[];
  weekly_uploads: Array<{ week: string; images: number }>;
}

// Punks List types
export interface Punk {
  id: number;
  osm_username: string;
  osm_uid?: number;
  notes?: string;
  tags?: string[];
  added_by: string;
  added_by_name?: string;
  created_at: string;
  cached_total_changesets?: number;
  cached_last_active?: string;
  cached_account_created?: string;
  cache_updated_at?: string;
}

export interface PunksResponse {
  punks: Punk[];
  status: number;
}

export interface PunkDetailResponse {
  punk: Punk;
  changesets: Array<{
    changeset_id: number;
    created_at: string;
    closed_at?: string;
    changes_count: number;
    comment?: string;
    editor?: string;
    source?: string;
    centroid_lat?: number;
    centroid_lon?: number;
    hashtags?: string[];
  }>;
  heatmapPoints: [number, number, number][];
  summary: {
    totalChangesets: number;
    totalChanges: number;
  };
  hashtagSummary: Record<string, number>;
  discussions: Array<{
    title: string;
    link: string;
    description: string;
    pubDate: string;
    flagged: boolean;
    commentId?: string;
    author?: string;
  }>;
  status: number;
}

// Friends List types
export interface Friend {
  id: number;
  osm_username: string;
  osm_uid?: number;
  notes?: string;
  tags?: string[];
  added_by: string;
  added_by_name?: string;
  created_at: string;
  cached_total_changesets?: number;
  cached_last_active?: string;
  cached_account_created?: string;
  cache_updated_at?: string;
}

export interface FriendsResponse {
  friends: Friend[];
  status: number;
}

export interface FriendDetailResponse {
  friend: Friend;
  changesets: Array<{
    changeset_id: number;
    created_at: string;
    closed_at?: string;
    changes_count: number;
    comment?: string;
    editor?: string;
    source?: string;
    centroid_lat?: number;
    centroid_lon?: number;
    hashtags?: string[];
  }>;
  heatmapPoints: [number, number, number][];
  summary: {
    totalChangesets: number;
    totalChanges: number;
  };
  hashtagSummary: Record<string, number>;
  discussions: Array<{
    title: string;
    link: string;
    description: string;
    pubDate: string;
    flagged: boolean;
    commentId?: string;
    author?: string;
  }>;
  status: number;
}

// Weekly Report types
export interface WeeklyReportDraft {
  id: number;
  title: string;
  report_date: string;
  start_date: string;
  end_date: string;
  sections: string; // JSON string
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WeeklyReportDraftsResponse {
  drafts: WeeklyReportDraft[];
  status: number;
}

// Community Data types
export interface CommunityEntry {
  id: number;
  entry_type: string;
  submitted_at: string | null;
  original_data: Record<string, string>;
  edited_data: Record<string, string> | null;
  is_edited: boolean;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunityEntriesResponse {
  entries: CommunityEntry[];
  headers: string[];
  status: number;
}

export interface CommunitySheetConfigResponse {
  configured: boolean;
  tab_name: string;
  last_synced: string | null;
  headers: string[];
  total_entries: number;
  status: number;
}

// Channel Monitor types
export interface MonitoredChannel {
  id: number;
  name: string;
  url: string;
  channel_type: string;
  active: boolean;
  last_fetched_at: string | null;
  last_summary: string | null;
  last_summary_at: string | null;
  post_count: number;
  created_by: string | null;
  created_at: string;
}

export interface ChannelsResponse {
  channels: MonitoredChannel[];
  status: number;
}

export interface ChannelSummariesResponse {
  summaries: Array<{
    id: number;
    name: string;
    summary: string | null;
    summary_date: string | null;
    post_count: number;
    last_fetched: string | null;
  }>;
  status: number;
}

// API Response types
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  status: number;
}

export interface UsersResponse {
  users: User[];
  status: number;
}

export interface UserDetailsResponse {
  role: string;
  first_name: string;
  last_name: string;
  full_name: string;
  osm_username: string;
  city: string;
  country: string;
  email: string;
  payment_email: string;
  micropayments_visible: boolean;
  hourly_rate: number | null;
  status: number;
}

export interface LoginResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  osm_username: string;
  payment_email: string;
  city: string;
  country: string;
  needs_onboarding: boolean;
  micropayments_visible: boolean;
  status: number;
}

export interface ElementCounts {
  nodes: number;
  ways: number;
  relations: number;
}

// OSM Changeset types
export interface Changeset {
  id: number;
  createdAt: string;
  closedAt: string;
  changesCount: number;
  added: number | null;
  modified: number | null;
  deleted: number | null;
  comment: string;
  hashtags: string[];
  source: string;
  imageryUsed: string;
  elements: ElementCounts | null;
  centroid: { lat: number; lon: number } | null;
}

export interface ChangesetSummary {
  totalChangesets: number;
  totalChanges: number;
  totalAdded: number;
  totalModified: number;
  totalDeleted: number;
  totalNodes: number;
  totalWays: number;
  totalRelations: number;
}

export interface ChangesetsResponse {
  changesets: Changeset[];
  summary: ChangesetSummary;
  hashtagSummary: Record<string, number>;
  heatmapPoints: [number, number, number][];
  message?: string;
  status: number;
}

// Activity Chart types
export interface ActivityDataPoint {
  date: string;
  tasksMapped: number;
  tasksValidated: number;
  hoursWorked: number;
}

export interface ActivityChartResponse {
  activity: ActivityDataPoint[];
  status: number;
}

// Task History types
export interface TaskHistoryEntry {
  taskId: number;
  projectId: number;
  projectName: string;
  action: "mapped" | "validated" | "invalidated";
  date: string | null;
  status: string;
  validatedBy?: string;
  mappedBy?: string;
  mappingRate?: number;
  validationRate?: number;
}

export interface TaskHistoryResponse {
  tasks: TaskHistoryEntry[];
  status: number;
}

// ─── Region & Filter Types ──────────────────────────────────

export interface Region {
  id: number;
  name: string;
  org_id: string | null;
  created_at: string;
}

export interface Country {
  id: number;
  name: string;
  iso_code: string | null;
  region_id: number | null;
  region_name?: string;
  default_timezone: string | null;
  org_id: string | null;
}

export interface FilterDimension {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface ActiveFilter {
  key: string;
  values: string[];
}

export interface FilterOptionsResponse {
  dimensions: Record<
    string,
    Array<string | { id?: number; name: string; value?: string }>
  >;
  status: number;
}

export interface RegionsResponse {
  regions: Array<Region & { countries: Country[] }>;
  status: number;
}

export interface CountriesResponse {
  countries: Country[];
  status: number;
}

// ─── Payments v1 (admin payroll workspace) ──────────────────────────

export type PaymentCycleStatus = "pending" | "approved" | "held" | "paid";

export interface PaymentCycleRow {
  user_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  payment_email: string | null;
  osm_username: string | null;
  hours: number;
  seconds: number;
  hourly_rate: number | null;
  compensation_model: CompensationModel;
  calculated_wage: number | null;
  adjustments_total: number;
  adjustments_count: number;
  total_payable: number;
  status: PaymentCycleStatus;
  status_note: string | null;
  status_actor_id: string | null;
  status_updated_at: string | null;
}

export type CompensationModel = "per_task" | "hourly" | "project_based";

export interface PayrollForecastCycle {
  label: string;
  start: string;
  end: string;
  is_current: boolean;
  is_projected: boolean;
  confirmed: number;
  variable: number;
  total: number;
}

export interface PayrollForecastResponse {
  cadence: string;
  cycles: PayrollForecastCycle[];
  stats: {
    projected_growth: number;
    projected_growth_pct: number;
    avg_monthly_growth: number;
    avg_monthly_growth_pct: number;
    variable_basis: number;
  };
  status: number;
}

export interface ProjectDispensationRow {
  id: number;
  name: string;
  budget: number;
  distributed: number;
  remaining: number;
}

export interface ProjectDispensationResponse {
  projects: ProjectDispensationRow[];
  project_count: number;
  totals: { budget: number; distributed: number; remaining: number };
  status: number;
}

export interface PayrollCadenceConfig {
  cadence: "monthly" | "semi_monthly" | "bi_weekly";
  anchor_day: number | null;
  anchor_date: string | null;
  timezone: string | null;
}

export interface PayrollConfigResponse {
  config: PayrollCadenceConfig;
  is_default: boolean;
  updated_by?: string;
  updated_at?: string;
  status: number;
}

export interface PaymentCycleResponse {
  rows: PaymentCycleRow[];
  cycle_start: string;
  cycle_end: string;
  include_zero_hours: boolean;
  status: number;
}

export interface PaymentCycleKpis {
  total_payable: number;
  total_paid_lifetime: number;
  approved_total: number;
  adjustments_total: number;
  pending_count: number;
  approved_count: number;
  held_count: number;
  paid_count: number;
  compensation_distribution: {
    per_task: number;
    hourly: number;
    project_based: number;
  };
}

export interface PaymentCycleKpisResponse {
  kpis: PaymentCycleKpis;
  cycle_start: string;
  cycle_end: string;
  status: number;
}

export interface PaymentAdjustment {
  id: number;
  user_id: string;
  cycle_start: string;
  cycle_end: string;
  amount: number;
  type: "reimbursement" | "correction" | "other";
  note: string | null;
  source: "admin_entry" | "approved_request";
  request_id: number | null;
  added_by: string;
  added_by_name: string | null;
  created_at: string | null;
}

// Reimbursement workflow (editor -> admin queue). Sibling of
// PaymentAdjustment: a ReimbursementRequest is the *workflow* record;
// when an admin approves one, a paired PaymentAdjustment row is
// created and linked via `adjustment_id` here / `request_id` there.
export type ReimbursementStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export interface ReimbursementRequest {
  id: number;
  user_id: string;
  org_id: string | null;
  amount: number;
  description: string;
  /** DO Spaces object key. NOT a fetchable URL — call
   *  `/reimbursements/attachment-url` to get a short-lived signed
   *  GET URL when rendering / downloading the receipt. */
  attachment_url: string | null;
  has_attachment: boolean;
  status: ReimbursementStatus;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  adjustment_id: number | null;
  // Present on the admin queue (pending_reimbursements) — omitted on
  // the editor's own-history rows.
  user_name?: string;
  user_osm_username?: string;
}

export interface ReimbursementListResponse {
  status: number;
  requests: ReimbursementRequest[];
  /** Only present on admin /pending responses. */
  pending_count?: number;
  message?: string;
}

export interface ReimbursementMutationResponse {
  status: number;
  request?: ReimbursementRequest;
  adjustment_id?: number;
  message?: string;
}

export interface ReimbursementUploadUrlResponse {
  status: number;
  url?: string;
  key?: string;
  expires_in_seconds?: number;
  max_bytes?: number;
  message?: string;
}

export interface ReimbursementAttachmentUrlResponse {
  status: number;
  url?: string;
  expires_in_seconds?: number;
  message?: string;
}

export interface PaymentContributorSession {
  id: number;
  clock_in: string | null;
  clock_out: string | null;
  duration_seconds: number;
  category: string;
  project_id: number | null;
  task_name: string | null;
  user_notes: string | null;
}

export interface PaymentContributorDetailResponse {
  contributor: PaymentCycleRow;
  sessions: PaymentContributorSession[];
  adjustments: PaymentAdjustment[];
  cycle_start: string;
  cycle_end: string;
  status: number;
}

export interface PaymentStatusRow {
  user_id: string;
  cycle_start: string;
  cycle_end: string;
  status: PaymentCycleStatus;
  note: string | null;
  actor_id: string | null;
  updated_at: string | null;
}

// Hourly contractor payment tracking
export interface HourlyMonthData {
  totalSeconds: number;
  hours: number;
  earnings: number;
  paid: boolean;
  paidAt: string | null;
  notes: string | null;
}

export interface HourlyContractor {
  userId: string;
  name: string;
  osmUsername: string;
  country: string;
  hourlyRate: number | null;
  months: Record<string, HourlyMonthData>;
  yearTotal: { totalSeconds: number; hours: number; earnings: number };
}

export interface HourlySummaryResponse {
  status: number;
  year: number;
  contractors: HourlyContractor[];
}

export interface HourlyRateEntry {
  id: number;
  user_id: string;
  org_id: string | null;
  rate: number;
  start_date: string; // ISO date "YYYY-MM-DD"
  end_date: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface HourlyRateHistoryResponse {
  rates: HourlyRateEntry[];
  status: number;
}

export interface HourlyRateMutationResponse {
  rate?: HourlyRateEntry;
  message?: string;
  status: number;
}

// ─── Comms platform — notifications + email + messenger ───────────────
//
// These types mirror the SEPARATE comms service contract (comms/views/*.py
// + comms/database/models.py), NOT Mikro's own backend. The messenger is
// app-agnostic: scopes are user (DM) / group (opaque key) / org (broadcast).
// Group targeting is scoped down for V1 (see messages page) — the types
// keep `group` so the contract stays faithful to the service.

export interface Notification {
  id: number;
  type: string;
  message: string;
  link: string | null;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  status: number;
  notifications: Notification[];
  total: number;
}

export interface NotificationUnreadCountResponse {
  status: number;
  unread_count: number;
}

export interface NotificationPreferences {
  notify_entry_adjusted: boolean;
  notify_entry_force_closed: boolean;
  notify_adjustment_requested: boolean;
  notify_assigned_to_project: boolean;
  notify_payment_sent: boolean;
  notify_bank_info_changed: boolean;
  notify_announcement: boolean;
  notify_message_received: boolean;
}

export interface NotificationPreferencesResponse {
  status: number;
  preferences: NotificationPreferences;
}

export interface EmailCampaign {
  id: number;
  subject: string;
  audience: string;
  is_forced: boolean;
  sent_by: string | null;
  // Comms returns only the sender's Auth0 sub (`sent_by`), not a display
  // name — kept optional so the history table can degrade to "—".
  sent_by_name?: string | null;
  sent_at: string | null;
  recipient_count: number | null;
  created_at: string;
}

export interface EmailCampaignsListResponse {
  status: number;
  campaigns: EmailCampaign[];
}

export interface EmailCampaignCreateResponse {
  status: number;
  // Comms wraps the created row in `campaign`; recipient_count lives on it.
  campaign: EmailCampaign;
  recipient_count?: number;
}

export interface EmailCampaignPreviewResponse {
  status: number;
  recipient_count: number | null;
  html?: string;
}

// Audience picker (Mikro-resolved, role-scoped). The backend tells the
// frontend which audience kinds the caller may target and supplies the
// concrete teams/regions to choose from.
export interface TargetableTeam {
  id: number;
  name: string;
}

export interface TargetableRegion {
  id: number;
  name: string;
}

export interface TargetableAudiencesResponse {
  status: number;
  can_target_org: boolean;
  can_target_regions: boolean;
  can_target_individuals: boolean;
  teams: TargetableTeam[];
  regions: TargetableRegion[];
}

export interface TargetableUser {
  sub: string;
  name: string;
  email: string;
}

export interface TargetableUsersResponse {
  status: number;
  users: TargetableUser[];
}

// Messenger scope types — aligned to the comms service (user/group/org).
export type MessageScopeType = "user" | "group" | "org";

export interface Message {
  id: number;
  sender_id: string;
  target_type: MessageScopeType;
  target_user_id: string | null;
  target_group_key: string | null;
  content: string;
  created_at: string;
}

export interface MessagesThreadResponse {
  status: number;
  messages: Message[];
  total: number;
}

export interface Conversation {
  scope_type: MessageScopeType;
  scope_key: string;
  label: string;
  subtitle: string | null;
  last_message: Message | null;
  unread_count: number;
}

export interface ConversationsResponse {
  status: number;
  conversations: Conversation[];
}

export interface MessagesSendResponse {
  status: number;
  message: Message;
}

export interface MessagesUnreadCountResponse {
  status: number;
  unread_count: number;
}
