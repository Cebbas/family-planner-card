"""The card is registered through Lovelace's own resource collection."""
from homeassistant.setup import async_setup_component

from custom_components.family_planner import (
    _async_ensure_lovelace_resource,
    _async_remove_lovelace_resource,
    _lovelace_resources,
)

URL = "/api/family_planner/static/family-planner-card.js"


async def test_resource_is_added_once_and_removed(hass):
    assert await async_setup_component(hass, "lovelace", {})
    resources = _lovelace_resources(hass)

    await _async_ensure_lovelace_resource(hass, URL)
    await _async_ensure_lovelace_resource(hass, URL)  # idempotent
    items = [i for i in resources.async_items() if i["url"] == URL]
    assert len(items) == 1
    assert items[0]["type"] == "module"

    await _async_remove_lovelace_resource(hass, URL)
    assert not [i for i in resources.async_items() if i["url"] == URL]


async def test_existing_resources_are_left_alone(hass):
    assert await async_setup_component(hass, "lovelace", {})
    resources = _lovelace_resources(hass)
    await resources.async_load()
    resources.loaded = True
    other = await resources.async_create_item({"res_type": "module", "url": "/local/annat-kort.js"})

    await _async_ensure_lovelace_resource(hass, URL)
    await _async_remove_lovelace_resource(hass, URL)

    assert [i["url"] for i in resources.async_items()] == [other["url"]]
