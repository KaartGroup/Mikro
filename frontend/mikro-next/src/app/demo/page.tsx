"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, Button } from "@/components/ui";
import { formatNumber, formatCurrency } from "@/lib/utils";
import { Val } from "@/components/ui";
import { roleLabel } from "@/types";

const FAKE_USERS = [
  { id: "1", name: "Motoko Kusanagi", osm_username: "puppet_master", role: "admin", micropayments_visible: true, country_name: "Japan", region_name: "Asia", timezone: "Asia/Tokyo", assigned_projects: 12, total_tasks_mapped: 842, total_tasks_validated: 156, total_tasks_invalidated: 3, awaiting_payment: 0, total_payout: 4250.00, is_tracked_only: false },
  { id: "2", name: "Spike Spiegel", osm_username: "space_cowboy", role: "mapper", micropayments_visible: true, country_name: "United States", region_name: "North America", timezone: "America/Denver", assigned_projects: 4, total_tasks_mapped: 573, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 85.50, total_payout: 1820.00, is_tracked_only: false },
  { id: "3", name: "Lain Iwakura", osm_username: "wired_node7", role: "mapper", micropayments_visible: false, country_name: "Japan", region_name: "Asia", timezone: "Asia/Tokyo", assigned_projects: 2, total_tasks_mapped: 91, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 0, total_payout: 340.00, is_tracked_only: false },
  { id: "4", name: "Radical Edward", osm_username: "ed_hacker_42", role: "mapper", micropayments_visible: true, country_name: "Kenya", region_name: "Africa", timezone: "Africa/Nairobi", assigned_projects: 3, total_tasks_mapped: 267, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 42.00, total_payout: 890.00, is_tracked_only: false },
  { id: "5", name: "Vash Stampede", osm_username: "humanoid_typhoon", role: "validator", micropayments_visible: true, country_name: "United States", region_name: "North America", timezone: "America/Chicago", assigned_projects: 6, total_tasks_mapped: 45, total_tasks_validated: 389, total_tasks_invalidated: 12, awaiting_payment: 0, total_payout: 2100.00, is_tracked_only: false },
  { id: "6", name: "Jet Black", osm_username: "black_dog", role: "validator", micropayments_visible: true, country_name: "Philippines", region_name: "Asia", timezone: "Asia/Manila", assigned_projects: 5, total_tasks_mapped: 128, total_tasks_validated: 241, total_tasks_invalidated: 8, awaiting_payment: 64.00, total_payout: 1560.00, is_tracked_only: false },
  { id: "7", name: "Faye Valentine", osm_username: "romani_gypsy", role: "mapper", micropayments_visible: true, country_name: "Singapore", region_name: "Asia", timezone: "Asia/Singapore", assigned_projects: 3, total_tasks_mapped: 312, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 28.00, total_payout: 980.00, is_tracked_only: false },
  { id: "8", name: "Mugen Champloo", osm_username: "samurai_drift", role: "mapper", micropayments_visible: false, country_name: "Brazil", region_name: "South America", timezone: "America/Sao_Paulo", assigned_projects: 2, total_tasks_mapped: 184, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 0, total_payout: 620.00, is_tracked_only: false },
  { id: "9", name: "Revy Two Hands", osm_username: "two_hands", role: "mapper", micropayments_visible: true, country_name: "Thailand", region_name: "Asia", timezone: "Asia/Bangkok", assigned_projects: 4, total_tasks_mapped: 456, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 56.00, total_payout: 1340.00, is_tracked_only: false },
  { id: "10", name: "Ein Data Dog", osm_username: "data_dog", role: "mapper", micropayments_visible: false, country_name: "South Korea", region_name: "Asia", timezone: "Asia/Seoul", assigned_projects: 1, total_tasks_mapped: 67, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 0, total_payout: 210.00, is_tracked_only: true },
  { id: "11", name: "Togusa Niihama", osm_username: "section9_det", role: "mapper", micropayments_visible: true, country_name: "Germany", region_name: "Europe", timezone: "Europe/Berlin", assigned_projects: 3, total_tasks_mapped: 198, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 35.00, total_payout: 710.00, is_tracked_only: false },
  { id: "12", name: "Batou Ranger", osm_username: "think_tank", role: "validator", micropayments_visible: true, country_name: "France", region_name: "Europe", timezone: "Europe/Paris", assigned_projects: 7, total_tasks_mapped: 89, total_tasks_validated: 502, total_tasks_invalidated: 15, awaiting_payment: 0, total_payout: 3200.00, is_tracked_only: false },
  { id: "13", name: "Nia Teppelin", osm_username: "spiral_mapper", role: "mapper", micropayments_visible: true, country_name: "India", region_name: "Asia", timezone: "Asia/Kolkata", assigned_projects: 2, total_tasks_mapped: 145, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 22.00, total_payout: 480.00, is_tracked_only: false },
  { id: "14", name: "Kamina Jiha", osm_username: "row_row_fight", role: "mapper", micropayments_visible: true, country_name: "Mexico", region_name: "North America", timezone: "America/Mexico_City", assigned_projects: 3, total_tasks_mapped: 378, total_tasks_validated: 0, total_tasks_invalidated: 0, awaiting_payment: 48.00, total_payout: 1120.00, is_tracked_only: false },
];

const COUNTRIES = [
  "Brazil", "France", "Germany", "India", "Japan",
  "Kenya", "Mexico", "Philippines", "Singapore",
  "South Korea", "Thailand", "United States",
];

const NAV_ITEMS = [
  { label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { label: "Projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { label: "Time", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Training", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { label: "Checklists", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
  { label: "Users", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z", active: true },
  { label: "Teams", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
  { label: "Payments", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Reports", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { label: "Regions", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Punks List", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
  { label: "Friends List", icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" },
  { label: "Transcribe", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" },
];

export default function UsersDemo() {
  const [countrySearch, setCountrySearch] = useState("");

  const filteredCountries = COUNTRIES.filter((c) =>
    c.toLowerCase().includes(countrySearch.toLowerCase())
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--muted)" }}>
      {/* Header */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, height: 64, backgroundColor: "var(--background)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/mikro-logo.png" alt="Mikro" width={32} height={32} />
          <span style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)" }}>Mikro</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 14, color: "var(--foreground)" }}>Motoko Kusanagi</span>
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Settings</span>
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Logout</span>
        </div>
      </header>

      {/* Sidebar */}
      <aside style={{ position: "fixed", left: 0, top: 64, bottom: 0, width: 180, borderRight: "1px solid var(--border)", backgroundColor: "var(--background)", zIndex: 40, padding: "16px 0", overflowY: "auto" }}>
        <nav style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex", alignItems: "center", gap: 12, borderRadius: 8,
                padding: "10px 12px", fontSize: 14, fontWeight: 500,
                backgroundColor: "active" in item && item.active ? "rgba(255, 107, 53, 0.1)" : "transparent",
                color: "active" in item && item.active ? "#ff6b35" : "var(--muted-foreground)",
              }}
            >
              <svg style={{ width: 20, height: 20, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main style={{ paddingTop: 64, marginLeft: 180 }}>
        <div style={{ padding: 24 }}>
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold text-foreground">Users</h1>
              <div className="flex gap-2">
                <Button>Add</Button>
                <Button variant="outline">Track</Button>
                <Button variant="secondary">Edit</Button>
                <Button variant="destructive">Delete</Button>
                <Button variant="outline">Import CSV</Button>
              </div>
            </div>

            <div className="flex items-center gap-3 relative">
              <input type="text" placeholder="Search users..." className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none w-48" readOnly />
              <Button variant="outline" size="sm">Tracked Only</Button>
              <div className="relative">
                <Button variant="outline" size="sm" className="gap-1">
                  Country: <span className="text-foreground font-medium">All</span>
                  <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </Button>
                <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
                  <div className="px-2 py-1.5">
                    <input type="text" placeholder="Search..." className="w-full rounded border border-border bg-background px-2 py-1 text-sm" value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between px-3 py-1 text-xs">
                    <button className="text-kaart-blue hover:underline">Select all</button>
                    <button className="text-muted-foreground hover:underline">Clear all</button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredCountries.map((country) => (
                      <label key={country} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer">
                        <input type="checkbox" className="rounded" defaultChecked />
                        {country}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">+ Add Filter</span>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth: 900 }}>
                    <thead className="bg-muted border-b border-border">
                      <tr>
                        {["Name ▲", "OSM User", "Role", "Pay", "Country", "Region", "Timezone", "Projects", "Mapped", "Validated", "Invalidated", "Awaiting", "Total Paid"].map((col) => (
                          <th key={col} className="px-2 py-1.5 text-left text-xs font-semibold text-foreground whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {FAKE_USERS.map((user) => (
                        <tr key={user.id} className="hover:bg-muted/50">
                          <td className="px-2 py-1.5 max-w-[120px] truncate"><span className="font-medium text-kaart-orange">{user.name}</span></td>
                          <td className="px-2 py-1.5 text-sm text-foreground max-w-[120px] truncate">{user.osm_username}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${user.role === "admin" ? "bg-purple-100 text-purple-800" : user.role === "validator" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`}>
                                {roleLabel(user.role)}
                              </span>
                              {user.is_tracked_only && <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">tracked</span>}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {user.micropayments_visible
                              ? <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Yes</span>
                              : <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">No</span>}
                          </td>
                          <td className="px-2 py-1.5 text-foreground max-w-[120px] truncate">{user.country_name}</td>
                          <td className="px-2 py-1.5 text-foreground">{user.region_name}</td>
                          <td className="px-2 py-1.5 text-foreground text-xs">{user.timezone}</td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.assigned_projects)}</Val></td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_mapped)}</Val></td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_validated)}</Val></td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatNumber(user.total_tasks_invalidated)}</Val></td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatCurrency(user.awaiting_payment)}</Val></td>
                          <td className="px-2 py-1.5 text-foreground"><Val>{formatCurrency(user.total_payout)}</Val></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between px-2">
              <span className="text-sm text-muted-foreground">Showing 1–14 of 14 users</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
