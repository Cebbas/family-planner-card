"""The Family Planner integration.

Bundles and serves both Family Planner Card and its "Familjeplanering"
sidebar panel from this single integration, so installing it is the
only step needed:

- Registers its own static path under www/ and auto-injects the card
  as a frontend module on every page (add_extra_js_url) - no manual
  Lovelace resource to add.
- Registers the sidebar panel itself, serving the panel JS from the
  same static path - no manual panel_custom: block in
  configuration.yaml.
- Stores the shared family configuration (persons, calendars, icon
  keywords) in Home Assistant's own storage, shared between everyone
  on this HA instance (not tied to a single browser/user the way the
  earlier frontend/user_data-based approach was), exposed over two
  small websocket commands the card and panel both call.
"""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

from .const import (
    CARD_FILENAME,
    DOMAIN,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL_BASE,
    STORAGE_KEY,
    STORAGE_VERSION,
)

WWW_PATH = Path(__file__).parent / "www"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Family Planner from a config entry."""
    hass.data[DOMAIN] = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    await _async_register_static_path(hass)

    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_save_config)

    # Cache-busting query-param från manifest-versionen - utan den håller
    # webbläsare (och HA:s frontend) fast vid en gammal cachad kopia av
    # JS-modulen på obestämd tid efter en uppdatering, eftersom URL:en
    # annars aldrig ändras mellan versioner. Höjs automatiskt varje
    # release i och med att manifest.json:s version alltid bumpas då.
    integration = await async_get_integration(hass, DOMAIN)
    cache_bust = f"?v={integration.version}"

    # Ladda kortet på varje frontend-sida automatiskt - motsvarar att
    # lägga till det som en Lovelace-resurs manuellt.
    frontend.add_extra_js_url(hass, f"{STATIC_URL_BASE}/{CARD_FILENAME}{cache_bust}")

    await async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="family-planner-panel",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL_BASE}/{PANEL_FILENAME}{cache_bust}",
        embed_iframe=False,
        trust_external=True,
        require_admin=False,
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Family Planner config entry."""
    hass.data.pop(DOMAIN, None)
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    # frontend har inget publikt sätt att ta bort en extra-js-url igen -
    # den ligger kvar tills nästa omstart av HA, vilket är ofarligt
    # (kortet finns kvar på disk tills dess).
    return True


async def _async_register_static_path(hass: HomeAssistant) -> None:
    """Serve the card + panel JS from this integration's own www/ folder."""
    try:
        # Nyare HA-kärnor: icke-blockerande registrering.
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_BASE, str(WWW_PATH), False)]
        )
    except ImportError:
        # Äldre HA-kärna utan async_register_static_paths/StaticPathConfig.
        hass.http.register_static_path(STATIC_URL_BASE, str(WWW_PATH), False)


def _get_store(hass: HomeAssistant) -> Store:
    """Return the config store (single_config_entry_only guarantees exactly one)."""
    return hass.data[DOMAIN]


@websocket_api.websocket_command({vol.Required("type"): "family_planner/get_config"})
@websocket_api.async_response
async def ws_get_config(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the saved family planner config (persons/calendars/icon_keywords)."""
    data = await _get_store(hass).async_load()
    connection.send_result(msg["id"], {"value": data or {}})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "family_planner/save_config",
        vol.Required("value"): dict,
    }
)
@websocket_api.async_response
async def ws_save_config(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Save the family planner config."""
    await _get_store(hass).async_save(msg["value"])
    connection.send_result(msg["id"])
