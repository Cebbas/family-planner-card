"""The Family Planner integration.

Bundles and serves both Family Planner Card and its "Familjeplanering"
sidebar panel from this single integration, so installing it is the
only step needed:

- Serves the card + panel JS from its own www/ folder via two small
  no-cache views (see _NoCacheJsView) and auto-injects the card as a
  frontend module on every page (add_extra_js_url) - no manual
  Lovelace resource to add.
- Registers the sidebar panel itself, serving the panel JS the same
  way - no manual panel_custom: block in configuration.yaml.
- Stores the shared family configuration (persons, calendars, icon
  keywords) in Home Assistant's own storage, shared between everyone
  on this HA instance (not tied to a single browser/user the way the
  earlier frontend/user_data-based approach was), exposed over two
  small websocket commands the card and panel both call.
- Separately stores which individual calendar events are hidden from
  the week/month view (a local view preference, not calendar data -
  see ws_set_event_hidden), over its own pair of websocket commands.
"""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol
from aiohttp import web

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

from .const import (
    CARD_FILENAME,
    DOMAIN,
    HIDDEN_EVENTS_STORAGE_KEY,
    HIDDEN_EVENTS_STORAGE_VERSION,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL_BASE,
    STORAGE_KEY,
    STORAGE_VERSION,
)

WWW_PATH = Path(__file__).parent / "www"
HIDDEN_EVENTS_DATA_KEY = f"{DOMAIN}_hidden_events"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Family Planner from a config entry."""
    hass.data[DOMAIN] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    hass.data[HIDDEN_EVENTS_DATA_KEY] = Store(
        hass, HIDDEN_EVENTS_STORAGE_VERSION, HIDDEN_EVENTS_STORAGE_KEY
    )

    # Egna vyer istället för register_static_path/StaticPathConfig - ger
    # kontroll över svarshuvudena så vi kan slå av caching helt (se
    # _NoCacheJsView) istället för HA:s binära val mellan "cacha för
    # evigt" och "inga extra huvuden alls". ?v=<version>-parametern
    # nedanför räcker i de allra flesta fall, men Android-appens webview
    # har visat sig hålla fast vid en cachad kopia ändå - detta täpper
    # till det, om än inte en garanti (appens egen frontend-shell, som
    # avgör vilken extra_js_url som ens efterfrågas, styrs helt av HA
    # core/appen och ligger utanför den här integrationen).
    hass.http.register_view(
        _NoCacheJsView(f"{STATIC_URL_BASE}/{CARD_FILENAME}", WWW_PATH / CARD_FILENAME)
    )
    hass.http.register_view(
        _NoCacheJsView(f"{STATIC_URL_BASE}/{PANEL_FILENAME}", WWW_PATH / PANEL_FILENAME)
    )

    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_save_config)
    websocket_api.async_register_command(hass, ws_get_hidden_events)
    websocket_api.async_register_command(hass, ws_set_event_hidden)

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
    hass.data.pop(HIDDEN_EVENTS_DATA_KEY, None)
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    # frontend har inget publikt sätt att ta bort en extra-js-url igen -
    # den ligger kvar tills nästa omstart av HA, vilket är ofarligt
    # (kortet finns kvar på disk tills dess).
    return True


class _NoCacheJsView(HomeAssistantView):
    """Serves a single JS file from www/ with caching forced off.

    register_static_path/StaticPathConfig only offers a binary choice -
    long-term "immutable" caching, or no explicit Cache-Control header at
    all (our previous setup). The latter leaves it up to whatever HTTP
    client is asking, and the Android Companion App's webview has been
    seen holding on to an old response regardless of the ?v=<version>
    cache-busting query param already appended to the URL. An explicit
    no-store header closes that gap.
    """

    requires_auth = False

    def __init__(self, url: str, file_path: Path) -> None:
        self.url = url
        self.name = f"family_planner:static:{file_path.name}"
        self._file_path = file_path

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        try:
            content = await hass.async_add_executor_job(self._file_path.read_bytes)
        except OSError:
            return web.Response(status=404)
        return web.Response(
            body=content,
            content_type="application/javascript",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


def _get_store(hass: HomeAssistant) -> Store:
    """Return the config store (single_config_entry_only guarantees exactly one)."""
    return hass.data[DOMAIN]


def _get_hidden_events_store(hass: HomeAssistant) -> Store:
    """Return the "hidden in week/month view" store."""
    return hass.data[HIDDEN_EVENTS_DATA_KEY]


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


@websocket_api.websocket_command({vol.Required("type"): "family_planner/get_hidden_events"})
@websocket_api.async_response
async def ws_get_hidden_events(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the keys ("entity_id|uid") of events hidden from week/month view.

    A local view preference, not calendar data - kept out of the calendar
    event itself (unlike location/description/image) specifically so
    hiding an event never requires the underlying calendar to be
    writable. See ws_set_event_hidden.
    """
    data = await _get_hidden_events_store(hass).async_load()
    connection.send_result(msg["id"], {"keys": (data or {}).get("keys", [])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "family_planner/set_event_hidden",
        vol.Required("entity_id"): str,
        vol.Required("uid"): str,
        vol.Required("hidden"): bool,
    }
)
@websocket_api.async_response
async def ws_set_event_hidden(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Mark (or unmark) a single event as hidden from week/month view."""
    store = _get_hidden_events_store(hass)
    data = await store.async_load()
    keys = set((data or {}).get("keys", []))
    key = f"{msg['entity_id']}|{msg['uid']}"
    if msg["hidden"]:
        keys.add(key)
    else:
        keys.discard(key)
    await store.async_save({"keys": sorted(keys)})
    connection.send_result(msg["id"], {"keys": sorted(keys)})
