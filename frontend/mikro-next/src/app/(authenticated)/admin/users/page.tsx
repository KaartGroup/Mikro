"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Modal, useToastActions, Skeleton, TableSkeleton } from "@/components/ui";
import { StandaloneFilter } from "@/components/admin/StandaloneFilter";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";
import { useFetchFilterOptions, useFetchCountries, useCurrentUserRole, useManagedTeams } from "@/hooks";
import { formatNumber, formatCurrency, displayRole } from "@/lib/utils";
import { Val } from "@/components/ui";
import { User, isOrgAdminOrAbove, roleLabel } from "@/types";

interface CsvUser {
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  osm_username: string;
  role: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editRole, setEditRole] = useState<string>("user");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editOsmUsername, setEditOsmUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTimezone, setEditTimezone] = useState("");
  const [editCountryId, setEditCountryId] = useState<number | null>(null);
  const [editMapillaryUsername, setEditMapillaryUsername] = useState("");
  const [editPaymentsVisible, setEditPaymentsVisible] = useState(false);
  const [editHourlyRate, setEditHourlyRate] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [inviteEmail, setInviteEmail] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvUsers, setCsvUsers] = useState<CsvUser[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeUsersTab, setActiveUsersTab] = useState<"active" | "deactivated">("active");
  // Standalone filter dropdowns — each null = "All …" (no filter).
  // Each writes a single-element values array into the request's
  // filters body; resolve_filtered_user_ids handles the rest.
  const [filterRegionId, setFilterRegionId] = useState<string | null>(null);
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterTimezone, setFilterTimezone] = useState<string | null>(null);
  const ROWS_PER_PAGE = 20;
  const toast = useToastActions();
  const { data: filterOptions } = useFetchFilterOptions();
  const { data: countriesData } = useFetchCountries();
  const countries = countriesData?.countries ?? [];

  // Role-aware UI (F3 Phase 3.4).
  // - team_admin: cannot promote, cannot mass-import/purge.
  //   "Search org users by email" feeds invite + add-to-team flow.
  // - super_admin: can promote any user including to super_admin.
  // - admin (Org Admin): can promote up to admin (NOT super_admin).
  const { role: viewerRole, loading: roleLoading } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canEditRole = isOrgAdminOrAbove(viewerRole); // org_admin / super_admin
  const canImportOrPurge = isOrgAdminOrAbove(viewerRole);
  const [orgUserSearchEmail, setOrgUserSearchEmail] = useState("");
  const [orgUserSearchResults, setOrgUserSearchResults] = useState<User[]>([]);
  const [orgUserSearching, setOrgUserSearching] = useState(false);

  // Backend endpoint lands in Phase 2 — until then, 404 is expected.
  // Wired here so the UI is ready and only needs the server.
  const handleOrgUserSearch = async () => {
    if (!orgUserSearchEmail.trim()) {
      setOrgUserSearchResults([]);
      return;
    }
    setOrgUserSearching(true);
    try {
      const res = await fetch("/backend/user/fetch_org_users_basic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: orgUserSearchEmail.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setOrgUserSearchResults(Array.isArray(data?.users) ? data.users : []);
      } else if (res.status === 404) {
        toast.info("Org user search isn't deployed yet.");
      } else {
        toast.error("Failed to search org users");
      }
    } catch {
      toast.error("Failed to search org users");
    } finally {
      setOrgUserSearching(false);
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortUsers = (list: User[]) => {
    const sorted = [...list];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortKey) {
        case "name":
          aVal = (a.name || "").toLowerCase();
          bVal = (b.name || "").toLowerCase();
          break;
        case "osm_username":
          aVal = (a.osm_username || "").toLowerCase();
          bVal = (b.osm_username || "").toLowerCase();
          break;
        case "role": {
          // Sort by role priority: super_admin > admin > team_admin > validator > user.
          const roleOrder: Record<string, number> = {
            super_admin: 5,
            admin: 4,
            team_admin: 3,
            validator: 2,
            user: 1,
          };
          aVal = roleOrder[a.role || ""] ?? 0;
          bVal = roleOrder[b.role || ""] ?? 0;
          break;
        }
        case "country":
          aVal = (a.country_name || "").toLowerCase();
          bVal = (b.country_name || "").toLowerCase();
          break;
        case "region":
          aVal = (a.region_name || "").toLowerCase();
          bVal = (b.region_name || "").toLowerCase();
          break;
        case "projects":
          aVal = a.assigned_projects ?? 0;
          bVal = b.assigned_projects ?? 0;
          break;
        case "mapped":
          aVal = a.total_tasks_mapped ?? 0;
          bVal = b.total_tasks_mapped ?? 0;
          break;
        case "validated":
          aVal = a.total_tasks_validated ?? 0;
          bVal = b.total_tasks_validated ?? 0;
          break;
        case "total_paid":
          aVal = a.total_payout ?? 0;
          bVal = b.total_payout ?? 0;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
    return sorted;
  };

  const filterUsersBySearch = (list: User[]) => {
    if (!userSearch.trim()) return list;
    const search = userSearch.trim().toLowerCase();
    return list.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(search) ||
        (u.osm_username || "").toLowerCase().includes(search) ||
        (u.email || "").toLowerCase().includes(search)
    );
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [userSearch, activeUsersTab, filterRegionId, filterCountryId, filterTeamId, filterRole, filterTimezone]);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchUsers = async () => {
    try {
      const filters: Record<string, string[]> = {};
      if (filterCountryId) filters.country = [filterCountryId];
      if (filterRegionId) filters.region = [filterRegionId];
      if (filterTeamId) filters.team = [filterTeamId];
      if (filterRole) filters.role = [filterRole];
      if (filterTimezone) filters.timezone = [filterTimezone];
      const body = Object.keys(filters).length > 0 ? { filters } : {};
      const response = await fetch("/backend/user/fetch_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading) fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterRegionId, filterCountryId, filterTeamId, filterRole, filterTimezone]);

  const handleSelectUser = (userId: string) => {
    setSelectedUser(selectedUser === userId ? null : userId);
  };

  const handleOpenEditModal = () => {
    if (selectedUser) {
      const user = users.find((u) => u.id === selectedUser);
      setEditRole(user?.role || "user");
      setEditFirstName(user?.first_name || "");
      setEditLastName(user?.last_name || "");
      setEditOsmUsername(user?.osm_username || "");
      setEditEmail(user?.email || "");
      setEditTimezone(user?.timezone || "");
      setEditCountryId(null); // Will show current country as placeholder
      setEditMapillaryUsername(user?.mapillary_username || "");
      setEditPaymentsVisible(user?.micropayments_visible ?? false);
      setEditHourlyRate(user?.hourly_rate?.toString() ?? "");
      setShowEditModal(true);
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail) {
      toast.error("Please enter an email address");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/invite_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(data.message || "Invitation sent successfully");
        setShowAddModal(false);
        setInviteEmail("");
        fetchUsers();
      } else {
        toast.error(data.message || "Failed to send invitation");
      }
    } catch (error) {
      console.error("Failed to invite user:", error);
      toast.error("Failed to send invitation");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveUser = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/modify_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUser,
          role: editRole,
          first_name: editFirstName,
          last_name: editLastName,
          osm_username: editOsmUsername,
          email: editEmail,
          timezone: editTimezone,
          ...(editCountryId !== null ? { country_id: editCountryId } : {}),
          mapillary_username: editMapillaryUsername,
          micropayments_visible: editPaymentsVisible,
          hourly_rate: editHourlyRate ? parseFloat(editHourlyRate) : null,
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("User updated successfully");
        setShowEditModal(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        toast.error(data.message || "Failed to update user");
      }
    } catch (error) {
      console.error("Failed to update user:", error);
      toast.error("Failed to update user");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/remove_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUser }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("User removed successfully");
        setShowDeleteModal(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        toast.error(data.message || "Failed to remove user");
      }
    } catch (error) {
      console.error("Failed to remove user:", error);
      toast.error("Failed to remove user");
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.trim().split("\n");
        if (lines.length < 2) {
          setImportError("CSV file must have a header row and at least one data row");
          return;
        }

        const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const emailIdx = header.indexOf("email");
        const nameIdx = header.indexOf("name");
        const firstNameIdx = header.indexOf("first_name");
        const lastNameIdx = header.indexOf("last_name");
        const osmUsernameIdx = header.indexOf("osm_username");
        const roleIdx = header.indexOf("role");

        if (emailIdx === -1) {
          setImportError("CSV must have an 'email' column");
          return;
        }

        const parsed: CsvUser[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",").map((v) => v.trim());
          if (values[emailIdx]) {
            const firstName = firstNameIdx !== -1 ? values[firstNameIdx] || "" : "";
            const lastName = lastNameIdx !== -1 ? values[lastNameIdx] || "" : "";
            const name = nameIdx !== -1 ? values[nameIdx] || "" : "";
            parsed.push({
              email: values[emailIdx],
              name: name,
              first_name: firstName,
              last_name: lastName,
              osm_username: osmUsernameIdx !== -1 ? values[osmUsernameIdx] || "" : "",
              role: roleIdx !== -1 ? values[roleIdx] || "user" : "user",
            });
          }
        }

        if (parsed.length === 0) {
          setImportError("No valid users found in CSV");
          return;
        }

        setCsvUsers(parsed);
        setShowImportModal(true);
      } catch {
        setImportError("Failed to parse CSV file");
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const handleImportUsers = async () => {
    if (csvUsers.length === 0) return;
    setIsSaving(true);
    setImportError(null);
    try {
      const response = await fetch("/backend/user/import_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: csvUsers }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        const successCount = data.results?.success?.length || 0;
        const failedItems = data.results?.failed || [];
        if (successCount > 0) {
          toast.success(`Successfully imported ${successCount} user(s).`);
          setShowImportModal(false);
          setCsvUsers([]);
          fetchUsers();
        }
        if (failedItems.length > 0) {
          const errorDetails = failedItems.map((f: { email: string; error: string }) => `${f.email}: ${f.error}`).join("\n");
          setImportError(`${failedItems.length} user(s) failed to import:\n${errorDetails}`);
          if (successCount === 0) {
            // Keep modal open to show errors
          }
        }
      } else {
        setImportError(data.message || "Import failed");
      }
    } catch (error) {
      console.error("Failed to import users:", error);
      setImportError("Failed to import users");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePurgeUsers = async () => {
    setIsPurging(true);
    try {
      const response = await fetch("/backend/user/purge_all_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(`Purged ${data.users_deleted} users. Your admin account was preserved.`);
        setShowPurgeModal(false);
        fetchUsers();
      } else {
        toast.error(data.message || "Failed to purge users");
      }
    } catch (error) {
      console.error("Failed to purge users:", error);
      toast.error("Failed to purge users");
    } finally {
      setIsPurging(false);
    }
  };

  if (isLoading || roleLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-10 w-full" />
        <TableSkeleton rows={10} />
      </div>
    );
  }

  // Team admin with zero managed teams → empty state, no table.
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <TeamAdminEmptyState context="user" />
      </div>
    );
  }

  const activeUsersAll = users.filter((u) => u.is_active !== false);
  const deactivatedUsersAll = users.filter((u) => u.is_active === false);
  const tabUsers = activeUsersTab === "deactivated" ? deactivatedUsersAll : activeUsersAll;
  const filteredUsers = sortUsers(filterUsersBySearch(tabUsers));
  const totalPages = Math.ceil(filteredUsers.length / ROWS_PER_PAGE);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );
  const showingStart = filteredUsers.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, filteredUsers.length);

  return (
    <div className="space-y-8">
      {/* Action Buttons */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <div className="flex gap-2">
          <Button onClick={() => setShowAddModal(true)}>Add</Button>
          <Button
            variant="secondary"
            onClick={handleOpenEditModal}
            disabled={!selectedUser}
          >
            Edit
          </Button>
          {canEditRole && (
            <Button
              variant="destructive"
              onClick={() => selectedUser && setShowDeleteModal(true)}
              disabled={!selectedUser}
            >
              Delete
            </Button>
          )}
          {canImportOrPurge && (
            <Button variant="outline" onClick={handleImportClick}>Import CSV</Button>
          )}
        </div>
      </div>

      {/* Search + Filters — each filterable dimension is its own
          visible dropdown. All default to "All …" (no filter). */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Search
          </label>
          <input
            type="text"
            placeholder="Search users..."
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Region"
            allLabel="All regions"
            options={(filterOptions?.dimensions?.region ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterRegionId}
            onChange={setFilterRegionId}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Country"
            allLabel="All countries"
            options={(filterOptions?.dimensions?.country ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterCountryId}
            onChange={setFilterCountryId}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Team"
            allLabel="All teams"
            options={(filterOptions?.dimensions?.team ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterTeamId}
            onChange={setFilterTeamId}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Role"
            allLabel="All roles"
            options={(filterOptions?.dimensions?.role ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterRole}
            onChange={setFilterRole}
          />
        </div>
        <div className="w-44">
          <StandaloneFilter
            label="Timezone"
            allLabel="All timezones"
            options={(filterOptions?.dimensions?.timezone ?? [])
              .map((v) =>
                typeof v === "string"
                  ? { value: v, label: v }
                  : { value: String(v.id ?? v.name), label: v.name },
              )}
            value={filterTimezone}
            onChange={setFilterTimezone}
          />
        </div>
      </div>

      {/* Active / Deactivated tabs — partition users without changing
          fetch behavior. Counts come from the un-paginated, un-search-
          filtered partition so the tab strip always reflects org totals. */}
      <div className="flex items-center gap-1 border-b border-border">
        {(["active", "deactivated"] as const).map((tab) => {
          const count =
            tab === "active" ? activeUsersAll.length : deactivatedUsersAll.length;
          const label = tab === "active" ? "Active users" : "Deactivated";
          const selected = activeUsersTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveUsersTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                selected
                  ? "border-kaart-orange text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}{" "}
              <span
                className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 ml-1 rounded-full text-xs ${
                  selected ? "bg-kaart-orange text-white" : "bg-muted"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 900 }}>
              <thead className="bg-muted border-b border-border">
                <tr>
                  {[
                    { key: "name", label: "Name" },
                    { key: "osm_username", label: "OSM User" },
                    { key: "role", label: "Role" },
                    { key: "", label: "Pay" },
                    { key: "country", label: "Country" },
                    { key: "region", label: "Region" },
                    { key: "", label: "Timezone" },
                    { key: "projects", label: "Projects" },
                    { key: "mapped", label: "Mapped" },
                    { key: "validated", label: "Validated" },
                    { key: "", label: "Invalidated" },
                    { key: "", label: "Awaiting" },
                    { key: "total_paid", label: "Total Paid" },
                  ].map((col, i) => (
                    <th
                      key={`${col.label}-${i}`}
                      className={`px-2 py-1.5 text-left text-xs font-semibold text-foreground whitespace-nowrap ${col.key ? "cursor-pointer select-none hover:text-kaart-orange transition-colors" : ""}`}
                      onClick={col.key ? () => handleSort(col.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.key && sortKey === col.key && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d={sortDir === "asc" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                          </svg>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {paginatedUsers.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => handleSelectUser(user.id)}
                    className={`cursor-pointer transition-colors ${
                      selectedUser === user.id
                        ? "bg-kaart-orange/15 dark:bg-kaart-orange/25 hover:bg-kaart-orange/20 dark:hover:bg-kaart-orange/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <td className="px-2 py-1.5 max-w-[120px] truncate">
                      <Link
                        href={`/admin/users/${user.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-kaart-orange hover:underline"
                        title={user.name?.trim() || user.email || "Unknown"}
                      >
                        {user.name?.trim() || user.email || "Unknown"}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-sm text-foreground max-w-[120px] truncate" title={user.osm_username || ""}>{user.osm_username || "\u2014"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            user.role === "super_admin"
                              ? "bg-pink-100 text-pink-800"
                              : user.role === "admin"
                              ? "bg-purple-100 text-purple-800"
                              : user.role === "team_admin"
                              ? "bg-indigo-100 text-indigo-800"
                              : user.role === "validator"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {roleLabel(user.role)}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {user.micropayments_visible ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Yes</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">No</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-foreground max-w-[120px] truncate" title={user.country_name || ""}>{user.country_name || "\u2014"}</td>
                    <td className="px-2 py-1.5 text-foreground">{user.region_name || "\u2014"}</td>
                    <td className="px-2 py-1.5 text-foreground">{user.timezone || "\u2014"}</td>
                    <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.assigned_projects)}</Val></td>
                    <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_mapped)}</Val></td>
                    <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_validated)}</Val></td>
                    <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_invalidated)}</Val></td>
                    <td className="px-2 py-1.5 text-foreground">
                      <Val>{formatCurrency(user.awaiting_payment)}</Val>
                    </td>
                    <td className="px-2 py-1.5 text-foreground">
                      <Val>{formatCurrency(user.total_payout)}</Val>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {filteredUsers.length > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-sm text-muted-foreground">
            Showing {showingStart}–{showingEnd} of {filteredUsers.length} users
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Team Admin: search the broader org by email to find candidates
          to add to a managed team. Backend endpoint
          fetch_org_users_basic returns name/role/osm only — no pay
          fields, server-redacted. Falls back gracefully on 404 until
          the endpoint ships in Phase 2. */}
      {isTeamAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Search org users by email</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Find users across your organization by email to invite or add
              to one of your managed teams.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="user@example.com"
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-ring"
                value={orgUserSearchEmail}
                onChange={(e) => setOrgUserSearchEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleOrgUserSearch();
                }}
              />
              <Button
                onClick={handleOrgUserSearch}
                disabled={orgUserSearching || !orgUserSearchEmail.trim()}
              >
                {orgUserSearching ? "Searching…" : "Search"}
              </Button>
            </div>
            {orgUserSearchResults.length > 0 && (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Email</th>
                      <th className="px-3 py-2 text-left font-medium">Role</th>
                      <th className="px-3 py-2 text-left font-medium">OSM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orgUserSearchResults.map((u) => (
                      <tr key={u.id}>
                        <td className="px-3 py-2">{u.name || "-"}</td>
                        <td className="px-3 py-2">{u.email || "-"}</td>
                        <td className="px-3 py-2">{roleLabel(u.role)}</td>
                        <td className="px-3 py-2">{u.osm_username || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add User Modal */}
      <Modal isOpen={showAddModal} onClose={() => { setShowAddModal(false); setInviteEmail(""); }} title="Invite User">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email Address</label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            The user will receive an email to set their password and complete registration.
          </p>
          <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            If this user already has a Kaart login, they can use those same credentials to log into Mikro directly — no password change needed.
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowAddModal(false); setInviteEmail(""); }}>
              Cancel
            </Button>
            <Button onClick={handleInviteUser} disabled={isSaving || !inviteEmail}>
              {isSaving ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit User" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">First Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">OSM Username</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                value={editOsmUsername}
                onChange={(e) => setEditOsmUsername(e.target.value)}
                placeholder="osm_username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mapillary Username</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                value={editMapillaryUsername}
                onChange={(e) => setEditMapillaryUsername(e.target.value)}
                placeholder="mapillary_username"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              {canEditRole ? (
                <select
                  className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  <option value="user">{roleLabel("user")}</option>
                  <option value="validator">{roleLabel("validator")}</option>
                  <option value="team_admin">{roleLabel("team_admin")}</option>
                  <option value="admin">{roleLabel("admin")}</option>
                  {viewerRole === "super_admin" && (
                    <option value="super_admin">{roleLabel("super_admin")}</option>
                  )}
                </select>
              ) : (
                // team_admin viewers cannot promote — show read-only display.
                <div className="w-full px-3 py-2 border border-input rounded-lg bg-muted text-sm text-muted-foreground">
                  {roleLabel(editRole)}
                  <span className="ml-2 text-xs italic">(read-only)</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <select
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                value={editTimezone}
                onChange={(e) => setEditTimezone(e.target.value)}
              >
                <option value="">— Select timezone —</option>
                {Intl.supportedValuesOf("timeZone").map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Country</label>
            <select
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              value={editCountryId ?? ""}
              onChange={(e) => setEditCountryId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">
                {users.find((u) => u.id === selectedUser)?.country_name || "— Select country —"}
              </option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              backgroundColor: "var(--secondary)",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <div>
              <p style={{ fontWeight: 500, fontSize: 14 }}>Show Micropayments</p>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                Allow this user to see micropayment rates, earnings, and request payouts
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditPaymentsVisible(!editPaymentsVisible)}
              style={{
                position: "relative",
                display: "inline-flex",
                height: 24,
                width: 44,
                alignItems: "center",
                borderRadius: 9999,
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s",
                backgroundColor: editPaymentsVisible ? "#22c55e" : "#d1d5db",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  height: 16,
                  width: 16,
                  borderRadius: "50%",
                  backgroundColor: "white",
                  transition: "transform 0.2s",
                  transform: editPaymentsVisible ? "translateX(24px)" : "translateX(4px)",
                }}
              />
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hourly Rate</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              value={editHourlyRate}
              onChange={(e) => setEditHourlyRate(e.target.value)}
              placeholder="Not set"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete User Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete User">
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Are you sure you want to remove{" "}
            <span className="font-semibold text-foreground">
              {users.find((u) => u.id === selectedUser)?.name || users.find((u) => u.id === selectedUser)?.email || "this user"}
            </span>
            ? This action cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={isSaving}>
              {isSaving ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Hidden file input for CSV import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".csv,text/csv"
        className="hidden"
      />

      {/* Import CSV Modal */}
      <Modal isOpen={showImportModal} onClose={() => { setShowImportModal(false); setCsvUsers([]); }} title="Import Users from CSV" size="2xl">
        <div className="space-y-4">
          {importError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {importError}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            The following {csvUsers.length} user(s) will be invited. Each will receive an email to set their password.
          </p>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">First Name</th>
                  <th className="px-4 py-2 text-left font-medium">Last Name</th>
                  <th className="px-4 py-2 text-left font-medium">OSM Username</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {csvUsers.map((user, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2">{user.email}</td>
                    <td className="px-4 py-2">{user.first_name || user.name?.split(" ")[0] || "-"}</td>
                    <td className="px-4 py-2">{user.last_name || user.name?.split(" ").slice(1).join(" ") || "-"}</td>
                    <td className="px-4 py-2">{user.osm_username || "-"}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.role === "super_admin"
                          ? "bg-pink-100 text-pink-800"
                          : user.role === "admin"
                          ? "bg-purple-100 text-purple-800"
                          : user.role === "team_admin"
                          ? "bg-indigo-100 text-indigo-800"
                          : user.role === "validator"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                      }`}>
                        {roleLabel(user.role)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowImportModal(false); setCsvUsers([]); }}>
              Cancel
            </Button>
            <Button onClick={handleImportUsers} disabled={isSaving}>
              {isSaving ? "Importing..." : `Import ${csvUsers.length} User(s)`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Purge Users Modal */}
      <Modal isOpen={showPurgeModal} onClose={() => setShowPurgeModal(false)} title="Purge All Users">
        <div className="space-y-4">
          <p className="text-muted-foreground">
            This will permanently delete ALL users in the organization except your own admin account.
            All related data (task assignments, checklists, trainings, payments) will also be deleted.
          </p>
          <p className="text-red-600 font-semibold">
            This action cannot be undone!
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowPurgeModal(false)} disabled={isPurging}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handlePurgeUsers} disabled={isPurging}>
              {isPurging ? "Purging..." : "Purge All Users"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Dev Tools — Org Admin / Super Admin only. Team Admins lack
          the broad-user-purge permission server-side anyway, but
          hiding it here keeps the UI honest. */}
      {canImportOrPurge && (
        <Card className="border-2 border-dashed border-yellow-500">
          <CardHeader>
            <CardTitle className="text-yellow-700">Dev Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Button
                variant="destructive"
                onClick={() => setShowPurgeModal(true)}
              >
                Purge All Users
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Warning: This will delete all users except your own admin account.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
