"""Constants for the Family Planner integration."""

DOMAIN = "family_planner"

STORAGE_KEY = "family_planner_config"
STORAGE_VERSION = 1

# Separat lagring för "dölj i vecko-/månadskalender"-flaggan per händelse
# (se ws_get_hidden_events/ws_set_event_hidden i __init__.py) - egen
# store istället för ett fält i huvudkonfigurationen, dels för att den
# ändras betydligt oftare (varje händelse man döljer/visar) än resten av
# configen, dels för att slippa krocka med panelens save_config (som
# skriver hela configen på en gång och annars riskerar att skriva över
# en döljning som kortet just satt, eller tvärtom).
HIDDEN_EVENTS_STORAGE_KEY = "family_planner_hidden_events"
HIDDEN_EVENTS_STORAGE_VERSION = 1

PANEL_URL_PATH = "family-planner"
PANEL_TITLE = "Familjeplanering"
PANEL_ICON = "mdi:account-group"

# Serverar www/ (kortet + panelen) under den här integrationens egen
# statiska sökväg, så båda laddas oavsett hur repot installerades -
# ingen manuell Lovelace-resurs eller panel_custom-rad behövs.
STATIC_URL_BASE = "/api/family_planner/static"
CARD_FILENAME = "family-planner-card.js"
PANEL_FILENAME = "family-planner-panel.js"
