#!/usr/bin/env python3
"""
HourlyPaymentService — monthly pay snapshots for hourly contractors.

Extracted from ``api/views/TimeTracking.py``. Handles the HourlyPayment
record lifecycle: hourly summary computation, rate management, and
monthly paid/unpaid toggling.

Usage::

    svc = HourlyPaymentService(g.user.org_id)
"""


class HourlyPaymentService:
    """Monthly pay snapshot operations for hourly contractors, org-scoped."""

    def __init__(self, org_id: str):
        self.org_id = org_id
