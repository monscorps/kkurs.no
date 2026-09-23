# Produksjonsplan — fra prototype til drift for Kompetanse Kurs

Alt på siden som i dag er simulert har ett definert byttepunkt i koden. Planen under er i
rekkefølgen den bør gjøres, med hvem som må gjøre hva.

## 1. FrontCore-konto (kjernen — booking, betaling, e-post, plasser)

- [ ] **Stian:** opprett konto / be om demo hos FrontCore (frontcore.no) og velg plan med
      nettbetaling. Bekreft i avtalen: Vipps + faktura, deltakergrenser, venteliste,
      bekreftelses-e-post til deltaker og varsling til arrangør (alt er standardfunksjoner).
- [ ] **Stian:** legg inn kursene i FrontCore-adminen (navn, koder, priser, datoer, maks
      deltakere). Dette blir eneste sted kurs vedlikeholdes.
- [ ] **Tomas:** hent embed-snutt for kurskalender fra FrontCore og style den mot paletten
      (grønn `#02752D`, navy `#022A59` — FrontCore-widgeten støtter egne farger).

**Byttepunkter i koden:**
- `index.html` → `#kalender`-seksjonen: erstatt `<div class="cal-wrap">…</div>` +
  filterchips med FrontCore-embeden (behold seksjonshodet og navy-flaten).
- `assets/app.js` → `init()`: bytt `fetch("assets/kurs.json…")` til FrontCore-API-et
  (eller behold kurs.json som manuell fallback til API-tilgang er avklart).
- Alle «Meld deg på»-knapper (`data-book`) → FrontCore-påmeldingslenker per kurs, og
  påmeldingsmodalen (`#modal`) fjernes/erstattes av FrontCore-skjemaet.
- Kvitterings-/demomerknader: søk etter «Forhåndsvisning» i `index.html` og fjern.

## 2. E-post og domene

- [ ] **Stian:** registrer/pek domenet `kkurs.no` (Domeneshop e.l.).
- [ ] **Stian/Tomas:** e-post på domenet (Google Workspace eller Domeneshop-epost):
      opprett `post@kkurs.no` og `bestilling@kkurs.no`. Varsling fra FrontCore settes til
      `bestilling@kkurs.no`.
- [ ] **Tomas:** kontakt-/tilbudsskjemaet (`#kontakt-form`) kobles til e-post — enklest:
      skjematjeneste (f.eks. Formspark/Basin) som poster til `post@kkurs.no`, eller
      FrontCore-forespørselsskjema hvis planen dekker det.

## 3. Hosting og DNS

- [ ] **Tomas:** GitHub Pages → custom domain: legg `kkurs.no` i repo-innstillingene
      (Settings → Pages → Custom domain, kryss «Enforce HTTPS»), og hos domeneleverandør:
      `A`-poster til GitHub Pages-IP-ene + `CNAME www → monscorps.github.io`.
      (Alternativt Cloudflare Pages/Netlify — samme statiske innhold.)
- [ ] `og:url` i `index.html` stemmer allerede (`https://kkurs.no/`).

## 4. Analyse og samtykke (var i opprinnelig skop)

- [ ] **Tomas:** opprett GA4-eiendom, legg inn målescript BAK samtykke.
- [ ] **Tomas:** samtykkebanner (CookieYes/Cookiebot gratisnivå holder) — kreves før GA
      settes live. Lenkene «Personvern» og «Informasjonskapsler» i bunnteksten peker i dag
      på plassholdere (`data-demo-link`) og må få egne sider/tekster.

## 5. Innhold som må byttes fra plassholder

- [ ] Org.nr. i bunntekst (`000 000 000`), telefon (`+47 55 00 00 00`), adresse
      (`Kanalveien 1`), SoMe-lenker (`href="#"`).
- [x] Partnerne i «Noen av dem vi jobber med» har logo + lenke (hentet fra partnernes egne nettsider 23.09, vist i én farge; be gjerne partnerne om offisielle logopakker for høyeste kvalitet)
      med skriftlig ok, ellers fjern raden.
- [ ] Kursvilkår-siden (lenkes fra påmelding og bunntekst).
- [ ] Foto: Midjourney-plassholderne kan stå, men ekte bilder fra kurssenteret løfter
      troverdigheten — samme utsnitt/format ligger klart i `assets/img/`.
- [ ] Eier-kortet under «Om oss»: tekst godkjennes av Stian.

## 6. Typografi (valgfritt)

- [ ] Merkevarefonten Myriad er Adobe-lisensiert. Vil Stian ha ekte Myriad på nett:
      Adobe Fonts-abonnement → web project → bytt Google Fonts-lenken. Inntil da bruker
      siden Source Sans 3 (lovlig, samme familiepreg). OTF-filene skal ALDRI committes.

## 7. Drift etter lansering

- Kurs, priser, datoer, plasser: **kun i FrontCore** (før det: `assets/kurs.json`).
- Nyhetskortene i `index.html` redigeres direkte (tre `<article class="news-card">`).
- Deploy: `git push` → GitHub Pages bygger automatisk (~1 min). Husk å bumpe
  `?v=N` på `styles.css`/`app.js` i `index.html` ved endringer der.
