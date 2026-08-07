"""Constants for the Family Planner integration."""

DOMAIN = "family_planner"

STORAGE_KEY = "family_planner_config"
STORAGE_VERSION = 1

PANEL_URL_PATH = "family-planner"
PANEL_TITLE = "Familjeplanering"
PANEL_ICON = "mdi:account-group"

# Serverar www/ under den här integrationens egen statiska sökväg, så
# panelen laddas oavsett hur repot installerades (HACS laddar bara ner
# family-planner-card.js för "Dashboard"-kategorin, inte hela repot).
STATIC_URL_BASE = "/api/family_planner/static"
