"use client";

import { useState, useEffect } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Val } from "@/components/ui";
import { useTheme } from "@/contexts/ThemeContext";
import { usePaymentsVisible } from "@/hooks";
import { roleLabel } from "@/types";
import { PayRateCard } from "@/components/user/PayRateCard";
import { MonthlyPaySummaryCard } from "@/components/user/MonthlyPaySummaryCard";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  osm_username: string | null;
  osm_id: number | null;
  osm_verified: boolean;
  osm_verified_at: string | null;
  mapillary_username: string | null;
  payment_email: string;
  city: string;
  country: string;
  timezone: string | null;
  role: string;
}

interface CountryOption {
  id: number;
  name: string;
  region_name: string;
}

export default function AccountPage() {
  const { user: auth0User, isLoading: userLoading } = useUser();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [osmLinking, setOsmLinking] = useState(false);
  const [osmUnlinking, setOsmUnlinking] = useState(false);
  const [osmMessage, setOsmMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mapillaryInput, setMapillaryInput] = useState("");
  const [mapillaryLinking, setMapillaryLinking] = useState(false);
  const [mapillaryUnlinking, setMapillaryUnlinking] = useState(false);
  const [mapillaryMessage, setMapillaryMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { paymentsVisible } = usePaymentsVisible();

  // Form state
  const [paymentEmail, setPaymentEmail] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [timezone, setTimezone] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);

  useEffect(() => {
    fetchProfile();
    fetchCountries();

    // Check URL params for OSM OAuth result
    const osmLinked = searchParams.get("osm_linked");
    const osmError = searchParams.get("osm_error");

    if (osmLinked === "true") {
      setOsmMessage({ type: "success", text: "OSM account linked successfully!" });
      // Clear the URL params
      window.history.replaceState({}, "", "/account");
    } else if (osmError) {
      const errorMessages: Record<string, string> = {
        missing_params: "Missing OAuth parameters",
        invalid_state: "Invalid OAuth state - please try again",
        session_expired: "Session expired - please try again",
        token_exchange_failed: "Failed to exchange token with OSM",
        no_access_token: "No access token received from OSM",
        fetch_user_failed: "Failed to fetch OSM user details",
        invalid_osm_user: "Invalid OSM user data received",
        already_linked: "This OSM account is already linked to another user",
        user_not_found: "User not found",
        update_failed: "Failed to update user profile",
      };
      setOsmMessage({ type: "error", text: errorMessages[osmError] || `Error: ${osmError}` });
      window.history.replaceState({}, "", "/account");
    }
  }, [searchParams]);

  const fetchProfile = async () => {
    try {
      const response = await fetch("/backend/user/fetch_user_profile", {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        setPaymentEmail(data.payment_email || "");
        setCity(data.city || "");
        setCountry(data.country || "");
        setTimezone(data.timezone || "");
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCountries = async () => {
    try {
      const response = await fetch("/backend/region/list_countries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (data.status === 200 && data.countries) {
        setCountries(data.countries);
      }
    } catch (error) {
      console.error("Failed to fetch countries:", error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/backend/user/update_profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_email: paymentEmail,
          city,
          country,
          timezone,
        }),
      });
      if (response.ok) {
        setIsEditing(false);
        fetchProfile();
      }
    } catch (error) {
      console.error("Failed to update profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLinkOSM = async () => {
    setOsmLinking(true);
    setOsmMessage(null);
    try {
      const response = await fetch("/backend/osm/start", {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        // Redirect to OSM OAuth
        window.location.href = data.auth_url;
      } else {
        const error = await response.json();
        setOsmMessage({ type: "error", text: error.message || "Failed to start OSM linking" });
        setOsmLinking(false);
      }
    } catch (error) {
      console.error("Failed to start OSM linking:", error);
      setOsmMessage({ type: "error", text: "Failed to start OSM linking" });
      setOsmLinking(false);
    }
  };

  const handleUnlinkOSM = async () => {
    if (!confirm("Are you sure you want to unlink your OSM account?")) {
      return;
    }
    setOsmUnlinking(true);
    setOsmMessage(null);
    try {
      const response = await fetch("/backend/osm/unlink", {
        method: "POST",
      });
      if (response.ok) {
        setOsmMessage({ type: "success", text: "OSM account unlinked successfully" });
        fetchProfile();
      } else {
        const error = await response.json();
        setOsmMessage({ type: "error", text: error.message || "Failed to unlink OSM account" });
      }
    } catch (error) {
      console.error("Failed to unlink OSM:", error);
      setOsmMessage({ type: "error", text: "Failed to unlink OSM account" });
    } finally {
      setOsmUnlinking(false);
    }
  };

  const handleLinkMapillary = async () => {
    const username = mapillaryInput.trim();
    if (!username) return;
    setMapillaryLinking(true);
    setMapillaryMessage(null);
    try {
      const response = await fetch("/backend/user/link_mapillary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapillary_username: username }),
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        setMapillaryMessage({ type: "success", text: data.message });
        setMapillaryInput("");
        fetchProfile();
      } else {
        setMapillaryMessage({ type: "error", text: data.message || "Failed to link Mapillary account" });
      }
    } catch (error) {
      console.error("Failed to link Mapillary:", error);
      setMapillaryMessage({ type: "error", text: "Failed to link Mapillary account" });
    } finally {
      setMapillaryLinking(false);
    }
  };

  const handleUnlinkMapillary = async () => {
    if (!confirm("Are you sure you want to unlink your Mapillary account?")) return;
    setMapillaryUnlinking(true);
    setMapillaryMessage(null);
    try {
      const response = await fetch("/backend/user/unlink_mapillary", {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok && data.status === 200) {
        setMapillaryMessage({ type: "success", text: data.message });
        fetchProfile();
      } else {
        setMapillaryMessage({ type: "error", text: data.message || "Failed to unlink Mapillary account" });
      }
    } catch (error) {
      console.error("Failed to unlink Mapillary:", error);
      setMapillaryMessage({ type: "error", text: "Failed to unlink Mapillary account" });
    } finally {
      setMapillaryUnlinking(false);
    }
  };

  if (userLoading || isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 256 }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kaart-orange" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <h1 className="text-3xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground" style={{ marginTop: 8 }}>
          Manage your profile and preferences
        </p>
      </div>

      {/* Pay section — F12 hourly rate + F13 monthly summary. Also shown
          on /user/payments; final placement TBD with Aaron. */}
      {paymentsVisible && (
        <>
          <PayRateCard />
          <MonthlyPaySummaryCard />
        </>
      )}

      {/* OSM Account Linking Card */}
      <Card>
        <CardHeader>
          <CardTitle>OpenStreetMap Account</CardTitle>
        </CardHeader>
        <CardContent>
          {/* OSM Message Alert */}
          {osmMessage && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                marginBottom: 16,
                backgroundColor: osmMessage.type === "success" ? "#dcfce7" : "#fee2e2",
                color: osmMessage.type === "success" ? "#166534" : "#991b1b",
                fontSize: 14,
              }}
            >
              {osmMessage.text}
            </div>
          )}

          {profile?.osm_verified ? (
            // Verified OSM Account Display
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  backgroundColor: "var(--secondary)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    backgroundColor: "#22c55e",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 20,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{profile.osm_username}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 12,
                        backgroundColor: "#22c55e",
                        color: "white",
                        fontWeight: 500,
                      }}
                    >
                      Verified
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>
                    Linked {profile.osm_verified_at ? new Date(profile.osm_verified_at).toLocaleDateString() : ""}
                    {profile.osm_id && ` (OSM ID: ${profile.osm_id})`}
                  </p>
                </div>
                <a
                  href={`https://www.openstreetmap.org/user/${profile.osm_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "6px 12px",
                    fontSize: 13,
                    color: "var(--accent)",
                    textDecoration: "none",
                    borderRadius: 6,
                    border: "1px solid var(--accent)",
                  }}
                >
                  View Profile
                </a>
              </div>
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button
                  onClick={handleUnlinkOSM}
                  disabled={osmUnlinking}
                  style={{
                    fontSize: 13,
                    color: "#dc2626",
                    background: "none",
                    border: "none",
                    cursor: osmUnlinking ? "not-allowed" : "pointer",
                    textDecoration: "underline",
                    opacity: osmUnlinking ? 0.5 : 1,
                  }}
                >
                  {osmUnlinking ? "Unlinking..." : "Unlink OSM Account"}
                </button>
              </div>
            </div>
          ) : (
            // Not Linked - Show Link Button
            <div>
              <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginBottom: 16 }}>
                Link your OpenStreetMap account to verify your identity and enable automatic stats tracking.
              </p>
              <Button onClick={handleLinkOSM} disabled={osmLinking}>
                {osmLinking ? (
                  <>
                    <span className="animate-spin mr-2">...</span>
                    Connecting...
                  </>
                ) : (
                  "Link OSM Account"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mapillary Account Linking Card */}
      <Card>
        <CardHeader>
          <CardTitle>Mapillary Account</CardTitle>
        </CardHeader>
        <CardContent>
          {mapillaryMessage && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                marginBottom: 16,
                backgroundColor: mapillaryMessage.type === "success" ? "#dcfce7" : "#fee2e2",
                color: mapillaryMessage.type === "success" ? "#166534" : "#991b1b",
                fontSize: 14,
              }}
            >
              {mapillaryMessage.text}
            </div>
          )}

          {profile?.mapillary_username ? (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  backgroundColor: "var(--secondary)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    backgroundColor: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 20,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{profile.mapillary_username}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 12,
                        backgroundColor: "#10b981",
                        color: "white",
                        fontWeight: 500,
                      }}
                    >
                      Linked
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>
                    Mapillary imagery uploads are being tracked
                  </p>
                </div>
                <a
                  href={`https://www.mapillary.com/app/user/${profile.mapillary_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "6px 12px",
                    fontSize: 13,
                    color: "var(--accent)",
                    textDecoration: "none",
                    borderRadius: 6,
                    border: "1px solid var(--accent)",
                  }}
                >
                  View Profile
                </a>
              </div>
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button
                  onClick={handleUnlinkMapillary}
                  disabled={mapillaryUnlinking}
                  style={{
                    fontSize: 13,
                    color: "#dc2626",
                    background: "none",
                    border: "none",
                    cursor: mapillaryUnlinking ? "not-allowed" : "pointer",
                    textDecoration: "underline",
                    opacity: mapillaryUnlinking ? 0.5 : 1,
                  }}
                >
                  {mapillaryUnlinking ? "Unlinking..." : "Unlink Mapillary Account"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginBottom: 16 }}>
                Link your Mapillary account to track your street-level imagery uploads.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <Input
                    value={mapillaryInput}
                    onChange={(e) => setMapillaryInput(e.target.value)}
                    placeholder="Your Mapillary username"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLinkMapillary();
                    }}
                  />
                </div>
                <Button
                  onClick={handleLinkMapillary}
                  disabled={mapillaryLinking || !mapillaryInput.trim()}
                >
                  {mapillaryLinking ? "Verifying..." : "Link Account"}
                </Button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>
                Your username will be verified against the Mapillary API to confirm it exists.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <CardTitle>Profile Information</CardTitle>
            {!isEditing && (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Avatar and Name */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 20, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              backgroundColor: "#ff6b35",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 24,
              fontWeight: 700
            }}>
              {profile?.name?.charAt(0).toUpperCase() || auth0User?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{profile?.name || auth0User?.name}</h2>
              <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginBottom: 6 }}>{profile?.email || auth0User?.email}</p>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 500,
                backgroundColor: "rgba(255, 107, 53, 0.1)",
                color: "#ff6b35"
              }}>
                {roleLabel(profile?.role)}
              </span>
            </div>
          </div>

          {/* Editable Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {paymentsVisible && (
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Payment Email (Payoneer)</label>
                {isEditing ? (
                  <Input
                    type="email"
                    value={paymentEmail}
                    onChange={(e) => setPaymentEmail(e.target.value)}
                    placeholder="your-payoneer@email.com"
                  />
                ) : (
                  <p style={{ fontSize: 15, color: "var(--foreground)" }}><Val fallback="-">{profile?.payment_email}</Val></p>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 6 }}>City</label>
                {isEditing ? (
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                  />
                ) : (
                  <p style={{ fontSize: 15, color: "var(--foreground)" }}><Val fallback="-">{profile?.city}</Val></p>
                )}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Country</label>
                {isEditing ? (
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: 14,
                    }}
                  >
                    <option value="">Select a country</option>
                    {(() => {
                      const grouped: Record<string, CountryOption[]> = {};
                      countries.forEach((c) => {
                        const region = c.region_name || "Other";
                        if (!grouped[region]) grouped[region] = [];
                        grouped[region].push(c);
                      });
                      return Object.entries(grouped)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([region, items]) => (
                          <optgroup key={region} label={region}>
                            {items
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                          </optgroup>
                        ));
                    })()}
                  </select>
                ) : (
                  <p style={{ fontSize: 15, color: "var(--foreground)" }}><Val fallback="-">{profile?.country}</Val></p>
                )}
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Timezone</label>
              {isEditing ? (
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: 14,
                  }}
                >
                  <option value="">Select a timezone</option>
                  {Intl.supportedValuesOf("timeZone").map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <p style={{ fontSize: 15, color: "var(--foreground)" }}><Val fallback="-">{profile?.timezone?.replace(/_/g, " ")}</Val></p>
              )}
            </div>
          </div>

          {/* Save/Cancel Buttons */}
          {isEditing && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 20, marginTop: 20, borderTop: "1px solid var(--border)" }}>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditing(false);
                  setPaymentEmail(profile?.payment_email || "");
                  setCity(profile?.city || "");
                  setCountry(profile?.country || "");
                  setTimezone(profile?.timezone || "");
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Appearance Card */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              backgroundColor: "var(--secondary)",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <div>
              <h3 style={{ fontWeight: 500, fontSize: 15 }}>Dark Mode</h3>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>
                Enable dark theme for the application
              </p>
            </div>
            <button
              onClick={toggleDarkMode}
              style={{
                position: "relative",
                display: "inline-flex",
                height: 24,
                width: 44,
                alignItems: "center",
                borderRadius: 9999,
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s",
                backgroundColor: isDarkMode ? "#3b82f6" : "#d1d5db",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  height: 16,
                  width: 16,
                  borderRadius: "50%",
                  backgroundColor: "white",
                  transition: "transform 0.2s",
                  transform: isDarkMode ? "translateX(24px)" : "translateX(4px)",
                }}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Session Card */}
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)", marginBottom: 12 }}>
            Sign out of your account on this device.
          </p>
          <a
            href="/auth/logout"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              backgroundColor: "#dc2626",
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: "white",
              textDecoration: "none"
            }}
          >
            Sign Out
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
