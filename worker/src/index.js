// kkurs-api — Cloudflare Worker mellom kkurs.no og FrontCore REST API v2.
// Kontrakten mot nettsiden er bindende og står i docs/FRONTCORE.md.
// API-nøkkelen er en secret (FRONTCORE_API_KEY) og skal aldri logges eller returneres.
//
// Antagelser om FrontCore-svarene — eksemplene i dokumentasjonen er ufullstendige
// (GET /v2/courses viser bare [], og eksempelet for datoer per kurs er ikke gyldig JSON):
//  - Lister kommer som ren liste eller som {items, pagination: {next_page}} (slik GET /v2/coursedates gjør).
//  - Id-er og tall kan komme som tekst («1», «0»). Kurs-id heter id eller course_id; dato-id coursedate_id eller id.
//  - Datostatus ligger i status_id (listeendepunktet) eller status.id (per kurs). 3 = avlyst, 4 = utsatt.
//  - Sted: place.title, ellers place.title_additional_info («Digitalt» fra frontcore_seed.py),
//    ellers lokalets poststed/by/navn, ellers Bergen (alle fysiske kurs holdes der i dag).
//  - Varighet: custom_properties.kkurs_varighet vinner (nettsidens egen tekst, f.eks. «3 dager + praksis»);
//    ellers course.duration som tekst eller {value, unit}, der unit kan være objekt, kode eller id,
//    eller duration_value/duration_unit på selve kurset.
//  - Plasser: seats_status «fully_booked» ⇒ 0 ledige (fullt ⇒ venteliste). Er det ikke satt kapasitet
//    på lokalet (allocated_capacity 0 og free 0 uten «fully_booked»), er antallet UKJENT ⇒
//    ledige/plasser = null. Ukjent betyr åpent: påmeldingen bekreftes (status_id 1) uten plassjekk.
//  - Sannhetsverdier (is_visible, is_virtual, is_active …) kan komme som true/1/"1"/"true" eller
//    false/0/"0"/"false"/null — se sann().
//  - Påmeldingsfrist: deadline_at før i dag ⇒ påmelding avvises alltid. Datoen vises bare videre
//    (med merk «påmeldingsfrist ute») når visible_when_passed_deadline er sann.
//  - Bedriftsinterne kurs (type/nivå/kunde tyder på det) og underdatoer (parent_id) vises ikke.

const FC_URL = "https://api.frontcore.com/v2";
const SIDESTORRELSE = 250;
const MAKS_SIDER = 10;
const MELLOMLAGER_SEK = 120;
const RESERVE_SEK = 24 * 60 * 60;
const NETTLESER_SEK = 60;
const MAKS_BYTE = 20 * 1024;
const MAKS_DELTAKERE = 20;
const STATUS_AVLYST = 3;
const STATUS_UTSATT = 4;
const DELTAKER_BEKREFTET = 1;
const DELTAKER_VENTELISTE = 3;
const STANDARD_STED = "Bergen";
const MERK_FRIST_UTE = "påmeldingsfrist ute";
// v2: oppføringene bærer tidsstempelet (TID_HEADER) fra da svaret ble hentet fra FrontCore.
const CACHE_NOKKEL = "https://kkurs-api.mellomlager/kurs/v2";
const RESERVE_NOKKEL = "https://kkurs-api.mellomlager/kurs/v2/reserve";
const TID_HEADER = "X-Kkurs-Tid";

export const KATEGORIER = {
  truck: "Truck og maskin",
  kran: "Kran og løft",
  hms: "HMS og ledelse",
  annet: "Andre kurs",
};

// ---------------------------------------------------------------- små hjelpere

export function tall(verdi) {
  if (typeof verdi === "number") return Number.isFinite(verdi) ? verdi : null;
  if (typeof verdi === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(verdi)) return Number(verdi);
  return null;
}

// Felles tolkning av FrontCores sannhetsverdier: true/1/"1"/"true" er sant, false/0/"0"/"false"/null
// er usant (store/små bokstaver og mellomrom spiller ingen rolle). Mangler feltet (undefined), eller
// er verdien noe annet, gis `standard`.
export function sann(verdi, standard = false) {
  if (verdi === true || verdi === 1) return true;
  if (verdi === false || verdi === 0 || verdi === null) return false;
  if (typeof verdi === "string") {
    const t = verdi.trim().toLowerCase();
    if (t === "1" || t === "true") return true;
    if (t === "0" || t === "false") return false;
  }
  return standard;
}

const ENTITETER ={ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å" };

// Ren tekst ut: HTML-tagger fjernes og entiteter dekodes. Til slutt fjernes < og >, og " og ' byttes
// med ” og ’. Nettsiden setter teksten rett inn i HTML — også i attributtverdier (title="…", alt="…") —
// så data fra FrontCore skal aldri kunne åpne en tagg eller bryte ut av et attributt.
export function renTekst(verdi, maks = 300) {
  if (typeof verdi !== "string" && typeof verdi !== "number") return "";
  let t = String(verdi)
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h\d)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (hel, e) => {
      if (e[0] === "#") {
        const kode = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return kode > 0 && kode < 0x110000 ? String.fromCodePoint(kode) : "";
      }
      return ENTITETER[e] ?? hel;
    })
    .replace(/[<>]/g, "")
    .replace(/"/g, "”")
    .replace(/'/g, "’")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > maks) {
    let kutt = t.slice(0, maks - 1);
    if (!/\s/.test(t[maks - 1])) kutt = kutt.replace(/\s+\S*$/, "");
    t = `${kutt.trimEnd()}…`;
  }
  return t;
}

export function slug(tekst) {
  return String(tekst ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// course.reference brukes som adresse (kurs/<reference>/) når den allerede er en gyldig slug.
function referanse(kurs) {
  const ref = typeof kurs?.reference === "string" ? kurs.reference.trim() : String(kurs?.reference ?? "");
  return SLUG.test(ref) ? ref : null;
}

export function kursSlug(kurs, fcId) {
  return referanse(kurs) ?? (slug(kurs?.title ?? kurs?.name) || `kurs-${fcId}`);
}

// Gir hvert kurs en unik id. To runder: først reserveres alle gyldige referanser (laveste fc_id vinner
// ved duplikat), så deles tittel-slugs ut til resten. Da kan en tittel-slug aldri ta en adresse som et
// annet kurs har fått satt eksplisitt. Kollisjon ⇒ «-<fc_id>» (og i verste fall et løpenummer i tillegg).
function tildelIder(kursliste) {
  const brukt = new Set();
  const ider = new Map();
  for (const [fcId, k] of kursliste) {
    const ref = referanse(k);
    if (ref && !brukt.has(ref)) {
      brukt.add(ref);
      ider.set(fcId, ref);
    }
  }
  for (const [fcId, k] of kursliste) {
    if (ider.has(fcId)) continue;
    const onsket = kursSlug(k, fcId);
    let id = brukt.has(onsket) ? `${onsket}-${fcId}` : onsket;
    for (let n = 2; brukt.has(id); n++) id = `${onsket}-${fcId}-${n}`;
    brukt.add(id);
    ider.set(fcId, id);
  }
  return ider;
}

export function datoIOslo(naa = new Date()) {
  try {
    const deler = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(naa);
    const del = (type) => deler.find((d) => d.type === type)?.value;
    return `${del("year")}-${del("month")}-${del("day")}`;
  } catch {
    return naa.toISOString().slice(0, 10);
  }
}

function isoDag(verdi) {
  return typeof verdi === "string" ? (/^(\d{4}-\d{2}-\d{2})/.exec(verdi.trim())?.[1] ?? null) : null;
}

// Påmeldingsfristen gjelder hele fristdagen; den er ute først når deadline_at er før i dag.
function fristErUte(dato, idag) {
  const frist = isoDag(dato?.deadline_at);
  return frist !== null && frist < idag;
}

function statusId(dato) {
  return tall(dato?.status_id ?? dato?.status?.id);
}

function objekt(verdi) {
  return verdi && typeof verdi === "object" && !Array.isArray(verdi) ? verdi : null;
}

// ---------------------------------------------------------------- mapping av GET /kurs

function kursId(kurs) {
  return tall(kurs?.id ?? kurs?.course_id);
}

// Kurset fra /courses vinner; feltene det mangler fylles fra kurset som fulgte med datoen.
function slaSammen(primar, sekundar) {
  if (!primar) return sekundar;
  const ut = { ...sekundar };
  for (const [n, v] of Object.entries(primar)) if (v !== null && v !== undefined) ut[n] = v;
  ut.custom_properties = { ...objekt(sekundar?.custom_properties), ...objekt(primar.custom_properties) };
  return ut;
}

const IKKE_OFFENTLIG = new Set(["internal", "intern", "corporate", "customer", "private", "closed", "bedrift", "bedriftsintern"]);

function erOffentlig(kurs) {
  const ord = String(kurs?.type ?? "").toLowerCase().split(/[^a-z]+/);
  if (ord.some((o) => IKKE_OFFENTLIG.has(o))) return false;
  if (tall(objekt(kurs?.level)?.id ?? kurs?.level) === 15) return false; // 15 = Corporate training
  const kunde = kurs?.customer_id ?? objekt(kurs?.customer)?.id;
  return kunde === null || kunde === undefined || tall(kunde) === 0;
}

function erAktiv(kurs) {
  return sann(kurs?.is_active !== undefined ? kurs.is_active : kurs?.active, true);
}

const ENHETER = {
  7: ["minutt", "minutter"], 6: ["time", "timer"], 1: ["dag", "dager"], 2: ["uke", "uker"],
  3: ["måned", "måneder"], 4: ["semester", "semester"], 5: ["år", "år"],
};
const ENHETSKODER = {
  minute: 7, minutes: 7, hour: 6, hours: 6, day: 1, days: 1, week: 2, weeks: 2,
  month: 3, months: 3, semester: 4, year: 5, years: 5,
};

function enhetId(enhet) {
  if (objekt(enhet)) return tall(enhet.id) ?? ENHETSKODER[String(enhet.code ?? "").toLowerCase()] ?? null;
  return tall(enhet) ?? ENHETSKODER[String(enhet ?? "").toLowerCase()] ?? null;
}

export function formaterVarighet(verdi, enhet) {
  const n = tall(verdi);
  if (n === null || n <= 0) return null;
  const navn = ENHETER[enhetId(enhet)];
  let ord = navn ? navn[n === 1 ? 0 : 1] : "";
  if (!ord && objekt(enhet)) ord = renTekst(n === 1 ? enhet.title : (enhet.title_plural ?? enhet.title), 30).toLowerCase();
  return ord ? `${String(n).replace(".", ",")} ${ord}` : null;
}

function varighet(kurs) {
  const egen = renTekst(kurs?.custom_properties?.kkurs_varighet, 60);
  if (egen) return egen;
  const d = kurs?.duration;
  if (typeof d === "string") return renTekst(d, 60) || null;
  if (objekt(d)) {
    const tekst = formaterVarighet(d.value ?? d.duration_value ?? d.num ?? d.amount, d.unit ?? d.unit_id ?? d.duration_unit);
    if (tekst) return tekst;
  }
  return formaterVarighet(kurs?.duration_value ?? (typeof d === "number" ? d : null), kurs?.duration_unit);
}

function pris(kurs) {
  const p = kurs?.price;
  const verdi = tall(objekt(p) ? p.value : p) ?? tall(kurs?.price_value);
  return verdi !== null && verdi > 0 ? verdi : null;
}

function bilde(kurs) {
  const fil = typeof kurs?.custom_properties?.kkurs_bilde === "string" ? kurs.custom_properties.kkurs_bilde.trim() : "";
  return /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|avif|gif|svg)$/i.test(fil) ? fil : null;
}

function ingress(kurs) {
  const kilder = [kurs?.text_lead, kurs?.description?.text_lead, kurs?.descriptions?.text_lead, kurs?.lead];
  for (const k of kilder) {
    const t = renTekst(k, 600);
    if (t) return t;
  }
  return renTekst(kurs?.text_description ?? kurs?.description?.text_description, 300);
}

function kategori(kurs) {
  const kat = String(kurs?.custom_properties?.kkurs_kat ?? "").trim().toLowerCase();
  return Object.hasOwn(KATEGORIER, kat) ? kat : "annet";
}

function stedFraLokale(lokale) {
  const l = objekt(lokale);
  if (!l) return "";
  return renTekst(objekt(l.place)?.title, 60) || renTekst(l.city, 60) || renTekst(l.custom_title, 60) || renTekst(l.title, 60);
}

export function finnSted(dato) {
  if (sann(dato?.is_virtual)) return "Digitalt";
  const sted = objekt(dato?.place);
  return renTekst(sted?.title, 60)
    || renTekst(sted?.title_additional_info, 60)
    || stedFraLokale(dato?.location)
    || stedFraLokale(Array.isArray(dato?.gatherings) ? dato.gatherings[0]?.location : null)
    || STANDARD_STED;
}

export function beregnPlasser(dato) {
  const seter = objekt(dato?.seats) ?? {};
  const ledigeTall = tall(objekt(seter.free)?.num);
  const kapasitet = tall(objekt(seter.allocated_capacity)?.num);
  let ledige;
  if (String(dato?.seats_status ?? "").toLowerCase() === "fully_booked") ledige = 0;
  else if (ledigeTall !== null && ledigeTall > 0) ledige = Math.floor(ledigeTall);
  else if (ledigeTall !== null && ledigeTall < 0) ledige = 0;
  else if (kapasitet !== null && kapasitet > 0) ledige = 0;
  else return { ledige: null, plasser: null };
  const status = objekt(seter.booking_status) ?? {};
  const plasser = ledige + (tall(status.num_confirmed) ?? 0) + (tall(status.num_unconfirmed) ?? 0);
  return { ledige, plasser: plasser > 0 ? plasser : null };
}

function mapDato(dato, idag) {
  const fcId = tall(dato?.coursedate_id ?? dato?.id);
  if (fcId === null) return null;
  const status = statusId(dato);
  if (status === STATUS_AVLYST || !sann(dato.is_visible, true) || dato.deleted_at) return null;
  if (dato.parent_id !== null && dato.parent_id !== undefined && tall(dato.parent_id) !== 0) return null;
  const dag = isoDag(dato.start_at);
  if (!dag || dag < idag) return null;
  const fristUte = fristErUte(dato, idag);
  if (fristUte && !sann(dato.visible_when_passed_deadline)) return null;
  // ledige: null (ukjent kapasitet) sendes videre som null; nettsiden viser det som åpent.
  const { ledige, plasser } = beregnPlasser(dato);
  // «påmeldingsfrist ute» vinner over egen merknad, så nettsiden kan kjenne den igjen og stenge påmeldingen.
  const merk = fristUte
    ? MERK_FRIST_UTE
    : renTekst(dato.custom_properties?.kkurs_merk, 60) || (status === STATUS_UTSATT ? "utsatt" : null);
  return { d: dag, sted: finnSted(dato), fc_id: fcId, plasser, ledige, merk };
}

export function mapKurs(kursliste, datoliste, { idag = datoIOslo(), naa = new Date() } = {}) {
  const kursPerId = new Map();
  for (const k of Array.isArray(kursliste) ? kursliste : []) {
    const id = kursId(k);
    if (id !== null) kursPerId.set(id, k);
  }
  const datoerPerKurs = new Map();
  for (const d of Array.isArray(datoliste) ? datoliste : []) {
    const kid = tall(d?.course_id) ?? kursId(d?.course);
    if (kid === null) continue;
    if (objekt(d.course)) kursPerId.set(kid, slaSammen(kursPerId.get(kid), d.course));
    const dato = mapDato(d, idag);
    if (!dato) continue;
    if (!datoerPerKurs.has(kid)) datoerPerKurs.set(kid, []);
    datoerPerKurs.get(kid).push(dato);
  }

  // FrontCore-id følger opprettelsesrekkefølgen, som frontcore_seed.py henter fra kurs.json.
  const offentlige = [...kursPerId].filter(([, k]) => erOffentlig(k)).sort((a, b) => a[0] - b[0]);
  const ider = tildelIder(offentlige);
  const kurs = [];
  for (const [fcId, k] of offentlige) {
    const datoer = (datoerPerKurs.get(fcId) ?? []).sort((a, b) => a.d.localeCompare(b.d) || a.fc_id - b.fc_id);
    kurs.push({
      id: ider.get(fcId),
      fc_id: fcId,
      navn: renTekst(k.title ?? k.name, 120) || `Kurs ${fcId}`,
      koder: renTekst(k.custom_properties?.kkurs_koder, 40) || null,
      kat: kategori(k),
      varighet: varighet(k),
      pris: pris(k),
      bilde: bilde(k),
      desc: ingress(k),
      synlig: erAktiv(k),
      datoer,
    });
  }
  return {
    kilde: "frontcore",
    oppdatert: naa.toISOString().replace(/\.\d{3}Z$/, "Z"),
    kategorier: { ...KATEGORIER },
    kurs,
  };
}

// ---------------------------------------------------------------- påmelding

const EPOST = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)*\.[^\s@<>()[\]\\,;:".\d]{2,}$/u;

export function gyldigEpost(epost) {
  return typeof epost === "string" && epost.length <= 254 && EPOST.test(epost);
}

function felt(verdi) {
  return typeof verdi === "string" ? verdi.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

// Gir { robot: true }, { feil } eller { pamelding } (normalisert).
export function validerPamelding(data) {
  if (!objekt(data)) return { feil: "Ugyldig påmelding." };
  const felle = data.nettside;
  if (felle !== undefined && felle !== null && (typeof felle !== "string" || felle.trim() !== "")) return { robot: true };

  const coursedateId = tall(data.coursedate_id);
  if (coursedateId === null || coursedateId <= 0 || !Number.isInteger(coursedateId)) return { feil: "Velg en kursdato." };

  const kontakt = objekt(data.kontakt) ?? {};
  const navn = felt(kontakt.navn);
  const epost = felt(kontakt.epost).toLowerCase();
  const telefon = felt(kontakt.telefon);
  const bedrift = felt(data.bedrift);
  const orgnr = felt(data.orgnr).replace(/\s/g, "");
  if (!navn) return { feil: "Fyll inn navnet ditt." };
  if (!gyldigEpost(epost)) return { feil: "Skriv inn en gyldig e-postadresse." };
  if (navn.length > 200 || telefon.length > 40 || bedrift.length > 200 || orgnr.length > 30) {
    return { feil: "Et av feltene er for langt." };
  }

  if (!Array.isArray(data.deltakere) || data.deltakere.length < 1) return { feil: "Legg til minst én deltaker." };
  if (data.deltakere.length > MAKS_DELTAKERE) {
    return { feil: `Maks ${MAKS_DELTAKERE} deltakere per påmelding. Kontakt oss for større grupper.` };
  }
  const deltakere = [];
  for (const [i, d] of data.deltakere.entries()) {
    const fornavn = felt(d?.fornavn);
    const etternavn = felt(d?.etternavn);
    const dEpost = felt(d?.epost).toLowerCase();
    if (!fornavn || !etternavn) return { feil: `Fyll inn fornavn og etternavn for deltaker ${i + 1}.` };
    if (fornavn.length > 100 || etternavn.length > 100) return { feil: "Et av feltene er for langt." };
    if (dEpost && !gyldigEpost(dEpost)) return { feil: `E-postadressen til deltaker ${i + 1} ser ikke riktig ut.` };
    deltakere.push({ fornavn, etternavn, epost: dEpost });
  }

  return { pamelding: { coursedate_id: coursedateId, kontakt: { navn, epost, telefon }, bedrift, orgnr, deltakere } };
}

// Avgjør ut fra en fersk kursdato om påmeldingen kan sendes, og i så fall hvordan.
export function vurderPlass(dato, antall, idag = datoIOslo()) {
  if (statusId(dato) === STATUS_AVLYST) return { status: 409, feil: "Denne kursdatoen er avlyst. Velg en annen dato." };
  const dag = isoDag(dato?.start_at);
  const kurs = objekt(dato?.course);
  if (!sann(dato?.is_visible, true) || dato?.deleted_at || (dag && dag < idag) || (kurs && (!erAktiv(kurs) || !erOffentlig(kurs)))) {
    return { status: 409, feil: "Påmeldingen til denne datoen er stengt. Velg en annen dato." };
  }
  // Gjelder også når visible_when_passed_deadline er sann: datoen kan vises, men ikke bookes.
  if (fristErUte(dato, idag)) {
    return { status: 409, feil: "Påmeldingsfristen er ute. Velg en annen dato, eller kontakt oss." };
  }
  const { ledige } = beregnPlasser(dato);
  if (ledige === 0) return { venteliste: true, plassjekk: false };
  // Ukjent kapasitet (lokalet mangler kapasitet i FrontCore) behandles som åpent: bekreftet, uten plassjekk.
  if (ledige === null) return { venteliste: false, plassjekk: false };
  if (ledige < antall) {
    return {
      status: 409,
      feil: `Bare ${ledige} ${ledige === 1 ? "plass" : "plasser"} igjen på denne datoen. Velg færre deltakere eller en annen dato.`,
    };
  }
  return { venteliste: false, plassjekk: true };
}

export function lagBookingPayload(pamelding, { venteliste = false, plassjekk = true } = {}) {
  const { kontakt } = pamelding;
  const payload = {
    coursedate_id: pamelding.coursedate_id,
    payment_method: "invoice",
    currency: "nok",
    booker_name: kontakt.navn,
    booker_email: kontakt.epost,
  };
  if (kontakt.telefon) payload.booker_phone = kontakt.telefon;
  if (pamelding.bedrift) payload.company = pamelding.bedrift;
  if (pamelding.orgnr) payload.company_number = pamelding.orgnr;
  payload.invoice_email = kontakt.epost;
  payload.participants = pamelding.deltakere.map((d) => ({
    firstname: d.fornavn,
    lastname: d.etternavn,
    email: d.epost || kontakt.epost,
    status_id: venteliste ? DELTAKER_VENTELISTE : DELTAKER_BEKREFTET,
  }));
  payload.config = {
    reject_cancelled_course_date: true,
    seats_availability_check: !venteliste && plassjekk,
    send_receipt_email_to_participant: true,
    send_account_created_email_to_user: false,
  };
  return payload;
}

const IKKE_KLART = "Kurset er ikke ferdig satt opp for nettpåmelding ennå. Kontakt oss, så melder vi dere på.";
// Bare når FrontCore sikkert har avvist bestillingen (4xx eller kjent valideringsfeil).
const PROV_IGJEN = "Påmeldingen kunne ikke registreres akkurat nå. Prøv igjen om litt, eller kontakt oss.";
// Når ordren kan ha blitt opprettet likevel: aldri be om nytt forsøk, det kan gi dobbel påmelding.
export const USIKKER = "Vi er usikre på om påmeldingen ble registrert. Sjekk e-posten din (også søppelpost) før du prøver igjen, eller kontakt oss.";

const BOOKINGFEIL = {
  course_identifier_invalid: [404, "Fant ikke kursdatoen. Last siden på nytt og prøv igjen."],
  course_date_identifier_invalid: [404, "Fant ikke kursdatoen. Last siden på nytt og prøv igjen."],
  course_date_cancelled: [409, "Denne kursdatoen er avlyst. Velg en annen dato."],
  participant_name_invalid_empty: [400, "Alle deltakere må ha fornavn og etternavn."],
  participant_email_invalid_empty: [400, "Alle deltakere må ha e-postadresse."],
  participant_count_invalid: [400, "Legg til minst én deltaker."],
  campaign_code_invalid: [400, "Rabattkoden er ikke gyldig."],
  campaign_code_expired: [400, "Rabattkoden har utløpt."],
  voucher_code_invalid: [400, "Gavekortet er ikke gyldig."],
  voucher_code_expired: [400, "Gavekortet har utløpt."],
  default_course_product_missing: [502, IKKE_KLART],
  participant_products_empty: [502, IKKE_KLART],
  participant_products_invalid: [502, IKKE_KLART],
  participant_does_not_have_a_course_product: [502, IKKE_KLART],
  participant_have_multiple_course_products: [502, IKKE_KLART],
  participant_product_price_invalid: [502, IKKE_KLART],
  currency_missing: [502, IKKE_KLART],
  exchange_rate_does_not_exist: [502, IKKE_KLART],
  school_account_invalid: [502, "Påmeldingen er midlertidig utilgjengelig. Prøv igjen senere, eller kontakt oss."],
  // Interne feil midt i opprettelsen: ordren/bookingen kan finnes delvis i FrontCore.
  internal_course_order_not_resolvable: [502, USIKKER],
  internal_course_orderline_not_resolvable: [502, USIKKER],
  booking_could_not_be_created: [502, USIKKER],
  order_could_not_be_created: [502, USIKKER],
};

// Gir { status, feil } for en gjenkjent feilkode, ellers null.
export function oversettBookingFeil(kode, melding = "") {
  const kjent = Object.hasOwn(BOOKINGFEIL, kode) ? BOOKINGFEIL[kode] : null;
  if (kjent) return { status: kjent[0], feil: kjent[1] };
  // Koden for «ingen ledige plasser» (seats_availability_check) er ikke dokumentert.
  if (/seat|vacan|capacity|fully|no_free|plass/i.test(`${kode} ${melding}`)) {
    return { status: 409, feil: "Kurset ble fullt i mellomtiden. Last siden på nytt og velg en annen dato, eller meld dere på ventelisten." };
  }
  return null;
}

// Tolker svaret fra POST /v2/booking. Usikre utfall — 5xx, 2xx med et svar vi ikke kjenner igjen, eller
// feilkoder som kan bety at ordren er halvveis opprettet — gir USIKKER (usikker: true), aldri «prøv igjen».
export function tolkBookingSvar(httpStatus, data) {
  const ok2xx = httpStatus >= 200 && httpStatus < 300;
  const sammendrag = objekt(data?.summary);
  const vellykket = sann(objekt(data) ? data.successful : undefined, null);
  if (ok2xx && vellykket !== false && (vellykket === true || sammendrag?.order_id != null)) {
    const ordre = sammendrag?.order_id;
    return {
      ok: true,
      ordre_id: ordre === null || ordre === undefined || ordre === "" ? null : String(ordre),
      total_inkl_mva: tall(sammendrag?.total_incl_vat),
    };
  }
  const feilliste = Array.isArray(data?.errors) ? data.errors : objekt(data?.errors) ? Object.values(data.errors) : [];
  const forste = objekt(feilliste[0]) ?? {};
  const kode = String(forste.code ?? data?.code ?? "").trim();
  const melding = String(forste.message ?? data?.error ?? data?.message ?? (typeof feilliste[0] === "string" ? feilliste[0] : ""));
  const usikkert = { ok: false, usikker: true, kode, melding, status: 502, feil: USIKKER };
  // 5xx: FrontCore kan ha opprettet ordren før feilen oppstod, uansett hva svaret sier.
  if (httpStatus >= 500) return usikkert;
  const oversatt = oversettBookingFeil(kode, melding);
  if (oversatt) return { ok: false, usikker: oversatt.feil === USIKKER, kode, melding, ...oversatt };
  // 4xx uten kjent kode: forespørselen ble avvist, så ingenting er opprettet.
  if (httpStatus >= 400 && httpStatus < 500) return { ok: false, usikker: false, kode, melding, status: 502, feil: PROV_IGJEN };
  // 2xx (eller annet) uten gjenkjent suksess eller feilkode: vi vet ikke hva som skjedde.
  return usikkert;
}

// ---------------------------------------------------------------- FrontCore-klient

export class FrontCoreFeil extends Error {
  constructor(melding, status = null) {
    super(melding);
    this.name = "FrontCoreFeil";
    this.status = status;
  }
}

const vent = (ms) => new Promise((ferdig) => setTimeout(ferdig, ms));

function kort(tekst, maks = 300) {
  const t = String(tekst ?? "").replace(/\s+/g, " ").trim();
  return t.length > maks ? `${t.slice(0, maks)}…` : t;
}

function skjulNokkel(tekst, env) {
  const nokkel = env?.FRONTCORE_API_KEY;
  return nokkel ? String(tekst).split(nokkel).join("***") : String(tekst);
}

function loggFeil(env, hva, feil) {
  console.error(`[kkurs-api] ${hva}: ${skjulNokkel(feil?.message ?? feil, env)}`);
}

async function fc(env, sti, { metode = "GET", params = [], body, tidsavbrudd = 10000 } = {}) {
  const nokkel = env?.FRONTCORE_API_KEY;
  if (!nokkel) throw new FrontCoreFeil("FRONTCORE_API_KEY er ikke satt (npx wrangler secret put FRONTCORE_API_KEY)");
  const url = new URL(FC_URL + sti);
  for (const [navn, verdi] of params) url.searchParams.append(navn, String(verdi));
  const headers = { "X-API-Key": nokkel, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  for (let forsok = 1; ; forsok++) {
    let res;
    try {
      res = await fetch(url, {
        method: metode,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(tidsavbrudd),
      });
    } catch (e) {
      const hva = e?.name === "TimeoutError" || e?.name === "AbortError" ? "tidsavbrudd" : "nettverksfeil";
      throw new FrontCoreFeil(`${metode} ${sti}: ${hva} (${e?.message ?? e})`);
    }
    // FrontCore tillater 5 GET/s. POST prøves aldri på nytt — ordren kan være opprettet.
    if (metode === "GET" && (res.status === 429 || res.status === 503) && forsok < 3) {
      const sek = tall(res.headers.get("retry-after"));
      await vent(Math.min(sek !== null && sek > 0 ? sek * 1000 : 1000, 2000));
      continue;
    }
    const tekst = await res.text();
    let data = null;
    if (tekst) {
      try {
        data = JSON.parse(tekst);
      } catch {
        throw new FrontCoreFeil(`${metode} ${sti}: svaret var ikke JSON (HTTP ${res.status}): ${kort(tekst, 120)}`, res.status);
      }
    }
    return { status: res.status, data };
  }
}

async function hentJson(env, sti, params) {
  const { status, data } = await fc(env, sti, { params });
  const feiltekst = objekt(data) && (typeof data.error === "string" ? data.error : !sann(data.successful, true) ? JSON.stringify(data.errors ?? "") : null);
  if (status < 200 || status >= 300 || feiltekst) {
    throw new FrontCoreFeil(`GET ${sti}: HTTP ${status}${feiltekst ? `: ${kort(feiltekst)}` : ""}`, status);
  }
  return data;
}

export function pakkUtListe(data) {
  if (data === null || data === undefined) return { elementer: [], neste: 0 };
  if (Array.isArray(data)) return { elementer: data, neste: null };
  if (objekt(data)) {
    for (const navn of ["items", "data", "results", "courses", "coursedates"]) {
      if (Array.isArray(data[navn])) {
        const sider = objekt(data.pagination);
        const neste = sider && "next_page" in sider ? (tall(sider.next_page) ?? 0) : null;
        return { elementer: data[navn], neste };
      }
    }
  }
  throw new FrontCoreFeil(`ukjent listeformat fra FrontCore (felter: ${objekt(data) ? Object.keys(data).join(", ") : typeof data})`);
}

function elementNokkel(e) {
  for (const navn of ["coursedate_id", "id", "course_id"]) if (e?.[navn] != null) return `${navn}:${e[navn]}`;
  return JSON.stringify(e);
}

async function hentAlle(env, sti, params) {
  const alle = [];
  const sett = new Set();
  for (let side = 1; side <= MAKS_SIDER; side++) {
    const { elementer, neste } = pakkUtListe(await hentJson(env, sti, [...params, ["limit", SIDESTORRELSE], ["page", side]]));
    let nye = 0;
    for (const e of elementer) {
      const n = elementNokkel(e);
      if (!sett.has(n)) {
        sett.add(n);
        alle.push(e);
        nye++;
      }
    }
    if (nye === 0 || neste === 0 || (neste === null && elementer.length < SIDESTORRELSE)) return alle;
  }
  console.warn(`[kkurs-api] GET ${sti}: stoppet etter ${MAKS_SIDER} sider`);
  return alle;
}

async function hentKursdata(env) {
  const [kurs, datoer] = await Promise.all([
    hentAlle(env, "/courses", []),
    hentAlle(env, "/coursedates", [
      ["start_date_at_min", "now"],
      ["order_by", "startdate"],
      ["order_direction", "asc"],
      ["include[]", "course"],
      ["include[]", "location"],
      ["include[]", "place"],
    ]),
  ]);
  return mapKurs(kurs, datoer);
}

async function hentDato(env, coursedateId) {
  const data = await hentJson(env, "/coursedates", [["coursedate_id", coursedateId], ["include[]", "course"]]);
  if (objekt(data) && tall(data.coursedate_id) === coursedateId) return data;
  const { elementer } = pakkUtListe(data);
  return elementer.find((d) => tall(d?.coursedate_id ?? d?.id) === coursedateId) ?? null;
}

// ---------------------------------------------------------------- mellomlager

// To lag: isolatets minne og Cache API-et (delt i datasenteret, men kan være uten virkning på
// *.workers.dev). Alt lagres med `tid` = da svaret ble hentet fra FrontCore, så alderen alltid er riktig.
//  - Ferskt (≤ MELLOMLAGER_SEK): svares direkte.
//  - Reserve (≤ RESERVE_SEK): brukes bare når FrontCore feiler (stale-if-error), med X-Kkurs-Foreldet: 1.
// `minne` er sist gyldige svar i isolatet: { tid, tekst, gen }. `generasjon` økes når en påmelding
// har endret plassene, så svar hentet før det ikke lenger regnes som ferske (men kan fortsatt være reserve).
let minne = null;
let generasjon = 0;

// Etter en påmelding: neste GET /kurs skal hente ferske plasser. Reserven beholdes, med mindre
// reserve: true (tømmer alt — brukes i tester).
export function tomMellomlager(ctx, { reserve = false } = {}) {
  generasjon++;
  if (reserve) minne = null;
  if (typeof caches !== "undefined" && caches.default) {
    const nokler = reserve ? [CACHE_NOKKEL, RESERVE_NOKKEL] : [CACHE_NOKKEL];
    const sletting = Promise.all(nokler.map((n) => caches.default.delete(n).catch(() => {})));
    ctx?.waitUntil?.(sletting);
  }
}

const erFersk = (lagret, naa) => naa - lagret.tid < MELLOMLAGER_SEK * 1000;

async function lesCache(env, cache, nokkel) {
  try {
    const treff = await cache.match(nokkel);
    if (!treff) return null;
    const tid = tall(treff.headers.get(TID_HEADER));
    const tekst = await treff.text();
    return tid !== null && tid > 0 && tekst ? { tid, tekst } : null;
  } catch (e) {
    loggFeil(env, `cache.match ${nokkel}`, e);
    return null;
  }
}

function lagreCache(env, ctx, cache, nokkel, { tid, tekst }, sek) {
  const lagring = cache
    .put(nokkel, new Response(tekst, {
      headers: { "Content-Type": JSON_TYPE, "Cache-Control": `public, max-age=${sek}`, [TID_HEADER]: String(tid) },
    }))
    .catch((e) => loggFeil(env, `cache.put ${nokkel}`, e));
  ctx?.waitUntil?.(lagring);
}

async function kursJson(env, ctx) {
  const naa = Date.now();
  const gen = generasjon;
  if (minne && minne.gen === gen && erFersk(minne, naa)) return { tekst: minne.tekst, kilde: "minne" };

  const cache = typeof caches !== "undefined" ? caches.default ?? null : null;
  if (cache) {
    const treff = await lesCache(env, cache, CACHE_NOKKEL);
    // Tidsstempelet følger med fra Cache API-et, så treffet ikke blir «ferskt på nytt» i minnet.
    // Et treff som ikke er nyere enn minnet, er det samme (eller eldre) svaret som alt er foreldet her.
    if (treff && erFersk(treff, naa) && (!minne || treff.tid > minne.tid)) {
      minne = { ...treff, gen };
      return { tekst: treff.tekst, kilde: "cache" };
    }
  }

  try {
    const tekst = JSON.stringify(await hentKursdata(env));
    minne = { tid: naa, tekst, gen };
    if (cache) {
      lagreCache(env, ctx, cache, CACHE_NOKKEL, minne, MELLOMLAGER_SEK);
      lagreCache(env, ctx, cache, RESERVE_NOKKEL, minne, RESERVE_SEK);
    }
    return { tekst, kilde: "frontcore" };
  } catch (e) {
    // stale-if-error: heller sist gyldige svar (≤ 24 t) enn en feilside mens FrontCore svikter.
    let reserve = minne;
    if (cache) {
      const lagret = await lesCache(env, cache, RESERVE_NOKKEL);
      if (lagret && (!reserve || lagret.tid > reserve.tid)) reserve = lagret;
    }
    if (reserve && naa - reserve.tid <= RESERVE_SEK * 1000) {
      loggFeil(env, `GET /kurs: FrontCore feilet, viser foreldet svar fra ${new Date(reserve.tid).toISOString()}`, e);
      return { tekst: reserve.tekst, kilde: "foreldet", foreldet: true };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- HTTP

const JSON_TYPE = "application/json; charset=utf-8";

function json(data, status = 200, ekstra = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "Content-Type": JSON_TYPE, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...ekstra },
  });
}

const feil = (status, melding, ekstra) => json({ ok: false, feil: melding }, status, ekstra);

function tillatteOpprinnelser(env) {
  return String(env?.TILLATTE_OPPRINNELSER ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function tillattOpprinnelse(request, env) {
  const origin = request.headers.get("Origin");
  return origin && tillatteOpprinnelser(env).includes(origin) ? origin : null;
}

function medCors(res, request, env) {
  const headers = new Headers(res.headers);
  const origin = tillattOpprinnelse(request, env);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "X-Kkurs-Foreldet");
  }
  headers.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function getKurs(env, ctx) {
  try {
    const { tekst, kilde, foreldet } = await kursJson(env, ctx);
    const ekstra = { "Cache-Control": `public, max-age=${NETTLESER_SEK}`, "X-Mellomlager": kilde };
    if (foreldet) ekstra["X-Kkurs-Foreldet"] = "1";
    return json(tekst, 200, ekstra);
  } catch (e) {
    loggFeil(env, "GET /kurs", e);
    return feil(502, "Fikk ikke hentet kursene akkurat nå. Prøv igjen om litt.");
  }
}

const FOR_MANGE = "For mange påmeldinger på kort tid. Vent et minutt og prøv igjen, eller kontakt oss.";

// Vern mot misbruk av POST /pamelding. Gir et feilsvar, eller null når forespørselen kan slippe gjennom.
// TODO før produksjon: legg Cloudflare Turnstile (usynlig robotsjekk) i påmeldingsskjemaet og verifiser
// tokenet her (POST https://challenges.cloudflare.com/turnstile/v0/siteverify, hemmelig nøkkel som secret).
async function vernPamelding(request, env) {
  // Nettlesere sender alltid Origin på denne forespørselen (POST med JSON fra en annen opprinnelse),
  // så manglende eller ukjent Origin betyr at den ikke kommer fra skjemaet på nettsiden.
  if (!tillattOpprinnelse(request, env)) return feil(403, "Ikke tillatt.");

  // Cloudflare Workers Rate Limiting (binding PAMELDING_GRENSE i wrangler.toml), per klient-IP.
  // Bindingen finnes ikke i testene og kan mangle lokalt — da slipper forespørselen gjennom.
  const grense = env?.PAMELDING_GRENSE;
  if (typeof grense?.limit !== "function") return null;
  const ip = request.headers.get("cf-connecting-ip") || "ukjent";
  try {
    const { success } = (await grense.limit({ key: `pamelding:${ip}` })) ?? {};
    if (success === false) return feil(429, FOR_MANGE, { "Retry-After": "60" });
  } catch (e) {
    // Feil i selve grensen skal ikke stenge ute ekte påmeldinger.
    loggFeil(env, "POST /pamelding: rate limiting feilet, slipper gjennom", e);
  }
  return null;
}

async function postPamelding(request, env, ctx) {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return feil(415, "Påmeldingen må sendes som JSON.");
  if ((tall(request.headers.get("Content-Length")) ?? 0) > MAKS_BYTE) return feil(413, "Påmeldingen er for stor.");

  let data;
  try {
    const tekst = await request.text();
    if (new TextEncoder().encode(tekst).length > MAKS_BYTE) return feil(413, "Påmeldingen er for stor.");
    data = JSON.parse(tekst);
  } catch {
    return feil(400, "Ugyldig påmelding.");
  }

  const vurdert = validerPamelding(data);
  // Roboter får samme svar som ekte påmeldinger, så de ikke lærer at fellen finnes.
  if (vurdert.robot) return json({ ok: true, ordre_id: null, total_inkl_mva: null, venteliste: false });
  if (vurdert.feil) return feil(400, vurdert.feil);
  const pamelding = vurdert.pamelding;

  let dato;
  try {
    dato = await hentDato(env, pamelding.coursedate_id);
  } catch (e) {
    loggFeil(env, `POST /pamelding: henting av dato ${pamelding.coursedate_id}`, e);
    return feil(502, "Fikk ikke kontakt med kurssystemet. Prøv igjen om litt.");
  }
  if (!dato) return feil(404, "Fant ikke kursdatoen. Last siden på nytt og prøv igjen.");

  const plass = vurderPlass(dato, pamelding.deltakere.length);
  if (plass.feil) return feil(plass.status, plass.feil);

  let svar;
  try {
    svar = await fc(env, "/booking", { metode: "POST", body: lagBookingPayload(pamelding, plass), tidsavbrudd: 25000 });
  } catch (e) {
    // Tidsavbrudd, nettverksfeil eller svar som ikke er JSON: ordren kan være opprettet — unntatt når
    // FrontCore svarte 4xx, som betyr at forespørselen ble avvist.
    const avvist = e instanceof FrontCoreFeil && e.status >= 400 && e.status < 500;
    loggFeil(env, `POST /booking for dato ${pamelding.coursedate_id}${avvist ? "" : " (usikkert utfall — sjekk FrontCore)"}`, e);
    return feil(502, avvist ? PROV_IGJEN : USIKKER);
  }

  const resultat = tolkBookingSvar(svar.status, svar.data);
  if (!resultat.ok) {
    loggFeil(env, `POST /booking for dato ${pamelding.coursedate_id}${resultat.usikker ? " (usikkert utfall — sjekk FrontCore)" : ""}`,
      `HTTP ${svar.status}, kode «${resultat.kode || "ukjent"}»: ${kort(resultat.melding, 200)}`);
    return feil(resultat.status, resultat.feil);
  }

  tomMellomlager(ctx);
  return json({ ok: true, ordre_id: resultat.ordre_id, total_inkl_mva: resultat.total_inkl_mva, venteliste: plass.venteliste });
}

async function ruter(request, env, ctx) {
  const sti = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const metode = request.method.toUpperCase();

  if (metode === "OPTIONS") {
    const headers = tillattOpprinnelse(request, env)
      ? { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
      : {};
    return new Response(null, { status: 204, headers });
  }

  const ruteTabell = {
    "/helse": { GET: () => json({ ok: true }) },
    "/kurs": { GET: () => getKurs(env, ctx) },
    "/pamelding": {
      POST: async () => (await vernPamelding(request, env)) ?? postPamelding(request, env, ctx),
    },
  };
  const rute = ruteTabell[sti];
  if (!rute) return feil(404, "Fant ikke adressen.");
  const handling = rute[metode === "HEAD" ? "GET" : metode];
  if (!handling) return feil(405, "Metoden er ikke støttet.", { Allow: [...Object.keys(rute), "OPTIONS"].join(", ") });
  return handling();
}

export default {
  async fetch(request, env, ctx) {
    let res;
    try {
      res = await ruter(request, env, ctx);
    } catch (e) {
      loggFeil(env, "uventet feil", e?.stack ?? e);
      res = feil(500, "Noe gikk galt. Prøv igjen om litt.");
    }
    return medCors(res, request, env);
  },
};
