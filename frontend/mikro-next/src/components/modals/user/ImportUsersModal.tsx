"use client";

import { useState } from "react";
import { Modal, Button, useToastActions } from "@/components/ui";
import { roleLabel } from "@/types";

export interface CsvUser {
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  osm_username: string;
  role: string;
}

interface ImportUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  csvUsers: CsvUser[];
  /** Error surfaced while parsing the CSV in the parent, shown above the table. */
  parseError?: string | null;
  /** Called after at least one user is imported, e.g. to refresh the list. */
  onImported?: () => void;
}

export function ImportUsersModal({
  isOpen,
  onClose,
  csvUsers,
  parseError,
  onImported,
}: ImportUsersModalProps) {
  const toast = useToastActions();
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleImport = async () => {
    if (csvUsers.length === 0) return;
    setIsSaving(true);
    setSubmitError(null);
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
          onImported?.();
          onClose();
        }
        if (failedItems.length > 0) {
          const errorDetails = failedItems
            .map(
              (f: { email: string; error: string }) => `${f.email}: ${f.error}`,
            )
            .join("\n");
          // Surfaced inline when no users imported (modal stays open).
          setSubmitError(
            `${failedItems.length} user(s) failed to import:\n${errorDetails}`,
          );
        }
      } else {
        setSubmitError(data.message || "Import failed");
      }
    } catch (error) {
      console.error("Failed to import users:", error);
      setSubmitError("Failed to import users");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setSubmitError(null);
    onClose();
  };

  const error = parseError || submitError;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Users from CSV"
      size="2xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">
            {error}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          The following {csvUsers.length} user(s) will be invited. Each will
          receive an email to set their password.
        </p>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">First Name</th>
                <th className="px-4 py-2 text-left font-medium">Last Name</th>
                <th className="px-4 py-2 text-left font-medium">
                  OSM Username
                </th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {csvUsers.map((user, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2">{user.email}</td>
                  <td className="px-4 py-2">
                    {user.first_name || user.name?.split(" ")[0] || "-"}
                  </td>
                  <td className="px-4 py-2">
                    {user.last_name ||
                      user.name?.split(" ").slice(1).join(" ") ||
                      "-"}
                  </td>
                  <td className="px-4 py-2">{user.osm_username || "-"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isSaving}>
            {isSaving ? "Importing..." : `Import ${csvUsers.length} User(s)`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
