#!/usr/bin/env python3
# flake8: noqa
from .Login import LoginAPI
from .Users import UserAPI
from .Projects import ProjectAPI
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
from .WeeklyReport import WeeklyReportAPI
from .Friends import FriendAPI
from .CommunityData import CommunityDataAPI
from .ChannelMonitor import ChannelMonitorAPI
from .Organizations import OrganizationAPI
from .HourlyRates import HourlyRatesAPI

__all__ = {
    "UserAPI",
    "LoginAPI",
    "ProjectAPI",
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
    "WeeklyReportAPI",
    "FriendAPI",
    "CommunityDataAPI",
    "ChannelMonitorAPI",
    "OrganizationAPI",
    "HourlyRatesAPI",
}
