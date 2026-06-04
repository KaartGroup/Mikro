"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  Button,
  Modal,
  ConfirmDialog,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import { RoleGate } from "@/components/RoleGate";

interface Organization {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string | null;
  disabled_at: string | null;
}

function OrganizationsManager() {
  const toast = useToastActions();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [limit, setLimit] = useState(10);
  const [remaining, setRemaining] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createAdminEmail, setCreateAdminEmail] = useState("");
  const [createContactName, setCreateContactName] = useState("");
  const [createContactEmail, setCreateContactEmail] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editing, setEditing] = useState<Organization | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Disable confirmation
  const [disableTarget, setDisableTarget] = useState<Organization | null>(null);
  const [disabling, setDisabling] = useState(false);

  const fetchOrgs = useCallback(async () => {
    try {
      const response = await fetch("/backend/organization/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        setOrgs(data.organizations || []);
        setLimit(data.limit ?? 10);
        setRemaining(data.remaining ?? 0);
      } else {
        toast.error(data.message || "Failed to load organizations");
      }
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
      toast.error("Failed to load organizations");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const openCreate = () => {
    setCreateName("");
    setCreateDisplayName("");
    setCreateAdminEmail("");
    setCreateContactName("");
    setCreateContactEmail("");
    setCreateNotes("");
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      toast.error("Organization name is required");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/backend/organization/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          displayName: createDisplayName.trim() || createName.trim(),
          adminEmail: createAdminEmail.trim() || undefined,
          contactName: createContactName.trim() || undefined,
          contactEmail: createContactEmail.trim() || undefined,
          notes: createNotes.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(data.message || "Organization created");
        setShowCreate(false);
        fetchOrgs();
      } else {
        toast.error(data.message || "Failed to create organization");
      }
    } catch (error) {
      console.error("Failed to create organization:", error);
      toast.error("Failed to create organization");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (org: Organization) => {
    setEditing(org);
    setEditDisplayName(org.display_name ?? "");
    setEditContactName(org.contact_name ?? "");
    setEditContactEmail(org.contact_email ?? "");
    setEditNotes(org.notes ?? "");
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const response = await fetch("/backend/organization/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: editing.id,
          displayName: editDisplayName.trim(),
          contactName: editContactName.trim(),
          contactEmail: editContactEmail.trim(),
          notes: editNotes.trim(),
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Organization updated");
        setEditing(null);
        fetchOrgs();
      } else {
        toast.error(data.message || "Failed to update organization");
      }
    } catch (error) {
      console.error("Failed to update organization:", error);
      toast.error("Failed to update organization");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDisable = async () => {
    if (!disableTarget) return;
    setDisabling(true);
    try {
      const response = await fetch("/backend/organization/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: disableTarget.id }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Organization disabled");
        setDisableTarget(null);
        fetchOrgs();
      } else {
        toast.error(data.message || "Failed to disable organization");
      }
    } catch (error) {
      console.error("Failed to disable organization:", error);
      toast.error("Failed to disable organization");
    } finally {
      setDisabling(false);
    }
  };

  const handleRestore = async (org: Organization) => {
    try {
      const response = await fetch("/backend/organization/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success("Organization restored");
        fetchOrgs();
      } else {
        toast.error(data.message || "Failed to restore organization");
      }
    } catch (error) {
      console.error("Failed to restore organization:", error);
      toast.error("Failed to restore organization");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">
            Provision and manage external organizations.{" "}
            <span className="font-medium">
              {remaining} of {limit} slots remaining
            </span>
            .
          </p>
        </div>
        <Button onClick={openCreate} disabled={remaining <= 0}>
          Create Organization
        </Button>
      </div>

      {remaining <= 0 && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            Organization limit reached ({limit}/{limit}). Disable an unused org
            or upgrade the Auth0 plan to B2B for unlimited organizations.
          </CardContent>
        </Card>
      )}

      {orgs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No organizations yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      {org.display_name || org.name}
                      <span className="block text-xs text-muted-foreground">
                        {org.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          org.status === "active"
                            ? "text-green-600 font-medium"
                            : "text-muted-foreground font-medium"
                        }
                      >
                        {org.status === "active" ? "Active" : "Disabled"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {org.contact_email || org.contact_name || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {org.created_at
                        ? new Date(org.created_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(org)}
                        >
                          Edit
                        </Button>
                        {org.status === "active" ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDisableTarget(org)}
                          >
                            Disable
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRestore(org)}
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Organization"
        description="Provisions an Auth0 organization and invites its first admin."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} isLoading={creating}>
              Create Organization
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name (slug)"
            placeholder="e.g. acme-mapping"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
          />
          <Input
            label="Display Name"
            placeholder="e.g. Acme Mapping"
            value={createDisplayName}
            onChange={(e) => setCreateDisplayName(e.target.value)}
          />
          <Input
            label="First Admin Email"
            placeholder="admin@acme.com"
            value={createAdminEmail}
            onChange={(e) => setCreateAdminEmail(e.target.value)}
          />
          <Input
            label="Contact Name"
            value={createContactName}
            onChange={(e) => setCreateContactName(e.target.value)}
          />
          <Input
            label="Contact Email"
            value={createContactEmail}
            onChange={(e) => setCreateContactEmail(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title="Edit Organization"
        description={`Editing "${editing?.display_name || editing?.name}"`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} isLoading={savingEdit}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Display Name"
            value={editDisplayName}
            onChange={(e) => setEditDisplayName(e.target.value)}
          />
          <Input
            label="Contact Name"
            value={editContactName}
            onChange={(e) => setEditContactName(e.target.value)}
          />
          <Input
            label="Contact Email"
            value={editContactEmail}
            onChange={(e) => setEditContactEmail(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* Disable Confirmation */}
      <ConfirmDialog
        isOpen={!!disableTarget}
        onClose={() => setDisableTarget(null)}
        onConfirm={handleDisable}
        title="Disable Organization"
        message={`Disable "${disableTarget?.display_name || disableTarget?.name}"? Its users will no longer be able to log in. All data is retained and you can restore it later.`}
        confirmText="Disable"
        variant="destructive"
        isLoading={disabling}
      />
    </div>
  );
}

export default function AdminOrganizationsPage() {
  return (
    <RoleGate tier="super-admin">
      <OrganizationsManager />
    </RoleGate>
  );
}
