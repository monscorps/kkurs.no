# kkurs.no — visuell prototype

**Live:** <https://kkurs.no/> (GitHub Pages, `main`-branchen; DNS i Cloudflare-kontoen til Kompetanse Kurs)

Landingsside for **Kompetanse Kurs** (Bergen) — sertifisert og dokumentert sikkerhetsopplæring
og HMS-kompetanse. Bygget som rask, statisk prototype i Sapio-stil, der kurskalender og
påmelding er attrapper til FrontCore-API-et kobles på (via proxy, se `docs/PRODUKSJONSPLAN.md`).

> **Status:** i drift på kkurs.no. Påmelding og kontakt går som e-post til bestilling@kkurs.no til FrontCore er koblet.

## Kjøre lokalt

```bash
python3 tools/bygg.py
python3 -m http.server 4173 --directory .
```

Åpne <http://localhost:4173>. Ingen avhengigheter — `tools/bygg.py` (ren Python) lager kurssidene
under `kurs/`, `sitemap.xml` og `robots.txt`. Disse er generert og ligger ikke i git; ved hver push
bygger GitHub Actions dem på nytt og publiserer (`.github/workflows/publiser.yml`).

## Struktur

| Fil | Innhold |
| --- | --- |
| `index.html` | Forsiden (hero, fagområder, våre kurs, kalender, om, nyheter, partnere, kontakt) + påmeldings- og kontaktvindu |
| `assets/styles.css` | Designsystemet («Nordsjø» — se `docs/DESIGN.md`) |
| `assets/kurs.json` | **Alt kursinnhold** — én kilde for kursliste, kalender, kurssider og påmelding |
| `assets/app.js` | Rendering, filtre, påmelding og skjema-demo — deles av forsiden og kurssidene |
| `tools/bygg.py` | Lager én side per kurs (`kurs/<id>/`), «Våre kurs» (`kurs/`) og sitemap |
| `docs/DESIGN.md` | Designnotat, research-funn og anbefalt teknisk retning |

## Endre innhold (slik driftes kursene i dag)

Alt kursinnhold ligger i **én fil: [`assets/kurs.json`](assets/kurs.json)** — navn, koder,
priser, beskrivelser, datoer, sted og antall plasser (`plasser` totalt / `ledige` nå).
Kurskatalogen, kurskalenderen og påmeldingsskjemaet genereres derfra:
**endre ett sted, oppdateres overalt** — ingen dobbeltarbeid.

Enkleste arbeidsflyt for drifter: åpne filen på GitHub → blyantikonet (rediger) → endre/legg
til kurs → «Commit changes». Siden bygges og publiseres automatisk på et par minutter.

**Klargjøre et kurs uten å vise det:** legg det inn med `"synlig": false` (slik Arbeidsvarsling
1-2-3 ligger nå). Kurset vises da ingen steder og får ingen kursside. Når det skal publiseres:
endre til `"synlig": true` (eller fjern linjen) og lagre.

## Kurssider — lenke til et kurs i e-post

Hvert synlige kurs får en egen side med fast adresse, `kkurs.no/kurs/<id>/` — f.eks.
`kkurs.no/kurs/truck/`. Adressen kan limes rett
inn i e-post; siden har kursbeskrivelse, fakta, kommende datoer med påmelding og «Be om tilbud».
Knappen «Kopier lenke til kurset» øverst på siden kopierer adressen. «Våre kurs» (`kurs/`) samler
alle kursene på én side. **Ikke endre `id` på et kurs etter at lenken er sendt ut** — da slutter
den gamle lenken å virke.

Ved lansering byttes filen ut med FrontCore som kilde, og da administreres kursene i
FrontCore-adminen i stedet (samme prinsipp: legg inn kurset ett sted, alt oppdateres).

## Innholdssider (HMS, Oppkjøring, Bevis …)

Sider som ikke er kurs ligger som HTML-fragmenter i `sider/`. Første linje er en kommentar med
JSON-meta (`sti`, `tittel`, `beskrivelse`, `bilde`); resten er innholdet i `<main>`. `tools/bygg.py`
pakker dem inn i samme meny, bunn og vinduer som resten av siden og skriver `<sti>/index.html`.
Ny side på toppnivå: legg `/<sti>/` i `.gitignore` (den er generert). Knapper med `data-tilbud
data-tema="Oppkjøring"` åpner kontaktskjemaet med temaet forhåndsvalgt.

## Kursinnhold

Hvert kurs i `assets/kurs.json` kan ha `innhold` (avsnitt `{"p"}`, underoverskrift `{"h"}`,
punktliste `{"ul"}`; lenker skrives `[tekst](kurs/fallsikring/)`), `priser` (prislinjer som vises
i priskortet), `sidetittel`, `prismerknad` og `lenker`. Alle priser er eks. mva.

## Bytte herobilde

Heroen bruker `assets/img/hero.jpg` (kundens egen collage: offshore + gravemaskin med grønn
stripe). Fire alternativer ligger klare: `hero-alt-fjord.jpg` (gyllen fjord + gravemaskin),
`hero-alt-kran.jpg` (kranløft i motlys), `hero-alt-lager.jpg` (varm lagerhall),
`hero-alt-kurs.jpg` (kurssituasjon i dagslys). Bytt ved å erstatte `hero.jpg` og bumpe
`?v=` på bildelenken i `index.html`.

## Påmelding og kontakt (til FrontCore er koblet)

Så lenge `API_URL` i `assets/app.js` er tom, sendes påmelding og kontaktskjema som **e-post**:
skjemaet åpner besøkendes e-postprogram med alt ferdig utfylt (kurs, dato, deltakere, kontaktperson,
bedrift, org.nr.) til `bestilling@kkurs.no` (`SKJEMA_EPOST`). Kvitteringen sier at man må trykke
Send, og viser adresse og telefon hvis e-postprogrammet ikke åpnet seg. Kurs uten datoer får
«Meld interesse»; kalenderen på forsiden viser «Se alle kurs / Be om tilbud» når ingen datoer er satt.
Ingen eksempeldatoer skal ligge i `kurs.json` på det ekte domenet — legg inn bare ekte datoer.

## Ved lansering (FrontCore-kobling)

1. Opprett FrontCore-konto og hent embed-snutt for kurskalender/påmelding.
2. Erstatt innholdet i `#kalender`-seksjonen med FrontCore-embeden (den kan fargetilpasses
   paletten i `styles.css`), eller behold vår tabell og hent data fra FrontCore-API-et.
3. Pek «Meld deg på»-knappene til FrontCore-påmelding.
4. Koble kontaktskjemaet til e-post/CRM, legg inn Google Analytics + samtykkebanner,
   og fjern «forhåndsvisning»-merknadene (søk etter «Forhåndsvisning» i `index.html`).
5. Bytt plassholdere: org.nr., adresser, telefon, SoMe-lenker.

## Hosting

Statisk side med ett lite byggesteg. I dag: GitHub Pages via Actions (`publiser.yml`) på kkurs.no — DNS-postene (A/AAAA til GitHub Pages,
`www` → `monscorps.github.io`) ligger i Cloudflare uten proxy; Google-postene for e-post er urørt.
Mål: Cloudflare Pages i Kompetanse Kurs' egen konto — byggkommando `python3 tools/bygg.py`,
utdatamappe `/`, miljøvariabel `NETTSTED_URL=https://kkurs.no`. Se `docs/PRODUKSJONSPLAN.md` §8.
