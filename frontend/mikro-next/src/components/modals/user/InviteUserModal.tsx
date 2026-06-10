"use client";

import { useEffect, useState } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { ManagedTeam } from "@/hooks";

interface RoleOption {
  value: string;
  label: string;
}

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  managedTeams: ManagedTeam[];
  isTeamAdmin: boolean;
  inviteRoleOptions: RoleOption[];
  /** Called after an invite is successfully sent, e.g. to refresh the list. */
  onInvited?: () => void;
}

export function InviteUserModal({
  isOpen,
  onClose,
  managedTeams,
  isTeamAdmin,
  inviteRoleOptions,
  onInvited,
}: InviteUserModalProps) {
  const toast = useToastActions();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteTeamIds, setInviteTeamIds] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Reset the form whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) {
      setInviteEmail("");
      setInviteRole("user");
      setInviteTeamIds([]);
    }
  }, [isOpen]);

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error("Please enter an email address");
      return;
    }
    // Team admins must drop the invitee into at least one team they lead.
    if (isTeamAdmin && inviteTeamIds.length === 0) {
      toast.error("Select at least one team");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/invite_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          targetTeamIds: inviteTeamIds,
        }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        toast.success(data.message || "Invitation sent successfully");
        onClose();
        onInvited?.();
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Invite User">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Email Address
          </label>
          <input
            type="email"
            className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Role</label>
          <select
            className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {inviteRoleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {managedTeams.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {isTeamAdmin ? "Add to team(s)" : "Add to team(s) (optional)"}
            </label>
            <div className="max-h-40 overflow-y-auto border border-input rounded-lg p-2 space-y-1">
              {managedTeams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inviteTeamIds.includes(t.id)}
                    onChange={(e) =>
                      setInviteTeamIds((prev) =>
                        e.target.checked
                          ? [...prev, t.id]
                          : prev.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          The user will receive an email to set their password and complete
          registration.
        </p>
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          If this user already has a Kaart login, they can use those same
          credentials to log into Mikro directly — no password change needed.
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={isSaving || !inviteEmail}>
            {isSaving ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
