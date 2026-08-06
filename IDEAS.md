# IDEAS.md – Family Planner Card

Idéer för vidare utveckling, inte implementerade än.

## Flera "idag"-sensorer per person
✅ Klar. `entities` (lista) ersätter det gamla `entity`-fältet — varje
sensor med ett icke-tomt state får sin egen rad under personens namn i
Idag-vyn.

## Enhetlig kalenderkälla för vecka + månad
✅ Klar. `week_entity` är borttaget. Veckoschemat läser numera samma
`calendar_entity` som månadskalendern, hämtat via HA:s kalender-API för
innevarande vecka (cachat 5 min, separat cache från månadsvyn).

## Delade kalendrar utan koppling till en person
✅ Klar. Toppnivå-fältet `calendars` (entity/name/color) syns som egna
filter/prickar i månadskalendern och samlas i en gemensam rad
(`calendars_label`) i veckoschemat.

## Koppling till HA:s person.*-entiteter
✅ Klar. `person_entity` per person hämtar namn (`friendly_name`) och
profilbild (`entity_picture`) automatiskt istället för manuellt
namn/ikon, med fallback till mdi-ikon om ingen bild finns.

## Sidopanel för central konfiguration
Diskuterat men inte påbörjat: en egen sida i HA:s sidopanel (registrerad
via `panel_custom`) där man sätter upp personer/kalendrar/sensorer på ett
ställe. Kräver antingen att panelen fortsätter redigera samma
Lovelace-kort-YAML (då är den bara en rymligare variant av dagens
in-dialog-editor), eller att konfigurationen flyttas till en delad
lagringsplats (t.ex. en HA-helper) som flera kort kan läsa från — det
senare är en större arkitekturändring och behöver beslutas separat.

## Månadskalender
✅ Klar. En riktig kalender i månadsvy under veckoschemat (`show_month_calendar`),
öppnas alltid på innevarande månad, med `‹`/`›`-navigering och en
"Hoppa till idag"-knapp. Läser events via en `calendar_entity` per person
och visar prickar per dag samt en klickbar dagsdetalj-lista. Ikon-nyckelord
matchas mot händelsetitlarna. Går att filtrera per person med chips, och
skapa nya händelser genom att dra över dagar (eller via "+ Lägg till
händelse" på en vald dag) — sparas med `calendar.create_event`, kräver en
kalender med skrivstöd.

Naturliga nästa steg: egna vy-lägen (vecka/dag/lista) utöver månadsvyn,
och möjlighet att redigera/ta bort befintliga events, inte bara skapa nya.

## Väderrad
✅ Klar. `weather.entity` visar aktuell temp/ikon under nedräkningsraden,
och `weather.show_week: true` lägger till en väderrad (ikon + temp per
dag) överst i veckoschemat, hämtad via `weather.get_forecasts`.

## Klickbar person-rad
Klick på en persons rad öppnar en more-info-dialog (standard-HA) eller
navigerar till en egen detaljvy/dashboard för den personen.

## "Nästa händelse" i person-raden
Istället för/utöver dagens sammanfattning: visa nästa kommande händelse
med tid, t.ex. "Härnäst: tandläkare 15:00". Kräver att sensorn även
exponerar tid, inte bara text.

## Färgkodning i veckoschemat
Låt sensor-attributen (t.ex. `monday: "Fotboll 18:00"`) även innehålla en
kategori (skola/fritid/jobb) som mappas till en bakgrundsfärg i cellen i
veckotabellen.

## Direktkoppling mot cal_combiner
Just nu är kortet ett rent visningslager (läser bara `state`/attribut).
På sikt: hämta events direkt från cal_combiners ICS-flöde eller entitet
istället för att gå via mellanliggande template-sensorer, så slipper man
hålla sensorerna uppdaterade manuellt.

## Egen visuell editor
✅ Klar. Kortet har `getConfigElement`/`getStubConfig` och en fristående
`family-planner-card-editor` med entity-pickers, add/remove-listor och
kryssrutor för alla sektioner (nedräkningar, väder, ikon-nyckelord,
semestermarkering, TTS, personer, allmänna sensorer).

## Ikoner istället för/utöver text i "Idag"-raderna
✅ Klar (inkl. bildstöd). `icon_keywords` matchar ord mot en badge som kan
vara emoji, `mdi:`-ikon, eller en bild-URL/lokal sökväg (visas som en
liten rund bild). Fungerar i "Idag"-raden, veckoschemats celler, och
månadskalenderns dagsdetalj-lista, med live-förhandsgranskning i editorn.

Kvar att göra om man vill gå vidare: matcha på hela ord istället för
substräng (undviker t.ex. att "bad" matchar inuti "badminton"), och
möjlighet att visa *bara* badgen utan text som ett kompakt läge.

## Dagens sista/nästa transport
En liten rad med nästa avgång, t.ex. via en Trafikläget/Resrobot-
integration, för den som pendlar.

## Sopschema-rad
En särskild rad för sophämtning med egen ikon/färg som alltid ligger
överst i allmänna raden. Går redan att göra med en vanlig allmän sensor,
men skulle kunna få särbehandling (t.ex. alltid synas, egen plats).

## "Borta"-läge per person
En liten flagga/ikon om någon är bortrest, kopplat till t.ex.
`device_tracker` eller en `zone`-entitet, så personens rad ser annorlunda
ut de dagarna.

## Håll koll på matlådor/middag
En textbaserad variant av allmänna raden (istället för bara ikon när
"on"), t.ex. en rad som visar "Ikväll: tacos" hämtat från en sensor.

## Tryck-och-håll för att redigera veckoschemat
Långt tryck på en cell i veckoschemat öppnar en snabbdialog för att sätta/
ändra rätt attribut på `week_entity` direkt, utan att gå via Developer
Tools. (Motsvarande finns nu i månadskalendern via drag/klick, men inte
i veckotabellen än.)

## Notis-badge i headern
✅ Klar. En röd badge bredvid titeln visar antal aktiva allmänna sensorer,
synlig även när "Idag"-sektionen är ihopfälld.

## Export/dela veckoschema
✅ Klar (textbaserad). En "Dela"-knapp bygger en textsammanfattning av
veckan och öppnar mobilens delningsmeny (Web Share API), eller kopierar
till urklipp om delning inte stöds.

Naturligt nästa steg: en riktig bild/PDF-export istället för ren text —
kräver antingen en canvas-baserad rendering i kortet eller ett externt
bibliotek (svårt att göra snyggt utan en byggprocess).

## Röstuppläsning av dagens schema
✅ Klar. `tts.tts_entity` + `tts.media_player` ger en högtalarikon i
headern som läser upp dagens sammanfattning via `tts.speak`.

## Konflikt-varning vid dubbelbokning
Flagga om en person har två överlappande händelser samma dag i
månadskalendern, t.ex. en liten "!"-ikon på dagen. Kräver att jämföra
start/slut-tider mellan alla events för samma person samma datum.

## Upprepade händelser i skapa-formuläret
Ett "upprepas varje vecka"-kryssruta i drag-skapa-formuläret, så man
slipper lägga in återkommande saker (t.ex. varje måndags fotbollsträning)
en och en. `calendar.create_event` stöder recurrence via `rrule`.

## Flerspråksstöd
Likt pollen pump-integrationen: göra UI-texterna (Idag, Veckoschema,
Dela, etc.) språkstyrda istället för hårdkodad svenska, om kortet
någonsin ska delas vidare eller användas av fler än en själv.

## Exportera/importera konfiguration
En knapp i editorn som kopierar hela kortets YAML till urklipp — bra för
backup eller för att kopiera samma uppsättning till en annan dashboard.

## Utskriftsvänlig CSS
En `@media print`-stil så veckoschemat blir snyggt om man skriver ut det
och sätter på kylskåpet — dölj knappar/navigering, förstora text.

## Notis via notify-tjänst om tom vecka
Komplement till "notis om tom dag": skicka en riktig push-notis (inte
bara UI-badge) via en `notify.*`-tjänst om en persons vecka är helt tom
flera dagar i rad, så man inte missar att sensorn slutat uppdateras även
när man inte har dashboarden öppen.

## Övrigt (lägre prioritet)
- Håll koll på om ha-icon saknas/ogiltig icon-sträng ger tyst fel istället
  för krasch.
- Ev. stöd för fler än 7 dagar i veckoschemat (t.ex. "kommande 14 dagar"
  som alternativt vy-läge).
- Notis/highlight om en person-rad är tom flera dagar i rad (kan tyda på
  att sensorn slutat uppdateras) — visa en "!"-badge i UI:t istället för
  att bara logga det.
- Felmeddelande i UI:t (inte bara tyst fail) om `calendar.create_event`
  misslyckas, t.ex. pga skrivskyddad kalender.
