"""Config flow for Family Planner.

No user input is needed - this integration has nothing to configure at
setup time (the actual family data is entered later, in the
"Familjeplanering" sidebar panel it registers). The flow just confirms
you want to add it, since it's a singleton (single_config_entry_only).
"""
from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class FamilyPlannerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Family Planner."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Handle the (only) setup step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="Family Planner", data={})

        return self.async_show_form(step_id="user")
