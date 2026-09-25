#!/usr/bin/env python3
"""Fyller en FrontCore-konto med kursene og de kommende datoene fra assets/kurs.json.

Laget for dummy-/testkontoen, slik at Worker-en (kkurs-api) har ekte data å hente.
Bare Python 3-standardbiblioteket — ingenting å installere.

Bruk (fra prosjektroten):

    python3 tools/frontcore_seed.py --dry-run                 vis hva som ville blitt sendt
                                                              (ingen nøkkel, ingen nettverkskall)
    python3 tools/frontcore_seed.py --location-id 6489 --ja   opprett kurs og kommende datoer,
                                                              knyttet til lokalet 6489
    python3 tools/frontcore_seed.py --uten-lokale --ja        samme, men bevisst uten lokale
    ... --kun truck                                           bare ett kurs (id fra kurs.json)
    ... --oppdater                                            skriv kurs.json-verdiene over kurs
                                                              som allerede finnes (PUT)
    ... --med-skjulte                                         ta også med kurs med "synlig": false
    python3 tools/frontcore_seed.py --selvtest                innebygde tester (ingen nøkkel)

Ekte kjøring skriver til FrontCore-kontoen og krever --ja: aktive kurs kan bli synlige på
Kursguiden.no og bookbare for kunder. Se over med --dry-run først.

Plasser: FrontCore-API-et har ikke eget felt for antall plasser på en kursdato. Plassene kommer
fra kapasiteten til lokalet datoen er knyttet til (FrontCore: Settings → Venues). Derfor krever
ekte kjøring --location-id N — eller --uten-lokale som et bevisst valg. Uten lokale (eller med et
lokale uten kapasitet) har datoene ukjent kapasitet: Worker-en gir «ledige: null», og nettsiden
behandler dem som åpne (kan bookes, ingen øvre grense). «ledige: 0» betyr fullt. Lokalet sjekkes
mot GET /v2/locations før noe skrives.

API-nøkkel: miljøvariabelen FRONTCORE_API_KEY, ellers linjen FRONTCORE_API_KEY=... i
worker/.dev.vars (mal: worker/.dev.vars.example). Nøkkelen skrives aldri ut.
FRONTCORE_API_URL overstyrer https://api.frontcore.com/v2 (for testing mot en attrapp). Den må
være https:// — bare http://localhost og http://127.0.0.1 er unntatt. Omdirigeringer følges
aldri, så nøkkelen ikke sendes videre til en annen adresse.

Trygt å kjøre flere ganger:
  - Kurs matches på reference == id i kurs.json. Reserve: samme tittel og tom reference —
    da settes reference på det eksisterende kurset. Et kurs som finnes, opprettes ikke på
    nytt; kkurs_*-egenskaper som mangler, fylles inn (alt overskrives med --oppdater).
  - Datoer: bare kommende (fra og med i dag). En dato hoppes over hvis kurset allerede har
    en dato med samme reference (<id>-<åååå-mm-dd>) eller samme startdato.
  - Eksisterende datoer endres aldri — heller ikke lokalet. En ny kjøring med --location-id
    gjelder bare nye datoer; datoer som ble opprettet uten (eller med feil) lokale, må rettes
    i FrontCore-adminen. Oppsummeringen merker slike datoer når lokalet kan leses.
  - Et kurs som feiler, får ikke datoene sine opprettet — kjør igjen når feilen er rettet.
  - Sluttdato regnes i virkedager (lørdag og søndag hoppes over): «3 dager» fra torsdag gir
    torsdag, fredag, mandag → sluttdato mandag. «N uker» = 5·N virkedager. FrontCore lagrer
    bare start og slutt, så datoer som går over helg merkes i oppsummeringen.
  - Datoer med sted «Digitalt» får ikke lokale (lokalet gjelder fysiske kurs).
  - Kurs med "synlig": false hoppes over som standard; --med-skjulte tar dem med (inaktive).

Avslutningskode: 0 = alt i orden. 1 = noe feilet (se oppsummeringen). 2 = et kurs dukker ikke
opp i GET /v2/courses etter kjøringen, så en ny kjøring kan opprette det på nytt — sjekk kurset
i FrontCore FØR du kjører igjen. 2 går foran 1.
"""
import argparse
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

# Antagelser om FrontCore-svarene — eksemplene i dokumentasjonen er ufullstendige
# (GET /v2/courses viser bare []):
#  - Lister kommer som ren liste eller som {"items": [...], "pagination": {...}} (slik
#    GET /v2/coursedates gjør). Vi blar til next_page er null, siden er kort/tom, eller
#    bare gjentar elementer vi har sett. Ukjent listeformat stopper skriptet, så vi aldri
#    oppretter duplikater fordi vi ikke fant de eksisterende kursene.
#  - Kurs-id heter "id" eller "course_id"; dato-id "coursedate_id" eller "id"; id-er kan
#    komme som tall eller tekst.
#  - POST svarer {"course_id": N} / {"coursedate_id": N}. Feil kommer som {"error": "..."},
#    også med HTTP 200.
#  - custom_properties på kurs er ikke dokumentert for POST/PUT. Vi sender dem, sjekker
#    om GET-listen viser dem, sender hele kkurs_*-settet med PUT hvis ikke, og melder fra
#    hvis de fortsatt mangler. Avviser POST dem, opprettes kurset uten. PHP koder et tomt
#    objekt som [] — det tolkes som «ingen egenskaper lagret».
#  - Det er uklart om GET /v2/courses tar med inaktive kurs. Dukker et kurs ikke opp i
#    listen etterpå, advarer vi og avslutter med kode 2 — en ny kjøring ville da opprettet
#    det på nytt.

ROT = Path(__file__).resolve().parent.parent
KURSFIL = ROT / "assets" / "kurs.json"
DEV_VARS = ROT / "worker" / ".dev.vars"
API_URL = os.environ.get("FRONTCORE_API_URL", "https://api.frontcore.com/v2").strip().rstrip("/")
PLASSHOLDER = "lim-inn-her"  # samme som i worker/.dev.vars.example
LOKALE_VERTER = {"localhost", "127.0.0.1", "::1"}  # eneste adresser der http:// er lov

PAUSE = 0.3          # sekunder mellom kall — FrontCore tillater 5 GET/s
SIDESTORRELSE = 250  # dokumentert maks for limit
MAKS_SIDER = 100
MAKS_FORSOK = 5      # ved 429 (og 502–504 på GET)

START_KL, SLUTT_KL = "08:00", "15:30"
TIDSSONE = "Europe/Oslo"
STATUS_BLIR_GJENNOMFORT = 2
DIGITALT = "digitalt"
MAKS_VARIGHET = 999  # større tall regnes som feil i kurs.json
UKEDAGER = ("mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag")

MINUTT, TIME, DAG, UKE, MANED, SEMESTER, AR = 7, 6, 1, 2, 3, 4, 5  # FrontCore duration_unit
ENHETER = {
    "min": MINUTT, "minutt": MINUTT, "minutter": MINUTT,
    "time": TIME, "timer": TIME, "timers": TIME,
    "dag": DAG, "dager": DAG, "dagers": DAG, "døgn": DAG,
    "uke": UKE, "uker": UKE, "ukers": UKE,
    "mnd": MANED, "måned": MANED, "måneder": MANED, "måneders": MANED,
    "semester": SEMESTER,
    "år": AR, "års": AR,
}


# ---------------------------------------------------------------- tolking og payload

def kort(verdi, maks=300):
    tekst = verdi if isinstance(verdi, str) else json.dumps(verdi, ensure_ascii=False, default=str)
    return tekst if len(tekst) <= maks else tekst[:maks] + " …"


def tolk_varighet(tekst):
    """«3 dager» → (3, DAG), «3 dager + praksis» → (3, DAG). Ukjent eller mangler → None."""
    if not isinstance(tekst, str):
        return None
    treff = re.match(r"\s*(\d+)[\s-]*([a-zæøå]+)", tekst.lower())
    if not treff:
        return None
    antall, enhet = int(treff.group(1)), ENHETER.get(treff.group(2))
    if enhet is None or not 0 < antall <= MAKS_VARIGHET:
        return None
    return antall, enhet


def antall_kursdager(varighet):
    """Antall kursdager (virkedager). 1 for timer/minutter og når varigheten ikke kan tolkes."""
    tolket = tolk_varighet(varighet)
    if not tolket:
        return 1
    antall, enhet = tolket
    if enhet == DAG:
        return antall
    if enhet == UKE:
        return antall * 5
    return 1  # timer/minutter: samme dag; måneder o.l. må justeres i FrontCore (merknad)


def sluttdato(start, varighet):
    """Startdato + (kursdager − 1) virkedager; lørdag og søndag telles ikke.
    Torsdag + «3 dager» → mandag."""
    slutt, igjen = start, antall_kursdager(varighet) - 1
    while igjen > 0:
        slutt += timedelta(days=1)
        if slutt.weekday() < 5:
            igjen -= 1
    return slutt


def over_helg(start, slutt):
    dag = start
    while dag <= slutt:
        if dag.weekday() >= 5:
            return True
        dag += timedelta(days=1)
    return False


def tolk_pris(verdi):
    """Gir (pris, merknad). Heltall brukes som de er; tekst som «6 900», «kr 6 900,-» og «6.900»
    tolkes som 6900. Mangler/0 → (None, None). Alt annet → (None, merknad) — krasjer aldri."""
    if verdi is None or verdi == "" or verdi == 0:
        return None, None
    tall = None
    if isinstance(verdi, bool):
        tall = None
    elif isinstance(verdi, int):
        tall = verdi
    elif isinstance(verdi, float) and verdi.is_integer():
        tall = int(verdi)
    elif isinstance(verdi, str):
        tekst = verdi.strip().lower()
        tekst = re.sub(r"^(kr\.?|nok)\s*", "", tekst)
        tekst = re.sub(r"\s*(,-|\.-|,00|kr\.?|nok)$", "", tekst)
        if re.fullmatch(r"\d{1,3}(?:[   .]\d{3})+|\d+", tekst):
            tall = int(re.sub(r"\D", "", tekst))
            if tall == 0:
                return None, None
    if tall is not None and tall > 0:
        return tall, None
    return None, (f"Pris «{kort(str(verdi), 40)}» i kurs.json er ikke et heltall i kroner — sendes ikke "
                  "til FrontCore (vises som pris på forespørsel). Rett kurs.json eller sett prisen i FrontCore.")


def kurs_merknader(k):
    """Merknader om verdier i kurs.json som ikke kan sendes slik de står."""
    merknader = []
    varighet = k.get("varighet")
    if varighet is not None and str(varighet).strip():
        tolket = tolk_varighet(varighet)
        if tolket is None:
            merknader.append(
                f"Varighet «{kort(str(varighet), 60)}» kunne ikke tolkes — duration sendes ikke, og datoene "
                "får sluttdato = startdato. Sett varighet og sluttdato i FrontCore."
            )
        elif tolket[1] not in (DAG, UKE, TIME, MINUTT):
            merknader.append(
                f"Varighet «{kort(str(varighet), 60)}» gir ingen sluttdato i dager — datoene får "
                "sluttdato = startdato. Juster sluttdatoene i FrontCore."
            )
    _, prismerknad = tolk_pris(k.get("pris"))
    if prismerknad:
        merknader.append(prismerknad)
    return merknader


def er_synlig(k):
    return bool(k.get("synlig", True))


def egenskaper(k):
    """custom_properties for kurset — verdiene må være tekst (maks 255 tegn)."""
    kilder = {
        "kkurs_kat": k.get("kat"),
        "kkurs_koder": k.get("koder"),
        "kkurs_bilde": k.get("bilde"),
        "kkurs_varighet": k.get("varighet"),
    }
    return {navn: str(verdi)[:255] for navn, verdi in kilder.items() if verdi not in (None, "")}


def kurs_payload(k):
    p = {
        "title": k["navn"],
        "active": er_synlig(k),
        "reference": k["id"],
        "level": 6,
        "form_of_teaching": 1,
        "teaching_language": "no",
    }
    varighet = tolk_varighet(k.get("varighet"))
    if varighet:
        p["duration_value"], p["duration_unit"] = varighet
    pris, _ = tolk_pris(k.get("pris"))
    if pris:
        p["price_value"] = pris
    p["price_currency"] = "NOK"
    if k.get("desc"):
        p["text_lead"] = k["desc"]
    cp = egenskaper(k)
    if cp:
        p["custom_properties"] = cp
    return p


def dato_payload(k, dt, location_id=None):
    start = date.fromisoformat(dt["d"])
    p = {
        "start_at": start.isoformat(),
        "end_at": sluttdato(start, k.get("varighet")).isoformat(),
        "start_time_at": START_KL,
        "end_time_at": SLUTT_KL,
        "timezone": TIDSSONE,
        "status_id": STATUS_BLIR_GJENNOMFORT,
        "reference": f"{k['id']}-{start.isoformat()}",
    }
    sted = (dt.get("sted") or "").strip()
    digitalt = sted.lower() == DIGITALT
    if digitalt:
        p["place_additional_info"] = "Digitalt"
    elif sted:
        p["place_by_search"] = sted
    if location_id is not None and not digitalt:
        p["location_id"] = location_id
    if dt.get("merk"):
        p["custom_properties"] = {"kkurs_merk": str(dt["merk"])[:255]}
    return p


def del_datoer(k, idag):
    """Gir (kommende, passerte, ugyldige); kommende er [(dt, startdato)] sortert på dato."""
    kommende, passerte, ugyldige = [], [], []
    for dt in k.get("datoer") or []:
        try:
            start = date.fromisoformat(str(dt.get("d", "")))
        except (ValueError, AttributeError):
            ugyldige.append(dt if isinstance(dt, dict) else {"d": str(dt)})
            continue
        (kommende if start >= idag else passerte).append((dt, start))
    kommende.sort(key=lambda par: par[1])
    return kommende, passerte, ugyldige


# ---------------------------------------------------------------- FrontCore-svar

def som_id(verdi):
    try:
        return int(verdi)
    except (TypeError, ValueError):
        return None


def fc_kurs_id(obj):
    if not isinstance(obj, dict):
        return None
    for felt in ("id", "course_id"):
        if som_id(obj.get(felt)) is not None:
            return som_id(obj[felt])
    if isinstance(obj.get("course"), dict):
        return som_id(obj["course"].get("id"))
    return None


def fc_dato_id(obj):
    if not isinstance(obj, dict):
        return None
    for felt in ("coursedate_id", "id"):
        if som_id(obj.get(felt)) is not None:
            return som_id(obj[felt])
    return None


def element_nokkel(obj):
    if isinstance(obj, dict):
        for felt in ("coursedate_id", "id", "course_id"):
            if obj.get(felt) is not None:
                return f"{felt}:{obj[felt]}"
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)


def pakk_ut_liste(svar):
    """Gir (elementer, neste_side). neste_side None = ukjent, 0 = ingen flere sider."""
    if svar is None:
        return [], 0
    if isinstance(svar, list):
        return svar, None
    if isinstance(svar, dict):
        for felt in ("items", "data", "results", "courses", "coursedates", "locations"):
            if isinstance(svar.get(felt), list):
                elementer = svar[felt]
                break
        else:
            raise FrontCoreFeil(f"ukjent listeformat fra FrontCore (felter: {', '.join(sorted(svar)) or 'ingen'})")
        sider = svar.get("pagination")
        if isinstance(sider, dict) and "next_page" in sider:
            return elementer, som_id(sider["next_page"]) or 0
        return elementer, None
    raise FrontCoreFeil(f"ukjent listeformat fra FrontCore ({type(svar).__name__})")


def referanse(obj):
    return str(obj.get("reference") or "").strip() if isinstance(obj, dict) else ""


def lagrede_egenskaper(obj):
    """custom_properties slik FrontCore viser dem. PHP koder et tomt objekt som [], som tolkes
    som «ingen lagret». None = feltet mangler eller har ukjent form."""
    cp = obj.get("custom_properties") if isinstance(obj, dict) else None
    if isinstance(cp, dict):
        return cp
    if cp == []:
        return {}
    return None


def manglende_egenskaper(obj, onsket, overskriv=False):
    """Egenskapene som ikke er lagret (tomme regnes som manglende). Med overskriv regnes også
    avvikende verdier som manglende."""
    cp = lagrede_egenskaper(obj) or {}
    return {
        navn: verdi for navn, verdi in onsket.items()
        if not cp.get(navn) or (overskriv and str(cp.get(navn)) != verdi)
    }


def onsket_sett(obj, onsket, overskriv=False):
    """HELE settet av kkurs_*-nøkler til PUT. Verdier som allerede er lagret, beholdes (med mindre
    overskriv); resten kommer fra kurs.json. Da forsvinner ingen nøkler selv om FrontCore skulle
    erstatte hele custom_properties-objektet ved PUT."""
    cp = lagrede_egenskaper(obj) or {}
    return {navn: (str(cp[navn]) if cp.get(navn) and not overskriv else verdi) for navn, verdi in onsket.items()}


def lokale_id(obj):
    """Lokale-id for en eksisterende dato, eller None. Gir «ukjent» hvis svaret ikke sier noe."""
    if not isinstance(obj, dict) or "location" not in obj:
        return "ukjent"
    lokale = obj["location"]
    return som_id(lokale.get("id")) if isinstance(lokale, dict) else som_id(lokale)


def feiltekst(raa):
    """Det lesbare i et feilsvar — uforkortet, så nøkkelen kan renses bort før teksten kortes ned."""
    try:
        data = json.loads(raa.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return raa.decode("utf-8", "replace").strip() or "(tomt svar)"
    if isinstance(data, dict):
        for felt in ("error", "message", "errors"):
            if data.get(felt):
                return data[felt]
    return data


def ventetid(retry_after, forsok):
    try:
        return min(max(float(retry_after), 0.5), 30.0)
    except (TypeError, ValueError):
        return min(2 ** (forsok - 1), 16)


# ---------------------------------------------------------------- HTTP

class FrontCoreFeil(Exception):
    def __init__(self, melding, status=None):
        super().__init__(melding)
        self.status = status


class Omdirigert(Exception):
    def __init__(self, kode):
        super().__init__(f"HTTP {kode}")
        self.kode = kode


class IngenOmdirigering(urllib.request.HTTPRedirectHandler):
    """Følger aldri omdirigeringer — urllib ville ellers sendt X-API-Key videre til den nye adressen."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fp.close()
        raise Omdirigert(code)


def sjekk_api_url(url):
    """FRONTCORE_API_URL må være https:// — bare localhost/127.0.0.1 (attrapp) kan bruke http://."""
    try:
        deler = urllib.parse.urlsplit(url)
        vert = deler.hostname
        brukerinfo = deler.username or deler.password
    except ValueError:
        deler, vert, brukerinfo = None, None, None
    if deler and vert and not brukerinfo and (
            deler.scheme == "https" or (deler.scheme == "http" and vert in LOKALE_VERTER)):
        return url.rstrip("/")
    raise SystemExit(
        "FRONTCORE_API_URL er ugyldig: adressen må begynne med https:// (http:// er bare lov mot "
        "localhost og 127.0.0.1) og kan ikke inneholde brukernavn eller passord. Nøkkelen sendes ikke."
    )


class FrontCore:
    def __init__(self, nokkel, api_url=API_URL, pause=PAUSE):
        self._nokkel = nokkel
        self.api_url = sjekk_api_url(api_url)
        self.pause = pause
        self._siste = 0.0
        self.antall_kall = 0
        handlere = [IngenOmdirigering]
        if urllib.parse.urlsplit(self.api_url).hostname in LOKALE_VERTER:
            handlere.append(urllib.request.ProxyHandler({}))  # lokal attrapp: aldri via proxy
        self._aapner = urllib.request.build_opener(*handlere)

    def _rens(self, tekst):
        """Fjerner nøkkelen (også i escapet form, slik den står i repr-er) fra en tekst."""
        if not self._nokkel:
            return tekst
        for form in (self._nokkel, repr(self._nokkel)[1:-1]):
            tekst = tekst.replace(form, "***")
        return tekst

    def _kort(self, verdi, maks=300):
        """Renser FØR teksten kortes ned, så en avkuttet nøkkel aldri slipper gjennom."""
        tekst = verdi if isinstance(verdi, str) else json.dumps(verdi, ensure_ascii=False, default=str)
        return kort(self._rens(tekst), maks)

    def _vent(self):
        rest = self._siste + self.pause - time.monotonic()
        if rest > 0:
            time.sleep(rest)
        self._siste = time.monotonic()

    def kall(self, metode, sti, params=None, body=None):
        """Ett API-kall. Alle feil — HTTP, nettverk, ugyldige svar — blir FrontCoreFeil, så
        oppsummeringen alltid skrives."""
        url = self.api_url + sti
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)
        hoder = {"X-API-Key": self._nokkel, "Accept": "application/json", "User-Agent": "kkurs-seed/1.0"}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            hoder["Content-Type"] = "application/json"
        for forsok in range(1, MAKS_FORSOK + 1):
            self._vent()
            self.antall_kall += 1
            try:
                foresporsel = urllib.request.Request(url, data=data, headers=hoder, method=metode)
                with self._aapner.open(foresporsel, timeout=30) as svar:
                    return self._tolk(metode, sti, svar.read(), svar.status)
            except Omdirigert as e:
                raise FrontCoreFeil(
                    f"{metode} {sti}: FrontCore svarte med omdirigering (HTTP {e.kode}) — følges ikke, så "
                    "nøkkelen ikke sendes videre. Sjekk FRONTCORE_API_URL.", e.kode)
            except urllib.error.HTTPError as e:
                try:
                    innhold = e.read()
                except (OSError, http.client.HTTPException):
                    innhold = b""
                prov_igjen = e.code == 429 or (metode == "GET" and e.code in (502, 503, 504))
                if prov_igjen and forsok < MAKS_FORSOK:
                    pause = ventetid(e.headers.get("Retry-After") if e.headers else None, forsok)
                    print(f"    (HTTP {e.code} fra FrontCore — venter {pause:g} s og prøver igjen)", flush=True)
                    time.sleep(pause)
                    continue
                raise FrontCoreFeil(f"{metode} {sti}: HTTP {e.code} — {self._kort(feiltekst(innhold))}", e.code)
            except OSError as e:
                grunn = getattr(e, "reason", e)
                raise FrontCoreFeil(f"{metode} {sti}: nettverksfeil — {self._kort(str(grunn))}")
            except http.client.HTTPException as e:
                raise FrontCoreFeil(f"{metode} {sti}: ugyldig HTTP-svar fra FrontCore ({type(e).__name__})")
            except ValueError as e:
                raise FrontCoreFeil(f"{metode} {sti}: ugyldig forespørsel eller svar — {self._kort(str(e))}")
        raise FrontCoreFeil(f"{metode} {sti}: ga opp etter {MAKS_FORSOK} forsøk")

    def _tolk(self, metode, sti, raa, status):
        if not raa.strip():
            return None
        try:
            data = json.loads(raa.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise FrontCoreFeil(f"{metode} {sti}: svaret var ikke JSON — {self._kort(raa.decode('utf-8', 'replace'))}", status)
        if isinstance(data, dict) and data.get("error"):
            raise FrontCoreFeil(f"{metode} {sti}: {self._kort(data['error'])}", status)
        return data

    def hent_alle(self, sti, params=None):
        alle, sett, side = [], set(), 1
        while side and side <= MAKS_SIDER:
            svar = self.kall("GET", sti, dict(params or {}, limit=SIDESTORRELSE, page=side))
            elementer, neste = pakk_ut_liste(svar)
            nye = [e for e in elementer if element_nokkel(e) not in sett]
            if not nye:
                break
            sett.update(element_nokkel(e) for e in nye)
            alle.extend(nye)
            if neste is not None:
                side = neste
            elif len(elementer) < SIDESTORRELSE:
                break
            else:
                side += 1
        return alle


def les_nokkel(dev_vars=DEV_VARS, miljo=None):
    miljo = os.environ if miljo is None else miljo
    nokkel = (miljo.get("FRONTCORE_API_KEY") or "").strip()
    if not nokkel:
        try:
            linjer = dev_vars.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            linjer = []
        for linje in linjer:
            linje = linje.strip()
            if linje.startswith("export "):
                linje = linje[len("export "):].lstrip()
            navn, erlik, verdi = linje.partition("=")
            if erlik and navn.strip() == "FRONTCORE_API_KEY":
                nokkel = verdi.strip().strip("'\"").strip()
                break
    if not nokkel or nokkel == PLASSHOLDER:
        raise SystemExit(
            "Mangler FrontCore-nøkkel. Sett miljøvariabelen FRONTCORE_API_KEY, eller legg linjen\n"
            "FRONTCORE_API_KEY=... i worker/.dev.vars (kopier worker/.dev.vars.example).\n"
            "Nøkkelen finnes i FrontCore under Settings → API. Den skal aldri i git.\n"
            "Vil du bare se hva som ville blitt sendt: python3 tools/frontcore_seed.py --dry-run"
        )
    if not re.fullmatch(r"[!-~]+", nokkel):
        raise SystemExit("FrontCore-nøkkelen inneholder mellomrom eller ugyldige tegn — sjekk at hele "
                         "nøkkelen er limt inn på én linje.")
    return nokkel


# ---------------------------------------------------------------- kurs.json

def les_kurs(kun=None, med_skjulte=False, kursfil=KURSFIL):
    """Gir (kursliste, skjulte kurs som hoppes over). Skjulte kurs ("synlig": false) tas bare
    med når med_skjulte er satt."""
    try:
        data = json.loads(kursfil.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"Klarte ikke å lese {kursfil}: {e}")
    kursliste = [k for k in data.get("kurs", []) if isinstance(k, dict)]
    ufullstendige = [k.get("id") or k.get("navn") or "?" for k in kursliste if not (k.get("id") and k.get("navn"))]
    if ufullstendige:
        raise SystemExit(f"Kurs uten id eller navn i kurs.json: {', '.join(map(str, ufullstendige))}")
    if kun:
        valgt = [k for k in kursliste if k["id"] == kun]
        if not valgt:
            raise SystemExit(f"Fant ikke kurs med id «{kun}». Gyldige: {', '.join(k['id'] for k in kursliste)}")
        if not med_skjulte and not er_synlig(valgt[0]):
            raise SystemExit(f"Kurset «{kun}» er skjult (\"synlig\": false). Legg til --med-skjulte for å ta det med.")
        return valgt, []
    if med_skjulte:
        return kursliste, []
    return [k for k in kursliste if er_synlig(k)], [k for k in kursliste if not er_synlig(k)]


def skriv_skjulte(skjulte):
    if skjulte:
        print(f"Hopper over {len(skjulte)} skjult(e) kurs (\"synlig\": false): "
              f"{', '.join(k['id'] for k in skjulte)} — ta dem med med --med-skjulte.")


def nytt_resultat(k):
    return {"id": k["id"], "navn": k["navn"], "kurs": None, "fc_id": None,
            "egenskaper": None, "datoer": [], "merknader": kurs_merknader(k), "ikke_i_listen": False}


def dato_rad(dt, status, fc_id=None, detalj=""):
    return {"d": str(dt.get("d", "?")), "sted": dt.get("sted") or "", "status": status,
            "fc_id": fc_id, "detalj": detalj}


def helgemerknad(k, start):
    slutt = sluttdato(start, k.get("varighet"))
    if start.weekday() >= 5:
        return f"starter en {UKEDAGER[start.weekday()]} — sjekk datoen"
    if over_helg(start, slutt):
        return (f"går over helg — sluttdato {UKEDAGER[slutt.weekday()]} {slutt.isoformat()} "
                "(helgen er ikke kursdager)")
    return ""


def lokalemerknad(obj, location_id):
    """Merknad for en eksisterende dato som ikke har lokalet vi ville satt (den endres ikke)."""
    if location_id is None:
        return ""
    naa = lokale_id(obj)
    if naa == "ukjent" or naa == location_id:
        return ""
    har = "har ikke lokale" if naa is None else f"har lokale {naa}"
    return f"endres ikke — {har}; sett lokale {location_id} på datoen i FrontCore"


# ---------------------------------------------------------------- tørrkjøring

def skriv_json(data):
    for linje in json.dumps(data, ensure_ascii=False, indent=2).splitlines():
        print("      " + linje)


def torrkjoring(kursliste, idag, location_id, skjulte=(), api_url=API_URL):
    print("FrontCore-seed — TØRRKJØRING: ingen nettverkskall, ingen nøkkel leses.")
    print(f"Kilde: {KURSFIL.relative_to(ROT)} · {len(kursliste)} kurs · i dag {idag.isoformat()} · mål {api_url}")
    print("Kan ikke se hva som allerede finnes i FrontCore uten nøkkel — alt vises som «ville opprettes».")
    skriv_skjulte(skjulte)
    if location_id is None:
        print("NB: uten lokale får datoene ukjent kapasitet (ledige: null — åpne på nettsiden). Plassene "
              "kommer fra lokalets kapasitet; ekte kjøring krever --location-id N eller --uten-lokale.")
    resultater = []
    for k in kursliste:
        r = nytt_resultat(k)
        resultater.append(r)
        print(f"\n[{k['id']}] {k['navn']}")
        print("    POST /courses")
        skriv_json(kurs_payload(k))
        r["kurs"] = ("ville opprettes", None, "")
        r["egenskaper"] = "ville sendes" if egenskaper(k) else "ingen"
        kommende, passerte, ugyldige = del_datoer(k, idag)
        for dt in ugyldige:
            r["datoer"].append(dato_rad(dt, "feilet", detalj="ugyldig dato i kurs.json"))
        for dt, _ in passerte:
            r["datoer"].append(dato_rad(dt, "hoppet over", detalj="passert"))
        for dt, start in kommende:
            print(f"    POST /courses/<ny id for {k['id']}>/coursedates")
            skriv_json(dato_payload(k, dt, location_id))
            r["datoer"].append(dato_rad(dt, "ville opprettes", detalj=helgemerknad(k, start)))
    print()
    skriv_oppsummering(resultater)
    print("Ekte kjøring: legg til --ja og --location-id N (eller --uten-lokale).")
    return sluttkode(resultater)


# ---------------------------------------------------------------- ekte kjøring

def sjekk_lokale(fc, location_id):
    """Stopper før noe skrives hvis lokalet ikke finnes; advarer hvis det mangler kapasitet."""
    try:
        lokaler = [l for l in fc.hent_alle("/locations") if isinstance(l, dict)]
    except FrontCoreFeil as e:
        print(f"  Advarsel: kunne ikke hente lokalene for å sjekke --location-id {location_id} ({e}). "
              "Fortsetter — FrontCore avviser datoene hvis lokalet ikke finnes.", flush=True)
        return
    lokale = next((l for l in lokaler if som_id(l.get("id")) == location_id), None)
    if lokale is None:
        kjente = ", ".join(f"{som_id(l.get('id'))} ({l.get('title') or '?'})"
                           for l in lokaler if som_id(l.get("id")) is not None) or "ingen"
        raise SystemExit(f"Fant ikke lokale {location_id} i FrontCore (Settings → Venues). Lokaler: "
                         f"{kort(kjente)}. Ingenting er skrevet.")
    navn = lokale.get("custom_title") or lokale.get("title") or "uten navn"
    kapasitet = som_id(lokale.get("capacity_max"))
    if kapasitet and kapasitet > 0:
        print(f"Lokale {location_id} ({navn}): {kapasitet} plasser per dato.", flush=True)
    else:
        print(f"  Advarsel: lokale {location_id} ({navn}) har ingen kapasitet i FrontCore — datoene får ukjent "
              "kapasitet (ledige: null) og vises som åpne på nettsiden. Sett kapasitet under Settings → Venues.",
              flush=True)


def finn_pa_tittel(kursliste_fc, navn):
    for obj in kursliste_fc:
        if (isinstance(obj, dict) and not referanse(obj)
                and str(obj.get("title") or "").strip().lower() == navn.strip().lower()):
            return obj
    return None


def sikre_kurs(fc, k, per_ref, kursliste_fc, oppdater, r):
    """Gir (FrontCore-id, nyopprettet)."""
    payload = kurs_payload(k)
    obj = per_ref.get(k["id"])
    if obj is None:
        obj = finn_pa_tittel(kursliste_fc, k["navn"])
        if obj is not None:
            fc_id = fc_kurs_id(obj)
            if fc_id is None:
                raise FrontCoreFeil(f"fant kurset i FrontCore, men ingen id i svaret: {kort(obj)}")
            fc.kall("PUT", f"/courses/{fc_id}", body={"reference": k["id"]})
            obj["reference"] = k["id"]
            per_ref[k["id"]] = obj
            r["merknader"].append("Fantes med samme tittel uten reference — reference er satt.")
    if obj is not None:
        fc_id = fc_kurs_id(obj)
        if fc_id is None:
            raise FrontCoreFeil(f"fant kurset i FrontCore, men ingen id i svaret: {kort(obj)}")
        if oppdater:
            fc.kall("PUT", f"/courses/{fc_id}", body=payload)
            r["kurs"] = ("oppdatert", fc_id, "")
        else:
            r["kurs"] = ("finnes", fc_id, "")
        return fc_id, False

    try:
        svar = fc.kall("POST", "/courses", body=payload)
    except FrontCoreFeil as forste:
        if "custom_properties" not in payload or forste.status not in (200, 400, 422):
            raise
        uten = {n: v for n, v in payload.items() if n != "custom_properties"}
        try:
            svar = fc.kall("POST", "/courses", body=uten)
        except FrontCoreFeil as andre:
            if str(andre) == str(forste):
                raise
            raise FrontCoreFeil(f"{andre} (første forsøk med custom_properties: {forste})", andre.status)
        r["merknader"].append(f"POST med custom_properties ble avvist ({forste}); kurset ble opprettet uten.")
    fc_id = fc_kurs_id(svar)
    if fc_id is None:
        raise FrontCoreFeil(f"POST /courses: fant ingen kurs-id i svaret: {kort(svar)}")
    r["kurs"] = ("opprettet", fc_id, "")
    print(f"  {k['id']}: kurs opprettet ({fc_id})", flush=True)
    return fc_id, True


def sikre_datoer(fc, k, fc_id, idag, location_id, nyopprettet, r):
    kommende, passerte, ugyldige = del_datoer(k, idag)
    for dt in ugyldige:
        r["datoer"].append(dato_rad(dt, "feilet", detalj="ugyldig dato i kurs.json"))
    for dt, _ in passerte:
        r["datoer"].append(dato_rad(dt, "hoppet over", detalj="passert"))
    if not kommende:
        return
    finnes = []
    if not nyopprettet:
        try:
            finnes = fc.hent_alle(f"/courses/{fc_id}/coursedates")
        except FrontCoreFeil as e:
            for dt, _ in kommende:
                r["datoer"].append(dato_rad(dt, "feilet", detalj=f"kunne ikke hente eksisterende datoer: {e}"))
            return
    per_ref = {referanse(obj): obj for obj in finnes if referanse(obj)}
    per_start = {str(obj.get("start_at") or "")[:10]: obj for obj in finnes if isinstance(obj, dict)}
    for dt, start in kommende:
        payload = dato_payload(k, dt, location_id)
        helg = helgemerknad(k, start)
        treff = per_ref.get(payload["reference"]) or per_start.get(payload["start_at"])
        if treff is not None:
            r["datoer"].append(dato_rad(dt, "finnes", fc_dato_id(treff),
                                        lokalemerknad(treff, payload.get("location_id"))))
            continue
        try:
            svar = fc.kall("POST", f"/courses/{fc_id}/coursedates", body=payload)
        except FrontCoreFeil as e:
            r["datoer"].append(dato_rad(dt, "feilet", detalj=str(e)))
            continue
        dato_id = fc_dato_id(svar)
        detalj = helg if dato_id is not None else f"uventet svar uten dato-id: {kort(svar)}"
        r["datoer"].append(dato_rad(dt, "opprettet", dato_id, detalj))
        print(f"  {k['id']}: dato {payload['start_at']} opprettet ({dato_id})", flush=True)


def vurder_egenskaper(obj, forventet):
    """«lagret» når FrontCore har nøyaktig de forventede verdiene; [] fra PHP gir «ikke lagret»."""
    if not forventet:
        return "ingen"
    if lagrede_egenskaper(obj) is None:
        return "ukjent"
    return "ikke lagret" if manglende_egenskaper(obj, forventet, overskriv=True) else "lagret"


def sikre_egenskaper(fc, kurs_per_id, resultater, oppdater):
    """Etterkontroll via GET /courses: at hvert kurs vises i listen (ellers avslutningskode 2), og
    at kkurs_*-egenskapene er lagret. Mangler noen, sendes HELE settet med PUT og sjekkes igjen."""
    aktuelle = [r for r in resultater if r["fc_id"] is not None]
    if not aktuelle:
        return
    print("Sjekker kurslisten og kkurs_*-egenskapene …", flush=True)
    try:
        per_id = {fc_kurs_id(obj): obj for obj in fc.hent_alle("/courses")}
    except FrontCoreFeil as e:
        for r in aktuelle:
            r["egenskaper"] = "ukjent"
            if r["kurs"][0] in ("opprettet", "oppdatert"):
                r["ikke_i_listen"] = True
                r["merknader"].append(
                    f"ADVARSEL: kunne ikke hente kurslisten etterpå ({e}), så det er ikke bekreftet at kurset "
                    "vises der. Sjekk kurset i FrontCore før du kjører igjen — ellers kan det bli opprettet på nytt."
                )
            else:
                r["merknader"].append(f"Kunne ikke hente kurslisten for å sjekke egenskapene: {e}")
        return
    satt_med_put = []
    for r in aktuelle:
        k = kurs_per_id[r["id"]]
        onsket = egenskaper(k)
        obj = per_id.get(r["fc_id"])
        if obj is None:
            r["egenskaper"] = "ukjent"
            r["ikke_i_listen"] = True
            skjult = not er_synlig(k)
            r["merknader"].append(
                "ADVARSEL: kurset vises ikke i GET /courses" + (" (trolig fordi det er inaktivt)" if skjult else "")
                + ", så en ny kjøring vil opprette det på nytt. Sjekk kurset i FrontCore før du kjører igjen"
                + (" — eller kjør uten --med-skjulte." if skjult else ".")
            )
            continue
        if not onsket:
            r["egenskaper"] = "ingen"
            continue
        if lagrede_egenskaper(obj) is None and r["kurs"][0] != "opprettet" and not oppdater:
            r["egenskaper"] = "ukjent"
            r["merknader"].append(
                "GET /courses viser ikke custom_properties, så det er uklart om kkurs_*-egenskapene finnes. "
                "Eksisterende kurs røres ikke — bruk --oppdater for å skrive dem."
            )
            continue
        sett = onsket_sett(obj, onsket, overskriv=oppdater)
        if vurder_egenskaper(obj, sett) == "lagret":
            r["egenskaper"] = "lagret"
            continue
        try:
            fc.kall("PUT", f"/courses/{r['fc_id']}", body={"custom_properties": sett})
        except FrontCoreFeil as e:
            r["egenskaper"] = "feilet"
            r["merknader"].append(f"PUT av custom_properties feilet: {e}")
            continue
        satt_med_put.append((r, sett))
    if not satt_med_put:
        return
    try:
        per_id = {fc_kurs_id(obj): obj for obj in fc.hent_alle("/courses")}
    except FrontCoreFeil as e:
        per_id = {}
        print(f"  Kunne ikke hente kurslisten på nytt: {e}", flush=True)
    for r, sett in satt_med_put:
        status = vurder_egenskaper(per_id.get(r["fc_id"]), sett)
        r["egenskaper"] = "lagret med PUT" if status == "lagret" else status
        if status == "ikke lagret":
            r["merknader"].append(
                "FrontCore lagret ikke kkurs_*-egenskapene. Legg dem inn i FrontCore-adminen, ellers "
                "bruker Worker-en reserveverdier (kat «annet», ingen koder/bilde)."
            )
        elif status == "ukjent":
            r["merknader"].append("GET /courses viser ikke custom_properties, så lagringen kan ikke bekreftes.")


def seed(fc, kursliste, idag, location_id=None, oppdater=False, skjulte=()):
    print(f"FrontCore-seed mot {fc.api_url} · {len(kursliste)} kurs · i dag {idag.isoformat()}")
    skriv_skjulte(skjulte)
    print("Henter eksisterende kurs …", flush=True)
    try:
        kursliste_fc = fc.hent_alle("/courses")
    except FrontCoreFeil as e:
        raise SystemExit(f"Klarte ikke å hente eksisterende kurs, avbryter før noe opprettes: {e}")
    if location_id is not None:
        sjekk_lokale(fc, location_id)
    else:
        print("Uten lokale (--uten-lokale): datoene får ukjent kapasitet (ledige: null) og vises som åpne "
              "på nettsiden.", flush=True)
    per_ref = {}
    for obj in kursliste_fc:
        per_ref.setdefault(referanse(obj), obj)
    per_ref.pop("", None)
    print(f"Fant {len(kursliste_fc)} kurs i FrontCore, {len(per_ref)} med reference.", flush=True)

    resultater = []
    for k in kursliste:
        r = nytt_resultat(k)
        resultater.append(r)
        try:
            fc_id, nyopprettet = sikre_kurs(fc, k, per_ref, kursliste_fc, oppdater, r)
        except FrontCoreFeil as e:
            r["kurs"] = ("feilet", None, str(e))
            r["egenskaper"] = "–"
            for dt in k.get("datoer") or []:
                r["datoer"].append(dato_rad(dt if isinstance(dt, dict) else {"d": str(dt)},
                                            "hoppet over", detalj="kurset feilet"))
            print(f"  {k['id']}: kurs feilet — {e}", flush=True)
            continue
        r["fc_id"] = fc_id
        sikre_datoer(fc, k, fc_id, idag, location_id, nyopprettet, r)

    sikre_egenskaper(fc, {k["id"]: k for k in kursliste}, resultater, oppdater)
    print()
    skriv_oppsummering(resultater, fc.antall_kall)
    return sluttkode(resultater)


# ---------------------------------------------------------------- oppsummering

def har_feil(resultater):
    return any(
        (r["kurs"] and r["kurs"][0] == "feilet") or r["egenskaper"] == "feilet"
        or any(d["status"] == "feilet" for d in r["datoer"])
        for r in resultater
    )


def sluttkode(resultater):
    """2 = et kurs mangler i GET-listen (fare for duplikat ved ny kjøring), 1 = noe feilet, 0 = ok."""
    if any(r.get("ikke_i_listen") for r in resultater):
        return 2
    return 1 if har_feil(resultater) else 0


def med_id(status, fc_id):
    return f"{status} ({fc_id})" if fc_id is not None else status


def telling(verdier):
    antall = {}
    for v in verdier:
        antall[v] = antall.get(v, 0) + 1
    return ", ".join(f"{n} {s}" for s, n in antall.items()) or "ingen"


def skriv_oppsummering(resultater, antall_kall=None):
    print("Oppsummering (FrontCore-id i parentes)")
    for r in resultater:
        status, fc_id, detalj = r["kurs"] or ("ikke behandlet", None, "")
        print(f"  {r['id']:<16} kurs  {med_id(status, fc_id)} · egenskaper: {r['egenskaper'] or '–'}")
        if detalj:
            print(f"    {'Feil' if status == 'feilet' else 'Merk'}: {detalj}")
        for d in r["datoer"]:
            tekst = f"    {d['d']:<12} {d['sted']:<10} {med_id(d['status'], d['fc_id'])}"
            print(tekst + (f" — {d['detalj']}" if d["detalj"] else ""))
        for merknad in r["merknader"]:
            print(f"    NB: {merknad}")
    kurs = telling(r["kurs"][0] for r in resultater if r["kurs"])
    datoer = telling(d["status"] for r in resultater for d in r["datoer"])
    slutt = f"Totalt — kurs: {kurs} · datoer: {datoer}"
    if antall_kall is not None:
        slutt += f" · {antall_kall} API-kall"
    print(slutt)
    borte = [r["id"] for r in resultater if r.get("ikke_i_listen")]
    if borte:
        print(f"ADVARSEL: {', '.join(borte)} vises ikke i GET /v2/courses. Sjekk dem i FrontCore før neste "
              "kjøring, ellers kan de bli opprettet på nytt (avslutningskode 2).")


# ---------------------------------------------------------------- selvtest

class Attrapp:
    """FrontCore i minnet for selvtesten — samme grensesnitt som FrontCore (kall/hent_alle)."""

    def __init__(self, kurs=(), datoer=None, lokaler=(), skjul_inaktive=True, lagrer_cp_ved_post=True):
        self.api_url = "attrapp"
        self.antall_kall = 0
        self.kurs = {k["id"]: dict(k) for k in kurs}
        self.datoer = {kid: [dict(d) for d in liste] for kid, liste in (datoer or {}).items()}
        self.lokaler = list(lokaler)
        self.skjul_inaktive = skjul_inaktive
        self.lagrer_cp_ved_post = lagrer_cp_ved_post
        self.logg = []
        self.neste = 1000

    def _vis(self, k):
        vist = dict(k)
        vist["custom_properties"] = dict(k.get("custom_properties") or {}) or []  # PHP: tomt objekt → []
        return vist

    def hent_alle(self, sti, params=None):
        return pakk_ut_liste(self.kall("GET", sti, params))[0]

    def kall(self, metode, sti, params=None, body=None):
        self.antall_kall += 1
        self.logg.append((metode, sti, json.loads(json.dumps(body)) if body is not None else None))
        deler = sti.strip("/").split("/")
        if (metode, sti) == ("GET", "/courses"):
            return [self._vis(k) for k in self.kurs.values() if k.get("active", True) or not self.skjul_inaktive]
        if (metode, sti) == ("GET", "/locations"):
            return self.lokaler
        if (metode, sti) == ("POST", "/courses"):
            self.neste += 1
            nytt = dict(body, id=self.neste)
            if not self.lagrer_cp_ved_post:
                nytt.pop("custom_properties", None)
            self.kurs[self.neste] = nytt
            return {"course_id": self.neste}
        if metode == "PUT" and len(deler) == 2 and deler[0] == "courses":
            kurs = self.kurs[int(deler[1])]
            for navn, verdi in body.items():
                kurs[navn] = dict(verdi) if navn == "custom_properties" else verdi  # erstatter hele objektet
            return {"course_id": kurs["id"]}
        if len(deler) == 3 and deler[0] == "courses" and deler[2] == "coursedates":
            kid = int(deler[1])
            if metode == "GET":
                return self.datoer.get(kid, [])
            self.neste += 1
            self.datoer.setdefault(kid, []).append(dict(body, coursedate_id=self.neste))
            return {"coursedate_id": self.neste, "course_id": kid}
        raise FrontCoreFeil(f"{metode} {sti}: ukjent i attrappen")


def selvtest():
    import contextlib
    import http.server
    import io
    import tempfile
    import threading

    feil, antall = [], 0

    def sjekk(navn, faktisk, forventet):
        nonlocal antall
        antall += 1
        if faktisk != forventet:
            feil.append(f"{navn}: fikk {faktisk!r}, ventet {forventet!r}")

    def stille(funksjon, *args, **kwargs):
        """Kjører funksjonen uten utskrift; gir (resultat eller unntak, utskrift)."""
        ut = io.StringIO()
        with contextlib.redirect_stdout(ut):
            try:
                svar = funksjon(*args, **kwargs)
            except (SystemExit, FrontCoreFeil) as e:
                svar = e
        return svar, ut.getvalue()

    # --- varighet og sluttdato (virkedager)
    for tekst, forventet in [
        ("3 dager", (3, DAG)), ("1 dag", (1, DAG)), ("3 dager + praksis", (3, DAG)),
        ("2 Dager", (2, DAG)), ("4 dager", (4, DAG)), ("3-dagers kurs", (3, DAG)),
        ("6 timer", (6, TIME)), ("2 uker", (2, UKE)),
        (None, None), ("", None), ("etter avtale", None), ("1,5 dag", None), ("0 dager", None),
        ("99999 dager", None), (3, None),
    ]:
        sjekk(f"tolk_varighet({tekst!r})", tolk_varighet(tekst), forventet)

    d = date.fromisoformat
    for start, varighet, forventet in [
        ("2026-10-27", "3 dager", "2026-10-29"),   # tir → tor
        ("2026-10-27", "1 dag", "2026-10-27"),
        ("2026-10-27", "3 dager + praksis", "2026-10-29"),
        ("2026-10-27", None, "2026-10-27"),
        ("2026-10-27", "6 timer", "2026-10-27"),
        ("2026-11-05", "3 dager", "2026-11-09"),   # tor → man (fre, man)
        ("2026-10-30", "3 dager", "2026-11-03"),   # fre → tir
        ("2026-11-03", "4 dager", "2026-11-06"),   # tir → fre
        ("2026-10-31", "2 dager", "2026-11-02"),   # lør → man
        ("2026-12-31", "2 dager", "2027-01-01"),
        ("2028-02-28", "2 dager", "2028-02-29"),
        ("2026-11-02", "1 uke", "2026-11-06"),     # man → fre
        ("2026-10-28", "2 uker", "2026-11-10"),    # 10 virkedager
        ("2026-10-27", "etter avtale", "2026-10-27"),
    ]:
        sjekk(f"sluttdato({start}, {varighet!r})", sluttdato(d(start), varighet), d(forventet))
    sjekk("over_helg tir–tor", over_helg(d("2026-10-27"), d("2026-10-29")), False)
    sjekk("over_helg tor–man", over_helg(d("2026-11-05"), d("2026-11-09")), True)
    sjekk("helgemerknad tor + 3 dager", helgemerknad({"varighet": "3 dager"}, d("2026-11-05")),
          "går over helg — sluttdato mandag 2026-11-09 (helgen er ikke kursdager)")
    sjekk("helgemerknad start lørdag", helgemerknad({"varighet": "1 dag"}, d("2026-10-31")),
          "starter en lørdag — sjekk datoen")
    sjekk("helgemerknad ingen", helgemerknad({"varighet": "2 dager"}, d("2026-10-27")), "")

    # --- pris
    for verdi, forventet in [
        (6900, 6900), ("6 900", 6900), ("kr 6 900,-", 6900), ("6.900", 6900), ("6 900", 6900),
        ("6900 kr", 6900), ("NOK 12900", 12900), (6900.0, 6900), (None, None), ("", None), (0, None),
        ("0", None), ("fra 6900", None), ("6900.50", None), (6900.5, None), (True, None), (-5, None),
        ([6900], None), ("pris på forespørsel", None),
    ]:
        sjekk(f"tolk_pris({verdi!r})", tolk_pris(verdi)[0], forventet)
    sjekk("pris: merknad ved tekst", tolk_pris("fra 6900")[1] is not None, True)
    sjekk("pris: ingen merknad ved «6 900»", tolk_pris("6 900")[1], None)
    sjekk("pris: ingen merknad når den mangler", tolk_pris(None)[1], None)
    sjekk("kurs_payload krasjer ikke på rar pris", "price_value" in kurs_payload({"id": "x", "navn": "X", "pris": "ca. 7000"}), False)
    sjekk("kurs_payload tolker «6 900»", kurs_payload({"id": "x", "navn": "X", "pris": "6 900"}).get("price_value"), 6900)

    # --- merknader om kurs.json
    sjekk("merknad: varighet kan ikke tolkes", len(kurs_merknader({"varighet": "etter avtale"})), 1)
    sjekk("merknad: varighet i måneder", len(kurs_merknader({"varighet": "3 måneder"})), 1)
    sjekk("merknad: varighet ok", kurs_merknader({"varighet": "3 dager + praksis", "pris": 6900}), [])
    sjekk("merknad: varighet mangler", kurs_merknader({"varighet": None}), [])
    sjekk("merknad: pris + varighet", len(kurs_merknader({"varighet": "kveldskurs", "pris": "gratis?"})), 2)

    # --- datoer og payload
    kurs = {"id": "hms-leder", "navn": "HMS-kurs for ledere", "varighet": "1 dag", "kat": "hms",
            "koder": "AML § 3-5", "pris": 3900, "desc": "Lovpålagt HMS-opplæring.",
            "datoer": [{"d": "2026-09-24"}, {"d": "2026-09-25"}, {"d": "2026-11-19"}, {"d": "19.11.2026"}]}
    digital = dato_payload(kurs, {"d": "2026-11-19", "sted": "Digitalt"}, 7)
    sjekk("digitalt: ingen place_by_search", "place_by_search" in digital, False)
    sjekk("digitalt: place_additional_info", digital.get("place_additional_info"), "Digitalt")
    sjekk("digitalt: ingen location_id", "location_id" in digital, False)
    sjekk("dato: reference", digital["reference"], "hms-leder-2026-11-19")
    fysisk = dato_payload(kurs, {"d": "2026-10-01", "sted": "Bergen", "merk": "på engelsk"}, 7)
    sjekk("fysisk: place_by_search", fysisk.get("place_by_search"), "Bergen")
    sjekk("fysisk: location_id", fysisk.get("location_id"), 7)
    sjekk("fysisk: merk", fysisk.get("custom_properties"), {"kkurs_merk": "på engelsk"})
    sjekk("fysisk: tider og status", (fysisk["start_time_at"], fysisk["end_time_at"], fysisk["status_id"]),
          ("08:00", "15:30", 2))
    uten_sted = dato_payload(kurs, {"d": "2026-10-01"})
    sjekk("uten sted/lokale", [f for f in ("place_by_search", "place_additional_info", "location_id") if f in uten_sted], [])
    tredagers = dato_payload({"id": "kran-g8", "varighet": "3 dager"}, {"d": "2026-11-05", "sted": "Bergen"})
    sjekk("dato: sluttdato i virkedager", (tredagers["start_at"], tredagers["end_at"]), ("2026-11-05", "2026-11-09"))

    kommende, passerte, ugyldige = del_datoer(kurs, d("2026-09-25"))
    sjekk("del_datoer: kommende", [s.isoformat() for _, s in kommende], ["2026-09-25", "2026-11-19"])
    sjekk("del_datoer: passerte", [s.isoformat() for _, s in passerte], ["2026-09-24"])
    sjekk("del_datoer: ugyldige", len(ugyldige), 1)

    kp = kurs_payload(kurs)
    sjekk("kurs: faste felt", (kp["active"], kp["reference"], kp["level"], kp["form_of_teaching"],
                               kp["teaching_language"], kp["price_currency"]), (True, "hms-leder", 6, 1, "no", "NOK"))
    sjekk("kurs: varighet", (kp["duration_value"], kp["duration_unit"]), (1, DAG))
    sjekk("kurs: pris", kp["price_value"], 3900)
    sjekk("kurs: custom_properties", kp["custom_properties"],
          {"kkurs_kat": "hms", "kkurs_koder": "AML § 3-5", "kkurs_varighet": "1 dag"})
    skjult = kurs_payload({"id": "arbeidsvarsling", "navn": "Arbeidsvarsling 1-2-3", "synlig": False})
    sjekk("skjult kurs: active", skjult["active"], False)
    sjekk("uten pris/varighet: utelatt", [f for f in ("price_value", "duration_value", "duration_unit") if f in skjult], [])

    # --- FrontCore-svar og custom_properties
    sjekk("liste: ren", pakk_ut_liste([{"id": 1}]), ([{"id": 1}], None))
    sjekk("liste: items+pagination", pakk_ut_liste({"items": [{"id": 1}], "pagination": {"next_page": None}}),
          ([{"id": 1}], 0))
    sjekk("liste: neste side", pakk_ut_liste({"items": [], "pagination": {"next_page": 2}})[1], 2)
    try:
        pakk_ut_liste({"noe": "annet"})
        sjekk("liste: ukjent format gir feil", "ingen feil", "FrontCoreFeil")
    except FrontCoreFeil:
        sjekk("liste: ukjent format gir feil", "FrontCoreFeil", "FrontCoreFeil")
    sjekk("kurs-id som tekst", fc_kurs_id({"id": "86273"}), 86273)
    sjekk("kurs-id fra POST-svar", fc_kurs_id({"course_id": 22357}), 22357)
    sjekk("dato-id", fc_dato_id({"coursedate_id": 12994400, "course_id": 22353}), 12994400)
    sjekk("manglende egenskaper", manglende_egenskaper({"custom_properties": {"kkurs_kat": "hms", "special_note": ""}},
                                                       {"kkurs_kat": "hms", "kkurs_koder": "X"}), {"kkurs_koder": "X"})
    sjekk("egenskaper ukjent", vurder_egenskaper({"id": 1}, {"kkurs_kat": "hms"}), "ukjent")
    sjekk("egenskaper [] fra PHP = ikke lagret", vurder_egenskaper({"custom_properties": []}, {"kkurs_kat": "hms"}),
          "ikke lagret")
    sjekk("egenskaper lagret", vurder_egenskaper({"custom_properties": {"kkurs_kat": "hms"}}, {"kkurs_kat": "hms"}),
          "lagret")
    onsket = {"kkurs_kat": "truck", "kkurs_koder": "T1–T4"}
    sjekk("PUT-sett: hele settet, lagret verdi beholdes",
          onsket_sett({"custom_properties": {"kkurs_kat": "kran"}}, onsket), {"kkurs_kat": "kran", "kkurs_koder": "T1–T4"})
    sjekk("PUT-sett: overskriv", onsket_sett({"custom_properties": {"kkurs_kat": "kran"}}, onsket, overskriv=True), onsket)
    sjekk("PUT-sett: [] gir alt", onsket_sett({"custom_properties": []}, onsket), onsket)
    sjekk("lokale på dato: mangler", lokalemerknad({"location": None}, 7).startswith("endres ikke — har ikke lokale"), True)
    sjekk("lokale på dato: riktig", lokalemerknad({"location": {"id": 7}}, 7), "")
    sjekk("lokale på dato: ukjent felt", lokalemerknad({"start_at": "2026-11-05"}, 7), "")

    # --- adresse til API-et
    for url, lov in [("https://api.frontcore.com/v2", True), ("http://127.0.0.1:8787/v2", True),
                     ("http://localhost:8787", True), ("http://api.frontcore.com/v2", False),
                     ("ftp://api.frontcore.com", False), ("https://", False), ("api.frontcore.com/v2", False),
                     ("https://bruker:pass@api.frontcore.com/v2", False)]:
        try:
            sjekk_api_url(url)
            sjekk(f"api-url {url}", True, lov)
        except SystemExit:
            sjekk(f"api-url {url}", False, lov)
    renser = FrontCore("nokkel-1234567890", "https://api.frontcore.com/v2")  # ingen kall
    sjekk("nøkkel renses før avkorting", "nokkel" in renser._kort("x" * 295 + "nokkel-1234567890"), False)
    sjekk("nøkkel renses i escapet form", "nokkel" in renser._kort(repr("nokkel-1234567890")), False)

    # --- kurs.json: skjulte kurs og --kun
    with tempfile.TemporaryDirectory() as mappe:
        kursfil = Path(mappe) / "kurs.json"
        kursfil.write_text(json.dumps({"kurs": [
            {"id": "a", "navn": "A"}, {"id": "b", "navn": "B", "synlig": False}]}), encoding="utf-8")
        liste, hoppet = les_kurs(kursfil=kursfil)
        sjekk("skjulte hoppes over som standard", ([k["id"] for k in liste], [k["id"] for k in hoppet]), (["a"], ["b"]))
        liste, hoppet = les_kurs(med_skjulte=True, kursfil=kursfil)
        sjekk("--med-skjulte tar dem med", ([k["id"] for k in liste], hoppet), (["a", "b"], []))
        try:
            les_kurs(kun="b", kursfil=kursfil)
            sjekk("--kun skjult uten --med-skjulte stopper", False, True)
        except SystemExit as e:
            sjekk("--kun skjult uten --med-skjulte stopper", "--med-skjulte" in str(e), True)

    # --- hindringer for ekte kjøring (leser aldri nøkkelen)
    def hindringer_for(argv):
        return hindringer(tolk_argumenter(argv))
    sjekk("ekte kjøring uten lokale og --ja", len(hindringer_for([])), 2)
    sjekk("ekte kjøring: lokale-melding", any("--uten-lokale" in m for m in hindringer_for(["--ja"])), True)
    sjekk("ekte kjøring: --ja-melding", any("Kursguiden.no" in m for m in hindringer_for(["--location-id", "7"])), True)
    sjekk("ekte kjøring: alt på plass", hindringer_for(["--location-id", "7", "--ja"]), [])
    sjekk("ekte kjøring: bevisst uten lokale", hindringer_for(["--uten-lokale", "--ja"]), [])
    sjekk("tørrkjøring trenger ingenting", hindringer_for(["--dry-run"]), [])

    # --- flyt mot attrapp
    truck = {"id": "truck", "navn": "Truckførerkurs", "varighet": "3 dager", "kat": "truck", "koder": "T1–T4",
             "pris": "6 900", "datoer": [{"d": "2026-09-24", "sted": "Bergen"}, {"d": "2026-11-05", "sted": "Bergen"}]}
    gjemt = {"id": "gjemt", "navn": "Gjemt kurs", "synlig": False, "kat": "annet"}
    idag = d("2026-09-25")
    lokaler = [{"id": 7, "title": "Kurssenter Bergen", "capacity_max": 12}]

    fc = Attrapp(lokaler=lokaler, lagrer_cp_ved_post=False)
    kode, ut = stille(seed, fc, [truck, gjemt], idag, location_id=7)
    sjekk("attrapp: inaktivt nytt kurs usynlig i listen → kode 2", kode, 2)
    sjekk("attrapp: advarsel i oppsummeringen", "ADVARSEL: gjemt vises ikke" in ut, True)
    nytt = next(k for k in fc.kurs.values() if k["reference"] == "truck")
    sjekk("attrapp: pris «6 900» sendt som 6900", nytt.get("price_value"), 6900)
    sjekk("attrapp: kkurs_* satt med hele settet", nytt.get("custom_properties"), egenskaper(truck))
    sjekk("attrapp: «lagret med PUT»", "egenskaper: lagret med PUT" in ut, True)
    dato = fc.datoer[nytt["id"]][0]
    sjekk("attrapp: dato med lokale og virkedager", (dato["start_at"], dato["end_at"], dato["location_id"]),
          ("2026-11-05", "2026-11-09", 7))
    sjekk("attrapp: passert dato ikke sendt", len(fc.datoer[nytt["id"]]), 1)

    fc = Attrapp(kurs=[{"id": 500, "title": "Truckførerkurs", "reference": "truck", "active": True,
                        "custom_properties": {"kkurs_kat": "kran"}}],
                 datoer={500: [{"coursedate_id": 900, "start_at": "2026-11-05", "reference": None, "location": None}]},
                 lokaler=lokaler)
    kode, ut = stille(seed, fc, [truck], idag, location_id=7)
    sjekk("attrapp: eksisterende kurs → kode 0", kode, 0)
    puts = [body for metode, sti, body in fc.logg if metode == "PUT"]
    sjekk("attrapp: PUT sender hele settet og beholder lagret verdi", puts,
          [{"custom_properties": dict(egenskaper(truck), kkurs_kat="kran")}])
    sjekk("attrapp: eksisterende dato endres ikke", [m for m, s, b in fc.logg if m == "POST"], [])
    sjekk("attrapp: dato uten lokale merkes", "endres ikke — har ikke lokale; sett lokale 7" in ut, True)

    fc = Attrapp(lokaler=lokaler)
    kode, _ = stille(seed, fc, [truck], idag, location_id=8)
    sjekk("attrapp: ukjent lokale stopper", isinstance(kode, SystemExit) and "Fant ikke lokale 8" in str(kode), True)
    sjekk("attrapp: ingenting skrevet ved ukjent lokale", [m for m, s, b in fc.logg if m != "GET"], [])

    fc = Attrapp(lokaler=[{"id": 7, "title": "Uten kapasitet", "capacity_max": 0}])
    kode, ut = stille(seed, fc, [truck], idag, location_id=7)
    sjekk("attrapp: lokale uten kapasitet gir advarsel", (kode, "ledige: null" in ut), (0, True))

    kode, ut = stille(torrkjoring, [truck, {"id": "rar", "navn": "Rar", "varighet": "etter avtale", "pris": "ca. 5000"}],
                      idag, None)
    sjekk("tørrkjøring: kode 0 og merknader", (kode, "kunne ikke tolkes" in ut, "ikke et heltall" in ut), (0, True, True))

    # --- HTTP: ingen omdirigering, ugyldige svar, nøkkelen lekker ikke
    besok = []

    class Behandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            besok.append(self.path)
            if self.path.startswith("/v2/omdiriger"):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/fanget")
                self.send_header("Content-Length", "0")
                self.end_headers()
            elif self.path.startswith("/v2/tull"):
                self.wfile.write(b"TULL\r\n\r\n")
                self.close_connection = True
            elif self.path.startswith("/v2/avbrutt"):
                self.wfile.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                                 b"Content-Length: 100\r\nConnection: close\r\n\r\n{\"a\":")
                self.close_connection = True
            else:
                data = b'{"ok": true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

    try:
        tjener = http.server.HTTPServer(("127.0.0.1", 0), Behandler)
    except OSError as e:
        tjener = None
        feil.append(f"kunne ikke starte lokal testtjener: {e}")
    if tjener is not None:
        threading.Thread(target=tjener.serve_forever, daemon=True).start()
        try:
            adresse = f"http://127.0.0.1:{tjener.server_port}/v2"
            fc = FrontCore("test-123", adresse, pause=0)
            sjekk("http: vanlig svar", fc.kall("GET", "/ok"), {"ok": True})
            for sti, forventet in [("/omdiriger", "omdirigering"), ("/tull", "ugyldig HTTP-svar"),
                                   ("/avbrutt", "ugyldig HTTP-svar")]:
                try:
                    fc.kall("GET", sti)
                    fikk = "ingen feil"
                except FrontCoreFeil as e:
                    fikk = forventet if forventet in str(e) else str(e)
                sjekk(f"http: {sti} gir FrontCoreFeil", fikk, forventet)
            sjekk("http: omdirigering følges ikke", [s for s in besok if s.startswith("/fanget")], [])
            try:
                FrontCore("abc\nhemmelig-verdi", adresse, pause=0).kall("GET", "/ok")
                fikk = "ingen feil"
            except FrontCoreFeil as e:
                fikk = "hemmelig" in str(e)
            sjekk("http: ugyldig nøkkel gir FrontCoreFeil uten nøkkelen", fikk, False)
        finally:
            tjener.shutdown()
            tjener.server_close()

    # --- nøkkel
    with tempfile.TemporaryDirectory() as mappe:
        fil = Path(mappe) / ".dev.vars"
        fil.write_text('# kommentar\nANNET=x\nFRONTCORE_API_KEY="test-123"\n', encoding="utf-8")
        sjekk("nøkkel fra .dev.vars", les_nokkel(fil, miljo={}) == "test-123", True)
        sjekk("miljøvariabel går foran", les_nokkel(fil, miljo={"FRONTCORE_API_KEY": "fra-miljo"}) == "fra-miljo", True)
        for navn, innhold in [("plassholder", f"FRONTCORE_API_KEY={PLASSHOLDER}\n"), ("tom", "FRONTCORE_API_KEY=\n"),
                              ("med mellomrom", "FRONTCORE_API_KEY=abc def\n")]:
            fil.write_text(innhold, encoding="utf-8")
            try:
                les_nokkel(fil, miljo={})
                sjekk(f"nøkkel {navn} avvises", False, True)
            except SystemExit:
                sjekk(f"nøkkel {navn} avvises", True, True)
        try:
            les_nokkel(Path(mappe) / "finnes-ikke", miljo={})
            sjekk("manglende fil avvises", False, True)
        except SystemExit as e:
            sjekk("manglende fil avvises", "Mangler FrontCore-nøkkel" in str(e), True)

    if feil:
        print(f"Selvtest FEILET: {len(feil)} av {antall} sjekker")
        for linje in feil:
            print("  " + linje)
        return 1
    print(f"Selvtest OK: {antall} av {antall} sjekker")
    return 0


# ---------------------------------------------------------------- start

def positivt_heltall(tekst):
    try:
        tall = int(tekst)
    except ValueError:
        tall = 0
    if tall <= 0:
        raise argparse.ArgumentTypeError(f"må være et positivt heltall (fikk «{tekst}»)")
    return tall


def tolk_argumenter(argv):
    p = argparse.ArgumentParser(
        description="Fyller en FrontCore-konto med kursene og kommende datoer fra assets/kurs.json.")
    p.add_argument("--dry-run", action="store_true",
                   help="vis hva som ville blitt sendt, uten nettverkskall og uten nøkkel")
    p.add_argument("--ja", action="store_true",
                   help="bekreft ekte kjøring (kurs kan bli synlige på Kursguiden.no og bookbare)")
    lokale = p.add_mutually_exclusive_group()
    lokale.add_argument("--location-id", type=positivt_heltall, metavar="N",
                        help="FrontCore-lokale (venue) for nye datoer — plassene kommer fra lokalets kapasitet")
    lokale.add_argument("--uten-lokale", action="store_true",
                        help="opprett datoer uten lokale: ukjent kapasitet (ledige: null), åpne på nettsiden")
    p.add_argument("--kun", metavar="ID", help="bare kurset med denne id-en i kurs.json")
    p.add_argument("--oppdater", action="store_true",
                   help="oppdater kurs som finnes (PUT) med verdiene fra kurs.json")
    p.add_argument("--med-skjulte", action="store_true",
                   help='ta også med kurs med "synlig": false (opprettes som inaktive)')
    p.add_argument("--selvtest", action="store_true", help="kjør innebygde tester og avslutt")
    return p.parse_args(argv)


def hindringer(args):
    """Det som mangler før en ekte kjøring kan skrive til FrontCore (tom liste = klart)."""
    if args.dry_run or args.selvtest:
        return []
    meldinger = []
    if args.location_id is None and not args.uten_lokale:
        meldinger.append(
            "Mangler --location-id. Antall plasser per kursdato kommer fra kapasiteten til lokalet datoen\n"
            "knyttes til (FrontCore: Settings → Venues) — API-et har ikke eget felt for plasser. Uten lokale\n"
            "får datoene ukjent kapasitet (ledige: null), og nettsiden viser dem som åpne uten grense.\n"
            "Eksisterende datoer endres ikke ved en ny kjøring, så lokalet må da settes for hånd i FrontCore.\n"
            "  Med lokale:  python3 tools/frontcore_seed.py --location-id N --ja\n"
            "  Uten lokale: python3 tools/frontcore_seed.py --uten-lokale --ja"
        )
    if not args.ja:
        meldinger.append(
            "Ekte kjøring skriver til FrontCore-kontoen: aktive kurs kan bli synlige på Kursguiden.no og\n"
            "bookbare for kunder. Se over med --dry-run først, og legg til --ja for å bekrefte."
        )
    return meldinger


def main(argv=None):
    args = tolk_argumenter(argv)
    if args.selvtest:
        return selvtest()
    api_url = sjekk_api_url(API_URL)
    kursliste, skjulte = les_kurs(args.kun, args.med_skjulte)
    idag = date.today()
    if args.dry_run:
        return torrkjoring(kursliste, idag, args.location_id, skjulte, api_url)
    stopp = hindringer(args)
    if stopp:
        raise SystemExit("\n\n".join(stopp))
    fc = FrontCore(les_nokkel(), api_url)
    return seed(fc, kursliste, idag, args.location_id, args.oppdater, skjulte)


if __name__ == "__main__":
    sys.exit(main())
