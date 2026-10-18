# Nyheter fra Facebook (Juicer)

Det Kompetanse Kurs poster på Facebook-siden, vises under «Siste nytt» på forsiden — i sidens
eget design. Innleggene hentes av [Juicer](https://www.juicer.io) (gratisplanen, godkjent av
kunden), og `assets/app.js` + `assets/styles.css` legger dem i sidens kortrutenett med norsk dato
og «Les på Facebook →».

Feedens navn står i `index.html` på `<div id="nyheter-feed" data-juicer="">`. **Tomt** = bare
reservekortet «Nyheter og kursdatoer på Facebook» vises (slik siden er nå).

## Engangsoppsett (10 minutter)

1. **Juicer-konto:** den som skal eie feeden (helst kunden selv, f.eks. Tom) lager en gratis
   konto på <https://www.juicer.io> og trykker **Create feed**.
2. **Kilde:** legg til **Facebook** → «Facebook Page» → logg inn med en Facebook-bruker som er
   administrator på Kompetanse Kurs-siden og velg siden. (Gratisplanen tillater én kilde.)
3. **Innstillinger i Juicer** (resten styres av nettsiden):
   - *Feed settings → Lazy-load images:* på.
   - *Templates → Pagination:* None.
   - *Settings → Open overlay on post click:* av (kortene lenker rett til Facebook-innlegget).
4. **Feednavnet:** under **Embed** står en kode med `…/embed/<feednavn>/embed-code.js`. Skriv
   `<feednavn>` inn i `index.html`: `data-juicer="<feednavn>"` — og lagre (siden publiseres
   automatisk). Ikke lim inn Juicers egen kode; nettsiden laster den selv.

## Slik oppfører den seg

- Juicer-skriptet lastes først når besøkende nærmer seg nyhetsseksjonen.
- Fem innlegg + Juicers reklamekort (påkrevd på gratisplanen — det beholdes, men er stylet
  diskret og ligger sist) = seks kort, tre i bredden. På mobil vises to innlegg og «Vis alle».
- **Gratisplanens begrensninger:** Juicer henter nye innlegg fra Facebook **én gang i døgnet**,
  og feeden har et **tak på visninger per måned**. Når taket er nådd, skjuler Juicer feeden til
  måneden er omme — da står reservekortet med lenke til Facebook-siden. Det samme skjer hvis
  Juicer ikke svarer innen 8 sekunder eller feednavnet er feil.
- Trengs oftere oppdatering, ingen reklamekort eller ubegrensede visninger: Juicers billigste
  betalte plan. Ingenting i nettsiden må endres.

Juicer setter ingen informasjonskapsler på kkurs.no, men innleggene og bildene lastes fra
juicer.io (som da ser besøkendes IP-adresse) — nevnes i personvernerklæringen når den kommer.
