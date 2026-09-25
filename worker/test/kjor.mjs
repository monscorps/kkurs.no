// Tester for kkurs-api uten nettverk: fetch er mocket, og alt kjøres i Node.
//   node worker/test/kjor.mjs      (eller: cd worker && npm test)
//
// fixtures/courses_coursedates.json er respons-eksempelet fra FrontCores dokumentasjon for
// GET /v2/courses/:id/coursedates. Eksempelet har etterfølgende komma (ugyldig JSON); de er fjernet,
// ellers er det uendret.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, {
  beregnPlasser, finnSted, formaterVarighet, gyldigEpost, kursSlug, lagBookingPayload, mapKurs,
  pakkUtListe, renTekst, sann, slug, tolkBookingSvar, tomMellomlager, USIKKER, validerPamelding, vurderPlass,
} from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/courses_coursedates.json", import.meta.url), "utf8"));
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

const TEST_NOKKEL = `test-nokkel-${Math.random().toString(36).slice(2)}`;
const ENV = {
  FRONTCORE_API_KEY: TEST_NOKKEL,
  TILLATTE_OPPRINNELSER: /TILLATTE_OPPRINNELSER\s*=\s*"([^"]*)"/.exec(wrangler)[1],
};
const IDAG = "2026-09-25";

// ---------------------------------------------------------------- testrigg

const tester = [];
const test = (navn, fn) => tester.push([navn, fn]);

const logg = [];
console.error = (...a) => logg.push(a.map(String).join(" "));
console.warn = (...a) => logg.push(a.map(String).join(" "));

// Klokke som kan spoles frem (mellomlageret bruker Date.now()).
const ekteNaa = Date.now;
let tidsforskyvning = 0;
Date.now = () => ekteNaa() + tidsforskyvning;
const tick = () => new Promise((ferdig) => setTimeout(ferdig, 0));

// Tømmer alt mellomlager, også reserven (som et helt nytt isolat).
const nullstill = () => tomMellomlager(undefined, { reserve: true });

let fcSvar = () => { throw new Error("ingen FrontCore-mock satt"); };
const fcKall = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.frontcore.com") throw new Error(`uventet nettverkskall til ${url.origin}`);
  const kall = { url, sti: url.pathname, metode: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined };
  fcKall.push(kall);
  const svar = await fcSvar(kall);
  if (svar instanceof Error) throw svar;
  return new Response(typeof svar.body === "string" ? svar.body : JSON.stringify(svar.body ?? null), {
    status: svar.status ?? 200,
    headers: { "Content-Type": "application/json", ...svar.headers },
  });
};

function mock(ruter) {
  fcKall.length = 0;
  fcSvar = (kall) => {
    const rute = ruter[`${kall.metode} ${kall.sti}`];
    if (!rute) throw new Error(`ingen mock for ${kall.metode} ${kall.sti}`);
    return typeof rute === "function" ? rute(kall) : rute;
  };
}

async function kall(sti, { metode = "GET", origin = "https://kkurs.no", body, headers = {}, env = ENV, ip } = {}) {
  const h = new Headers(headers);
  if (origin) h.set("Origin", origin);
  if (ip) h.set("cf-connecting-ip", ip);
  if (body !== undefined && !h.has("Content-Type")) h.set("Content-Type", "application/json");
  const req = new Request(`https://kkurs-api.test.workers.dev${sti}`, {
    method: metode, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const ventende = [];
  const res = await worker.fetch(req, env, { waitUntil: (p) => ventende.push(p) });
  await Promise.all(ventende);
  const tekst = await res.text();
  assert.ok(!tekst.includes(TEST_NOKKEL), "API-nøkkelen lekket i svaret");
  let data = null;
  try { data = JSON.parse(tekst); } catch { /* tomt svar (204) */ }
  return { res, data, tekst };
}

// ---------------------------------------------------------------- testdata

function lagDato(over = {}) {
  return {
    coursedate_id: 5001, title: "Truckførerkurs", start_at: "2026-10-27", start_time_at: "08:00:00",
    end_at: "2026-10-29", end_time_at: "15:30:00", timezone: "Europe/Oslo", deadline_at: "2026-10-26",
    is_virtual: false, is_visible: true, visible_when_passed_deadline: false, reference: "truck-2026-10-27",
    parent_id: null, trigger_value: null, seats_status: "open",
    seats: {
      allocated_capacity: { num: 12, num_overbooked: "0", num_waiting: "0" },
      free: { num: 8, num_waiting: 0 },
      booking_status: { num: 4, num_confirmed: 3, num_unconfirmed: 1, num_waiting: 0 },
    },
    custom_properties: null, deleted_at: null, course_id: 86273, location_id: 6489, place_id: 1226,
    status_id: 2, place: { id: "1226", title: "Bergen", title_additional_info: null },
    ...over,
  };
}

const TRUCK = {
  id: 86273, title: "Truckførerkurs", reference: "truck", is_active: true, type: "public",
  duration: { value: 3, unit: { id: 1, code: "days" } }, price: { value: 6900, currency: "NOK", comment: null },
  text_lead: "<p>Sertifisert sikkerhetsopplæring for gaffeltruck inntil 10&nbsp;tonn.</p>",
  custom_properties: { kkurs_kat: "truck", kkurs_koder: "T1–T4", kkurs_varighet: "3 dager", kkurs_bilde: "kurs-truck.jpg" },
};

const fullt = (over = {}) => lagDato({
  seats_status: "fully_booked",
  seats: { allocated_capacity: { num: 12 }, free: { num: 0 }, booking_status: { num_confirmed: 12, num_unconfirmed: 0 } },
  ...over,
});

const gyldigPamelding = (over = {}) => ({
  coursedate_id: 5001,
  kontakt: { navn: "Kari Nordmann", epost: "kari@bedrift.no", telefon: "99999999" },
  bedrift: "Bedrift AS",
  orgnr: "123 456 789",
  deltakere: [{ fornavn: "Ola", etternavn: "Hansen", epost: "" }, { fornavn: "Per", etternavn: "Olsen", epost: "per@bedrift.no" }],
  nettside: "",
  ...over,
});

const BOOKING_OK = {
  successful: true,
  summary: { order_id: "221530", booking_id: "472721", coursedate_id: "5001", currency: "nok", total_excl_vat: 13800, total_incl_vat: 17250, total_vat: 3450, number_of_participants: 2 },
};

// ---------------------------------------------------------------- mapping

test("mapKurs: dokumentasjonens eksempel (datoer per kurs) gir kontraktens form", () => {
  const ut = mapKurs([], fixture, { idag: "2025-11-01", naa: new Date("2025-11-01T10:00:00.123Z") });
  assert.equal(ut.kilde, "frontcore");
  assert.equal(ut.oppdatert, "2025-11-01T10:00:00Z");
  assert.deepEqual(ut.kategorier, { truck: "Truck og maskin", kran: "Kran og løft", hms: "HMS og ledelse", annet: "Andre kurs" });
  assert.equal(ut.kurs.length, 1);
  const [k] = ut.kurs;
  assert.deepEqual(Object.keys(k), ["id", "fc_id", "navn", "koder", "kat", "varighet", "pris", "bilde", "desc", "synlig", "datoer"]);
  assert.deepEqual({ ...k, datoer: undefined }, {
    id: "123", fc_id: 86273, navn: "A test course", koder: null, kat: "annet", varighet: null,
    pris: null, bilde: null, desc: "", synlig: true, datoer: undefined,
  });
  // fully_booked uten kapasitet: 0 ledige, ukjent totalt; sted fra første samlings lokale.
  assert.deepEqual(k.datoer, [{ d: "2025-11-21", sted: "Test venue", fc_id: 12947063, plasser: null, ledige: 0, merk: null }]);
});

test("mapKurs: passerte datoer i eksempelet tas ikke med", () => {
  const ut = mapKurs([], fixture, { idag: IDAG });
  assert.deepEqual(ut.kurs[0].datoer, []);
});

test("mapKurs: fullt utfylt kurs fra listeendepunktet", () => {
  const ut = mapKurs([TRUCK], [lagDato()], { idag: IDAG });
  assert.deepEqual(ut.kurs, [{
    id: "truck", fc_id: 86273, navn: "Truckførerkurs", koder: "T1–T4", kat: "truck", varighet: "3 dager",
    pris: 6900, bilde: "kurs-truck.jpg", desc: "Sertifisert sikkerhetsopplæring for gaffeltruck inntil 10 tonn.",
    synlig: true, datoer: [{ d: "2026-10-27", sted: "Bergen", fc_id: 5001, plasser: 12, ledige: 8, merk: null }],
  }]);
});

test("mapKurs: avlyste, skjulte, passerte, slettede og underdatoer filtreres bort", () => {
  const datoer = [
    lagDato({ coursedate_id: 1, status_id: 3 }),
    lagDato({ coursedate_id: 2, status_id: undefined, status: { id: 3, title: "Canceled" } }),
    lagDato({ coursedate_id: 3, is_visible: false }),
    lagDato({ coursedate_id: 4, start_at: "2026-09-01", deadline_at: "2026-08-31" }),
    lagDato({ coursedate_id: 5, parent_id: 5001 }),
    lagDato({ coursedate_id: 6, deleted_at: "2026-09-01T10:00:00+02:00" }),
    lagDato({ coursedate_id: 7, start_at: "2026-10-01", deadline_at: "2026-09-20" }),
    lagDato({ coursedate_id: 8, start_at: "2026-10-02", deadline_at: "2026-09-20", visible_when_passed_deadline: true }),
    lagDato({ coursedate_id: 9, start_at: "2026-11-17", status_id: 4 }),
    lagDato({ coursedate_id: 10, start_at: "2026-11-03", is_virtual: true, place: { title: null, title_additional_info: "Digitalt" } }),
    lagDato({ coursedate_id: 11, start_at: "2026-09-25 08:00:00", custom_properties: { kkurs_merk: "på engelsk" } }),
    fullt({ coursedate_id: 12, start_at: "2026-12-01" }),
  ];
  const [k] = mapKurs([TRUCK], datoer, { idag: IDAG }).kurs;
  assert.deepEqual(k.datoer.map((d) => d.fc_id), [11, 8, 10, 9, 12]);
  const per = Object.fromEntries(k.datoer.map((d) => [d.fc_id, d]));
  assert.equal(per[11].d, "2026-09-25");
  assert.equal(per[11].merk, "på engelsk");
  assert.equal(per[8].merk, "påmeldingsfrist ute");
  assert.equal(per[9].merk, "utsatt");
  assert.equal(per[10].sted, "Digitalt");
  assert.deepEqual([per[12].ledige, per[12].plasser], [0, 12]);
});

test("mapKurs: manglende og alternative felt", () => {
  const datoer = [
    { coursedate_id: "6001", start_at: "2026-10-05", course_id: "777",
      course: { id: "777", title: "Kranfører – Å løfte trygt", reference: "COURSE1300", is_active: "1",
        duration_value: 1, duration_unit: 1, custom_properties: { kkurs_kat: "sveis" } } },
    { coursedate_id: 6002, start_at: "2026-10-06", course: { id: 888 },
      seats_status: "open", seats: { allocated_capacity: { num: 0 }, free: { num: 0 }, booking_status: { num: "1", num_confirmed: 0, num_unconfirmed: 1 } },
      location: { title: "Kurssenter Bergen", city: null, place: { id: "46", title: "Bergen" } } },
    { coursedate_id: 6003, start_at: "2026-10-07", course_id: 999, seats: { free: { num: "3" }, booking_status: { num_confirmed: "2" } } },
    { start_at: "2026-10-08", course_id: 888 },
    { coursedate_id: 6004, start_at: "i morgen", course_id: 888 },
    null,
  ];
  const kurs = [{ course_id: 999, title: null, price: "4500", duration: "2 dager" }];
  const ut = mapKurs(kurs, datoer, { idag: IDAG });
  const per = Object.fromEntries(ut.kurs.map((k) => [k.fc_id, k]));

  assert.deepEqual(Object.keys(per).map(Number), [777, 888, 999]);
  assert.equal(per[777].id, "kranforer-a-lofte-trygt");
  assert.equal(per[777].kat, "annet");
  assert.equal(per[777].varighet, "1 dag");
  assert.equal(per[777].pris, null);
  assert.equal(per[777].desc, "");
  assert.equal(per[777].synlig, true);
  assert.deepEqual(per[777].datoer, [{ d: "2026-10-05", sted: "Bergen", fc_id: 6001, plasser: null, ledige: null, merk: null }]);

  assert.equal(per[888].id, "kurs-888");
  assert.equal(per[888].navn, "Kurs 888");
  assert.deepEqual(per[888].datoer.map((d) => [d.fc_id, d.sted, d.ledige, d.plasser]), [[6002, "Bergen", null, null]]);

  assert.equal(per[999].pris, 4500);
  assert.equal(per[999].varighet, "2 dager");
  assert.deepEqual(per[999].datoer.map((d) => [d.ledige, d.plasser]), [[3, 5]]);
});

test("mapKurs: slug, kollisjoner, skjulte og bedriftsinterne kurs", () => {
  const kurs = [
    { id: 3, title: "Truckførerkurs", reference: "Truck" },
    { id: 1, title: "Truckførerkurs", reference: "" },
    { id: 2, title: "HMS for ledere", reference: "hms-leder", is_active: false },
    { id: 4, title: "Truckkurs for Firma AS", reference: "firma", type: "corporate" },
    { id: 5, title: "Internt kurs", customer_id: 55 },
    { id: 6, title: "Bedriftskurs", level: { id: 15, title: "Corporate training" } },
    { id: 7, title: "International sikkerhet", type: "international" },
  ];
  const ut = mapKurs(kurs, [], { idag: IDAG });
  assert.deepEqual(ut.kurs.map((k) => [k.fc_id, k.id, k.synlig]), [
    [1, "truckforerkurs", true], [2, "hms-leder", false], [3, "truckforerkurs-3", true], [7, "international-sikkerhet", true],
  ]);
});

test("mapKurs: gyldige referanser reserveres før tittel-slugs deles ut", () => {
  const kurs = [
    { id: 1, title: "Truck", reference: "" },                            // tittel-slug «truck» = referansen til kurs 2
    { id: 2, title: "Truckførerkurs", reference: "truck" },
    { id: 3, title: "Truck for viderekomne", reference: "truck" },       // duplisert referanse
    { id: 4, title: "Kran" },
    { id: 5, title: "Mobilkran", reference: "kran" },
    { id: 6, title: "Kran fire", reference: "kran-4" },                  // tar også «-<fc_id>»-varianten til kurs 4
    { id: 7, title: "HMS", reference: "Ikke gyldig" },
  ];
  const ut = mapKurs(kurs, [], { idag: IDAG });
  assert.deepEqual(ut.kurs.map((k) => [k.fc_id, k.id]), [
    [1, "truck-1"], [2, "truck"], [3, "truck-3"], [4, "kran-4-2"], [5, "kran"], [6, "kran-4"], [7, "hms"],
  ]);
  assert.equal(new Set(ut.kurs.map((k) => k.id)).size, ut.kurs.length, "id-ene skal være unike");
  for (const k of ut.kurs) assert.match(k.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  // Rekkefølgen i listen fra FrontCore spiller ingen rolle.
  assert.deepEqual(mapKurs([...kurs].reverse(), [], { idag: IDAG }).kurs.map((k) => k.id), ut.kurs.map((k) => k.id));
});

test("sann: felles tolkning av sannhetsverdier", () => {
  for (const v of [true, 1, "1", "true", " TRUE ", "True"]) assert.equal(sann(v), true, JSON.stringify(v));
  for (const v of [false, 0, "0", "false", "FALSE", " 0 ", null]) assert.equal(sann(v, true), false, JSON.stringify(v));
  for (const v of [undefined, "ja", "", 2, {}, []]) {
    assert.equal(sann(v, true), true, `standard for ${JSON.stringify(v)}`);
    assert.equal(sann(v, false), false, `standard for ${JSON.stringify(v)}`);
  }
  assert.equal(sann(undefined), false);
});

test("sannhetsverdier som tekst/tall: is_visible, is_virtual, is_active, visible_when_passed_deadline", () => {
  const datoer = [
    lagDato({ coursedate_id: 1, is_visible: "0" }),
    lagDato({ coursedate_id: 2, is_visible: "false" }),
    lagDato({ coursedate_id: 3, is_visible: null }),
    lagDato({ coursedate_id: 4, is_visible: "1", is_virtual: "1" }),
    lagDato({ coursedate_id: 5, is_visible: 1, is_virtual: "true" }),
    lagDato({ coursedate_id: 6, is_visible: undefined, is_virtual: null }),
    lagDato({ coursedate_id: 7, is_virtual: 0 }),
    lagDato({ coursedate_id: 8, deadline_at: "2026-09-20", visible_when_passed_deadline: "1" }),
    lagDato({ coursedate_id: 9, deadline_at: "2026-09-20", visible_when_passed_deadline: "false" }),
  ];
  const [k] = mapKurs([TRUCK], datoer, { idag: IDAG }).kurs;
  assert.deepEqual(k.datoer.map((d) => [d.fc_id, d.sted, d.merk]), [
    [4, "Digitalt", null], [5, "Digitalt", null], [6, "Bergen", null], [7, "Bergen", null], [8, "Bergen", "påmeldingsfrist ute"],
  ]);

  const kurs = [
    { id: 1, title: "A", is_active: "0" }, { id: 2, title: "B", is_active: "false" }, { id: 3, title: "C", is_active: null },
    { id: 4, title: "D", is_active: "1" }, { id: 5, title: "E", is_active: "true" }, { id: 6, title: "F" }, { id: 7, title: "G", active: 0 },
  ];
  assert.deepEqual(mapKurs(kurs, [], { idag: IDAG }).kurs.map((x) => x.synlig), [false, false, false, true, true, true, false]);

  assert.equal(vurderPlass(lagDato({ is_visible: "0" }), 1, IDAG).status, 409);
  assert.equal(vurderPlass(lagDato({ is_visible: null }), 1, IDAG).status, 409);
  assert.equal(vurderPlass(lagDato({ course: { id: 1, is_active: "false" } }), 1, IDAG).status, 409);
  assert.deepEqual(vurderPlass(lagDato({ is_visible: "1", course: { id: 1, is_active: "1" } }), 1, IDAG), { venteliste: false, plassjekk: true });
  assert.equal(tolkBookingSvar(200, { successful: "true", summary: { order_id: 9 } }).ok, true);
  assert.equal(tolkBookingSvar(200, { successful: "0", summary: { order_id: 9 } }).ok, false);
});

test("påmeldingsfrist: datoen kan vises med merk, men kan aldri bookes etter fristen", () => {
  const ute = { start_at: "2026-10-01", deadline_at: "2026-09-24" };
  const datoer = [
    lagDato({ coursedate_id: 1, ...ute, visible_when_passed_deadline: true, custom_properties: { kkurs_merk: "på engelsk" } }),
    lagDato({ coursedate_id: 2, ...ute, visible_when_passed_deadline: true, status_id: 4 }),
    lagDato({ coursedate_id: 3, ...ute, visible_when_passed_deadline: false }),
    lagDato({ coursedate_id: 4, start_at: "2026-10-01", deadline_at: "2026-09-25" }), // fristen er i dag: fortsatt åpen
    lagDato({ coursedate_id: 5, start_at: "2026-10-01", deadline_at: null }),
  ];
  const [k] = mapKurs([TRUCK], datoer, { idag: IDAG }).kurs;
  assert.deepEqual(k.datoer.map((d) => [d.fc_id, d.merk]), [[1, "påmeldingsfrist ute"], [2, "påmeldingsfrist ute"], [4, null], [5, null]]);

  const FRIST = { status: 409, feil: "Påmeldingsfristen er ute. Velg en annen dato, eller kontakt oss." };
  assert.deepEqual(vurderPlass(lagDato({ ...ute, visible_when_passed_deadline: true }), 1, IDAG), FRIST);
  assert.deepEqual(vurderPlass(lagDato({ ...ute, visible_when_passed_deadline: "1" }), 1, IDAG), FRIST);
  assert.deepEqual(vurderPlass(lagDato({ ...ute, visible_when_passed_deadline: false }), 1, IDAG), FRIST);
  assert.deepEqual(vurderPlass(fullt({ ...ute, visible_when_passed_deadline: true }), 1, IDAG), FRIST, "heller ikke venteliste");
  assert.deepEqual(vurderPlass(lagDato({ start_at: "2026-10-01", deadline_at: "2026-09-24 23:59:00" }), 1, IDAG), FRIST);
  assert.deepEqual(vurderPlass(lagDato({ start_at: "2026-10-01", deadline_at: "2026-09-25" }), 1, IDAG), { venteliste: false, plassjekk: true });
});

test("ledige: null (ukjent kapasitet) sendes videre og behandles som åpent", () => {
  const ukjent = lagDato({
    seats_status: "open",
    seats: { allocated_capacity: { num: 0 }, free: { num: 0 }, booking_status: { num_confirmed: 3, num_unconfirmed: 0 } },
  });
  assert.deepEqual(beregnPlasser(ukjent), { ledige: null, plasser: null });
  const [k] = mapKurs([TRUCK], [ukjent], { idag: IDAG }).kurs;
  assert.ok(JSON.stringify(k.datoer[0]).includes('"plasser":null,"ledige":null'), "ledige: null skal sendes, ikke utelates");
  // Åpent: bekreftet påmelding (status_id 1), uten plassjekk og uten tak på antall deltakere.
  for (const dato of [ukjent, lagDato({ seats: null }), lagDato({ seats: undefined, seats_status: undefined })]) {
    const plass = vurderPlass(dato, 20, IDAG);
    assert.deepEqual(plass, { venteliste: false, plassjekk: false });
    const p = lagBookingPayload(validerPamelding(gyldigPamelding()).pamelding, plass);
    assert.deepEqual(p.participants.map((d) => d.status_id), [1, 1]);
    assert.equal(p.config.seats_availability_check, false);
  }
  // 0 betyr fortsatt fullt ⇒ venteliste.
  assert.deepEqual(vurderPlass(fullt(), 1, IDAG), { venteliste: true, plassjekk: false });
});

test("renTekst: \" og ' gjøres ufarlige, så data ikke kan bryte ut av HTML-attributter", () => {
  assert.equal(
    renTekst(`Kurs for "nybegynnere" og 'viderekomne' &quot;A&quot; &#39;B&#39; &#x22;C&#x27; &apos;D&apos; &#34;`),
    "Kurs for ”nybegynnere” og ’viderekomne’ ”A” ’B’ ”C’ ’D’ ”",
  );
  assert.equal(renTekst(`x" onmouseover="alert(1)`), "x” onmouseover=”alert(1)");
  assert.equal(renTekst(`Ola's kurs`), "Ola’s kurs");

  // Ingen tekstverdi i GET /kurs skal kunne inneholde " ' < >.
  const farlig = `"'><img src=x onerror=alert(1)>&quot;&#39;&lt;`;
  const ut = mapKurs(
    [{ ...TRUCK, title: `Truck ${farlig}`, text_lead: `Ingress ${farlig}`,
      custom_properties: { ...TRUCK.custom_properties, kkurs_koder: `T1 ${farlig}`, kkurs_varighet: `3 ${farlig}` } }],
    [lagDato({ custom_properties: { kkurs_merk: `merk ${farlig}` }, place: { title: `Sted ${farlig}` } })],
    { idag: IDAG },
  );
  const tekster = [];
  const samle = (v) => (typeof v === "string" ? tekster.push(v) : v && typeof v === "object" && Object.values(v).forEach(samle));
  samle(ut);
  assert.ok(tekster.length > 10);
  for (const t of tekster) assert.doesNotMatch(t, /["'<>]/, t);
});

test("hjelpere: slug, varighet, plasser, sted, tekstvask og listeformat", () => {
  assert.equal(slug("Øvelse på Ærlig Å-kurs!"), "ovelse-pa-aerlig-a-kurs");
  assert.equal(slug("Café Crème"), "cafe-creme");
  assert.equal(kursSlug({ reference: "123" }, 1), "123");
  assert.equal(kursSlug({ reference: "arbeid-i-hoyden" }, 1), "arbeid-i-hoyden");
  assert.equal(kursSlug({ reference: "arbeid--i", title: "Arbeid i høyden" }, 1), "arbeid-i-hoyden");

  assert.equal(formaterVarighet(2, "hours"), "2 timer");
  assert.equal(formaterVarighet("1", 6), "1 time");
  assert.equal(formaterVarighet(1.5, { id: "1" }), "1,5 dager");
  assert.equal(formaterVarighet(3, { title: "Dag", title_plural: "Dager" }), "3 dager");
  assert.equal(formaterVarighet(0, 1), null);
  assert.equal(formaterVarighet(3, null), null);

  assert.deepEqual(beregnPlasser({}), { ledige: null, plasser: null });
  assert.deepEqual(beregnPlasser({ seats: { allocated_capacity: { num: 12 }, free: { num: -2 } } }), { ledige: 0, plasser: null });
  assert.deepEqual(beregnPlasser({ seats: { allocated_capacity: { num: 12 }, free: { num: 0 } } }), { ledige: 0, plasser: null });
  assert.deepEqual(beregnPlasser({ seats_status: "fully_booked", seats: { free: { num: 5 } } }), { ledige: 0, plasser: null });

  assert.equal(finnSted({ place: { title_additional_info: "Digitalt" } }), "Digitalt");
  assert.equal(finnSted({ location: { city: "Os", title: "Lokale 1" } }), "Os");
  assert.equal(finnSted({}), "Bergen");

  assert.equal(renTekst("<script>alert(1)</script>Hei &amp; &lt;b&gt;velkommen&#33;"), "alert(1)Hei & bvelkommen!");
  assert.equal(renTekst({ ikke: "tekst" }), "");
  assert.equal(renTekst("ord ".repeat(100), 20), "ord ord ord ord ord…");

  assert.deepEqual(pakkUtListe([1, 2]), { elementer: [1, 2], neste: null });
  assert.deepEqual(pakkUtListe({ items: [1], pagination: { next_page: null } }), { elementer: [1], neste: 0 });
  assert.deepEqual(pakkUtListe({ items: [1], pagination: { next_page: 2 } }), { elementer: [1], neste: 2 });
  assert.throws(() => pakkUtListe({ error: "Wrong API Key" }), /ukjent listeformat/);
});

// ---------------------------------------------------------------- validering og booking-payload

test("validerPamelding: gyldig påmelding normaliseres", () => {
  const v = validerPamelding(gyldigPamelding({ kontakt: { navn: "  Kari  Nordmann ", epost: " Kari@Bedrift.no ", telefon: " 99 99 99 99 " } }));
  assert.deepEqual(v, { pamelding: {
    coursedate_id: 5001,
    kontakt: { navn: "Kari Nordmann", epost: "kari@bedrift.no", telefon: "99 99 99 99" },
    bedrift: "Bedrift AS", orgnr: "123456789",
    deltakere: [{ fornavn: "Ola", etternavn: "Hansen", epost: "" }, { fornavn: "Per", etternavn: "Olsen", epost: "per@bedrift.no" }],
  } });
  assert.ok(validerPamelding(gyldigPamelding({ coursedate_id: "5001", nettside: undefined, bedrift: undefined, orgnr: undefined })).pamelding);
});

test("validerPamelding: honningfelle og feil", () => {
  assert.deepEqual(validerPamelding(gyldigPamelding({ nettside: "http://spam.example" })), { robot: true });
  assert.deepEqual(validerPamelding(gyldigPamelding({ nettside: 1 })), { robot: true });
  assert.deepEqual(validerPamelding({ nettside: "x" }), { robot: true });

  const feil = (over) => validerPamelding(gyldigPamelding(over)).feil;
  assert.equal(validerPamelding(null).feil, "Ugyldig påmelding.");
  assert.equal(validerPamelding([]).feil, "Ugyldig påmelding.");
  assert.equal(feil({ coursedate_id: undefined }), "Velg en kursdato.");
  assert.equal(feil({ coursedate_id: "12.5" }), "Velg en kursdato.");
  assert.equal(feil({ coursedate_id: -3 }), "Velg en kursdato.");
  assert.equal(feil({ kontakt: { navn: "   ", epost: "kari@bedrift.no" } }), "Fyll inn navnet ditt.");
  assert.equal(feil({ kontakt: undefined }), "Fyll inn navnet ditt.");
  for (const epost of ["kari", "kari@bedrift", "kari@@bedrift.no", "kari bedrift@x.no", "kari@bedrift.n", "<kari>@x.no", 42]) {
    assert.equal(feil({ kontakt: { navn: "Kari", epost } }), "Skriv inn en gyldig e-postadresse.", String(epost));
  }
  for (const epost of ["kari@bedrift.no", "kari.nordmann+kurs@sub.bedrift.com", "ola@kjøkken.no"]) assert.ok(gyldigEpost(epost), epost);
  assert.equal(feil({ deltakere: [] }), "Legg til minst én deltaker.");
  assert.equal(feil({ deltakere: "Ola" }), "Legg til minst én deltaker.");
  assert.match(feil({ deltakere: Array.from({ length: 21 }, () => ({ fornavn: "A", etternavn: "B" })) }), /^Maks 20 deltakere/);
  assert.ok(validerPamelding(gyldigPamelding({ deltakere: Array.from({ length: 20 }, () => ({ fornavn: "A", etternavn: "B" })) })).pamelding);
  assert.equal(feil({ deltakere: [{ fornavn: "Ola", etternavn: "Hansen" }, { fornavn: "Per", etternavn: " " }] }), "Fyll inn fornavn og etternavn for deltaker 2.");
  assert.equal(feil({ deltakere: [null] }), "Fyll inn fornavn og etternavn for deltaker 1.");
  assert.equal(feil({ deltakere: [{ fornavn: "Ola", etternavn: "Hansen", epost: "ola@" }] }), "E-postadressen til deltaker 1 ser ikke riktig ut.");
  assert.equal(feil({ bedrift: "x".repeat(201) }), "Et av feltene er for langt.");
});

test("lagBookingPayload: vanlig påmelding", () => {
  const { pamelding } = validerPamelding(gyldigPamelding());
  assert.deepEqual(lagBookingPayload(pamelding, { venteliste: false, plassjekk: true }), {
    coursedate_id: 5001, payment_method: "invoice", currency: "nok",
    booker_name: "Kari Nordmann", booker_email: "kari@bedrift.no", booker_phone: "99999999",
    company: "Bedrift AS", company_number: "123456789", invoice_email: "kari@bedrift.no",
    participants: [
      { firstname: "Ola", lastname: "Hansen", email: "kari@bedrift.no", status_id: 1 },
      { firstname: "Per", lastname: "Olsen", email: "per@bedrift.no", status_id: 1 },
    ],
    config: { reject_cancelled_course_date: true, seats_availability_check: true, send_receipt_email_to_participant: true, send_account_created_email_to_user: false },
  });
});

test("lagBookingPayload: venteliste og tomme valgfrie felt", () => {
  const { pamelding } = validerPamelding(gyldigPamelding({ kontakt: { navn: "Kari", epost: "kari@x.no" }, bedrift: "", orgnr: "" }));
  const p = lagBookingPayload(pamelding, { venteliste: true, plassjekk: false });
  assert.equal("booker_phone" in p || "company" in p || "company_number" in p, false);
  assert.deepEqual(p.participants.map((d) => [d.email, d.status_id]), [["kari@x.no", 3], ["per@bedrift.no", 3]]);
  assert.equal(p.config.seats_availability_check, false);
});

test("vurderPlass: fullt, for få, ukjent og stengt", () => {
  assert.deepEqual(vurderPlass(fullt(), 3, IDAG), { venteliste: true, plassjekk: false });
  assert.deepEqual(vurderPlass(lagDato(), 8, IDAG), { venteliste: false, plassjekk: true });
  assert.deepEqual(vurderPlass(lagDato({ seats: undefined }), 5, IDAG), { venteliste: false, plassjekk: false });
  assert.deepEqual(vurderPlass(lagDato({ seats: { free: { num: 2 } } }), 3, IDAG), {
    status: 409, feil: "Bare 2 plasser igjen på denne datoen. Velg færre deltakere eller en annen dato.",
  });
  assert.match(vurderPlass(lagDato({ seats: { free: { num: 1 } } }), 2, IDAG).feil, /^Bare 1 plass igjen/);
  assert.match(vurderPlass(lagDato({ status: { id: 3 }, status_id: undefined }), 1, IDAG).feil, /avlyst/);
  assert.equal(vurderPlass(lagDato({ start_at: "2026-09-24" }), 1, IDAG).status, 409);
  assert.equal(vurderPlass(lagDato({ course: { id: 1, is_active: false } }), 1, IDAG).status, 409);
  assert.match(vurderPlass(lagDato({ start_at: "2026-10-01", deadline_at: "2026-09-20" }), 1, IDAG).feil, /fristen/);
});

test("tolkBookingSvar: suksess og FrontCores feilkoder", () => {
  assert.deepEqual(tolkBookingSvar(200, BOOKING_OK), { ok: true, ordre_id: "221530", total_inkl_mva: 17250 });
  assert.deepEqual(tolkBookingSvar(201, { summary: { order_id: 5, total_incl_vat: "100" } }), { ok: true, ordre_id: "5", total_inkl_mva: 100 });

  const feil = (status, data) => {
    const r = tolkBookingSvar(status, data);
    assert.equal(r.ok, false);
    return [r.status, r.feil];
  };
  assert.deepEqual(feil(400, { successful: false, errors: [{ code: "participant_email_invalid_empty", message: "Participant 1 must have an email address." }] }),
    [400, "Alle deltakere må ha e-postadresse."]);
  assert.deepEqual(feil(200, { successful: false, errors: [{ code: "course_date_cancelled", message: "…" }] }),
    [409, "Denne kursdatoen er avlyst. Velg en annen dato."]);
  assert.equal(feil(422, { successful: false, errors: [{ code: "default_course_product_missing" }] })[0], 502);
  assert.equal(feil(422, { successful: false, errors: [{ code: "no_vacant_seats", message: "There are no vacant seats" }] })[0], 409);
  assert.equal(feil(401, { error: "Wrong API Key" })[0], 502);
  assert.equal(feil(500, null)[0], 502);
  assert.equal(feil(200, { successful: false, errors: { a: { code: "participant_count_invalid" } } })[0], 400);
});

test("tolkBookingSvar: usikre utfall gir «usikre»-meldingen, aldri «prøv igjen om litt»", () => {
  assert.equal(USIKKER, "Vi er usikre på om påmeldingen ble registrert. Sjekk e-posten din (også søppelpost) før du prøver igjen, eller kontakt oss.");
  const tilfeller = [
    [200, {}], [200, null], [201, "OK"], [204, null], [200, { successful: false }], [200, { summary: {} }],
    [200, { successful: false, errors: [{ code: "helt_ny_kode" }] }],
    [500, null], [502, { error: "Bad gateway" }],
    [503, { successful: false, errors: [{ code: "participant_count_invalid" }] }], // 5xx er alltid usikkert
    [422, { successful: false, errors: [{ code: "booking_could_not_be_created", message: "Booking could not be created." }] }],
    [200, { successful: false, errors: [{ code: "order_could_not_be_created" }] }],
    [400, { successful: false, errors: [{ code: "internal_course_order_not_resolvable" }] }],
    [400, { successful: false, errors: [{ code: "internal_course_orderline_not_resolvable" }] }],
  ];
  for (const [status, data] of tilfeller) {
    const r = tolkBookingSvar(status, data);
    const navn = JSON.stringify([status, data]);
    assert.equal(r.ok, false, navn);
    assert.equal(r.usikker, true, navn);
    assert.deepEqual([r.status, r.feil], [502, USIKKER], navn);
  }
  // Sikre avvisninger (4xx) kan fortsatt be om et nytt forsøk.
  for (const [status, data] of [[400, { successful: false, errors: [{ code: "ukjent_valideringsfeil" }] }], [401, { error: "Wrong API Key" }], [429, null]]) {
    const r = tolkBookingSvar(status, data);
    assert.equal(r.usikker, false, JSON.stringify([status, data]));
    assert.match(r.feil, /Prøv igjen om litt/);
  }
  assert.equal(tolkBookingSvar(400, { successful: false, errors: [{ code: "course_date_cancelled" }] }).usikker, false);
});

test("wrangler.toml: rate limiting-binding for påmelding", () => {
  const blokk = /\[\[ratelimits\]\]([\s\S]*?)(?=\n\[|$)/.exec(wrangler)?.[1] ?? "";
  assert.match(blokk, /^name\s*=\s*"PAMELDING_GRENSE"\s*$/m);
  assert.match(blokk, /^namespace_id\s*=\s*"\d+"\s*$/m);
  assert.match(blokk, /^simple\s*=\s*\{\s*limit\s*=\s*5\s*,\s*period\s*=\s*60\s*\}\s*$/m);
  assert.equal("PAMELDING_GRENSE" in ENV, false, "testene skal også dekke at bindingen mangler");
});

// ---------------------------------------------------------------- Worker-ruter med mocket fetch

const KURSRUTER = {
  "GET /v2/courses": { body: [TRUCK] },
  "GET /v2/coursedates": (k) => k.url.searchParams.get("page") === "1"
    ? { body: { pagination: { current_page: 1, next_page: 2 }, items: [lagDato({ course: TRUCK })] } }
    : { body: { pagination: { current_page: 2, next_page: null }, items: [fullt({ coursedate_id: 5002, start_at: "2026-11-24" })] } },
};

test("GET /helse svarer uten å kalle FrontCore", async () => {
  mock({});
  const { res, data } = await kall("/helse");
  assert.equal(res.status, 200);
  assert.deepEqual(data, { ok: true });
  assert.equal(fcKall.length, 0);
});

test("ukjent rute og feil metode gir JSON-feil", async () => {
  mock({});
  let { res, data } = await kall("/finnes-ikke");
  assert.equal(res.status, 404);
  assert.equal(data.ok, false);
  assert.equal(typeof data.feil, "string");
  ({ res, data } = await kall("/pamelding"));
  assert.equal(res.status, 405);
  assert.match(res.headers.get("Allow"), /POST/);
});

test("CORS: preflight og Origin speiles bare for tillatte opprinnelser", async () => {
  mock({});
  for (const origin of ["https://monscorps.github.io", "https://kkurs.no", "https://www.kkurs.no", "http://localhost:4173"]) {
    const { res } = await kall("/pamelding", { metode: "OPTIONS", origin });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
    assert.match(res.headers.get("Access-Control-Allow-Headers"), /Content-Type/i);
  }
  const { res } = await kall("/pamelding", { metode: "OPTIONS", origin: "https://ond.example" });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), null);
  const helse = await kall("/helse", { origin: "https://kkurs.no.ond.example" });
  assert.equal(helse.res.headers.get("Access-Control-Allow-Origin"), null);
  assert.match(helse.res.headers.get("Vary"), /Origin/);
});

test("GET /kurs: henter alle sider, mapper og mellomlagrer", async () => {
  nullstill();
  mock(KURSRUTER);
  const { res, data } = await kall("/kurs", { origin: "https://monscorps.github.io" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=60");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://monscorps.github.io");
  assert.match(res.headers.get("Content-Type"), /application\/json/);
  assert.equal(data.kilde, "frontcore");
  assert.deepEqual(data.kurs.map((k) => k.id), ["truck"]);
  assert.deepEqual(data.kurs[0].datoer.map((d) => [d.fc_id, d.ledige]), [[5001, 8], [5002, 0]]);

  const [kursKall, ...datoKall] = [fcKall.find((k) => k.sti === "/v2/courses"), ...fcKall.filter((k) => k.sti === "/v2/coursedates")];
  assert.equal(kursKall.url.searchParams.get("limit"), "250");
  assert.equal(datoKall.length, 2);
  const q = datoKall[0].url.searchParams;
  assert.equal(q.get("start_date_at_min"), "now");
  assert.equal(q.get("order_by"), "startdate");
  assert.equal(q.get("order_direction"), "asc");
  assert.equal(q.get("limit"), "250");
  assert.ok(q.getAll("include[]").includes("course"));
  for (const k of fcKall) {
    assert.equal(k.headers.get("X-API-Key"), TEST_NOKKEL);
    assert.match(k.headers.get("Accept"), /application\/json/);
    assert.equal(k.url.toString().includes(TEST_NOKKEL), false);
  }

  const antall = fcKall.length;
  const igjen = await kall("/kurs");
  assert.equal(igjen.res.status, 200);
  assert.equal(igjen.res.headers.get("X-Mellomlager"), "minne");
  assert.equal(fcKall.length, antall, "andre kall skal komme fra mellomlageret");
});

// Kjører fn med et falskt Cache API (caches.default) og tomt mellomlager, og rydder opp etterpå.
async function medCache(fn) {
  const lager = new Map(); // nøkkel → { tekst, headers }
  const puttet = [];
  globalThis.caches = { default: {
    match: async (n) => (lager.has(n) ? new Response(lager.get(n).tekst, { headers: lager.get(n).headers }) : undefined),
    put: async (n, res) => {
      const o = { tekst: await res.text(), headers: Object.fromEntries(res.headers) };
      puttet.push([n, o.headers["cache-control"]]);
      lager.set(n, o);
    },
    delete: async (n) => lager.delete(n),
  } };
  try {
    nullstill();
    await fn({ lager, puttet });
  } finally {
    delete globalThis.caches;
    tidsforskyvning = 0;
    nullstill();
  }
}

const FC_NEDE = {
  "GET /v2/courses": { status: 500, body: { error: "Internal Server Error" } },
  "GET /v2/coursedates": () => new TypeError("fetch failed"),
};

test("GET /kurs: Cache API brukes når den finnes", () => medCache(async ({ lager, puttet }) => {
  mock(KURSRUTER);
  const forste = await kall("/kurs");
  assert.equal(forste.res.headers.get("X-Mellomlager"), "frontcore");
  assert.deepEqual(puttet.map(([, cc]) => cc), ["public, max-age=120", "public, max-age=86400"]);
  const [fersk, reserve] = puttet.map(([n]) => n);
  assert.notEqual(fersk, reserve);
  for (const o of lager.values()) assert.ok(Number(o.headers["x-kkurs-tid"]) > 0, "tidsstempelet skal lagres med svaret");

  tomMellomlager(); // som etter en påmelding
  await tick();
  assert.equal(lager.has(fersk), false, "tomMellomlager skal slette det ferske svaret fra Cache API");
  assert.equal(lager.has(reserve), true, "reserven (stale-if-error) skal beholdes");

  // Et annet isolat i datasenteret har lagt inn et nyere svar.
  lager.set(fersk, { tekst: JSON.stringify({ kilde: "frontcore", kurs: [] }), headers: { "x-kkurs-tid": String(Date.now() + 10) } });
  mock({});
  const andre = await kall("/kurs");
  assert.equal(andre.res.headers.get("X-Mellomlager"), "cache");
  assert.deepEqual(andre.data.kurs, []);
  assert.equal(fcKall.length, 0);

  // Oppføringer uten tidsstempel (gammelt format) regnes ikke som treff.
  nullstill();
  lager.set(fersk, { tekst: JSON.stringify({ kilde: "frontcore", kurs: [] }), headers: {} });
  mock(KURSRUTER);
  assert.equal((await kall("/kurs")).res.headers.get("X-Mellomlager"), "frontcore");
}));

test("GET /kurs: treff i Cache API beholder tidsstempelet sitt (blir ikke ferskt på nytt)", () => medCache(async ({ lager, puttet }) => {
  mock(KURSRUTER);
  await kall("/kurs");
  const [fersk] = puttet.map(([n]) => n);
  const oppforing = lager.get(fersk);
  nullstill(); // nytt isolat: tomt minne …
  await tick();
  // … men Cache API har et svar som ble hentet fra FrontCore for 100 s siden.
  lager.set(fersk, { ...oppforing, headers: { ...oppforing.headers, "x-kkurs-tid": String(Date.now() - 100_000) } });

  mock({});
  assert.equal((await kall("/kurs")).res.headers.get("X-Mellomlager"), "cache");
  tidsforskyvning = 10_000; // 110 s gammelt: fortsatt ferskt, fra minnet
  assert.equal((await kall("/kurs")).res.headers.get("X-Mellomlager"), "minne");
  assert.equal(fcKall.length, 0);

  tidsforskyvning = 30_000; // 130 s gammelt: skal hentes på nytt, verken fra minnet eller Cache API
  mock(KURSRUTER);
  const r = await kall("/kurs");
  assert.equal(r.res.headers.get("X-Mellomlager"), "frontcore");
  assert.ok(fcKall.length > 0);
}));

test("GET /kurs: stale-if-error — FrontCore-feil gir sist gyldige svar (≤ 24 t) med X-Kkurs-Foreldet", async () => {
  nullstill();
  try {
    mock(KURSRUTER);
    const forste = await kall("/kurs");
    assert.equal(forste.res.status, 200);
    assert.equal(forste.res.headers.get("X-Kkurs-Foreldet"), null);

    // En påmelding tømmer mellomlageret, men reserven beholdes.
    mock(bookingRuter(lagDato()));
    assert.equal((await kall("/pamelding", { metode: "POST", body: gyldigPamelding() })).res.status, 200);

    tidsforskyvning = 3 * 60_000;
    logg.length = 0;
    mock(FC_NEDE);
    const foreldet = await kall("/kurs", { origin: "https://monscorps.github.io" });
    assert.equal(foreldet.res.status, 200);
    assert.equal(foreldet.res.headers.get("X-Kkurs-Foreldet"), "1");
    assert.equal(foreldet.res.headers.get("X-Mellomlager"), "foreldet");
    assert.match(foreldet.res.headers.get("Access-Control-Expose-Headers"), /X-Kkurs-Foreldet/);
    assert.equal(foreldet.tekst, forste.tekst, "samme svar som sist, med opprinnelig «oppdatert»");
    assert.ok(logg.some((l) => l.includes("foreldet svar")), "skal logges");

    tidsforskyvning = 23 * 3600_000;
    assert.equal((await kall("/kurs")).res.headers.get("X-Kkurs-Foreldet"), "1");

    tidsforskyvning = 24 * 3600_000 + 60_000; // over 24 t: ingen reserve
    const forGammelt = await kall("/kurs");
    assert.equal(forGammelt.res.status, 502);
    assert.equal(forGammelt.res.headers.get("X-Kkurs-Foreldet"), null);
    assert.equal(forGammelt.data.ok, false);
  } finally {
    tidsforskyvning = 0;
    nullstill();
  }
});

test("GET /kurs: stale-if-error bruker reserven i Cache API i et nytt isolat", () => medCache(async ({ lager, puttet }) => {
  mock(KURSRUTER);
  const forste = await kall("/kurs");
  const [, reserve] = puttet.map(([n]) => n);
  const lagret = lager.get(reserve);
  nullstill(); // nytt isolat og tomt lager …
  await tick();
  lager.set(reserve, lagret); // … bortsett fra reserven i Cache API
  tidsforskyvning = 60 * 60_000;

  mock(FC_NEDE);
  const r = await kall("/kurs");
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get("X-Kkurs-Foreldet"), "1");
  assert.equal(r.tekst, forste.tekst);
}));

test("GET /kurs: FrontCore-feil gir 502 og logges uten nøkkel", async () => {
  nullstill();
  logg.length = 0;
  mock({ "GET /v2/courses": { status: 500, body: { error: `intern feil ${TEST_NOKKEL}` } }, "GET /v2/coursedates": { body: { items: [] } } });
  const { res, data } = await kall("/kurs");
  assert.equal(res.status, 502);
  assert.equal(data.ok, false);
  assert.match(data.feil, /Prøv igjen/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.ok(logg.some((l) => l.includes("GET /kurs") && l.includes("HTTP 500")));
  assert.ok(logg.some((l) => l.includes("***")), "nøkkelen skal skjules i loggen");

  nullstill();
  mock({ "GET /v2/courses": { body: { error: "Wrong API Key" } }, "GET /v2/coursedates": { body: { items: [] } } });
  assert.equal((await kall("/kurs")).res.status, 502);

  nullstill();
  mock({ "GET /v2/courses": { body: "<html>502</html>" }, "GET /v2/coursedates": { body: { items: [] } } });
  assert.equal((await kall("/kurs")).res.status, 502);

  nullstill();
  mock({});
  const utenNokkel = await kall("/kurs", { env: { ...ENV, FRONTCORE_API_KEY: undefined } });
  assert.equal(utenNokkel.res.status, 502);
  assert.equal(fcKall.length, 0);
});

test("GET /kurs: prøver igjen ved 429", async () => {
  nullstill();
  let forsok = 0;
  mock({
    "GET /v2/courses": () => (++forsok === 1 ? { status: 429, headers: { "Retry-After": "1" }, body: { error: "Too many requests" } } : { body: [TRUCK] }),
    "GET /v2/coursedates": { body: { items: [lagDato()], pagination: { next_page: null } } },
  });
  const { res } = await kall("/kurs");
  assert.equal(res.status, 200);
  assert.equal(forsok, 2);
  nullstill();
});

function bookingRuter(dato, bookingSvar = { body: BOOKING_OK }) {
  return {
    "GET /v2/coursedates": { body: { pagination: { next_page: null }, items: dato ? [dato] : [] } },
    "POST /v2/booking": bookingSvar,
  };
}

test("POST /pamelding: ledig plass gir bekreftet booking med plassjekk", async () => {
  mock(bookingRuter(lagDato()));
  const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kkurs.no");
  assert.deepEqual(data, { ok: true, ordre_id: "221530", total_inkl_mva: 17250, venteliste: false });

  const [hent, booking] = fcKall;
  assert.equal(hent.url.searchParams.get("coursedate_id"), "5001");
  assert.equal(booking.metode, "POST");
  assert.equal(booking.headers.get("Content-Type"), "application/json");
  assert.equal(booking.headers.get("X-API-Key"), TEST_NOKKEL);
  assert.equal(booking.body.coursedate_id, 5001);
  assert.equal(booking.body.payment_method, "invoice");
  assert.deepEqual(booking.body.participants.map((d) => d.status_id), [1, 1]);
  assert.equal(booking.body.config.seats_availability_check, true);
});

test("POST /pamelding: fullt kurs gir venteliste", async () => {
  mock(bookingRuter(fullt()));
  const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(res.status, 200);
  assert.equal(data.venteliste, true);
  const booking = fcKall.find((k) => k.metode === "POST");
  assert.deepEqual(booking.body.participants.map((d) => d.status_id), [3, 3]);
  assert.equal(booking.body.config.seats_availability_check, false);
});

test("POST /pamelding: for få plasser gir 409 uten booking", async () => {
  mock(bookingRuter(lagDato({ seats: { allocated_capacity: { num: 12 }, free: { num: 1 } } })));
  const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(res.status, 409);
  assert.deepEqual(data, { ok: false, feil: "Bare 1 plass igjen på denne datoen. Velg færre deltakere eller en annen dato." });
  assert.equal(fcKall.some((k) => k.metode === "POST"), false);
});

test("POST /pamelding: honningfelle svarer ok uten å gjøre noe", async () => {
  mock({});
  const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding({ nettside: "https://spam.example" }) });
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(fcKall.length, 0);
});

test("POST /pamelding: avvisning før FrontCore kalles", async () => {
  mock({});
  const tilfeller = [
    [{ origin: "https://ond.example", body: gyldigPamelding() }, 403],
    [{ origin: null, body: gyldigPamelding() }, 403], // nettlesere sender alltid Origin her
    [{ origin: "null", body: gyldigPamelding() }, 403],
    [{ origin: "https://kkurs.no.ond.example", body: gyldigPamelding() }, 403],
    [{ body: JSON.stringify(gyldigPamelding()), headers: { "Content-Type": "text/plain" } }, 415],
    [{ body: "{ikke json" }, 400],
    [{ body: gyldigPamelding({ kontakt: { navn: "Kari", epost: "feil" } }) }, 400],
    [{ body: gyldigPamelding({ bedrift: "x".repeat(21 * 1024) }) }, 413],
  ];
  for (const [valg, status] of tilfeller) {
    const { res, data } = await kall("/pamelding", { metode: "POST", ...valg });
    assert.equal(res.status, status, JSON.stringify(valg).slice(0, 80));
    assert.equal(data.ok, false);
    assert.equal(typeof data.feil, "string");
  }
  assert.equal(fcKall.length, 0);
});

test("POST /pamelding: ukjent dato, FrontCore-feil og nettverksfeil", async () => {
  mock(bookingRuter(null));
  let r = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(r.res.status, 404);

  mock(bookingRuter(lagDato(), { status: 400, body: { successful: false, errors: [{ code: "participant_name_invalid_empty", message: "Participant 2 must have a name specified." }] } }));
  r = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.deepEqual([r.res.status, r.data.feil], [400, "Alle deltakere må ha fornavn og etternavn."]);

  logg.length = 0;
  mock(bookingRuter(lagDato(), () => new TypeError("fetch failed")));
  r = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(r.res.status, 502);
  assert.equal(r.data.feil, USIKKER);
  assert.ok(logg.some((l) => l.includes("POST /booking")));

  mock({ "GET /v2/coursedates": { status: 503, body: "" } });
  r = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(r.res.status, 502);
});

test("POST /pamelding: usikre utfall av POST /v2/booking gir «usikre»-meldingen", async () => {
  const tidsavbrudd = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const tilfeller = [
    ["2xx med ukjent svar", { status: 200, body: {} }],
    ["2xx med tomt svar", { status: 201, body: "" }],
    ["2xx uten JSON", { status: 200, body: "<html>ok</html>" }],
    ["5xx", { status: 500, body: { error: "Internal Server Error" } }],
    ["5xx uten JSON", { status: 502, body: "<html>Bad gateway</html>" }],
    ["booking_could_not_be_created", { status: 422, body: { successful: false, errors: [{ code: "booking_could_not_be_created", message: "Booking could not be created." }] } }],
    ["order_could_not_be_created", { status: 200, body: { successful: false, errors: [{ code: "order_could_not_be_created", message: "Order could not be created." }] } }],
    ["nettverksfeil", () => new TypeError("fetch failed")],
    ["tidsavbrudd", () => tidsavbrudd],
  ];
  for (const [navn, svar] of tilfeller) {
    logg.length = 0;
    mock(bookingRuter(lagDato(), svar));
    const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
    assert.deepEqual([res.status, data], [502, { ok: false, feil: USIKKER }], navn);
    assert.equal(fcKall.filter((k) => k.metode === "POST").length, 1, `${navn}: POST skal aldri sendes på nytt`);
    assert.ok(logg.some((l) => l.includes("usikkert utfall")), `${navn}: skal logges som usikkert`);
  }

  // 4xx uten JSON: forespørselen ble avvist, så et nytt forsøk er trygt.
  mock(bookingRuter(lagDato(), { status: 400, body: "<html>Bad request</html>" }));
  const { data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.match(data.feil, /Prøv igjen om litt/);
});

test("POST /pamelding: påmeldingsfristen er ute ⇒ 409, også når datoen vises", async () => {
  for (const synlig of [true, "1", false]) {
    mock(bookingRuter(lagDato({ start_at: "2026-10-01", deadline_at: "2000-01-01", visible_when_passed_deadline: synlig })));
    const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
    assert.deepEqual([res.status, data], [409, { ok: false, feil: "Påmeldingsfristen er ute. Velg en annen dato, eller kontakt oss." }]);
    assert.equal(fcKall.some((k) => k.metode === "POST"), false);
  }
});

test("POST /pamelding: ukjent kapasitet (ledige: null) gir bekreftet påmelding uten plassjekk", async () => {
  const ukjent = lagDato({ seats_status: "open", seats: { allocated_capacity: { num: 0 }, free: { num: 0 }, booking_status: { num_confirmed: 2 } } });
  nullstill();
  mock({ "GET /v2/courses": { body: [TRUCK] }, "GET /v2/coursedates": { body: { items: [{ ...ukjent, course: TRUCK }], pagination: { next_page: null } } } });
  const liste = await kall("/kurs");
  assert.ok(liste.tekst.includes('"ledige":null'), "GET /kurs skal sende ledige: null");
  nullstill();

  mock(bookingRuter(ukjent));
  const { res, data } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  assert.equal(res.status, 200);
  assert.equal(data.venteliste, false);
  const booking = fcKall.find((k) => k.metode === "POST");
  assert.deepEqual(booking.body.participants.map((d) => d.status_id), [1, 1]);
  assert.equal(booking.body.config.seats_availability_check, false);
});

function lagGrense(maks) {
  const teller = new Map();
  const nokler = [];
  return {
    nokler,
    limit: async ({ key }) => {
      nokler.push(key);
      teller.set(key, (teller.get(key) ?? 0) + 1);
      return { success: teller.get(key) <= maks };
    },
  };
}

test("POST /pamelding: rate limiting per klient-IP gir 429 med norsk melding", async () => {
  const grense = lagGrense(5);
  const env = { ...ENV, PAMELDING_GRENSE: grense };
  const send = (ip, body = gyldigPamelding()) => kall("/pamelding", { metode: "POST", body, ip, env });
  mock(bookingRuter(lagDato()));
  for (let i = 1; i <= 5; i++) assert.equal((await send("203.0.113.7")).res.status, 200, `forsøk ${i}`);

  const antallFc = fcKall.length;
  const { res, data } = await send("203.0.113.7");
  assert.equal(res.status, 429);
  assert.deepEqual(data, { ok: false, feil: "For mange påmeldinger på kort tid. Vent et minutt og prøv igjen, eller kontakt oss." });
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://kkurs.no", "nettsiden må kunne lese meldingen");
  assert.equal(fcKall.length, antallFc, "FrontCore skal ikke kalles når grensen er nådd");

  // Annen IP har egen kvote; honningfelle-forsøk teller også.
  assert.equal((await send("198.51.100.2")).res.status, 200);
  for (let i = 0; i < 5; i++) await send("192.0.2.9", gyldigPamelding({ nettside: "spam" }));
  assert.equal((await send("192.0.2.9", gyldigPamelding({ nettside: "spam" }))).res.status, 429);
  assert.deepEqual([...new Set(grense.nokler)], ["pamelding:203.0.113.7", "pamelding:198.51.100.2", "pamelding:192.0.2.9"]);

  // Uten tillatt Origin avvises forespørselen før grensen telles.
  const antall = grense.nokler.length;
  assert.equal((await kall("/pamelding", { metode: "POST", body: gyldigPamelding(), origin: null, ip: "203.0.113.8", env })).res.status, 403);
  assert.equal(grense.nokler.length, antall);

  // Uten IP-header (lokalt) brukes en felles nøkkel.
  await kall("/pamelding", { metode: "POST", body: gyldigPamelding(), env });
  assert.equal(grense.nokler.at(-1), "pamelding:ukjent");
});

test("POST /pamelding: feil i rate limiting-bindingen stenger ikke ute påmeldinger", async () => {
  logg.length = 0;
  mock(bookingRuter(lagDato()));
  const env = { ...ENV, PAMELDING_GRENSE: { limit: async () => { throw new Error("grensen er nede"); } } };
  const { res } = await kall("/pamelding", { metode: "POST", body: gyldigPamelding(), ip: "203.0.113.7", env });
  assert.equal(res.status, 200);
  assert.ok(logg.some((l) => l.includes("rate limiting feilet")));
  // Og uten bindingen i det hele tatt (lokalt/tester):
  assert.equal((await kall("/pamelding", { metode: "POST", body: gyldigPamelding(), ip: "203.0.113.7" })).res.status, 200);
});

test("POST /pamelding: vellykket påmelding tømmer mellomlageret for /kurs", async () => {
  nullstill();
  mock(KURSRUTER);
  await kall("/kurs");
  mock(bookingRuter(lagDato()));
  await kall("/pamelding", { metode: "POST", body: gyldigPamelding() });
  mock(KURSRUTER);
  const { res } = await kall("/kurs");
  assert.equal(res.headers.get("X-Mellomlager"), "frontcore");
  assert.ok(fcKall.length > 0);
});

// ---------------------------------------------------------------- kjør

let feilet = 0;
for (const [navn, fn] of tester) {
  try {
    await fn();
    process.stdout.write(`  ok    ${navn}\n`);
  } catch (e) {
    feilet++;
    process.stdout.write(`  FEIL  ${navn}\n        ${String(e?.stack ?? e).split("\n").slice(0, 4).join("\n        ")}\n`);
  }
}
const lekk = logg.filter((l) => l.includes(TEST_NOKKEL));
if (lekk.length) {
  feilet++;
  process.stdout.write(`  FEIL  API-nøkkelen stod i ${lekk.length} logglinje(r)\n`);
}
process.stdout.write(`\n${tester.length - (lekk.length ? feilet - 1 : feilet)}/${tester.length} tester ok${lekk.length ? ", nøkkel lekket i logg" : ""}\n`);
process.exit(feilet ? 1 : 0);
