# kkurs.no — visuell prototype

**Live forhåndsvisning:** <https://monscorps.github.io/kkurs.no/> (GitHub Pages, `main`-branchen)

Landingsside for **kkurs** — sertifiserte sikkerhetskurs, HMS-rådgivning og digital kompetanse
for industrien på Vestlandet. Bygget som rask, statisk prototype i Sapio-stil, der kurskalender
og påmelding er attrapper som speiler **FrontCore**-widgeten til vi har konto/API på plass.

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
| `assets/styles.css` | Designsystemet («nordisk industripresisjon» — se `docs/DESIGN.md`) |
| `assets/app.js` | **Kursdata (eksempel)** øverst i filen + rendering, filtre, modal og skjema-demo |
| `docs/DESIGN.md` | Designnotat, research-funn og anbefalt teknisk retning |

## Endre innhold

Alt kursinnhold (navn, koder, priser, datoer, steder, status) ligger i `COURSES`-listen øverst i
`assets/app.js`. Kurskalenderen, «neste kurs»-billetten i heroen og påmeldingsmodalen genereres
derfra — endre ett sted, oppdateres overalt.

## Ved lansering (FrontCore-kobling)

1. Opprett FrontCore-konto og hent embed-snutt for kurskalender/påmelding.
2. Erstatt innholdet i `#kalender`-seksjonen med FrontCore-embeden (den kan fargetilpasses
   paletten i `styles.css`), eller behold vår tabell og hent data fra FrontCore-API-et.
3. Pek «Meld deg på»-knappene til FrontCore-påmelding.
4. Koble kontaktskjemaet til e-post/CRM, legg inn Google Analytics + samtykkebanner,
   og fjern «forhåndsvisning»-merknadene (søk etter «Forhåndsvisning» i `index.html`).
5. Bytt plassholdere: org.nr., adresser, telefon, partnerlogoer, SoMe-lenker.

## Hosting

Ren statisk side — GitHub Pages, Netlify eller Cloudflare Pages fungerer rett ut av boksen
bak domenet kkurs.no.
