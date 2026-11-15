"""Tests for reminders before calendar events (reminders.py)."""
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from homeassistant.components.calendar import CalendarEvent
from homeassistant.core import ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.family_planner.reminders import (
    FamilyPlannerReminders,
    ReminderTarget,
    due_reminders,
    lead_minutes,
    reminder_targets,
)

UTC = dt_util.UTC
NOW = datetime(2026, 11, 15, 16, 0, tzinfo=UTC)
LEAD = timedelta(minutes=30)


def _event(start: datetime | date, summary="Fotboll", uid="e1", **kwargs) -> CalendarEvent:
    end = start + timedelta(hours=1) if isinstance(start, datetime) else start + timedelta(days=1)
    return CalendarEvent(start=start, end=end, summary=summary, uid=uid, **kwargs)


TARGET = ReminderTarget("calendar.anna", "mobile_app_anna", "Anna")


# ---- lead_minutes ----


def test_lead_minutes_defaults_to_off():
    assert lead_minutes({}) == 0
    assert lead_minutes({"reminders": {"minutes_before": "x"}}) == 0
    assert lead_minutes({"reminders": {"minutes_before": -5}}) == 0
    assert lead_minutes({"reminders": {"minutes_before": 30}}) == 30


# ---- reminder_targets ----


def test_targets_only_for_persons_with_a_notify_service():
    config = {
        "persons": [
            {"name": "Anna", "calendar_entity": "calendar.anna", "notify_service": "notify.mobile_app_anna"},
            {"name": "Olle", "calendar_entity": "calendar.olle"},
        ]
    }
    assert reminder_targets(config) == [ReminderTarget("calendar.anna", "mobile_app_anna", "Anna")]


def test_targets_include_work_and_linked_shared_calendars_but_not_unlinked_ones():
    config = {
        "persons": [
            {
                "name": "Anna",
                "calendar_entity": "calendar.anna",
                "notify_service": "mobile_app_anna",
                "work_calendars": [{"entity": "calendar.jobb"}],
            }
        ],
        "calendars": [
            {"entity": "calendar.fotboll", "persons": ["Anna"]},
            {"entity": "calendar.familj"},
        ],
    }
    assert [t.calendar_entity for t in reminder_targets(config)] == [
        "calendar.anna",
        "calendar.jobb",
        "calendar.fotboll",
    ]


# ---- due_reminders ----


def test_due_inside_the_lead_window():
    events = {"calendar.anna": [_event(NOW + timedelta(minutes=30), location="Lilla planen")]}
    due = due_reminders(events, [TARGET], NOW, LEAD, set())
    assert len(due) == 1
    assert due[0].notify_service == "mobile_app_anna"
    assert due[0].title == "Om 30 min: Fotboll"
    assert "Lilla planen" in due[0].message


def test_not_due_before_the_window_or_after_start():
    events = {
        "calendar.anna": [
            _event(NOW + timedelta(minutes=31), uid="later"),
            _event(NOW, uid="started"),
            _event(NOW - timedelta(minutes=10), uid="past"),
        ]
    }
    assert due_reminders(events, [TARGET], NOW, LEAD, set()) == []


def test_all_day_events_are_skipped():
    events = {"calendar.anna": [_event(NOW.date() + timedelta(days=1))]}
    assert due_reminders(events, [TARGET], NOW, timedelta(days=2), set()) == []


def test_already_sent_and_hidden_events_are_skipped():
    events = {"calendar.anna": [_event(NOW + timedelta(minutes=10), uid="e1")]}
    first = due_reminders(events, [TARGET], NOW, LEAD, set())
    assert due_reminders(events, [TARGET], NOW, LEAD, {first[0].key}) == []
    assert due_reminders(events, [TARGET], NOW, LEAD, set(), hidden={"calendar.anna|e1"}) == []


def test_each_occurrence_of_a_series_is_its_own_reminder():
    start = NOW + timedelta(minutes=10)
    events = {
        "calendar.anna": [
            _event(start, uid="series", recurrence_id="20261115T161000Z"),
        ]
    }
    week_later = {
        "calendar.anna": [
            _event(start + timedelta(days=7), uid="series", recurrence_id="20261122T161000Z"),
        ]
    }
    first = due_reminders(events, [TARGET], NOW, LEAD, set())
    second = due_reminders(week_later, [TARGET], NOW + timedelta(days=7), LEAD, {first[0].key})
    assert len(second) == 1


def test_two_people_sharing_a_calendar_both_get_reminded():
    events = {"calendar.fotboll": [_event(NOW + timedelta(minutes=10))]}
    targets = [
        ReminderTarget("calendar.fotboll", "mobile_app_anna", "Anna"),
        ReminderTarget("calendar.fotboll", "mobile_app_olle", "Olle"),
    ]
    due = due_reminders(events, targets, NOW, LEAD, set())
    assert sorted(d.notify_service for d in due) == ["mobile_app_anna", "mobile_app_olle"]


# ---- runner: fetches from the calendar entity and calls notify exactly once ----


async def test_runner_sends_once_and_persists(hass, freezer):
    freezer.move_to(NOW)
    sent_calls: list[ServiceCall] = []

    async def _notify(call: ServiceCall) -> None:
        sent_calls.append(call)

    hass.services.async_register("notify", "mobile_app_anna", _notify)

    calendar_entity = MagicMock()
    calendar_entity.async_get_events = AsyncMock(
        return_value=[_event(dt_util.now() + timedelta(minutes=20), summary="Tandläkare")]
    )
    component = MagicMock()
    component.get_entity = MagicMock(
        side_effect=lambda eid: calendar_entity if eid == "calendar.anna" else None
    )
    hass.data["calendar"] = component

    config = {
        "reminders": {"minutes_before": 30},
        "persons": [{"name": "Anna", "calendar_entity": "calendar.anna", "notify_service": "mobile_app_anna"}],
    }
    runner = FamilyPlannerReminders(hass, AsyncMock(return_value=config), AsyncMock(return_value={}))
    await runner.async_start()
    try:
        await runner._async_tick()
        await runner._async_tick()  # second minute: must not send again
        await hass.async_block_till_done()
    finally:
        runner.async_stop()

    assert len(sent_calls) == 1
    assert sent_calls[0].data["title"] == "Om 20 min: Tandläkare"

    # A fresh runner (i.e. after a restart) remembers it was already sent.
    restarted = FamilyPlannerReminders(hass, AsyncMock(return_value=config), AsyncMock(return_value={}))
    await restarted.async_start()
    try:
        await restarted._async_tick()
        await hass.async_block_till_done()
    finally:
        restarted.async_stop()
    assert len(sent_calls) == 1


async def test_runner_does_nothing_when_turned_off(hass):
    component = MagicMock()
    hass.data["calendar"] = component
    config = {"persons": [{"name": "Anna", "calendar_entity": "calendar.anna", "notify_service": "x"}]}
    runner = FamilyPlannerReminders(hass, AsyncMock(return_value=config), AsyncMock(return_value={}))
    await runner.async_start()
    try:
        await runner._async_tick()
    finally:
        runner.async_stop()
    component.get_entity.assert_not_called()
