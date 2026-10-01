# Facebook-innlegg i nyhetsseksjonen

Samme idé som sapioas.no (der gjøres det med WordPress-utvidelsen «Custom Facebook Feed»):
det Kompetanse Kurs poster på Facebook-siden, vises automatisk under «Siste nytt» på forsiden,
i sidens eget design.

Slik virker det: `tools/bygg.py` henter de siste innleggene fra Facebook Graph API ved hver
publisering (og hver time), lagrer bildene lokalt (Facebooks bildelenker utløper etter noen
dager) og skriver `assets/nyheter.json`. Forsiden viser de seks siste; hvert kort lenker til
innlegget på Facebook. Uten nøkkel — eller hvis Facebook ikke svarer — blir kortene i
`index.html` stående, og resten av siden publiseres som vanlig.

## Engangsoppsett (10 minutter, må gjøres av en administrator på Facebook-siden)

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
4. Legg sidenøkkelen inn som hemmelighet på GitHub: repoet → **Settings → Secrets and
   variables → Actions → New repository secret**, navn `FB_PAGE_TOKEN`. (Side-id-en
   `61594315895753` er standard; en annen side settes som variabelen `FB_PAGE_ID`.)
5. Kjør «Bygg og publiser» under **Actions** én gang manuelt — innleggene vises med en gang,
   og oppdateres deretter hver time.

Nøkkelen skal aldri inn i koden, i e-post eller i chat. Flyttes hostingen til Cloudflare Pages,
legges den inn der som krypterte miljøvariabel med samme navn.
