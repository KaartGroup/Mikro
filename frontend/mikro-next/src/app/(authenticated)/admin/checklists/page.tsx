"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  Input,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Skeleton,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import LocationsTab from "@/components/LocationsTab";
import {
  useAdminChecklists,
  useCreateChecklist,
  useUpdateChecklist,
  useDeleteChecklist,
  useConfirmChecklist,
  useUsersList,
  useAssignUserChecklist,
  useUnassignUserChecklist,
  useFetchChecklistUsers,
  usePurgeChecklists,
  useCurrentUserRole,
  useManagedTeams,
} from "@/hooks";
import type { Checklist } from "@/types";
import { isOrgAdminOrAbove } from "@/types";
import { formatNumber, formatCurrency, displayRole } from "@/lib/utils";
import { useUser } from "@auth0/nextjs-auth0/client";
import { TeamAdminEmptyState } from "@/components/admin/TeamAdminEmptyState";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ChecklistFormData {
  name: string;
  description: string;
  completion_rate: string;
  validation_rate: string;
  difficulty: string;
  due_date: string;
  assigned_user_id: string;
  active_status: boolean;
}

const defaultFormData: ChecklistFormData = {
  name: "",
  description: "",
  completion_rate: "5.00",
  validation_rate: "2.50",
  difficulty: "Medium",
  due_date: "",
  assigned_user_id: "",
  active_status: false,
};

interface ItemFormData {
  action: string;
  link: string;
}

export default function AdminChecklistsPage() {
  const { data: checklists, loading, refetch } = useAdminChecklists();
  const { data: usersData } = useUsersList();
  const { mutate: createChecklist, loading: creating } = useCreateChecklist();
  const { mutate: updateChecklist, loading: updating } = useUpdateChecklist();
  const { mutate: deleteChecklist, loading: deleting } = useDeleteChecklist();
  const { mutate: confirmChecklist, loading: confirming } = useConfirmChecklist();
  const { mutate: assignUser, loading: assigning } = useAssignUserChecklist();
  const { mutate: unassignUser, loading: unassigning } = useUnassignUserChecklist();
  const { mutate: fetchChecklistUsers } = useFetchChecklistUsers();
  const { mutate: purgeChecklists, loading: purging } = usePurgeChecklists();
  const { user: auth0User } = useUser();
  const toast = useToastActions();
  const [searchTerm, setSearchTerm] = useState("");

  // Role-aware UI (F3 Phase 3.4):
  // - team_admin: list scoped server-side to managed-team checklists.
  //   No create/delete/purge UI.
  const { role: viewerRole, loading: roleLoading } = useCurrentUserRole();
  const { teams: managedTeams, loading: managedTeamsLoading } = useManagedTeams();
  const isTeamAdmin = viewerRole === "team_admin";
  const canCreateOrDelete = isOrgAdminOrAbove(viewerRole);

  const [selectedChecklist, setSelectedChecklist] = useState<Checklist | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [checklistUsers, setChecklistUsers] = useState<Array<{ id: string; name: string; role: string; assigned: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [formData, setFormData] = useState<ChecklistFormData>(defaultFormData);
  const [items, setItems] = useState<ItemFormData[]>([]);
  const [editTab, setEditTab] = useState<"settings" | "locations">("settings");

  const activeChecklists = useMemo(() => checklists?.active_checklists ?? [], [checklists?.active_checklists]);
  const inactiveChecklists = useMemo(() => checklists?.inactive_checklists ?? [], [checklists?.inactive_checklists]);
  const completedChecklists = useMemo(() => checklists?.ready_for_confirmation ?? [], [checklists?.ready_for_confirmation]);
  const confirmedChecklists = useMemo(() => checklists?.confirmed_and_completed ?? [], [checklists?.confirmed_and_completed]);
  const staleChecklists = useMemo(() => checklists?.stale_started_checklists ?? [], [checklists?.stale_started_checklists]);

  const users = useMemo(() => usersData?.users ?? [], [usersData?.users]);

  // Calculate stats
  const stats = useMemo(() => {
    const all = [
      ...activeChecklists,
      ...inactiveChecklists,
      ...completedChecklists,
      ...confirmedChecklists,
      ...staleChecklists,
    ];
    const totalPaid = confirmedChecklists.reduce(
      (sum, c) => sum + c.completion_rate + c.validation_rate,
      0
    );
    return {
      total: all.length,
      active: activeChecklists.length,
      pendingConfirmation: completedChecklists.length,
      totalPaid,
    };
  }, [activeChecklists, inactiveChecklists, completedChecklists, confirmedChecklists, staleChecklists]);

  const currentUserName = auth0User?.name || "";

  const filterChecklists = useCallback((list: Checklist[]) => {
    if (!searchTerm.trim()) return list;
    const s = searchTerm.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.author || "").toLowerCase().includes(s) ||
        (c.description || "").toLowerCase().includes(s) ||
        (c.difficulty || "").toLowerCase().includes(s)
    );
  }, [searchTerm]);

  const allChecklists = useMemo(() => [
    ...activeChecklists,
    ...inactiveChecklists,
    ...completedChecklists,
    ...confirmedChecklists,
    ...staleChecklists,
  ], [activeChecklists, inactiveChecklists, completedChecklists, confirmedChecklists, staleChecklists]);

  const myChecklists = useMemo(() =>
    allChecklists.filter(
      (c) => c.author && currentUserName && c.author.toLowerCase().includes(currentUserName.split(" ")[0].toLowerCase())
    ),
  [allChecklists, currentUserName]);

  const handleInputChange = (field: keyof ChecklistFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateChecklist = async () => {
    if (!formData.name) {
      toast.error("Please enter a checklist name");
      return;
    }

    const filteredItems = items.filter((i) => i.action.trim());
    if (filteredItems.length === 0) {
      toast.error("Please add at least one checklist item");
      return;
    }

    try {
      await createChecklist({
        checklistName: formData.name,
        checklistDescription: formData.description,
        completionRate: parseFloat(formData.completion_rate),
        validationRate: parseFloat(formData.validation_rate),
        checklistDifficulty: formData.difficulty,
        dueDate: formData.due_date || undefined,
        visibility: true,
        activeStatus: formData.active_status,
        assignUserId: formData.assigned_user_id || undefined,
        listItems: filteredItems.map((i, idx) => ({
          number: idx + 1,
          action: i.action,
          link: i.link || "",
        })),
      });

      const messages = ["Checklist created successfully"];
      if (formData.active_status) messages.push("(Active)");
      if (formData.assigned_user_id) messages.push("and assigned to user");
      toast.success(messages.join(" "));

      setShowAddModal(false);
      setFormData(defaultFormData);
      setItems([]);
      refetch();
    } catch {
      toast.error("Failed to create checklist");
    }
  };

  const handleUpdateChecklist = async () => {
    if (!selectedChecklist) return;

    try {
      await updateChecklist({
        checklistSelected: selectedChecklist.id,
        checklistName: formData.name,
        checklistDescription: formData.description,
        completionRate: parseFloat(formData.completion_rate),
        validationRate: parseFloat(formData.validation_rate),
        difficulty: formData.difficulty,
        checklistStatus: formData.active_status,
      });
      toast.success("Checklist updated successfully");
      setShowEditModal(false);
      setSelectedChecklist(null);
      refetch();
    } catch {
      toast.error("Failed to update checklist");
    }
  };

  const handleDeleteChecklist = async () => {
    if (!selectedChecklist) return;

    try {
      await deleteChecklist({ checklist_id: selectedChecklist.id });
      toast.success("Checklist deleted successfully");
      setShowDeleteModal(false);
      setSelectedChecklist(null);
      refetch();
    } catch {
      toast.error("Failed to delete checklist");
    }
  };

  const handleConfirmChecklist = async (checklist: Checklist) => {
    try {
      await confirmChecklist({ checklist_id: checklist.id });
      toast.success("Checklist confirmed and payment processed");
      refetch();
    } catch {
      toast.error("Failed to confirm checklist");
    }
  };

  const openEditModal = (checklist: Checklist) => {
    setSelectedChecklist(checklist);
    setFormData({
      name: checklist.name,
      description: checklist.description || "",
      completion_rate: checklist.completion_rate.toString(),
      validation_rate: checklist.validation_rate.toString(),
      difficulty: checklist.difficulty,
      due_date: checklist.due_date || "",
      assigned_user_id: checklist.assigned_user_id?.toString() || "",
      active_status: checklist.active_status ?? false,
    });
    setEditTab("settings");
    setShowEditModal(true);
  };

  const openDetailsModal = (checklist: Checklist) => {
    setSelectedChecklist(checklist);
    setShowDetailsModal(true);
  };

  const openAssignModal = async (checklist: Checklist) => {
    setSelectedChecklist(checklist);
    setShowAssignModal(true);
    setLoadingUsers(true);
    try {
      const result = await fetchChecklistUsers({ checklist_id: checklist.id });
      setChecklistUsers(result.users ?? []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleAssignUser = async (userId: string) => {
    if (!selectedChecklist) return;
    try {
      await assignUser({
        checklist_id: selectedChecklist.id,
        user_id: userId,
      });
      toast.success("User assigned to checklist");
      // Refresh the user list
      const result = await fetchChecklistUsers({ checklist_id: selectedChecklist.id });
      setChecklistUsers(result.users ?? []);
      refetch();
    } catch {
      toast.error("Failed to assign user");
    }
  };

  const handleUnassignUser = async (userId: string) => {
    if (!selectedChecklist) return;
    try {
      await unassignUser({
        checklist_id: selectedChecklist.id,
        user_id: userId,
      });
      toast.success("User unassigned from checklist");
      // Refresh the user list
      const result = await fetchChecklistUsers({ checklist_id: selectedChecklist.id });
      setChecklistUsers(result.users ?? []);
      refetch();
    } catch {
      toast.error("Failed to unassign user");
    }
  };

  const handlePurgeChecklists = async () => {
    try {
      const result = await purgeChecklists({});
      toast.success(`Purged ${result.checklists_deleted} checklists, reset ${result.users_reset} users`);
      setShowPurgeModal(false);
      refetch();
    } catch {
      toast.error("Failed to purge checklists");
    }
  };

  const newItemRef = useRef<HTMLInputElement>(null);
  const [focusNewItem, setFocusNewItem] = useState(false);

  const addItem = () => {
    setItems([...items, { action: "", link: "" }]);
    setFocusNewItem(true);
  };

  // Auto-focus new item input when added
  useEffect(() => {
    if (focusNewItem && newItemRef.current) {
      newItemRef.current.focus();
      setFocusNewItem(false);
    }
  }, [items.length, focusNewItem]);

  const updateItem = (index: number, field: keyof ItemFormData, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const ChecklistCard = ({ checklist, showConfirm = false }: { checklist: Checklist; showConfirm?: boolean }) => {
    const completedItems = checklist.list_items?.filter((i) => i.completed).length ?? 0;
    const totalItems = checklist.list_items?.length ?? 0;
    const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <CardTitle className="text-lg">{checklist.name}</CardTitle>
            <div className="flex items-center gap-1">
              <Badge
                variant={
                  checklist.difficulty === "Easy"
                    ? "success"
                    : checklist.difficulty === "Medium"
                    ? "warning"
                    : "destructive"
                }
              >
                {checklist.difficulty}
              </Badge>
              {(checklist as Checklist & { assigned_locations?: number }).assigned_locations ? (
                <Badge variant="secondary" className="text-[10px]">
                  {(checklist as Checklist & { assigned_locations?: number }).assigned_locations} loc
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
            {checklist.description || "No description"}
          </p>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span>{completedItems}/{totalItems} items</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-kaart-orange rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completion Rate:</span>
              <span className="font-medium"><Val>{formatCurrency(checklist.completion_rate)}</Val></span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Validation Rate:</span>
              <span className="font-medium"><Val>{formatCurrency(checklist.validation_rate)}</Val></span>
            </div>
            {checklist.due_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due:</span>
                <span>{formatDate(checklist.due_date)}</span>
              </div>
            )}
            {checklist.author && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created by:</span>
                <span className="truncate ml-2">{checklist.author}</span>
              </div>
            )}
            {checklist.assigned_user && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned:</span>
                <span>{checklist.assigned_user}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => openDetailsModal(checklist)}
              >
                View Details
              </Button>
              {showConfirm ? (
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1"
                  onClick={() => handleConfirmChecklist(checklist)}
                  isLoading={confirming}
                >
                  Confirm
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => openEditModal(checklist)}
                >
                  Edit
                </Button>
              )}
            </div>
            {!showConfirm && (
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => openAssignModal(checklist)}
              >
                Assign Users
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const ROWS_PER_PAGE = 20;

  const PaginatedChecklistGrid = ({ list, showConfirm = false, emptyMessage }: { list: Checklist[]; showConfirm?: boolean; emptyMessage: string }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const prevSearchRef = useRef(searchTerm);
    if (prevSearchRef.current !== searchTerm) {
      prevSearchRef.current = searchTerm;
      if (currentPage !== 1) setCurrentPage(1);
    }
    const filtered = filterChecklists(list);
    const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
    const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
    const showingStart = filtered.length === 0 ? 0 : (currentPage - 1) * ROWS_PER_PAGE + 1;
    const showingEnd = Math.min(currentPage * ROWS_PER_PAGE, filtered.length);

    if (filtered.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {searchTerm ? `No matching ${emptyMessage.toLowerCase()}` : emptyMessage}
          </CardContent>
        </Card>
      );
    }

    return (
      <>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {paginated.map((checklist) => (
            <ChecklistCard key={checklist.id} checklist={checklist} showConfirm={showConfirm} />
          ))}
        </div>
        {filtered.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between mt-4 px-2">
            <span className="text-sm text-muted-foreground">
              Showing {showingStart}–{showingEnd} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </>
    );
  };

  if (loading || roleLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // team_admin with no managed teams → empty state.
  if (
    isTeamAdmin &&
    !managedTeamsLoading &&
    managedTeams.length === 0
  ) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Checklists</h1>
        <TeamAdminEmptyState context="checklist" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Checklists</h1>
          <p className="text-muted-foreground">
            Manage checklists and track completion
          </p>
        </div>
        {canCreateOrDelete && (
          <Button onClick={() => setShowAddModal(true)}>Create Checklist</Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Checklists</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold"><Val>{formatNumber(stats.total)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-kaart-orange"><Val>{formatNumber(stats.active)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending Confirmation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600"><Val>{formatNumber(stats.pendingConfirmation)}</Val></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Paid Out</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600"><Val>{formatCurrency(stats.totalPaid)}</Val></div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex-1">
        <Input
          placeholder="Search by name, creator, description, or difficulty..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({formatNumber(activeChecklists.length).text})</TabsTrigger>
          <TabsTrigger value="mine">Created by Me ({formatNumber(myChecklists.length).text})</TabsTrigger>
          <TabsTrigger value="pending">Pending Confirmation ({formatNumber(completedChecklists.length).text})</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmed ({formatNumber(confirmedChecklists.length).text})</TabsTrigger>
          <TabsTrigger value="inactive">Inactive ({formatNumber(inactiveChecklists.length).text})</TabsTrigger>
          <TabsTrigger value="stale">Stale ({formatNumber(staleChecklists.length).text})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <PaginatedChecklistGrid list={activeChecklists} emptyMessage="No active checklists" />
        </TabsContent>

        <TabsContent value="mine">
          <PaginatedChecklistGrid list={myChecklists} emptyMessage="No checklists created by you" />
        </TabsContent>

        <TabsContent value="pending">
          <PaginatedChecklistGrid list={completedChecklists} showConfirm emptyMessage="No checklists pending confirmation" />
        </TabsContent>

        <TabsContent value="confirmed">
          <PaginatedChecklistGrid list={confirmedChecklists} emptyMessage="No confirmed checklists" />
        </TabsContent>

        <TabsContent value="inactive">
          <PaginatedChecklistGrid list={inactiveChecklists} emptyMessage="No inactive checklists" />
        </TabsContent>

        <TabsContent value="stale">
          <PaginatedChecklistGrid list={staleChecklists} emptyMessage="No stale checklists" />
        </TabsContent>
      </Tabs>

      {/* Add Checklist Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setFormData(defaultFormData);
          setItems([]);
        }}
        title="Create Checklist"
        description="Create a new checklist with tasks"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateChecklist} isLoading={creating}>
              Create Checklist
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            placeholder="Checklist name"
            value={formData.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              rows={3}
              placeholder="Describe the checklist..."
              value={formData.description}
              onChange={(e) => handleInputChange("description", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Completion Rate ($)"
              type="number"
              step="0.01"
              value={formData.completion_rate}
              onChange={(e) => handleInputChange("completion_rate", e.target.value)}
            />
            <Input
              label="Validation Rate ($)"
              type="number"
              step="0.01"
              value={formData.validation_rate}
              onChange={(e) => handleInputChange("validation_rate", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Difficulty"
              value={formData.difficulty}
              onChange={(value) => handleInputChange("difficulty", value)}
              options={[
                { value: "Easy", label: "Easy" },
                { value: "Medium", label: "Medium" },
                { value: "Hard", label: "Hard" },
              ]}
            />
            <Input
              label="Due Date"
              type="date"
              value={formData.due_date}
              onChange={(e) => handleInputChange("due_date", e.target.value)}
            />
          </div>
          <Select
            label="Assign to User (optional)"
            value={formData.assigned_user_id}
            onChange={(value) => handleInputChange("assigned_user_id", value)}
            options={[
              { value: "", label: "Unassigned" },
              ...users.map((u) => ({
                value: u.id,
                label: `${u.name}${u.osm_username ? ` (${u.osm_username})` : ""}`,
              })),
            ]}
          />

          {/* Activate Toggle */}
          <div className="flex items-center gap-3 py-2 px-3 bg-muted rounded-lg">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.active_status}
                onChange={(e) => handleInputChange("active_status", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              <span className="ml-3 text-sm font-medium">
                {formData.active_status ? "Active (Published)" : "Inactive (Draft)"}
              </span>
            </label>
            <span className="text-xs text-muted-foreground ml-auto">
              {formData.active_status
                ? "Users can see and start this checklist"
                : "Only visible to admins until activated"}
            </span>
          </div>

          {/* Items Section */}
          <div className="border-t border-border pt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium">Checklist Items ({items.length})</h3>
              <Button size="sm" variant="outline" onClick={addItem}>
                Add Item
              </Button>
            </div>
            {items.map((item, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input
                  ref={index === items.length - 1 ? newItemRef : undefined}
                  placeholder="Task description"
                  value={item.action}
                  onChange={(e) => updateItem(index, "action", e.target.value)}
                  className="flex-1 px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                />
                <input
                  placeholder="Link (optional)"
                  value={item.link}
                  onChange={(e) => updateItem(index, "link", e.target.value)}
                  className="w-40 px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeItem(index)}
                  className="text-red-600"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Edit Checklist Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedChecklist(null);
          refetch();
        }}
        title="Edit Checklist"
        description={`Editing ${selectedChecklist?.name}`}
        size="lg"
        footer={
          <>
            {canCreateOrDelete && (
              <Button
                variant="destructive"
                onClick={() => {
                  setShowEditModal(false);
                  setShowDeleteModal(true);
                }}
              >
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => {
              setShowEditModal(false);
              setSelectedChecklist(null);
              refetch();
            }}>
              Cancel
            </Button>
            <Button onClick={handleUpdateChecklist} isLoading={updating}>
              Save Changes
            </Button>
          </>
        }
      >
        <Tabs defaultValue="settings" value={editTab} onValueChange={(v) => setEditTab(v as "settings" | "locations")}>
          <TabsList className="mb-4">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <div className="space-y-4">
              <Input
                label="Name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Completion Rate ($)"
                  type="number"
                  step="0.01"
                  value={formData.completion_rate}
                  onChange={(e) => handleInputChange("completion_rate", e.target.value)}
                />
                <Input
                  label="Validation Rate ($)"
                  type="number"
                  step="0.01"
                  value={formData.validation_rate}
                  onChange={(e) => handleInputChange("validation_rate", e.target.value)}
                />
              </div>
              <Select
                label="Difficulty"
                value={formData.difficulty}
                onChange={(value) => handleInputChange("difficulty", value)}
                options={[
                  { value: "Easy", label: "Easy" },
                  { value: "Medium", label: "Medium" },
                  { value: "Hard", label: "Hard" },
                ]}
              />
              <div className="flex items-center gap-3 pt-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.active_status}
                    onChange={(e) => handleInputChange("active_status", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  <span className="ml-3 text-sm font-medium">
                    {formData.active_status ? "Active" : "Inactive"}
                  </span>
                </label>
                <span className="text-xs text-muted-foreground">
                  (Active checklists can be assigned to users)
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="locations">
            {selectedChecklist && (
              <LocationsTab resourceId={selectedChecklist.id} resourceType="checklist" />
            )}
          </TabsContent>
        </Tabs>
      </Modal>

      {/* Details Modal */}
      <Modal
        isOpen={showDetailsModal}
        onClose={() => {
          setShowDetailsModal(false);
          setSelectedChecklist(null);
        }}
        title={selectedChecklist?.name ?? "Checklist Details"}
        description={selectedChecklist?.description || "No description"}
        size="lg"
        footer={
          <Button onClick={() => setShowDetailsModal(false)}>Close</Button>
        }
      >
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 bg-muted p-4 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Completion Rate</p>
              <p className="font-bold"><Val>{formatCurrency(selectedChecklist?.completion_rate)}</Val></p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Validation Rate</p>
              <p className="font-bold"><Val>{formatCurrency(selectedChecklist?.validation_rate)}</Val></p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Difficulty</p>
              <Badge
                variant={
                  selectedChecklist?.difficulty === "Easy"
                    ? "success"
                    : selectedChecklist?.difficulty === "Medium"
                    ? "warning"
                    : "destructive"
                }
              >
                {selectedChecklist?.difficulty}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Due Date</p>
              <p className="font-bold">
                {selectedChecklist?.due_date ? formatDate(selectedChecklist.due_date) : "No due date"}
              </p>
            </div>
          </div>

          {/* Items */}
          <div>
            <h3 className="font-medium mb-2">
              Items ({selectedChecklist?.list_items?.filter((i) => i.completed).length ?? 0}/
              {selectedChecklist?.list_items?.length ?? 0} completed)
            </h3>
            <div className="space-y-2">
              {selectedChecklist?.list_items?.map((item, index) => (
                <div
                  key={item.id ?? index}
                  className={`flex items-center gap-3 p-3 rounded-lg ${
                    item.completed ? "bg-green-50 dark:bg-green-950" : "bg-muted"
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-xs ${
                      item.completed
                        ? "bg-green-500 text-white"
                        : "bg-muted-foreground/20"
                    }`}
                  >
                    {item.completed ? "✓" : item.number}
                  </span>
                  <span className={item.completed ? "line-through text-muted-foreground" : ""}>
                    {item.action}
                  </span>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-kaart-orange hover:underline text-sm"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
              {(!selectedChecklist?.list_items || selectedChecklist.list_items.length === 0) && (
                <p className="text-muted-foreground text-center py-4">No items</p>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedChecklist(null);
        }}
        onConfirm={handleDeleteChecklist}
        title="Delete Checklist"
        message={`Are you sure you want to delete "${selectedChecklist?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        isLoading={deleting}
      />

      {/* Assign Users Modal */}
      <Modal
        isOpen={showAssignModal}
        onClose={() => {
          setShowAssignModal(false);
          setSelectedChecklist(null);
          setChecklistUsers([]);
        }}
        title="Assign Users"
        description={`Manage user assignments for "${selectedChecklist?.name}"`}
        size="lg"
        footer={
          <Button onClick={() => setShowAssignModal(false)}>Done</Button>
        }
      >
        <div className="space-y-4">
          {loadingUsers ? (
            <div className="py-8 text-center text-muted-foreground">
              Loading users...
            </div>
          ) : (
            <>
              {/* Assigned Users */}
              <div>
                <h3 className="font-medium mb-2 text-green-600">
                  Assigned ({checklistUsers.filter((u) => u.assigned === "Yes").length})
                </h3>
                <div className="space-y-2">
                  {checklistUsers
                    .filter((u) => u.assigned === "Yes")
                    .map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-green-50 dark:bg-green-950"
                      >
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-sm text-muted-foreground">{displayRole(user.role)}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleUnassignUser(user.id)}
                          isLoading={unassigning}
                        >
                          Unassign
                        </Button>
                      </div>
                    ))}
                  {checklistUsers.filter((u) => u.assigned === "Yes").length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">No users assigned yet</p>
                  )}
                </div>
              </div>

              {/* Unassigned Users */}
              <div>
                <h3 className="font-medium mb-2">
                  Available Users ({checklistUsers.filter((u) => u.assigned === "No").length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {checklistUsers
                    .filter((u) => u.assigned === "No")
                    .map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted"
                      >
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-sm text-muted-foreground">{displayRole(user.role)}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAssignUser(user.id)}
                          isLoading={assigning}
                        >
                          Assign
                        </Button>
                      </div>
                    ))}
                  {checklistUsers.filter((u) => u.assigned === "No").length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">All users have been assigned</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Purge Confirmation */}
      <ConfirmDialog
        isOpen={showPurgeModal}
        onClose={() => setShowPurgeModal(false)}
        onConfirm={handlePurgeChecklists}
        title="Purge All Checklists"
        message="This will DELETE all checklists, user checklists, and reset all user checklist stats. This action cannot be undone!"
        confirmText="Purge All"
        variant="destructive"
        isLoading={purging}
      />

      {/* Dev Tools Section — Org Admin / Super Admin only. */}
      {canCreateOrDelete && (
        <Card className="mt-8 border-dashed border-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600">Dev Tools (Remove before production)</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setShowPurgeModal(true)}
              isLoading={purging}
            >
              Purge All Checklists
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
