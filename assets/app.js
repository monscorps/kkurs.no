/* ============================================================
   kkurs.no — prototype for Kompetanse Kurs

   Alt kursinnhold hentes fra assets/kurs.json (én kilde —
   kursliste, kalender, kurssidene og påmelding oppdateres derfra
   automatisk). Samme skript kjører på forsiden og på kurssidene
   (kurs/<id>/, generert av tools/bygg.py); hver del starter bare
   hvis elementene finnes. Påmelding, betaling, e-poster og
   plasstelling er SIMULERT; ved lansering leveres alt av
   FrontCore via API.
   ============================================================ */

const APP_V = "30";
const VARSEL_EPOST = "bestilling@kkurs.no";
/* Adressen til kkurs-api (Cloudflare Worker, se docs/FRONTCORE.md). Tom = demomodus:
   kursene leses fra assets/kurs.json og påmelding simuleres i nettleseren. */
const API_URL = "";
const LIVE = Boolean(API_URL);

/* Emblemets elementer (indeks i logo.svg) gruppert per fagfelt, slik at
   peking kan dimme alt utenom det aktive feltet. g-fast = skive, ring
   og delelinjer som alltid står. */
const SEKTORER = {
  fast: [0, 1, 2, 7, 22, 26, 27, 30, 31],
  senter: [3, 11, 13, 16, 19, 46, 49],
  truck: [4, 12, 24, 25, 43, 44, 51],
  lift: [6, 10, 28, 29, 42, 47, 48, 50, 54],
  brann: [5, 8, 20, 21, 23, 32],
  fallsikring: [9, 15, 17, 33, 35, 36, 52, 53, 55],
  sertifikat: [14, 18, 34, 37, 38, 39, 40, 41, 45],
};

let KATEGORIER = {};
let COURSES = [];
let CAL = [];
let aktivKat = "alle";
let aktivSted = "Alle steder";

/* ---------- hjelpere ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtDato = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fmtDatoKort = (iso) => { const [, m, d] = iso.split("-"); return `${d}.${m}`; };
const fmtPris = (n) => `kr ${n.toLocaleString("nb-NO").replace(/,/g, " ")},–`;
const prisTekst = (c) => (c.pris ? `fra ${fmtPris(c.pris)}` : "Pris på forespørsel");
const kursBilde = (c) => `assets/img/${c.bilde || `kurs-${c.id}.jpg`}`;
const RESERVEBILDE = "assets/img/hero-alt-kurs.jpg";
const medKoder = (c) => (c.koder ? `${c.navn} (${c.koder})` : c.navn);
const kursSide = (c) => `kurs/${c.id}/`;

const esc = (t) => String(t ?? "").replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));

/* Status utledes av antall ledige plasser */
function statusFor(dt) {
  if (!Number.isFinite(dt.ledige)) return { cls: "status-ledig", label: "Ledige plasser" };
  if (dt.ledige <= 0) return { cls: "status-vente", label: "Venteliste" };
  if (dt.ledige <= 3) return { cls: "status-faa", label: `${dt.ledige} ${dt.ledige === 1 ? "plass" : "plasser"} igjen` };
  return { cls: "status-ledig", label: `${dt.ledige} ledige plasser` };
}

/* ---------- mobil: lange lister foldes bak «Vis alle» ----------
   Kortene/radene finnes alltid i DOM — .m-fold skjules kun av
   mobil-CSS (<=760px), så desktop viser alt uansett. */
const FOLD = { kalender: 6, nyheter: 1 };
const FOLD_ORD = { kalender: "datoer", nyheter: "nyheter" };
const FOLD_VELGER = { kalender: "#cal-body tr", nyheter: ".news-grid .news-card" };
const utvidet = { kalender: false, nyheter: false };

function foldeliste(nokkel) {
  const knapp = $(`#vis-alle-${nokkel}`);
  if (!knapp) return;
  const alle = $$(FOLD_VELGER[nokkel]);
  alle.forEach((el, i) => el.classList.toggle("m-fold", !utvidet[nokkel] && i >= FOLD[nokkel]));
  knapp.hidden = alle.length <= FOLD[nokkel];
  knapp.setAttribute("aria-expanded", String(utvidet[nokkel]));
  knapp.textContent = utvidet[nokkel]
    ? "Vis f\u00e6rre \u2191"
    : `Vis alle ${alle.length} ${FOLD_ORD[nokkel]} \u2193`;
}

/* ---------- kurskatalog ---------- */
function renderKursFilter() {
  const counts = { alle: COURSES.length };
  COURSES.forEach((c) => { counts[c.kat] = (counts[c.kat] || 0) + 1; });
  const chips = [["alle", "Alle kurs"], ...Object.entries(KATEGORIER).filter(([k]) => counts[k])];
  $("#kurs-filter").innerHTML = chips.map(([key, label]) => `
    <button class="chip" data-cat="${key}" aria-pressed="${key === aktivKat}">
      ${label}<span class="count">${counts[key] || 0}</span>
    </button>`).join("");
}

function renderCourses() {
  const list = COURSES.filter((c) => aktivKat === "alle" || c.kat === aktivKat);
  $("#course-grid").innerHTML = list.map((c) => {
    const datoer = c.datoer.slice(0, 3).map((dt, idx) => {
      const st = statusFor(dt);
      return `
        <li><button type="button" data-book="${c.id}" data-date="${idx}">
          <span class="kd-dato">${fmtDatoKort(dt.d)}</span>
          <span class="kd-sted">${dt.sted}${dt.merk ? ` \u00b7 ${dt.merk}` : ""}</span>
          <span class="status ${st.cls}">${st.label}</span>
        </button></li>`;
    }).join("");
    return `
    <article class="kursrad">
      <button class="kursrad-topp" type="button" aria-expanded="false" aria-controls="kursrad-${c.id}">
        <span class="kursrad-navn">${c.navn} <span class="cc-codes">${c.koder || ""}</span></span>
        <span class="kursrad-tall mono kr-var">${c.varighet || ""}</span>
        <span class="kursrad-tall mono">${prisTekst(c)}</span>
        <span class="kursrad-pil" aria-hidden="true">\u2193</span>
      </button>
      <div class="kursrad-innhold" id="kursrad-${c.id}" hidden>
        <figure class="kursrad-foto"><img src="${kursBilde(c)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${RESERVEBILDE}'"></figure>
        <div class="kursrad-tekst">
          <p>${c.desc}</p>
          <p class="kursrad-fakta mono">${[c.varighet, prisTekst(c)].filter(Boolean).join(" \u00b7 ")}</p>
          ${datoer
            ? `<ul class="kursrad-datoer">${datoer}</ul>`
            : `<p class="kursrad-ingen mono">Ingen faste datoer ennå — meld interesse, så tar vi kontakt.</p>`}
          <div class="kursrad-knapper">
            <button class="btn btn-signal btn-sm" data-book="${c.id}" data-date="${datoer ? 0 : "foresp\u00f8rsel"}">${datoer ? "Meld deg p\u00e5" : "Meld interesse"}</button>
            <a class="btn btn-ghost btn-sm" href="${kursSide(c)}">Les mer<span class="sr-only"> om ${c.navn}</span> <span aria-hidden="true">\u2192</span></a>
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
}

/* ---------- kurskalender ---------- */
function renderKalenderFilter() {
  const steder = ["Alle steder", ...new Set(CAL.map((e) => e.dt.sted))];
  $("#kalender-filter").innerHTML = steder.map((s) => `
    <button class="chip" data-sted="${s}" aria-pressed="${s === aktivSted}">${s}</button>`).join("");
}

function renderCal() {
  const rows = CAL.filter((e) => aktivSted === "Alle steder" || e.dt.sted === aktivSted);
  if (!rows.length) {
    $("#cal-body").innerHTML = `<tr><td colspan="6" class="cal-empty">Ingen oppsatte kurs her akkurat nå — be om tilbud, så setter vi opp kurs.</td></tr>`;
    foldeliste("kalender");
    return;
  }
  $("#cal-body").innerHTML = rows.map((e) => {
    const st = statusFor(e.dt);
    return `
    <tr>
      <td class="cal-date">${fmtDato(e.dt.d)}</td>
      <td class="cal-course"><a href="${kursSide(e.course)}">${e.course.navn}</a>${e.dt.merk ? ` (${e.dt.merk})` : ""}
        <span class="cal-codes">${e.course.koder || ""}</span></td>
      <td class="cal-sted">${e.dt.sted}</td>
      <td class="cal-dur">${e.course.varighet || ""}</td>
      <td class="cal-status"><span class="status ${st.cls}">${st.label}</span></td>
      <td class="cal-act"><button class="btn btn-ghost btn-sm" data-book="${e.course.id}" data-date="${e.idx}">${e.dt.ledige <= 0 ? "Venteliste" : "Meld deg på"}</button></td>
    </tr>`;
  }).join("");
  foldeliste("kalender");
}

/* ---------- kursside (kurs/<id>/): datoene rendres ferskt fra kurs.json ---------- */
function renderKurssideDatoer() {
  const liste = $("#kursside-datoer");
  if (!liste) return;
  const c = COURSES.find((x) => x.id === document.body.dataset.kurs);
  if (!c) return;
  liste.innerHTML = c.datoer.length
    ? c.datoer.map((dt, idx) => {
      const st = statusFor(dt);
      return `
      <li class="dato-rad">
        <span class="dato-dag mono">${fmtDato(dt.d)}</span>
        <span class="dato-sted">${dt.sted}${dt.merk ? ` \u00b7 ${dt.merk}` : ""}</span>
        <span class="status ${st.cls}">${st.label}</span>
        <button class="btn btn-signal btn-sm" data-book="${c.id}" data-date="${idx}">${dt.ledige <= 0 ? "Venteliste" : "Meld deg p\u00e5"}</button>
      </li>`;
    }).join("")
    : `<li class="dato-rad dato-rad--tom"><span>Ingen faste datoer ennå. Meld interesse, så gir vi beskjed når neste kurs settes opp — eller be om kurset bedriftsinternt.</span>
        <button class="btn btn-signal btn-sm" data-book="${c.id}" data-date="foresp\u00f8rsel">Meld interesse</button></li>`;
  const hoved = $("#kursside-hovedknapp");
  if (hoved) {
    const i = c.datoer.findIndex((dt) => dt.ledige > 0);
    const idx = i >= 0 ? i : (c.datoer.length ? 0 : "foresp\u00f8rsel");
    hoved.dataset.date = idx;
    hoved.textContent = idx === "foresp\u00f8rsel" ? "Meld interesse" : (c.datoer[idx].ledige > 0 ? "Meld deg p\u00e5" : "Venteliste");
  }
}

function renderAlt() {
  if ($("#course-grid")) renderCourses();
  if ($("#cal-body")) renderCal();
  renderKurssideDatoer();
}

/* ---------- påmeldingsmodal (FrontCore-attrapp) ---------- */
const modal = $("#modal");
const modalForm = $("#modal-form");
const modalSuccess = $("#modal-success");
let lastFocus = null;
let scrollLaas = 0;

function fyllKursSelect(valgtId) {
  $("#m-kurs").innerHTML = COURSES.map((c) =>
    `<option value="${c.id}" ${c.id === valgtId ? "selected" : ""}>${medKoder(c)}</option>`).join("");
}

function fyllDatoSelect(courseId, valgtIdx = 0) {
  const c = COURSES.find((x) => x.id === courseId);
  const opts = c.datoer.map((dt, i) => {
    const st = statusFor(dt);
    return `<option value="${i}" ${i === Number(valgtIdx) ? "selected" : ""}>${fmtDato(dt.d)} — ${dt.sted}${dt.merk ? ` (${dt.merk})` : ""} · ${st.label}</option>`;
  });
  opts.push(`<option value="forespørsel" ${valgtIdx === "forespørsel" ? "selected" : ""}>Annen dato / bedriftsinternt kurs (forespørsel)</option>`);
  $("#m-dato").innerHTML = opts.join("");
}

/* Én rad per deltaker (FrontCore krever navn per deltaker); verdiene bevares
   når antallet endres. Skjules ved forespørsel uten dato. */
function renderDeltakere() {
  const holder = $("#m-deltakere");
  if (!holder) return;
  const antall = Math.min(20, Math.max(1, parseInt($("#m-antall").value, 10) || 1));
  const gamle = $$(".deltaker-rad", holder).map((r) => ({
    fornavn: $(".d-fornavn", r).value, etternavn: $(".d-etternavn", r).value, epost: $(".d-epost", r).value,
  }));
  holder.innerHTML = Array.from({ length: antall }, (_, i) => {
    const v = gamle[i] || {};
    return `
      <div class="deltaker-rad">
        <span class="deltaker-nr" aria-hidden="true">${i + 1}.</span>
        <input class="d-fornavn" type="text" autocomplete="off" autocapitalize="words" placeholder="Fornavn" aria-label="Deltaker ${i + 1}: fornavn" required value="${esc(v.fornavn)}">
        <input class="d-etternavn" type="text" autocomplete="off" autocapitalize="words" placeholder="Etternavn" aria-label="Deltaker ${i + 1}: etternavn" required value="${esc(v.etternavn)}">
        <input class="d-epost" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="E-post (valgfritt)" aria-label="Deltaker ${i + 1}: e-post (valgfritt)" value="${esc(v.epost)}">
      </div>`;
  }).join("");
}

function hentDeltakere() {
  return $$("#m-deltakere .deltaker-rad").map((r) => ({
    fornavn: $(".d-fornavn", r).value.trim(),
    etternavn: $(".d-etternavn", r).value.trim(),
    epost: $(".d-epost", r).value.trim(),
  }));
}

function valgtDato() {
  const c = COURSES.find((x) => x.id === $("#m-kurs").value);
  const v = $("#m-dato").value;
  return { c, dt: v === "forespørsel" ? null : c.datoer[Number(v)] };
}

function oppdaterSum() {
  const { c, dt } = valgtDato();
  const antall = Math.max(1, parseInt($("#m-antall").value, 10) || 1);
  const felt = $("fieldset.deltakere");
  if (felt) felt.hidden = !dt;
  if (!dt) {
    $("#modal-sum").innerHTML = c.pris
      ? `<span>Annen dato / bedriftsinternt</span><strong>fra ${fmtPris(c.pris)} per deltaker</strong>`
      : `<span>Annen dato / bedriftsinternt</span><strong>Pris etter avtale</strong>`;
    return;
  }
  if (dt.ledige <= 0) {
    $("#modal-sum").innerHTML = `<span>Kurset er fullt — du settes på venteliste</span><strong>Ingen betaling nå</strong>`;
    return;
  }
  if (!c.pris) {
    $("#modal-sum").innerHTML = `<span>${antall} deltaker${antall > 1 ? "e" : ""}</span><strong>Pris på forespørsel</strong>`;
    return;
  }
  $("#modal-sum").innerHTML =
    `<span>${antall} deltaker${antall > 1 ? "e" : ""} × ${fmtPris(c.pris)}</span><strong>= ${fmtPris(c.pris * antall)}</strong>`;
}

function openModal(courseId, dateIdx = 0) {
  lastFocus = document.activeElement;
  fyllKursSelect(courseId);
  fyllDatoSelect(courseId, dateIdx);
  renderDeltakere();
  oppdaterSum();
  modalForm.hidden = false;
  modalSuccess.hidden = true;
  modal.hidden = false;
  laasScroll();
  $("#modal .modal-close").focus();
}

/* Kurssidene har påmeldingsknappene i statisk HTML: vent på kursdataene, og
   finnes ikke kurset (lastefeil, skjult kurs) går vi til kontaktskjemaet. */
async function apnePamelding(courseId, dateIdx) {
  await dataKlar;
  if (COURSES.some((c) => c.id === courseId)) openModal(courseId, dateIdx);
  else apneKontakt();
}

function closeModal() {
  modal.hidden = true;
  frigjorScroll();
  modalForm.reset();
  $$(".err", modalForm).forEach((el) => el.classList.remove("err"));
  if (lastFocus) lastFocus.focus();
}

function laasScroll() {
  scrollLaas = scrollY;
  document.body.style.top = `-${scrollLaas}px`;
  document.body.classList.add("modal-open");
}
function frigjorScroll() {
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  scrollTo({ top: scrollLaas, behavior: "instant" });
}

/* ---------- kontakt-popup («Be om tilbud» / «ta en prat») ---------- */
const kontaktModal = $("#kontakt-modal");
function apneKontakt() {
  lastFocus = document.activeElement;
  kontaktModal.hidden = false;
  laasScroll();
  $("#kontakt-modal .modal-close").focus();
}
function lukkKontakt() {
  kontaktModal.hidden = true;
  frigjorScroll();
  if (lastFocus) lastFocus.focus();
}

/* ---------- validering ---------- */
function valider(form) {
  let ok = true;
  $$("[required], input[type=email]", form).forEach((el) => {
    if (el.disabled || el.closest("[hidden]")) { el.classList.remove("err"); return; }
    const tom = el.required && (el.type === "checkbox" ? !el.checked : !el.value.trim());
    const ugyldig = el.type === "email" && el.value.trim() && !/^\S+@\S+\.\S+$/.test(el.value.trim());
    el.classList.toggle("err", tom || ugyldig);
    if ((tom || ugyldig) && ok) { el.focus(); ok = false; }
  });
  return ok;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}

/* ---------- hendelser ---------- */
document.addEventListener("click", (ev) => {
  const book = ev.target.closest("[data-book]");
  if (book) { apnePamelding(book.dataset.book, book.dataset.date || 0); return; }
  const lukk = ev.target.closest("[data-close]");
  if (lukk) { (lukk.closest("#kontakt-modal") ? lukkKontakt : closeModal)(); return; }
  if (ev.target.closest("[data-tilbud]")) { apneKontakt(); return; }
  const tilbud = ev.target.closest('a.btn[href="#kontakt"]');
  if (tilbud) { ev.preventDefault(); apneKontakt(); return; }
  /* kurssidene har <base href="../../">: «#x» ville ellers navigert til
     forsiden selv når målet finnes på denne siden */
  const anker = ev.target.closest('a[href^="#"]');
  if (anker && anker.getAttribute("href").length > 1 && document.querySelector("base")
      && !(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button)) {
    const mal = document.getElementById(anker.getAttribute("href").slice(1));
    if (mal) { ev.preventDefault(); mal.scrollIntoView(); if (anker.classList.contains("skip-link")) mal.focus(); return; }
  }
  const kopier = ev.target.closest("[data-kopier-lenke]");
  if (kopier) {
    const url = location.origin + location.pathname;
    if (!navigator.clipboard) { toast(url); return; }
    navigator.clipboard.writeText(url).then(
      () => toast("Lenken er kopiert — lim den inn i e-posten."),
      () => toast(url));
    return;
  }
  const demo = ev.target.closest("[data-demo-link]");
  if (demo) { ev.preventDefault(); toast("Plassholder-lenke — innholdet kommer ved lansering."); }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (!modal.hidden) closeModal();
  else if (kontaktModal && !kontaktModal.hidden) lukkKontakt();
});

$("#course-grid")?.addEventListener("click", (ev) => {
  const topp = ev.target.closest(".kursrad-topp");
  if (!topp) return;
  const apen = topp.getAttribute("aria-expanded") === "true";
  topp.setAttribute("aria-expanded", String(!apen));
  $("#" + topp.getAttribute("aria-controls")).hidden = apen;
});

$$(".vis-alle").forEach((knapp) => knapp.addEventListener("click", () => {
  const nokkel = knapp.id.replace("vis-alle-", "");
  utvidet[nokkel] = !utvidet[nokkel];
  foldeliste(nokkel);
  if (!utvidet[nokkel]) knapp.scrollIntoView({ block: "center" });
}));

$("#kurs-filter")?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  aktivKat = chip.dataset.cat;
  $$("#kurs-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCourses();
});

$("#kalender-filter")?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  aktivSted = chip.dataset.sted;
  $$("#kalender-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCal();
});

$("#m-kurs").addEventListener("change", () => { fyllDatoSelect($("#m-kurs").value); oppdaterSum(); });
$("#m-dato").addEventListener("change", oppdaterSum);
$("#m-antall").addEventListener("input", () => { renderDeltakere(); oppdaterSum(); });

/* ---------- bestillingsflyt (simulert) ---------- */
function visKvittering(tittel, detalj, flyt) {
  $("#modal-success h2").textContent = tittel;
  $("#success-detail").textContent = detalj;
  $("#success-flow").innerHTML = flyt.map((f) => `<li>${esc(f)}</li>`).join("");
  modalForm.hidden = true;
  modalSuccess.hidden = false;
}

async function sendPamelding(c, dt, antall) {
  const knapp = $('#modal-form button[type="submit"]');
  const tekst = knapp.textContent;
  knapp.disabled = true; knapp.setAttribute("aria-busy", "true"); knapp.textContent = "Sender …";
  const epost = $("#m-epost").value.trim();
  const bedrift = $("#m-bedrift").value.trim();
  try {
    const res = await fetch(`${API_URL}/pamelding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coursedate_id: dt.fc_id,
        kontakt: { navn: $("#m-navn").value.trim(), epost, telefon: $("#m-tlf").value.trim() },
        bedrift,
        orgnr: $("#m-orgnr").value.replace(/\s/g, ""),
        deltakere: hentDeltakere(),
        nettside: $("#m-nettside").value,
      }),
    });
    const svar = await res.json().catch(() => ({}));
    if (!res.ok || !svar.ok) {
      toast(svar.feil || "Påmeldingen kunne ikke sendes. Prøv igjen, eller kontakt oss.");
      return;
    }
    const flyt = [];
    if (svar.ordre_id) flyt.push(`Ordrenummer ${svar.ordre_id}`);
    flyt.push(svar.venteliste
      ? "Dere står på ventelisten — vi gir beskjed så snart det blir ledig plass"
      : svar.total_inkl_mva ? `Faktura på ${fmtPris(svar.total_inkl_mva)} inkl. mva sendes til ${bedrift || "deg"}` : "Faktura sendes etter kurset");
    flyt.push(`Bekreftelse sendes til ${epost}`);
    visKvittering(
      svar.venteliste ? "Du står på ventelisten." : "Takk! Påmeldingen er registrert.",
      `${medKoder(c)} · ${fmtDato(dt.d)} · ${dt.sted} · ${antall} deltaker${antall > 1 ? "e" : ""}`,
      flyt);
    hentKursdata().then(renderAlt).catch(() => {});
  } catch {
    toast("Fikk ikke kontakt med påmeldingen. Sjekk nettet og prøv igjen.");
  } finally {
    knapp.disabled = false; knapp.removeAttribute("aria-busy"); knapp.textContent = tekst;
  }
}

modalForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!valider(modalForm)) return;

  const { c, dt } = valgtDato();
  const antall = Math.max(1, parseInt($("#m-antall").value, 10) || 1);
  const epost = $("#m-epost").value.trim();
  const betaling = (modalForm.querySelector('[name="betaling"]:checked') || {}).value || "faktura";
  const venteliste = dt && dt.ledige <= 0;

  /* kapasitetssjekk */
  if (dt && !venteliste && antall > dt.ledige) {
    const felt = $("#m-antall");
    felt.classList.add("err"); felt.focus();
    toast(`Bare ${dt.ledige} ${dt.ledige === 1 ? "plass" : "plasser"} igjen på denne datoen — velg færre deltakere eller en annen dato.`);
    return;
  }

  if (LIVE && dt) { await sendPamelding(c, dt, antall); return; }
  if (LIVE && !dt) {
    /* interesse uten dato: videre til kontaktskjemaet, forhåndsutfylt */
    const [navn, epostK, tlf] = ["#m-navn", "#m-epost", "#m-tlf"].map((id) => $(id).value.trim());
    closeModal();
    apneKontakt();
    const sett = (id, v) => { const el = $(id); if (el) el.value = v; };
    sett("#f-navn", navn); sett("#f-epost", epostK); sett("#f-tlf", tlf);
    sett("#f-melding", `Interesse for ${medKoder(c)} — ${antall} deltaker${antall > 1 ? "e" : ""}. Ønsker dato / bedriftsinternt kurs.`);
    return;
  }

  /* demomodus: trekk ned ledige plasser og oppdater kalender/kort */
  if (dt && !venteliste) {
    dt.ledige = Math.max(0, dt.ledige - antall);
    renderAlt();
  }

  const datoTekst = dt ? `${fmtDato(dt.d)} · ${dt.sted}` : "annen dato / bedriftsinternt";
  $("#success-detail").textContent =
    `${medKoder(c)} · ${datoTekst} · ${antall} deltaker${antall > 1 ? "e" : ""}`;

  const flyt = [];
  if (venteliste) {
    flyt.push(`Du er satt på venteliste — vi kontakter deg på ${epost} ved ledig plass`);
  } else {
    if (!dt) flyt.push("Vi kontakter deg med forslag til dato og pris");
    else if (!c.pris) flyt.push("Vi sender pristilbud til bedriften");
    else flyt.push(betaling === "vipps"
      ? `Vipps-betaling på ${fmtPris(c.pris * antall)} gjennomføres`
      : `Faktura på ${fmtPris(c.pris * antall)} sendes til bedriften`);
    if (dt) flyt.push(`Ledige plasser i kalenderen er nedjustert (${statusFor(dt).label.toLowerCase()})`);
  }
  flyt.push(`Bekreftelse sendt til ${epost}`);
  flyt.push(`Varsel sendt til ${VARSEL_EPOST}`);
  $("#success-flow").innerHTML = flyt.map((f) => `<li>${f}</li>`).join("");

  $("#modal-success h2").textContent = venteliste
    ? "Du står på ventelisten."
    : dt ? "Takk! Påmeldingen er registrert." : "Takk! Vi har mottatt interessen din.";

  modalForm.hidden = true;
  modalSuccess.hidden = false;
});

$("#ny-pamelding").addEventListener("click", () => {
  modalForm.reset();
  fyllDatoSelect($("#m-kurs").value);
  renderDeltakere();
  oppdaterSum();
  modalSuccess.hidden = true;
  modalForm.hidden = false;
});

/* kontaktskjema — demo */
$("#kontakt-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!valider(form)) return;
  form.innerHTML = `
    <div class="modal-success" style="padding:0; text-align:left;">
      <h3 style="font-size:1.4rem;">Takk for henvendelsen!</h3>
      <p style="margin-top:.6rem;">Vi tar kontakt så snart som mulig — som regel innen én arbeidsdag.</p>
      <p class="form-note mono" style="margin-top:1rem;">Forhåndsvisning: ingen data er sendt.
      Ved lansering går forespørselen til post@kkurs.no / CRM.</p>
    </div>`;
});

/* ---------- fagområder: interaktivt emblem + fagstripe ---------- */
const glatt = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const caption = $("#emblem-caption");
const captionStandard = caption ? caption.textContent : "";

function visFag(navn) {
  if (caption) caption.innerHTML = navn ? `<strong>${navn}</strong> →` : captionStandard;
}

function velgFag(kat, mal) {
  if (mal) { const t = $(mal); if (t) t.scrollIntoView({ behavior: glatt }); return; }
  if (!$("#course-grid")) return;
  aktivKat = kat || "alle";
  renderKursFilter();
  renderCourses();
  $("#kurs").scrollIntoView({ behavior: glatt });
}

const emblem = $("#emblem");

/* Bytt <img> med selve SVG-en og merk hvert element med fagfelt-klasse,
   slik at CSS kan dimme alt utenom aktivt felt. */
async function lastEmblem() {
  if (!emblem) return;
  try {
    const txt = await (await fetch(`assets/img/logo.svg?v=${APP_V}`)).text();
    const holder = document.createElement("div");
    holder.innerHTML = txt;
    const svg = holder.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("width"); svg.removeAttribute("height");
    svg.setAttribute("role", "img");
    const bilde = emblem.querySelector("img");
    svg.setAttribute("aria-label", bilde ? bilde.alt : "Kompetanse Kurs-emblemet");
    const deler = svg.querySelectorAll("path, circle, polygon");
    deler.forEach((el) => el.classList.add("g-el"));
    Object.entries(SEKTORER).forEach(([grp, idxs]) =>
      idxs.forEach((i) => deler[i] && deler[i].classList.add(`g-${grp}`)));
    if (bilde) bilde.replaceWith(svg);
  } catch { /* beholder <img>-fallback */ }
}

function aktivSektor(s) {
  if (!emblem) return;
  if (s) emblem.dataset.aktiv = s; else delete emblem.dataset.aktiv;
}

/* touch har ingen hover: emblemets dimming vises på trykk 1, trykk 2 navigerer */
const beroring = matchMedia("(hover: none)").matches;
let sistSektor = null;
if (emblem) {
  emblem.addEventListener("mouseover", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (s) { visFag(s.dataset.navn); aktivSektor(s.dataset.sektor); }
  });
  emblem.addEventListener("mouseout", (ev) => {
    if (!ev.relatedTarget || !ev.relatedTarget.closest(".emblem-spot")) {
      visFag(null); aktivSektor(null); sistSektor = null;
    }
  });
  emblem.addEventListener("focusin", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (s) { visFag(s.dataset.navn); aktivSektor(s.dataset.sektor); }
  });
  emblem.addEventListener("focusout", () => { visFag(null); aktivSektor(null); sistSektor = null; });
  emblem.addEventListener("click", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (!s) return;
    if (beroring && s.dataset.sektor !== sistSektor) {
      sistSektor = s.dataset.sektor;
      aktivSektor(s.dataset.sektor);
      if (caption) caption.innerHTML = `<strong>${s.dataset.navn}</strong> — trykk igjen for å åpne`;
      return;
    }
    velgFag(s.dataset.kat, s.dataset.mal);
  });
}
$$(".fagstripe button, .fagfelt-side .btn[data-kat]").forEach((b) =>
  b.addEventListener("click", (ev) => { ev.preventDefault(); velgFag(b.dataset.kat); }));

/* ---------- nøkkeltall teller opp ---------- */
function tellOpp() {
  $$(".stats dd").forEach((dd) => {
    const m = dd.textContent.match(/^(\d+)(.*)$/s);
    if (!m) return;
    const maal = +m[1], suffiks = m[2], start = performance.now();
    const steg = (t) => {
      const p = Math.min(1, (t - start) / 900);
      dd.textContent = Math.round(maal * (1 - Math.pow(1 - p, 3))) + suffiks;
      if (p < 1) requestAnimationFrame(steg);
    };
    requestAnimationFrame(steg);
  });
}

/* ---------- nav ---------- */
const nav = $(".nav");
const burger = $(".nav-burger");
const menu = $("#hovedmeny");
const lesebar = $("#lesebar");
const fastNav = document.body.dataset.nav === "fast";
addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", fastNav || scrollY > 10);
  if (lesebar) {
    const m = document.documentElement.scrollHeight - innerHeight;
    lesebar.style.width = (m > 0 ? (scrollY / m) * 100 : 0) + "%";
  }
}, { passive: true });
burger.addEventListener("click", () => {
  const open = menu.classList.toggle("open");
  burger.setAttribute("aria-expanded", open);
  document.body.classList.toggle("menu-open", open);
});
menu.addEventListener("click", (ev) => {
  if (ev.target.tagName === "A") {
    menu.classList.remove("open");
    burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  }
});

/* ---------- scroll-avdekking ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
}, { threshold: 0.12, rootMargin: "0px 0px -40px" });

/* ---------- init ---------- */
/* Lastes siden i en skjult fane, hopp over inngangsanimasjonen */
if (document.visibilityState === "hidden") {
  document.documentElement.classList.add("no-anim");
  addEventListener("visibilitychange", () => {
    document.documentElement.classList.remove("no-anim");
  }, { once: true });
}

async function hentKursdata() {
  const res = await fetch(LIVE ? `${API_URL}/kurs` : "assets/kurs.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  KATEGORIER = data.kategorier;
  const idag = new Date().toLocaleDateString("sv-SE"); /* ÅÅÅÅ-MM-DD, lokal tid */
  COURSES = data.kurs.filter((c) => c.synlig !== false);
  COURSES.forEach((c) => {
    c.datoer = (c.datoer || []).filter((dt) => dt.d >= idag).sort((a, b) => a.d.localeCompare(b.d));
  });
  /* CAL peker på dato-objektene (ikke kopier), så plasstelling oppdateres overalt */
  CAL = COURSES.flatMap((c) => c.datoer.map((dt, idx) => ({ course: c, dt, idx })))
    .sort((a, b) => a.dt.d.localeCompare(b.dt.d));
}

async function init() {
  if (LIVE) {
    $("#m-vipps-valg")?.remove(); /* FrontCore-API-et tar faktura (og kort), ikke Vipps */
    const note = $("#m-note"), kv = $("#m-kvittering-note");
    if (note) note.textContent = "Påmeldingen registreres i kurssystemet vårt — du får bekreftelse på e-post.";
    if (kv) kv.textContent = "Spørsmål om påmeldingen? Svar på bekreftelsen, eller kontakt oss.";
  }
  try {
    await hentKursdata();
    if ($("#kurs-filter")) renderKursFilter();
    if ($("#kalender-filter")) renderKalenderFilter();
    renderAlt();
    lastEmblem();
  } catch (err) {
    const grid = $("#course-grid"), cal = $("#cal-body");
    if (grid) grid.innerHTML = `<p class="section-note mono">Kunne ikke laste kursdata (${err.message}). Prøv å laste siden på nytt.</p>`;
    if (cal) cal.innerHTML = `<tr><td colspan="6" class="cal-empty">Kunne ikke laste kurskalenderen.</td></tr>`;
  }
  /* hero-innholdet er alltid i første skjermbilde — vent aldri på
     IntersectionObserver der (den kan svikte i bakgrunnsfaner) */
  $$(".hero--foto .reveal").forEach((el) => el.classList.add("in"));
  foldeliste("nyheter");
  $$(".reveal").forEach((el) => io.observe(el));
  nav.classList.toggle("scrolled", fastNav || scrollY > 10);

  const statsEl = $(".stats");
  if (statsEl && glatt === "smooth") {
    new IntersectionObserver((entries, obs) => {
      if (entries[0].isIntersecting) { tellOpp(); obs.disconnect(); }
    }, { threshold: 0.4 }).observe(statsEl);
  }
}
const dataKlar = init();
