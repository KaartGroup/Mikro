"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { WatchlistList } from "@/components/pages/watchlist/WatchlistList";
import {
  useFriendsList,
  useDeleteFriend,
  useRefreshFriendActivity,
  usePunksList,
  useDeletePunk,
  useRefreshPunkActivity,
} from "@/hooks";
import type { Friend, Punk } from "@/types";
import { AddFriendModal } from "@/components/modals/friend/AddFriendModal";
import { EditFriendModal } from "@/components/modals/friend/EditFriendModal";
import { AddPunkModal } from "@/components/modals/punk/AddPunkModal";
import { EditPunkModal } from "@/components/modals/punk/EditPunkModal";

function FriendsTab() {
  const { data, loading, refetch } = useFriendsList();
  const { mutate: del, loading: deleting } = useDeleteFriend();
  const { mutate: refresh } = useRefreshFriendActivity();
  return (
    <WatchlistList
      entityLabel="Friend"
      subtitle="Track and manage friendly OSM users"
      detailBase="/admin/friends"
      entries={data?.friends ?? []}
      loading={loading}
      refetch={refetch}
      onDelete={(id) => del({ friend_id: id })}
      deleting={deleting}
      onRefresh={(id) => refresh({ friend_id: id })}
      renderAddModal={({ isOpen, onClose, onCreated }) => (
        <AddFriendModal
          isOpen={isOpen}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
      renderEditModal={({ isOpen, onClose, onSaved, entry }) => (
        <EditFriendModal
          isOpen={isOpen}
          onClose={onClose}
          onSaved={onSaved}
          friend={entry as Friend}
        />
      )}
    />
  );
}

function PunksTab() {
  const { data, loading, refetch } = usePunksList();
  const { mutate: del, loading: deleting } = useDeletePunk();
  const { mutate: refresh } = useRefreshPunkActivity();
  return (
    <WatchlistList
      entityLabel="Punk"
      subtitle="Track and manage problematic OSM users"
      detailBase="/admin/punks"
      entries={data?.punks ?? []}
      loading={loading}
      refetch={refetch}
      onDelete={(id) => del({ punk_id: id })}
      deleting={deleting}
      onRefresh={(id) => refresh({ punk_id: id })}
      renderAddModal={({ isOpen, onClose, onCreated }) => (
        <AddPunkModal isOpen={isOpen} onClose={onClose} onCreated={onCreated} />
      )}
      renderEditModal={({ isOpen, onClose, onSaved, entry }) => (
        <EditPunkModal
          isOpen={isOpen}
          onClose={onClose}
          onSaved={onSaved}
          punk={entry as Punk}
        />
      )}
    />
  );
}

function WatchlistPageInner() {
  const router = useRouter();
  const tab = useSearchParams().get("tab") === "punks" ? "punks" : "friends";

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
      <Tabs
        value={tab}
        defaultValue="friends"
        onValueChange={(v) => router.replace("/admin/watchlist?tab=" + v)}
      >
        <TabsList>
          <TabsTrigger value="friends">Friends List</TabsTrigger>
          <TabsTrigger value="punks">Punks List</TabsTrigger>
        </TabsList>
        <TabsContent value="friends">
          <FriendsTab />
        </TabsContent>
        <TabsContent value="punks">
          <PunksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function WatchlistPage() {
  return (
    <Suspense fallback={null}>
      <WatchlistPageInner />
    </Suspense>
  );
}
