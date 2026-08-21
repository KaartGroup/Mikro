"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Spinner,
} from "@/components/ui";
import {
  useAvailabilityOverlap,
  useCurrentUserRole,
  useFetchTeams,
  useFetchUserTeams,
  useTeamAvailability,
} from "@/hooks";
import {
  MINUTES_IN_DAY,
  addDaysToKey,
  browserTimeZone,
  dateKeyRange,
  formatDateKey,
  memberName,
  minuteLabel,
  minuteLabel12h,
  renderZone,
  todayKey,
  windowToDaySegments,
} from "@/lib/availability";
import { timeZoneLabel } from "@/lib/timeTracking";
import { isAnyAdmin } from "@/types";
import type {
  AvailabilityWindow,
  TeamAvailabilityResponse,
  UserAvailability,
} from "@/types";

/** One week at a time. The backend allows 90 days, but a 7-column grid is
 *  what actually fits on screen. */
const DAYS = 7;

/** Axis bounds, in minutes. Trimmed to working-ish hours by default because
 *  the interesting question is where the day overlaps, not who sleeps when. */
const AXIS_START = 5 * 60;
const AXIS_END = 23 * 60;

interface Segment {
  dateKey: string;
  startMinute: number;
  endMinute: number;
  count: number;
}

/** Percent offsets for positioning a bar on the axis. */
function barStyle(startMinute: number, endMinute: number, full: boolean) {
  const axisStart = full ? 0 : AXIS_START;
  const axisEnd = full ? MINUTES_IN_DAY : AXIS_END;
  const span = axisEnd - axisStart;
  const from = Math.max(startMinute, axisStart);
  const to = Math.min(endMinute, axisEnd);
  if (to <= from) return null;
  return {
    left: `${((from - axisStart) / span) * 100}%`,
    width: `${((to - from) / span) * 100}%`,
  };
}

export function TeamAvailabilityGrid() {
  const { role } = useCurrentUserRole();
  const admin = isAnyAdmin(role);

  // Admins pick from every team in the org; everyone else from their own.
  // Each call is gated so only the one the viewer is entitled to actually
  // fires — /team/fetch_teams is admin-only and would 403 for everyone else.
  const { data: allTeams, loading: loadingAllTeams } = useFetchTeams(admin);
  const { data: myTeams, loading: loadingMyTeams } = useFetchUserTeams(!admin);

  const { mutate: loadTeam, loading: loadingMembers } = useTeamAvailability();
  const { mutate: loadOverlap, loading: loadingOverlap } =
    useAvailabilityOverlap();

  const [teamId, setTeamId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [viewerZone, setViewerZone] = useState("UTC");
  const [team, setTeam] = useState<TeamAvailabilityResponse | null>(null);
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [missingZones, setMissingZones] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fullDay, setFullDay] = useState(false);

  useEffect(() => {
    // Client-only: the server renders in its own zone, so reading this during
    // render (or via a useState initializer) would desync hydration. A
    // mount-time read of a browser API is what this effect exists for.
    const zone = browserTimeZone();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewerZone(zone);
    setWeekStart((current) => current || todayKey(zone));
  }, []);

  const teamOptions = useMemo(() => {
    const source = admin ? (allTeams?.teams ?? []) : (myTeams?.teams ?? []);
    return source.map((t) => ({ value: String(t.id), label: t.name }));
  }, [admin, allTeams, myTeams]);

  // Derived rather than set from an effect: until the user picks, the first
  // team the list returned is the selection.
  const selectedTeamId = teamId || teamOptions[0]?.value || "";

  const dateKeys = useMemo(
    () =>
      weekStart
        ? dateKeyRange(weekStart, addDaysToKey(weekStart, DAYS - 1))
        : [],
    [weekStart],
  );

  const load = useCallback(async () => {
    if (!selectedTeamId || !weekStart) return;
    const range = {
      start_date: weekStart,
      end_date: addDaysToKey(weekStart, DAYS - 1),
    };
    try {
      setError(null);
      const teamRes = await loadTeam({
        team_id: Number(selectedTeamId),
        ...range,
      });
      setTeam(teamRes ?? null);

      const ids = (teamRes?.members ?? []).map((m) => m.user_id);
      if (!ids.length) {
        setWindows([]);
        setMissingZones([]);
        return;
      }

      // threshold 1 => every maximal window where at least one member is
      // free, each tagged with exactly who. That gives both the per-member
      // rows and the overlap shading from one server-computed result, so
      // the local-wall-clock -> UTC math stays in the backend service.
      const overlapRes = await loadOverlap({
        user_ids: ids,
        threshold: 1,
        ...range,
      });
      setWindows(overlapRes?.windows ?? []);
      setMissingZones(overlapRes?.users_without_timezone ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setTeam(null);
      setWindows([]);
    }
  }, [selectedTeamId, weekStart, loadTeam, loadOverlap]);

  useEffect(() => {
    // `load` is async: every setState in it runs after an await, in the
    // response callback rather than synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const zone = renderZone(viewerZone);

  /** user_id -> that member's segments, laid out on the viewer's days. */
  const segmentsByUser = useMemo(() => {
    const out = new Map<string, Segment[]>();
    for (const window of windows) {
      const pieces = windowToDaySegments(window.start, window.end, zone);
      for (const userId of window.user_ids) {
        const list = out.get(userId) ?? [];
        for (const piece of pieces)
          list.push({ ...piece, count: window.count });
        out.set(userId, list);
      }
    }
    return out;
  }, [windows, zone]);

  const members: UserAvailability[] = team?.members ?? [];

  /** Windows where every member of the team is free at once. */
  const fullOverlap = useMemo(
    () =>
      members.length ? windows.filter((w) => w.count === members.length) : [],
    [windows, members.length],
  );

  const busy = loadingMembers || loadingOverlap;
  const loadingTeams = admin ? loadingAllTeams : loadingMyTeams;

  const hourTicks = useMemo(() => {
    const start = fullDay ? 0 : AXIS_START;
    const end = fullDay ? MINUTES_IN_DAY : AXIS_END;
    const ticks: number[] = [];
    for (let m = start; m <= end; m += fullDay ? 240 : 120) ticks.push(m);
    return ticks;
  }, [fullDay]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0">
          <CardTitle className="text-xl">Team availability</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone&apos;s declared hours converted to{" "}
            <span className="font-medium text-foreground">
              {timeZoneLabel(zone)}
            </span>
            , your own timezone. Time off and one-off exceptions are already
            applied.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Select
                label="Team"
                options={teamOptions}
                value={selectedTeamId}
                onChange={setTeamId}
                placeholder={loadingTeams ? "Loading teams…" : "Select a team"}
                searchable={teamOptions.length > 8}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWeekStart((w) => addDaysToKey(w, -DAYS))}
                disabled={!weekStart}
              >
                ←
              </Button>
              <span className="px-2 text-sm text-muted-foreground whitespace-nowrap">
                {dateKeys.length
                  ? `${formatDateKey(dateKeys[0])} – ${formatDateKey(
                      dateKeys[dateKeys.length - 1],
                    )}`
                  : "—"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWeekStart((w) => addDaysToKey(w, DAYS))}
                disabled={!weekStart}
              >
                →
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setWeekStart(todayKey(zone))}
              >
                Today
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFullDay((v) => !v)}
            >
              {fullDay ? "Working hours" : "Show all 24h"}
            </Button>
            {busy && <Spinner />}
          </div>

          {missingZones.length > 0 && (
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-sm">
              {missingZones.length} team member
              {missingZones.length === 1 ? "" : "s"} ha
              {missingZones.length === 1 ? "s" : "ve"} no timezone set — their
              hours are being read as UTC.
            </div>
          )}

          {error ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={load}>
                Try again
              </Button>
            </div>
          ) : !teamOptions.length && !loadingTeams ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You&apos;re not on a team yet, so there&apos;s nothing to compare.
            </p>
          ) : !members.length && !busy ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This team has no members.
            </p>
          ) : (
            <div className="space-y-5">
              {dateKeys.map((dateKey) => {
                const anySegment = members.some((m) =>
                  (segmentsByUser.get(m.user_id) ?? []).some(
                    (s) => s.dateKey === dateKey,
                  ),
                );
                return (
                  <div key={dateKey}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {formatDateKey(dateKey)}
                      </span>
                      {!anySegment && (
                        <span className="text-xs text-muted-foreground">
                          nobody available
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      {/* Hour ticks */}
                      <div className="flex pl-40">
                        <div className="relative h-4 flex-1">
                          {hourTicks.map((minute) => {
                            const style = barStyle(minute, minute + 1, fullDay);
                            return style ? (
                              <span
                                key={minute}
                                className="absolute -translate-x-1/2 text-[10px] text-muted-foreground"
                                style={{ left: style.left }}
                              >
                                {minuteLabel(minute)}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </div>

                      {members.map((member) => {
                        const segments = (
                          segmentsByUser.get(member.user_id) ?? []
                        ).filter((s) => s.dateKey === dateKey);
                        return (
                          <div
                            key={member.user_id}
                            className="flex items-center py-0.5"
                          >
                            <div className="w-40 shrink-0 pr-2">
                              <div className="truncate text-xs font-medium">
                                {memberName(member)}
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {member.timezone ?? "no timezone"}
                              </div>
                            </div>
                            <div className="relative h-5 flex-1 rounded bg-muted/40">
                              {segments.map((segment, index) => {
                                const style = barStyle(
                                  segment.startMinute,
                                  segment.endMinute,
                                  fullDay,
                                );
                                if (!style) return null;
                                const everyone =
                                  members.length > 1 &&
                                  segment.count === members.length;
                                return (
                                  <div
                                    key={`${segment.startMinute}-${index}`}
                                    className={[
                                      "absolute top-0 h-full rounded",
                                      everyone
                                        ? "bg-kaart-orange"
                                        : "bg-kaart-orange/35",
                                    ].join(" ")}
                                    style={style}
                                    title={`${memberName(member)} — ${minuteLabel12h(
                                      segment.startMinute,
                                    )} to ${minuteLabel12h(segment.endMinute)} (${
                                      segment.count
                                    } of ${members.length} free)`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            When everyone is free
            {members.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                all {members.length} member{members.length === 1 ? "" : "s"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {busy ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : fullOverlap.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No window this week works for the whole team. Try the next week,
              or check who hasn&apos;t declared their hours yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {fullOverlap.slice(0, 25).map((window) => {
                const pieces = windowToDaySegments(
                  window.start,
                  window.end,
                  zone,
                );
                return pieces.map((piece, index) => (
                  <li
                    key={`${window.start}-${index}`}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <Badge variant="success">
                      {window.count}/{members.length}
                    </Badge>
                    <span className="font-medium">
                      {formatDateKey(piece.dateKey)}
                    </span>
                    <span className="text-muted-foreground">
                      {minuteLabel12h(piece.startMinute)} –{" "}
                      {minuteLabel12h(piece.endMinute)}
                    </span>
                  </li>
                ));
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
