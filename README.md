# kkurs.no — visuell prototype

**Live forhåndsvisning:** <https://monscorps.github.io/kkurs.no/> (GitHub Pages, `main`-branchen)

Landingsside for **Kompetanse Kurs** (Bergen) — sertifisert og dokumentert sikkerhetsopplæring
og HMS-kompetanse. Bygget som rask, statisk prototype i Sapio-stil, der kurskalender og
påmelding er attrapper som speiler **FrontCore**-widgeten til vi har konto/API på plass.

> **Status:** forhåndsvisning med eksempeldata. Ingen skjemaer sender data.

## Kjøre lokalt

```bash
python3 -m http.server 4173 --directory .
```

Åpne <http://localhost:4173>. Ingen byggesteg, ingen avhengigheter.

## Struktur

| Fil | Innhold |
| --- | --- |
| `index.html` | Hele siden (hero, kurs, kalender, tjenester, om, nyheter, partnere, kontakt) + påmeldingsmodal |
| `assets/styles.css` | Designsystemet («Nordsjø» — se `docs/DESIGN.md`) |
| `assets/app.js` | **Kursdata (eksempel)** øverst i filen + rendering, filtre, modal og skjema-demo |
| `docs/DESIGN.md` | Designnotat, research-funn og anbefalt teknisk retning |

## Endre innhold (slik driftes kursene i dag)

Alt kursinnhold ligger i **én fil: [`assets/kurs.json`](assets/kurs.json)** — navn, koder,
priser, beskrivelser, datoer, sted og antall plasser (`plasser` totalt / `ledige` nå).
Kurskatalogen, kurskalenderen og påmeldingsskjemaet genereres derfra:
**endre ett sted, oppdateres overalt** — ingen dobbeltarbeid.

Enkleste arbeidsflyt for drifter: åpne filen på GitHub → blyantikonet (rediger) → endre/legg
til kurs → «Commit changes». Siden bygges og publiseres automatisk på under ett minutt.

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

Ren statisk side — GitHub Pages, Netlify eller Cloudflare Pages fungerer rett ut av boksen
bak domenet kkurs.no.
