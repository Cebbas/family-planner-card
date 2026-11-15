"""Push-påminnelser före kalenderhändelser ("Fotboll om 30 min").

Körs i backend (inte i kortet) så att påminnelsen kommer även när ingen har
dashboarden öppen. Konfigureras i sidopanelen:

- `reminders.minutes_before` (toppnivå i family_planner-configen): hur
  långt innan en händelse påminnelsen skickas. 0/saknas = avstängt.
- `notify_service` per person: vilken `notify.*`-tjänst (utan "notify."-
  prefixet, t.ex. "mobile_app_annas_iphone") personens påminnelser går till.
  Saknas den får personen inga påminnelser.

En person påminns om händelser i sin egen `calendar_entity`, sina
jobbkalendrar (`work_calendars` - privata, men påminnelsen går ju bara till
personen själv) och delade kalendrar som är kopplade till personen
(`calendars[].persons`). Delade kalendrar utan personkoppling och
borta-kalendrar ger inga påminnelser - det finns ingen självklar mottagare.
Heldagshändelser hoppas över (inget klockslag att räkna bakåt från), och
likaså händelser som dolts i vecko-/månadsvyn (family_planner_hidden_events).

Varje tillfälle påminns om exakt en gång - även över omstarter, via en egen
liten Store med redan skickade nycklar.

Uppdelat i rena funktioner (reminder_targets/due_reminders) som går att
testa utan hass, och en tunn körare (FamilyPlannerReminders) som hämtar
händelser och skickar notiser.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
from typing import Any, Callable

from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

SENT_STORAGE_KEY = "family_planner_sent_reminders"
SENT_STORAGE_VERSION = 1

CHECK_INTERVAL = timedelta(minutes=1)
# Händelserna hämtas om var 5:e minut (inte varje minutkoll) - en
# sammanslagen cal_combiner-kalender frågar alla sina källor vid varje
# hämtning, så varje minut vore onödigt tungt.
REFRESH_INTERVAL = timedelta(minutes=5)
# Hur länge en skickad nyckel sparas efter händelsens start - räcker gott för
# att aldrig skicka dubbelt, utan att lagringen växer för evigt.
SENT_RETENTION = timedelta(days=2)


def _person_key(person: dict) -> str:
    """Samma identitet som __init__._person_key / personMatchKey() i kortet."""
    return str(person.get("name") or person.get("person_entity") or "")


@dataclass(frozen=True)
class ReminderTarget:
    calendar_entity: str
    notify_service: str
    person_name: str


@dataclass(frozen=True)
class DueReminder:
    key: str
    start: datetime
    notify_service: str
    title: str
    message: str


def lead_minutes(config: dict) -> int:
    """Antal minuter före händelsen, eller 0 om påminnelser är avstängda."""
    try:
        minutes = int(((config or {}).get("reminders") or {}).get("minutes_before") or 0)
    except (TypeError, ValueError):
        return 0
    return max(minutes, 0)


def reminder_targets(config: dict) -> list[ReminderTarget]:
    """(kalender, notistjänst, person) för varje person som har en notistjänst satt."""
    targets: list[ReminderTarget] = []
    seen: set[tuple[str, str]] = set()
    shared = [c for c in (config.get("calendars") or []) if isinstance(c, dict)]
    for person in config.get("persons") or []:
        if not isinstance(person, dict):
            continue
        service = (person.get("notify_service") or "").strip()
        if service.startswith("notify."):
            service = service[len("notify."):]
        if not service:
            continue
        key = _person_key(person)
        calendars = [person.get("calendar_entity")]
        calendars += [w.get("entity") for w in person.get("work_calendars") or [] if isinstance(w, dict)]
        calendars += [c.get("entity") for c in shared if key and key in (c.get("persons") or [])]
        name = person.get("name") or person.get("person_entity") or ""
        for entity_id in calendars:
            if not entity_id or (entity_id, service) in seen:
                continue
            seen.add((entity_id, service))
            targets.append(ReminderTarget(entity_id, service, name))
    return targets


def _event_key(entity_id: str, event: Any, start: datetime) -> str:
    uid = getattr(event, "uid", None) or getattr(event, "summary", "") or ""
    recurrence_id = getattr(event, "recurrence_id", None) or ""
    return f"{entity_id}|{uid}|{recurrence_id}|{start.isoformat()}"


def due_reminders(
    events_by_entity: dict[str, list[Any]],
    targets: list[ReminderTarget],
    now: datetime,
    lead: timedelta,
    sent: set[str] | dict[str, Any],
    hidden: set[str] | None = None,
) -> list[DueReminder]:
    """Påminnelser som ska skickas nu: start - lead <= now < start, inte redan skickade.

    `sent`-nycklarna inkluderar notistjänsten, så två personer som delar en
    kalender båda får sin påminnelse.
    """
    hidden = hidden or set()
    result: list[DueReminder] = []
    for target in targets:
        for event in events_by_entity.get(target.calendar_entity) or []:
            start = getattr(event, "start", None)
            # Heldag (date, inte datetime) - inget klockslag att påminna inför.
            if not isinstance(start, datetime):
                continue
            if start.tzinfo is None:
                start = start.replace(tzinfo=dt_util.get_default_time_zone())
            if not (start - lead <= now < start):
                continue
            uid = getattr(event, "uid", None)
            if uid and f"{target.calendar_entity}|{uid}" in hidden:
                continue
            key = f"{_event_key(target.calendar_entity, event, start)}|{target.notify_service}"
            if key in sent:
                continue
            minutes_left = max(1, round((start - now).total_seconds() / 60))
            local_start = dt_util.as_local(start)
            summary = getattr(event, "summary", "") or "Händelse"
            location = getattr(event, "location", None)
            message = f"{summary} kl {local_start:%H:%M}"
            if location:
                message += f" – {location}"
            result.append(
                DueReminder(
                    key=key,
                    start=start,
                    notify_service=target.notify_service,
                    title=f"Om {minutes_left} min: {summary}",
                    message=message,
                )
            )
    return result


class FamilyPlannerReminders:
    """Minutkoll som skickar påminnelserna. En instans per config entry."""

    def __init__(
        self,
        hass: HomeAssistant,
        load_config: Callable[[], Any],
        load_hidden: Callable[[], Any],
    ) -> None:
        self.hass = hass
        self._load_config = load_config
        self._load_hidden = load_hidden
        self._sent_store: Store = Store(hass, SENT_STORAGE_VERSION, SENT_STORAGE_KEY)
        self._sent: dict[str, str] = {}  # nyckel -> händelsens start (ISO), för gallring
        self._events: dict[str, list[Any]] = {}
        self._targets: list[ReminderTarget] = []
        self._lead = timedelta(0)
        self._hidden: set[str] = set()
        self._last_refresh: datetime | None = None
        self._unsub: Callable[[], None] | None = None

    async def async_start(self) -> None:
        stored = await self._sent_store.async_load()
        self._sent = dict((stored or {}).get("sent") or {})
        self._unsub = async_track_time_interval(self.hass, self._async_tick, CHECK_INTERVAL)

    def async_stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    def mark_config_changed(self) -> None:
        """Anropas när panelen sparat - nästa koll läser in configen och händelserna på nytt."""
        self._last_refresh = None

    async def _async_refresh(self, now: datetime) -> None:
        config = await self._load_config() or {}
        minutes = lead_minutes(config)
        self._lead = timedelta(minutes=minutes)
        self._targets = reminder_targets(config) if minutes > 0 else []
        hidden_data = await self._load_hidden() or {}
        self._hidden = set(hidden_data.get("keys") or [])
        self._last_refresh = now

        events: dict[str, list[Any]] = {}
        if self._targets:
            component = self.hass.data.get("calendar")
            # Fönster: allt som kan bli aktuellt fram till nästa hämtning.
            end = now + self._lead + REFRESH_INTERVAL + CHECK_INTERVAL
            for entity_id in {t.calendar_entity for t in self._targets}:
                entity = component.get_entity(entity_id) if component is not None else None
                if entity is None:
                    continue
                try:
                    events[entity_id] = await entity.async_get_events(self.hass, now - CHECK_INTERVAL, end)
                except Exception as err:  # noqa: BLE001 - en trasig kalender ska inte stoppa de andra
                    _LOGGER.warning("Family Planner: kunde inte hämta %s för påminnelser: %s", entity_id, err)
        self._events = events

    async def _async_tick(self, now: datetime | None = None) -> None:
        now = dt_util.now()
        if self._last_refresh is None or now - self._last_refresh >= REFRESH_INTERVAL:
            await self._async_refresh(now)
        if not self._targets:
            return

        due = due_reminders(self._events, self._targets, now, self._lead, self._sent, self._hidden)
        for reminder in due:
            try:
                await self.hass.services.async_call(
                    "notify",
                    reminder.notify_service,
                    {"title": reminder.title, "message": reminder.message},
                    blocking=True,
                )
            except Exception:  # noqa: BLE001 - markeras ändå som skickad, annars tjat varje minut
                _LOGGER.exception(
                    "Family Planner: notify.%s misslyckades för påminnelsen %r",
                    reminder.notify_service,
                    reminder.title,
                )
            self._sent[reminder.key] = reminder.start.isoformat()

        cutoff = now - SENT_RETENTION
        before = len(self._sent)
        self._sent = {
            k: v for k, v in self._sent.items() if (dt_util.parse_datetime(v) or now) >= cutoff
        }
        if due or len(self._sent) != before:
            await self._sent_store.async_save({"sent": self._sent})
