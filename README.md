# Family Planner Card

En egen Lovelace-card till Home Assistant med:

- **Idag** (fällbar sektion): en rad per person som visar en entitets state
  (t.ex. en template-sensor du fyller med dagens text), plus en **allmän
  rad** med sensorer som bara syns som runda ikoner när de är `on`.
- **Veckoschema**: samma personer, en rad var, uppdelat på veckans dagar.
  Dagens dag markeras. Innehållet i varje ruta hämtas från attribut på en
  valfri `week_entity` per person.

## Installation

### Via HACS (rekommenderas)

Kortet ligger inte i HACS standardlista, så det läggs till som ett
**anpassat repository (custom repository)**:

1. Öppna **HACS → tre punkter (uppe till höger) → Anpassade repositories**.
2. Lägg till URL:en till detta repo:
   `https://github.com/Cebbas/family-planner-card`
   Kategori: **Dashboard** (Lovelace-kort).
3. Sök upp "Family Planner Card" i HACS och klicka **Ladda ner**.
4. HACS lägger automatiskt till resursen åt dig. Ladda om dashboarden
   (eller starta om HA vid behov), lägg sedan till kortet.

Framtida uppdateringar syns som vanligt i HACS när nya releaser skapas.

### Manuellt

1. Kopiera `family-planner-card.js` till `/config/www/` i din HA-installation
   (t.ex. via Samba/Studio Code Server som du redan använder).
2. Lägg till den som resurs:
   **Inställningar → Instrumentpaneler → (tre punkter) → Resurser → Lägg till resurs**
   - URL: `/local/family-planner-card.js`
   - Typ: `JavaScript-modul`
3. Ladda om dashboarden (eller HA), lägg sedan till kortet.

## Exempel-konfiguration

```yaml
type: custom:family-planner-card
title: Familjeplanering
start_collapsed: false
countdowns:
  max_shown: 5          # hur många som visas normalt (sorterat på närmast i tid)
  items:
    - entity: sensor.jul
      name: Jul
      pinned: true       # visas alltid, även om den inte är bland de 5 närmaste
    - entity: sensor.sommarlov
      name: Sommarlov
    - entity: sensor.annas_fodelsedag
      name: Annas födelsedag
weather:
  entity: weather.hemma
  show_week: true        # visar en väderrad (ikon + temp) överst i veckoschemat
icon_keywords:
  - match: fotboll
    icon: ⚽
  - match: skola
    icon: 🏫
  - match: tandläkare
    icon: mdi:tooth
show_month_calendar: true   # kalender i månadsvy under veckoschemat
vacation_keywords:
  - match: lov
    color: "#c8f7c5"        # färgar hela dagen i månadskalendern
tts:
  tts_entity: tts.piper     # entitet av typen tts.*
  media_player: media_player.kok  # högtalaren uppläsningen skickas till
persons:
  - name: Anna
    entity: sensor.anna_idag
    week_entity: sensor.anna_vecka
    calendar_entity: calendar.anna   # valfri, används av månadskalendern
    icon: mdi:account
    color: "#e17055"
  - name: Erik
    entity: sensor.erik_idag
    week_entity: sensor.erik_vecka
    calendar_entity: calendar.erik
    icon: mdi:account
    color: "#0984e3"
general:
  - entity: binary_sensor.tvattmaskin
    name: Tvätt
    icon: mdi:washing-machine
  - entity: binary_sensor.sopor_imorgon
    name: Sopor
    icon: mdi:trash-can
```

## Nedräkningsraden (överst)

Lista valfritt antal `items` under `countdowns`. Varje `entity`s `state`
ska vara ett datum (`YYYY-MM-DD`, funkar även med fullt datetime). Kortet
räknar ut antal dagar kvar och sorterar automatiskt på närmast i tid.

- `max_shown` styr hur många som visas normalt (default 5).
- `pinned: true` gör att en post **alltid** visas, även om den inte är
  bland de `max_shown` närmaste — den läggs till extra och hela raden
  sorteras sedan om på dagar kvar. Fungerar även för redan passerade datum
  (visar "X dagar sedan").
- Poster utan giltigt datum eller med ogiltig entitet hoppas över tyst.

Exempel på sensor:

```yaml
template:
  - sensor:
      - name: "Jul"
        state: "{{ '2026-12-24' }}"
```

## Väderrad

Ange en `weather.*`-entitet under `weather.entity` för att visa aktuell
temperatur + ikon i en liten rad direkt under nedräkningarna.

Sätt `weather.show_week: true` för att även få en väderrad överst i
veckoschemat, med ikon + avrundad temperatur per dag. Den hämtar prognosen
via `weather.get_forecasts` (samma tjänst som HA:s egna väderkort använder)
och matchar varje prognospost mot rätt veckodagskolumn. Dagar utan
prognosdata (t.ex. redan passerade dagar i veckan, eller dagar längre bort
än prognosen sträcker sig) visar bara ett streck.

Prognosen cachas i 20 minuter innan den hämtas på nytt, så kortet inte
spammar väder-API:et.

## Ikon-nyckelord (matcha ord i händelser mot en ikon)

Lista `icon_keywords` med `match` (ord/fras) och `icon`. `icon` kan vara:

- en emoji, t.ex. `⚽`
- en `mdi:`-ikon, t.ex. `mdi:tooth`
- en bild-URL eller lokal sökväg, t.ex. `https://example.com/fotboll.png`
  eller `/local/icons/fotboll.png` — visas som en liten rund bild

Kortet söker efter ordet i texten (skiftlägesokänsligt, substräng) och
visar badgen (ikon/emoji/bild) framför texten — både i "Idag"-raden och i
varje cell i veckoschemat. Första träffen i listan vinner om flera ord
matchar samma text.

```yaml
icon_keywords:
  - match: fotboll
    icon: ⚽
  - match: skola
    icon: 🏫
  - match: tandläkare
    icon: mdi:tooth
  - match: simskola
    icon: /local/icons/simskola.png
```

Så om en persons "idag"-sensor har state `"Fotbollsträning 17:00"` visas
⚽ framför texten automatiskt, utan att du behöver ändra sensorn.

Lokala bilder lägger du precis som kortet självt i `/config/www/` och
pekar på dem som `/local/dinbild.png`.

## Månadskalender

Under veckoschemat finns nu en riktig kalender i månadsvy, aktiverad som
standard (`show_month_calendar: true`). Bläddra mellan månader med `‹`/`›`
— den öppnas alltid på innevarande månad.

Lägg till `calendar_entity` (en vanlig `calendar.*`-entitet) på de
personer du vill se i kalendern. Det är en annan entitet än `entity`/
`week_entity` — de senare är fria textsensorer du själv fyller i, medan
`calendar_entity` är en riktig kalender som kortet hämtar events från
direkt via Home Assistants kalender-API (fungerar utmärkt med t.ex. en
sammanslagen cal_combiner-kalender).

Varje dag i rutnätet visar en liten prick per person som har en händelse
den dagen, i personens `color`. Klicka på en dag för att se en lista med
den dagens händelser (tid, titel och person). Ikon-nyckelorden
(`icon_keywords`) matchas även mot händelsetitlarna i den listan.

Data hämtas per synlig månad och cachas i 5 minuter.

## Notis-badge i headern

En liten röd badge med antal aktiva allmänna sensorer visas bredvid
titeln i headern — synlig även när "Idag"-sektionen är ihopfälld. Ingen
konfiguration behövs, den räknas automatiskt.

## Dela veckoschema

En "Dela"-knapp ovanför veckoschemat bygger en textsammanfattning av
veckan (person för person, dag för dag) och öppnar mobilens delningsmeny
(Web Share API) om den finns tillgänglig, annars kopieras texten till
urklipp. Det är alltså textbaserad delning, inte en genererad bild/PDF —
funkar bra att klistra in i ett SMS eller chattmeddelande till
mor-/farföräldrar eller barnvakt.

## Röstuppläsning (TTS)

Sätt `tts.tts_entity` (en `tts.*`-entitet) och `tts.media_player` för att
få en högtalarikon i headern. Ett klick bygger ihop en mening av alla
personers "idag"-text plus eventuella aktiva allmänna sensorer, och kör
`tts.speak` mot vald högtalare — bra att koppla till en knapp i
morgonrutinen. Kräver en TTS-integration konfigurerad i HA (t.ex. Piper,
Google Translate, eller Amazon Polly).

## Semestermarkering i månadskalendern

Lista `vacation_keywords` med `match` (ord) och `color` (hex-färg).
Matchas mot alla händelsers titlar den dagen (över alla personers
kalendrar), och om något matchar färgas hela dagcellen i månadskalendern
med den färgen — bra för att visa skolans lovdagar direkt i vyn.

## Filtrera månadskalendern per person

Ovanför kalenderrutnätet visas klickbara chips, en per person med
`calendar_entity`. Klick döljer/visar den personens prickar och händelser
i kalendern (inklusive dagsdetalj-listan) — påverkar inte
semestermarkeringen, som alltid tar hänsyn till alla personers kalendrar.

## Skapa händelser genom att dra i månadskalendern

Dra över flera dagar i rutnätet (håll ner och dra) för att öppna ett litet
formulär där du skriver en titel och väljer vilken persons kalender
händelsen ska läggas på — sparas som en heldagshändelse via
`calendar.create_event`. Ett vanligt klick (utan att dra) väljer bara
dagen som vanligt och visar en "+ Lägg till händelse"-knapp för att skapa
en enskild dag på samma sätt.

Kräver att `calendar_entity` pekar på en kalender med skrivstöd (t.ex.
en lokal CalDAV-kalender). Går inte att skapa events på skrivskyddade
kalendrar (t.ex. vissa Google-prenumerationer) — då misslyckas sparandet
tyst och formuläret ligger kvar öppet.

## Hur "Idag"-texten fylls i

`entity` för varje person kan vara **vilken entitet som helst** — kortet
visar bara `state`. Enklast är en `template`-sensor du själv definierar,
t.ex. baserat på dina cal_combiner-kalendrar:

```yaml
template:
  - sensor:
      - name: "Anna idag"
        state: >
          {% set events = state_attr('calendar.anna', 'message') %}
          {{ events if events else 'Inget planerat idag' }}
```

## Hur veckoschemat fylls i

`week_entity` är valfri per person. Kortet läser attributen `monday`,
`tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`
(engelska, gemener) på den entiteten och visar dem i respektive kolumn.
Saknas `week_entity` eller ett attribut visas ett streck (`–`).

Exempel på en template-sensor som bygger veckan:

```yaml
template:
  - sensor:
      - name: "Anna vecka"
        state: "ok"
        attributes:
          monday: "Simskola 17:00"
          tuesday: "–"
          wednesday: "Fotboll 18:00"
          thursday: "–"
          friday: "Sover hos kompis"
          saturday: "–"
          sunday: "Familjemiddag"
```

Du styr alltså helt själv vad som räknas ut och visas — kortet är bara
ett rent visningslager. Det gör det enkelt att koppla in cal_combiner,
vanliga kalenderentiteter, eller något helt annat längre fram utan att
kortet behöver ändras.

## Allmänna raden (idag)

Lista valfritt antal entiteter under `general`. Bara de som just nu har
state `on` visas som en rund ikon-badge med namn under. Fungerar bra med
`binary_sensor`-entiteter, t.ex. från din activity-sensor-funktion i
cal_combiner.

## Visuell editor

Kortet har nu en egen visuell editor (`getConfigElement`), så du slipper
skriva YAML för hand om du inte vill. Lägg till kortet via **Lägg till
kort → Family Planner Card** i dashboarden, så visas formuläret automatiskt
med:

- Titel och "starta ihopfälld"-kryssruta
- Nedräkningar: antal som visas + lista med entity-picker, namn och en
  "Visa alltid"-kryssruta (motsvarar `pinned`)
- Personer: namn, entitet, valfri vecko-entitet, ikon och färg
- Allmänna sensorer: entitet, namn och ikon

Alla listor har egna "+ Lägg till..."-knappar och en ✕ för att ta bort
rader. Ändringar sparas direkt i kortets YAML-konfiguration i bakgrunden,
så du kan fortfarande finputsa i YAML-läget om du vill.

Editorn använder `ha-entity-picker` om den är laddad i din frontend
(vilket den normalt är), annars faller den tillbaka på ett vanligt
textfält för entity_id.

## Idéer för vidare utveckling

- Klickbar person-rad som öppnar en mer detaljerad vy/dialog.
- Färgkodning i veckoschemat baserat på händelsetyp.
- Egen visuell editor (just nu är kortet YAML-only).
- Direktkoppling mot cal_combiners ICS-flöde istället för mellanliggande
  template-sensorer, om du vill slippa hålla sensorerna uppdaterade själv.
