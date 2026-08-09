# Family Planner Card

En Home Assistant-**integration** (`custom_components/family_planner`)
som levererar en Lovelace-card + en sidopanel i ett paket:

- **Idag** (fällbar sektion): en eller flera rader per person, en per
  konfigurerad `entities`-sensor (t.ex. en template-sensor du fyller med
  dagens text), plus en **allmän rad** med sensorer som bara syns som
  runda ikoner när de är `on`.
- **Veckoschema**: samma personer, en rad var, uppdelat på veckans dagar.
  Dagens dag markeras. Innehållet hämtas direkt från personens
  `calendar_entity` — samma kalender som driver månadsvyn. Kalendrar som
  inte hör till en person (t.ex. en delad familjekalender) samlas i en
  extra delad rad.
- **Sidopanel** ("Familjeplanering" i sidomenyn): bygg upp **all**
  konfiguration (titel, nedräkningar, väder, personer, delade kalendrar,
  ikon-nyckelord, månadskalender, semestermarkering, TTS, allmänna
  sensorer) på **ett** ställe, delat mellan hur många kort/dashboards
  som helst — se
  [Sidopanelen](#sidopanelen).

Kortet självt har ingen egen konfiguration — `type: custom:family-planner-card`
räcker. Allt sätts upp i sidopanelen.

Integrationen installeras **en gång** och sköter resten själv: kortet
laddas automatiskt på alla dashboards (ingen manuell Lovelace-resurs),
och panelen dyker upp i sidomenyn (ingen manuell `panel_custom`-rad i
`configuration.yaml`).

> **Uppgraderar du från en äldre version?** Se
> [Uppgradera från tidigare version](#uppgradera-från-tidigare-version)
> längst ner.

## Installation

### Via HACS (rekommenderas)

1. Öppna **HACS → tre punkter (uppe till höger) → Anpassade repositories**.
2. Lägg till URL:en till detta repo:
   `https://github.com/Cebbas/family-planner-card`
   Kategori: **Integration**.
3. Sök upp "Family Planner" i HACS och klicka **Ladda ner**.
4. **Starta om Home Assistant.**
5. Gå till **Inställningar → Enheter & tjänster → Lägg till integration**,
   sök på **"Family Planner"** och lägg till den (ingen konfiguration
   behövs, klicka bara igenom den enda rutan).

Kortet är nu tillgängligt på alla dashboards
(`type: custom:family-planner-card`) och länken **"Familjeplanering"**
har dykt upp i sidomenyn.

Framtida uppdateringar syns som vanligt i HACS när nya releaser skapas -
uppdatera, starta om HA, klart.

### Manuellt

1. Kopiera hela mappen `custom_components/family_planner/` till
   `/config/custom_components/` i din HA-installation (t.ex. via
   Samba/Studio Code Server).
2. Starta om Home Assistant.
3. Lägg till integrationen som i steg 5 ovan.

## Lägga till kortet

Kortet tar ingen konfiguration - lägg till det på valfritt dashboard med:

```yaml
type: custom:family-planner-card
```

Öppna sedan sidopanelen **"Familjeplanering"** i sidomenyn för att sätta
upp titel, nedräkningar, väder, personer, kalendrar, ikon-nyckelord,
månadskalender, semestermarkering, TTS och allmänna sensorer - se
[Sidopanelen](#sidopanelen). Alla kort på instansen visar samma data.

## Nedräkningsraden (överst)

Lägg till valfritt antal nedräkningar under **Nedräkningar** i
sidopanelen: en entity-picker, ett namn, ett valfritt attributnamn och en
"Visa alltid"-kryssruta per post. Datumet läses från entitetens `state`
(`YYYY-MM-DD`, funkar även med fullt datetime) - eller, om ett
**attribut med datum** anges, från det attributet istället (för sensorer
som redan har ett eget "dagar kvar"-tal som state och lägger själva
datumet i ett attribut, t.ex. `next_date`). Kortet räknar ut antal dagar
kvar och sorterar automatiskt på närmast i tid.

- "Hur många nedräkningar som visas normalt" styr hur många som visas
  (default 5).
- "Visa alltid" gör att en post **alltid** visas, även om den inte är
  bland de närmaste — den läggs till extra och hela raden sorteras sedan
  om på dagar kvar. Fungerar även för redan passerade datum (visar "X
  dagar sedan").
- Poster utan giltigt datum eller med ogiltig entitet hoppas över tyst.

Exempel på sensor:

```yaml
template:
  - sensor:
      - name: "Jul"
        state: "{{ '2026-12-24' }}"
```

## Väderrad

Välj en `weather.*`-entitet under **Väder** i sidopanelen för att visa
aktuell temperatur + ikon i en liten rad direkt under nedräkningarna.

Kryssa i "Visa väderprognos för veckans dagar" för att även få en
väderrad överst i veckoschemat, med ikon + avrundad temperatur per dag.
Den hämtar prognosen
via `weather.get_forecasts` (samma tjänst som HA:s egna väderkort använder)
och matchar varje prognospost mot rätt veckodagskolumn. Dagar utan
prognosdata (t.ex. redan passerade dagar i veckan, eller dagar längre bort
än prognosen sträcker sig) visar bara ett streck.

Prognosen cachas i 20 minuter innan den hämtas på nytt, så kortet inte
spammar väder-API:et.

## Ikon-nyckelord (matcha ord i händelser mot en ikon)

Lägg till globala ikon-nyckelord i sidopanelen: ett ord/fras att matcha
plus en ikon. Ikonen kan vara:

- en emoji, t.ex. `⚽`
- en `mdi:`-ikon, t.ex. `mdi:tooth`
- en bild-URL eller lokal sökväg, t.ex. `https://example.com/fotboll.png`
  eller `/local/icons/fotboll.png` — visas som en liten rund bild

Kortet söker efter ordet i texten (skiftlägesokänsligt, substräng) och
visar badgen (ikon/emoji/bild) framför texten — både i "Idag"-raden och i
varje cell i veckoschemat. Första träffen i listan vinner om flera ord
matchar samma text.

Så om en persons "idag"-sensor har state `"Fotbollsträning 17:00"` visas
⚽ framför texten automatiskt, utan att du behöver ändra sensorn.

Lokala bilder lägger du precis som kortet självt i `/config/www/` och
pekar på dem som `/local/dinbild.png`.

### Person-specifika ikon-nyckelord

Varje person i sidopanelen kan ha en egen lista med ikon-nyckelord som
matchar **före** de globala — perfekt för att samma ord ska ge olika
bild beroende på vem det gäller, t.ex. respektive barns egna lagbild vid
"Fotbollsträning". Lägg till dem under personens kort i sidopanelen.

Matchar inget av personens egna nyckelord provas de globala
ikon-nyckelorden som vanligt.

## Månadskalender

Under veckoschemat finns en riktig kalender i månadsvy, aktiverad som
standard (kryssrutan i sidopanelens **Månadskalender**-sektion). Bläddra
mellan månader med `‹`/`›` — den öppnas alltid på innevarande månad.

Sätt en kalender-entitet (en vanlig `calendar.*`-entitet) på de personer
du vill se i kalendern, i sidopanelen. Det är en annan sorts källa än
"idag"-sensorerna — de senare är fria textsensorer du själv fyller i,
medan kalender-entiteten är en riktig kalender som kortet hämtar events från
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
familjekalender, sopschema, eller liknande — läggs till under **Delade
kalendrar** i sidopanelen (entitet, namn och färg per kalender), plus ett
radnamn för dem i veckoschemat (default "Övrigt").

Alla kalendrar i listan visas i månadskalendern precis som personers
kalendrar (egna filter-chips och prickar), men i veckoschemat samlas de
i **en enda delad rad** istället för en rad var.

## Borta hos andra föräldern

För familjer med barn som växelvis bor hos en annan förälder: lägg till en
eller flera kalendrar under **Borta hos andra föräldern** i sidopanelen
(kalender-entitet, en text som "Hos pappa", en färg, och vilka
barn/personer den gäller för — en kalender kan gälla för flera barn på
en gång). Kalendern får sina händelser precis som vilken kalender som
helst (t.ex. synkad från en samarbetsapp eller en delad Google-kalender).

- **Idag-vyn:** ett barn tonas ner (gråtonas) hela raden så länge en
  händelse i en av deras borta-kalendrar pågår just nu.
- **Månadskalendern:** dagar som täcks av en borta-händelse färgas i
  kalenderns bakgrundsfärg. Är två barn borta samma dag med olika
  kalendrar/färger delas dagcellen i lika stora horisontella fält, en
  färg per kalender. Går före semestermarkeringen om båda skulle träffa
  samma dag, och (precis som semestermarkeringen) ignorerar filter-chipsen
  ovanför kalendern — de döljer bara prickar/händelselistan, inte vem som
  faktiskt är borta.
- Kalendern dyker även upp som en egen rad-källa i veckoschemat under
  respektive barns rad, och i månadsvyns dagsdetalj med den angivna
  texten, precis som delade kalendrar.

Flerdagarshändelser (t.ex. en hel "fre–sön hos pappa"-helg) räknas nu
korrekt varje dag de pågår, inte bara på startdagen — samma fix gäller
även semestermarkeringen och de vanliga kalendrarna.

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

Sätt en `tts.*`-entitet och en högtalare (`media_player.*`) under
**Röstuppläsning (TTS)** i sidopanelen för att få en högtalarikon i
headern. Ett klick bygger ihop en mening av alla
personers "idag"-text plus eventuella aktiva allmänna sensorer, och kör
`tts.speak` mot vald högtalare — bra att koppla till en knapp i
morgonrutinen. Kräver en TTS-integration konfigurerad i HA (t.ex. Piper,
Google Translate, eller Amazon Polly).

## Semestermarkering i månadskalendern

Lägg till semestermarkeringar i sidopanelen: ett ord att matcha och en
hex-färg. Matchas mot alla händelsers titlar den dagen (över alla
personers kalendrar), och om något matchar färgas hela dagcellen i
månadskalendern med den färgen — bra för att visa skolans lovdagar
direkt i vyn.

## Filtrera kalendrar (vecka + månad)

Ovanför kalenderrutnätet visas klickbara chips, en per person med
`calendar_entity`, en per borta-kalender, samt en per post i `calendars`.
Klick döljer/visar den källans prickar och händelser i månadskalendern
(inklusive dagsdetalj-listan) **och** i veckoschemat ovanför — samma
filter gäller båda vyerna. Påverkar inte semestermarkeringen eller
borta-bakgrunden i månadskalendern, som alltid tar hänsyn till alla
kalendrar oavsett filter.

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

"Idag-sensorer" för varje person i sidopanelen är en lista med
**valfria entiteter** — kortet visar `state` för var och en, en rad per
sensor. Sensorer vars state är tomt/okänt hoppas över (om alla är tomma
visas en enda "Inget planerat idag"-rad). Enklast är `template`-sensorer
du själv definierar, t.ex. baserat på dina cal_combiner-kalendrar:

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
titlarna (flera händelser samma dag separeras med " • "). En persons rad
visar även händelser från alla borta-kalendrar som barnet är kopplat
till, blandat med deras egna kalenderhändelser. Saknar en person
`calendar_entity` och inga borta-kalendrar visas ett streck (`–`) i alla
kolumner för den raden.

## Allmänna raden (idag)

Lägg till valfritt antal entiteter under **Allmänna sensorer** i
sidopanelen (entitet, namn, ikon). Bara de som just nu har state `on`
visas som en rund ikon-badge med namn under. Fungerar bra med
`binary_sensor`-entiteter, t.ex. från din activity-sensor-funktion i
cal_combiner.

## Sidopanelen

Sidopanelen **"Familjeplanering"** dyker upp i sidomenyn så fort
integrationen är installerad (se [Installation](#installation) högst
upp) - inget extra steg behövs för att få fram själva panelen. Den är
den **enda** platsen att konfigurera Family Planner Card på: titel,
nedräkningar, väder, personer, delade kalendrar, borta-kalendrar, globala
ikon-nyckelord, månadskalender, semestermarkering, TTS och allmänna
sensorer. Bygg upp allt och klicka **Spara**.

Datan lagras i Home Assistants egen storage
(`.storage/family_planner_config`), delad mellan alla som loggar in på
din HA-instans **och** alla Family Planner-kort du lägger till - lägg
till kortet på så många dashboards du vill, de visar alla samma data
(cachas 5 minuter per kort).

Panelen använder `ha-entity-picker` om den är laddad i din frontend
(vilket den normalt är), annars faller den tillbaka på ett vanligt
textfält för entity_id.

## Uppgradera från tidigare version

Från och med version 0.4.3 har kortet **ingen egen konfiguration längre**
(breaking change): `title`, `countdowns`, `weather`, `persons`,
`calendars`, `calendars_label`, `icon_keywords`, `show_month_calendar`,
`vacation_keywords`, `tts` och `general` i kortets YAML läses inte
längre alls - allt hämtas nu från sidopanelen. Om du redan hade
`persons`/`calendars`/`icon_keywords` sparat i panelen (den delade
konfigurationen som redan fanns) syns de som vanligt. De inställningar
du tidigare bara satt i kortets egen YAML (titel, nedräkningar, väder,
`show_month_calendar`, semestermarkering, TTS, allmänna sensorer) finns
inte i den sparade panel-datan ännu - öppna sidopanelen och fyll i dem
där (se [Sidopanelen](#sidopanelen)), annars visas kortet med tomma
defaultvärden för de fälten. Du kan ta bort alla fält utom `type` ur
kortets YAML - de ignoreras ändå.

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
- Nytt valfritt fält `icon_keywords` per person (matchar före de globala).
- Kortet levereras numera tillsammans med en sidopanel för att sätta upp
  all konfiguration på ett ställe - se [Sidopanelen](#sidopanelen).

Gamla konfigurationer med `entity`/`week_entity` ger inget fel, men de
fälten läses inte längre — sätt upp personerna på nytt i sidopanelen
istället (se [Sidopanelen](#sidopanelen)).

> **Installerade du kortet innan det flyttade in i
> `custom_components/family_planner`?** Paketeringen har ändrats två
> gånger på kort tid - städa upp enligt nedan innan du installerar om:
>
> 1. Ta bort ev. manuell `panel_custom`-rad i `configuration.yaml` (om du
>    testade den allra första sidopanel-versionen).
> 2. Ta bort den gamla Lovelace-resursen för kortet manuellt:
>    **Inställningar → Instrumentpaneler → Resurser** → hitta och ta bort
>    `family-planner-card.js`-raden (annars laddas kortet dubbelt - en
>    gång från den gamla resursen, en gång automatiskt av integrationen
>    - och `customElements.define` kraschar på den andra).
> 3. I HACS: ta bort det gamla repot under kategorin **Dashboard** om du
>    lade till det så (tre punkter på repot → Ta bort). Repot ska bara
>    finnas kvar under kategorin **Integration**.
> 4. Uppdatera/ladda ner integrationen på nytt i HACS och starta om HA.
>
> Eventuell data du hann spara i den allra första panel-versionen
> (`frontend/user_data`) följer inte med automatiskt - bygg upp
> personerna på nytt i panelen (troligen snabbt gjort om du bara hann
> testa lite).

## Idéer för vidare utveckling

- Klickbar person-rad som öppnar en mer detaljerad vy/dialog.
- Färgkodning i veckoschemat baserat på händelsetyp.
- Direktkoppling mot cal_combiners ICS-flöde istället för mellanliggande
  template-sensorer, om du vill slippa hålla sensorerna uppdaterade själv.
