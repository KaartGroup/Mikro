#!/usr/bin/env python3
# flake8: noqa
from .Login import LoginAPI
from .Users import UserAPI
from .Projects import ProjectAPI
from .Transactions import TransactionAPI
from .Tasks import TaskAPI
from .Training import TrainingAPI
from .Checklists import ChecklistAPI
from .OSMAuth import OSMAuthAPI
from .TimeTracking import TimeTrackingAPI
from .Teams import TeamAPI
from .reports import ReportsAPI
from .Regions import RegionAPI
from .Webhook import WebhookAPI
from .Punks import PunkAPI
from .WeeklyReport import WeeklyReportAPI
from .Friends import FriendAPI
from .CommunityData import CommunityDataAPI
from .ChannelMonitor import ChannelMonitorAPI
from .Transcription import TranscriptionAPI

__all__ = {
    "UserAPI",
    "LoginAPI",
    "ProjectAPI",
    "TransactionAPI",
    "TaskAPI",
    "TrainingAPI",
    "ChecklistAPI",
    "OSMAuthAPI",
    "TimeTrackingAPI",
    "TeamAPI",
    "ReportsAPI",
    "RegionAPI",
    "WebhookAPI",
    "PunkAPI",
    "WeeklyReportAPI",
    "FriendAPI",
    "CommunityDataAPI",
    "ChannelMonitorAPI",
    "TranscriptionAPI",
}
