# rsgiggaren1
# RSG Coach

RSG Coach är en privat iPhone-anpassad PWA för hård hypertrofiträning. Appen fungerar offline, sparar träningsdata lokalt på enheten och kan installeras från Safari utan App Store.

## Öppna och installera på iPhone

1. Öppna appens webblänk i Safari.
2. Tryck på Dela.
3. Välj **Lägg till på hemskärmen**.
4. Öppna därefter RSG Coach från hemskärmsikonen.

Appen kan delas med en vän genom att skicka samma webblänk via Meddelanden, e-post eller AirDrop. Varje person får sin egen lokala träningsdata.

## Uppdatera utan att förlora träningsdata

- Appen söker efter en ny version när den startar, återgår till förgrunden och minst en gång i timmen medan den är öppen.
- När en uppdatering finns visas en knapp i appen. Pågående set, passutkast, övningsbyten och historik sparas innan omladdning.
- Historiken ligger i samma beständiga lagringsnyckel som första versionen. Service worker-cachen kan bytas utan att träningsdata raderas.
- Skapa gärna en JSON-kopia under **Profil → Data & uppdateringar → Exportera säkerhetskopia**. Där kan kopian även återställas.

Radera inte webbplatsdata för appens domän i iPhone-inställningarna; det tar bort lokalt sparad historik.

## Träningsfunktioner

- 12 program med 11–13 klassiska bodybuildingövningar per pass.
- 141 övningar för bröst, rygg, trapezius, axlar, armar, underarmar, ben, säte, vader och mage.
- Övningsbyten direkt i passet, sparade per program och pass.
- Automatisk övningsanpassad vilotimer först när både vikt och reps har fyllts i och setet loggas.
- Bakgrundssäker timer, `+30 s`, vibration och återställning när appen öppnas igen.
- Double progression, RIR, readiness, passhistorik och lokala säkerhetskopior.

## Lokal kontroll

Kör från repots rot:

```sh
node tests/validate.mjs
node --check service-worker.js
```

För webbläsartest kan katalogen serveras lokalt med valfri statisk webbserver. Huvudappen är fortsatt den befintliga filen `Coash 1.0.html`; ingen parallell appversion används.
