# Payments page v1 — feature plan

**Trello:** [Revamped Payments Management UI](https://trello.com/c/DWAbQFlL) (`69fe4305a157a9474d529d4e`)
**Sibling card (queue piece):** [Reimbursement-request submission flow](https://trello.com/c/PkljPEJx)
**Priority:** P1 — must be operational by end of month so Aaron can run Mona Kea payroll out of Mikro.
**Authored:** 2026-05-12

---

## 1. Goal

Replace Chrono Cards with a Mikro-resident Payments page that lets an org admin run a monthly payroll cycle for hourly contractors. The Trello card describes a full multi-compensation-model workspace; **v1 is the hourly slice of that vision only.** Everything else from the spec (salaried, project-based, hybrid, provider integrations, forecasting) is deferred.

Per Logan's 2026-05-12 meeting notes on the parent card: Mona Kea's editors are 100% hourly with rates already submitted in Mikro. The bottleneck is making the payment-calculation + adjustments + approval flow reliable enough for Aaron to dispense from.

---

## 2. Scope — what v1 includes

Top-down through the mockup, only the parts marked **v1** in my report:

### 2.1 Cycle selector
- Header control: pick the payroll period (date range). Default = current calendar month.
- Compute everything in the view from that range; no new `payroll_cycles` table.
- Preset shortcuts: This Month, Last Month, Custom Range.

### 2.2 Pending Payments table
- One row per contributor with sessions in the period (or one row per assigned hourly contractor — see §6 decisions).
- Columns:
  - Contributor (name + OSM username)
  - Hours (sum of `time_entries.duration` where `user_id = X AND clock_out BETWEEN [start, end]`)
  - Rate (`user.hourly_rate`)
  - Calculated Wage (Hours × Rate)
  - Adjustments (sum of approved reimbursements + any admin-added amounts; see §2.4)
  - Total Payable (Calculated + Adjustments)
  - Status pill: Pending | Held | Approved | Paid
  - Row action: drill-in to detail card (§2.5)

### 2.3 Cycle KPI strip
Three cards at top, derived from the table:
- **Total Payable** — sum across all rows for the period
- **Approved** — sum across rows with status = Approved or Paid
- **Adjustments** — sum across the Adjustments column
- (Add a fourth "Outstanding Reimbursement Requests" once §2.6 lands.)

### 2.4 Adjustments column — admin-entered
- Click into a contributor's Adjustments cell → small inline form: amount, note, type (reimbursement / correction / other)
- Saves as a new `payment_adjustments` row (see §3 data model)
- Multiple adjustments per contributor per period are summed in the column display
- Adjustments are versioned (timestamped, audited by admin id) so we can show "who added what when" in the detail card

### 2.5 Featured contributor detail card
- Drawer/modal opened from a row click
- Shows:
  - Header: name, role, rate, calculated total
  - Session breakdown table (raw `time_entries` rows that contributed to the hours total)
  - Adjustments list with notes + who added them
  - Status state machine: Pending → Approved → Paid (or → Held with a note)
  - "Add reimbursement" button (admin) — same form as §2.4 inline
- Read-only for non-org-admin viewers (team_admin can view their own team members but cannot mutate)

### 2.6 Reimbursement request inbox (link to sibling card)
- Sibling Trello card [PkljPEJx](https://trello.com/c/PkljPEJx) covers the **editor-submission side**
- On the Payments page, a small queue widget surfaces **pending requests** for the active cycle
- Approving a request creates a `payment_adjustment` row tied to that contributor/cycle and dismisses it from the queue
- v1 of the queue is a vertical list within the Payments page, not its own route

### 2.7 Approve / Hold actions
- Approve: flag the row green; sets `status = "approved"`, records who approved + when
- Hold: flag the row red with a required note; sets `status = "held"` (e.g. "waiting on Andy's receipt", "pay-period mismatch with Gusto")
- **No external action triggers in v1** — Aaron still dispenses manually based on the approved list

### 2.8 Cycle export
- "Export approved rows" button → CSV with contributor / hours / rate / adjustments / total / payment_email
- Aaron uses this CSV as his send-out worksheet
- No PDF in v1; the mockup's "Send Notice" button is a no-op stub for now (depends on comms platform)

---

## 3. Data model additions

### 3.1 New table: `payment_adjustments`

```python
class PaymentAdjustment(CRUDMixin, SurrogatePK, db.Model):
    __tablename__ = "payment_adjustments"

    user_id = db.Column(db.String(255), db.ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    cycle_start = db.Column(db.Date, nullable=False, index=True)
    cycle_end   = db.Column(db.Date, nullable=False, index=True)
    amount      = db.Column(db.Numeric(10, 2), nullable=False)
    type        = db.Column(db.String(50), nullable=False)
                  # "reimbursement" | "correction" | "other"
    note        = db.Column(db.Text, nullable=True)
    source      = db.Column(db.String(50), nullable=False, default="admin_entry")
                  # "admin_entry" | "approved_request" (from sibling card)
    request_id  = db.Column(db.Integer, nullable=True)
                  # FK to reimbursement_requests table once that card ships
    added_by    = db.Column(db.String(255), nullable=False)
                  # admin user_id who added this row
    created_at  = db.Column(db.DateTime, default=func.now(), nullable=False)
```

Cycle is identified by `(cycle_start, cycle_end)` rather than a `payroll_cycles` FK — keeps the data model lean and matches the "compute on the fly from a date range" decision.

### 3.2 New column on `users`

```python
payment_status = db.Column(db.String(50), nullable=True, default=None, index=True)
```

Per-user × cycle status doesn't fit on `users` (would need a separate table). Going with a separate table:

### 3.3 New table: `payment_cycle_status`

```python
class PaymentCycleStatus(CRUDMixin, SurrogatePK, db.Model):
    __tablename__ = "payment_cycle_status"

    user_id     = db.Column(db.String(255), db.ForeignKey("users.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    cycle_start = db.Column(db.Date, nullable=False, index=True)
    cycle_end   = db.Column(db.Date, nullable=False, index=True)
    status      = db.Column(db.String(20), nullable=False, default="pending")
                  # "pending" | "approved" | "held" | "paid"
    note        = db.Column(db.Text, nullable=True)  # hold reason
    actor_id    = db.Column(db.String(255), nullable=True)
                  # admin who set the status
    updated_at  = db.Column(db.DateTime, default=func.now(),
                            onupdate=func.now(), nullable=False)

    __table_args__ = (
        db.UniqueConstraint("user_id", "cycle_start", "cycle_end",
                            name="uq_payment_cycle_status_user_cycle"),
    )
```

Default state when no row exists = "pending". Rows are created lazily on first state change.

### 3.4 Migration

Single additive migration (run migration-chain-check before writing!):
- `grep -h "^revision = " backend/migrations/versions/*.py | sort -u` → confirm new revision ID is unique
- Sets `down_revision` to the current head (verify with `flask db current` against prod)
- `op.create_table("payment_adjustments", ...)`
- `op.create_table("payment_cycle_status", ...)`
- `op.create_index` for each FK / unique constraint
- No changes to existing tables

Per the standing migration rule: must run `flask db current` against prod **before** writing the file to confirm chain head.

---

## 4. Backend endpoints

All under `/api/payments/` (new view class `PaymentsAPI` in `backend/api/views/Payments.py`).

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/payments/cycle` | POST | `@requires_team_admin_or_above` | Return cycle rows for `{cycle_start, cycle_end}`. team_admin sees only managed-team members; org_admin / super_admin see all org members. |
| `/api/payments/cycle/kpis` | POST | same | Return the 3 KPI totals for the period |
| `/api/payments/contributor` | POST | same | Drill-in detail for one user × cycle: sessions, adjustments, status history |
| `/api/payments/adjustment/create` | POST | `@requires_admin` | Create a new `payment_adjustment` row |
| `/api/payments/adjustment/delete` | POST | `@requires_admin` | Soft-delete (set `is_deleted = True`); audit trail preserved |
| `/api/payments/status/set` | POST | `@requires_admin` | Set status for a user × cycle (approve / hold / paid) |
| `/api/payments/cycle/export` | POST | `@requires_admin` | Return CSV of approved rows |

Notes:
- Reuse existing `pay_visibility.can_view_pay_for` to redact pay info when a team_admin queries a non-managed user
- All endpoints filter by `g.user.org_id` for cross-org safety
- Use the F3 helper `team_member_ids_for(managed_team_ids_for(g.user))` to scope team_admin queries

---

## 5. Frontend changes

New route: `/admin/payments-v2` (don't replace existing `/admin/payments` until v1 ships and is verified)

Page composition:
- `frontend/mikro-next/src/app/(authenticated)/admin/payments-v2/page.tsx`
- New components under `frontend/mikro-next/src/components/admin/payments/`:
  - `CycleSelector.tsx`
  - `CycleKpiStrip.tsx`
  - `PaymentsTable.tsx`
  - `AdjustmentCell.tsx` (inline form)
  - `ContributorDetailDrawer.tsx`
  - `ReimbursementInbox.tsx` (deferred until sibling card lands)
- New hooks in `useApi.ts`: `useFetchPaymentCycle`, `useFetchContributorDetail`, `useCreateAdjustment`, `useDeleteAdjustment`, `useSetCycleStatus`, `useExportCycle`

Types added to `types/index.ts`:
- `PaymentCycleRow`
- `PaymentCycleKpis`
- `PaymentAdjustment`
- `PaymentContributorDetail`
- `PaymentCycleStatus` (`"pending" | "approved" | "held" | "paid"`)

Sidebar nav: add "Payments v2" under the existing admin nav (temporary label until v1 replaces v1-of-old).

---

## 6. Decisions deferred to Logan / Aaron

Per the meeting notes, these are open before we cut implementation:

1. **Row inclusion rule** — should the table show:
   - (a) every active hourly contractor (even zero-hour rows), OR
   - (b) only contractors with non-zero hours OR pending adjustments in the period?
   Current proposal: (b), with a "show zero-hour rows" toggle.

2. **Status semantics** — is **Held** distinct from **Pending** in any way Aaron acts on, or are we modeling more states than needed?

3. **Approve = what, exactly** — flag-only state change (v1 plan) vs notification trigger to Aaron (depends on comms platform).

4. **CSV column set for export** — what columns does Aaron's current Chrono-Cards-to-Payoneer worksheet contain? Match that to minimize friction during cutover.

5. **Overtime field** — placeholder column on `users` per the meeting notes. Add nullable `overtime_rate` and `overtime_threshold_hours`, leave UI hidden behind a feature flag? Or skip until needed?

---

## 7. Out of scope for v1 (explicitly deferred)

From the mockup right rail / bottom row, deferred:

- Payroll Cycle Overview donut chart (right rail)
- Notifications & Alerts widget (blocked on comms platform)
- Payment Provider Status widget (blocked on F15 external payment integration)
- Compensation Model Distribution chart (only relevant once we support >1 model)
- Project Compensation Allocation
- Project Payment Forecasting
- Operational Notes / Recent Activity feed
- Salaried / Hybrid / Project-Based compensation logic
- QA-weighted compensation multipliers
- "Send Notice" automation
- External payment provider integration

Each of these is its own follow-on card once v1 is stable.

---

## 8. Acceptance for v1 ship

- [ ] Org admin can open `/admin/payments-v2`, pick a date range, and see a per-contributor table with hours × rate = calculated wage
- [ ] Admin can add an Adjustment to any contributor's cycle row
- [ ] Adjustments are summed in the row and reflected in Total Payable
- [ ] Admin can set Approve / Hold status per row with audit trail
- [ ] Held rows display the reason
- [ ] Three-card KPI strip shows correct Total Payable / Approved / Adjustments
- [ ] Export → CSV produces a file Aaron can use directly
- [ ] team_admin can view their managed-team members' rows (read-only)
- [ ] team_admin cannot view or mutate any non-managed-team user's pay data
- [ ] Migration runs cleanly on prod (no chain breakage)
- [ ] Aaron successfully runs end-of-month payroll out of this UI for May 2026

---

## 9. Implementation order (suggested ticket-cut)

If we're carving this into discrete commits/cards:

1. **Backend foundation** — migration + `payment_adjustments` and `payment_cycle_status` models + `PaymentsAPI` view stub
2. **Cycle query endpoint** — `/api/payments/cycle` returning aggregated rows from `time_entries`
3. **Frontend skeleton** — `/admin/payments-v2` route + `CycleSelector` + empty `PaymentsTable` wired to the cycle endpoint
4. **KPI strip** — `/api/payments/cycle/kpis` + `CycleKpiStrip` component
5. **Adjustments** — `/api/payments/adjustment/{create,delete}` + `AdjustmentCell` inline form
6. **Status state machine** — `/api/payments/status/set` + status pill + approve/hold actions
7. **Contributor detail drawer** — `/api/payments/contributor` + `ContributorDetailDrawer`
8. **CSV export** — `/api/payments/cycle/export` + Export button
9. **Sidebar nav** + smoke test as org_admin, team_admin, regular user
10. **Migration prod-run + sibling-card pairing** with the reimbursement queue when it lands

Each numbered step is a candidate Trello card / commit.

---

## 10. Risks

- **Migration chain check** — mandatory before writing the migration file. Got burned in this session on the team_leads migration; not making the same mistake twice.
- **time_entries → cycle aggregation correctness** — edge cases: sessions that span midnight on a cycle boundary, voided sessions, sessions with `clock_out IS NULL` (active sessions), entries with `status = "voided"`. Aggregation rules need to be explicit.
- **Hours rounding** — Aaron's manual process likely rounds to the nearest minute or quarter-hour. Match whatever he's been doing in Chrono Cards / Gusto.
- **First-cycle cutover** — Logan and Aaron will run May 2026 payroll from this UI for the first time at end of month. We need a dry-run check the week before so any mismatches with the Chrono Cards equivalent surface early.
- **Cross-org leakage** — every endpoint must filter by `g.user.org_id`. Easy to miss when copy-pasting a new endpoint; needs a checklist on each.
