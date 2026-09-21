/* ============================================================
   kkurs.no — prototype for Kompetanse Kurs

   Alt kursinnhold hentes fra assets/kurs.json (én kilde —
   katalog, kalender, «neste kurs»-kort og påmelding oppdateres
   derfra automatisk). Påmelding, betaling (faktura/Vipps),
   e-poster og plasstelling er SIMULERT i denne forhåndsvisningen;
   ved lansering leveres alt av FrontCore (embed/API).
   ============================================================ */

const APP_V = "19";
const VARSEL_EPOST = "bestilling@kkurs.no";

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

/* Status utledes av antall ledige plasser */
function statusFor(dt) {
  if (dt.ledige <= 0) return { cls: "status-vente", label: "Venteliste" };
  if (dt.ledige <= 3) return { cls: "status-faa", label: `${dt.ledige} ${dt.ledige === 1 ? "plass" : "plasser"} igjen` };
  return { cls: "status-ledig", label: `${dt.ledige} ledige plasser` };
}

/* ---------- «neste kurs»-kortet i hero ---------- */
function renderTicket() {
  const [first, ...rest] = CAL;
  const st = statusFor(first.dt);
  $("#ticket-featured").innerHTML = `
    <h3 class="ticket-title">${first.course.navn} <span class="cc-codes">${first.course.koder}</span></h3>
    <dl class="ticket-meta mono">
      <dt>Dato</dt><dd>${fmtDato(first.dt.d)}${first.dt.merk ? ` · ${first.dt.merk}` : ""}</dd>
      <dt>Sted</dt><dd>${first.dt.sted}</dd>
      <dt>Varighet</dt><dd>${first.course.varighet}</dd>
      <dt>Status</dt><dd><span class="status ${st.cls}">${st.label}</span></dd>
    </dl>
    <div class="ticket-row-cta">
      <span class="ticket-price">fra ${fmtPris(first.course.pris)}</span>
      <button class="btn btn-signal btn-sm" data-book="${first.course.id}" data-date="${first.idx}">Meld deg på</button>
    </div>`;
  $("#ticket-list").innerHTML = rest.slice(0, 3).map((e) => `
    <li><button data-book="${e.course.id}" data-date="${e.idx}">
      <span class="tl-date">${fmtDatoKort(e.dt.d)}</span>
      <span class="tl-name">${e.course.navn}${e.dt.merk ? ` <em>(${e.dt.merk})</em>` : ""}</span>
      <span class="tl-arrow" aria-hidden="true">→</span>
    </button></li>`).join("");
}

/* ---------- kurskatalog ---------- */
function renderKursFilter() {
  const counts = { alle: COURSES.length };
  COURSES.forEach((c) => { counts[c.kat] = (counts[c.kat] || 0) + 1; });
  const chips = [["alle", "Alle kurs"], ...Object.entries(KATEGORIER)];
  $("#kurs-filter").innerHTML = chips.map(([key, label]) => `
    <button class="chip" data-cat="${key}" aria-pressed="${key === aktivKat}">
      ${label}<span class="count">${counts[key] || 0}</span>
    </button>`).join("");
}

function renderCourses() {
  const list = COURSES.filter((c) => aktivKat === "alle" || c.kat === aktivKat);
  $("#course-grid").innerHTML = list.map((c) => {
    const neste = c.datoer[0];
    return `
    <article class="course-card">
      <figure class="cc-img"><img src="assets/img/kurs-${c.id}.jpg" alt="" loading="lazy" width="900" height="600"></figure>
      <div class="cc-body">
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
    return;
  }
  $("#cal-body").innerHTML = rows.map((e) => {
    const st = statusFor(e.dt);
    return `
    <tr>
      <td class="cal-date">${fmtDato(e.dt.d)}</td>
      <td class="cal-course">${e.course.navn}${e.dt.merk ? ` (${e.dt.merk})` : ""}
        <span class="cal-codes">${e.course.koder} · fra ${fmtPris(e.course.pris)}</span></td>
      <td class="cal-sted">${e.dt.sted}</td>
      <td class="cal-dur">${e.course.varighet}</td>
      <td><span class="status ${st.cls}">${st.label}</span></td>
      <td><button class="btn btn-ghost btn-sm" data-book="${e.course.id}" data-date="${e.idx}">${e.dt.ledige <= 0 ? "Venteliste" : "Meld deg på"}</button></td>
    </tr>`;
  }).join("");
}

function renderAlt() { renderTicket(); renderCourses(); renderCal(); }

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
    const st = statusFor(dt);
    return `<option value="${i}" ${i === Number(valgtIdx) ? "selected" : ""}>${fmtDato(dt.d)} — ${dt.sted}${dt.merk ? ` (${dt.merk})` : ""} · ${st.label}</option>`;
  });
  opts.push(`<option value="forespørsel">Annen dato / bedriftsinternt kurs (forespørsel)</option>`);
  $("#m-dato").innerHTML = opts.join("");
}

function valgtDato() {
  const c = COURSES.find((x) => x.id === $("#m-kurs").value);
  const v = $("#m-dato").value;
  return { c, dt: v === "forespørsel" ? null : c.datoer[Number(v)] };
}

function oppdaterSum() {
  const { c, dt } = valgtDato();
  const antall = Math.max(1, parseInt($("#m-antall").value, 10) || 1);
  if (!dt) {
    $("#modal-sum").innerHTML = `<span>Bedriftsinternt / annen dato</span><strong>Pris etter avtale</strong>`;
    return;
  }
  if (dt.ledige <= 0) {
    $("#modal-sum").innerHTML = `<span>Kurset er fullt — du settes på venteliste</span><strong>Ingen betaling nå</strong>`;
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
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
  aktivKat = chip.dataset.cat;
  $$("#kurs-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCourses();
});

$("#kalender-filter").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  aktivSted = chip.dataset.sted;
  $$("#kalender-filter .chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
  renderCal();
});

$("#m-kurs").addEventListener("change", () => { fyllDatoSelect($("#m-kurs").value); oppdaterSum(); });
$("#m-dato").addEventListener("change", oppdaterSum);
$("#m-antall").addEventListener("input", oppdaterSum);

/* ---------- bestillingsflyt (simulert) ---------- */
modalForm.addEventListener("submit", (ev) => {
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

  /* trekk ned ledige plasser og oppdater kalender/kort */
  if (dt && !venteliste) {
    dt.ledige = Math.max(0, dt.ledige - antall);
    renderAlt();
  }

  const datoTekst = dt ? `${fmtDato(dt.d)} · ${dt.sted}` : "annen dato / bedriftsinternt";
  $("#success-detail").textContent =
    `${c.navn} (${c.koder}) · ${datoTekst} · ${antall} deltaker${antall > 1 ? "e" : ""}`;

  const flyt = [];
  if (venteliste) {
    flyt.push(`Du er satt på venteliste — vi kontakter deg på ${epost} ved ledig plass`);
  } else {
    flyt.push(betaling === "vipps"
      ? `Vipps-betaling på ${fmtPris(c.pris * antall)} gjennomføres`
      : `Faktura på ${fmtPris(c.pris * antall)} sendes til bedriften`);
    if (dt) flyt.push(`Ledige plasser i kalenderen er nedjustert (${statusFor(dt).label.toLowerCase()})`);
  }
  flyt.push(`Bekreftelse sendt til ${epost}`);
  flyt.push(`Varsel sendt til ${VARSEL_EPOST}`);
  $("#success-flow").innerHTML = flyt.map((f) => `<li>${f}</li>`).join("");

  $("#modal-success h2").textContent = venteliste
    ? "Du står på ventelisten."
    : "Takk! Påmeldingen er registrert.";

  modalForm.hidden = true;
  modalSuccess.hidden = false;
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

/* ---------- fagområder: interaktivt emblem + fagstripe ---------- */
const glatt = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const caption = $("#emblem-caption");
const captionStandard = caption ? caption.textContent : "";

function visFag(navn) {
  if (caption) caption.innerHTML = navn ? `<strong>${navn}</strong> →` : captionStandard;
}

function velgFag(kat, mal) {
  if (mal) { const t = $(mal); if (t) t.scrollIntoView({ behavior: glatt }); return; }
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

if (emblem) {
  emblem.addEventListener("mouseover", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (s) { visFag(s.dataset.navn); aktivSektor(s.dataset.sektor); }
  });
  emblem.addEventListener("mouseout", (ev) => {
    if (!ev.relatedTarget || !ev.relatedTarget.closest(".emblem-spot")) {
      visFag(null); aktivSektor(null);
    }
  });
  emblem.addEventListener("focusin", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (s) { visFag(s.dataset.navn); aktivSektor(s.dataset.sektor); }
  });
  emblem.addEventListener("focusout", () => { visFag(null); aktivSektor(null); });
  emblem.addEventListener("click", (ev) => {
    const s = ev.target.closest(".emblem-spot");
    if (s) velgFag(s.dataset.kat, s.dataset.mal);
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
addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", scrollY > 10);
  if (lesebar) {
    const m = document.documentElement.scrollHeight - innerHeight;
    lesebar.style.width = (m > 0 ? (scrollY / m) * 100 : 0) + "%";
  }
}, { passive: true });
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

async function init() {
  try {
    const res = await fetch(`assets/kurs.json?v=${APP_V}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    KATEGORIER = data.kategorier;
    COURSES = data.kurs;
    /* CAL peker på dato-objektene (ikke kopier), så plasstelling oppdateres overalt */
    CAL = COURSES.flatMap((c) => c.datoer.map((dt, idx) => ({ course: c, dt, idx })))
      .sort((a, b) => a.dt.d.localeCompare(b.dt.d));
    renderKursFilter();
    renderKalenderFilter();
    renderAlt();
    lastEmblem();
  } catch (err) {
    $("#course-grid").innerHTML = `<p class="section-note mono">Kunne ikke laste kursdata (${err.message}). Prøv å laste siden på nytt.</p>`;
    $("#cal-body").innerHTML = `<tr><td colspan="6" class="cal-empty">Kunne ikke laste kurskalenderen.</td></tr>`;
  }
  /* hero-innholdet er alltid i første skjermbilde — vent aldri på
     IntersectionObserver der (den kan svikte i bakgrunnsfaner) */
  $$(".hero--foto .reveal").forEach((el) => el.classList.add("in"));
  $$(".reveal").forEach((el) => io.observe(el));
  nav.classList.toggle("scrolled", scrollY > 10);

  const statsEl = $(".stats");
  if (statsEl && glatt === "smooth") {
    new IntersectionObserver((entries, obs) => {
      if (entries[0].isIntersecting) { tellOpp(); obs.disconnect(); }
    }, { threshold: 0.4 }).observe(statsEl);
  }
}
init();
