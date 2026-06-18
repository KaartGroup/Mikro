#!/usr/bin/env python3
"""
Transaction API endpoints for Mikro.

Handles payment and transaction operations.
"""

from flask.views import MethodView
from flask import g, request

from ..database import PayRequests, UserTasks, Task
from ..services.payment_balance import PaymentBalanceService


class TransactionAPI(MethodView):
    """Payment and transaction management API endpoints."""

    def post(self, path: str):
        if path == "submit_payment_request":
            return self.submit_payment_request()
        return {
            "message": "Only submit_payment_request is permitted with POST",
        }, 405

    def submit_payment_request(self):
        if not g.user:
            return {"message": "User not found", "status": 304}
        if not g.user.micropayments_visible:
            return {"message": "Payments not enabled for your account", "status": 403}
        notes = request.json.get("notes")
        user_task_ids = [
            relation.task_id
            for relation in UserTasks.query.filter_by(user_id=g.user.id).all()
        ]

        user_validated_task_ids = [
            task.id
            for task in Task.query.filter_by(
                org_id=g.user.org_id, validated=True, mapped=True
            ).all()
            if task.id in user_task_ids
        ]
        validator_validated_task_ids = [
            task.id
            for task in Task.query.filter_by(
                org_id=g.user.org_id,
                validated=True,
                mapped=True,
                validated_by=g.user.osm_username,
            ).all()
        ]
        validator_invalidated_task_ids = [
            task.id
            for task in Task.query.filter_by(
                org_id=g.user.org_id,
                invalidated=True,
                mapped=True,
                validated_by=g.user.osm_username,
            ).all()
        ]
        user_name = "%s %s" % (
            g.user.first_name.title(),
            g.user.last_name.title(),
        )
        _pay = PaymentBalanceService.user_balances(g.user)
        if g.user.role == "validator":
            request_amount = (
                _pay["mapping_payable_total"] + _pay["validation_payable_total"]
            )
            request_task_ids = (
                user_validated_task_ids
                + validator_validated_task_ids
                + validator_invalidated_task_ids
            )
        else:
            request_amount = _pay["mapping_payable_total"]
            request_task_ids = user_validated_task_ids
        new_request = PayRequests.create(
            org_id=g.user.org_id,
            amount_requested=request_amount,
            user_id=g.user.id,
            user_name=user_name,
            osm_username=g.user.osm_username,
            payment_email=g.user.payment_email,
            task_ids=request_task_ids,
        )
        if notes:
            new_request.update(notes=notes)
        g.user.update(
            requested_total=request_amount,
        )
        return {
            "message": f"Payment Request {new_request.id} has been submitted",
            "status": 200,
        }
