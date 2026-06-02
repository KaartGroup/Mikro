"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useUserDetails } from "@/hooks";
import { formatCurrency } from "@/lib/utils";

/**
 * F12 — user-facing read-only display of their own hourly rate.
 * Backend policy (see backend/api/auth/pay_visibility.py) lets self +
 * admin see `hourly_rate`. Used on both /account and /user/payments
 * while Aaron decides where it lives long-term.
 */
export function PayRateCard() {
  const { data, loading } = useUserDetails();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Hourly Rate</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data?.hourly_rate != null ? (
          <>
            <div className="text-2xl font-bold text-kaart-orange">
              {formatCurrency(data.hourly_rate).text}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                /hr
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Only you and a Kaart admin can see this. If it looks wrong, ping
              the admin who set it up.
            </p>
          </>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              No hourly rate set.
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              You&apos;re paid per-task on the projects you work on — see your
              Payments tab for running earnings.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
