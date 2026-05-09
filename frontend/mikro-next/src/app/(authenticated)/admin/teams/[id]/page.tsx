"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Val, StatCard, Button } from "@/components/ui";
import { useFetchTeamProfile } from "@/hooks/useApi";
import type { TeamProfileData } from "@/types";
import { formatNumber, formatCurrency, displayRole } from "@/lib/utils";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminTeamProfilePage() {
  const params = useParams();
  const router = useRouter();
  const teamId = Number(params.id);

  const { mutate: fetchProfile, loading: profileLoading, error: profileError } =
    useFetchTeamProfile();

  const [profile, setProfile] = useState<TeamProfileData | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  // Pagination
  const ROWS_PER_PAGE = 20;
  const [membersPage, setMembersPage] = useState(1);
  const [projectsPage, setProjectsPage] = useState(1);
  const [trainingsPage, setTrainingsPage] = useState(1);
  const [checklistsPage, setChecklistsPage] = useState(1);

  useEffect(() => {
    if (teamId) {
      fetchProfile({ teamId })
        .then((res) => {
          if (res?.team) setProfile(res);
        })
        .catch(() => {})
        .finally(() => setPageLoading(false));
    }
  }, [teamId, fetchProfile]);

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  if (profileError && !profile) {
    // Backend returns 403 when a team_admin tries to view a team they
    // don't lead. Surface a friendlier read-only message in that case.
    const isForbidden =
      profileError.includes("403") ||
      profileError.toLowerCase().includes("forbidden") ||
      profileError.toLowerCase().includes("not authorized");
    return (
      <div className="space-y-4">
        <Link
          href="/admin/teams"
          className="text-kaart-orange hover:underline text-sm"
        >
          {"\u2190"} Back to Teams
        </Link>
        <Card>
          <CardContent className="p-8 text-center">
            {isForbidden ? (
              <p className="text-muted-foreground">
                You don&apos;t manage this team. Contact your Org Admin if you
                think you should.
              </p>
            ) : (
              <p className="text-red-500">
                Failed to load team profile: {profileError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile) return null;

  const { team, members, aggregated_stats, projects, assigned_trainings, assigned_checklists } = profile;

  return (
    <div className="space-y-6">
      {/* Section 1: Header */}
      <Card>
        <CardContent className="p-6">
          <Link
            href="/admin/teams"
            className="text-kaart-orange hover:underline text-sm mb-4 inline-block"
          >
            {"\u2190"} Back to Teams
          </Link>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-kaart-orange/20 flex items-center justify-center text-kaart-orange text-xl font-bold shrink-0">
              {team.name?.[0]?.toUpperCase() || "T"}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
              {team.description && (
                <p className="text-muted-foreground mt-1">{team.description}</p>
              )}
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2 flex-wrap">
                {team.lead_name && (
                  <span>
                    Lead: <span className="font-medium text-foreground">{team.lead_name}</span>
                  </span>
                )}
                <span>
                  Members: <span className="font-medium text-foreground">{team.member_count}</span>
                </span>
                {team.created_at && (
                  <span>Created: {formatDate(team.created_at)}</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Aggregated All-Time Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Tasks Mapped" value={formatNumber(aggregated_stats.total_tasks_mapped)} />
        <StatCard label="Tasks Validated" value={formatNumber(aggregated_stats.total_tasks_validated)} />
        <StatCard label="Tasks Invalidated" value={formatNumber(aggregated_stats.total_tasks_invalidated)} />
        <StatCard label="Checklists Completed" value={formatNumber(aggregated_stats.total_checklists_completed)} />
      </div>

      {/* Section 3: Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Mapping</p>
              <p className="text-lg font-semibold">
                <Val>{formatCurrency(aggregated_stats.mapping_payable_total)}</Val>
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Validation</p>
              <p className="text-lg font-semibold">
                <Val>{formatCurrency(aggregated_stats.validation_payable_total)}</Val>
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Checklists</p>
              <p className="text-lg font-semibold">
                <Val>{formatCurrency(aggregated_stats.checklist_payable_total)}</Val>
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Payable</p>
              <p className="text-lg font-semibold text-green-600">
                <Val>{formatCurrency(aggregated_stats.payable_total)}</Val>
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Requested</p>
              <p className="text-lg font-semibold text-yellow-600">
                <Val>{formatCurrency(aggregated_stats.requested_total)}</Val>
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="text-lg font-semibold text-blue-600">
                <Val>{formatCurrency(aggregated_stats.paid_total)}</Val>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Members Table */}
      {members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Members (<Val>{formatNumber(members.length)}</Val>)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Role</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">OSM Username</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Mapped</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Validated</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Invalidated</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {members.slice((membersPage - 1) * ROWS_PER_PAGE, membersPage * ROWS_PER_PAGE).map((member) => (
                    <tr
                      key={member.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => router.push(`/admin/users/${encodeURIComponent(member.id)}`)}
                    >
                      <td className="px-6 py-4">
                        <span className="font-medium text-kaart-orange">
                          {member.name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            member.role === "admin"
                              ? "bg-purple-100 text-purple-800"
                              : member.role === "validator"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {displayRole(member.role)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-foreground">
                        {member.osm_username || "-"}
                      </td>
                      <td className="px-6 py-4 text-foreground"><Val>{formatNumber(member.total_tasks_mapped)}</Val></td>
                      <td className="px-6 py-4 text-foreground"><Val>{formatNumber(member.total_tasks_validated)}</Val></td>
                      <td className="px-6 py-4 text-foreground"><Val>{formatNumber(member.total_tasks_invalidated)}</Val></td>
                      <td className="px-6 py-4 text-foreground">
                        <Val>{formatCurrency(member.payable_total)}</Val>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {members.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                <span>Showing {(membersPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(membersPage * ROWS_PER_PAGE, members.length)} of {members.length}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={membersPage === 1}
                    onClick={() => setMembersPage(p => p - 1)}>Previous</Button>
                  <span className="flex items-center px-2">Page {membersPage} of {Math.ceil(members.length / ROWS_PER_PAGE)}</span>
                  <Button variant="outline" size="sm" disabled={membersPage === Math.ceil(members.length / ROWS_PER_PAGE)}
                    onClick={() => setMembersPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 5: Team Projects Table */}
      {projects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Projects (<Val>{formatNumber(projects.length)}</Val>)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Project</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Team Mapped</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Team Validated</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Team Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {projects.slice((projectsPage - 1) * ROWS_PER_PAGE, projectsPage * ROWS_PER_PAGE).map((proj) => (
                    <tr
                      key={proj.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => router.push("/admin/projects")}
                    >
                      <td className="px-6 py-4">
                        <span className="font-medium text-kaart-orange">{proj.name}</span>
                      </td>
                      <td className="px-6 py-4 text-foreground"><Val>{formatNumber(proj.team_tasks_mapped)}</Val></td>
                      <td className="px-6 py-4 text-foreground"><Val>{formatNumber(proj.team_tasks_validated)}</Val></td>
                      <td className="px-6 py-4 text-foreground">
                        <Val>{formatCurrency(proj.team_earnings)}</Val>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {projects.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                <span>Showing {(projectsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(projectsPage * ROWS_PER_PAGE, projects.length)} of {projects.length}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={projectsPage === 1}
                    onClick={() => setProjectsPage(p => p - 1)}>Previous</Button>
                  <span className="flex items-center px-2">Page {projectsPage} of {Math.ceil(projects.length / ROWS_PER_PAGE)}</span>
                  <Button variant="outline" size="sm" disabled={projectsPage === Math.ceil(projects.length / ROWS_PER_PAGE)}
                    onClick={() => setProjectsPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 6: Assigned Trainings */}
      {assigned_trainings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assigned Trainings (<Val>{formatNumber(assigned_trainings.length)}</Val>)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Title</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Type</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Difficulty</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {assigned_trainings.slice((trainingsPage - 1) * ROWS_PER_PAGE, trainingsPage * ROWS_PER_PAGE).map((training) => (
                    <tr
                      key={training.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => router.push("/admin/training")}
                    >
                      <td className="px-6 py-4 font-medium text-kaart-orange">{training.title}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {training.training_type || "-"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            training.difficulty === "Hard"
                              ? "bg-red-100 text-red-800"
                              : training.difficulty === "Medium"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {training.difficulty}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-foreground">{training.point_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {assigned_trainings.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                <span>Showing {(trainingsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(trainingsPage * ROWS_PER_PAGE, assigned_trainings.length)} of {assigned_trainings.length}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={trainingsPage === 1}
                    onClick={() => setTrainingsPage(p => p - 1)}>Previous</Button>
                  <span className="flex items-center px-2">Page {trainingsPage} of {Math.ceil(assigned_trainings.length / ROWS_PER_PAGE)}</span>
                  <Button variant="outline" size="sm" disabled={trainingsPage === Math.ceil(assigned_trainings.length / ROWS_PER_PAGE)}
                    onClick={() => setTrainingsPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 7: Assigned Checklists */}
      {assigned_checklists.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Assigned Checklists (<Val>{formatNumber(assigned_checklists.length)}</Val>)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Difficulty</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {assigned_checklists.slice((checklistsPage - 1) * ROWS_PER_PAGE, checklistsPage * ROWS_PER_PAGE).map((checklist) => (
                    <tr
                      key={checklist.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => router.push("/admin/checklists")}
                    >
                      <td className="px-6 py-4 font-medium text-kaart-orange">{checklist.name}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            checklist.difficulty === "Hard"
                              ? "bg-red-100 text-red-800"
                              : checklist.difficulty === "Medium"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {checklist.difficulty}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            checklist.active_status
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {checklist.active_status ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {assigned_checklists.length > ROWS_PER_PAGE && (
              <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
                <span>Showing {(checklistsPage - 1) * ROWS_PER_PAGE + 1}-{Math.min(checklistsPage * ROWS_PER_PAGE, assigned_checklists.length)} of {assigned_checklists.length}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={checklistsPage === 1}
                    onClick={() => setChecklistsPage(p => p - 1)}>Previous</Button>
                  <span className="flex items-center px-2">Page {checklistsPage} of {Math.ceil(assigned_checklists.length / ROWS_PER_PAGE)}</span>
                  <Button variant="outline" size="sm" disabled={checklistsPage === Math.ceil(assigned_checklists.length / ROWS_PER_PAGE)}
                    onClick={() => setChecklistsPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
