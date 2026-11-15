"""Adult/child rules for the shared config, and the save/hide locks.

The panel already disables fields a child may not touch, but the backend is
what actually enforces it - these tests pin that down.
"""
import asyncio
import copy
from unittest.mock import MagicMock

from homeassistant.helpers.storage import Store
import pytest

import custom_components.family_planner as fp
from custom_components.family_planner.const import (
    DOMAIN,
    HIDDEN_EVENTS_STORAGE_KEY,
    HIDDEN_EVENTS_STORAGE_VERSION,
    STORAGE_KEY,
    STORAGE_VERSION,
)

PARENT, CHILD, SIBLING = "user-parent", "user-child", "user-sibling"

CONFIG = {
    "title": "Familjen",
    "reminders": {"minutes_before": 30},
    "persons": [
        {"name": "Mamma", "ha_user_id": PARENT, "role": "adult", "calendar_entity": "calendar.mamma"},
        {"name": "Anna", "ha_user_id": CHILD, "role": "child", "calendar_entity": "calendar.anna", "color": "#f00"},
        {"name": "Olle", "ha_user_id": SIBLING, "role": "child", "calendar_entity": "calendar.olle"},
    ],
}


def _edited(**changes_by_person):
    data = copy.deepcopy(CONFIG)
    for person in data["persons"]:
        person.update(changes_by_person.get(person["name"], {}))
    return data


# ---- _blocked_person_changes ----


def test_child_may_edit_their_own_entry():
    assert not fp._blocked_person_changes(CONFIG, _edited(Anna={"color": "#0f0"}), CHILD)


def test_child_may_not_promote_themselves():
    assert fp._blocked_person_changes(CONFIG, _edited(Anna={"role": "adult"}), CHILD)


def test_child_may_not_edit_a_sibling():
    assert fp._blocked_person_changes(CONFIG, _edited(Olle={"calendar_entity": "calendar.anna"}), CHILD)


def test_child_may_not_change_anything_outside_persons():
    data = _edited()
    data["reminders"] = {"minutes_before": 0}
    assert fp._blocked_person_changes(CONFIG, data, CHILD)


def test_child_may_not_add_or_remove_persons():
    added = _edited()
    added["persons"].append({"name": "Ny"})
    removed = _edited()
    removed["persons"] = removed["persons"][:2]
    assert fp._blocked_person_changes(CONFIG, added, CHILD)
    assert fp._blocked_person_changes(CONFIG, removed, CHILD)


def test_unknown_login_and_adults_count_as_adults():
    assert fp._is_adult(CONFIG, PARENT)
    assert fp._is_adult(CONFIG, "kiosk-user")
    assert fp._is_adult(CONFIG, None)
    assert not fp._is_adult(CONFIG, CHILD)


# ---- ws_save_config / ws_set_event_hidden ----


class _User:
    def __init__(self, user_id):
        self.id = user_id


class _Connection:
    def __init__(self, user_id=None):
        self.user = _User(user_id) if user_id else None
        self.result = None
        self.error = None

    def send_result(self, msg_id, data=None):
        self.result = data

    def send_error(self, msg_id, code, message):
        self.error = (code, message)


@pytest.fixture
async def stores(hass):
    """The bits of hass.data async_setup_entry would create (without views/panel)."""
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    await store.async_save(copy.deepcopy(CONFIG))
    hass.data[DOMAIN] = store
    hass.data[fp.HIDDEN_EVENTS_DATA_KEY] = Store(hass, HIDDEN_EVENTS_STORAGE_VERSION, HIDDEN_EVENTS_STORAGE_KEY)
    hass.data[fp.CONFIG_LOCK_KEY] = asyncio.Lock()
    hass.data[fp.HIDDEN_EVENTS_LOCK_KEY] = asyncio.Lock()
    reminders = MagicMock()
    hass.data[fp.REMINDERS_DATA_KEY] = reminders
    return store, reminders


async def _save(hass, user_id, value):
    connection = _Connection(user_id)
    await fp.ws_save_config.__wrapped__(hass, connection, {"id": 1, "value": value})
    return connection


async def test_child_saving_a_siblings_change_is_rejected_and_nothing_is_written(hass, stores):
    store, reminders = stores
    connection = await _save(hass, CHILD, _edited(Olle={"color": "#000"}))
    assert connection.error[0] == "unauthorized"
    assert await store.async_load() == CONFIG
    reminders.mark_config_changed.assert_not_called()


async def test_child_saving_their_own_change_goes_through(hass, stores):
    store, reminders = stores
    connection = await _save(hass, CHILD, _edited(Anna={"notify_service": "mobile_app_anna"}))
    assert connection.error is None
    saved = await store.async_load()
    assert saved["persons"][1]["notify_service"] == "mobile_app_anna"
    reminders.mark_config_changed.assert_called_once()


async def test_adult_may_change_everything(hass, stores):
    store, _reminders = stores
    data = _edited(Olle={"role": "adult"})
    data["reminders"] = {"minutes_before": 15}
    connection = await _save(hass, PARENT, data)
    assert connection.error is None
    assert await store.async_load() == data


async def test_concurrent_hide_toggles_are_not_lost(hass, stores):
    # Simulate a disk read that takes a moment (as on a real Pi/SD card), so
    # ten toggles at once really interleave between load and save - without
    # the lock they'd all start from the same empty list and only one would
    # survive.
    hidden_store = hass.data[fp.HIDDEN_EVENTS_DATA_KEY]
    real_load = hidden_store.async_load

    async def _slow_load():
        data = await real_load()
        await asyncio.sleep(0.01)
        return data

    hidden_store.async_load = _slow_load

    async def _hide(uid):
        connection = _Connection(PARENT)
        await fp.ws_set_event_hidden.__wrapped__(
            hass, connection, {"id": 1, "entity_id": "calendar.anna", "uid": uid, "hidden": True}
        )

    await asyncio.gather(*(_hide(f"e{i}") for i in range(10)))
    data = await hass.data[fp.HIDDEN_EVENTS_DATA_KEY].async_load()
    assert len(data["keys"]) == 10
