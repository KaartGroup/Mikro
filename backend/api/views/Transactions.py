#!/usr/bin/env python3
"""
Transaction API endpoints for Mikro.

Handles payment and transaction operations.
"""

from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin, requires_team_admin_or_above
from ..auth import (
    is_org_admin_or_above,
    managed_team_ids_for,
    team_admin_can_access_user,
    team_member_ids_for,
)
from ..database import db, User, PayRequests, Payments, UserTasks, Task, Project
from ..stats import get_user_payment_balances


class TransactionAPI(MethodView):
    """Payment and transaction management API endpoints."""

    def post(self, path: str):
        if path == "fetch_org_transactions":
            return self.fetch_org_transactions()
        if path == "fetch_user_transactions":
            return self.fetch_user_transactions()
        elif path == "create_transaction":
            return self.create_transaction()
        elif path == "delete_transaction":
            return self.delete_transaction()
        elif path == "process_payment_request":
            return self.process_payment_request()
        elif path == "fetch_user_payable":
            return self.fetch_user_payable()
        elif path == "submit_payment_request":
            return self.submit_payment_request()
        elif path == "fetch_payment_request_details":
            return self.fetch_payment_request_details()
        elif path == "archive_transaction":
            return self.archive_transaction()
        elif path == "fetch_archived_transactions":
            return self.fetch_archived_transactions()
        elif path == "purge_all_transactions":
            return self.purge_all_transactions()
        return {
            "message": "Only /project/{fetch_users,fetch_user_projects} is permitted with GET",  # noqa: E501
        }, 405

    @requires_team_admin_or_above
    def fetch_org_transactions(self):
        # Check if user is logged in
        if not g.user:
            return {"message": "User not found", "status": 304}

        # team_admin: narrow to pay rows for users on managed teams only.
        # Empty managed → empty result.
        managed_user_ids = None
        if g.user.role == "team_admin":
            managed = managed_team_ids_for(g.user)
            if not managed:
                return {
                    "message": "Payments and requests found",
                    "requests": [],
                    "payments": [],
                    "status": 200,
                }
            managed_user_ids = team_member_ids_for(managed)
            if not managed_user_ids:
                return {
                    "message": "Payments and requests found",
                    "requests": [],
                    "payments": [],
                    "status": 200,
                }

        # Get all payment requests and payments for the user's organization
        req_query = PayRequests.query.filter_by(org_id=g.user.org_id)
        pay_query = Payments.query.filter_by(org_id=g.user.org_id)
        if managed_user_ids is not None:
            req_query = req_query.filter(PayRequests.user_id.in_(managed_user_ids))
            pay_query = pay_query.filter(Payments.user_id.in_(managed_user_ids))
        org_payment_requests = req_query.all()
        org_payments_made = pay_query.all()
        # Create a list of dictionaries containing payment request information
        requests = [
            {
                "id": request.id,
                "amount_requested": request.amount_requested,
                "user": request.user_name,
                "osm_username": request.osm_username,
                "user_id": request.user_id,
                "payment_email": request.payment_email,
                "task_ids": request.task_ids,
                "date_requested": request.date_requested,
                "notes": request.notes,
            }
            for request in org_payment_requests
        ]
        # Create a list of dictionaries containing payment information
        payments = [
            {
                "id": payment.id,
                "payoneer_id": payment.payoneer_id,
                "amount_paid": payment.amount_paid,
                "user": payment.user_name,
                "osm_username": payment.osm_username,
                "user_id": payment.user_id,
                "payment_email": payment.payment_email,
                "task_ids": payment.task_ids,
                "date_paid": payment.date_paid,
                "notes": payment.notes,
            }
            for payment in org_payments_made
        ]
        # Return the list of payment requests and payments along with a success message  # noqa: E501
        return {
            "message": "Payments and requests found",  # noqa: E501
            "requests": requests,
            "payments": payments,
            "status": 200,
        }

    def fetch_user_transactions(self):
        # Check if user is logged in
        if not g.user:
            return {"message": "User not found", "status": 304}
        # Get all payment requests and payments for the user's organization
        org_payment_requests = PayRequests.query.filter_by(
            org_id=g.user.org_id, user_id=g.user.id
        ).all()
        org_payments_made = Payments.query.filter_by(
            org_id=g.user.org_id, user_id=g.user.id
        ).all()
        # Create a list of dictionaries containing payment request information
        requests = [
            {
                "id": request.id,
                "amount_requested": request.amount_requested,
                "user": request.user_name,
                "user_id": request.user_id,
                "payment_email": request.payment_email,
                "task_ids": request.task_ids,
                "date_requested": request.date_requested,
                "notes": request.notes,
            }
            for request in org_payment_requests
        ]
        # Create a list of dictionaries containing payment information
        payments = [
            {
                "id": payment.id,
                "payoneer_id": payment.payoneer_id,
                "amount_paid": payment.amount_paid,
                "user": payment.user_name,
                "user_id": payment.user_id,
                "payment_email": payment.payment_email,
                "task_ids": payment.task_ids,
                "date_paid": payment.date_paid,
                "notes": payment.notes,
            }
            for payment in org_payments_made
        ]
        # Return the list of payment requests and payments along with a success message  # noqa: E501
        return {
            "message": "Payments and requests found",  # noqa: E501
            "requests": requests,
            "payments": payments,
            "status": 200,
        }

    @requires_team_admin_or_above
    def create_transaction(self):
        # Check if user is authenticated
        if not g.user:
            return {"message": "User not found", "status": 304}
        # Get required fields from request payload
        user_id = request.json.get("user_id")
        task_ids = request.json.get("task_ids")
        amount = request.json.get("amount")
        transaction_type = request.json.get("transaction_type")
        # Validate required fields
        if not all([user_id, task_ids, amount, transaction_type]):
            return {"message": "All fields are required", "status": 400}
        target_user = User.query.filter_by(
            org_id=g.user.org_id, id=user_id
        ).first()
        if not target_user:
            return {"message": "User %s not found" % (user_id), "status": 400}

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}
        # Create username from first_name and last_name
        user_name = "%s %s" % (
            target_user.first_name.title(),
            target_user.last_name.title(),
        )
        payment_email = target_user.payment_email
        # Split task_ids by comma and convert to int list
        task_ids = [int(id) for id in task_ids.split(",")]
        # Create transaction based on type
        if transaction_type == "request":
            amount_requested = float(amount)
            PayRequests.create(
                org_id=g.user.org_id,
                amount_requested=amount_requested,
                user_name=user_name,
                user_id=user_id,
                payment_email=payment_email,
                task_ids=task_ids,
            )
        return {"message": "Transaction created", "status": 200}

    @requires_admin
    def delete_transaction(self):
        # Check if user is authenticated
        if not g.user:
            return {"message": "User not found", "status": 304}
        # Get transaction_id from request payload
        transaction_id = request.json.get("transaction_id")
        if not transaction_id:
            return {"message": "transaction_id required", "status": 400}
        # Get transaction_type from request payload
        transaction_type = request.json.get("transaction_type")
        if not transaction_type:
            return {"message": "transaction_type required", "status": 400}
        # Delete transaction based on type and ID
        if transaction_type == "request":
            target_request = PayRequests.query.filter_by(
                id=transaction_id
            ).first()
            if not target_request:
                return {
                    "message": f"Request {transaction_id} not found",
                    "status": 400,
                }
            target_request.delete(soft=False)
            return {
                "message": f"Request {transaction_id} deleted",
                "status": 200,
            }
        else:
            target_payment = Payments.query.filter_by(
                id=transaction_id
            ).first()
            if not target_payment:
                return {
                    "message": f"Payment {transaction_id} not found",
                    "status": 400,
                }
            target_payment.delete(soft=False)
            return {
                "message": f"Payment {transaction_id} deleted",
                "status": 200,
            }

    @requires_team_admin_or_above
    def process_payment_request(self):
        if not g.user:
            return {"message": "User not found", "status": 304}
        # Get required fields from request payload
        request_id = request.json.get("request_id")
        user_id = request.json.get("user_id")
        task_ids = request.json.get("task_ids", [])
        request_amount = request.json.get("request_amount")
        payoneer_id = request.json.get("payoneer_id", "")
        notes = request.json.get("notes")
        # Validate required fields (task_ids can be empty, payoneer_id optional)
        if request_id is None or user_id is None or request_amount is None:
            return {"message": "request_id, user_id, and request_amount are required", "status": 400}
        # Ensure request_amount is a float and greater than 0
        try:
            request_amount = float(request_amount)
        except (TypeError, ValueError):
            return {"message": f"Invalid request_amount: {request_amount}", "status": 400}
        if request_amount <= 0:
            return {"message": f"request_amount must be greater than 0, got: {request_amount}", "status": 400}

        # team_admin: target user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, user_id):
                return {"message": "Not in your managed teams", "status": 403}

        # task_ids = str(task_ids).split()
        target_user = User.query.filter_by(
            org_id=g.user.org_id, id=user_id
        ).first()
        user_name = "%s %s" % (
            target_user.first_name.title(),
            target_user.last_name.title(),
        )
        payment_email = target_user.payment_email
        target_request = PayRequests.query.filter_by(
            org_id=g.user.org_id, id=request_id
        ).first()
        if not target_request:
            return {"message": "Payment Request %s not found", "status": 400}
        # Store the requesting user's osm_username before deleting the request
        requester_osm_username = target_request.osm_username
        target_request.delete(soft=False)
        new_payment = Payments.create(
            user_name=user_name,
            osm_username=requester_osm_username,
            user_id=user_id,
            org_id=g.user.org_id,
            amount_paid=request_amount,
            payoneer_id=payoneer_id,
            payment_email=payment_email,
            task_ids=task_ids,
        )
        if notes:
            new_payment.update(notes=notes)
        return {
            "message": f"Payment Request {request_id} has been processed",
            "status": 200,
        }

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
        _pay = get_user_payment_balances(g.user)
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

    def fetch_user_payable(self):
        if not g.user:
            return {"message": "User not found", "status": 304}
        target_user = User.query.filter_by(id=g.user.id).first()
        if not target_user:
            return {"message": "User not found", "status": 400}
        _pay = get_user_payment_balances(target_user)
        mapping_payable_total = _pay["mapping_payable_total"]
        validation_payable_total = _pay["validation_payable_total"]
        checklist_payable_total = target_user.checklist_payable_total
        payable_total = (
            mapping_payable_total
            + validation_payable_total
            + checklist_payable_total
        )
        return {
            "message": "payable total fetched",
            "checklist_earnings": checklist_payable_total,
            "mapping_earnings": mapping_payable_total,
            "validation_earnings": validation_payable_total,
            "payable_total": payable_total,
            "status": 200,
        }

    @requires_team_admin_or_above
    def fetch_payment_request_details(self):
        """
        Fetch detailed breakdown of tasks for a payment request.

        Returns tasks grouped by project with earnings breakdown.
        Useful for admin review before approving payment.
        """
        if not g.user:
            return {"message": "User not found", "status": 304}

        request_id = request.json.get("request_id")
        if not request_id:
            return {"message": "request_id required", "status": 400}

        # Get the payment request
        pay_request = PayRequests.query.filter_by(
            org_id=g.user.org_id, id=request_id
        ).first()

        if not pay_request:
            return {"message": f"Payment request {request_id} not found", "status": 404}

        # team_admin: requesting user must be on a managed team
        if not is_org_admin_or_above(g.user):
            if not team_admin_can_access_user(g.user, pay_request.user_id):
                return {"message": "Not in your managed teams", "status": 403}

        task_ids = pay_request.task_ids or []
        if not task_ids:
            return {
                "message": "No tasks found for this request",
                "request_id": request_id,
                "projects": [],
                "summary": {
                    "total_tasks": 0,
                    "mapping_earnings": 0,
                    "validation_earnings": 0,
                    "total_earnings": 0,
                },
                "status": 200,
            }

        # Fetch all tasks for this request
        tasks = Task.query.filter(Task.id.in_(task_ids)).all()

        # Get the user who made the request
        request_user = User.query.filter_by(id=pay_request.user_id).first()
        request_osm_username = request_user.osm_username if request_user else None

        # Group tasks by project
        projects_map = {}
        total_mapping = 0.0
        total_validation = 0.0

        for task in tasks:
            project_id = task.project_id
            if project_id not in projects_map:
                project = Project.query.filter_by(id=project_id).first()
                projects_map[project_id] = {
                    "project_id": project_id,
                    "project_name": project.name if project else f"Project {project_id}",
                    "project_short_name": (project.short_name or "") if project else "",
                    "project_url": project.url if project else None,
                    "tasks": [],
                    "mapping_count": 0,
                    "validation_count": 0,
                    "mapping_earnings": 0.0,
                    "validation_earnings": 0.0,
                }

            # Determine if this is a mapping or validation earning for the requester
            is_mapper = task.mapped_by == request_osm_username
            is_validator = task.validated_by == request_osm_username

            task_info = {
                "task_id": task.task_id,  # TM4 task ID
                "internal_id": task.id,
                "mapped_by": task.mapped_by,
                "validated_by": task.validated_by,
                "mapping_rate": task.mapping_rate or 0,
                "validation_rate": task.validation_rate or 0,
                "validated": task.validated,
                "invalidated": task.invalidated,
                "is_mapping_earning": is_mapper and task.validated,
                "is_validation_earning": is_validator,
            }

            projects_map[project_id]["tasks"].append(task_info)

            # Calculate earnings
            if is_mapper and task.validated:
                projects_map[project_id]["mapping_count"] += 1
                projects_map[project_id]["mapping_earnings"] += task.mapping_rate or 0
                total_mapping += task.mapping_rate or 0

            if is_validator:
                projects_map[project_id]["validation_count"] += 1
                projects_map[project_id]["validation_earnings"] += task.validation_rate or 0
                total_validation += task.validation_rate or 0

        # Convert to list and sort by project name
        projects_list = sorted(
            projects_map.values(),
            key=lambda x: x["project_name"]
        )

        return {
            "message": "Payment request details fetched",
            "request_id": request_id,
            "user_name": pay_request.user_name,
            "osm_username": pay_request.osm_username,
            "amount_requested": pay_request.amount_requested,
            "date_requested": pay_request.date_requested.isoformat() if pay_request.date_requested else None,
            "payment_email": pay_request.payment_email,
            "notes": pay_request.notes,
            "projects": projects_list,
            "summary": {
                "total_tasks": len(tasks),
                "total_projects": len(projects_list),
                "mapping_earnings": total_mapping,
                "validation_earnings": total_validation,
                "total_earnings": total_mapping + total_validation,
            },
            "status": 200,
        }

    @requires_admin
    def archive_transaction(self):
        """Archive a payment record (soft delete) so it can be retrieved later."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        transaction_id = request.json.get("transaction_id")
        transaction_type = request.json.get("transaction_type")

        if not transaction_id:
            return {"message": "transaction_id required", "status": 400}
        if not transaction_type:
            return {"message": "transaction_type required", "status": 400}

        if transaction_type == "request":
            target = PayRequests.query.filter_by(id=transaction_id).first()
        else:
            target = Payments.query.filter_by(id=transaction_id).first()

        if not target:
            return {"message": f"{transaction_type} {transaction_id} not found", "status": 400}

        # Soft delete (sets deleted_date)
        target.delete(soft=True)

        return {
            "message": f"{transaction_type.capitalize()} {transaction_id} archived",
            "status": 200,
        }

    @requires_admin
    def fetch_archived_transactions(self):
        """Fetch archived (soft-deleted) transactions."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        # Use with_deleted() to include soft-deleted records, then filter
        archived_requests = [
            req for req in PayRequests.query.with_deleted().filter_by(org_id=g.user.org_id).all()
            if req.deleted_date is not None
        ]
        archived_payments = [
            pay for pay in Payments.query.with_deleted().filter_by(org_id=g.user.org_id).all()
            if pay.deleted_date is not None
        ]

        requests_list = [
            {
                "id": req.id,
                "amount_requested": req.amount_requested,
                "user": req.user_name,
                "osm_username": req.osm_username,
                "user_id": req.user_id,
                "payment_email": req.payment_email,
                "task_ids": req.task_ids,
                "date_requested": req.date_requested,
                "notes": req.notes,
                "archived_date": req.deleted_date.isoformat() if req.deleted_date else None,
            }
            for req in archived_requests
        ]

        payments_list = [
            {
                "id": pay.id,
                "payoneer_id": pay.payoneer_id,
                "amount_paid": pay.amount_paid,
                "user": pay.user_name,
                "osm_username": pay.osm_username,
                "user_id": pay.user_id,
                "payment_email": pay.payment_email,
                "task_ids": pay.task_ids,
                "date_paid": pay.date_paid,
                "notes": pay.notes,
                "archived_date": pay.deleted_date.isoformat() if pay.deleted_date else None,
            }
            for pay in archived_payments
        ]

        return {
            "message": "Archived transactions found",
            "archived_requests": requests_list,
            "archived_payments": payments_list,
            "status": 200,
        }

    @requires_admin
    def purge_all_transactions(self):
        """DEV ONLY: Purge all transactions and reset related user stats."""
        if not g.user:
            return {"message": "User not found", "status": 304}

        org_id = g.user.org_id

        # Hard delete all pay requests
        all_requests = PayRequests.query.filter_by(org_id=org_id).all()
        requests_deleted = len(all_requests)
        for req in all_requests:
            db.session.delete(req)

        # Hard delete all payments
        all_payments = Payments.query.filter_by(org_id=org_id).all()
        payments_deleted = len(all_payments)
        for pay in all_payments:
            db.session.delete(pay)

        db.session.flush()

        # Reset user payment stats
        users = User.query.filter_by(org_id=org_id).all()
        users_reset = 0
        for user in users:
            user.update(
                payable_total=0,
                mapping_payable_total=0,
                validation_payable_total=0,
                checklist_payable_total=0,
                requested_total=0,
                paid_total=0,
                requesting_payment=False,
            )
            users_reset += 1

        return {
            "message": "All transactions purged",
            "requests_deleted": requests_deleted,
            "payments_deleted": payments_deleted,
            "users_reset": users_reset,
            "status": 200,
        }
