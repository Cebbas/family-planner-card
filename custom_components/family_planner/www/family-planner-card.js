/*
 * Family Planner Card
 * -----------------------------------------------------------------------
 * En egen Lovelace-card för Home Assistant.
 *
 * Kortet har ingen egen konfiguration - allt (personer, kalendrar,
 * nedräkningar, väder, ikon-nyckelord, TTS, allmänna sensorer, m.m.)
 * sätts upp en gång i sidopanelen "Familjeplanering" och delas av alla
 * Family Planner-kort på den här HA-instansen. Lägg bara till kortet:
 *
 * type: custom:family-planner-card
 *
 * Övre delen ("Idag"):
 *   - En rad per person. Varje person kan ha flera `entities` (text-
 *     sensorer) - varje sensor med ett icke-tomt state får sin egen rad
 *     under personens namn.
 *   - En "allmän rad" med sensorer som bara visas som en rund ikon om
 *     entiteten är "on".
 *   Hela "Idag"-sektionen kan fällas ihop/ut.
 *
 * Vecka + månad:
 *   - Samma `calendar_entity` per person driver både veckoschemat och
 *     månadskalendern - ingen separat "week_entity".
 *   - Kalendrar som inte hör till en specifik person läggs under
 *     "Delade kalendrar" i panelen och samlas i en delad rad
 *     (`calendars_label`) i veckoschemat, plus egna filter/prickar i
 *     månadskalendern.
 *
 * -----------------------------------------------------------------------
 * Installation: den här filen serveras och laddas automatiskt av den
 * medföljande Home Assistant-integrationen
 * (custom_components/family_planner) - installera den (HACS-kategorin
 * "Integration", eller manuellt) och lägg till den under Inställningar
 * → Enheter & tjänster → Lägg till integration → "Family Planner".
 * Ingen manuell Lovelace-resurs behövs. Öppna sedan sidopanelen
 * "Familjeplanering" i sidomenyn för att sätta upp familjen, och lägg
 * till kortet på valfritt dashboard.
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
// Nyckel som binder en person till en "borta hos andra föräldern"-kalender
// (away_calendars[].persons) - namnet om satt, annars person_entity-id:t.
// Samma logik används i sidopanelen när kryssrutorna för barn sparas.
function personMatchKey(p) {
  return (p && (p.name || p.person_entity)) || "";
}

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

// Datumintervall [start, end] (båda inklusive, "YYYY-MM-DD") som en
// kalenderhändelse täcker. Heldagshändelsers slutdatum är exklusivt
// enligt iCal-spec (en helg fre-sön har end.date = måndagen), så det
// dras av en dag för att bli inklusivt och jämförbart mot dateIso.
function eventDateRange(ev) {
  const startRaw = ev.start && (ev.start.dateTime || ev.start.date);
  if (!startRaw) return null;
  const endRaw = (ev.end && (ev.end.dateTime || ev.end.date)) || startRaw;
  const isAllDayEnd = !!(ev.end && ev.end.date && !ev.end.dateTime);
  const start = isoDate(new Date(startRaw));
  const endDate = new Date(endRaw);
  if (isAllDayEnd) endDate.setDate(endDate.getDate() - 1);
  const end = isoDate(endDate);
  return { start, end: end < start ? start : end };
}

// Täcker händelsen ett givet datum - används för både flerdagars
// semester-/borta-markeringar i månadsvyn och för att visa flerdagars-
// händelser (t.ex. en hel "borta"-helg) varje dag de pågår i veckoschemat,
// inte bara på startdagen.
function eventCoversDate(ev, dateIso) {
  const range = eventDateRange(ev);
  return !!range && dateIso >= range.start && dateIso <= range.end;
}

// Pågår händelsen just nu (används för att gråa ut ett barn som är borta
// i Idag-vyn) - till skillnad från eventCoversDate jobbar den här med
// faktiska tidpunkter, inte hela dagar, så en tidsatt hämtning kl 18:00
// slutar räknas som "borta" direkt efteråt.
function eventCoversNow(ev) {
  const startRaw = ev.start && (ev.start.dateTime || ev.start.date);
  if (!startRaw) return false;
  const isAllDay = !!(ev.start && ev.start.date && !ev.start.dateTime);
  if (isAllDay) return eventCoversDate(ev, isoDate(new Date()));
  const endRaw = (ev.end && (ev.end.dateTime || ev.end.date)) || startRaw;
  const now = new Date();
  return now >= new Date(startRaw) && now < new Date(endRaw);
}

// Tilldelar varje händelse (objekt med startCol/endCol, 0-6 inom en
// veckorad) en "lane" (rad) så att inga två händelser i samma lane
// överlappar i kolumn - klassisk girig intervallschemaläggning, samma
// princip kalenderappar använder för att stapla överlappande händelser
// utan krock. Sorterar på startkolumn, sedan längst först, så
// flerdagarshändelser hamnar överst. Muterar inte indata - returnerar
// en ny array (samma objekt, plus `lane`) och antal lanes som användes.
function packEventLanes(events) {
  const sorted = [...events].sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return b.endCol - b.startCol - (a.endCol - a.startCol);
  });
  const laneEnds = [];
  const placed = sorted.map((ev) => {
    let lane = laneEnds.findIndex((end) => end < ev.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.endCol);
    } else {
      laneEnds[lane] = ev.endCol;
    }
    return { ...ev, lane };
  });
  return { events: placed, laneCount: laneEnds.length };
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

function fpcEsc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

class FamilyPlannerCard extends HTMLElement {
  constructor() {
    super();
    // Shadow DOM isolerar varje kort-instans - annars kolliderar de
    // hårdkodade id:na (#fpc-header m.fl.) om samma kort läggs flera
    // gånger på en dashboard.
    this.attachShadow({ mode: "open" });
    this._collapsed = false;
    this._built = false;
    const today = new Date();
    this._calendarViewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this._hiddenSources = new Set();
    this._dragging = false;
    this._dragMoved = false;
    this._dragStart = null;
    this._dragEnd = null;
    this._creatingEvent = null; // { startIso, endIso, targetEntity }
  }

  // Delas mellan lokal YAML-parsning och delad konfiguration från
  // sidopanelen - hoppar tyst över ogiltiga poster istället för att
  // krascha kortet när delad data laddas asynkront.
  _normalizePersons(list) {
    return (Array.isArray(list) ? list : [])
      .filter((p) => p && (p.name || p.person_entity))
      .map((p) => ({
        name: p.name || "",
        person_entity: p.person_entity || null,
        entities: Array.isArray(p.entities) ? p.entities : p.entities ? [p.entities] : [],
        calendar_entity: p.calendar_entity || null,
        icon: p.icon || "mdi:account",
        color: p.color || null,
        icon_keywords: Array.isArray(p.icon_keywords) ? p.icon_keywords : [],
      }));
  }

  _normalizeCalendars(list) {
    return (Array.isArray(list) ? list : [])
      .filter((c) => c && c.entity)
      .map((c) => ({
        entity: c.entity,
        name: c.name || c.entity,
        color: c.color || "var(--secondary-text-color)",
      }));
  }

  _normalizeAwayCalendars(list) {
    return (Array.isArray(list) ? list : [])
      .filter((a) => a && a.entity)
      .map((a) => ({
        entity: a.entity,
        name: a.name || a.entity,
        color: a.color || "#95a5a6",
        persons: Array.isArray(a.persons) ? a.persons : [],
      }));
  }

  // Startvärden innan den delade konfigurationen har hunnit laddas -
  // håller _render()/_update() säkra att köra på en tom uppsättning.
  _defaultConfig() {
    return {
      title: "Familjeplanering",
      persons: [],
      calendars: [],
      calendars_label: "Övrigt",
      away_calendars: [],
      general: [],
      start_collapsed: false,
      countdowns: { max_shown: 5, items: [] },
      weather: null,
      icon_keywords: [],
      show_month_calendar: true,
      vacation_keywords: [],
      tts: null,
    };
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Ingen konfiguration angiven");
    }
    // Kortet har ingen egen konfiguration - allt hämtas från sidopanelen
    // "Familjeplanering" (se _maybeLoadSharedConfig) så att alla kort på
    // instansen alltid visar samma familj.
    this._config = this._defaultConfig();
    this._collapsed = false;
    this._collapsedInitialized = false;
    this._sharedConfigCache = null;
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
    this._maybeFetchWeekEvents();
    this._maybeFetchAwayStatus();
    this._maybeLoadSharedConfig();
  }

  // Hämtar hela konfigurationen (personer/kalendrar/nedräkningar/väder/
  // m.m.) från Family Planner-integrationens delade lagring. Kräver att
  // custom_components/family_planner är installerad och tillagd
  // (Inställningar → Enheter & tjänster → Family Planner) - annars är
  // family_planner/get_config ett okänt kommando och vi hamnar tyst i
  // catch-blocket nedan (visas som tomt kort).
  async _maybeLoadSharedConfig() {
    if (!this._hass) return;
    if (this._sharedConfigLoading) return;
    const cache = this._sharedConfigCache;
    const fresh = cache && Date.now() - cache.fetchedAt < 5 * 60 * 1000;
    if (fresh) return;

    this._sharedConfigLoading = true;
    try {
      const result = await this._hass.callWS({ type: "family_planner/get_config" });
      const data = (result && result.value) || {};
      const countdownCfg = data.countdowns || {};
      const weatherCfg = data.weather || {};
      this._config = {
        title: data.title || "Familjeplanering",
        persons: this._normalizePersons(data.persons),
        calendars: this._normalizeCalendars(data.calendars),
        calendars_label: data.calendars_label || "Övrigt",
        away_calendars: this._normalizeAwayCalendars(data.away_calendars),
        general: Array.isArray(data.general) ? data.general : [],
        start_collapsed: !!data.start_collapsed,
        countdowns: {
          max_shown: Number.isFinite(countdownCfg.max_shown) ? countdownCfg.max_shown : 5,
          items: Array.isArray(countdownCfg.items) ? countdownCfg.items : [],
        },
        weather: weatherCfg.entity
          ? { entity: weatherCfg.entity, show_week: !!weatherCfg.show_week }
          : null,
        icon_keywords: Array.isArray(data.icon_keywords) ? data.icon_keywords : [],
        show_month_calendar: data.show_month_calendar !== false,
        vacation_keywords: Array.isArray(data.vacation_keywords) ? data.vacation_keywords : [],
        tts:
          data.tts && data.tts.tts_entity && data.tts.media_player
            ? { tts_entity: data.tts.tts_entity, media_player: data.tts.media_player }
            : null,
      };
      // Bara vid allra första laddningen - annars skulle en cache-
      // uppdatering var 5:e minut nollställa ett kort användaren redan
      // manuellt fällt ut/ihop.
      if (!this._collapsedInitialized) {
        this._collapsed = this._config.start_collapsed;
        this._collapsedInitialized = true;
      }
      this._sharedConfigCache = { fetchedAt: Date.now() };
    } catch (err) {
      // Integrationen kanske inte är installerad/tillagd än - visas som tomt kort.
    } finally {
      // Alltid nollställd, annars fastnar hämtningen i "laddar" för alltid
      // om något oväntat kastar fel ovan.
      this._sharedConfigLoading = false;
    }
    this._update();
    this._maybeFetchMonthEvents();
    this._maybeFetchWeekEvents();
    this._maybeFetchForecast();
    this._maybeFetchAwayStatus();
  }

  // Hämtar händelser för alla "borta hos andra föräldern"-kalendrar för
  // ett fönster kring idag (igår-imorgon, för att säkert fånga en helg-
  // händelse som redan pågår när kortet laddas) - används för att gråa ut
  // ett barn i Idag-vyn medan de är borta, se _isPersonAwayNow().
  async _maybeFetchAwayStatus() {
    const cfg = this._config;
    const awayCals = (cfg && cfg.away_calendars) || [];
    if (awayCals.length === 0 || !this._hass) return;
    const cache = this._awayEventsCache;
    const fresh = cache && Date.now() - cache.fetchedAt < 5 * 60 * 1000;
    if (fresh || this._awayLoading) return;

    this._awayLoading = true;
    try {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
      const entityIds = [...new Set(awayCals.map((a) => a.entity))];
      const data = await this._fetchCalendarEvents(entityIds, start, end);
      this._awayEventsCache = { fetchedAt: Date.now(), data };
    } finally {
      this._awayLoading = false;
    }
    this._update();
  }

  // Är personen just nu borta hos andra föräldern - dvs täcks "nu" av en
  // händelse i någon av de "borta"-kalendrar som är bundna till dem
  // (via away_calendars[].persons, se personMatchKey/_calendarSources).
  _isPersonAwayNow(p) {
    const cfg = this._config;
    const cache = this._awayEventsCache;
    if (!cache) return false;
    const key = personMatchKey(p);
    if (!key) return false;
    return (cfg.away_calendars || [])
      .filter((a) => (a.persons || []).includes(key))
      .some((a) => (cache.data[a.entity] || []).some((ev) => eventCoversNow(ev)));
  }

  // Alla kalenderkällor - personers egna calendar_entity, "borta hos andra
  // föräldern"-kalendrar bundna till 1+ personer, och fristående "calendars"
  // som inte hör till någon person - i ett enhetligt format som veckoschema,
  // månadskalender och Idag-vyns "borta nu"-koll alla bygger på. En källa
  // hör till en persons rad om personIdxs innehåller personens index;
  // personIdxs: [] betyder att den hamnar i den delade "Övrigt"-raden.
  _calendarSources() {
    const cfg = this._config;
    if (!cfg) return [];
    // Nycklas på index, inte namn - två personer med samma (eller tomt)
    // namn ska inte kunna krocka och tappa varandras vecko-/månadsdata.
    const personSources = cfg.persons
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.calendar_entity)
      .map(({ p, idx }) => ({
        key: `person:${idx}`,
        name: this._personDisplay(p).name,
        color: p.color || "var(--primary-color)",
        calendar_entity: p.calendar_entity,
        personIdxs: [idx],
        isAway: false,
        iconKeywords: this._iconKeywordsFor(p),
      }));
    const awaySources = (cfg.away_calendars || [])
      .filter((a) => a.entity)
      .map((a, awayIdx) => ({
        key: `away:${awayIdx}`,
        name: a.name || a.entity,
        color: a.color || "#95a5a6",
        calendar_entity: a.entity,
        personIdxs: cfg.persons
          .map((p, idx) => idx)
          .filter((idx) => (a.persons || []).includes(personMatchKey(cfg.persons[idx]))),
        isAway: true,
        iconKeywords: [],
      }));
    const sharedSources = (cfg.calendars || []).map((c) => ({
      key: `cal:${c.entity}`,
      name: c.name,
      color: c.color,
      calendar_entity: c.entity,
      personIdxs: [],
      isAway: false,
      iconKeywords: cfg.icon_keywords,
    }));
    return [...personSources, ...awaySources, ...sharedSources];
  }

  _startOfThisWeek() {
    const today = new Date();
    const idx = weekdayIndex(today);
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() - idx);
  }

  async _fetchCalendarEvents(entityIds, start, end) {
    const data = {};
    for (const entityId of entityIds) {
      try {
        const events = await this._hass.callApi(
          "GET",
          `calendars/${entityId}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
        );
        data[entityId] = Array.isArray(events) ? events : [];
      } catch (err) {
        data[entityId] = [];
      }
    }
    return data;
  }

  async _maybeFetchMonthEvents() {
    const cfg = this._config;
    if (!cfg || !cfg.show_month_calendar || !this._hass) return;
    const sources = this._calendarSources();
    if (sources.length === 0) return;

    const year = this._calendarViewMonth.getFullYear();
    const month = this._calendarViewMonth.getMonth();
    const monthKey = `${year}-${month}`;
    const cache = this._monthEventsCache;
    const fresh = cache && cache.key === monthKey && Date.now() - cache.fetchedAt < 5 * 60 * 1000;
    if (fresh || this._monthEventsLoading) return;

    this._monthEventsLoading = true;
    try {
      const gridStart = startOfCalendarGrid(year, month);
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridEnd.getDate() + 42);

      const entityIds = [...new Set(sources.map((s) => s.calendar_entity))];
      const data = await this._fetchCalendarEvents(entityIds, gridStart, gridEnd);
      this._monthEventsCache = { key: monthKey, fetchedAt: Date.now(), data };
    } finally {
      this._monthEventsLoading = false;
    }
    this._update();
  }

  async _maybeFetchWeekEvents() {
    const cfg = this._config;
    if (!cfg || !this._hass) return;
    const sources = this._calendarSources();
    if (sources.length === 0) return;

    const monday = this._startOfThisWeek();
    const weekKey = isoDate(monday);
    const cache = this._weekEventsCache;
    const fresh = cache && cache.key === weekKey && Date.now() - cache.fetchedAt < 5 * 60 * 1000;
    if (fresh || this._weekEventsLoading) return;

    this._weekEventsLoading = true;
    try {
      const end = new Date(monday);
      end.setDate(end.getDate() + 7);
      const entityIds = [...new Set(sources.map((s) => s.calendar_entity))];
      const data = await this._fetchCalendarEvents(entityIds, monday, end);
      this._weekEventsCache = { key: weekKey, fetchedAt: Date.now(), data };
    } finally {
      this._weekEventsLoading = false;
    }
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
    const cfg = this._config;
    const persons = cfg ? cfg.persons.length : 1;
    const sharedRow = cfg && cfg.calendars && cfg.calendars.length > 0 ? 1 : 0;
    return 3 + persons + sharedRow;
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

  // Namn + ev. profilbild för en person - hämtas från person_entity i HA
  // om satt (friendly_name/entity_picture), annars det manuellt satta namnet.
  _personDisplay(p) {
    const st = p.person_entity ? this._stateObj(p.person_entity) : undefined;
    const name = p.name || (st && st.attributes.friendly_name) || p.person_entity || "?";
    const picture = st && st.attributes.entity_picture ? st.attributes.entity_picture : null;
    return { name, picture };
  }

  // Person-specifika ikon-nyckelord vinner över globala (matchIcon tar
  // första träffen), så samma ord kan ge olika bild/ikon per person.
  _iconKeywordsFor(p) {
    const cfg = this._config;
    const personKw = (p && p.icon_keywords) || [];
    return [...personKw, ...cfg.icon_keywords];
  }

  // Text-rader för "Idag" - en rad per entitet i p.entities med ett
  // "riktigt" state. Om alla är tomma/okonfigurerade visas en enda
  // placeholder-rad istället för flera identiska "Inget planerat idag".
  _personTodayLines(p) {
    const ids = Array.isArray(p.entities) ? p.entities : [];
    if (ids.length === 0) return ["Inget planerat idag"];
    const texts = ids.map((eid) => this._friendlyState(eid));
    const real = texts.filter((t) => t !== "Inget planerat idag");
    return real.length > 0 ? real : ["Inget planerat idag"];
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
        .fpc-person-away { opacity: 0.45; filter: grayscale(1); }
        .fpc-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; color: white; overflow: hidden;
        }
        .fpc-avatar-img { width: 100%; height: 100%; object-fit: cover; }
        .fpc-person-info { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
        .fpc-person-name { font-weight: 500; font-size: 0.95em; }
        .fpc-person-state-line {
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
          position: relative; min-height: 46px; border-radius: 8px; padding: 4px;
          display: flex; flex-direction: column; align-items: flex-start;
          cursor: pointer; background: var(--secondary-background-color, rgba(127,127,127,0.06));
        }
        .fpc-month-cell.fpc-outside { opacity: 0.35; }
        .fpc-month-cell.fpc-today-cell {
          background: var(--primary-color); color: white;
        }
        .fpc-month-cell.fpc-selected { outline: 2px solid var(--primary-color); }
        .fpc-month-daynum { font-size: 0.82em; }
        .fpc-month-event-bar {
          align-self: start; justify-self: stretch; height: 13px; border-radius: 3px;
          margin-left: 1px; margin-right: 1px; pointer-events: none;
          color: white; font-size: 0.62em; line-height: 13px; padding: 0 3px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .fpc-month-event-bar .fpc-kw-icon, .fpc-month-event-bar .fpc-kw-emoji {
          --mdc-icon-size: 11px; margin-right: 2px; vertical-align: -1px;
        }
        .fpc-month-overflow {
          position: absolute; right: 3px; bottom: 2px; font-size: 0.62em;
          color: var(--secondary-text-color); font-weight: 600;
        }
        .fpc-month-cell.fpc-today-cell .fpc-month-overflow { color: white; opacity: 0.85; }
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

    this.shadowRoot.innerHTML = `
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

    this.shadowRoot.querySelector("#fpc-header").addEventListener("click", () => {
      this._collapsed = !this._collapsed;
      this.shadowRoot.querySelector("#fpc-today").classList.toggle("collapsed", this._collapsed);
      this.shadowRoot.querySelector("#fpc-toggle").classList.toggle("collapsed", this._collapsed);
    });

    this.shadowRoot.querySelector("#fpc-month-prev").addEventListener("click", () => {
      this._calendarViewMonth = new Date(
        this._calendarViewMonth.getFullYear(),
        this._calendarViewMonth.getMonth() - 1,
        1
      );
      this._selectedDate = null;
      this._maybeFetchMonthEvents();
      this._update();
    });
    this.shadowRoot.querySelector("#fpc-month-next").addEventListener("click", () => {
      this._calendarViewMonth = new Date(
        this._calendarViewMonth.getFullYear(),
        this._calendarViewMonth.getMonth() + 1,
        1
      );
      this._selectedDate = null;
      this._maybeFetchMonthEvents();
      this._update();
    });

    this.shadowRoot.querySelector("#fpc-month-today-btn").addEventListener("click", () => {
      const today = new Date();
      this._calendarViewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      this._selectedDate = isoDate(today);
      this._maybeFetchMonthEvents();
      this._update();
    });

    this.shadowRoot.querySelector("#fpc-tts-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._speakToday();
    });

    this.shadowRoot.querySelector("#fpc-share-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._shareWeek();
    });

    // Global pointerup fångar drag-avslut även om man släpper utanför en cell.
    // _render() kan köras flera gånger på samma instans (t.ex. varje gång
    // setConfig anropas igen under redigering) - ta bort en ev. tidigare
    // lyssnare först så de inte staplas på document.
    if (this._onPointerUp) {
      document.removeEventListener("pointerup", this._onPointerUp);
    }
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
    const parts = cfg.persons.map((p) => {
      const { name } = this._personDisplay(p);
      return `${name}: ${this._personTodayLines(p).join(", ")}`;
    });
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

  // Rader för en veckodag från en uppsättning kalenderkällor (redan
  // filtrerat på _hiddenSources) - delas mellan veckotabellen och delningen.
  _weekDayEvents(sources, dateIso) {
    return this._eventsForDateFromSources(dateIso, this._weekEventsCache, sources).filter(
      (ev) => !this._hiddenSources.has(ev.sourceKey)
    );
  }

  _weekDates() {
    const monday = this._startOfThisWeek();
    return DAY_KEYS.map((_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return isoDate(d);
    });
  }

  _shareWeek() {
    const cfg = this._config;
    const todayIdx = this._todayKey();
    const weekDates = this._weekDates();
    const sources = this._calendarSources();
    const lines = [cfg.title, ""];

    cfg.persons.forEach((p, idx) => {
      const { name } = this._personDisplay(p);
      const personSrcs = sources.filter((s) => s.personIdxs.includes(idx));
      lines.push(name + ":");
      weekDates.forEach((dateIso, i) => {
        const events = this._weekDayEvents(personSrcs, dateIso);
        const val = events.length > 0 ? events.map((ev) => ev.summary || "(utan titel)").join(", ") : "–";
        lines.push(`  ${DAY_LABELS[i]}${i === todayIdx ? " (idag)" : ""}: ${val}`);
      });
      lines.push("");
    });

    const sharedSources = sources.filter((s) => s.personIdxs.length === 0);
    if (sharedSources.length > 0) {
      lines.push(cfg.calendars_label + ":");
      weekDates.forEach((dateIso, i) => {
        const events = this._weekDayEvents(sharedSources, dateIso);
        const val = events.length > 0 ? events.map((ev) => ev.summary || "(utan titel)").join(", ") : "–";
        lines.push(`  ${DAY_LABELS[i]}${i === todayIdx ? " (idag)" : ""}: ${val}`);
      });
    }
    const text = lines.join("\n");

    if (navigator.share) {
      navigator.share({ title: cfg.title, text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          const btn = this.shadowRoot.querySelector("#fpc-share-btn");
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

    const ttsBtn = this.shadowRoot.querySelector("#fpc-tts-btn");
    if (ttsBtn) ttsBtn.style.display = cfg.tts ? "" : "none";

    // Nedräkningar - överst
    const cdEl = this.shadowRoot.querySelector("#fpc-countdowns");
    if (cdEl) {
      if (cfg.countdowns.items.length === 0) {
        cdEl.style.display = "none";
      } else {
        cdEl.style.display = "";
      }
      const items = cfg.countdowns.items
        .map((it) => {
          const st = this._stateObj(it.entity);
          // date_attribute är valfritt - vissa sensorer (t.ex. färdiga
          // "dagar kvar"-integrationer) har redan ett antal dagar som
          // state och lägger själva datumet i ett attribut istället.
          const dateVal = st ? (it.date_attribute ? st.attributes[it.date_attribute] : st.state) : undefined;
          const days = dateVal !== undefined ? daysUntil(dateVal) : null;
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
    const weatherEl = this.shadowRoot.querySelector("#fpc-weather");
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
    const personsEl = this.shadowRoot.querySelector("#fpc-persons");
    if (personsEl && cfg.persons.length === 0) {
      personsEl.innerHTML = `<div class="fpc-general-empty">Inga personer konfigurerade ännu. Öppna sidopanelen "Familjeplanering" för att lägga till familjemedlemmar.</div>`;
    } else if (personsEl) {
      personsEl.innerHTML = cfg.persons
        .map((p) => {
          const color = p.color || "var(--primary-color)";
          const icon = p.icon || "mdi:account";
          const { name, picture } = this._personDisplay(p);
          const avatarInner = picture
            ? `<img class="fpc-avatar-img" src="${picture}" alt="" />`
            : `<ha-icon icon="${icon}"></ha-icon>`;
          const personIconKeywords = this._iconKeywordsFor(p);
          const lines = this._personTodayLines(p)
            .map((text) => {
              const badge = renderIconBadge(matchIcon(text, personIconKeywords));
              return `<div class="fpc-person-state-line">${badge}${fpcEsc(text)}</div>`;
            })
            .join("");
          const away = this._isPersonAwayNow(p);
          return `
            <div class="fpc-person-row${away ? " fpc-person-away" : ""}">
              <div class="fpc-avatar" style="background:${picture ? "transparent" : color}">
                ${avatarInner}
              </div>
              <div class="fpc-person-info">
                <div class="fpc-person-name">${fpcEsc(name)}</div>
                ${lines}
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Allmän rad - bara sensorer som är "on"
    const generalEl = this.shadowRoot.querySelector("#fpc-general");
    if (generalEl) {
      const activeOnes = cfg.general.filter((g) => {
        const st = this._stateObj(g.entity);
        return st && st.state === "on";
      });

      // Notis-badge i headern, synlig även när sektionen är ihopfälld
      const badgeEl = this.shadowRoot.querySelector("#fpc-badge");
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
    const tableEl = this.shadowRoot.querySelector("#fpc-table");
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

      const weekDates = this._weekDates();
      const sources = this._calendarSources();
      const renderWeekCell = (events, isToday) => {
        if (events.length === 0) {
          return `<td class="${isToday ? "fpc-today-col" : ""}">–</td>`;
        }
        const html = events
          .map((ev) => {
            const summary = ev.summary || "(utan titel)";
            const badge = renderIconBadge(matchIcon(summary, ev.sourceIconKeywords || cfg.icon_keywords));
            return `${badge}${fpcEsc(summary)}`;
          })
          .join(" • ");
        return `<td class="${isToday ? "fpc-today-col" : ""}">${html}</td>`;
      };

      const rows = cfg.persons
        .map((p, idx) => {
          const { name } = this._personDisplay(p);
          const personSrcs = sources.filter((s) => s.personIdxs.includes(idx));
          const cells = weekDates
            .map((dateIso, i) => {
              const events = this._weekDayEvents(personSrcs, dateIso);
              return renderWeekCell(events, i === todayIdx);
            })
            .join("");
          return `<tr><td class="fpc-person-col">${fpcEsc(name)}</td>${cells}</tr>`;
        })
        .join("");

      const sharedSources = sources.filter((s) => s.personIdxs.length === 0);
      let sharedRow = "";
      if (sharedSources.length > 0) {
        const cells = weekDates
          .map((dateIso, i) => renderWeekCell(this._weekDayEvents(sharedSources, dateIso), i === todayIdx))
          .join("");
        sharedRow = `<tr><td class="fpc-person-col">${fpcEsc(cfg.calendars_label)}</td>${cells}</tr>`;
      }

      tableEl.innerHTML = `
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>${weatherWeekRow}${rows}${sharedRow}</tbody>
      `;
    }

    this._updateMonthCalendar();
  }

  // Samlar events för ett datum från en given cache (månad/vecka) över en
  // lista kalenderkällor (se _calendarSources).
  _eventsForDateFromSources(dateIso, cache, sources) {
    const results = [];
    if (!cache) return results;
    sources.forEach((src) => {
      const events = cache.data[src.calendar_entity] || [];
      events.forEach((ev) => {
        // eventCoversDate (inte bara startdatum) så flerdagarshändelser -
        // en "borta"-helg, ett sommarlov - visas/räknas varje dag de pågår.
        if (!eventCoversDate(ev, dateIso)) return;
        results.push({
          ...ev,
          sourceKey: src.key,
          sourceName: src.name,
          sourceColor: src.color,
          sourceIconKeywords: src.iconKeywords,
          sourceIsAway: !!src.isAway,
        });
      });
    });
    return results;
  }

  _eventsForDate(dateIso) {
    return this._eventsForDateFromSources(dateIso, this._monthEventsCache, this._calendarSources());
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
      this._weekEventsCache = null;
      this._creatingEvent = null;
      await this._maybeFetchMonthEvents();
      await this._maybeFetchWeekEvents();
      this._update();
    } catch (err) {
      // Går inte att skapa (t.ex. skrivskyddad kalender) - lämna formuläret öppet
    }
  }

  _updateMonthCalendar() {
    const cfg = this._config;
    const section = this.shadowRoot.querySelector("#fpc-month-section");
    if (!section) return;
    if (!cfg.show_month_calendar) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const sources = this._calendarSources();

    const year = this._calendarViewMonth.getFullYear();
    const month = this._calendarViewMonth.getMonth();
    this.shadowRoot.querySelector("#fpc-month-title").textContent = `${MONTH_NAMES[month]} ${year}`;

    // Filter-chips per kalenderkälla (person eller delad kalender)
    const filtersEl = this.shadowRoot.querySelector("#fpc-month-filters");
    if (sources.length === 0) {
      filtersEl.innerHTML = "";
    } else {
      filtersEl.innerHTML = sources
        .map((src) => {
          const active = !this._hiddenSources.has(src.key);
          return `
            <div class="fpc-filter-chip${active ? " fpc-filter-active" : ""}" data-source-key="${fpcEsc(src.key)}">
              <div class="fpc-filter-dot" style="background:${src.color}"></div>
              ${fpcEsc(src.name)}
            </div>
          `;
        })
        .join("");
      filtersEl.querySelectorAll(".fpc-filter-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const key = chip.getAttribute("data-source-key");
          if (this._hiddenSources.has(key)) this._hiddenSources.delete(key);
          else this._hiddenSources.add(key);
          this._updateMonthCalendar();
        });
      });
    }

    const gridStart = startOfCalendarGrid(year, month);
    const todayIso = isoDate(new Date());
    const gridEl = this.shadowRoot.querySelector("#fpc-month-grid");

    // Explicit grid-row/-column på både rubriker och dagceller - inte bara
    // på händelsestaplarna. CSS Grid placerar ALLA explicit-positionerade
    // objekt först, oavsett DOM-ordning, och auto-flödar sedan resten runt
    // dem - om dagcellerna saknar egen placering "flyter" de runt de redan
    // upptagna stapel-rutorna och hamnar i fel rad/kolumn (det som såg ut
    // som att datumen inte hamnade i sina rutor).
    const weekdayHeaders = DAY_LABELS.map(
      (l, i) => `<div class="fpc-month-weekday" style="grid-row:1; grid-column:${i + 1};">${l}</div>`
    ).join("");

    const dragMin = this._dragging && this._dragStart && this._dragEnd
      ? (this._dragStart < this._dragEnd ? this._dragStart : this._dragEnd)
      : null;
    const dragMax = this._dragging && this._dragStart && this._dragEnd
      ? (this._dragStart < this._dragEnd ? this._dragEnd : this._dragStart)
      : null;

    // Beräknas för hela rutnätet innan cellerna byggs, eftersom varje
    // dagcell behöver veta sin egen "+N dolda"-räknare (se
    // _monthEventBarsHtml) för badgen i hörnet.
    const { html: eventBarsHtml, overflowByDate } = this._monthEventBarsHtml(gridStart, sources);

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
      const vacationColor = this._vacationColorForDate(dIso, allEvents);
      const dayBackground = vacationColor;
      const overflow = overflowByDate[dIso] || 0;
      const overflowBadge = overflow > 0 ? `<div class="fpc-month-overflow">+${overflow}</div>` : "";
      const classes = [
        "fpc-month-cell",
        outside ? "fpc-outside" : "",
        isToday ? "fpc-today-cell" : "",
        isSelected ? "fpc-selected" : "",
        isDragHighlighted ? "fpc-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const styleParts = [`grid-row:${2 + Math.floor(i / 7)}`, `grid-column:${(i % 7) + 1}`];
      if (dayBackground && !isToday) styleParts.push(`background:${dayBackground}`);
      cells += `
        <div class="${classes}" data-date="${dIso}" style="${styleParts.join("; ")};">
          <div class="fpc-month-daynum">${d.getDate()}</div>
          ${overflowBadge}
        </div>
      `;
    }

    gridEl.innerHTML = weekdayHeaders + cells + eventBarsHtml;
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

  // Samlar alla synliga källors händelser för en veckorad, klippta till
  // veckans 7 dagar (startCol/endCol, 0-6) - underlag för packEventLanes.
  _weekEventsForLanes(weekDates, sources) {
    const cache = this._monthEventsCache;
    if (!cache) return [];
    const results = [];
    const seen = new Set();
    sources.forEach((src) => {
      if (this._hiddenSources.has(src.key)) return;
      const events = cache.data[src.calendar_entity] || [];
      events.forEach((ev) => {
        const range = eventDateRange(ev);
        if (!range) return;
        const clipStart = range.start < weekDates[0] ? weekDates[0] : range.start;
        const clipEnd = range.end > weekDates[6] ? weekDates[6] : range.end;
        if (clipStart > clipEnd) return;
        const startCol = weekDates.indexOf(clipStart);
        const endCol = weekDates.indexOf(clipEnd);
        if (startCol === -1 || endCol === -1) return;
        // Skyddar mot dubbletter om två källor råkar peka på samma
        // calendar_entity (t.ex. en person som återanvänder en delad kalender).
        const dedupeKey = `${src.calendar_entity}|${ev.summary}|${range.start}|${range.end}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        results.push({
          startCol,
          endCol,
          color: src.color,
          summary: ev.summary || "(utan titel)",
          iconKeywords: src.iconKeywords,
        });
      });
    });
    return results;
  }

  // Bygger sammanhängande färgade rader (à la iOS Kalender) för ALLA
  // aktiviteter i månadsvyn - inte bara "borta hos andra föräldern" -
  // istället för att bara visa prickar. Överlappande händelser samma
  // dag staplas i egna "lanes" (packEventLanes). Bryggar över mellan-
  // rummet mellan dagceller korrekt genom att placeras som egna objekt
  // i samma CSS-grid (gridEl) med explicit grid-row/-column per
  // veckorad. Begränsar synliga lanes per vecka (MAX_VISIBLE_LANES) -
  // dagar med fler händelser än så får en "+N"-badge istället (räknas
  // per dag, inte per vecka, i overflowByDate).
  _monthEventBarsHtml(gridStart, sources) {
    const MAX_VISIBLE_LANES = 3;
    const LANE_HEIGHT = 15;
    const TOP_OFFSET = 20; // plats för datumsiffran ovanför första lane
    let html = "";
    const overflowByDate = {};

    for (let week = 0; week < 6; week++) {
      const weekStart = new Date(gridStart);
      weekStart.setDate(weekStart.getDate() + week * 7);
      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return isoDate(d);
      });

      const weekEvents = this._weekEventsForLanes(weekDates, sources);
      const { events: placed } = packEventLanes(weekEvents);

      placed.forEach((ev) => {
        if (ev.lane >= MAX_VISIBLE_LANES) {
          for (let col = ev.startCol; col <= ev.endCol; col++) {
            const dIso = weekDates[col];
            overflowByDate[dIso] = (overflowByDate[dIso] || 0) + 1;
          }
          return;
        }
        const badge = renderIconBadge(matchIcon(ev.summary, ev.iconKeywords));
        const top = TOP_OFFSET + ev.lane * LANE_HEIGHT;
        html += `
          <div class="fpc-month-event-bar" style="grid-row:${week + 2}; grid-column:${ev.startCol + 1} / ${ev.endCol + 2}; background:${ev.color}; margin-top:${top}px;">${badge}${fpcEsc(ev.summary)}</div>
        `;
      });
    }
    return { html, overflowByDate };
  }

  _renderMonthDayDetail() {
    const cfg = this._config;
    const detailEl = this.shadowRoot.querySelector("#fpc-month-daydetail");
    if (!detailEl) return;
    const sources = this._calendarSources();

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
            ${sources.map((src) => `<option value="${fpcEsc(src.calendar_entity)}">${fpcEsc(src.name)}</option>`).join("")}
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
      (ev) => !this._hiddenSources.has(ev.sourceKey)
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
          const badge = renderIconBadge(matchIcon(summary, ev.sourceIconKeywords || cfg.icon_keywords));
          return `
            <div class="fpc-month-event">
              <div class="fpc-month-event-dot" style="background:${ev.sourceColor}"></div>
              <div>${badge}${fpcEsc(summary)} <span style="opacity:0.7">– ${fpcEsc(ev.sourceName)}</span></div>
            </div>
          `;
        })
        .join("");
    }
    if (sources.length > 0) {
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

  static getStubConfig() {
    // Kortet har ingen egen konfiguration - allt sätts upp i sidopanelen
    // "Familjeplanering" och delas av alla kort, se _maybeLoadSharedConfig().
    return { type: "custom:family-planner-card" };
  }
}

customElements.define("family-planner-card", FamilyPlannerCard);

// Registrera i kortväljaren i UI-editorn
window.customCards = window.customCards || [];
window.customCards.push({
  type: "family-planner-card",
  name: "Family Planner Card",
  description: "Dagens händelser per person + veckoschema",
});
