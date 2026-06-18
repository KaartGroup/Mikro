#!/usr/bin/env python3
# flake8: noqa
from .Login import LoginAPI
from .Users import UserAPI
from .Projects import ProjectAPI
from .ProjectTrainings import ProjectTrainingAPI
from .Dashboard import DashboardAPI
from .Transactions import TransactionAPI
from .Tasks import TaskAPI
from .Training import TrainingAPI
from .OSMAuth import OSMAuthAPI
from .TimeTracking import TimeTrackingAPI
from .Teams import TeamAPI
from .reports import ReportsAPI
from .Payments import PaymentsAPI
from .Reimbursements import ReimbursementsAPI
from .Regions import RegionAPI
from .Webhook import WebhookAPI
from .Punks import PunkAPI
from .Friends import FriendAPI
from .Organizations import OrganizationAPI
from .HourlyRates import HourlyRatesAPI
from .Comms import CommsAPI
from .Events import EventsAPI
from .Feedback import FeedbackAPI

__all__ = {
    "UserAPI",
    "LoginAPI",
    "ProjectAPI",
    "ProjectTrainingAPI",
    "DashboardAPI",
    "TransactionAPI",
    "TaskAPI",
    "TrainingAPI",
    "OSMAuthAPI",
    "TimeTrackingAPI",
    "TeamAPI",
    "PaymentsAPI",
    "ReimbursementsAPI",
    "ReportsAPI",
    "RegionAPI",
    "WebhookAPI",
    "PunkAPI",
    "FriendAPI",
    "OrganizationAPI",
    "HourlyRatesAPI",
    "CommsAPI",
    "EventsAPI",
    "FeedbackAPI",
}
