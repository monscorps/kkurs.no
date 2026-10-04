#!/usr/bin/env python3
"""Bygger de statiske kurssidene fra assets/kurs.json.

Kjøres automatisk ved hver push (GitHub Actions nå, Cloudflare ved lansering):

    python3 tools/bygg.py              # bygger på plass (lokal forhåndsvisning)
    python3 tools/bygg.py --ut _site   # + kopierer bare det som skal publiseres til _site/

Lager (alt er generert — ikke rediger filene for hånd):
  kurs/<id>/index.html   én side per synlig kurs: adressen som lenkes til i e-post
  kurs/index.html        «Våre kurs»: alle kursene samlet på én side
  <sti>/index.html       innholdssider fra sider/*.html (HMS, Oppkjøring, Bevis …) — første
                         linje i hver fil er en kommentar med JSON-meta: sti, tittel,
                         beskrivelse, bilde
  assets/nyheter.json    siste innlegg fra Facebook-siden (+ bildene i assets/nyheter/), når
                         FB_PAGE_TOKEN er satt — nyhetsseksjonen på forsiden viser dem
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
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROT = Path(__file__).resolve().parent.parent
NETTSTED = os.environ.get("NETTSTED_URL", "https://kkurs.no").rstrip("/")
KURS_API = os.environ.get("KURS_API_URL", "").rstrip("/")
# Med en sidenøkkel er «me» selve siden — da spiller det ingen rolle at nye Facebook-sider har
# en annen side-id enn tallet i adressen (profile.php?id=…). FB_PAGE_ID overstyrer ved behov.
FB_SIDE = os.environ.get("FB_PAGE_ID") or "me"
FB_NOKKEL = os.environ.get("FB_PAGE_TOKEN", "")
FB_GRAPH = (os.environ.get("FB_GRAPH_URL") or "https://graph.facebook.com").rstrip("/")
FB_VERSJON = os.environ.get("FB_API_VERSION") or "v23.0"
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


def bildefil(navn, hva):
    if not (ROT / "assets" / "img" / navn).exists():
        print(f"ADVARSEL: bildet {navn} for «{hva}» finnes ikke — bruker {RESERVEBILDE}.")
        return RESERVEBILDE
    return navn


def bilde(k):
    navn = k.get("bilde") or "kurs-" + k["id"] + ".jpg"
    return "assets/img/" + bildefil(navn, k["navn"])


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


def koder(k):
    """Koden vises bare når navnet ikke allerede har den («Anhukerkurs G11» + «G11»)."""
    kode = k.get("koder") or ""
    return "" if kode and kode in k["navn"] else kode


def kursrad_lenke(k):
    return (
        f'<li><a href="kurs/{e(k["id"])}/">'
        f'<span class="rel-navn">{e(k["navn"])} <span class="cc-codes">{e(koder(k))}</span></span>'
        f'<span class="rel-tall rel-var mono">{e(k.get("varighet") or "")}</span>'
        f'<span class="rel-tall mono">{pris_tekst(k)}</span>'
        f'<span class="rel-pil" aria-hidden="true">→</span></a></li>'
    )


LENKE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
TRYGG_HREF = re.compile(r"^(https?://|mailto:|tel:|#|[a-z0-9-]+(/[a-z0-9-]+)*/?(#[a-z0-9-]+)?$)")


def rik_tekst(tekst):
    """Escapet tekst der [tekst](sti) blir lenke; eksterne lenker åpnes i ny fane."""
    ut, pos = [], 0
    for m in LENKE.finditer(tekst):
        href = m.group(2)
        if not TRYGG_HREF.match(href):
            raise SystemExit(f"Ugyldig lenke i kurs.json: «{href}»")
        ekstern = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
        ut.append(e(tekst[pos:m.start()]) + f'<a href="{e(href)}"{ekstern}>{e(m.group(1))}</a>')
        pos = m.end()
    return "".join(ut) + e(tekst[pos:])


def innhold_html(blokker):
    deler = []
    for b in blokker or []:
        if "p" in b:
            deler.append(f"<p>{rik_tekst(b['p'])}</p>")
        elif "h" in b:
            deler.append(f"<h3>{rik_tekst(b['h'])}</h3>")
        elif "ul" in b:
            deler.append("<ul>" + "".join(f"<li>{rik_tekst(x)}</li>" for x in b["ul"]) + "</ul>")
        else:
            raise SystemExit(f"Ukjent innholdsblokk i kurs.json: {b}")
    return "\n        ".join(deler)


def pris_rader(k):
    linjer = k.get("priser") or ([{"tekst": "Kurs", "pris": k["pris"]}] if k.get("pris") else [])
    rader = []
    for l in linjer:
        belop = fmt_pris(int(l["pris"])) if isinstance(l.get("pris"), (int, float)) else ""
        merk = f" <span>{e(l['merknad'])}</span>" if l.get("merknad") else ""
        rader.append(f"<div><dt>{rik_tekst(l['tekst'])}</dt><dd>{belop}{merk}</dd></div>")
    return "\n            ".join(rader)


def json_ld(data):
    # vinkelparenteser og & escapes, så innholdet aldri kan avslutte <script>-elementet
    return (json.dumps(data, ensure_ascii=False, indent=2)
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


SIDE_META = re.compile(r"^\s*<!--\s*(\{.*?\})\s*-->", re.S)
GYLDIG_STI = re.compile(r"^[a-z0-9-]+(/[a-z0-9-]+)*/$")
RESERVERTE = {"assets", "tools", "docs", "worker", "sider"}
BILDE_SRC = re.compile(r'src="assets/img/([^"]+)"')


def bygg_sider(side, kurs):
    """Pakker hvert fragment i sider/ inn i nettstedets meny/bunn og skriver <sti>/index.html."""
    mappe = ROT / "sider"
    kursstier = {"kurs/"} | {f"kurs/{k['id']}/" for k in kurs}
    fragmenter = []
    for fil in sorted(mappe.glob("*.html")) if mappe.exists() else []:
        kilde = fil.read_text(encoding="utf-8")
        treff = SIDE_META.match(kilde)
        if not treff:
            raise SystemExit(f"sider/{fil.name}: første linje må være <!-- {{JSON-meta}} -->")
        fragmenter.append((fil, kilde, treff, json.loads(treff.group(1))))
    # foreldre skrives før barn, så en slettet foreldremappe ikke tar med seg en nettopp bygd underside
    fragmenter.sort(key=lambda f: (f[3].get("sti", "").count("/"), f[3].get("sti", "")))
    stier = []
    for fil, kilde, treff, meta in fragmenter:
        sti = meta.get("sti", "")
        if not GYLDIG_STI.match(sti) or sti.split("/")[0] in RESERVERTE or sti in stier or sti in kursstier:
            raise SystemExit(f"sider/{fil.name}: ugyldig, dobbel eller opptatt sti «{sti}»")
        if sti.startswith("kurs/") and sti.split("/")[1] not in {k["id"] for k in kurs}:
            print(f"ADVARSEL: sider/{fil.name} ligger under kurs/{sti.split('/')[1]}/, men kurset er ikke synlig.")
        innhold = BILDE_SRC.sub(lambda m: f'src="assets/img/{bildefil(m.group(1), fil.name)}"', kilde[treff.end():].strip())
        ut = ROT / sti
        if not sti.startswith("kurs/") and ut.exists():
            shutil.rmtree(ut)
        ut.mkdir(parents=True, exist_ok=True)
        (ut / "index.html").write_text(
            side(
                sti.count("/"),
                tittel=meta["tittel"],
                beskrivelse=meta["beskrivelse"],
                sti=sti,
                bilde_url=f"assets/img/{bildefil(meta.get('bilde') or RESERVEBILDE, fil.name)}",
                body_attr='data-side="innhold"',
                main=innhold,
                aktiv=sti,
                ld={"@context": "https://schema.org", "@type": "WebPage", "name": meta["tittel"],
                    "description": meta["beskrivelse"], "url": f"{NETTSTED}/{sti}"},
            ),
            encoding="utf-8",
        )
        stier.append(sti)
    return stier


def kort(tekst, maks):
    tekst = " ".join(tekst.split())
    if len(tekst) <= maks:
        return tekst
    kuttet = tekst[:maks].rsplit(" ", 1)[0].rstrip(",.;:–—-")
    return kuttet + " …"


def hent_facebook():
    """Siste innlegg fra Facebook-siden → assets/nyheter.json (+ lokale bildekopier).

    Feiler hentingen, publiseres siden likevel — nyhetsseksjonen faller da tilbake til
    kortene i index.html. Nøkkelen sendes i en header, aldri i adressen.
    """
    ut_json, bildemappe = ROT / "assets" / "nyheter.json", ROT / "assets" / "nyheter"
    if not FB_NOKKEL:
        return "ingen FB_PAGE_TOKEN — nyhetsseksjonen viser kortene i index.html"
    adresse = (f"{FB_GRAPH}/{FB_VERSJON}/{FB_SIDE}/posts"
               "?fields=id,message,created_time,full_picture,permalink_url&limit=12")
    try:
        foresporsel = urllib.request.Request(adresse, headers={"Authorization": f"Bearer {FB_NOKKEL}"})
        with urllib.request.urlopen(foresporsel, timeout=30) as svar:
            innlegg = json.loads(svar.read().decode("utf-8")).get("data", [])
    except Exception as feil:  # noqa: BLE001
        melding = str(feil)
        try:  # Facebook forklarer feilen i svaret (utløpt nøkkel, manglende tillatelse …)
            melding += " — " + json.loads(feil.read().decode("utf-8"))["error"]["message"]
        except Exception:  # noqa: BLE001
            pass
        melding = melding.replace(FB_NOKKEL, "***")
        print(f"ADVARSEL: fikk ikke hentet Facebook-innlegg ({melding}) — viser kortene i index.html.")
        return "Facebook utilgjengelig"
    if bildemappe.exists():
        shutil.rmtree(bildemappe)
    bildemappe.mkdir(parents=True)
    ut = []
    for p in innlegg:
        tekst = (p.get("message") or "").strip()
        if not tekst and not p.get("full_picture"):
            continue
        linjer = [l.strip() for l in tekst.splitlines() if l.strip()]
        bilde = ""
        if p.get("full_picture"):
            navn = re.sub(r"[^0-9_]", "", p["id"]) + ".jpg"
            try:
                with urllib.request.urlopen(p["full_picture"], timeout=30) as svar:
                    (bildemappe / navn).write_bytes(svar.read())
                bilde = f"assets/nyheter/{navn}"
            except Exception:  # noqa: BLE001 — innlegget vises uten bilde
                pass
        # tittel = første linje; er den lang, deles den etter første setning
        if linjer and len(linjer[0]) > 90:
            setning = re.match(r"^(.{15,90}?[.!?])\s+(.+)$", linjer[0])
            if setning:
                linjer = [setning.group(1), setning.group(2)] + linjer[1:]
        ut.append({
            "dato": (p.get("created_time") or "")[:10],
            "tittel": kort(linjer[0], 90) if linjer else "Nytt fra Kompetanse Kurs",
            "tekst": kort(" ".join(linjer[1:]), 200),
            "bilde": bilde,
            "lenke": p.get("permalink_url") or f"https://www.facebook.com/profile.php?id={FB_SIDE}",
        })
        if len(ut) == 6:
            break
    ut_json.write_text(json.dumps({"kilde": "facebook", "innlegg": ut}, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"{len(ut)} Facebook-innlegg"


def publiser(mappe, sider):
    """Kopierer bare nettstedet (ikke docs/, tools/, worker/, sider/) til en egen utdatamappe."""
    ut = (ROT / mappe).resolve()
    if ut == ROT or ROT not in ut.parents:
        raise SystemExit(f"--ut må være en undermappe av prosjektet, ikke «{mappe}».")
    if ut.exists():
        shutil.rmtree(ut)
    ut.mkdir()
    for fil in ("index.html", "sitemap.xml", "robots.txt"):
        shutil.copy2(ROT / fil, ut / fil)
    toppnivaa = {"assets", "kurs"} | {sti.split("/")[0] for sti in sider}
    for navn in sorted(toppnivaa):
        shutil.copytree(ROT / navn, ut / navn)
    print(f"Publiseringsmappe: {mappe}/ ({', '.join(sorted(toppnivaa))} + index, sitemap, robots)")


def last_kursdata():
    if not KURS_API:
        return json.loads((ROT / "assets" / "kurs.json").read_text(encoding="utf-8")), "assets/kurs.json"
    try:
        foresporsel = urllib.request.Request(f"{KURS_API}/kurs", headers={"Accept": "application/json"})
        with urllib.request.urlopen(foresporsel, timeout=30) as svar:
            data = json.loads(svar.read().decode("utf-8"))
    except Exception as feil:  # noqa: BLE001 — alt som hindrer fersk data skal stoppe bygget
        raise SystemExit(f"Fikk ikke hentet kursene fra {KURS_API}/kurs ({feil}). Ingenting er publisert.")
    # FrontCore eier kurs, datoer, plasser og pris; tekstene på kurssidene (innhold, prislister,
    # lenker, bilder) vedlikeholdes i kurs.json og flettes inn på kurs-id.
    lokalt = json.loads((ROT / "assets" / "kurs.json").read_text(encoding="utf-8"))
    lokale = {k["id"]: k for k in lokalt["kurs"]}
    for k in data["kurs"]:
        for felt in [f for f, v in k.items() if v is None]:
            del k[felt]
        l = lokale.get(k["id"], {})
        for felt in ("sidetittel", "innhold", "priser", "prismerknad", "lenker", "bilde", "desc", "koder", "varighet",
                     "gjennomforing"):
            if not k.get(felt) and l.get(felt):
                k[felt] = l[felt]
        if "ingress" not in k and "ingress" in l:  # tom ingress er et bevisst valg og skal også følge med
            k["ingress"] = l["ingress"]
    for nokkel, navn in lokalt["kategorier"].items():
        data["kategorier"].setdefault(nokkel, navn)
    return data, f"{KURS_API}/kurs + tekster fra assets/kurs.json"


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

    def side(dybde, *, tittel, beskrivelse, sti, bilde_url, body_attr, main, ld, aktiv=None):
        base = "../" * dybde
        url = f"{NETTSTED}/{sti}"
        # med <base> peker «#x» til forsiden: logoen skal dit, hopp-lenken skal bli på siden
        lokal_meny = meny.replace('class="brand" href="#topp" aria-label="Kompetanse Kurs – til toppen"',
                                  'class="brand" href="./" aria-label="Kompetanse Kurs – til forsiden"', 1)
        lokal_hopp = hopp.replace('href="#innhold"', f'href="{sti}#innhold"', 1)
        if aktiv:
            lokal_meny = lokal_meny.replace(f'<a href="{aktiv}">', f'<a href="{aktiv}" aria-current="page">', 1)
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
        pris = f"{pris_tekst(k)} eks. mva." if k.get("pris") else pris_tekst(k)
        if k.get("prismerknad"):
            pris += f" · {e(k['prismerknad'])}"
        fakta.append(f"<div><dt>Pris</dt><dd>{pris}</dd></div>")
        sted = k.get("gjennomforing") or f"{', '.join(steder)} · eller bedriftsinternt"
        fakta.append(f"<div><dt>Sted</dt><dd>{e(sted)}</dd></div>")
        ingress = k["desc"] if k.get("ingress") is None else k["ingress"]
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

        lenker = "".join(
            f'<li><a href="{e(l["href"])}">{e(l["tekst"])} <span aria-hidden="true">→</span></a></li>'
            for l in k.get("lenker") or [] if TRYGG_HREF.match(l.get("href", "")))
        priskort = ""
        if k.get("pris") or k.get("priser"):
            priskort = f"""
        <aside class="pris-kort" aria-labelledby="priser-tittel">
          <h2 id="priser-tittel">Priser</h2>
          <dl class="pris-liste">
            {pris_rader(k)}
          </dl>
          <p class="pris-merk mono">Alle priser er eks. mva.{" " + e(k["prismerknad"][0].upper() + k["prismerknad"][1:]) + "." if k.get("prismerknad") and not k.get("priser") else ""}</p>
          <button class="btn btn-signal btn-block" type="button" data-hovedknapp data-book="{e(k["id"])}" data-date="{forste}">{hovedknapp}</button>
        </aside>"""
        om_kurset = ""
        if k.get("innhold") or priskort:
            om_kurset = f"""
  <section class="section" id="om-kurset" aria-labelledby="om-kurset-tittel">
    <div class="container kursside-innhold">
      <div class="prosa">
        <h2 id="om-kurset-tittel">Om kurset</h2>
        {innhold_html(k.get("innhold"))}
        {f'<ul class="kursside-lenker">{lenker}</ul>' if lenker else ""}
      </div>{priskort}
    </div>
  </section>
"""

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
        <h1 id="kurs-tittel"{' class="lang-tittel"' if len(k.get("sidetittel") or k["navn"]) > 60 else ""}>{e(k.get("sidetittel") or k["navn"])}</h1>
        <p class="kursside-koder mono">{e(koder(dict(k, navn=k.get("sidetittel") or k["navn"])))}</p>
        {f'<p class="kursside-lead">{e(ingress)}</p>' if ingress else ""}
        <dl class="kursside-fakta mono">
          {"".join(fakta)}
        </dl>
        <div class="kursside-handling">
          <button class="btn btn-signal btn-lg" type="button" id="kursside-hovedknapp" data-hovedknapp data-book="{e(k["id"])}" data-date="{forste}">{hovedknapp}</button>
          <button class="btn btn-tilbud btn-lg" type="button" data-tilbud data-tema="Kurs for bedrift">Be om tilbud for bedrift</button>
        </div>
      </div>
      <figure class="kursside-foto"><img src="{bilde(k)}" alt="" width="900" height="600" fetchpriority="high"></figure>
    </div>
  </section>
{om_kurset}
  <section class="section section-mist" id="datoer" aria-labelledby="datoer-tittel">
    <div class="container">
      <header class="section-head">
        <p class="kicker">Kurskalender</p>
        <h2 id="datoer-tittel">Kommende datoer</h2>
      </header>
      <ul class="dato-liste" id="kursside-datoer">
      {dato_rader(k)}
      </ul>
      {"" if not datoer else '<p class="section-note mono">Passer ingen av datoene? Vi holder kurset også bedriftsinternt, hos dere — <button class="lenkeknapp" type="button" data-tilbud>be om tilbud</button>.</p>'}
    </div>
  </section>

  <section class="section kursside-cta" aria-labelledby="cta-tittel">
    <div class="container kursside-cta-rad">
      <div>
        <h2 id="cta-tittel">Klar for {e(k["navn"])}?</h2>
        <p>{"Meld deg på en kommende dato" if datoer else "Meld interesse, så gir vi beskjed når neste kurs settes opp"} — eller be om kurset bedriftsinternt hos dere.</p>
      </div>
      <div class="kursside-handling">
        <button class="btn btn-signal btn-lg" type="button" data-hovedknapp data-book="{e(k["id"])}" data-date="{forste}">{hovedknapp}</button>
        <button class="btn btn-tilbud btn-lg" type="button" data-tilbud data-tema="Kurs for bedrift">Be om tilbud</button>
      </div>
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

    ekstra = bygg_sider(side, kurs)
    nyheter = hent_facebook()
    adresser = ([f"{NETTSTED}/", f"{NETTSTED}/kurs/"] + [f"{NETTSTED}/kurs/{k['id']}/" for k in kurs]
                + [f"{NETTSTED}/{sti}" for sti in ekstra])
    (ROT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{e(u)}</loc></url>\n" for u in adresser)
        + "</urlset>\n",
        encoding="utf-8",
    )
    (ROT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /sider/\n\nSitemap: {NETTSTED}/sitemap.xml\n", encoding="utf-8")

    if "--ut" in sys.argv:
        publiser(sys.argv[sys.argv.index("--ut") + 1], ekstra)

    skjult = [k["id"] for k in data["kurs"] if k.get("synlig", True) is False]
    print(f"Bygget {len(kurs)} kurssider + oversikt + {len(ekstra)} innholdssider + sitemap fra {kilde} ({NETTSTED}); nyheter: {nyheter}."
          + (f" Skjult (synlig: false): {', '.join(skjult)}." if skjult else ""))


if __name__ == "__main__":
    main()
