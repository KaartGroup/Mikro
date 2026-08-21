"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { MyAvailabilityEditor } from "@/components/pages/schedule/MyAvailabilityEditor";
import { AvailabilityExceptions } from "@/components/pages/schedule/AvailabilityExceptions";
import { TeamAvailabilityGrid } from "@/components/pages/schedule/TeamAvailabilityGrid";
import { ROUTES } from "@/lib/routes";

const TABS = ["hours", "exceptions", "team"] as const;
type Tab = (typeof TABS)[number];

function SchedulePageInner() {
  const router = useRouter();
  const requested = useSearchParams().get("tab");
  const tab: Tab = TABS.includes(requested as Tab)
    ? (requested as Tab)
    : "hours";

  // Saving the grid can change what the other tabs render, so a save bumps
  // this and the mounted tab re-reads.
  const [savedAt, setSavedAt] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Declare the hours you work so the rest of the team can find a time
          that works across timezones.
        </p>
      </div>

      <Tabs
        value={tab}
        defaultValue="hours"
        onValueChange={(v) => router.replace(`${ROUTES.schedule}?tab=${v}`)}
      >
        <TabsList>
          <TabsTrigger value="hours">My Availability</TabsTrigger>
          <TabsTrigger value="exceptions">Time Off</TabsTrigger>
          <TabsTrigger value="team">Team Availability</TabsTrigger>
        </TabsList>

        <TabsContent value="hours" className="mt-4">
          <MyAvailabilityEditor onSaved={() => setSavedAt(Date.now())} />
        </TabsContent>
        <TabsContent value="exceptions" className="mt-4">
          <AvailabilityExceptions refreshToken={savedAt} />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamAvailabilityGrid />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <SchedulePageInner />
    </Suspense>
  );
}
