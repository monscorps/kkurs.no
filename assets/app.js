/* ============================================================
   kkurs.no — prototype for Kompetanse Kurs
   Kursdata under er EKSEMPELDATA. Ved lansering erstattes dette
   av FrontCore (embed/API), og «Meld deg på» peker til FrontCore-
   påmelding. Strukturen speiler feltene FrontCore leverer.
   ============================================================ */

const KATEGORIER = {
  truck: "Truck og maskin",
  kran: "Kran og løft",
  hms: "HMS og ledelse",
};

const COURSES = [
  {
    id: "truck", navn: "Truckførerkurs", koder: "T1–T4", kat: "truck",
    varighet: "3 dager", pris: 6900,
    desc: "Sertifisert sikkerhetsopplæring for gaffeltruck inntil 10 tonn. Teori og praksiskjøring med erfarne instruktører.",
    datoer: [
      { d: "2026-09-29", sted: "Bergen", status: "ledig" },
      { d: "2026-10-27", sted: "Bergen", status: "ledig" },
    ],
  },
  {
    id: "teleskop", navn: "Teleskoptruckkurs", koder: "C1–C2", kat: "truck",
    varighet: "2 dager", pris: 8500,
    desc: "For deg som skal kjøre teleskoptruck med fast eller rundtsvingende bom — sertifisert opplæring i klasse C1 og C2.",
    datoer: [
      { d: "2026-09-22", sted: "Bergen", status: "faa" },
      { d: "2026-11-17", sted: "Bergen", status: "ledig" },
    ],
  },
  {
    id: "maskin", navn: "Maskinførerkurs", koder: "M1–M6", kat: "truck",
    varighet: "4 dager", pris: 9500,
    desc: "Masseforflytningsmaskiner: gravemaskin, hjullaster, dumper og flere. Modulbasert — ta klassene dere trenger.",
    datoer: [{ d: "2026-11-03", sted: "Bergen", status: "ledig" }],
  },
  {
    id: "personlofter", navn: "Personløfterkurs", koder: "Klasse A–B", kat: "truck",
    varighet: "1 dag", pris: 3500,
    desc: "Dokumentert opplæring i sikker bruk av personløfter (lift), klasse A og B — for arbeid i høyden.",
    datoer: [{ d: "2026-11-10", sted: "Bergen", status: "ledig" }],
  },
  {
    id: "kran-g4", navn: "Kranførerkurs G4", koder: "Traverskran", kat: "kran",
    varighet: "3 dager + praksis", pris: 12900,
    desc: "Sertifisert opplæring for traverskran og søylesvingkran, med praksis på eget øvingsanlegg.",
    datoer: [{ d: "2026-10-13", sted: "Bergen", status: "faa" }],
  },
  {
    id: "kran-g8", navn: "Lastebilkrankurs G8", koder: "G8", kat: "kran",
    varighet: "3 dager", pris: 9900,
    desc: "Teori og praktisk bruk av lastebilmontert kran — inkludert lastsikring og daglig kontroll.",
    datoer: [{ d: "2026-11-05", sted: "Bergen", status: "ledig" }],
  },
  {
    id: "stropp", navn: "Stropp- og signalkurs", koder: "G11", kat: "kran",
    varighet: "2 dager", pris: 5900,
    desc: "Anhuking, stropping og signalgiving for alle som jobber rundt løfteoperasjoner.",
    datoer: [{ d: "2026-10-06", sted: "Bergen", status: "vente" }],
  },
  {
    id: "fallsikring", navn: "Fallsikringskurs", koder: "Dokumentert", kat: "hms",
    varighet: "1 dag", pris: 2900,
    desc: "Riktig bruk og kontroll av fallsikringsutstyr for trygt arbeid i høyden.",
    datoer: [{ d: "2026-10-08", sted: "Bergen", status: "ledig" }],
  },
  {
    id: "varme", navn: "Kurs i varme arbeider", koder: "Sertifikat 5 år", kat: "hms",
    varighet: "1 dag", pris: 2400,
    desc: "Sertifikatkurs for alle som utfører sveising, skjæring eller andre varme arbeider. Tilbys også på engelsk.",
    datoer: [
      { d: "2026-09-24", sted: "Bergen", status: "ledig", merk: "på engelsk" },
      { d: "2026-11-12", sted: "Bergen", status: "ledig" },
    ],
  },
  {
    id: "hms-leder", navn: "HMS-kurs for ledere", koder: "AML § 3-5", kat: "hms",
    varighet: "1 dag", pris: 3900,
    desc: "Lovpålagt HMS-opplæring for daglig leder og arbeidsgivere — praktisk og rett på sak.",
    datoer: [
      { d: "2026-10-01", sted: "Bergen", status: "ledig" },
      { d: "2026-11-19", sted: "Digitalt", status: "ledig" },
    ],
  },
  {
    id: "verneombud", navn: "Verneombudskurs", koder: "Grunnopplæring", kat: "hms",
    varighet: "2 dager", pris: 5500,
    desc: "Grunnopplæring i arbeidsmiljø for verneombud og AMU-medlemmer, tilpasset egen bransje.",
    datoer: [{ d: "2026-10-21", sted: "Bergen", status: "ledig" }],
  },
];

const STATUS = {
  ledig: { label: "Ledige plasser", cls: "status-ledig" },
  faa: { label: "Få plasser igjen", cls: "status-faa" },
  vente: { label: "Venteliste", cls: "status-vente" },
};

/* ---------- hjelpere ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtDato = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fmtDatoKort = (iso) => { const [, m, d] = iso.split("-"); return `${d}.${m}`; };
const fmtPris = (n) => `kr ${n.toLocaleString("nb-NO").replace(/,/g, " ")},–`;

/* Alle oppsatte datoer, flatet ut og sortert — dette blir kalenderen */
const CAL = COURSES.flatMap((c) => c.datoer.map((dt) => ({ ...dt, course: c })))
  .sort((a, b) => a.d.localeCompare(b.d));

/* ---------- «neste kurs»-kortet i hero ---------- */
function renderTicket() {
  const [first, ...rest] = CAL;
  const st = STATUS[first.status];
  $("#ticket-featured").innerHTML = `
    <h3 class="ticket-title">${first.course.navn} <span class="cc-codes">${first.course.koder}</span></h3>
    <dl class="ticket-meta mono">
      <dt>Dato</dt><dd>${fmtDato(first.d)}${first.merk ? ` · ${first.merk}` : ""}</dd>
      <dt>Sted</dt><dd>${first.sted}</dd>
      <dt>Varighet</dt><dd>${first.course.varighet}</dd>
      <dt>Status</dt><dd><span class="status ${st.cls}">${st.label}</span></dd>
    </dl>
    <div class="ticket-row-cta">
      <span class="ticket-price">fra ${fmtPris(first.course.pris)}</span>
      <button class="btn btn-signal btn-sm" data-book="${first.course.id}" data-date="0">Meld deg på</button>
    </div>`;
  $("#ticket-list").innerHTML = rest.slice(0, 3).map((e) => `
    <li><button data-book="${e.course.id}" data-date="${e.course.datoer.indexOf(e)}">
      <span class="tl-date">${fmtDatoKort(e.d)}</span>
      <span class="tl-name">${e.course.navn}${e.merk ? ` <em>(${e.merk})</em>` : ""}</span>
      <span class="tl-arrow" aria-hidden="true">→</span>
    </button></li>`).join("");
}

/* ---------- kurskatalog ---------- */
function renderKursFilter() {
  const counts = { alle: COURSES.length };
  COURSES.forEach((c) => { counts[c.kat] = (counts[c.kat] || 0) + 1; });
  const chips = [["alle", "Alle kurs"], ...Object.entries(KATEGORIER)];
  $("#kurs-filter").innerHTML = chips.map(([key, label]) => `
    <button class="chip" data-cat="${key}" aria-pressed="${key === "alle"}">
      ${label}<span class="count">${counts[key] || 0}</span>
    </button>`).join("");
}

function renderCourses(cat = "alle") {
  const list = COURSES.filter((c) => cat === "alle" || c.kat === cat);
  $("#course-grid").innerHTML = list.map((c) => {
    const neste = c.datoer[0];
    return `
    <article class="course-card">
      <div class="cc-top">
        <span class="cc-cat">${KATEGORIER[c.kat]}</span>
        <span class="cc-codes">${c.koder}</span>
      </div>
      <h3>${c.navn}</h3>
      <p class="cc-desc">${c.desc}</p>
      <div class="cc-meta"><span>${c.varighet}</span><span>fra ${fmtPris(c.pris)}</span></div>
      <div class="cc-foot">
        <span class="cc-next">Neste: <strong>${neste ? fmtDato(neste.d) : "på forespørsel"}</strong></span>
        <button class="btn btn-ghost btn-sm" data-book="${c.id}" data-date="0">Meld deg på</button>
      </div>
    </article>`;
  }).join("");
}

/* ---------- kurskalender ---------- */
function renderKalenderFilter() {
  const steder = ["Alle steder", ...new Set(CAL.map((e) => e.sted))];
  $("#kalender-filter").innerHTML = steder.map((s, i) => `
    <button class="chip" data-sted="${s}" aria-pressed="${i === 0}">${s}</button>`).join("");
}

function renderCal(sted = "Alle steder") {
  const rows = CAL.filter((e) => sted === "Alle steder" || e.sted === sted);
  if (!rows.length) {
    $("#cal-body").innerHTML = `<tr><td colspan="6" class="cal-empty">Ingen oppsatte kurs her akkurat nå — be om tilbud, så setter vi opp kurs.</td></tr>`;
    return;
  }
  $("#cal-body").innerHTML = rows.map((e) => {
    const st = STATUS[e.status];
    return `
    <tr>
      <td class="cal-date">${fmtDato(e.d)}</td>
      <td class="cal-course">${e.course.navn}${e.merk ? ` (${e.merk})` : ""}
        <span class="cal-codes">${e.course.koder} · fra ${fmtPris(e.course.pris)}</span></td>
      <td class="cal-sted">${e.sted}</td>
      <td class="cal-dur">${e.course.varighet}</td>
      <td><span class="status ${st.cls}">${st.label}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-book="${e.course.id}" data-date="${e.course.datoer.indexOf(e)}">Meld deg på</button></td>
    </tr>`;
  }).join("");
}

/* ---------- påmeldingsmodal (FrontCore-attrapp) ---------- */
const modal = $("#modal");
const modalForm = $("#modal-form");
const modalSuccess = $("#modal-success");
let lastFocus = null;

function fyllKursSelect(valgtId) {
  $("#m-kurs").innerHTML = COURSES.map((c) =>
    `<option value="${c.id}" ${c.id === valgtId ? "selected" : ""}>${c.navn} (${c.koder})</option>`).join("");
}

function fyllDatoSelect(courseId, valgtIdx = 0) {
  const c = COURSES.find((x) => x.id === courseId);
  const opts = c.datoer.map((dt, i) => {
    const st = STATUS[dt.status];
    return `<option value="${i}" ${i === Number(valgtIdx) ? "selected" : ""}>${fmtDato(dt.d)} — ${dt.sted}${dt.merk ? ` (${dt.merk})` : ""} · ${st.label}</option>`;
  });
  opts.push(`<option value="forespørsel">Annen dato / bedriftsinternt kurs (forespørsel)</option>`);
  $("#m-dato").innerHTML = opts.join("");
}

function oppdaterSum() {
  const c = COURSES.find((x) => x.id === $("#m-kurs").value);
  const antall = Math.max(1, parseInt($("#m-antall").value, 10) || 1);
  if ($("#m-dato").value === "forespørsel") {
    $("#modal-sum").innerHTML = `<span>Bedriftsinternt / annen dato</span><strong>Pris etter avtale</strong>`;
    return;
  }
  $("#modal-sum").innerHTML =
    `<span>${antall} deltaker${antall > 1 ? "e" : ""} × ${fmtPris(c.pris)}</span><strong>= ${fmtPris(c.pris * antall)}</strong>`;
}

function openModal(courseId, dateIdx = 0) {
  lastFocus = document.activeElement;
  fyllKursSelect(courseId);
  fyllDatoSelect(courseId, dateIdx);
  oppdaterSum();
  modalForm.hidden = false;
  modalSuccess.hidden = true;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  $(".modal-close").focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  modalForm.reset();
  $$(".err", modalForm).forEach((el) => el.classList.remove("err"));
  if (lastFocus) lastFocus.focus();
}

/* ---------- validering ---------- */
function valider(form) {
  let ok = true;
  $$("[required]", form).forEach((el) => {
    const tom = el.type === "checkbox" ? !el.checked : !el.value.trim();
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- hendelser ---------- */
document.addEventListener("click", (ev) => {
  const book = ev.target.closest("[data-book]");
  if (book) { openModal(book.dataset.book, book.dataset.date || 0); return; }
  if (ev.target.closest("[data-close]")) { closeModal(); return; }
  const demo = ev.target.closest("[data-demo-link]");
  if (demo) { ev.preventDefault(); toast("Plassholder-lenke — innholdet kommer ved lansering."); }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !modal.hidden) closeModal();
});

$("#kurs-filter").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  $$("#kurs-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCourses(chip.dataset.cat);
});

$("#kalender-filter").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  $$("#kalender-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCal(chip.dataset.sted);
});

$("#m-kurs").addEventListener("change", () => { fyllDatoSelect($("#m-kurs").value); oppdaterSum(); });
$("#m-dato").addEventListener("change", oppdaterSum);
$("#m-antall").addEventListener("input", oppdaterSum);

modalForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!valider(modalForm)) return;
  const c = COURSES.find((x) => x.id === $("#m-kurs").value);
  const datoVal = $("#m-dato").value;
  const antall = Math.max(1, parseInt($("#m-antall").value, 10) || 1);
  const datoTekst = datoVal === "forespørsel"
    ? "annen dato / bedriftsinternt"
    : `${fmtDato(c.datoer[datoVal].d)} · ${c.datoer[datoVal].sted}`;
  $("#success-detail").textContent =
    `${c.navn} (${c.koder}) · ${datoTekst} · ${antall} deltaker${antall > 1 ? "e" : ""}`;
  modalForm.hidden = true;
  modalSuccess.hidden = false;
  modalSuccess.querySelector("h2").focus?.();
});

$("#ny-pamelding").addEventListener("click", () => {
  modalForm.reset();
  fyllDatoSelect($("#m-kurs").value);
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

/* ---------- nav ---------- */
const nav = $(".nav");
const burger = $(".nav-burger");
const menu = $("#hovedmeny");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 10), { passive: true });
burger.addEventListener("click", () => {
  const open = menu.classList.toggle("open");
  burger.setAttribute("aria-expanded", open);
});
menu.addEventListener("click", (ev) => {
  if (ev.target.tagName === "A") { menu.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }
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
renderTicket();
renderKursFilter();
renderCourses();
renderKalenderFilter();
renderCal();
$$(".reveal").forEach((el) => io.observe(el));
nav.classList.toggle("scrolled", scrollY > 10);
