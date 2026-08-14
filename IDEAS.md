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
✅ Klar, och sedan uppgraderad till en riktig integration
(`custom_components/family_planner`) istället för en ren frontend-lösning
- HACS laddar bara ner den fil som pekas ut i `hacs.json` för
"Dashboard"-kategorin, så en fristående panel-JS-fil i samma repo följde
aldrig med automatiskt, och `frontend/user_data` var dessutom knutet till
en enskild HA-användare istället för delat mellan hela familjen.
Integrationen registrerar panelen och serverar dess JS själv (egen
statisk sökväg), och sparar i HA:s egen storage
(`.storage/family_planner_config`) via två websocket-kommandon
(`family_planner/get_config`/`save_config`). Installeras som en andra
HACS-kategori ("Integration") av samma repo, sätts upp via
Inställningar → Enheter & tjänster.

Naturligt nästa steg: låta panelen även redigera fler av kortets globala
inställningar (väder, TTS, semestermarkering) om man vill undvika att
upprepa dem per kort/dashboard också.

## Månadskalender
✅ Klar. En riktig kalender i månadsvy under veckoschemat (`show_month_calendar`),
öppnas alltid på innevarande månad, med `‹`/`›`-navigering och en
"Hoppa till idag"-knapp. Läser events via en `calendar_entity` per person
och visar prickar per dag samt en klickbar dagsdetalj-lista. Ikon-nyckelord
matchas mot händelsetitlarna. Går att filtrera per person med chips, och
skapa nya händelser genom att dra över dagar (eller via "+ Lägg till
händelse" på en vald dag) — sparas med `calendar.create_event`, kräver en
kalender med skrivstöd.

✅ Klar (redigering). Klick på en händelse (i månadsvyns dagsdetalj eller
veckoschemat) öppnar samma dialog i redigeringsläge - byt titel/tid/plats/
beskrivning/bild, flytta till en annan kalender, eller ta bort.

Naturligt nästa steg: egna vy-lägen (vecka/dag/lista) utöver månadsvyn.

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

## Förhandsgranskning av utfallet i konfigurationsstegen
✅ Klar (för Idag-sensorer, nedräkningar, allmän rad). Varje entitetsväljare
i de tre stegen visar en liten rad under sig med vad valet faktiskt ger
just nu (t.ex. "5 dagar kvar", eller "Visar just nu: 'Fotboll 18:00'"),
och flaggar tydligt (röd text) om entiteten saknas, ger ett tomt/av-state,
eller har ett datumattribut som inte går att tolka. Uppdateras inte live
av bakgrundsuppdateringar - bara när man ändrar fältet, samma medvetna
avvägning som ikon-nyckelordens förhandsvisning.

Kvar att göra om man vill gå vidare: samma slags förhandsgranskning för
väder-/TTS-entiteterna och kalenderväljarna (person/calendar_entity,
delade kalendrar, borta-kalendrar).

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
✅ Klar, fast löst annorlunda än ursprungstanken (som byggde på det sedan
länge borttagna `week_entity`-attributet, se "Enhetlig kalenderkälla för
vecka + månad" ovan). Klick på en händelse i veckoschemat öppnar numera
samma redigera-dialog som månadskalendern, istället för ett långt tryck
mot ett attribut.

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

## Notiser och påminnelser för kommande händelser
Skicka en riktig påminnelse (push via `notify.*` och/eller TTS) ett valbart
antal minuter/timmar innan en händelse i kalendern börjar, t.ex. "Fotboll om
30 min". Skiljer sig från "Notis via notify-tjänst om tom vecka" ovan (som
varnar om en persons vecka är tom) genom att istället varna *innan* en
specifik händelse. Kräver troligen en bakgrundskoll (automation eller
periodisk uppdatering i integrationen) som med jämna mellanrum går igenom
kommande events per person och skickar en notis för de som ligger inom
påminnelsefönstret och inte redan notifierats om, plus ett sätt att sätta
påminnelsetid globalt eller per person/kalender i sidopanelen.

## Dynamisk text i nedräkningsnamnet
Just nu är `name` på en nedräkning en helt statisk text. Låt den innehålla
platshållare som fylls i från sensorns attribut vid rendering, t.ex. skriva
"Farfar fyller {age} år" i konfigurationen och få "Farfar fyller 70 år"
visat, där `{age}` hämtas från ett valt attribut på nedräkningens `entity`
(vanligt på t.ex. födelsedagsintegrationer som räknar ut ålder). Skulle
kunna kombineras med idén om förhandsgranskning i panelen så man ser det
ifyllda resultatet direkt när man skriver mallen.

## Dölj händelser via ikon-koppling
Alternativ till den enkla "dölj i vecko-/månadskalender"-kryssrutan
(klar, se redigera-dialogen): låta döljandet styras av vilket
ikon-nyckelord händelsen matchar/tilldelas istället för en fristående
kryssruta. I sidopanelens nyckelordslista skulle varje `icon_keywords`-
post kunna få en egen "dölj matchande händelser"-flagga, så alla
händelser med den ikonen automatiskt försvinner från vecko-/
månadsvyerna utan att behöva kryssas i varje enskild händelse för sig.

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
