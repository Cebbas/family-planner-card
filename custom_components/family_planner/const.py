"""Constants for the Family Planner integration."""

DOMAIN = "family_planner"

STORAGE_KEY = "family_planner_config"
STORAGE_VERSION = 1

PANEL_URL_PATH = "family-planner"
PANEL_TITLE = "Familjeplanering"
PANEL_ICON = "mdi:account-group"

# Serverar www/ (kortet + panelen) under den här integrationens egen
# statiska sökväg, så båda laddas oavsett hur repot installerades -
# ingen manuell Lovelace-resurs eller panel_custom-rad behövs.
STATIC_URL_BASE = "/api/family_planner/static"
CARD_FILENAME = "family-planner-card.js"
PANEL_FILENAME = "family-planner-panel.js"
