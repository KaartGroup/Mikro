"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Modal,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
  Val,
} from "@/components/ui";
import { useToastActions } from "@/components/ui";
import {
  useUserTransactions,
  useUserPayable,
  useSubmitPaymentRequest,
  usePaymentsVisible,
} from "@/hooks";
import { formatNumber, formatCurrency, formatDate } from "@/lib/utils";
import { PayRateCard } from "@/components/user/PayRateCard";
import { MonthlyPaySummaryCard } from "@/components/user/MonthlyPaySummaryCard";
import {
  ReimbursementSubmitModal,
  ReimbursementsHistoryPanel,
} from "@/components/user/ReimbursementsSection";

export function UserPayments() {
  const {
    data: transactions,
    loading: transactionsLoading,
    refetch,
  } = useUserTransactions();
  const {
    data: payable,
    loading: payableLoading,
    refetch: refetchPayable,
  } = useUserPayable();
  const { mutate: submitPayment, loading: submitting } =
    useSubmitPaymentRequest();
  const { paymentsVisible, loading: pvLoading } = usePaymentsVisible();
  const toast = useToastActions();

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [paymentNotes, setPaymentNotes] = useState("");

  // Reimbursement workflow state. The submit modal lives at page level
  // so the "Submit Reimbursement" header button can open it regardless
  // of which tab is active. `reimbursementsRefreshKey` is bumped after
  // a successful submit to trigger the history panel to refetch.
  // Tabs are controlled (vs the original uncontrolled defaultValue)
  // so submitting a request can switch the active tab to Reimbursements.
  const [showReimbursementModal, setShowReimbursementModal] = useState(false);
  const [reimbursementsRefreshKey, setReimbursementsRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("pending");

  const ROWS_PER_PAGE = 20;
  const [requestsPage, setRequestsPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);

  const requests = transactions?.requests ?? [];
  const payments = transactions?.payments ?? [];

  const requestsTotalPages = Math.ceil(requests.length / ROWS_PER_PAGE);
  const paginatedRequests = requests.slice(
    (requestsPage - 1) * ROWS_PER_PAGE,
    requestsPage * ROWS_PER_PAGE,
  );
  const requestsShowingStart =
    requests.length > 0 ? (requestsPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const requestsShowingEnd = Math.min(
    requestsPage * ROWS_PER_PAGE,
    requests.length,
  );

  const paymentsTotalPages = Math.ceil(payments.length / ROWS_PER_PAGE);
  const paginatedPayments = payments.slice(
    (paymentsPage - 1) * ROWS_PER_PAGE,
    paymentsPage * ROWS_PER_PAGE,
  );
  const paymentsShowingStart =
    payments.length > 0 ? (paymentsPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const paymentsShowingEnd = Math.min(
    paymentsPage * ROWS_PER_PAGE,
    payments.length,
  );

  const pendingTotal = requests.reduce((sum, r) => sum + r.amount_requested, 0);
  const totalReceived = payments.reduce((sum, p) => sum + p.amount_paid, 0);

  const handleRequestPayment = async () => {
    if (!payable || payable.payable_total <= 0) {
      toast.error("No payable amount available");
      return;
    }

    try {
      await submitPayment({ notes: paymentNotes });
      toast.success("Payment request submitted successfully");
      setShowRequestModal(false);
      setPaymentNotes("");
      await refetch();
      await refetchPayable();
    } catch {
      toast.error("Failed to submit payment request");
    }
  };

  const loading = transactionsLoading || payableLoading || pvLoading;

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!paymentsVisible) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ marginBottom: 8 }}>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        </div>
        <Card>
          <CardContent style={{ padding: "48px 24px", textAlign: "center" }}>
            <p style={{ fontSize: 16, color: "#6b7280" }}>
              Payments are not enabled for your account.
            </p>
            <p style={{ fontSize: 14, color: "#9ca3af", marginTop: 8 }}>
              Contact your administrator if you believe this is an error.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3"
        style={{ marginBottom: 8 }}
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground" style={{ marginTop: 8 }}>
            Track your earnings and payment history
          </p>
        </div>
        <Button onClick={() => setShowReimbursementModal(true)}>
          + Submit Reimbursement
        </Button>
      </div>

      {/* Reimbursement submit modal — controlled by the header button.
          Bumps the history panel's refresh key on success and switches
          the active tab so the new row is immediately visible. */}
      <ReimbursementSubmitModal
        isOpen={showReimbursementModal}
        onClose={() => setShowReimbursementModal(false)}
        onSubmitted={() => {
          setReimbursementsRefreshKey((k) => k + 1);
          setActiveTab("reimbursements");
        }}
      />

      {/* Pay section — F12 hourly rate + F13 monthly summary. Also shown
          on /account; final placement TBD with Aaron. */}
      <div
        style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 2fr" }}
        className="grid-pay-row"
      >
        <PayRateCard />
        <MonthlyPaySummaryCard />
      </div>

      {/* Stats Row */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1.5fr 1fr 1fr 1fr",
        }}
        className="grid-stats"
      >
        {/* Available Balance - larger with button */}
        <Card
          style={{
            padding: 0,
            border: `2px solid ${requests.length > 0 ? "#ca8a04" : "#ff6b35"}`,
          }}
        >
          <div style={{ padding: "16px 20px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Available Balance
            </p>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: requests.length > 0 ? "#ca8a04" : "#ff6b35",
              }}
            >
              <Val>{formatCurrency(payable?.payable_total)}</Val>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              {requests.length > 0 ? "Request pending" : "Ready for payout"}
            </p>
            {requests.length > 0 ? (
              <p
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  backgroundColor: "rgba(202, 138, 4, 0.1)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "#a16207",
                }}
              >
                You have a pending request. New requests can be submitted after
                approval.
              </p>
            ) : (
              <Button
                style={{ marginTop: 12, width: "100%" }}
                onClick={() => setShowRequestModal(true)}
                disabled={(payable?.payable_total ?? 0) <= 0}
              >
                Request Payment
              </Button>
            )}
          </div>
        </Card>

        {/* Compact stats */}
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Pending Requests
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ca8a04" }}>
              <Val>{formatCurrency(pendingTotal)}</Val>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              {formatNumber(requests.length).text} awaiting approval
            </p>
          </div>
        </Card>

        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Total Received
            </p>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a" }}>
              <Val>{formatCurrency(totalReceived)}</Val>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              Lifetime earnings
            </p>
          </div>
        </Card>

        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              Total Payments
            </p>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              <Val>{formatNumber(payments.length)}</Val>
            </div>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              Completed payouts
            </p>
          </div>
        </Card>
      </div>

      {/* Earnings Breakdown - Compact */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(3, 1fr)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "rgba(34, 197, 94, 0.1)",
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 12, color: "#15803d" }}>Mapping Earnings</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#166534" }}>
            <Val>{formatCurrency(payable?.mapping_earnings)}</Val>
          </p>
        </div>
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 12, color: "#1d4ed8" }}>Validation Earnings</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#1e40af" }}>
            <Val>{formatCurrency(payable?.validation_earnings)}</Val>
          </p>
        </div>
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "rgba(168, 85, 247, 0.1)",
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 12, color: "#7c3aed" }}>Checklist Earnings</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#6d28d9" }}>
            <Val>{formatCurrency(payable?.checklist_earnings)}</Val>
          </p>
        </div>
      </div>

      {/* Tabs for Requests, History, and Reimbursements. Controlled
          via `activeTab` so the submit-modal success handler can flip
          the user to the new request's tab. */}
      <Tabs
        defaultValue="pending"
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList>
          <TabsTrigger value="pending">
            Pending Requests ({formatNumber(requests.length).text})
          </TabsTrigger>
          <TabsTrigger value="history">
            Payment History ({formatNumber(payments.length).text})
          </TabsTrigger>
          <TabsTrigger value="reimbursements">Reimbursements</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card style={{ padding: 0 }}>
            <CardContent style={{ padding: 0 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request ID</TableHead>
                    <TableHead>Date Requested</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        #{request.id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(request.date_requested)}
                      </TableCell>
                      <TableCell className="font-bold whitespace-nowrap">
                        <Val>{formatCurrency(request.amount_requested)}</Val>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        <Val fallback="-">{request.notes}</Val>
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning">Pending</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {requests.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        style={{
                          textAlign: "center",
                          padding: "32px 16px",
                          color: "#6b7280",
                        }}
                      >
                        No pending payment requests
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {requests.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 px-4 pb-4 text-sm text-muted-foreground">
                  <span>
                    Showing {requestsShowingStart}-{requestsShowingEnd} of{" "}
                    {requests.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={requestsPage === 1}
                      onClick={() => setRequestsPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {requestsPage} of {requestsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={requestsPage === requestsTotalPages}
                      onClick={() => setRequestsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card style={{ padding: 0 }}>
            <CardContent style={{ padding: 0 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Date Paid</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedPayments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        #{payment.id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(payment.date_paid)}
                      </TableCell>
                      <TableCell className="font-bold text-green-600 whitespace-nowrap">
                        <Val>{formatCurrency(payment.amount_paid)}</Val>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        <Val fallback="-">{payment.notes}</Val>
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">Paid</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        style={{
                          textAlign: "center",
                          padding: "32px 16px",
                          color: "#6b7280",
                        }}
                      >
                        No payment history yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {payments.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4 px-4 pb-4 text-sm text-muted-foreground">
                  <span>
                    Showing {paymentsShowingStart}-{paymentsShowingEnd} of{" "}
                    {payments.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={paymentsPage === 1}
                      onClick={() => setPaymentsPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-2">
                      Page {paymentsPage} of {paymentsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={paymentsPage === paymentsTotalPages}
                      onClick={() => setPaymentsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reimbursements">
          <ReimbursementsHistoryPanel refreshKey={reimbursementsRefreshKey} />
        </TabsContent>
      </Tabs>

      {/* Request Payment Modal */}
      <Modal
        isOpen={showRequestModal}
        onClose={() => {
          setShowRequestModal(false);
          setPaymentNotes("");
        }}
        title="Request Payment"
        description="Submit a payment request for your available balance"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setShowRequestModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleRequestPayment}
              isLoading={submitting}
              disabled={(payable?.payable_total ?? 0) <= 0}
            >
              Submit Request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-kaart-orange/10 p-4">
            <p className="text-sm text-muted-foreground">You are requesting:</p>
            <p className="text-3xl font-bold text-kaart-orange">
              <Val>{formatCurrency(payable?.payable_total)}</Val>
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Earnings Breakdown:</p>
            <div className="text-sm space-y-1 bg-muted p-3 rounded-lg">
              <div className="flex justify-between">
                <span>Mapping:</span>
                <span className="font-medium">
                  <Val>{formatCurrency(payable?.mapping_earnings)}</Val>
                </span>
              </div>
              <div className="flex justify-between">
                <span>Validation:</span>
                <span className="font-medium">
                  <Val>{formatCurrency(payable?.validation_earnings)}</Val>
                </span>
              </div>
              <div className="flex justify-between">
                <span>Checklist:</span>
                <span className="font-medium">
                  <Val>{formatCurrency(payable?.checklist_earnings)}</Val>
                </span>
              </div>
              <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold">
                <span>Total:</span>
                <span>
                  <Val>{formatCurrency(payable?.payable_total)}</Val>
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Notes (optional)
            </label>
            <textarea
              className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              rows={3}
              placeholder="Add any notes for this payment request..."
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Payment will be processed within 5-7 business days after approval.
            You will receive the payment to your registered payment method.
          </p>
        </div>
      </Modal>
    </div>
  );
}
