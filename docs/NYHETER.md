# Nyheter fra Facebook

Det Kompetanse Kurs poster på Facebook-siden, vises automatisk under «Siste nytt» på
forsiden — i sidens eget design, uten reklame eller tredjepartstjeneste. Hvert kort lenker til
innlegget på Facebook (ingen liker- eller kommentarfunksjon på nettsiden).

## Slik virker det

- `tools/bygg.py` henter de siste innleggene fra Facebook Graph API ved hver publisering,
  lagrer bildene lokalt (Facebooks bildelenker utløper) og skriver `assets/nyheter.json`.
  Forsiden viser de seks siste (ett på mobil + «Vis alle»).
- **Automatisk:** «Bygg og publiser» (`.github/workflows/publiser.yml`) kjører på timeplan, så
  nye innlegg kommer ut uten commit. GitHub kjører timeplanjobber når det er kapasitet — i
  praksis hver 1–6. time. (Raskere: flytt hentingen til en Cloudflare Worker senere.)
- `hold-i-live.yml` hindrer at GitHub slår av timeplanen etter 60 dager uten aktivitet.
- Uten nøkkel, når nøkkelen er ugyldig eller Facebook ikke svarer, publiseres siden likevel:
  nyhetsseksjonen viser reservekortet «Nyheter og kursdatoer på Facebook» med lenke til siden.
  Feilmeldingen fra Facebook står i byggeloggen under **Actions** (nøkkelen vises aldri).

## Engangsoppsett (10 minutter) — sidenøkkel

Nøkkelen er en **sidenøkkel**; med den peker `me` på selve siden, så side-id trengs ikke.
Den må lages av en administrator på Facebook-siden (Tom er administrator).

**Anbefalt:** Tom gjør den som drifter nettsiden til administrator (Facebook → siden →
**Innstillinger → Sidetilgang → Legg til ny** → full kontroll). Da lager drifter nøkkelen selv og
legger den rett inn i GitHub — nøkkelen går aldri mellom personer.

1. <https://developers.facebook.com/apps> → **Create app** → «Other» → typen «Business». Navn f.eks.
   «kkurs.no nettside». Appen kan bli i utviklingsmodus så lenge den som lager nøkkelen er
   administrator både på appen og på Facebook-siden.
2. **Graph API Explorer** (<https://developers.facebook.com/tools/explorer>): velg appen, legg til
   tillatelsene `pages_show_list` og `pages_read_engagement`, trykk **Generate Access Token** og
   godkjenn for Kompetanse Kurs-siden.
3. Gjør nøkkelen varig: **Access Token Debugger**
   (<https://developers.facebook.com/tools/debug/accesstoken>) → lim inn → **Extend Access Token**.
   Kjør så `me/accounts` i Graph API Explorer med den forlengede nøkkelen — `access_token` på
   Kompetanse Kurs-siden er sidenøkkelen, og den utløper ikke.
4. Legg den inn som hemmelighet på GitHub:
   <https://github.com/monscorps/kkurs.no/settings/secrets/actions/new>, navn `FB_PAGE_TOKEN`.
5. Kjør «Bygg og publiser» under **Actions** én gang manuelt — innleggene vises med en gang.

Lager sideadministratoren nøkkelen selv, overleveres den med en engangsdeling i en
passordbehandler (1Password, Bitwarden Send o.l.) — aldri e-post, SMS eller chat.

## Når den slutter å virke

Sidenøkkelen er knyttet til personen som lagde den. Fjernes vedkommende som administrator på
siden, eller bytter passord, blir nøkkelen ugyldig og forsiden viser reservekortet. Lag da en ny
nøkkel (steg 2–4). Flyttes hostingen til Cloudflare, legges nøkkelen inn der med samme navn.

## Hvorfor ikke Juicer?

Juicer ble vurdert (oktober 2026). Gratisplanen er etter Juicers vilkår (pkt. 4.2–4.3) bare for
privatpersoner, legger inn reklamekort og gjør deler av innleggene uskarpe etter sju dager.
Betalt plan (Lite, ca. 15 USD/mnd) ville fungert, men egen henting er gratis og ser renere ut.
