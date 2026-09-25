# kkurs.no — visuell prototype

**Live forhåndsvisning:** <https://monscorps.github.io/kkurs.no/> (GitHub Pages, `main`-branchen)

Landingsside for **Kompetanse Kurs** (Bergen) — sertifisert og dokumentert sikkerhetsopplæring
og HMS-kompetanse. Bygget som rask, statisk prototype i Sapio-stil, der kurskalender og
påmelding er attrapper til FrontCore-API-et kobles på (via proxy, se `docs/PRODUKSJONSPLAN.md`).

> **Status:** forhåndsvisning med eksempeldata. Ingen skjemaer sender data.

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
`kkurs.no/kurs/truck/` (i dag `monscorps.github.io/kkurs.no/kurs/truck/`). Adressen kan limes rett
inn i e-post; siden har kursbeskrivelse, fakta, kommende datoer med påmelding og «Be om tilbud».
Knappen «Kopier lenke til kurset» øverst på siden kopierer adressen. «Våre kurs» (`kurs/`) samler
alle kursene på én side. **Ikke endre `id` på et kurs etter at lenken er sendt ut** — da slutter
den gamle lenken å virke.

Ved lansering byttes filen ut med FrontCore som kilde, og da administreres kursene i
FrontCore-adminen i stedet (samme prinsipp: legg inn kurset ett sted, alt oppdateres).

## Bytte herobilde

Heroen bruker `assets/img/hero.jpg` (kundens egen collage: offshore + gravemaskin med grønn
stripe). Fire alternativer ligger klare: `hero-alt-fjord.jpg` (gyllen fjord + gravemaskin),
`hero-alt-kran.jpg` (kranløft i motlys), `hero-alt-lager.jpg` (varm lagerhall),
`hero-alt-kurs.jpg` (kurssituasjon i dagslys). Bytt ved å erstatte `hero.jpg` og bumpe
`?v=` på bildelenken i `index.html`.

## Bookingflyt i forhåndsvisningen (simulert)

Påmeldingen demonstrerer hele den ønskede flyten, uten at noe faktisk sendes:
valg av **faktura eller Vipps**, kalender som viser **antall ledige plasser**, kapasitetssjekk
(kan ikke melde på flere enn det er plasser til), **venteliste** når et kurs er fullt, og en
kvittering som viser hva som skjer automatisk ved lansering: bekreftelses-e-post til
bestilleren, varsel til `bestilling@kkurs.no`, og nedtrekk av ledige plasser i kalenderen.
I produksjon leveres alt dette av FrontCore (Vipps/kort/faktura, e-poster, venteliste,
plasstelling).

## Ved lansering (FrontCore-kobling)

1. Opprett FrontCore-konto og hent embed-snutt for kurskalender/påmelding.
2. Erstatt innholdet i `#kalender`-seksjonen med FrontCore-embeden (den kan fargetilpasses
   paletten i `styles.css`), eller behold vår tabell og hent data fra FrontCore-API-et.
3. Pek «Meld deg på»-knappene til FrontCore-påmelding.
4. Koble kontaktskjemaet til e-post/CRM, legg inn Google Analytics + samtykkebanner,
   og fjern «forhåndsvisning»-merknadene (søk etter «Forhåndsvisning» i `index.html`).
5. Bytt plassholdere: org.nr., adresser, telefon, SoMe-lenker.

## Hosting

Statisk side med ett lite byggesteg. I dag: GitHub Pages via Actions (`publiser.yml`).
Mål: Cloudflare Pages i Kompetanse Kurs' egen konto — byggkommando `python3 tools/bygg.py`,
utdatamappe `/`, miljøvariabel `NETTSTED_URL=https://kkurs.no`. Se `docs/PRODUKSJONSPLAN.md` §8.
