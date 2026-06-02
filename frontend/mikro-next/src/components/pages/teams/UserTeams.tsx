"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Button,
  Skeleton,
  Val,
} from "@/components/ui";
import { useFetchUserTeams } from "@/hooks/useApi";
import { formatNumber } from "@/lib/utils";

export function UserTeams() {
  const { data, loading } = useFetchUserTeams();
  const [search, setSearch] = useState("");

  const ROWS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const teams = data?.teams ?? [];
  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const totalPages = Math.ceil(filteredTeams.length / ROWS_PER_PAGE);
  const paginatedTeams = filteredTeams.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const showingStart =
    filteredTeams.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    filteredTeams.length,
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Teams</h1>
        <p className="text-muted-foreground">Teams you are a member of</p>
      </div>

      <Card>
        <CardHeader>
          <Input
            placeholder="Search teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                    Lead
                  </th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-foreground">
                    Members
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {paginatedTeams.map((team) => (
                  <tr key={team.id}>
                    <td className="px-6 py-4">
                      <Link
                        href={`/teams/${team.id}`}
                        className="font-medium text-kaart-orange hover:underline"
                        title="View team details"
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">
                      <Val>{team.description}</Val>
                    </td>
                    <td className="px-6 py-4 text-foreground">
                      {team.lead_names && team.lead_names.length > 0
                        ? team.lead_names.join(", ")
                        : team.lead_name || (
                            <span className="text-muted-foreground">None</span>
                          )}
                    </td>
                    <td className="px-6 py-4 text-center text-foreground">
                      <Val>{formatNumber(team.member_count)}</Val>
                    </td>
                  </tr>
                ))}
                {filteredTeams.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-8 text-center text-muted-foreground"
                    >
                      {search
                        ? "No teams match your search"
                        : "You haven't been assigned to any teams yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredTeams.length > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 px-6 pb-4 text-sm text-muted-foreground">
              <span>
                Showing {showingStart}-{showingEnd} of {filteredTeams.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="flex items-center px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
