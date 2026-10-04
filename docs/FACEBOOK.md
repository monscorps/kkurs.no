# Facebook-innlegg i nyhetsseksjonen

Samme idé som sapioas.no (der gjøres det med WordPress-utvidelsen «Custom Facebook Feed»):
det Kompetanse Kurs poster på Facebook-siden, vises automatisk under «Siste nytt» på forsiden,
i sidens eget design.

Slik virker det: `tools/bygg.py` henter de siste innleggene fra Facebook Graph API ved hver
publisering (og hver time), lagrer bildene lokalt (Facebooks bildelenker utløper etter noen
dager) og skriver `assets/nyheter.json`. Forsiden viser de seks siste; hvert kort lenker til
innlegget på Facebook. Uten nøkkel — eller hvis Facebook ikke svarer — blir kortene i
`index.html` stående, og resten av siden publiseres som vanlig. Feilmeldingen fra Facebook står
i byggeloggen under **Actions** (nøkkelen vises aldri).

Nøkkelen er en **sidenøkkel**. Med den peker `me` på selve siden, så side-id trengs ikke
(nye Facebook-sider har en annen id enn tallet i `profile.php?id=…`).

## Anbefalt: den som drifter nettsiden blir administrator på siden

Da lager drifter nøkkelen selv og legger den rett inn i GitHub — nøkkelen går aldri mellom
personer.

**Sideadministrator (f.eks. Tom), 2 minutter:** Facebook → bytt til Kompetanse Kurs-siden →
**Innstillinger → Sidetilgang** (eller Meta Business Suite → Innstillinger → Personer) →
**Legg til ny** → velg personen → slå på **full kontroll** → bekreft med passord.

**Drifter, 10 minutter:**

1. Gå til <https://developers.facebook.com/apps> → **Create app** → velg «Other» og typen
   «Business». Navn f.eks. «kkurs.no nettside». Appen kan bli stående i utviklingsmodus så lenge
   den som lager nøkkelen er administrator både på appen og på Facebook-siden.
2. Åpne **Graph API Explorer** (<https://developers.facebook.com/tools/explorer>), velg appen,
   og legg til tillatelsene `pages_show_list` og `pages_read_engagement`. Trykk
   **Generate Access Token** og godkjenn for Kompetanse Kurs-siden.
3. Gjør nøkkelen varig: åpne **Access Token Debugger**
   (<https://developers.facebook.com/tools/debug/accesstoken>), lim inn nøkkelen og trykk
   **Extend Access Token**. Kjør så `me/accounts` i Graph API Explorer med den forlengede
   nøkkelen — `access_token` på Kompetanse Kurs-siden er sidenøkkelen, og den utløper ikke.
4. Legg sidenøkkelen inn som hemmelighet på GitHub:
   <https://github.com/monscorps/kkurs.no/settings/secrets/actions/new>, navn `FB_PAGE_TOKEN`.
5. Kjør «Bygg og publiser» under **Actions** én gang manuelt — innleggene vises med en gang,
   og oppdateres deretter hver time.

## Alternativ: sideadministrator lager nøkkelen selv

Samme steg 1–3, men da må nøkkelen overleveres til den som har GitHub-tilgang. Bruk en
engangsdeling i en passordbehandler (1Password, Bitwarden Send o.l.) — aldri e-post, SMS
eller chat.

## Når den slutter å virke

Sidenøkkelen er knyttet til personen som lagde den. Fjernes vedkommende som administrator på
siden, eller bytter passord, blir nøkkelen ugyldig: siden publiseres fortsatt, men nyhetene
faller tilbake til kortene i `index.html`. Lag da en ny nøkkel (steg 2–4).

Nøkkelen skal aldri inn i koden, i e-post eller i chat. Flyttes hostingen til Cloudflare Pages,
legges den inn der som kryptert miljøvariabel med samme navn.
