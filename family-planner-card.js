/*
 * Family Planner Card
 * -----------------------------------------------------------------------
 * En egen Lovelace-card för Home Assistant.
 *
 * Övre delen ("Idag"):
 *   - En rad per person, som visar entitetens state (t.ex. en template-
 *     sensor du själv fyller med dagens text).
 *   - En "allmän rad" med sensorer som bara visas som en rund ikon om
 *     entiteten är "on".
 *   Hela "Idag"-sektionen kan fällas ihop/ut.
 *
 * Nedre delen ("Veckoschema"):
 *   - Samma personer, en rad var, men uppdelat på veckans dagar
 *     (måndag-söndag). Dagens dag är markerad.
 *   - Cellinnehållet hämtas från attribut på en "week_entity" per person,
 *     där attributnamnen ska vara monday, tuesday, wednesday, thursday,
 *     friday, saturday, sunday (engelska, gemener). Saknas week_entity
 *     eller attribut visas ett streck.
 *
 * -----------------------------------------------------------------------
 * Exempel-konfiguration:
 *
 * type: custom:family-planner-card
 * title: Familjeplanering
 * persons:
 *   - name: Anna
 *     entity: sensor.anna_idag
 *     week_entity: sensor.anna_vecka   # valfri
 *     icon: mdi:account
 *     color: "#e17055"                # valfri, färg på avataren
 *   - name: Erik
 *     entity: sensor.erik_idag
 *     week_entity: sensor.erik_vecka
 *     icon: mdi:account
 *     color: "#0984e3"
 * general:
 *   - entity: binary_sensor.tvattmaskin
 *     name: Tvätt
 *     icon: mdi:washing-machine
 *   - entity: binary_sensor.sopor_imorgon
 *     name: Sopor
 *     icon: mdi:trash-can
 *
 * -----------------------------------------------------------------------
 * Installation:
 *   1. Lägg family-planner-card.js i /config/www/
 *   2. Lägg till som Lovelace-resurs:
 *        Inställningar -> Instrumentpaneler -> Resurser -> Lägg till resurs
 *        URL: /local/family-planner-card.js   Typ: JavaScript-modul
 *   3. Lägg till kortet i ditt dashboard med YAML enligt exemplet ovan.
 */

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const t0 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((t0 - n0) / 86400000);
}

function daysLabel(days) {
  if (days === 0) return "Idag!";
  if (days === 1) return "Imorgon";
  if (days > 1) return `om ${days} dagar`;
  if (days === -1) return "igår";
  return `${Math.abs(days)} dagar sedan`;
}

const WEATHER_ICONS = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:alert-circle-outline",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
};

function weatherIcon(condition) {
  return WEATHER_ICONS[condition] || "mdi:weather-cloudy";
}

// Samma måndag-baserade veckodagsindex som resten av kortet använder.
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

// Matchar text (case-insensitive, substräng) mot en ordnad lista av
// {match, icon}. Första träffen vinner. icon kan vara en emoji eller en
// mdi:-ikon.
function matchIcon(text, keywords) {
  if (!text || !Array.isArray(keywords)) return null;
  const lower = String(text).toLowerCase();
  for (const kw of keywords) {
    if (kw.match && lower.includes(String(kw.match).toLowerCase())) {
      return kw.icon || null;
    }
  }
  return null;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Mars", "April", "Maj", "Juni",
  "Juli", "Augusti", "September", "Oktober", "November", "December",
];

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfCalendarGrid(year, month) {
  const first = new Date(year, month, 1);
  const dow = weekdayIndex(first);
  return new Date(year, month, 1 - dow);
}

function isImagePath(str) {
  if (!str) return false;
  if (/^https?:\/\//i.test(str)) return true;
  if (str.startsWith("/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(str);
}

function renderIconBadge(icon) {
  if (!icon) return "";
  if (icon.startsWith("mdi:")) {
    return `<ha-icon class="fpc-kw-icon" icon="${icon}"></ha-icon>`;
  }
  if (isImagePath(icon)) {
    return `<img class="fpc-kw-image" src="${icon}" alt="" />`;
  }
  return `<span class="fpc-kw-emoji">${icon}</span>`;
}

class FamilyPlannerCard extends HTMLElement {
  constructor() {
    super();
    this._collapsed = false;
    this._built = false;
    const today = new Date();
    this._calendarViewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this._hiddenPersons = new Set();
    this._dragging = false;
    this._dragMoved = false;
    this._dragStart = null;
    this._dragEnd = null;
    this._creatingEvent = null; // { startIso, endIso, targetEntity }
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Ingen konfiguration angiven");
    }
    if (!Array.isArray(config.persons) || config.persons.length === 0) {
      throw new Error("Du måste ange minst en person under 'persons'");
    }
    for (const p of config.persons) {
      if (!p.entity) {
        throw new Error(`Person "${p.name || "?"}" saknar 'entity'`);
      }
    }
    const countdownCfg = config.countdowns || {};
    const weatherCfg = config.weather || {};
    this._config = {
      title: config.title || "Familjeplanering",
      persons: config.persons,
      general: Array.isArray(config.general) ? config.general : [],
      start_collapsed: !!config.start_collapsed,
      countdowns: {
        max_shown: Number.isFinite(countdownCfg.max_shown) ? countdownCfg.max_shown : 5,
        items: Array.isArray(countdownCfg.items) ? countdownCfg.items : [],
      },
      weather: weatherCfg.entity
        ? { entity: weatherCfg.entity, show_week: !!weatherCfg.show_week }
        : null,
      icon_keywords: Array.isArray(config.icon_keywords) ? config.icon_keywords : [],
      show_month_calendar: config.show_month_calendar !== false,
      vacation_keywords: Array.isArray(config.vacation_keywords) ? config.vacation_keywords : [],
      tts:
        config.tts && config.tts.tts_entity && config.tts.media_player
          ? { tts_entity: config.tts.tts_entity, media_player: config.tts.media_player }
          : null,
    };
    this._collapsed = this._config.start_collapsed;
    this._built = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._render();
    } else {
      this._update();
    }
    this._maybeFetchForecast();
    this._maybeFetchMonthEvents();
  }

  async _maybeFetchMonthEvents() {
    const cfg = this._config;
    if (!cfg || !cfg.show_month_calendar || !this._hass) return;
    const persons = cfg.persons.filter((p) => p.calendar_entity);
    if (persons.length === 0) return;

    const year = this._calendarViewMonth.getFullYear();
    const month = this._calendarViewMonth.getMonth();
    const monthKey = `${year}-${month}`;
    const cache = this._monthEventsCache;
    const fresh = cache && cache.key === monthKey && Date.now() - cache.fetchedAt < 5 * 60 * 1000;
    if (fresh || this._monthEventsLoading) return;

    this._monthEventsLoading = true;
    const gridStart = startOfCalendarGrid(year, month);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 42);

    const data = {};
    for (const p of persons) {
      try {
        const events = await this._hass.callApi(
          "GET",
          `calendars/${p.calendar_entity}?start=${encodeURIComponent(gridStart.toISOString())}&end=${encodeURIComponent(gridEnd.toISOString())}`
        );
        data[p.calendar_entity] = Array.isArray(events) ? events : [];
      } catch (err) {
        data[p.calendar_entity] = [];
      }
    }
    this._monthEventsCache = { key: monthKey, fetchedAt: Date.now(), data };
    this._monthEventsLoading = false;
    this._update();
  }

  async _maybeFetchForecast() {
    const cfg = this._config;
    if (!cfg || !cfg.weather || !cfg.weather.show_week || !this._hass) return;
    const entityId = cfg.weather.entity;
    const cache = this._forecastCache;
    const fresh = cache && cache.entity === entityId && Date.now() - cache.fetchedAt < 20 * 60 * 1000;
    if (fresh || this._forecastLoading) return;
    this._forecastLoading = true;
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "weather",
        service: "get_forecasts",
        service_data: { type: "daily" },
        target: { entity_id: entityId },
        return_response: true,
      });
      const forecast = result && result.response && result.response[entityId]
        ? result.response[entityId].forecast
        : null;
      this._forecastCache = { entity: entityId, fetchedAt: Date.now(), data: forecast || [] };
    } catch (err) {
      // Äldre HA-version eller entitet utan forecast-stöd - visa bara tomt
      this._forecastCache = { entity: entityId, fetchedAt: Date.now(), data: [] };
    }
    this._forecastLoading = false;
    this._update();
  }

  getCardSize() {
    const persons = this._config ? this._config.persons.length : 1;
    return 3 + persons;
  }

  _stateObj(entityId) {
    if (!this._hass || !entityId) return undefined;
    return this._hass.states[entityId];
  }

  _friendlyState(entityId, fallback) {
    const st = this._stateObj(entityId);
    if (!st) return fallback || "Okänd entitet";
    if (st.state === "unknown" || st.state === "unavailable" || st.state === "") {
      return fallback || "Inget planerat idag";
    }
    return st.state;
  }

  _todayKey() {
    // JS getDay(): 0=söndag ... 6=lördag -> vi vill 0=måndag
    const jsDay = new Date().getDay();
    return (jsDay + 6) % 7;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;

    const style = `
      <style>
        ha-card.fpc { padding: 16px 16px 20px 16px; }
        .fpc-header {
          display: flex; align-items: center; justify-content: space-between;
          cursor: pointer; user-select: none;
        }
        .fpc-title { font-size: 1.2em; font-weight: 500; }
        .fpc-toggle {
          transition: transform 0.2s ease;
          color: var(--secondary-text-color);
        }
        .fpc-toggle.collapsed { transform: rotate(-90deg); }
        .fpc-today {
          overflow: hidden;
          max-height: 800px;
          transition: max-height 0.25s ease, opacity 0.2s ease, margin 0.2s ease;
          opacity: 1;
        }
        .fpc-today.collapsed { max-height: 0; opacity: 0; margin: 0; }
        .fpc-person-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 0; border-bottom: 1px solid var(--divider-color);
        }
        .fpc-person-row:last-child { border-bottom: none; }
        .fpc-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; color: white;
        }
        .fpc-person-info { display: flex; flex-direction: column; min-width: 0; }
        .fpc-person-name { font-weight: 500; font-size: 0.95em; }
        .fpc-person-state {
          color: var(--secondary-text-color); font-size: 0.88em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fpc-general-row {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding-top: 14px; margin-top: 4px;
        }
        .fpc-general-empty {
          color: var(--secondary-text-color); font-size: 0.85em; font-style: italic;
        }
        .fpc-general-badge {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          width: 56px;
        }
        .fpc-general-circle {
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--state-icon-active-color, #f39c12);
          color: white;
        }
        .fpc-general-label {
          font-size: 0.7em; color: var(--secondary-text-color);
          text-align: center; line-height: 1.1;
        }
        .fpc-week {
          margin-top: 20px; padding-top: 16px;
          border-top: 1px solid var(--divider-color);
        }
        .fpc-week-title {
          font-weight: 500; margin-bottom: 10px; font-size: 1.05em;
        }
        table.fpc-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        table.fpc-table th, table.fpc-table td {
          padding: 6px 4px; text-align: center; font-size: 0.82em;
          vertical-align: top; word-break: break-word;
        }
        table.fpc-table th {
          font-weight: 500; color: var(--secondary-text-color);
          border-bottom: 1px solid var(--divider-color);
        }
        table.fpc-table th.fpc-today-col, table.fpc-table td.fpc-today-col {
          background: var(--primary-color); color: white; border-radius: 6px;
        }
        table.fpc-table td.fpc-person-col {
          text-align: left; font-weight: 500; white-space: nowrap;
        }
        table.fpc-table tr td { border-bottom: 1px solid var(--divider-color); }
        table.fpc-table tr:last-child td { border-bottom: none; }
        .fpc-countdowns {
          display: flex; gap: 10px; overflow-x: auto; padding-bottom: 14px;
          margin-bottom: 4px; border-bottom: 1px solid var(--divider-color);
        }
        .fpc-countdowns::-webkit-scrollbar { height: 4px; }
        .fpc-cd-chip {
          flex: 0 0 auto; min-width: 84px;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 8px 10px; border-radius: 12px;
          background: var(--secondary-background-color, rgba(127,127,127,0.1));
        }
        .fpc-cd-chip.fpc-cd-pinned { border: 1px solid var(--primary-color); }
        .fpc-cd-days { font-size: 1.15em; font-weight: 600; color: var(--primary-color); }
        .fpc-cd-name { font-size: 0.78em; text-align: center; line-height: 1.15; }
        .fpc-cd-empty { color: var(--secondary-text-color); font-size: 0.85em; font-style: italic; }
        .fpc-weather-row {
          display: flex; align-items: center; gap: 10px; padding: 8px 0 14px 0;
          border-bottom: 1px solid var(--divider-color); margin-bottom: 4px;
        }
        .fpc-weather-icon { --mdc-icon-size: 32px; color: var(--primary-color); }
        .fpc-weather-temp { font-size: 1.3em; font-weight: 600; }
        .fpc-weather-condition { color: var(--secondary-text-color); font-size: 0.85em; }
        tr.fpc-weather-week-row td, tr.fpc-weather-week-row th {
          padding-bottom: 10px;
        }
        .fpc-weather-week-cell {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .fpc-weather-week-cell ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
        .fpc-weather-week-temp { font-size: 0.78em; }
        .fpc-kw-icon { --mdc-icon-size: 18px; margin-right: 4px; vertical-align: -4px; }
        .fpc-kw-emoji { margin-right: 4px; }
        .fpc-kw-image {
          width: 18px; height: 18px; border-radius: 50%; object-fit: cover;
          margin-right: 4px; vertical-align: -4px;
        }
        .fpc-month { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--divider-color); }
        .fpc-month-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 10px;
        }
        .fpc-month-title { font-weight: 500; font-size: 1.05em; }
        .fpc-month-nav {
          background: none; border: none; color: var(--primary-color);
          font-size: 1.3em; cursor: pointer; padding: 4px 10px; line-height: 1;
        }
        .fpc-month-grid {
          display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px;
        }
        .fpc-month-weekday {
          text-align: center; font-size: 0.72em; color: var(--secondary-text-color);
          padding-bottom: 4px;
        }
        .fpc-month-cell {
          aspect-ratio: 1; border-radius: 8px; padding: 4px;
          display: flex; flex-direction: column; align-items: center;
          cursor: pointer; background: var(--secondary-background-color, rgba(127,127,127,0.06));
        }
        .fpc-month-cell.fpc-outside { opacity: 0.35; }
        .fpc-month-cell.fpc-today-cell {
          background: var(--primary-color); color: white;
        }
        .fpc-month-cell.fpc-selected { outline: 2px solid var(--primary-color); }
        .fpc-month-daynum { font-size: 0.82em; }
        .fpc-month-dots { display: flex; gap: 2px; margin-top: 2px; flex-wrap: wrap; justify-content: center; }
        .fpc-month-dot { width: 5px; height: 5px; border-radius: 50%; }
        .fpc-month-daydetail { margin-top: 12px; }
        .fpc-month-daydetail-title { font-weight: 500; margin-bottom: 6px; font-size: 0.92em; }
        .fpc-month-event {
          display: flex; align-items: center; gap: 8px; padding: 6px 8px;
          border-radius: 6px; margin-bottom: 4px; font-size: 0.85em;
          background: var(--secondary-background-color, rgba(127,127,127,0.06));
        }
        .fpc-month-event-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .fpc-month-event-empty { color: var(--secondary-text-color); font-size: 0.85em; font-style: italic; }
        .fpc-header-left { display: flex; align-items: center; gap: 8px; }
        .fpc-header-right { display: flex; align-items: center; gap: 4px; }
        .fpc-badge {
          background: var(--error-color, #db4437); color: white; border-radius: 10px;
          font-size: 0.7em; font-weight: 600; padding: 1px 7px; line-height: 1.4;
        }
        .fpc-tts-btn { --mdc-icon-size: 22px; color: var(--secondary-text-color); cursor: pointer; }
        .fpc-tts-btn:hover { color: var(--primary-color); }
        .fpc-month-todaybtn {
          background: none; border: 1px solid var(--divider-color); border-radius: 14px;
          padding: 3px 10px; font-size: 0.78em; color: var(--primary-text-color); cursor: pointer;
        }
        .fpc-month-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .fpc-filter-chip {
          border-radius: 14px; padding: 4px 10px; font-size: 0.78em; cursor: pointer;
          border: 1px solid var(--divider-color); opacity: 0.4;
          display: flex; align-items: center; gap: 4px;
        }
        .fpc-filter-chip.fpc-filter-active { opacity: 1; }
        .fpc-filter-dot { width: 8px; height: 8px; border-radius: 50%; }
        .fpc-month-cell.fpc-dragging { outline: 2px dashed var(--primary-color); }
        .fpc-week-header-row { display: flex; align-items: center; justify-content: space-between; }
        .fpc-share-btn {
          background: none; border: 1px solid var(--divider-color); border-radius: 14px;
          padding: 4px 10px; font-size: 0.78em; color: var(--primary-text-color); cursor: pointer;
        }
        .fpc-create-form { margin-top: 8px; padding: 10px; border-radius: 8px; background: var(--secondary-background-color, rgba(127,127,127,0.06)); }
        .fpc-create-form input, .fpc-create-form select {
          width: 100%; box-sizing: border-box; padding: 7px; margin-bottom: 6px;
          border: 1px solid var(--divider-color); border-radius: 6px;
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .fpc-create-form-actions { display: flex; gap: 8px; }
        .fpc-create-form-actions button {
          flex: 1; padding: 7px; border-radius: 6px; border: none; cursor: pointer;
        }
        .fpc-create-save { background: var(--primary-color); color: white; }
        .fpc-create-cancel { background: none; border: 1px solid var(--divider-color) !important; }
        .fpc-add-event-btn {
          margin-top: 6px; background: none; border: 1px dashed var(--primary-color);
          color: var(--primary-color); border-radius: 6px; padding: 6px 10px;
          font-size: 0.82em; cursor: pointer; width: 100%;
        }
      </style>
    `;

    const generalIds = cfg.general.map((g, i) => `fpc-gen-${i}`).join(",");

    this.innerHTML = `
      ${style}
      <ha-card class="fpc">
        <div class="fpc-countdowns" id="fpc-countdowns"></div>
        <div class="fpc-weather-row" id="fpc-weather"></div>
        <div class="fpc-header" id="fpc-header">
          <div class="fpc-header-left">
            <div class="fpc-title">${fpcEsc(cfg.title)}</div>
            <div class="fpc-badge" id="fpc-badge" style="display:none"></div>
          </div>
          <div class="fpc-header-right">
            <ha-icon class="fpc-tts-btn" id="fpc-tts-btn" icon="mdi:volume-high" style="display:none"></ha-icon>
            <ha-icon class="fpc-toggle${this._collapsed ? " collapsed" : ""}" id="fpc-toggle" icon="mdi:chevron-down"></ha-icon>
          </div>
        </div>
        <div class="fpc-today${this._collapsed ? " collapsed" : ""}" id="fpc-today">
          <div id="fpc-persons"></div>
          <div class="fpc-general-row" id="fpc-general"></div>
        </div>
        <div class="fpc-week">
          <div class="fpc-week-header-row">
            <div class="fpc-week-title">Veckoschema</div>
            <button class="fpc-share-btn" id="fpc-share-btn">Dela</button>
          </div>
          <table class="fpc-table" id="fpc-table"></table>
        </div>
        <div class="fpc-month" id="fpc-month-section">
          <div class="fpc-month-header">
            <button class="fpc-month-nav" id="fpc-month-prev">‹</button>
            <div class="fpc-month-title" id="fpc-month-title"></div>
            <button class="fpc-month-nav" id="fpc-month-next">›</button>
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <button class="fpc-month-todaybtn" id="fpc-month-today-btn">Hoppa till idag</button>
          </div>
          <div class="fpc-month-filters" id="fpc-month-filters"></div>
          <div class="fpc-month-grid" id="fpc-month-grid"></div>
          <div class="fpc-month-daydetail" id="fpc-month-daydetail"></div>
        </div>
      </ha-card>
    `;

    this.querySelector("#fpc-header").addEventListener("click", () => {
      this._collapsed = !this._collapsed;
      this.querySelector("#fpc-today").classList.toggle("collapsed", this._collapsed);
      this.querySelector("#fpc-toggle").classList.toggle("collapsed", this._collapsed);
    });

    this.querySelector("#fpc-month-prev").addEventListener("click", () => {
      this._calendarViewMonth = new Date(
        this._calendarViewMonth.getFullYear(),
        this._calendarViewMonth.getMonth() - 1,
        1
      );
      this._selectedDate = null;
      this._maybeFetchMonthEvents();
      this._update();
    });
    this.querySelector("#fpc-month-next").addEventListener("click", () => {
      this._calendarViewMonth = new Date(
        this._calendarViewMonth.getFullYear(),
        this._calendarViewMonth.getMonth() + 1,
        1
      );
      this._selectedDate = null;
      this._maybeFetchMonthEvents();
      this._update();
    });

    this.querySelector("#fpc-month-today-btn").addEventListener("click", () => {
      const today = new Date();
      this._calendarViewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      this._selectedDate = isoDate(today);
      this._maybeFetchMonthEvents();
      this._update();
    });

    this.querySelector("#fpc-tts-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._speakToday();
    });

    this.querySelector("#fpc-share-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._shareWeek();
    });

    // Global pointerup fångar drag-avslut även om man släpper utanför en cell
    this._onPointerUp = () => this._finishDrag();
    document.addEventListener("pointerup", this._onPointerUp);

    this._built = true;
    this._update();
  }

  disconnectedCallback() {
    if (this._onPointerUp) {
      document.removeEventListener("pointerup", this._onPointerUp);
    }
  }

  _speakToday() {
    const cfg = this._config;
    if (!cfg.tts || !this._hass) return;
    const parts = cfg.persons.map((p) => `${p.name}: ${this._friendlyState(p.entity)}`);
    const activeGeneral = cfg.general.filter((g) => {
      const st = this._stateObj(g.entity);
      return st && st.state === "on";
    });
    if (activeGeneral.length > 0) {
      parts.push(`Kom ihåg: ${activeGeneral.map((g) => g.name || g.entity).join(", ")}`);
    }
    const message = `Idag. ${parts.join(". ")}.`;
    this._hass
      .callService("tts", "speak", {
        entity_id: cfg.tts.tts_entity,
        media_player_entity_id: cfg.tts.media_player,
        message,
      })
      .catch(() => {});
  }

  _shareWeek() {
    const cfg = this._config;
    const todayIdx = this._todayKey();
    const lines = [cfg.title, ""];
    cfg.persons.forEach((p) => {
      const weekState = p.week_entity ? this._stateObj(p.week_entity) : undefined;
      const attrs = weekState ? weekState.attributes : {};
      lines.push(p.name + ":");
      DAY_KEYS.forEach((key, i) => {
        const val = attrs && attrs[key] ? attrs[key] : "–";
        lines.push(`  ${DAY_LABELS[i]}${i === todayIdx ? " (idag)" : ""}: ${val}`);
      });
      lines.push("");
    });
    const text = lines.join("\n");

    if (navigator.share) {
      navigator.share({ title: cfg.title, text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          const btn = this.querySelector("#fpc-share-btn");
          if (btn) {
            const original = btn.textContent;
            btn.textContent = "Kopierat!";
            setTimeout(() => (btn.textContent = original), 1500);
          }
        })
        .catch(() => {});
    }
  }

  _update() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;

    const ttsBtn = this.querySelector("#fpc-tts-btn");
    if (ttsBtn) ttsBtn.style.display = cfg.tts ? "" : "none";

    // Nedräkningar - överst
    const cdEl = this.querySelector("#fpc-countdowns");
    if (cdEl) {
      if (cfg.countdowns.items.length === 0) {
        cdEl.style.display = "none";
      } else {
        cdEl.style.display = "";
      }
      const items = cfg.countdowns.items
        .map((it) => {
          const st = this._stateObj(it.entity);
          const days = st ? daysUntil(st.state) : null;
          return { ...it, days };
        })
        .filter((it) => it.days !== null);

      const upcoming = items.filter((it) => it.days >= 0).sort((a, b) => a.days - b.days);
      const selected = upcoming.slice(0, cfg.countdowns.max_shown);
      const selectedEntities = new Set(selected.map((it) => it.entity));
      items
        .filter((it) => it.pinned && !selectedEntities.has(it.entity))
        .forEach((it) => selected.push(it));
      selected.sort((a, b) => a.days - b.days);

      if (selected.length === 0) {
        cdEl.innerHTML = `<div class="fpc-cd-empty">Inga nedräkningar</div>`;
      } else {
        cdEl.innerHTML = selected
          .map(
            (it) => `
              <div class="fpc-cd-chip${it.pinned ? " fpc-cd-pinned" : ""}">
                <div class="fpc-cd-days">${daysLabel(it.days)}</div>
                <div class="fpc-cd-name">${fpcEsc(it.name || it.entity)}</div>
              </div>
            `
          )
          .join("");
      }
    }

    // Aktuellt väder
    const weatherEl = this.querySelector("#fpc-weather");
    if (weatherEl) {
      if (!cfg.weather) {
        weatherEl.style.display = "none";
      } else {
        const st = this._stateObj(cfg.weather.entity);
        if (!st) {
          weatherEl.style.display = "none";
        } else {
          weatherEl.style.display = "";
          const temp = st.attributes.temperature;
          const unit = fpcEsc(st.attributes.temperature_unit || "°");
          weatherEl.innerHTML = `
            <ha-icon class="fpc-weather-icon" icon="${weatherIcon(st.state)}"></ha-icon>
            <div>
              <div class="fpc-weather-temp">${temp !== undefined ? temp + " " + unit : "–"}</div>
              <div class="fpc-weather-condition">${fpcEsc(st.state)}</div>
            </div>
          `;
        }
      }
    }

    // Personrader - idag
    const personsEl = this.querySelector("#fpc-persons");
    if (personsEl) {
      personsEl.innerHTML = cfg.persons
        .map((p) => {
          const color = p.color || "var(--primary-color)";
          const icon = p.icon || "mdi:account";
          const stateText = this._friendlyState(p.entity);
          const badge = renderIconBadge(matchIcon(stateText, cfg.icon_keywords));
          return `
            <div class="fpc-person-row">
              <div class="fpc-avatar" style="background:${color}">
                <ha-icon icon="${icon}"></ha-icon>
              </div>
              <div class="fpc-person-info">
                <div class="fpc-person-name">${fpcEsc(p.name)}</div>
                <div class="fpc-person-state">${badge}${fpcEsc(stateText)}</div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Allmän rad - bara sensorer som är "on"
    const generalEl = this.querySelector("#fpc-general");
    if (generalEl) {
      const activeOnes = cfg.general.filter((g) => {
        const st = this._stateObj(g.entity);
        return st && st.state === "on";
      });

      // Notis-badge i headern, synlig även när sektionen är ihopfälld
      const badgeEl = this.querySelector("#fpc-badge");
      if (badgeEl) {
        if (activeOnes.length > 0) {
          badgeEl.textContent = String(activeOnes.length);
          badgeEl.style.display = "";
        } else {
          badgeEl.style.display = "none";
        }
      }

      if (activeOnes.length === 0) {
        generalEl.innerHTML = `<div class="fpc-general-empty">Inget aktuellt just nu</div>`;
      } else {
        generalEl.innerHTML = activeOnes
          .map((g) => {
            const icon = g.icon || "mdi:bell";
            const label = g.name || g.entity;
            return `
              <div class="fpc-general-badge">
                <div class="fpc-general-circle">
                  <ha-icon icon="${icon}"></ha-icon>
                </div>
                <div class="fpc-general-label">${fpcEsc(label)}</div>
              </div>
            `;
          })
          .join("");
      }
    }

    // Veckoschema
    const tableEl = this.querySelector("#fpc-table");
    if (tableEl) {
      const todayIdx = this._todayKey();
      const headerCells = DAY_LABELS.map(
        (label, i) => `<th class="${i === todayIdx ? "fpc-today-col" : ""}">${label}</th>`
      ).join("");

      // Väder per dag, om aktiverat - matcha forecast-poster mot rätt veckodagskolumn
      let weatherWeekRow = "";
      if (cfg.weather && cfg.weather.show_week) {
        const forecast =
          this._forecastCache && this._forecastCache.entity === cfg.weather.entity
            ? this._forecastCache.data
            : [];
        const byDay = {};
        forecast.forEach((f) => {
          const d = new Date(f.datetime);
          if (!isNaN(d.getTime())) byDay[weekdayIndex(d)] = f;
        });
        const cells = DAY_KEYS.map((_, i) => {
          const f = byDay[i];
          if (!f) return `<td class="${i === todayIdx ? "fpc-today-col" : ""}">–</td>`;
          const temp = f.temperature !== undefined ? Math.round(f.temperature) + "°" : "–";
          return `
            <td class="${i === todayIdx ? "fpc-today-col" : ""}">
              <div class="fpc-weather-week-cell">
                <ha-icon icon="${weatherIcon(f.condition)}"></ha-icon>
                <div class="fpc-weather-week-temp">${temp}</div>
              </div>
            </td>
          `;
        }).join("");
        weatherWeekRow = `<tr class="fpc-weather-week-row"><td class="fpc-person-col"></td>${cells}</tr>`;
      }

      const rows = cfg.persons
        .map((p) => {
          const weekState = p.week_entity ? this._stateObj(p.week_entity) : undefined;
          const attrs = weekState ? weekState.attributes : {};
          const cells = DAY_KEYS.map((key, i) => {
            const val = attrs && attrs[key] ? attrs[key] : "–";
            const badge = renderIconBadge(matchIcon(val, cfg.icon_keywords));
            return `<td class="${i === todayIdx ? "fpc-today-col" : ""}">${badge}${fpcEsc(val)}</td>`;
          }).join("");
          return `<tr><td class="fpc-person-col">${fpcEsc(p.name)}</td>${cells}</tr>`;
        })
        .join("");

      tableEl.innerHTML = `
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>${weatherWeekRow}${rows}</tbody>
      `;
    }

    this._updateMonthCalendar();
  }

  _eventsForDate(dateIso) {
    // Samlar alla events för ett datum över alla personer med calendar_entity.
    const cfg = this._config;
    const cache = this._monthEventsCache;
    const results = [];
    if (!cache) return results;
    cfg.persons.forEach((p) => {
      if (!p.calendar_entity) return;
      const events = cache.data[p.calendar_entity] || [];
      events.forEach((ev) => {
        const start = ev.start && (ev.start.dateTime || ev.start.date);
        if (!start) return;
        const evDate = isoDate(new Date(start));
        if (evDate === dateIso) {
          results.push({ ...ev, personName: p.name, personColor: p.color || "var(--primary-color)" });
        }
      });
    });
    return results;
  }

  _vacationColorForDate(dateIso, allEvents) {
    const cfg = this._config;
    if (!cfg.vacation_keywords || cfg.vacation_keywords.length === 0) return null;
    for (const ev of allEvents) {
      const lower = (ev.summary || "").toLowerCase();
      for (const kw of cfg.vacation_keywords) {
        if (kw.match && lower.includes(String(kw.match).toLowerCase())) {
          return kw.color || null;
        }
      }
    }
    return null;
  }

  _finishDrag() {
    if (!this._dragging) return;
    this._dragging = false;
    const start = this._dragStart;
    const end = this._dragEnd;
    if (this._dragMoved && start && end) {
      const startIso = start < end ? start : end;
      const endIso = start < end ? end : start;
      this._creatingEvent = { startIso, endIso };
      this._selectedDate = null;
    } else if (start) {
      this._selectedDate = this._selectedDate === start ? null : start;
    }
    this._dragStart = null;
    this._dragEnd = null;
    this._dragMoved = false;
    this._updateMonthCalendar();
  }

  async _saveNewEvent(targetEntity, summary, startIso, endIso) {
    if (!this._hass || !targetEntity || !summary) return;
    const endExclusive = (() => {
      const d = new Date(endIso);
      d.setDate(d.getDate() + 1);
      return isoDate(d);
    })();
    try {
      await this._hass.callService(
        "calendar",
        "create_event",
        { summary, start_date: startIso, end_date: endExclusive },
        { entity_id: targetEntity }
      );
      this._monthEventsCache = null;
      this._creatingEvent = null;
      await this._maybeFetchMonthEvents();
      this._update();
    } catch (err) {
      // Går inte att skapa (t.ex. skrivskyddad kalender) - lämna formuläret öppet
    }
  }

  _updateMonthCalendar() {
    const cfg = this._config;
    const section = this.querySelector("#fpc-month-section");
    if (!section) return;
    if (!cfg.show_month_calendar) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const calendarPersons = cfg.persons.filter((p) => p.calendar_entity);

    const year = this._calendarViewMonth.getFullYear();
    const month = this._calendarViewMonth.getMonth();
    this.querySelector("#fpc-month-title").textContent = `${MONTH_NAMES[month]} ${year}`;

    // Filter-chips per person
    const filtersEl = this.querySelector("#fpc-month-filters");
    if (calendarPersons.length === 0) {
      filtersEl.innerHTML = "";
    } else {
      filtersEl.innerHTML = calendarPersons
        .map((p) => {
          const active = !this._hiddenPersons.has(p.name);
          return `
            <div class="fpc-filter-chip${active ? " fpc-filter-active" : ""}" data-person="${fpcEsc(p.name)}">
              <div class="fpc-filter-dot" style="background:${p.color || "var(--primary-color)"}"></div>
              ${fpcEsc(p.name)}
            </div>
          `;
        })
        .join("");
      filtersEl.querySelectorAll(".fpc-filter-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const name = chip.getAttribute("data-person");
          if (this._hiddenPersons.has(name)) this._hiddenPersons.delete(name);
          else this._hiddenPersons.add(name);
          this._updateMonthCalendar();
        });
      });
    }

    const gridStart = startOfCalendarGrid(year, month);
    const todayIso = isoDate(new Date());
    const gridEl = this.querySelector("#fpc-month-grid");

    const weekdayHeaders = DAY_LABELS.map((l) => `<div class="fpc-month-weekday">${l}</div>`).join("");

    const dragMin = this._dragging && this._dragStart && this._dragEnd
      ? (this._dragStart < this._dragEnd ? this._dragStart : this._dragEnd)
      : null;
    const dragMax = this._dragging && this._dragStart && this._dragEnd
      ? (this._dragStart < this._dragEnd ? this._dragEnd : this._dragStart)
      : null;

    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const dIso = isoDate(d);
      const outside = d.getMonth() !== month;
      const isToday = dIso === todayIso;
      const isSelected = this._selectedDate === dIso;
      const isDragHighlighted = dragMin && dIso >= dragMin && dIso <= dragMax;
      const allEvents = this._eventsForDate(dIso);
      const visibleEvents = allEvents.filter((ev) => !this._hiddenPersons.has(ev.personName));
      const vacationColor = this._vacationColorForDate(dIso, allEvents);
      const dots = visibleEvents
        .slice(0, 6)
        .map((ev) => `<div class="fpc-month-dot" style="background:${ev.personColor}"></div>`)
        .join("");
      const classes = [
        "fpc-month-cell",
        outside ? "fpc-outside" : "",
        isToday ? "fpc-today-cell" : "",
        isSelected ? "fpc-selected" : "",
        isDragHighlighted ? "fpc-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const bgStyle = vacationColor && !isToday ? ` style="background:${vacationColor}"` : "";
      cells += `
        <div class="${classes}" data-date="${dIso}"${bgStyle}>
          <div class="fpc-month-daynum">${d.getDate()}</div>
          <div class="fpc-month-dots">${dots}</div>
        </div>
      `;
    }

    gridEl.innerHTML = weekdayHeaders + cells;
    gridEl.querySelectorAll(".fpc-month-cell").forEach((cell) => {
      const dIso = cell.getAttribute("data-date");
      cell.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this._dragging = true;
        this._dragMoved = false;
        this._dragStart = dIso;
        this._dragEnd = dIso;
        this._updateMonthCalendar();
      });
      cell.addEventListener("pointerenter", () => {
        if (!this._dragging) return;
        if (this._dragEnd !== dIso) {
          this._dragMoved = true;
          this._dragEnd = dIso;
          this._updateMonthCalendar();
        }
      });
    });

    this._renderMonthDayDetail();
  }

  _renderMonthDayDetail() {
    const cfg = this._config;
    const detailEl = this.querySelector("#fpc-month-daydetail");
    if (!detailEl) return;
    const calendarPersons = cfg.persons.filter((p) => p.calendar_entity);

    if (this._creatingEvent) {
      const { startIso, endIso } = this._creatingEvent;
      const label =
        startIso === endIso
          ? new Date(startIso).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })
          : `${new Date(startIso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} – ${new Date(endIso).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })}`;
      detailEl.innerHTML = `
        <div class="fpc-create-form">
          <div class="fpc-month-daydetail-title">Ny händelse: ${label}</div>
          <input type="text" id="fpc-new-event-title" placeholder="Titel, t.ex. Fotbollsträning" />
          <select id="fpc-new-event-target">
            ${calendarPersons.map((p) => `<option value="${fpcEsc(p.calendar_entity)}">${fpcEsc(p.name)}</option>`).join("")}
          </select>
          <div class="fpc-create-form-actions">
            <button class="fpc-create-cancel" id="fpc-create-cancel">Avbryt</button>
            <button class="fpc-create-save" id="fpc-create-save">Spara</button>
          </div>
        </div>
      `;
      detailEl.querySelector("#fpc-create-cancel").addEventListener("click", () => {
        this._creatingEvent = null;
        this._updateMonthCalendar();
      });
      detailEl.querySelector("#fpc-create-save").addEventListener("click", () => {
        const title = detailEl.querySelector("#fpc-new-event-title").value.trim();
        const target = detailEl.querySelector("#fpc-new-event-target").value;
        if (title && target) {
          this._saveNewEvent(target, title, startIso, endIso);
        }
      });
      return;
    }

    if (!this._selectedDate) {
      detailEl.innerHTML = "";
      return;
    }
    const events = this._eventsForDate(this._selectedDate).filter(
      (ev) => !this._hiddenPersons.has(ev.personName)
    );
    const dateLabel = new Date(this._selectedDate).toLocaleDateString("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    let html = `<div class="fpc-month-daydetail-title">${dateLabel}</div>`;
    if (events.length === 0) {
      html += `<div class="fpc-month-event-empty">Inga händelser</div>`;
    } else {
      html += events
        .map((ev) => {
          const summary = ev.summary || "(utan titel)";
          const badge = renderIconBadge(matchIcon(summary, cfg.icon_keywords));
          return `
            <div class="fpc-month-event">
              <div class="fpc-month-event-dot" style="background:${ev.personColor}"></div>
              <div>${badge}${fpcEsc(summary)} <span style="opacity:0.7">– ${fpcEsc(ev.personName)}</span></div>
            </div>
          `;
        })
        .join("");
    }
    if (calendarPersons.length > 0) {
      html += `<button class="fpc-add-event-btn" id="fpc-add-event-btn">+ Lägg till händelse</button>`;
    }
    detailEl.innerHTML = html;
    const addBtn = detailEl.querySelector("#fpc-add-event-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        this._creatingEvent = { startIso: this._selectedDate, endIso: this._selectedDate };
        this._updateMonthCalendar();
      });
    }
  }

  static getConfigElement() {
    return document.createElement("family-planner-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Familjeplanering",
      countdowns: { max_shown: 5, items: [] },
      weather: null,
      icon_keywords: [],
      show_month_calendar: true,
      vacation_keywords: [],
      tts: null,
      persons: [{ name: "Person 1", entity: "" }],
      general: [],
    };
  }
}

customElements.define("family-planner-card", FamilyPlannerCard);

/* =========================================================================
 * Visuell editor
 * ========================================================================= */

function fpcEsc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

class FamilyPlannerCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = {
      title: config.title || "",
      start_collapsed: !!config.start_collapsed,
      countdowns: {
        max_shown: Number.isFinite(config.countdowns && config.countdowns.max_shown)
          ? config.countdowns.max_shown
          : 5,
        items: (config.countdowns && config.countdowns.items) || [],
      },
      weather: config.weather ? { entity: config.weather.entity || "", show_week: !!config.weather.show_week } : { entity: "", show_week: false },
      icon_keywords: config.icon_keywords || [],
      show_month_calendar: config.show_month_calendar !== false,
      vacation_keywords: config.vacation_keywords || [],
      tts: {
        tts_entity: (config.tts && config.tts.tts_entity) || "",
        media_player: (config.tts && config.tts.media_player) || "",
      },
      persons: config.persons || [],
      general: config.general || [],
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Uppdatera hass på alla entity-pickers utan att bygga om hela UI:t
    this.querySelectorAll("ha-entity-picker").forEach((el) => {
      el.hass = hass;
    });
  }

  _fireChanged() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _mkEntityPicker(value, onChange, placeholder) {
    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = value || "";
      picker.allowCustomEntity = true;
      picker.style.flex = "1";
      picker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        onChange(ev.detail.value || "");
      });
      return picker;
    }
    // Fallback om ha-entity-picker inte är laddad: vanligt textfält
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "entity_id";
    input.style.flex = "1";
    input.addEventListener("change", (ev) => onChange(ev.target.value));
    return input;
  }

  _row(children) {
    const row = document.createElement("div");
    row.className = "fpce-row";
    children.forEach((c) => row.appendChild(c));
    return row;
  }

  _textInput(value, placeholder, onChange, widthCss) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    if (widthCss) input.style.width = widthCss;
    else input.style.flex = "1";
    input.addEventListener("change", (ev) => onChange(ev.target.value));
    return input;
  }

  _removeBtn(onClick) {
    const btn = document.createElement("button");
    btn.className = "fpce-remove";
    btn.type = "button";
    btn.title = "Ta bort";
    btn.textContent = "✕";
    btn.addEventListener("click", onClick);
    return btn;
  }

  _addBtn(label, onClick) {
    const btn = document.createElement("button");
    btn.className = "fpce-add";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  _render() {
    const cfg = this._config;

    this.innerHTML = `
      <style>
        .fpce { padding: 8px 0; }
        .fpce-section {
          margin-bottom: 20px; padding-bottom: 16px;
          border-bottom: 1px solid var(--divider-color);
        }
        .fpce-section:last-child { border-bottom: none; }
        .fpce-section-title {
          font-weight: 500; margin-bottom: 10px; font-size: 1.05em;
        }
        .fpce-row {
          display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
        }
        .fpce-row input[type="text"], .fpce-row input[type="number"] {
          padding: 8px; border: 1px solid var(--divider-color);
          border-radius: 6px; background: var(--card-background-color);
          color: var(--primary-text-color); font-size: 0.9em;
        }
        .fpce-row input[type="color"] { width: 36px; height: 36px; padding: 2px; }
        .fpce-checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .fpce-item-card {
          border: 1px solid var(--divider-color); border-radius: 8px;
          padding: 10px; margin-bottom: 10px;
        }
        .fpce-remove {
          border: none; background: none; color: var(--error-color, #db4437);
          cursor: pointer; font-size: 1em; padding: 4px 8px;
        }
        .fpce-add {
          border: 1px dashed var(--primary-color); background: none;
          color: var(--primary-color); border-radius: 6px; padding: 8px 12px;
          cursor: pointer; font-size: 0.9em; width: 100%;
        }
        .fpce-label { font-size: 0.8em; color: var(--secondary-text-color); margin-bottom: 2px; }
        .fpce-field { display: flex; flex-direction: column; flex: 1; }
      </style>
      <div class="fpce">
        <div class="fpce-section">
          <div class="fpce-section-title">Allmänt</div>
          <div class="fpce-row" id="fpce-title-row"></div>
          <div class="fpce-checkbox-row" id="fpce-collapsed-row"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Nedräkningar</div>
          <div class="fpce-row" id="fpce-maxshown-row"></div>
          <div id="fpce-countdown-list"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Väder</div>
          <div class="fpce-row" id="fpce-weather-entity-row"></div>
          <div class="fpce-checkbox-row" id="fpce-weather-week-row"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Ikon-nyckelord (matchar ord i händelsetext mot en ikon)</div>
          <div id="fpce-keyword-list"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Månadskalender</div>
          <div class="fpce-checkbox-row" id="fpce-monthcal-row"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Semestermarkering (färgar hela dagar i månadskalendern)</div>
          <div id="fpce-vacation-list"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Röstuppläsning (TTS)</div>
          <div class="fpce-row" id="fpce-tts-entity-row"></div>
          <div class="fpce-row" id="fpce-tts-player-row"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Personer</div>
          <div id="fpce-person-list"></div>
        </div>
        <div class="fpce-section">
          <div class="fpce-section-title">Allmänna sensorer (visas som rund ikon när "on")</div>
          <div id="fpce-general-list"></div>
        </div>
      </div>
    `;

    // Titel
    const titleField = document.createElement("div");
    titleField.className = "fpce-field";
    titleField.innerHTML = `<div class="fpce-label">Titel</div>`;
    const titleInput = this._textInput(cfg.title, "Familjeplanering", (val) => {
      this._config = { ...this._config, title: val };
      this._fireChanged();
    });
    titleField.appendChild(titleInput);
    this.querySelector("#fpce-title-row").appendChild(titleField);

    // Start collapsed
    const collapsedRow = this.querySelector("#fpce-collapsed-row");
    const collapsedCheckbox = document.createElement("input");
    collapsedCheckbox.type = "checkbox";
    collapsedCheckbox.checked = cfg.start_collapsed;
    collapsedCheckbox.addEventListener("change", (ev) => {
      this._config = { ...this._config, start_collapsed: ev.target.checked };
      this._fireChanged();
    });
    const collapsedLabel = document.createElement("label");
    collapsedLabel.textContent = 'Starta "Idag"-sektionen ihopfälld';
    collapsedRow.appendChild(collapsedCheckbox);
    collapsedRow.appendChild(collapsedLabel);

    // Max shown
    const maxField = document.createElement("div");
    maxField.className = "fpce-field";
    maxField.innerHTML = `<div class="fpce-label">Hur många nedräkningar som visas normalt</div>`;
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.value = cfg.countdowns.max_shown;
    maxInput.style.width = "80px";
    maxInput.addEventListener("change", (ev) => {
      const n = parseInt(ev.target.value, 10);
      this._config = {
        ...this._config,
        countdowns: { ...this._config.countdowns, max_shown: isNaN(n) ? 5 : n },
      };
      this._fireChanged();
    });
    maxField.appendChild(maxInput);
    this.querySelector("#fpce-maxshown-row").appendChild(maxField);

    // Ikon-nyckelord
    const kwListEl = this.querySelector("#fpce-keyword-list");
    cfg.icon_keywords.forEach((kw, idx) => {
      const card = document.createElement("div");
      card.className = "fpce-item-card";

      const matchInput = this._textInput(kw.match, "Ord att matcha, t.ex. fotboll", (val) => {
        const icon_keywords = [...this._config.icon_keywords];
        icon_keywords[idx] = { ...icon_keywords[idx], match: val };
        this._config = { ...this._config, icon_keywords };
        this._fireChanged();
      });

      const iconInput = this._textInput(kw.icon, "⚽, mdi:soccer, eller bild-URL", (val) => {
        const icon_keywords = [...this._config.icon_keywords];
        icon_keywords[idx] = { ...icon_keywords[idx], icon: val };
        this._config = { ...this._config, icon_keywords };
        preview.innerHTML = renderIconBadge(val);
        this._fireChanged();
      }, "140px");

      const preview = document.createElement("div");
      preview.innerHTML = renderIconBadge(kw.icon);

      const removeBtn = this._removeBtn(() => {
        const icon_keywords = this._config.icon_keywords.filter((_, i) => i !== idx);
        this._config = { ...this._config, icon_keywords };
        this._fireChanged();
        this._render();
      });

      card.appendChild(this._row([matchInput, iconInput, preview, removeBtn]));
      kwListEl.appendChild(card);
    });
    kwListEl.appendChild(
      this._addBtn("+ Lägg till nyckelord", () => {
        const icon_keywords = [...this._config.icon_keywords, { match: "", icon: "" }];
        this._config = { ...this._config, icon_keywords };
        this._fireChanged();
        this._render();
      })
    );

    // Väder
    const weatherEntityField = document.createElement("div");
    weatherEntityField.className = "fpce-field";
    weatherEntityField.innerHTML = `<div class="fpce-label">Väder-entitet (weather.*)</div>`;
    weatherEntityField.appendChild(
      this._mkEntityPicker(cfg.weather.entity, (val) => {
        this._config = { ...this._config, weather: { ...this._config.weather, entity: val } };
        this._fireChanged();
      })
    );
    this.querySelector("#fpce-weather-entity-row").appendChild(weatherEntityField);

    const weatherWeekRowEl = this.querySelector("#fpce-weather-week-row");
    const weatherWeekCheckbox = document.createElement("input");
    weatherWeekCheckbox.type = "checkbox";
    weatherWeekCheckbox.checked = cfg.weather.show_week;
    weatherWeekCheckbox.addEventListener("change", (ev) => {
      this._config = { ...this._config, weather: { ...this._config.weather, show_week: ev.target.checked } };
      this._fireChanged();
    });
    const weatherWeekLabel = document.createElement("label");
    weatherWeekLabel.textContent = "Visa väderprognos för veckans dagar";
    weatherWeekRowEl.appendChild(weatherWeekCheckbox);
    weatherWeekRowEl.appendChild(weatherWeekLabel);

    // Countdown items
    const cdListEl = this.querySelector("#fpce-countdown-list");    cfg.countdowns.items.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "fpce-item-card";

      const entityField = document.createElement("div");
      entityField.className = "fpce-field";
      entityField.innerHTML = `<div class="fpce-label">Entitet (state = datum)</div>`;
      const entityPicker = this._mkEntityPicker(item.entity, (val) => {
        const items = [...this._config.countdowns.items];
        items[idx] = { ...items[idx], entity: val };
        this._config = { ...this._config, countdowns: { ...this._config.countdowns, items } };
        this._fireChanged();
      });
      entityField.appendChild(entityPicker);

      const nameInput = this._textInput(item.name, "Namn", (val) => {
        const items = [...this._config.countdowns.items];
        items[idx] = { ...items[idx], name: val };
        this._config = { ...this._config, countdowns: { ...this._config.countdowns, items } };
        this._fireChanged();
      }, "140px");

      const pinnedLabel = document.createElement("label");
      pinnedLabel.style.display = "flex";
      pinnedLabel.style.alignItems = "center";
      pinnedLabel.style.gap = "4px";
      pinnedLabel.style.fontSize = "0.85em";
      const pinnedCheckbox = document.createElement("input");
      pinnedCheckbox.type = "checkbox";
      pinnedCheckbox.checked = !!item.pinned;
      pinnedCheckbox.addEventListener("change", (ev) => {
        const items = [...this._config.countdowns.items];
        items[idx] = { ...items[idx], pinned: ev.target.checked };
        this._config = { ...this._config, countdowns: { ...this._config.countdowns, items } };
        this._fireChanged();
      });
      pinnedLabel.appendChild(pinnedCheckbox);
      pinnedLabel.appendChild(document.createTextNode("Visa alltid"));

      const removeBtn = this._removeBtn(() => {
        const items = this._config.countdowns.items.filter((_, i) => i !== idx);
        this._config = { ...this._config, countdowns: { ...this._config.countdowns, items } };
        this._fireChanged();
        this._render();
      });

      card.appendChild(this._row([entityField, nameInput, pinnedLabel, removeBtn]));
      cdListEl.appendChild(card);
    });
    cdListEl.appendChild(
      this._addBtn("+ Lägg till nedräkning", () => {
        const items = [...this._config.countdowns.items, { entity: "", name: "", pinned: false }];
        this._config = { ...this._config, countdowns: { ...this._config.countdowns, items } };
        this._fireChanged();
        this._render();
      })
    );

    // Månadskalender - visa/dölj
    const monthCalRow = this.querySelector("#fpce-monthcal-row");
    const monthCalCheckbox = document.createElement("input");
    monthCalCheckbox.type = "checkbox";
    monthCalCheckbox.checked = cfg.show_month_calendar;
    monthCalCheckbox.addEventListener("change", (ev) => {
      this._config = { ...this._config, show_month_calendar: ev.target.checked };
      this._fireChanged();
    });
    const monthCalLabel = document.createElement("label");
    monthCalLabel.textContent = "Visa månadskalender under veckoschemat";
    monthCalRow.appendChild(monthCalCheckbox);
    monthCalRow.appendChild(monthCalLabel);

    // Semestermarkering
    const vacListEl = this.querySelector("#fpce-vacation-list");
    cfg.vacation_keywords.forEach((kw, idx) => {
      const card = document.createElement("div");
      card.className = "fpce-item-card";

      const matchInput = this._textInput(kw.match, "Ord att matcha, t.ex. lov", (val) => {
        const vacation_keywords = [...this._config.vacation_keywords];
        vacation_keywords[idx] = { ...vacation_keywords[idx], match: val };
        this._config = { ...this._config, vacation_keywords };
        this._fireChanged();
      });

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = /^#[0-9a-fA-F]{6}$/.test(kw.color) ? kw.color : "#c8f7c5";
      colorInput.addEventListener("change", (ev) => {
        const vacation_keywords = [...this._config.vacation_keywords];
        vacation_keywords[idx] = { ...vacation_keywords[idx], color: ev.target.value };
        this._config = { ...this._config, vacation_keywords };
        this._fireChanged();
      });

      const removeBtn = this._removeBtn(() => {
        const vacation_keywords = this._config.vacation_keywords.filter((_, i) => i !== idx);
        this._config = { ...this._config, vacation_keywords };
        this._fireChanged();
        this._render();
      });

      card.appendChild(this._row([matchInput, colorInput, removeBtn]));
      vacListEl.appendChild(card);
    });
    vacListEl.appendChild(
      this._addBtn("+ Lägg till semestermarkering", () => {
        const vacation_keywords = [...this._config.vacation_keywords, { match: "", color: "#c8f7c5" }];
        this._config = { ...this._config, vacation_keywords };
        this._fireChanged();
        this._render();
      })
    );

    // TTS
    const ttsEntityField = document.createElement("div");
    ttsEntityField.className = "fpce-field";
    ttsEntityField.innerHTML = `<div class="fpce-label">TTS-entitet (tts.*)</div>`;
    ttsEntityField.appendChild(
      this._mkEntityPicker(cfg.tts.tts_entity, (val) => {
        this._config = { ...this._config, tts: { ...this._config.tts, tts_entity: val } };
        this._fireChanged();
      })
    );
    this.querySelector("#fpce-tts-entity-row").appendChild(ttsEntityField);

    const ttsPlayerField = document.createElement("div");
    ttsPlayerField.className = "fpce-field";
    ttsPlayerField.innerHTML = `<div class="fpce-label">Högtalare (media_player.*)</div>`;
    ttsPlayerField.appendChild(
      this._mkEntityPicker(cfg.tts.media_player, (val) => {
        this._config = { ...this._config, tts: { ...this._config.tts, media_player: val } };
        this._fireChanged();
      })
    );
    this.querySelector("#fpce-tts-player-row").appendChild(ttsPlayerField);

    // Persons
    const personListEl = this.querySelector("#fpce-person-list");
    cfg.persons.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "fpce-item-card";

      const nameField = document.createElement("div");
      nameField.className = "fpce-field";
      nameField.innerHTML = `<div class="fpce-label">Namn</div>`;
      nameField.appendChild(
        this._textInput(p.name, "Namn", (val) => {
          const persons = [...this._config.persons];
          persons[idx] = { ...persons[idx], name: val };
          this._config = { ...this._config, persons };
          this._fireChanged();
        })
      );

      const entityField = document.createElement("div");
      entityField.className = "fpce-field";
      entityField.innerHTML = `<div class="fpce-label">Entitet (idag-text)</div>`;
      entityField.appendChild(
        this._mkEntityPicker(p.entity, (val) => {
          const persons = [...this._config.persons];
          persons[idx] = { ...persons[idx], entity: val };
          this._config = { ...this._config, persons };
          this._fireChanged();
        })
      );

      const weekField = document.createElement("div");
      weekField.className = "fpce-field";
      weekField.innerHTML = `<div class="fpce-label">Vecko-entitet (valfri)</div>`;
      weekField.appendChild(
        this._mkEntityPicker(p.week_entity, (val) => {
          const persons = [...this._config.persons];
          persons[idx] = { ...persons[idx], week_entity: val };
          this._config = { ...this._config, persons };
          this._fireChanged();
        })
      );

      const calField = document.createElement("div");
      calField.className = "fpce-field";
      calField.innerHTML = `<div class="fpce-label">Kalender-entitet för månadsvyn (valfri, calendar.*)</div>`;
      calField.appendChild(
        this._mkEntityPicker(p.calendar_entity, (val) => {
          const persons = [...this._config.persons];
          persons[idx] = { ...persons[idx], calendar_entity: val };
          this._config = { ...this._config, persons };
          this._fireChanged();
        })
      );

      const removeBtn = this._removeBtn(() => {
        const persons = this._config.persons.filter((_, i) => i !== idx);
        this._config = { ...this._config, persons };
        this._fireChanged();
        this._render();
      });

      card.appendChild(this._row([nameField, removeBtn]));
      card.appendChild(this._row([entityField]));
      card.appendChild(this._row([weekField]));
      card.appendChild(this._row([calField]));

      const iconInput = this._textInput(p.icon, "mdi:account", (val) => {
        const persons = [...this._config.persons];
        persons[idx] = { ...persons[idx], icon: val };
        this._config = { ...this._config, persons };
        this._fireChanged();
      });
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#03a9f4";
      colorInput.addEventListener("change", (ev) => {
        const persons = [...this._config.persons];
        persons[idx] = { ...persons[idx], color: ev.target.value };
        this._config = { ...this._config, persons };
        this._fireChanged();
      });
      card.appendChild(this._row([iconInput, colorInput]));

      personListEl.appendChild(card);
    });
    personListEl.appendChild(
      this._addBtn("+ Lägg till person", () => {
        const persons = [...this._config.persons, { name: "", entity: "" }];
        this._config = { ...this._config, persons };
        this._fireChanged();
        this._render();
      })
    );

    // General sensors
    const generalListEl = this.querySelector("#fpce-general-list");
    cfg.general.forEach((g, idx) => {
      const card = document.createElement("div");
      card.className = "fpce-item-card";

      const entityField = document.createElement("div");
      entityField.className = "fpce-field";
      entityField.innerHTML = `<div class="fpce-label">Entitet (binary_sensor)</div>`;
      entityField.appendChild(
        this._mkEntityPicker(g.entity, (val) => {
          const general = [...this._config.general];
          general[idx] = { ...general[idx], entity: val };
          this._config = { ...this._config, general };
          this._fireChanged();
        })
      );

      const nameInput = this._textInput(g.name, "Namn", (val) => {
        const general = [...this._config.general];
        general[idx] = { ...general[idx], name: val };
        this._config = { ...this._config, general };
        this._fireChanged();
      }, "120px");

      const iconInput = this._textInput(g.icon, "mdi:bell", (val) => {
        const general = [...this._config.general];
        general[idx] = { ...general[idx], icon: val };
        this._config = { ...this._config, general };
        this._fireChanged();
      }, "120px");

      const removeBtn = this._removeBtn(() => {
        const general = this._config.general.filter((_, i) => i !== idx);
        this._config = { ...this._config, general };
        this._fireChanged();
        this._render();
      });

      card.appendChild(this._row([entityField]));
      card.appendChild(this._row([nameInput, iconInput, removeBtn]));

      generalListEl.appendChild(card);
    });
    generalListEl.appendChild(
      this._addBtn("+ Lägg till allmän sensor", () => {
        const general = [...this._config.general, { entity: "", name: "", icon: "" }];
        this._config = { ...this._config, general };
        this._fireChanged();
        this._render();
      })
    );
  }
}

customElements.define("family-planner-card-editor", FamilyPlannerCardEditor);

// Registrera i kortväljaren i UI-editorn
window.customCards = window.customCards || [];
window.customCards.push({
  type: "family-planner-card",
  name: "Family Planner Card",
  description: "Dagens händelser per person + veckoschema",
});
