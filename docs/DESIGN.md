# kkurs.no — designnotat og teknisk retning

**Selskap:** Kompetanse Kurs (Bergen) · **Eier/daglig leder:** Stian Holgersen · **Domene:** kkurs.no
**Dato:** 12.09.2026 · **Status:** Utkast til godkjenning (visuell prototype, revisjon 2)

> **Revisjon 2 (samme dag):** Første utkast («nordisk industripresisjon» — konturlinjer,
> faresonestriper, oransje/petrol) ble forkastet etter tilbakemelding: rotete og feil farger.
> Nytt system «Nordsjø» under. Geografien er kuttet til **kun Bergen** (Rogaland ute), de to
> KI-kursene er fjernet, og all omtale av eier er begrenset til navn og rolle oppgitt av kunden
> — ingen researchede biografipåstander på siden.

## Mål

Kunden har hastverk og skopet er kuttet ned: én rask, profesjonell landingsside i Sapio-stil
(sapioas.no) med kurskatalog, kurskalender og påmelding — der booking/kalender på sikt leveres
av **FrontCore**. Alt innhold i prototypen er eksempeldata; skjemaene er attrapper som viser
flyten til vi har FrontCore-konto og API-godkjenning.

## Research-funn

- **sapioas.no** er en WordPress-side der selve kurskalenderen er en *innebygd widget fra
  TMS-et deres* (`sapio.brakomp.no/f/no/course/upcoming` — BraKomp, en konkurrent til FrontCore).
  Nettsiden er altså et tynt markedsføringslag: hero, tjenestegrid, kurskort, nyheter (Facebook-feed),
  partnerlogoer, kurskalender-embed.
- **FrontCore** (frontcore.com) er TMS/LMS for kursleverandører. Nettsideintegrasjonen skjer via
  **innebyggbare, merkevaretilpassede widgets**: kurskalender + påmeldingsskjema (iframe/JS) med
  justerbare farger/oppsett, betaling, automatiske bekreftelser — pluss åpent API for
  spesialtilpasning og markedsføring via Kursguiden.no.
- **Sentralregisteret** (sentralregisteret.no) er stiftelsen bak Kompetanseregisteret og
  Maskinregisteret — kompetansebevis for dokumentert og sertifisert sikkerhetsopplæring.
  Brukes som tillitssignal på siden («kompetansebevis registreres i Sentralregisteret»).

## Anbefalt tilnærming

**Statisk, rask én-sides nettside nå — FrontCore som «backend» ved lansering.**

1. **Ikke WordPress i første omgang.** FrontCore-widgetene kan bygges inn på hvilken som helst
   side (også statisk). Kursinnholdet administreres uansett i FrontCore, så WordPress ville bare
   duplisert CMS-rollen og lagt til drift/vedlikehold/sikkerhet. Blogg/nyheter kan komme senere
   (WP headless, eller enkel statisk løsning) hvis behovet blir reelt.
2. **Prototypen speiler FrontCore-flyten:** kurskalender-tabell og påmeldingsmodal er bygget som
   FrontCore-widgeten ser ut i praksis (dato/sted/status, deltaker- og bedriftsfelter), slik at
   bytte til ekte embed blir en ren utskifting uten redesign.
3. **Ved lansering:** erstatt `#kalender`-mocken med FrontCore-embed (iframe/JS-snippet fra
   kundens konto), koble «Meld deg på»-knappene til FrontCore-påmeldingslenker, og koble
   kontaktskjemaet til e-post/CRM. Kursdata i `assets/app.js` byttes ut med FrontCore som kilde.

**Alternativer vurdert:** (a) WordPress + FrontCore-plugin/embed — matcher opprinnelig skop, men
tregere å levere, mer drift, unødvendig når kunden haster og FrontCore eier kursdataene.
(b) Next.js/SSG med FrontCore-API — mest fleksibelt på sikt, men overkill for «basic page» nå.
Statisk side kan senere løftes til begge uten å kaste designet.

## Designretning: «Nordsjø» (revisjon 2)

Prinsipp: profesjonelt og rent — flater i én farge på rolig papir, null dekor. Referansenivået
er kvaliteten i kundens tidligere prosjekt (sophiematlary.no), ikke utseendet: egen farge, egne
skrifter, egne detaljer.

- **Farger:** kjølig nordisk papir (`#F6F7F6`), én merkefarge brukt som *flater*: dyp nordsjøblå
  (`#17455F`, hover `#0F3349`, bunn `#0B2737`), lys sjøblå (`#A3C6DA`) kun til detaljer på
  marine flater. Blåstukket nesten-sort tekst. Ingen skygger, mønstre eller dekorlinjer.
  Statusfarger: grønn (ledig), rav (få plasser), nøytral (venteliste) — dempet på lys flate,
  lys tint på marine.
- **Typografi:** Familjen Grotesk (skandinavisk grotesk) til alt løpende, Spline Sans Mono til
  data (kurskoder, datoer, priser, etiketter). Knapper i normal sats, ikke versaler.
- **Struktur:** korte marine aksentstreker over seksjonstitler, marine toppfelt med navnetrekk,
  marine «neste kurs»-kort i hero, marine kurskalender- og kontaktseksjon, dypmarine footer.
- **Merkevare:** navnetrekket «Kompetanse Kurs.» med lys sjøblått punktum. kkurs.no er domenet.
- **Språk:** bokmål, korrekturlest; norske tall- og datoformater (kr 6 900,–, 22.09.2026).

## Innholdsseksjoner (dekker opprinnelig sidekart som ankere)

Hero m/ CTA og «neste kurs»-billett → nøkkeltall → **Kurs** (filtrerbar katalog) →
**Kurskalender** (FrontCore-stil, filtrerbar) → **Tjenester** (HMS-rådgivning, bedriftsintern
opplæring, digital HMS & KI) → **Om oss** (Bergen & Rogaland-historien) → **Nyheter** (3 kort) →
**Partnere** (fiktive plassholder-logoer — aldri ekte logoer uten avtale) → **Kontakt/tilbud** →
footer m/ Sentralregisteret-referanse og SoMe-lenker.

Utelatt med vilje (YAGNI, kuttet skop): egne undersider, prosjektportefølje, ekte blogg-CMS,
e-læringsportal. Alt kan legges til uten å røre designsystemet.

## Demo-oppførsel

Skjemaer validerer og viser kvittering lokalt, med diskret merknad «Forhåndsvisning — kobles til
FrontCore ved lansering». Ingen data sendes noe sted. Footer merker siden som forhåndsvisning
med eksempeldata.

## Neste steg etter visuell godkjenning

1. Avklare endelig navn/logo og domenepeking for kkurs.no.
2. Opprette FrontCore-konto → hente embed-snutter for kalender + påmelding, style dem mot paletten.
3. Koble kontakt-/tilbudsskjema (e-post, evt. CRM) og legge inn ekte kurs, priser og datoer.
4. Samtykkebanner/GDPR, Google Analytics (var i skopet), og ekte partnerlogoer med tillatelse.
5. Hosting: statisk (GitHub Pages/Netlify/Cloudflare) bak kkurs.no.
