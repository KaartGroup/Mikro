#!/usr/bin/env python3
"""
Checklist API endpoints for Mikro.

Handles checklist management operations.
"""

from datetime import datetime

from flask.views import MethodView
from flask import g, request

from ..utils import requires_admin, requires_team_admin_or_above
from ..filters import get_user_country_ids, is_visible_by_location
from ..database import (
    Checklist,
    ChecklistCountry,
    ChecklistItem,
    ChecklistComment,
    UserChecklist,
    UserChecklistItem,
    User,
)


class ChecklistAPI(MethodView):
    """Checklist management API endpoints."""

    def post(self, path: str):
        if path == "create_checklist":
            return self.create_checklist()
        elif path == "update_checklist":
            return self.update_checklist()
        elif path == "update_list_items":
            return self.update_list_items()
        elif path == "delete_checklist":
            return self.delete_checklist()
        elif path == "fetch_admin_checklists":
            return self.fetch_admin_checklists()
        elif path == "fetch_user_checklists":
            return self.fetch_user_checklists()
        elif path == "fetch_validator_checklists":
            return self.fetch_validator_checklists()
        elif path == "fetch_checklist_users":
            return self.fetch_checklist_users()

        elif path == "assign_user_checklist":
            return self.assign_user_checklist()

        elif path == "unassign_user_checklist":
            return self.unassign_user_checklist()

        elif path == "start_checklist":
            return self.start_checklist()
        elif path == "complete_list_item":
            return self.complete_list_item()
        elif path == "confirm_list_item":
            return self.confirm_list_item()
        elif path == "add_checklist_comment":
            return self.add_checklist_comment()
        elif path == "delete_checklist_comment":
            return self.delete_checklist_comment()
        elif path == "delete_checklist_item":
            return self.delete_checklist_item()
        elif path == "submit_checklist":
            return self.submit_checklist()
        elif path == "confirm_checklist":
            return self.confirm_checklist()
        elif path == "purge_all_checklists":
            return self.purge_all_checklists()

        return {
            "message": "Only /project/{fetch_users,fetch_user_projects} is permitted with GET",  # noqa: E501
        }, 405

    @requires_admin
    def create_checklist(self):
        response = {}
        # Check if user is authenticated
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        # Check if required data is provided
        checklist_name = request.json.get("checklistName")
        checklist_desc = request.json.get("checklistDescription")
        completion_rate = float(request.json.get("completionRate", 0))
        validation_rate = float(request.json.get("validationRate", 0))
        visibility = request.json.get("visibility")
        difficulty = request.json.get("checklistDifficulty")
        listItems = request.json.get("listItems")
        due_date = request.json.get("dueDate")
        active_status = request.json.get("activeStatus", False)
        assign_user_id = request.json.get("assignUserId")
        required_args = [
            "checklistName",
            "checklistDifficulty",
            "listItems",
        ]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        name = "%s (%s)" % (
            g.user.first_name.capitalize(),
            g.user.osm_username,
        )
        new_checklist = Checklist.create(
            name=checklist_name,
            author=name,
            org_id=g.user.org_id,
            description=checklist_desc,
            completion_rate=completion_rate,
            validation_rate=validation_rate,
            visibility=visibility,
            difficulty=difficulty,
            active_status=active_status,
            due_date=due_date,
        )
        for item in listItems:
            ChecklistItem.create(
                checklist_id=new_checklist.id,
                item_number=item["number"],
                item_action=item["action"],
                item_link=item["link"],
            )

        # If a user was specified, assign them to this checklist
        if assign_user_id:
            target_user = User.query.filter_by(id=assign_user_id).first()
            if target_user:
                target_checklist_items = ChecklistItem.query.filter_by(
                    checklist_id=new_checklist.id
                ).all()
                new_user_checklist = UserChecklist.create(
                    checklist_id=new_checklist.id,
                    user_id=assign_user_id,
                    completed=False,
                    confirmed=False,
                    name=new_checklist.name,
                    author=new_checklist.author,
                    org_id=g.user.org_id,
                    description=new_checklist.description,
                    completion_rate=new_checklist.completion_rate,
                    validation_rate=new_checklist.validation_rate,
                    visibility=new_checklist.visibility,
                    difficulty=new_checklist.difficulty,
                    active_status=False,
                    due_date=new_checklist.due_date,
                )
                for checklist_item in target_checklist_items:
                    UserChecklistItem.create(
                        checklist_id=new_user_checklist.id,
                        user_id=assign_user_id,
                        item_number=checklist_item.item_number,
                        item_action=checklist_item.item_action,
                        item_link=checklist_item.item_link,
                        completed=False,
                        confirmed=False,
                    )

        response["message"] = "%s Created" % (checklist_name)
        response["checklist_id"] = new_checklist.id
        response["status"] = 200
        return response

    @requires_admin
    def update_list_items(self):
        response = {}
        target_user_checklists_ids = []
        # Check if user is authenticated
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        # Check if required data is provided
        checklist_id = request.json.get("checklist_id")
        list_items = request.json.get("list_items")
        delete_list_items = request.json.get("delete_list_items")
        target_checklist = Checklist.query.filter_by(id=int(checklist_id)).first()
        target_user_checklists = [
            checklist
            for checklist in UserChecklist.query.filter_by(
                checklist_id=target_checklist.id
            ).all()
            if checklist.checklist_id == checklist_id
        ]
        if not target_checklist:
            response["message"] = "Checklist %s not found" % (checklist_id)
            response["status"] = 400
            return response
        if delete_list_items is not None:
            for delete_item in delete_list_items:
                target_delete_item = ChecklistItem.query.filter_by(
                    checklist_id=checklist_id,
                    item_number=delete_item["number"],
                ).first()
                if target_delete_item is not None:
                    target_user_checklists_ids = [
                        checklist.id
                        for checklist in UserChecklist.query.filter_by(
                            checklist_id=target_delete_item.checklist_id
                        ).all()
                    ]
                    for id in target_user_checklists_ids:
                        target_user_items = UserChecklistItem.query.filter_by(
                            checklist_id=id,
                            item_number=target_delete_item.item_number,
                        ).all()
                        for item in target_user_items:
                            item.delete(soft=False)

                    target_delete_item.delete(soft=False)
        for i, item in enumerate(list_items):
            target_item = ChecklistItem.query.filter_by(
                checklist_id=checklist_id, item_number=item["number"]
            ).first()

            if target_item:
                target_item.update(
                    item_action=item["action"],
                    item_link=item["link"],
                    item_number=i + 1,
                )
                for checklist in target_user_checklists:
                    item_exists = UserChecklistItem.query.filter_by(
                        checklist_id=checklist.id, item_number=item["number"]
                    ).first()
                    if item_exists:
                        item_exists.update(
                            item_action=item["action"], item_link=item["link"]
                        )
            else:
                ChecklistItem.create(
                    checklist_id=checklist_id,
                    item_number=item["number"],
                    item_action=item["action"],
                    item_link=item["link"],
                )
                for checklist in target_user_checklists:
                    UserChecklistItem.create(
                        user_id=checklist.user_id,
                        checklist_id=checklist.id,
                        item_number=item["number"],
                        item_action=item["action"],
                        item_link=item["link"],
                    )

        if len(target_user_checklists_ids) > 0:
            for id in target_user_checklists_ids:
                all_user_items = (
                    UserChecklistItem.query.filter_by(checklist_id=id)
                    .order_by(UserChecklistItem.item_number)
                    .all()
                )
                for i, entry in enumerate(all_user_items):
                    entry.update(item_number=i + 1)

        all_items = (
            ChecklistItem.query.filter_by(checklist_id=checklist_id)
            .order_by(ChecklistItem.item_number)
            .all()
        )

        for i, entry in enumerate(all_items):
            entry.update(item_number=i + 1)
        response["created"] = True
        response["message"] = "Checklist Items Updated"
        response["status"] = 200
        return response

    @requires_admin
    def update_checklist(self):
        response = {}
        # Check if user is authenticated
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        # Check if required data is provided
        checklist_id = request.json.get("checklistSelected")
        checklist_name = request.json.get("checklistName")
        checklist_desc = request.json.get("checklistDescription")
        difficulty = request.json.get("difficulty")
        completion_rate = float(request.json.get("completionRate"))
        validation_rate = float(request.json.get("validationRate"))
        visibility = request.json.get("visibility")
        active_status = request.json.get("checklistStatus")
        due_date = request.json.get("dueDate")
        if not active_status:
            active_status = False
        else:
            active_status = True
        target_checklist = Checklist.query.filter_by(id=int(checklist_id)).first()
        target_user_checklists = UserChecklist.query.filter_by(
            checklist_id=target_checklist.id
        ).all()
        if not target_checklist:
            response["updated"] = False
            response["message"] = "Checklist %s not found" % (checklist_id)
            response["status"] = 400
            return response
        if checklist_name == "" or checklist_name is None:
            checklist_name = target_checklist.name
        if checklist_desc == "" or checklist_desc is None:
            checklist_desc = target_checklist.description
        if due_date == "" or due_date is None:
            due_date = target_checklist.due_date
        target_checklist.update(
            name=checklist_name,
            description=checklist_desc,
            visibility=visibility,
            difficulty=difficulty,
            active_status=active_status,
            completion_rate=completion_rate,
            validation_rate=validation_rate,
            due_date=due_date,
        )
        for checklist in target_user_checklists:
            checklist.update(
                name=checklist_name,
                description=checklist_desc,
                visibility=visibility,
                difficulty=difficulty,
                active_status=active_status,
                completion_rate=completion_rate,
                validation_rate=validation_rate,
                due_date=due_date,
            )
        response["updated"] = True
        response["message"] = "Checklist Updated"
        response["status"] = 200
        return response

    @requires_admin
    def delete_checklist(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        if not checklist_id:
            return {"message": "checklist_id required", "status": 400}
        target_checklist = Checklist.query.filter_by(
            org_id=g.user.org_id, id=checklist_id
        ).first()
        if not target_checklist:
            response["message"] = "Checklist %s not found" % (checklist_id)
            response["status"] = 400
            return response
        else:
            target_checklist.delete(soft=False)
            response["deleted"] = True
            response["message"] = "Checklist %s deleted" % (checklist_id)
            response["status"] = 200
            return response

    def fetch_checklist_users(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        required_args = ["checklist_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}

        users_in_org = User.query.filter_by(org_id=g.user.org_id).all()

        all_assigned_user_relations = UserChecklist.query.filter_by(
            checklist_id=checklist_id
        ).all()

        assigned_user_ids = [r.user_id for r in all_assigned_user_relations]

        assigned_users = [u for u in users_in_org if u.id in assigned_user_ids]

        unassigned_users = [u for u in users_in_org if u.id not in assigned_user_ids]
        checklist_users = []
        # Loop over each user and extract relevant information
        for user in users_in_org:
            # Capitalize first and last name of the user
            first_name = user.first_name.title()
            last_name = user.last_name.title()
            full_name = first_name + " " + last_name
            if user in assigned_users:
                assigned = "Yes"
            if user in unassigned_users:
                assigned = "No"
            if user.assigned_checklists is not None:
                assigned_checklists_count = len(user.assigned_checklists)
            else:
                assigned_checklists_count = 0
            # Append the user information to the org_users list
            checklist_users.append(
                {
                    "id": user.id,
                    "name": full_name,
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "role": user.role,
                    "joined": user.create_time,
                    "assigned_projects": assigned_checklists_count,
                    "assigned": assigned,
                }
            )
        # Add the list of users to the return_obj dictionary
        response["users"] = checklist_users
        response["status"] = 200
        # Return the final response
        return response

    @requires_team_admin_or_above
    def fetch_admin_checklists(self):
        response = {}

        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        active_checklists = []
        inactive_checklists = []
        ready_for_confirmation = []
        confirmed_and_completed = []
        stale_started_checklists = []

        org_id = g.user.org_id
        org_checklists = Checklist.query.filter_by(org_id=org_id).all()

        # Batch-load location counts for admin display
        _cl_ids = [c.id for c in org_checklists]
        _cc_rows = ChecklistCountry.query.filter(
            ChecklistCountry.checklist_id.in_(_cl_ids)
        ).all() if _cl_ids else []
        _cc_counts = {}
        for r in _cc_rows:
            _cc_counts[r.checklist_id] = _cc_counts.get(r.checklist_id, 0) + 1

        for checklist in org_checklists:
            if checklist.due_date is not None and isinstance(
                checklist.due_date, datetime
            ):
                due_date = checklist.due_date.strftime(
                    "%Y-%m-%d"
                )  # Format as YYYY-MM-DD
            else:
                due_date = "Invalid Date"
            # due_date = str(checklist.due_date).split(" 00:00:00 GMT")[0]
            # due_date = str(due_date).split("00:00:00")[0]
            checklist_obj = {
                "id": checklist.id,
                "name": checklist.name,
                "author": checklist.author,
                "description": checklist.description,
                "due_date": due_date,
                "total_payout": checklist.total_payout,
                "validation_rate": checklist.validation_rate,
                "completion_rate": checklist.completion_rate,
                "difficulty": checklist.difficulty,
                "visibility": checklist.visibility,
                "active_status": checklist.active_status,
                "completed": checklist.completed,
                "confirmed": checklist.confirmed,
                "assigned_locations": _cc_counts.get(checklist.id, 0),
                "list_items": [],
            }
            checklist_items = (
                ChecklistItem.query.filter_by(checklist_id=checklist.id)
                .order_by(ChecklistItem.item_number)
                .all()
            )
            for item in checklist_items:
                item_obj = {
                    "id": item.id,
                    "number": item.item_number,
                    "action": item.item_action,
                    "link": item.item_link,
                }
                checklist_obj["list_items"].append(item_obj)
            if checklist_obj["active_status"]:
                active_checklists.append(checklist_obj)
            else:
                inactive_checklists.append(checklist_obj)

        all_user_checklists = [
            checklist
            for checklist in UserChecklist.query.filter_by(org_id=org_id).all()
            if checklist.user_id is not g.user.id
        ]

        for checklist in all_user_checklists:
            if checklist.due_date is not None and isinstance(
                checklist.due_date, datetime
            ):
                due_date = checklist.due_date.strftime(
                    "%Y-%m-%d"
                )  # Format as YYYY-MM-DD
            else:
                due_date = "Invalid Date"
            # due_date = str(checklist.due_date).split(" 00:00:00 GMT")[0]
            # due_date = str(due_date).split("00:00:00")[0]
            user = User.query.filter_by(id=checklist.user_id).first()
            if user is not None:
                user_name = "%s (%s)" % (
                    user.first_name.capitalize(),
                    user.osm_username,
                )
                stale = False
                try:
                    diff = checklist.last_completion_date - checklist.date_created
                    diff = str(diff).split(":")[0]

                    if diff > 72:
                        stale = True
                except Exception as e:
                    pass
                checklist_obj = {
                    "id": checklist.id,
                    "user_id": checklist.user_id,
                    "name": checklist.name,
                    "user_name": user_name,
                    "author": checklist.author,
                    "stale": stale,
                    "description": checklist.description,
                    "due_date": due_date,
                    "validation_rate": checklist.validation_rate,
                    "completion_rate": checklist.completion_rate,
                    "difficulty": checklist.difficulty,
                    "visibility": checklist.visibility,
                    "active_status": checklist.active_status,
                    "completed": checklist.completed,
                    "confirmed": checklist.confirmed,
                    "list_items": [],
                    "comments": [],
                }
                checklist_items = (
                    UserChecklistItem.query.filter(
                        UserChecklistItem.checklist_id == checklist.id
                    )
                    .order_by(UserChecklistItem.item_number)
                    .all()
                )
                for item in checklist_items:
                    item_obj = {
                        "number": item.item_number,
                        "action": item.item_action,
                        "link": item.item_link,
                        "completed": item.completed,
                        "confirmed": item.confirmed,
                    }
                    checklist_obj["list_items"].append(item_obj)
                checklist_comments = ChecklistComment.query.filter_by(
                    checklist_id=checklist.id
                ).all()
                for comment in checklist_comments:
                    comment_obj = {
                        "id": comment.id,
                        "comment": comment.comment,
                        "author": comment.author,
                        "role": comment.role,
                        "date": comment.date,
                    }
                    checklist_obj["comments"].append(comment_obj)
                if (
                    checklist_obj["completed"]
                    and not checklist_obj["confirmed"]
                    and not checklist_obj["stale"]
                ):
                    ready_for_confirmation.append(checklist_obj)
                elif (
                    checklist_obj["completed"]
                    and checklist_obj["confirmed"]
                    and not checklist_obj["stale"]
                ):
                    confirmed_and_completed.append(checklist_obj)
                elif checklist_obj["stale"]:
                    stale_started_checklists.append(checklist_obj)
        return {
            "active_checklists": active_checklists,
            "inactive_checklists": inactive_checklists,
            "confirmed_and_completed": confirmed_and_completed,
            "ready_for_confirmation": ready_for_confirmation,
            "stale_started_checklists": stale_started_checklists,
            "status": 200,
        }

    def fetch_user_checklists(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        org_id = g.user.org_id
        org_checklists = Checklist.query.filter_by(
            org_id=org_id, active_status=True
        ).all()

        # Location visibility filter for available checklists
        _ucl_cids = get_user_country_ids(g.user.id)
        _cc_all = ChecklistCountry.query.filter(
            ChecklistCountry.checklist_id.in_([c.id for c in org_checklists])
        ).all() if org_checklists else []
        _cl_loc_map = {}
        for r in _cc_all:
            _cl_loc_map.setdefault(r.checklist_id, set()).add(r.country_id)
        org_checklists = [
            c for c in org_checklists
            if is_visible_by_location(_cl_loc_map.get(c.id, set()), _ucl_cids)
        ]

        user_checklists = UserChecklist.query.filter_by(user_id=g.user.id).all()
        user_checklist_ids = [checklist.checklist_id for checklist in user_checklists]
        user_confirmed_checklists = []
        user_completed_checklists = []
        user_started_checklists = []
        user_available_checklists = []
        user_new_checklists = [
            checklist
            for checklist in org_checklists
            if checklist.id not in user_checklist_ids
        ]
        for list in user_checklists, user_new_checklists:
            for checklist in list:
                due_date = str(checklist.due_date).split(" 00:00:00 GMT")[0]
                due_date = str(due_date).split("00:00:00")[0]

                checklist_obj = {
                    "id": checklist.id,
                    "name": checklist.name,
                    "author": checklist.author,
                    "description": checklist.description,
                    "due_date": due_date,
                    "total_payout": checklist.total_payout,
                    "validation_rate": checklist.validation_rate,
                    "completion_rate": checklist.completion_rate,
                    "difficulty": checklist.difficulty,
                    "visibility": checklist.visibility,
                    "active_status": checklist.active_status,
                    "completed": checklist.completed,
                    "confirmed": checklist.confirmed,
                    "list_items": [],
                    "comments": [],
                }
                if checklist in user_checklists:
                    checklist_obj["user_id"] = checklist.user_id
                    checklist_items = (
                        UserChecklistItem.query.filter_by(
                            checklist_id=checklist.id, user_id=g.user.id
                        )
                        .order_by(UserChecklistItem.item_number)
                        .all()
                    )
                    for item in checklist_items:
                        item_obj = {
                            "number": item.item_number,
                            "action": item.item_action,
                            "link": item.item_link,
                            "completed": item.completed,
                            "confirmed": item.confirmed,
                        }
                        checklist_obj["list_items"].append(item_obj)
                    checklist_comments = ChecklistComment.query.filter_by(
                        checklist_id=checklist.id
                    ).all()
                    for comment in checklist_comments:
                        comment_obj = {
                            "id": comment.id,
                            "comment": comment.comment,
                            "author": comment.author,
                            "role": comment.role,
                            "date": comment.date,
                        }
                        checklist_obj["comments"].append(comment_obj)
                else:
                    checklist_items = (
                        ChecklistItem.query.filter_by(checklist_id=checklist.id)
                        .order_by(ChecklistItem.item_number)
                        .all()
                    )
                    for item in checklist_items:
                        item_obj = {
                            "number": item.item_number,
                            "action": item.item_action,
                            "link": item.item_link,
                        }
                        checklist_obj["list_items"].append(item_obj)
                if (
                    not checklist.completed
                    and not checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_started_checklists.append(checklist_obj)
                elif (
                    checklist.completed
                    and not checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_completed_checklists.append(checklist_obj)
                elif (
                    checklist.completed
                    and checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_confirmed_checklists.append(checklist_obj)
                elif (
                    checklist in user_new_checklists
                    and not checklist.completed
                    and not checklist.confirmed
                ):
                    user_available_checklists.append(checklist_obj)
        return {
            "user_started_checklists": user_started_checklists,
            "user_completed_checklists": user_completed_checklists,
            "user_confirmed_checklists": user_confirmed_checklists,
            "user_available_checklists": user_available_checklists,
            "status": 200,
        }

    def fetch_validator_checklists(self):
        response = {}
        ready_for_confirmation = []
        confirmed_and_completed = []
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        org_id = g.user.org_id
        org_checklists = Checklist.query.filter_by(
            org_id=org_id, active_status=True
        ).all()
        user_checklists = UserChecklist.query.filter_by(user_id=g.user.id).all()
        # comment last line in following list comprehension
        # to allow validator to validate own checklists for testing
        all_user_checklists = [
            checklist
            for checklist in UserChecklist.query.filter_by(org_id=org_id).all()
            if checklist.user_id is not g.user.id
        ]
        user_checklist_ids = [checklist.checklist_id for checklist in user_checklists]
        user_confirmed_checklists = []
        user_completed_checklists = []
        user_started_checklists = []
        user_available_checklists = []
        user_new_checklists = [
            checklist
            for checklist in org_checklists
            if checklist.id not in user_checklist_ids
        ]
        for list in user_checklists, user_new_checklists:
            for checklist in list:
                due_date = str(checklist.due_date).split(" 00:00:00 GMT")[0]
                due_date = str(due_date).split("00:00:00")[0]
                checklist_obj = {
                    "id": checklist.id,
                    "name": checklist.name,
                    "author": checklist.author,
                    "description": checklist.description,
                    "due_date": due_date,
                    "total_payout": checklist.total_payout,
                    "validation_rate": checklist.validation_rate,
                    "completion_rate": checklist.completion_rate,
                    "difficulty": checklist.difficulty,
                    "visibility": checklist.visibility,
                    "active_status": checklist.active_status,
                    "completed": checklist.completed,
                    "confirmed": checklist.confirmed,
                    "list_items": [],
                    "comments": [],
                }
                if checklist in user_checklists:
                    checklist_items = (
                        UserChecklistItem.query.filter_by(
                            checklist_id=checklist.id, user_id=g.user.id
                        )
                        .order_by(UserChecklistItem.item_number)
                        .all()
                    )
                    for item in checklist_items:
                        item_obj = {
                            "number": item.item_number,
                            "action": item.item_action,
                            "link": item.item_link,
                            "completed": item.completed,
                            "confirmed": item.confirmed,
                        }
                        checklist_obj["list_items"].append(item_obj)
                    checklist_comments = ChecklistComment.query.filter_by(
                        checklist_id=checklist.id
                    ).all()
                    for comment in checklist_comments:
                        comment_obj = {
                            "id": comment.id,
                            "comment": comment.comment,
                            "author": comment.author,
                            "role": comment.role,
                            "date": comment.date,
                        }
                        checklist_obj["comments"].append(comment_obj)
                else:
                    checklist_items = (
                        ChecklistItem.query.filter_by(checklist_id=checklist.id)
                        .order_by(ChecklistItem.item_number)
                        .all()
                    )
                    for item in checklist_items:
                        item_obj = {
                            "number": item.item_number,
                            "action": item.item_action,
                            "link": item.item_link,
                        }
                        checklist_obj["list_items"].append(item_obj)
                if (
                    not checklist.completed
                    and not checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_started_checklists.append(checklist_obj)
                elif (
                    checklist.completed
                    and not checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_completed_checklists.append(checklist_obj)
                elif (
                    checklist.completed
                    and checklist.confirmed
                    and checklist not in user_new_checklists
                ):
                    user_confirmed_checklists.append(checklist_obj)
                elif (
                    checklist in user_new_checklists
                    and not checklist.completed
                    and not checklist.confirmed
                ):
                    user_available_checklists.append(checklist_obj)

        # USER CHECKLISTS
        for checklist in all_user_checklists:
            due_date = str(checklist.due_date).split(" 00:00:00 GMT")[0]
            due_date = str(due_date).split("00:00:00")[0]
            user = User.query.filter_by(id=checklist.user_id).first()
            user_name = "%s (%s)" % (
                user.first_name.capitalize(),
                user.osm_username,
            )
            checklist_obj = {
                "id": checklist.id,
                "name": checklist.name,
                "user_name": user_name,
                "user_id": user.id,
                "author": checklist.author,
                "description": checklist.description,
                "due_date": due_date,
                "validation_rate": checklist.validation_rate,
                "completion_rate": checklist.completion_rate,
                "difficulty": checklist.difficulty,
                "visibility": checklist.visibility,
                "active_status": checklist.active_status,
                "completed": checklist.completed,
                "confirmed": checklist.confirmed,
                "list_items": [],
                "comments": [],
            }
            checklist_items = (
                UserChecklistItem.query.filter_by(checklist_id=checklist.id)
                .order_by(UserChecklistItem.item_number)
                .all()
            )
            for item in checklist_items:
                item_obj = {
                    "number": item.item_number,
                    "action": item.item_action,
                    "link": item.item_link,
                    "completed": item.completed,
                    "confirmed": item.confirmed,
                }
                checklist_obj["list_items"].append(item_obj)
            checklist_comments = ChecklistComment.query.filter_by(
                checklist_id=checklist.id
            ).all()
            for comment in checklist_comments:
                comment_obj = {
                    "id": comment.id,
                    "comment": comment.comment,
                    "author": comment.author,
                    "role": comment.role,
                    "date": comment.date,
                }
                checklist_obj["comments"].append(comment_obj)

            if (
                checklist_obj["completed"]
                and not checklist_obj["confirmed"]
                # and checklist_obj['id'] not in user_checklist_ids
            ):
                ready_for_confirmation.append(checklist_obj)

            elif (
                checklist_obj["completed"]
                and checklist_obj["confirmed"]
                # and checklist_obj['id'] not in user_checklist_ids
            ):
                confirmed_and_completed.append(checklist_obj)

        return {
            "user_started_checklists": user_started_checklists,
            "user_completed_checklists": user_completed_checklists,
            "user_confirmed_checklists": user_confirmed_checklists,
            "user_available_checklists": user_available_checklists,
            "confirmed_and_completed": confirmed_and_completed,
            "ready_for_confirmation": ready_for_confirmation,
            "status": 200,
        }

    def start_checklist(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        required_args = [
            "checklist_id",
        ]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_checklist = Checklist.query.filter_by(id=checklist_id).first()
        target_checklist_items = ChecklistItem.query.filter_by(
            checklist_id=checklist_id
        ).all()
        new_user_checklist = UserChecklist.query.filter_by(
            user_id=g.user.id, checklist_id=checklist_id
        ).first()
        if not new_user_checklist:
            new_user_checklist = UserChecklist.create(
                checklist_id=checklist_id,
                user_id=g.user.id,
                completed=False,
                confirmed=False,
                name=target_checklist.name,
                author=target_checklist.author,
                org_id=g.user.org_id,
                description=target_checklist.description,
                completion_rate=target_checklist.completion_rate,
                validation_rate=target_checklist.validation_rate,
                visibility=target_checklist.visibility,
                difficulty=target_checklist.difficulty,
                active_status=False,
                due_date=target_checklist.due_date,
            )
        else:
            response["message"] = "Checklist Already Started"
            response["status"] = 200
            return response
        for checklist_item in target_checklist_items:
            UserChecklistItem.create(
                checklist_id=new_user_checklist.id,
                user_id=g.user.id,
                item_number=checklist_item.item_number,
                item_action=checklist_item.item_action,
                item_link=checklist_item.item_link,
                completed=False,
                confirmed=False,
            )
        response["started"] = True
        response["message"] = "Checklist Started"
        response["status"] = 200
        return response

    def complete_list_item(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        item_number = request.json.get("item_number")
        # Use provided user_id or default to logged-in user
        user_id = request.json.get("user_id") or g.user.id
        required_args = ["checklist_id", "item_number"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_user_checklist_item = UserChecklistItem.query.filter_by(
            user_id=user_id,
            checklist_id=checklist_id,
            item_number=item_number,
        ).first()
        target_user_checklist = UserChecklist.query.filter_by(
            user_id=user_id,
            id=checklist_id,
        ).first()
        if not target_user_checklist_item:
            return {
                "message": f"Checklist item not found (checklist={checklist_id}, item={item_number}, user={user_id})",
                "status": 404,
            }
        if not target_user_checklist:
            return {
                "message": f"User checklist not found (id={checklist_id}, user={user_id})",
                "status": 404,
            }
        target_user_checklist_item.update(
            completed=True, completion_date=datetime.now()
        )

        target_user_checklist.update(last_completion_date=datetime.now())
        all_user_checklist_items_completion = [
            item.completed
            for item in UserChecklistItem.query.filter_by(
                user_id=user_id,
                checklist_id=checklist_id,
            ).all()
        ]
        if False not in all_user_checklist_items_completion:
            target_user_checklist.update(
                completed=True, final_completion_date=datetime.now()
            )
            response["checklist_completed"] = True
            response["message"] = "Checklist %s complete!" % (
                target_user_checklist.name
            )
        else:
            response["checklist_completed"] = False
        response["status"] = 200
        return response

    def confirm_list_item(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        item_number = request.json.get("item_number")
        user_id = request.json.get("user_id")
        required_args = ["checklist_id", "item_number", "user_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_user_checklist_item = UserChecklistItem.query.filter_by(
            user_id=user_id,
            checklist_id=checklist_id,
            item_number=item_number,
        ).first()

        target_user_checklist = UserChecklist.query.filter_by(
            user_id=user_id,
            id=checklist_id,
        ).first()

        target_user_checklist_item.update(confirmed=True, confirmed_date=datetime.now())

        target_user_checklist.update(last_confirmation_date=datetime.now())
        all_user_checklist_items_completion = [
            item.confirmed
            for item in UserChecklistItem.query.filter_by(
                user_id=user_id,
                checklist_id=checklist_id,
            ).all()
        ]
        if False not in all_user_checklist_items_completion:
            target_user = User.query.filter_by(id=target_user_checklist.user_id).first()
            target_user_checklist.update(
                confirmed=True, final_confirmation_date=datetime.now()
            )
            checklist_earnings = (
                target_user.checklist_payable_total
                + target_user_checklist.completion_rate
            )
            checklists_total = target_user.total_checklists_completed + 1
            target_user.update(
                checklist_payable_total=checklist_earnings,
                total_checklists_complete=checklists_total,
            )
            response["checklist_confirmed"] = True
            response["message"] = "Checklist %s confirmed!" % (
                target_user_checklist.name
            )
        else:
            response["checklist_confirmed"] = False
        response["status"] = 200
        return response

    def add_checklist_comment(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        comment = request.json.get("comment")
        required_args = ["checklist_id", "comment"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        author_name = "%s(%s)" % (
            g.user.first_name,
            g.user.osm_username,
        )
        ChecklistComment.create(
            checklist_id=checklist_id,
            author=author_name,
            comment=comment,
            role=g.user.role,
        )
        response["message"] = "comment added"
        response["comment_added"] = True
        response["status"] = 200
        return response

    def delete_checklist_comment(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        comment_id = request.json.get("comment_id")
        required_args = ["comment_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_comment = ChecklistComment.query.filter_by(id=comment_id).first()
        target_comment.delete(soft=False)
        response["message"] = "comment deleted"
        response["comment_deleted"] = True
        response["status"] = 200
        return response

    def delete_checklist_item(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        item_id = request.json.get("item_id")
        checklist_id = request.json.get("checklist_id")
        required_args = ["item_id", "checklist_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_item = ChecklistItem.query.filter_by(id=item_id).first()

        target_user_checklists_ids = [
            checklist.id
            for checklist in UserChecklist.query.filter_by(
                checklist_id=target_item.checklist_id
            ).all()
        ]

        for id in target_user_checklists_ids:
            target_user_items = UserChecklistItem.query.filter_by(
                checklist_id=id, item_number=target_item.item_number
            ).all()

            for item in target_user_items:
                item.delete(soft=False)

            all_user_items = (
                UserChecklistItem.query.filter_by(checklist_id=id)
                .order_by(ChecklistItem.item_number)
                .all()
            )

            for i, entry in enumerate(all_user_items):
                entry.update(index=i)

        target_item.delete(soft=False)

        all_items = (
            ChecklistItem.query.filter_by(checklist_id=checklist_id)
            .order_by(ChecklistItem.item_number)
            .all()
        )

        for i, entry in enumerate(all_items):
            entry.update(index=i)
        response["message"] = "list item deleted"
        response["item_deleted"] = True
        response["status"] = 200
        return response

    def assign_user_checklist(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        user_id = request.json.get("user_id")
        required_args = ["checklist_id", "user_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_user = User.query.filter_by(id=user_id).first()
        target_checklist = Checklist.query.filter_by(id=checklist_id).first()
        target_checklist_items = ChecklistItem.query.filter_by(
            checklist_id=checklist_id
        ).all()
        new_user_checklist = UserChecklist.query.filter_by(
            user_id=user_id, checklist_id=checklist_id
        ).first()
        if not new_user_checklist:
            new_user_checklist = UserChecklist.create(
                checklist_id=checklist_id,
                user_id=user_id,
                completed=False,
                confirmed=False,
                name=target_checklist.name,
                author=target_checklist.author,
                org_id=g.user.org_id,
                description=target_checklist.description,
                completion_rate=target_checklist.completion_rate,
                validation_rate=target_checklist.validation_rate,
                visibility=target_checklist.visibility,
                difficulty=target_checklist.difficulty,
                active_status=False,
                due_date=target_checklist.due_date,
            )
        else:
            response["message"] = "Checklist Already Started"
            response["status"] = 200
            return response

        for checklist_item in target_checklist_items:
            UserChecklistItem.create(
                checklist_id=new_user_checklist.id,
                user_id=user_id,
                item_number=checklist_item.item_number,
                item_action=checklist_item.item_action,
                item_link=checklist_item.item_link,
                completed=False,
                confirmed=False,
            )
        response["started"] = True
        response["message"] = "%s has been assigned to %s" % (
            target_user.osm_username,
            target_checklist.name,
        )
        response["status"] = 200
        return response

    def unassign_user_checklist(self):
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response
        checklist_id = request.json.get("checklist_id")
        user_id = request.json.get("user_id")
        required_args = ["checklist_id", "user_id"]
        for arg in required_args:
            if not request.json.get(arg):
                return {"message": f"{arg} required", "status": 400}
        target_user = User.query.filter_by(id=user_id).first()
        target_checklist = Checklist.query.filter_by(id=checklist_id).first()

        user_checklist = UserChecklist.query.filter_by(
            user_id=user_id, checklist_id=target_checklist.id
        ).first()
        if not user_checklist:
            response["message"] = "Checklist not found"
            response["status"] = 400
            return response
        user_checklist_items = UserChecklistItem.query.filter_by(
            checklist_id=user_checklist.id, user_id=user_id
        ).all()
        if not user_checklist_items:
            response["message"] = "Checklist items not found"
            response["status"] = 400
            return response
        for checklist_item in user_checklist_items:
            checklist_item.delete(soft=False)
        user_checklist.delete(soft=False)
        response["unassigned"] = True
        response["message"] = "%s has been unassigned from %s" % (
            target_user.osm_username,
            target_checklist.name,
        )
        response["status"] = 200
        return response

    def submit_checklist(self):
        """Mark a user's checklist as completed/submitted for review."""
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        checklist_id = request.json.get("checklist_id")
        if not checklist_id:
            return {"message": "checklist_id required", "status": 400}

        # Find the user's checklist
        target_user_checklist = UserChecklist.query.filter_by(
            id=checklist_id, user_id=g.user.id
        ).first()

        if not target_user_checklist:
            return {"message": "Checklist not found", "status": 404}

        # Check all items are completed
        all_items = UserChecklistItem.query.filter_by(
            checklist_id=checklist_id, user_id=g.user.id
        ).all()

        incomplete_items = [item for item in all_items if not item.completed]
        if incomplete_items:
            return {
                "message": "All checklist items must be completed before submitting",
                "status": 400,
            }

        # Mark as completed (submitted for review)
        target_user_checklist.update(
            completed=True, final_completion_date=datetime.now()
        )

        response["submitted"] = True
        response["message"] = "Checklist submitted for review"
        response["status"] = 200
        return response

    def confirm_checklist(self):
        """Confirm/approve a completed checklist (admin/validator action)."""
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        checklist_id = request.json.get("checklist_id")
        user_id = request.json.get("user_id")

        if not checklist_id:
            return {"message": "checklist_id required", "status": 400}

        # Find the user's checklist - use id field not checklist_id
        target_user_checklist = UserChecklist.query.filter_by(id=checklist_id).first()

        if not target_user_checklist:
            return {"message": "Checklist not found", "status": 404}

        # If user_id is provided, verify it matches (for extra safety)
        if user_id and target_user_checklist.user_id != user_id:
            return {"message": "Checklist user mismatch", "status": 400}

        # Check that checklist is completed before confirming
        if not target_user_checklist.completed:
            return {
                "message": "Checklist must be completed before confirmation",
                "status": 400,
            }

        # Mark all items as confirmed
        all_items = UserChecklistItem.query.filter_by(
            checklist_id=checklist_id, user_id=target_user_checklist.user_id
        ).all()

        for item in all_items:
            item.update(confirmed=True, confirmed_date=datetime.now())

        # Mark checklist as confirmed
        target_user_checklist.update(
            confirmed=True,
            final_confirmation_date=datetime.now(),
            last_confirmation_date=datetime.now(),
        )

        # Award earnings to the user
        target_user = User.query.filter_by(id=target_user_checklist.user_id).first()
        if target_user:
            checklist_earnings = (
                target_user.checklist_payable_total
                + target_user_checklist.completion_rate
            )
            checklists_total = target_user.total_checklists_completed + 1
            target_user.update(
                checklist_payable_total=checklist_earnings,
                total_checklists_complete=checklists_total,
            )

        response["confirmed"] = True
        response["message"] = "Checklist %s confirmed!" % target_user_checklist.name
        response["status"] = 200
        return response

    @requires_admin
    def purge_all_checklists(self):
        """DEV ONLY: Purge all checklists and reset related user stats."""
        response = {}
        if not g:
            response["message"] = "User not found"
            response["status"] = 304
            return response

        org_id = g.user.org_id

        # Delete all user checklist items
        user_checklist_items = UserChecklistItem.query.filter(
            UserChecklistItem.checklist_id.in_(
                [uc.id for uc in UserChecklist.query.filter_by(org_id=org_id).all()]
            )
        ).all()
        for item in user_checklist_items:
            item.delete(soft=False)

        # Delete all user checklists
        user_checklists = UserChecklist.query.filter_by(org_id=org_id).all()
        for uc in user_checklists:
            uc.delete(soft=False)

        # Delete all checklist comments
        checklist_ids = [c.id for c in Checklist.query.filter_by(org_id=org_id).all()]
        comments = ChecklistComment.query.filter(
            ChecklistComment.checklist_id.in_(checklist_ids)
        ).all()
        for comment in comments:
            comment.delete(soft=False)

        # Delete all checklist items
        for cid in checklist_ids:
            items = ChecklistItem.query.filter_by(checklist_id=cid).all()
            for item in items:
                item.delete(soft=False)

        # Delete all checklists
        checklists = Checklist.query.filter_by(org_id=org_id).all()
        checklists_deleted = len(checklists)
        for checklist in checklists:
            checklist.delete(soft=False)

        # Reset user checklist stats
        users = User.query.filter_by(org_id=org_id).all()
        users_reset = 0
        for user in users:
            user.update(
                checklist_payable_total=0,
                total_checklists_completed=0,
            )
            users_reset += 1

        response["message"] = "All checklists purged"
        response["checklists_deleted"] = checklists_deleted
        response["users_reset"] = users_reset
        response["status"] = 200
        return response
