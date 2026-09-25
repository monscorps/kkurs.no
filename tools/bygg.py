#!/usr/bin/env python3
"""Bygger de statiske kurssidene fra assets/kurs.json.

Kjøres automatisk ved hver push (GitHub Actions nå, Cloudflare ved lansering):

    python3 tools/bygg.py

Lager (alt er generert — ikke rediger filene for hånd):
  kurs/<id>/index.html   én side per synlig kurs: adressen som lenkes til i e-post
  kurs/index.html        «Våre kurs»: alle kursene samlet på én side
  sitemap.xml, robots.txt

Meny, bunn og påmeldings-/kontaktvinduene kopieres fra index.html, så
kurssidene alltid ser ut som forsiden uten dobbelt vedlikehold.
NETTSTED_URL (miljøvariabel) styrer absolutte lenker for søkemotorer og
lenkeforhåndsvisning; standard er https://kkurs.no.
KURS_API_URL (miljøvariabel, f.eks. https://kkurs-api.<konto>.workers.dev) henter kursene
fra FrontCore via kkurs-api i stedet for assets/kurs.json. Svarer ikke API-et, stopper
bygget — da blir forrige publiserte versjon stående i stedet for at demodata publiseres.
"""
import html
import json
import os
import re
import shutil
import urllib.request
from datetime import date
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
NETTSTED = os.environ.get("NETTSTED_URL", "https://kkurs.no").rstrip("/")
KURS_API = os.environ.get("KURS_API_URL", "").rstrip("/")
NBSP = " "
IDAG = date.today().isoformat()
RESERVEBILDE = "hero-alt-kurs.jpg"  # nøytralt kursbilde når et kurs mangler eget
GYLDIG_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

e = html.escape


def utdrag(kilde, monster, navn):
    treff = re.search(monster, kilde, re.S)
    if not treff:
        raise SystemExit(f"Fant ikke {navn} i index.html — er markeringen endret?")
    return treff.group(0)


def fmt_pris(n):
    return f"kr{NBSP}{n:,}".replace(",", NBSP) + ",–"


def pris_tekst(k):
    return f"fra {fmt_pris(k['pris'])}" if k.get("pris") else "Pris på forespørsel"


def fmt_dato(iso):
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def er_full(dt):
    """ledige = None betyr ukjent kapasitet i FrontCore — behandles som åpent (samme regel som app.js)."""
    return isinstance(dt.get("ledige"), (int, float)) and dt["ledige"] <= 0


def status(dt):
    if not isinstance(dt.get("ledige"), (int, float)):
        return "status-ledig", "Ledige plasser"
    if dt["ledige"] <= 0:
        return "status-vente", "Venteliste"
    if dt["ledige"] <= 3:
        return "status-faa", f"{dt['ledige']} {'plass' if dt['ledige'] == 1 else 'plasser'} igjen"
    return "status-ledig", f"{dt['ledige']} ledige plasser"


def bilde(k):
    navn = k.get("bilde") or f"kurs-{k['id']}.jpg"
    if not (ROT / "assets" / "img" / navn).exists():
        print(f"ADVARSEL: bildet {navn} for «{k['navn']}» finnes ikke — bruker {RESERVEBILDE}.")
        navn = RESERVEBILDE
    return f"assets/img/{navn}"


def kommende(k):
    """Datoer som ikke er passert, i kronologisk rekkefølge — samme regel som app.js."""
    return sorted((dt for dt in k["datoer"] if dt["d"] >= IDAG), key=lambda dt: dt["d"])


def hoveddato(datoer):
    """Første dato med ledig plass; ellers første (venteliste); ellers forespørsel."""
    for i, dt in enumerate(datoer):
        if not er_full(dt):
            return str(i)
    return "0" if datoer else "forespørsel"


def valider(data):
    feil, sett = [], set()
    for k in data["kurs"]:
        navn = k.get("navn", "?")
        if not GYLDIG_ID.match(k.get("id", "")):
            feil.append(f"«{navn}»: id «{k.get('id')}» må være små bokstaver/tall med bindestrek (f.eks. bes-vakt).")
        elif k["id"] in sett:
            feil.append(f"«{navn}»: id «{k['id']}» er brukt av flere kurs.")
        sett.add(k.get("id"))
        if k.get("kat") not in data["kategorier"]:
            feil.append(f"«{navn}»: kat «{k.get('kat')}» finnes ikke i kategorier ({', '.join(data['kategorier'])}).")
    if feil:
        raise SystemExit("Feil i assets/kurs.json — ingenting er publisert:\n  " + "\n  ".join(feil))


def dato_rader(k):
    """Samme markering som app.js lager — synlig også før skriptet har lastet."""
    datoer = kommende(k)
    if not datoer:
        return (
            '<li class="dato-rad dato-rad--tom"><span>Ingen faste datoer ennå. Meld interesse, så gir vi '
            "beskjed når neste kurs settes opp — eller be om kurset bedriftsinternt.</span>\n"
            f'        <button class="btn btn-signal btn-sm" data-book="{e(k["id"])}" data-date="forespørsel">'
            "Meld interesse</button></li>"
        )
    rader = []
    for idx, dt in enumerate(datoer):
        cls, etikett = status(dt)
        merk = f" · {e(dt['merk'])}" if dt.get("merk") else ""
        knapp = "Venteliste" if er_full(dt) else "Meld deg på"
        rader.append(
            f'<li class="dato-rad">\n'
            f'        <span class="dato-dag mono">{fmt_dato(dt["d"])}</span>\n'
            f'        <span class="dato-sted">{e(dt["sted"])}{merk}</span>\n'
            f'        <span class="status {cls}">{etikett}</span>\n'
            f'        <button class="btn btn-signal btn-sm" data-book="{e(k["id"])}" data-date="{idx}">{knapp}</button>\n'
            f"      </li>"
        )
    return "\n      ".join(rader)


def kursrad_lenke(k):
    return (
        f'<li><a href="kurs/{e(k["id"])}/">'
        f'<span class="rel-navn">{e(k["navn"])} <span class="cc-codes">{e(k.get("koder", ""))}</span></span>'
        f'<span class="rel-tall rel-var mono">{e(k.get("varighet", ""))}</span>'
        f'<span class="rel-tall mono">{pris_tekst(k)}</span>'
        f'<span class="rel-pil" aria-hidden="true">→</span></a></li>'
    )


def json_ld(data):
    # vinkelparenteser og & escapes, så innholdet aldri kan avslutte <script>-elementet
    return (json.dumps(data, ensure_ascii=False, indent=2)
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def last_kursdata():
    if not KURS_API:
        return json.loads((ROT / "assets" / "kurs.json").read_text(encoding="utf-8")), "assets/kurs.json"
    try:
        foresporsel = urllib.request.Request(f"{KURS_API}/kurs", headers={"Accept": "application/json"})
        with urllib.request.urlopen(foresporsel, timeout=30) as svar:
            return json.loads(svar.read().decode("utf-8")), f"{KURS_API}/kurs"
    except Exception as feil:  # noqa: BLE001 — alt som hindrer fersk data skal stoppe bygget
        raise SystemExit(f"Fikk ikke hentet kursene fra {KURS_API}/kurs ({feil}). Ingenting er publisert.")


def main():
    index = (ROT / "index.html").read_text(encoding="utf-8")
    data, kilde = last_kursdata()
    valider(data)
    kategorier = data["kategorier"]
    kurs = [k for k in data["kurs"] if k.get("synlig", True) is not False]

    fonter = "\n  ".join(re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts\.[^>]*>', index))
    css = utdrag(index, r'<link rel="stylesheet" href="assets/styles\.css\?v=\d+">', "stilarket")
    skript = utdrag(index, r'<script src="assets/app\.js\?v=\d+"></script>', "skriptet")
    hopp = utdrag(index, r'<a class="skip-link"[^>]*>.*?</a>', "hopp-lenken")
    meny = utdrag(index, r'<header class="nav" id="topp">.*?</header>', "menyen")
    bunn = utdrag(index, r'<footer class="footer">.*?</footer>', "bunnen")
    vinduer = utdrag(index, r"<!-- ============ PÅMELDINGSMODAL.*?(?=<script src=)", "påmeldingsvinduene").rstrip()

    def side(dybde, *, tittel, beskrivelse, sti, bilde_url, body_attr, main, ld):
        base = "../" * dybde
        url = f"{NETTSTED}/{sti}"
        # med <base> peker «#x» til forsiden: logoen skal dit, hopp-lenken skal bli på siden
        lokal_meny = meny.replace('class="brand" href="#topp" aria-label="Kompetanse Kurs – til toppen"',
                                  'class="brand" href="./" aria-label="Kompetanse Kurs – til forsiden"', 1)
        lokal_hopp = hopp.replace('href="#innhold"', f'href="{sti}#innhold"', 1)
        return f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <base href="{base}">
  <title>{e(tittel)}</title>
  <meta name="description" content="{e(beskrivelse)}">
  <link rel="canonical" href="{url}">
  <meta property="og:title" content="{e(tittel)}">
  <meta property="og:description" content="{e(beskrivelse)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{NETTSTED}/{bilde_url}">
  <meta property="og:locale" content="nb_NO">
  <link rel="icon" type="image/svg+xml" href="assets/img/logo.svg">
  {fonter}
  {css}
  <script type="application/ld+json">
{json_ld(ld)}
  </script>
</head>
<body {body_attr} data-nav="fast">

<!-- Generert av tools/bygg.py fra assets/kurs.json — ikke rediger for hånd. -->
{lokal_hopp}

{lokal_meny}

<main id="innhold" tabindex="-1">
{main}
</main>

{bunn}

{vinduer}

{skript}
</body>
</html>
"""

    kurs_rot = ROT / "kurs"
    if kurs_rot.exists():
        shutil.rmtree(kurs_rot)

    tilbyder = {"@type": "Organization", "name": "Kompetanse Kurs", "url": f"{NETTSTED}/"}

    for k in kurs:
        kat = kategorier.get(k["kat"], "")
        datoer = kommende(k)
        steder = sorted({dt["sted"] for dt in datoer if dt.get("sted")}) or ["Bergen"]
        fakta = []
        if k.get("varighet"):
            fakta.append(f'<div><dt>Varighet</dt><dd>{e(k["varighet"])}</dd></div>')
        fakta.append(f"<div><dt>Pris</dt><dd>{pris_tekst(k)}</dd></div>")
        fakta.append(f"<div><dt>Sted</dt><dd>{e(', '.join(steder))} · eller bedriftsinternt</dd></div>")
        forste = hoveddato(datoer)
        hovedknapp = "Meld interesse" if forste == "forespørsel" else (
            "Venteliste" if er_full(datoer[int(forste)]) else "Meld deg på")

        andre = [x for x in kurs if x["kat"] == k["kat"] and x["id"] != k["id"]]
        andre += [x for x in kurs if x["kat"] != k["kat"]][: max(0, 4 - len(andre))]

        instanser = [
            {
                "@type": "CourseInstance",
                "courseMode": "online" if dt["sted"].lower() == "digitalt" else "onsite",
                "startDate": dt["d"],
                "location": {"@type": "Place", "name": dt["sted"]},
            }
            for dt in datoer
        ]
        ld = {
            "@context": "https://schema.org",
            "@type": "Course",
            "name": k["navn"],
            "description": k["desc"],
            "url": f"{NETTSTED}/kurs/{k['id']}/",
            "provider": tilbyder,
            **({"offers": {"@type": "Offer", "price": k["pris"], "priceCurrency": "NOK", "category": "Paid"}}
               if k.get("pris") else {}),
            **({"hasCourseInstance": instanser} if instanser else {}),
        }

        main = f"""  <div class="container kursside-topp">
    <nav class="brodsmuler mono" aria-label="Brødsmuler">
      <a href="kurs/">Våre kurs</a><span aria-hidden="true">/</span><span aria-current="page">{e(k["navn"])}</span>
    </nav>
    <button class="kopier-lenke mono" type="button" data-kopier-lenke>Kopier lenke til kurset</button>
  </div>

  <section class="kursside-hero" aria-labelledby="kurs-tittel">
    <div class="container kursside-grid">
      <div class="kursside-tekst">
        <p class="kicker">{e(kat)}</p>
        <h1 id="kurs-tittel">{e(k["navn"])}</h1>
        <p class="kursside-koder mono">{e(k.get("koder", ""))}</p>
        <p class="kursside-lead">{e(k["desc"])}</p>
        <dl class="kursside-fakta mono">
          {"".join(fakta)}
        </dl>
        <div class="kursside-handling">
          <button class="btn btn-signal btn-lg" type="button" id="kursside-hovedknapp" data-book="{e(k["id"])}" data-date="{forste}">{hovedknapp}</button>
          <button class="btn btn-tilbud btn-lg" type="button" data-tilbud>Be om tilbud for bedrift</button>
        </div>
      </div>
      <figure class="kursside-foto"><img src="{bilde(k)}" alt="" width="900" height="600" fetchpriority="high"></figure>
    </div>
  </section>

  <section class="section section-mist" id="datoer" aria-labelledby="datoer-tittel">
    <div class="container">
      <header class="section-head">
        <p class="kicker">Kurskalender</p>
        <h2 id="datoer-tittel">Kommende datoer</h2>
      </header>
      <ul class="dato-liste" id="kursside-datoer">
      {dato_rader(k)}
      </ul>
      <p class="section-note mono">Passer ingen av datoene? Vi holder kurset også bedriftsinternt, hos dere —
        <button class="lenkeknapp" type="button" data-tilbud>be om tilbud</button>.</p>
    </div>
  </section>

  <section class="section" aria-labelledby="andre-tittel">
    <div class="container">
      <header class="section-head">
        <p class="kicker">Kurskatalog</p>
        <h2 id="andre-tittel">Andre kurs</h2>
      </header>
      <ul class="rel-liste">
        {"".join(kursrad_lenke(x) for x in andre)}
      </ul>
      <p class="rel-alle"><a class="btn btn-ghost" href="kurs/">Se alle kurs</a></p>
    </div>
  </section>"""

        beskrivelse = f"{k['desc']} Datoer og påmelding hos Kompetanse Kurs i Bergen."
        ut = kurs_rot / k["id"] / "index.html"
        ut.parent.mkdir(parents=True, exist_ok=True)
        ut.write_text(
            side(
                2,
                tittel=f"{k['navn']} – Kompetanse Kurs, Bergen",
                beskrivelse=beskrivelse,
                sti=f"kurs/{k['id']}/",
                bilde_url=bilde(k),
                body_attr=f'data-side="kurs" data-kurs="{e(k["id"])}"',
                main=main,
                ld=ld,
            ),
            encoding="utf-8",
        )

    # «Våre kurs»: alle kursene, gruppert per fagfelt
    grupper = []
    for nokkel, navn in kategorier.items():
        i_gruppe = [k for k in kurs if k["kat"] == nokkel]
        if not i_gruppe:
            continue
        grupper.append(
            f"""      <div class="oversikt-gruppe">
        <h2>{e(navn)}</h2>
        <ul class="rel-liste">
          {"".join(kursrad_lenke(k) for k in i_gruppe)}
        </ul>
      </div>"""
        )
    oversikt_main = f"""  <section class="kursside-hero kursside-hero--oversikt" aria-labelledby="oversikt-tittel">
    <div class="container">
      <p class="kicker">Kurskatalog</p>
      <h1 id="oversikt-tittel">Våre kurs</h1>
      <p class="kursside-lead">Alle kursene fra Kompetanse Kurs samlet. Trykk på et kurs for full
        beskrivelse, datoer og påmelding.</p>
      <div class="kursside-handling">
        <a class="btn btn-signal btn-lg" href="#kalender">Se kurskalenderen</a>
        <button class="btn btn-tilbud btn-lg" type="button" data-tilbud>Be om tilbud for bedrift</button>
      </div>
    </div>
  </section>

  <section class="section section-mist" aria-label="Alle kurs">
    <div class="container oversikt">
{chr(10).join(grupper)}
    </div>
  </section>"""
    oversikt_ld = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Våre kurs",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": f"{NETTSTED}/kurs/{k['id']}/", "name": k["navn"]}
            for i, k in enumerate(kurs)
        ],
    }
    (kurs_rot / "index.html").write_text(
        side(
            1,
            tittel="Våre kurs – Kompetanse Kurs, Bergen",
            beskrivelse="Alle kursene fra Kompetanse Kurs i Bergen: truck, kran, maskin, HMS og varme arbeider. "
                        "Datoer, priser og påmelding.",
            sti="kurs/",
            bilde_url="assets/img/hero.jpg",
            body_attr='data-side="kursoversikt"',
            main=oversikt_main,
            ld=oversikt_ld,
        ),
        encoding="utf-8",
    )

    adresser = [f"{NETTSTED}/", f"{NETTSTED}/kurs/"] + [f"{NETTSTED}/kurs/{k['id']}/" for k in kurs]
    (ROT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{e(u)}</loc></url>\n" for u in adresser)
        + "</urlset>\n",
        encoding="utf-8",
    )
    (ROT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {NETTSTED}/sitemap.xml\n", encoding="utf-8")

    skjult = [k["id"] for k in data["kurs"] if k.get("synlig", True) is False]
    print(f"Bygget {len(kurs)} kurssider + oversikt + sitemap fra {kilde} ({NETTSTED})."
          + (f" Skjult (synlig: false): {', '.join(skjult)}." if skjult else ""))


if __name__ == "__main__":
    main()
