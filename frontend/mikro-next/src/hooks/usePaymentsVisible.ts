import { useState, useEffect } from "react";

/**
 * Hook that checks whether the current user should see payment-related UI.
 * Returns true for admins always, and `micropayments_visible` value for others.
 */
export function usePaymentsVisible(): { paymentsVisible: boolean; loading: boolean } {
  const [paymentsVisible, setPaymentsVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVisibility = async () => {
      try {
        const res = await fetch("/backend/user/fetch_user_details", {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          // All admin tiers always see payments — server scopes data
          // by role, but the UI block stays accessible.
          if (
            data.role === "admin" ||
            data.role === "super_admin" ||
            data.role === "team_admin"
          ) {
            setPaymentsVisible(true);
          } else {
            setPaymentsVisible(data.micropayments_visible ?? false);
          }
        }
      } catch (error) {
        console.error("Failed to fetch payment visibility:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchVisibility();
  }, []);

  return { paymentsVisible, loading };
}
