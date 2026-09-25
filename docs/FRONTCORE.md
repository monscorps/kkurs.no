# FrontCore-kobling

Nettsiden snakker aldri direkte med FrontCore — API-nøkkelen må holdes hemmelig, og FrontCore
ber selv om at nettlesere ikke kaller API-et. Mellom dem står en liten **Cloudflare Worker**
(`worker/`, navn `kkurs-api`) som eier nøkkelen:

```
nettleser ──► kkurs-api (Cloudflare Worker, nøkkel som secret) ──► api.frontcore.com/v2
               GET  /kurs        kurs + kommende datoer + ledige plasser (mellomlagret ~2 min)
               POST /pamelding   påmelding → FrontCore-ordre (faktura)
```

FrontCore er eneste sted kurs, datoer, priser og plasser vedlikeholdes. `assets/kurs.json`
brukes bare som reserve/utvikling når ingen API-adresse er satt.

## Kontrakt: `GET /kurs`

Samme form som `assets/kurs.json`, pluss FrontCore-id-er:

```json
{
  "kilde": "frontcore",
  "oppdatert": "2026-09-25T12:00:00Z",
  "kategorier": { "truck": "Truck og maskin", "kran": "Kran og løft", "hms": "HMS og ledelse", "annet": "Andre kurs" },
  "kurs": [
    {
      "id": "truck",            // course.reference (slug) — adressen kurs/<id>/; ellers slug av tittel
      "fc_id": 86273,           // FrontCore course.id
      "navn": "Truckførerkurs",
      "koder": "T1–T4",         // course.custom_properties.kkurs_koder (valgfri)
      "kat": "truck",           // course.custom_properties.kkurs_kat; ukjent/mangler → "annet"
      "varighet": "3 dager",    // fra course.duration (verdi+enhet) eller custom_properties.kkurs_varighet
      "pris": 6900,             // course.price.value (NOK); 0/mangler → null («Pris på forespørsel»)
      "bilde": "kurs-truck.jpg",// custom_properties.kkurs_bilde (filnavn i assets/img) — valgfri
      "desc": "…",              // ingress (text_lead), ren tekst
      "synlig": true,           // course.is_active
      "datoer": [
        { "d": "2026-10-27", "sted": "Bergen", "fc_id": 12947063,
          "plasser": 12, "ledige": 8, "merk": null }
      ]
    }
  ]
}
```

- Bare kommende datoer som ikke er avlyst (status 3) og er synlige.
- `ledige` = `seats.free.num`; `seats_status: "fully_booked"` ⇒ `ledige: 0`.
- `plasser` = ledige + bekreftede + ubekreftede deltakere (kan være `null`).

## Kontrakt: `POST /pamelding`

```json
{
  "coursedate_id": 12947063,
  "kontakt": { "navn": "Kari Nordmann", "epost": "kari@bedrift.no", "telefon": "99999999" },
  "bedrift": "Bedrift AS",
  "orgnr": "123456789",
  "deltakere": [ { "fornavn": "Ola", "etternavn": "Hansen", "epost": "" } ],
  "nettside": ""            // honningfelle — skal være tom (roboter fyller den)
}
```

Svar `200 { "ok": true, "ordre_id": "221530", "total_inkl_mva": 8625, "venteliste": false }`
eller `4xx { "ok": false, "feil": "Lesbar melding på norsk" }`.

Regler i Worker:
- Plassene sjekkes ferskt hos FrontCore. Fullt kurs ⇒ deltakerne settes på venteliste
  (`status_id: 3`). Delvis ledig men for få plasser ⇒ feil «Bare N plasser igjen».
- Betaling: `invoice` (faktura). FrontCore-API-et støtter bare `invoice` og `card_swedbank` —
  **ikke Vipps**. Kort krever Swedbank-avtale i FrontCore.
- Deltaker uten egen e-post får kontaktpersonens.
- FrontCore sender kvittering til deltaker og varsel til adressen under Settings → Edit info →
  «E-mail address for incoming bookings» (settes til `bestilling@kkurs.no`).

## Engangsoppsett i FrontCore (admin)

1. **Settings → Venues:** opprett «Kurssenter Bergen» med kapasitet (f.eks. 12). Antall plasser
   per kursdato kommer fra lokalet — API-et har ikke eget felt for det.
2. **Settings → Edit info:** firmanavn, org.nr., adresse, logo, «E-mail address for incoming
   bookings», automatisk bekreftelse = Ja, vis ledige plasser = Ja.
3. **Settings → API:** kopier nøkkelen til `worker/.dev.vars` (lokalt) og som Worker-secret
   `FRONTCORE_API_KEY` — aldri i git.

## Kjøre

```bash
cd worker
npx wrangler dev                                  # lokalt, leser .dev.vars
npx wrangler secret put FRONTCORE_API_KEY         # én gang per Cloudflare-konto
npx wrangler deploy                               # publiser kkurs-api
python3 ../tools/frontcore_seed.py --dry-run      # vis hva som ville blitt opprettet
python3 ../tools/frontcore_seed.py                # fyll FrontCore med kursene fra kurs.json
```

Flytting til kundens Cloudflare-konto: `wrangler login` mot den kontoen, `secret put`, `deploy`,
og oppdater `API_URL` i `assets/app.js` + `KURS_API_URL` i GitHub-variablene.
