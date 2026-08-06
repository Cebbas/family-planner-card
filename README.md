# Family Planner Card

En egen Lovelace-card till Home Assistant med:

- **Idag** (fällbar sektion): en eller flera rader per person, en per
  konfigurerad `entities`-sensor (t.ex. en template-sensor du fyller med
  dagens text), plus en **allmän rad** med sensorer som bara syns som
  runda ikoner när de är `on`.
- **Veckoschema**: samma personer, en rad var, uppdelat på veckans dagar.
  Dagens dag markeras. Innehållet hämtas direkt från personens
  `calendar_entity` — samma kalender som driver månadsvyn. Kalendrar som
  inte hör till en person (t.ex. en delad familjekalender) samlas i en
  extra delad rad.

> **Uppgraderar du från en äldre version?** Se
> [Uppgradera från tidigare version](#uppgradera-från-tidigare-version)
> längst ner — `entity` har blivit `entities` (lista) och `week_entity` är
> borttaget till förmån för `calendar_entity`.

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
  - name: Anna                     # valfri om person_entity är satt
    person_entity: person.anna     # valfri - hämtar namn + profilbild från HA
    entities:                      # valfri lista, en rad per sensor i Idag-vyn
      - sensor.anna_skola
      - sensor.anna_fritids
    calendar_entity: calendar.anna # driver både vecka och månad
    icon: mdi:account
    color: "#e17055"
  - name: Erik
    entities:
      - sensor.erik_idag
    calendar_entity: calendar.erik
    icon: mdi:account
    color: "#0984e3"
calendars:                          # kalendrar utan koppling till en person
  - entity: calendar.familj
    name: Familj
    color: "#95a5a6"
calendars_label: Övrigt             # radnamn för "calendars" i veckoschemat
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
personer du vill se i kalendern. Det är en annan sorts källa än
`entities` — de senare är fria textsensorer du själv fyller i, medan
`calendar_entity` är en riktig kalender som kortet hämtar events från
direkt via Home Assistants kalender-API (fungerar utmärkt med t.ex. en
sammanslagen cal_combiner-kalender). **Samma `calendar_entity` driver
både veckoschemat och månadskalendern** — ingen separat vecko-sensor
behövs längre.

Varje dag i rutnätet visar en liten prick per person/kalender som har en
händelse den dagen, i respektive `color`. Klicka på en dag för att se en
lista med den dagens händelser (tid, titel och person). Ikon-nyckelorden
(`icon_keywords`) matchas även mot händelsetitlarna i den listan.

Data hämtas per synlig månad (och separat för innevarande vecka, till
veckoschemat) och cachas i 5 minuter.

## Delade kalendrar (utan koppling till en person)

Kalendrar som inte hör till en specifik person — en gemensam
familjekalender, sopschema, eller liknande — läggs under toppnivå-fältet
`calendars`:

```yaml
calendars:
  - entity: calendar.familj
    name: Familj
    color: "#95a5a6"
  - entity: calendar.sopor
    name: Sopor
    color: "#5f9ea0"
calendars_label: Övrigt   # radnamn i veckoschemat, default "Övrigt"
```

Alla kalendrar i listan visas i månadskalendern precis som personers
kalendrar (egna filter-chips och prickar), men i veckoschemat samlas de
i **en enda delad rad** (namnet styrs av `calendars_label`) istället för
en rad var.

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

## Filtrera kalendrar (vecka + månad)

Ovanför kalenderrutnätet visas klickbara chips, en per person med
`calendar_entity` samt en per post i `calendars`. Klick döljer/visar den
källans prickar och händelser i månadskalendern (inklusive
dagsdetalj-listan) **och** i veckoschemat ovanför — samma filter gäller
båda vyerna. Påverkar inte semestermarkeringen, som alltid tar hänsyn till
alla kalendrar oavsett filter.

## Skapa händelser genom att dra i månadskalendern

Dra över flera dagar i rutnätet (håll ner och dra) för att öppna ett litet
formulär där du skriver en titel och väljer vilken kalender (person eller
delad) händelsen ska läggas på — sparas som en heldagshändelse via
`calendar.create_event`. Ett vanligt klick (utan att dra) väljer bara
dagen som vanligt och visar en "+ Lägg till händelse"-knapp för att skapa
en enskild dag på samma sätt.

Kräver att `calendar_entity` pekar på en kalender med skrivstöd (t.ex.
en lokal CalDAV-kalender). Går inte att skapa events på skrivskyddade
kalendrar (t.ex. vissa Google-prenumerationer) — då misslyckas sparandet
tyst och formuläret ligger kvar öppet.

## Hur "Idag"-texten fylls i

`entities` för varje person är en lista med **valfria entiteter** — kortet
visar `state` för var och en, en rad per sensor. Sensorer vars state är
tomt/okänt hoppas över (om alla är tomma visas en enda "Inget planerat
idag"-rad). Enklast är `template`-sensorer du själv definierar, t.ex.
baserat på dina cal_combiner-kalendrar:

```yaml
persons:
  - name: Anna
    entities:
      - sensor.anna_skola
      - sensor.anna_fritids
```

```yaml
template:
  - sensor:
      - name: "Anna skola"
        state: >
          {% set events = state_attr('calendar.anna_skola', 'message') %}
          {{ events if events else '' }}
      - name: "Anna fritids"
        state: >
          {% set events = state_attr('calendar.anna_fritids', 'message') %}
          {{ events if events else '' }}
```

## Hur veckoschemat fylls i

Veckoschemat läser **samma `calendar_entity`** som månadskalendern — inga
separata vecko-sensorer. Kortet hämtar innevarande veckas händelser
(måndag–söndag) direkt via Home Assistants kalender-API och listar
titlarna (flera händelser samma dag separeras med " • "). Saknar en
person `calendar_entity` visas ett streck (`–`) i alla kolumner för den
raden.

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
- Personer: namn, valfri koppling till en HA-`person.*`-entitet, en
  ombyggbar lista med "idag"-sensorer, kalender (vecka + månad), ikon
  och färg
- Delade kalendrar: radnamn i veckoschemat + en lista med
  kalender-entitet, namn och färg
- Allmänna sensorer: entitet, namn och ikon

Alla listor har egna "+ Lägg till..."-knappar och en ✕ för att ta bort
rader. Ändringar sparas direkt i kortets YAML-konfiguration i bakgrunden,
så du kan fortfarande finputsa i YAML-läget om du vill.

Editorn använder `ha-entity-picker` om den är laddad i din frontend
(vilket den normalt är), annars faller den tillbaka på ett vanligt
textfält för entity_id.

## Uppgradera från tidigare version

Från och med version 0.1.0 har konfigurationsformatet ändrats (breaking
change):

- `entity` (en sensor per person) → `entities` (lista, en eller flera
  sensorer per person). Byt `entity: sensor.x` mot
  `entities: [sensor.x]`.
- `week_entity` är borttaget helt. Veckoschemat läser numera
  `calendar_entity` istället (samma entitet som redan användes av
  månadskalendern). Har du inte redan satt `calendar_entity` på dina
  personer behöver du göra det för att få innehåll i veckoschemat.
- Nytt valfritt fält `person_entity` per person (koppla till en
  `person.*`-entitet för att slippa fylla i namn/bild manuellt).
- Nytt toppnivå-fält `calendars` för kalendrar utan koppling till en
  person, plus `calendars_label` för radnamnet de får i veckoschemat.

Gamla konfigurationer med `entity`/`week_entity` ger inget fel, men de
fälten läses inte längre — uppdatera din kort-YAML enligt exemplet högre
upp, eller använd den visuella editorn som redan är byggd för det nya
formatet.

## Idéer för vidare utveckling

- Klickbar person-rad som öppnar en mer detaljerad vy/dialog.
- Färgkodning i veckoschemat baserat på händelsetyp.
- Direktkoppling mot cal_combiners ICS-flöde istället för mellanliggande
  template-sensorer, om du vill slippa hålla sensorerna uppdaterade själv.
- En separat HA-sidopanel för att administrera personer/kalendrar på ett
  ställe, delat mellan flera kort/dashboards (diskuterat, inte påbörjat).
