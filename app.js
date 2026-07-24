import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

(() => {
  "use strict";

  const STORAGE_KEY = "urlaubskalender-data-v1";
  const SAFE_REVISION_KEY = "urlaubskalender-safe-revision";
  const SAFE_AT_KEY = "urlaubskalender-safe-at";
  const VIEW_MODE_KEY = "urlaubskalender-view-mode";
  const FOCUS_DATE_KEY = "urlaubskalender-focus-date";
  const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const STATUS_NAMES = { planned: "geplant", requested: "beantragt", approved: "genehmigt", taken: "genommen" };
  const TYPE_NAMES = {
    vacation: "Urlaub",
    "own-free": "Freier Tag",
    "partner-free": "Partnerin frei",
    "comp-time": "Ausgleichsfrei",
    sick: "Krank",
    "saturday-work": "Samstagsarbeit",
    other: "Sonstiges"
  };

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAcgQenpjhxviXtmVffaesgfp4j-scRDXk",
    authDomain: "urlaubskalender-markus.firebaseapp.com",
    projectId: "urlaubskalender-markus",
    storageBucket: "urlaubskalender-markus.firebasestorage.app",
    messagingSenderId: "963868265217",
    appId: "1:963868265217:web:e1c97f66723f0f3725da900"
  };

  const firebaseApp = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(firebaseApp);
  let db;
  try {
    db = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (error) {
    console.warn("Persistenter Firebase-Cache konnte nicht aktiviert werden", error);
    db = getFirestore(firebaseApp);
  }

  let state = loadLocalState();
  let viewMode = ["year", "month", "week"].includes(localStorage.getItem(VIEW_MODE_KEY)) ? localStorage.getItem(VIEW_MODE_KEY) : "year";
  let focusDate = validDateKey(localStorage.getItem(FOCUS_DATE_KEY)) ? localStorage.getItem(FOCUS_DATE_KEY) : dateKey(new Date());
  let activeYear = parseDate(focusDate).getFullYear();
  let selectedDay = focusDate;
  let toastTimer = null;
  let currentUser = null;
  let cloudReady = false;
  let syncState = "signed-out";
  let lastSyncAt = null;
  let cloudUnsubscribers = [];
  let applyingCloudData = false;

  const $ = (id) => document.getElementById(id);
  const refs = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheRefs();
    bindEvents();
    ensureYearSettings(activeYear);
    renderAll();
    registerServiceWorker();
    initFirebaseAuth();
    window.addEventListener("online", () => updateConnectionStatus());
    window.addEventListener("offline", () => updateConnectionStatus());
  }

  function cacheRefs() {
    [
      "toast", "accountButton", "accountBarButton", "accountMenuButton", "backupBarButton", "loadButton", "backupHeadline", "backupDetails", "menuButton",
      "prevYear", "nextYear", "yearButton", "todayButton", "addEntryButton", "addSeriesButton",
      "summaryCards", "calendar", "entryFilter", "entryList", "commonFreeList", "sideMenu", "backupStatus", "settingsButton",
      "seriesListButton", "exportButton", "importInput", "backupHelpButton", "printButton",
      "entryDialog", "entryForm", "entryDialogTitle", "entryId", "entryType", "entryStatus", "entryStart", "entryEnd", "entryDayPart",
      "entryNote", "entryPreview", "deleteEntryButton", "statusField", "dayPartField", "seriesDialog", "seriesForm", "seriesDialogTitle",
      "seriesId", "seriesType", "seriesWeekday", "seriesInterval", "seriesStart", "seriesEnd", "seriesTitle", "deleteSeriesButton",
      "settingsDialog", "settingsForm", "ownName", "partnerName", "annualLeave", "carryOver", "holidaysEnabled", "settingsYearLabel",
      "seriesListDialog", "seriesList", "newSeriesFromList", "backupHelpDialog", "legendOwn", "legendPartner",
      "dayDialog", "dayDialogTitle", "dayItemList", "addEntryForDayButton",
      "occurrenceDialog", "occurrenceForm", "occurrenceDialogTitle", "occurrenceSeriesId", "occurrenceOriginalDate",
      "occurrenceInfo", "occurrenceNewDate", "cancelOccurrenceButton", "resetOccurrenceButton",
      "loginDialog", "loginForm", "loginEmail", "loginPassword", "loginError", "loginSubmitButton"
    ].forEach(id => refs[id] = $(id));
  }

  function bindEvents() {
    refs.prevYear.addEventListener("click", () => navigatePeriod(-1));
    refs.nextYear.addEventListener("click", () => navigatePeriod(1));
    refs.yearButton.addEventListener("click", () => {
      const year = Number(prompt("Jahr eingeben", String(activeYear)));
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
        const current = parseDate(focusDate);
        const day = Math.min(current.getDate(), new Date(year, current.getMonth() + 1, 0).getDate());
        setFocusDate(dateKey(new Date(year, current.getMonth(), day)));
      }
    });
    refs.todayButton.addEventListener("click", () => setFocusDate(dateKey(new Date())));
    document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => setViewMode(button.dataset.view)));
    refs.addEntryButton.addEventListener("click", () => openEntryDialog());
    refs.addSeriesButton.addEventListener("click", () => openSeriesDialog());
    refs.menuButton.addEventListener("click", openMenu);
    document.querySelectorAll("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
    document.querySelectorAll("[data-close-dialog]").forEach(el => el.addEventListener("click", () => $(el.dataset.closeDialog).close()));

    refs.settingsButton.addEventListener("click", () => { closeMenu(); openSettings(); });
    refs.seriesListButton.addEventListener("click", () => { closeMenu(); renderSeriesList(); refs.seriesListDialog.showModal(); });
    refs.newSeriesFromList.addEventListener("click", () => { refs.seriesListDialog.close(); openSeriesDialog(); });
    refs.accountButton.addEventListener("click", handleAccountAction);
    refs.accountBarButton.addEventListener("click", handleAccountAction);
    refs.accountMenuButton.addEventListener("click", () => { closeMenu(); handleAccountAction(); });
    refs.backupBarButton.addEventListener("click", exportBackup);
    refs.exportButton.addEventListener("click", () => { closeMenu(); exportBackup(); });
    refs.loadButton.addEventListener("click", () => refs.importInput.click());
    refs.importInput.addEventListener("change", importBackup);
    refs.backupHelpButton.addEventListener("click", () => { closeMenu(); refs.backupHelpDialog.showModal(); });
    refs.printButton.addEventListener("click", () => { closeMenu(); window.print(); });
    refs.loginForm.addEventListener("submit", loginFromForm);

    refs.entryForm.addEventListener("submit", saveEntryFromForm);
    refs.entryType.addEventListener("change", updateEntryFormVisibility);
    [refs.entryStart, refs.entryEnd, refs.entryType, refs.entryDayPart].forEach(el => el.addEventListener("change", updateEntryPreview));
    refs.deleteEntryButton.addEventListener("click", deleteCurrentEntry);

    refs.seriesForm.addEventListener("submit", saveSeriesFromForm);
    refs.seriesType.addEventListener("change", updateSeriesFormLabels);
    refs.seriesWeekday.addEventListener("change", updateSeriesFormLabels);
    refs.deleteSeriesButton.addEventListener("click", deleteCurrentSeries);
    refs.settingsForm.addEventListener("submit", saveSettingsFromForm);
    refs.entryFilter.addEventListener("change", renderEntryList);
    refs.addEntryForDayButton.addEventListener("click", () => { refs.dayDialog.close(); openEntryDialog(null, selectedDay); });
    refs.occurrenceForm.addEventListener("submit", moveOccurrenceFromForm);
    refs.cancelOccurrenceButton.addEventListener("click", cancelCurrentOccurrence);
    refs.resetOccurrenceButton.addEventListener("click", resetCurrentOccurrence);
  }

  function defaultState() {
    return {
      schemaVersion: 2,
      revision: 0,
      updatedAt: new Date().toISOString(),
      names: { own: "Markus", partner: "Frederike" },
      yearSettings: {},
      entries: [],
      series: []
    };
  }

  function loadLocalState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return normalizeState(parsed || defaultState());
    } catch (error) {
      console.warn("Lokale Daten konnten nicht gelesen werden", error);
      return defaultState();
    }
  }

  function normalizeState(input) {
    const base = defaultState();
    const next = { ...base, ...(input || {}) };
    next.names = { ...base.names, ...(input?.names || {}) };
    next.yearSettings = input?.yearSettings && typeof input.yearSettings === "object" ? input.yearSettings : {};
    next.entries = Array.isArray(input?.entries) ? input.entries : [];
    next.series = Array.isArray(input?.series) ? input.series.map(item => ({
      ...item,
      overrides: Array.isArray(item?.overrides) ? item.overrides.filter(o => o && o.originalDate).map(o => ({
        originalDate: o.originalDate,
        date: o.date || o.originalDate,
        cancelled: Boolean(o.cancelled),
        updatedAt: o.updatedAt || new Date().toISOString()
      })) : []
    })) : [];
    next.revision = Number.isFinite(Number(input?.revision)) ? Number(input.revision) : 0;
    next.schemaVersion = 2;
    return next;
  }

  function ensureYearSettings(year) {
    if (!state.yearSettings[year]) {
      state.yearSettings[year] = {
        annualLeave: 30,
        carryOver: 0,
        workdays: [1, 2, 3, 4, 5],
        holidaysEnabled: true
      };
      saveLocal(false);
    }
    const ys = state.yearSettings[year];
    ys.workdays = Array.isArray(ys.workdays) ? ys.workdays.map(Number) : [1,2,3,4,5];
    if (typeof ys.holidaysEnabled !== "boolean") ys.holidaysEnabled = true;
  }

  function saveLocal(isUserChange = true) {
    if (isUserChange) {
      state.revision = (Number(state.revision) || 0) + 1;
      state.updatedAt = new Date().toISOString();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateBackupUi();
  }

  function changeYear(year) {
    const current = parseDate(focusDate);
    const day = Math.min(current.getDate(), new Date(year, current.getMonth() + 1, 0).getDate());
    setFocusDate(dateKey(new Date(year, current.getMonth(), day)));
  }

  function setViewMode(mode) {
    if (!["year", "month", "week"].includes(mode)) return;
    viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
    renderAll();
  }

  function setFocusDate(key) {
    if (!validDateKey(key)) return;
    focusDate = key;
    activeYear = parseDate(key).getFullYear();
    localStorage.setItem(FOCUS_DATE_KEY, focusDate);
    ensureYearSettings(activeYear);
    renderAll();
  }

  function navigatePeriod(direction) {
    const current = parseDate(focusDate);
    if (viewMode === "year") {
      changeYear(activeYear + direction);
      return;
    }
    if (viewMode === "month") {
      const day = current.getDate();
      const target = new Date(current.getFullYear(), current.getMonth() + direction, 1);
      target.setDate(Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
      setFocusDate(dateKey(target));
      return;
    }
    setFocusDate(dateKey(addDays(current, direction * 7)));
  }

  function renderAll() {
    refs.yearButton.textContent = periodLabel();
    document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === viewMode));
    refs.calendar.className = `calendar-grid view-${viewMode}`;
    refs.calendar.setAttribute("aria-label", viewMode === "year" ? "Jahreskalender" : viewMode === "month" ? "Monatskalender" : "Wochenkalender");
    const unit = viewMode === "year" ? "Jahr" : viewMode === "month" ? "Monat" : "Woche";
    refs.prevYear.setAttribute("aria-label", `Vorheriges ${unit}`);
    refs.nextYear.setAttribute("aria-label", `Nächstes ${unit}`);
    refs.legendOwn.textContent = `${state.names.own} Urlaub`;
    refs.legendPartner.textContent = `${state.names.partner} frei`;
    const partnerFilter = refs.entryFilter?.querySelector('option[value="partner-free"]');
    if (partnerFilter) partnerFilter.textContent = `${state.names.partner} frei`;
    renderSummary();
    renderCalendar();
    renderEntryList();
    renderCommonFree();
    updateBackupUi();
  }

  function renderSummary() {
    const ys = state.yearSettings[activeYear];
    const total = num(ys.annualLeave) + num(ys.carryOver);
    const { booked, approved, taken } = calculateVacationTotals(activeYear);
    const remaining = total - booked;
    const cards = [
      ["Jahresurlaub", formatDays(ys.annualLeave), `${activeYear}`],
      ["Resturlaub", formatDays(ys.carryOver), "aus dem Vorjahr"],
      ["Gesamt", formatDays(total), "verfügbar"],
      ["Verplant", formatDays(booked), `${formatDays(approved)} genehmigt`],
      ["Noch frei", formatDays(remaining), `${formatDays(taken)} genommen`, remaining < 0 ? "negative" : ""]
    ];
    refs.summaryCards.innerHTML = cards.map(([label, value, sub, cls = ""]) => `
      <article class="summary-card card ${cls}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        <div class="subvalue">${escapeHtml(sub)}</div>
      </article>`).join("");
  }

  function renderCalendar() {
    if (viewMode === "month") renderMonthCalendar();
    else if (viewMode === "week") renderWeekCalendar();
    else renderYearCalendar();
    refs.calendar.querySelectorAll("[data-date]").forEach(button => button.addEventListener("click", () => openDay(button.dataset.date)));
  }

  function renderYearCalendar() {
    const today = dateKey(new Date());
    const holidays = getHolidayMap(activeYear);
    let html = "";
    for (let month = 0; month < 12; month++) {
      const first = new Date(activeYear, month, 1);
      const daysInMonth = new Date(activeYear, month + 1, 0).getDate();
      const mondayIndex = (first.getDay() + 6) % 7;
      html += `<article class="month-card"><div class="month-title"><h3>${MONTH_NAMES[month]}</h3><span>${activeYear}</span></div>`;
      html += `<div class="weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="days-grid">`;
      for (let i = 0; i < mondayIndex; i++) html += `<span class="day-cell blank"></span>`;
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(activeYear, month, day);
        const key = dateKey(date);
        const info = getDayInfo(key);
        const classes = dayClasses(key, date, info, today, holidays);
        const titleParts = dayTitleParts(key, info, holidays);
        const halfBadge = info.items.some(i => i.type === "vacation" && i.dayPart === "half" && i.start === i.end) ? `<span class="half-badge">½</span>` : "";
        const markerTypes = [...new Set(info.items.map(item => item.type))];
        const markers = markerTypes.map(type => `<i class="day-marker ${type}"></i>`).join("");
        html += `<button class="${classes.join(" ")}" type="button" data-date="${key}" title="${escapeAttr(titleParts.join(" · "))}">
          <span class="day-number">${day}</span>${halfBadge}<span class="day-markers">${markers}</span>
        </button>`;
      }
      html += `</div></article>`;
    }
    refs.calendar.innerHTML = html;
  }

  function renderMonthCalendar() {
    const focus = parseDate(focusDate);
    const year = focus.getFullYear();
    const month = focus.getMonth();
    const today = dateKey(new Date());
    const holidays = getHolidayMap(year);
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayIndex = (first.getDay() + 6) % 7;
    let html = `<article class="month-card month-detail-card"><div class="month-title detail-title"><h3>${MONTH_NAMES[month]} ${year}</h3><span>Einträge werden direkt im Tag angezeigt</span></div>`;
    html += `<div class="weekdays detail-weekdays"><span>Montag</span><span>Dienstag</span><span>Mittwoch</span><span>Donnerstag</span><span>Freitag</span><span>Samstag</span><span>Sonntag</span></div><div class="days-grid month-detail-grid">`;
    for (let i = 0; i < mondayIndex; i++) html += `<span class="day-cell detail-day blank"></span>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);
      const info = getDayInfo(key);
      const classes = dayClasses(key, date, info, today, holidays);
      classes.push("detail-day");
      const holiday = holidays.get(key);
      const chips = info.items.slice(0, 4).map(renderCalendarChip).join("");
      const more = info.items.length > 4 ? `<span class="more-events">+${info.items.length - 4} weitere</span>` : "";
      html += `<button class="${classes.join(" ")}" type="button" data-date="${key}" title="${escapeAttr(dayTitleParts(key, info, holidays).join(" · "))}">
        <span class="detail-day-head"><strong>${day}</strong>${holiday ? `<em>${escapeHtml(holiday)}</em>` : ""}</span>
        <span class="calendar-event-list">${chips}${more}</span>
      </button>`;
    }
    const used = mondayIndex + daysInMonth;
    const trailing = (7 - (used % 7)) % 7;
    for (let i = 0; i < trailing; i++) html += `<span class="day-cell detail-day blank"></span>`;
    html += `</div></article>`;
    refs.calendar.innerHTML = html;
  }

  function renderWeekCalendar() {
    const focus = parseDate(focusDate);
    const start = startOfWeek(focus);
    const end = addDays(start, 6);
    const today = dateKey(new Date());
    let html = `<article class="week-card card"><div class="week-heading"><div><p class="eyebrow">Kalenderwoche ${isoWeekNumber(focus)}</p><h3>${formatShortRange(dateKey(start), dateKey(end))}</h3></div><span>Alle Termine der Woche</span></div><div class="week-grid">`;
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(start, offset);
      const key = dateKey(date);
      const holidays = getHolidayMap(date.getFullYear());
      const info = getDayInfo(key);
      const classes = dayClasses(key, date, info, today, holidays);
      classes.push("week-day");
      const holiday = holidays.get(key);
      const chips = info.items.map(renderCalendarChip).join("");
      html += `<button class="${classes.join(" ")}" type="button" data-date="${key}" title="${escapeAttr(dayTitleParts(key, info, holidays).join(" · "))}">
        <span class="week-day-head"><span>${WEEKDAY_NAMES[date.getDay()]}</span><strong>${date.getDate()}.${date.getMonth() + 1}.</strong></span>
        ${holiday ? `<span class="holiday-name">${escapeHtml(holiday)}</span>` : ""}
        <span class="calendar-event-list">${chips || `<span class="no-events">Keine Einträge</span>`}</span>
      </button>`;
    }
    html += `</div></article>`;
    refs.calendar.innerHTML = html;
  }

  function renderCalendarChip(item) {
    const moved = item.isMoved ? " ↪" : "";
    const half = item.type === "vacation" && item.dayPart === "half" ? " ½" : "";
    return `<span class="calendar-event ${item.type}">${escapeHtml(item.title || displayTypeName(item.type))}${moved}${half}</span>`;
  }

  function dayClasses(key, date, info, today, holidays) {
    const classes = ["day-cell"];
    if ([0, 6].includes(date.getDay())) classes.push("weekend");
    if (key === today) classes.push("today");
    if (holidays.has(key)) classes.push("holiday");
    if (info.ownFree && info.partnerFree) classes.push("both-free");
    return classes;
  }

  function dayTitleParts(key, info, holidays) {
    const parts = [];
    if (holidays.has(key)) parts.push(holidays.get(key));
    info.items.forEach(item => parts.push(`${item.title}${item.isMoved ? " (verschoben)" : ""}`));
    return parts;
  }

  function periodLabel() {
    const focus = parseDate(focusDate);
    if (viewMode === "month") return `${MONTH_NAMES[focus.getMonth()]} ${focus.getFullYear()}`;
    if (viewMode === "week") return `KW ${isoWeekNumber(focus)} · ${formatShortRange(dateKey(startOfWeek(focus)), dateKey(addDays(startOfWeek(focus), 6)))}`;
    return String(activeYear);
  }

  function renderEntryList() {
    const filter = refs.entryFilter.value || "all";
    const entries = state.entries
      .filter(e => rangeTouchesYear(e.start, e.end, activeYear))
      .filter(e => filter === "all" || e.type === filter)
      .sort((a,b) => a.start.localeCompare(b.start));

    if (!entries.length) {
      refs.entryList.innerHTML = `<div class="empty-state">Für ${activeYear} sind noch keine passenden Einträge vorhanden.</div>`;
      return;
    }
    refs.entryList.innerHTML = entries.map(entry => {
      const title = entry.note || displayTypeName(entry.type);
      const dayText = entry.type === "vacation" ? ` · ${formatDays(countVacationDays(entry.start, entry.end, entry.dayPart, activeYear))}` : "";
      const statusText = entry.type === "vacation" ? ` · ${STATUS_NAMES[entry.status] || "geplant"}` : "";
      return `<div class="entry-item">
        <i class="entry-swatch ${entry.type}"></i>
        <div class="entry-main"><div class="entry-title">${escapeHtml(title)}</div><div class="entry-meta">${formatRange(entry.start, entry.end)}${dayText}${statusText}</div></div>
        <div class="entry-actions"><button class="small-button" type="button" data-edit-entry="${entry.id}">Bearbeiten</button></div>
      </div>`;
    }).join("");
    refs.entryList.querySelectorAll("[data-edit-entry]").forEach(btn => btn.addEventListener("click", () => openEntryDialog(btn.dataset.editEntry)));
  }

  function renderCommonFree() {
    const ranges = calculateCommonFreeRanges(activeYear);
    if (!ranges.length) {
      refs.commonFreeList.innerHTML = `<div class="empty-state">Noch keine gemeinsamen freien Tage gefunden.</div>`;
      return;
    }
    refs.commonFreeList.innerHTML = ranges.slice(0, 20).map(range => {
      const days = daysBetween(range.start, range.end) + 1;
      return `<div class="common-item"><strong>${formatRange(range.start, range.end)}</strong><span>${days} Kalendertag${days === 1 ? "" : "e"}</span></div>`;
    }).join("");
  }

  function renderSeriesList() {
    const series = [...state.series].sort((a,b) => a.start.localeCompare(b.start));
    if (!series.length) {
      refs.seriesList.innerHTML = `<div class="empty-state">Noch keine Serientermine angelegt.</div>`;
      return;
    }
    refs.seriesList.innerHTML = series.map(item => {
      const exceptions = Array.isArray(item.overrides) ? item.overrides.length : 0;
      const exceptionText = exceptions ? ` · ${exceptions} Ausnahme${exceptions === 1 ? "" : "n"}` : "";
      return `<div class="entry-item">
        <i class="entry-swatch ${item.type}"></i>
        <div class="entry-main"><div class="entry-title">${escapeHtml(item.title)}</div><div class="entry-meta">${WEEKDAY_NAMES[item.weekday]} · ${intervalName(item.interval)} · ${formatRange(item.start, item.end)}${exceptionText}</div></div>
        <div class="entry-actions"><button class="small-button" type="button" data-edit-series="${item.id}">Bearbeiten</button></div>
      </div>`;
    }).join("");
    refs.seriesList.querySelectorAll("[data-edit-series]").forEach(btn => btn.addEventListener("click", () => {
      refs.seriesListDialog.close();
      openSeriesDialog(btn.dataset.editSeries);
    }));
  }

  function openDay(date) {
    selectedDay = date;
    const info = getDayInfo(date);
    if (!info.items.length) {
      openEntryDialog(null, date);
      return;
    }
    renderDayDialog(date, info);
    refs.dayDialog.showModal();
  }

  function renderDayDialog(date, info = getDayInfo(date)) {
    selectedDay = date;
    refs.dayDialogTitle.textContent = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(parseDate(date));
    const holiday = getHolidayMap(parseDate(date).getFullYear()).get(date);
    const rows = [];
    if (holiday) rows.push(`<div class="entry-item"><i class="entry-swatch holiday-swatch"></i><div class="entry-main"><div class="entry-title">${escapeHtml(holiday)}</div><div class="entry-meta">Gesetzlicher Feiertag in Niedersachsen</div></div></div>`);
    info.items.forEach(item => {
      const isSeriesItem = item.source === "series" || item.source === "series-exception";
      const meta = isSeriesItem
        ? item.source === "series-exception" ? "Ausnahme von einem Serientermin" : `Serientermin${item.isMoved ? ` · verschoben von ${formatSingleDate(item.originalDate)}` : ""}`
        : `${item.type === "vacation" ? STATUS_NAMES[item.status] || "geplant" : "Einzeltermin"}${item.start !== item.end ? ` · ${formatRange(item.start, item.end)}` : ""}`;
      const action = isSeriesItem
        ? `<button class="small-button" type="button" data-edit-occurrence="${item.seriesId}" data-original-date="${item.originalDate}">Ausnahme bearbeiten</button>`
        : `<button class="small-button" type="button" data-edit-entry="${item.id}">Bearbeiten</button>`;
      rows.push(`<div class="entry-item"><i class="entry-swatch ${item.type}"></i><div class="entry-main"><div class="entry-title">${escapeHtml(item.title)}</div><div class="entry-meta">${escapeHtml(meta)}</div></div><div class="entry-actions">${action}</div></div>`);
    });
    refs.dayItemList.innerHTML = rows.join("");
    refs.dayItemList.querySelectorAll("[data-edit-entry]").forEach(button => button.addEventListener("click", () => { refs.dayDialog.close(); openEntryDialog(button.dataset.editEntry); }));
    refs.dayItemList.querySelectorAll("[data-edit-occurrence]").forEach(button => button.addEventListener("click", () => { refs.dayDialog.close(); openOccurrenceDialog(button.dataset.editOccurrence, button.dataset.originalDate); }));
  }

  function openOccurrenceDialog(seriesId, originalDate) {
    const series = state.series.find(item => item.id === seriesId);
    if (!series) return;
    const override = getSeriesOverride(series, originalDate);
    const currentDate = override && !override.cancelled ? override.date : originalDate;
    refs.occurrenceSeriesId.value = seriesId;
    refs.occurrenceOriginalDate.value = originalDate;
    refs.occurrenceDialogTitle.textContent = series.title || "Serientermin verschieben";
    refs.occurrenceInfo.textContent = `Ursprünglicher Termin: ${formatSingleDate(originalDate)}${override?.cancelled ? " · dieser Termin ist derzeit ausgenommen" : override && override.date !== originalDate ? ` · aktuell am ${formatSingleDate(override.date)}` : ""}.`;
    refs.occurrenceNewDate.value = currentDate;
    refs.resetOccurrenceButton.classList.toggle("hidden", !override);
    refs.occurrenceDialog.showModal();
  }

  function moveOccurrenceFromForm(event) {
    event.preventDefault();
    const series = state.series.find(item => item.id === refs.occurrenceSeriesId.value);
    const originalDate = refs.occurrenceOriginalDate.value;
    const newDate = refs.occurrenceNewDate.value;
    if (!series || !validDateKey(originalDate) || !validDateKey(newDate)) return showToast("Der neue Termin ist nicht gültig.", "error");
    if (newDate < series.start || newDate > series.end) {
      const proceed = confirm("Der neue Tag liegt außerhalb des eingestellten Serienzeitraums. Trotzdem verschieben?");
      if (!proceed) return;
    }
    setSeriesOverride(series, { originalDate, date: newDate, cancelled: false, updatedAt: new Date().toISOString() });
    saveLocal(true);
    void cloudUpsertSeries(series);
    refs.occurrenceDialog.close();
    focusDate = newDate;
    activeYear = parseDate(newDate).getFullYear();
    ensureYearSettings(activeYear);
    localStorage.setItem(FOCUS_DATE_KEY, focusDate);
    renderAll();
    showToast(`Serientermin auf ${formatSingleDate(newDate)} verschoben.`);
  }

  function cancelCurrentOccurrence() {
    const series = state.series.find(item => item.id === refs.occurrenceSeriesId.value);
    const originalDate = refs.occurrenceOriginalDate.value;
    if (!series || !confirm("Soll nur dieser einzelne Serientermin entfallen?")) return;
    setSeriesOverride(series, { originalDate, date: originalDate, cancelled: true, updatedAt: new Date().toISOString() });
    saveLocal(true);
    void cloudUpsertSeries(series);
    refs.occurrenceDialog.close();
    renderAll();
    showToast("Der einzelne Serientermin wurde ausgenommen.");
  }

  function resetCurrentOccurrence() {
    const series = state.series.find(item => item.id === refs.occurrenceSeriesId.value);
    const originalDate = refs.occurrenceOriginalDate.value;
    if (!series) return;
    series.overrides = (series.overrides || []).filter(item => item.originalDate !== originalDate);
    series.updatedAt = new Date().toISOString();
    saveLocal(true);
    void cloudUpsertSeries(series);
    refs.occurrenceDialog.close();
    renderAll();
    showToast("Die Ausnahme wurde zurückgesetzt.");
  }

  function openEntryDialog(id = null, date = null) {
    const entry = id ? state.entries.find(e => e.id === id) : null;
    const initial = date || dateKey(new Date(activeYear, new Date().getMonth(), new Date().getDate()));
    refs.entryDialogTitle.textContent = entry ? "Eintrag bearbeiten" : "Eintrag hinzufügen";
    refs.entryId.value = entry?.id || "";
    refs.entryType.value = entry?.type || "vacation";
    refs.entryStatus.value = entry?.status || "planned";
    refs.entryStart.value = entry?.start || initial;
    refs.entryEnd.value = entry?.end || initial;
    refs.entryDayPart.value = entry?.dayPart || "full";
    refs.entryNote.value = entry?.note || "";
    refs.deleteEntryButton.classList.toggle("hidden", !entry);
    updateEntryFormVisibility();
    updateEntryPreview();
    refs.entryDialog.showModal();
  }

  function updateEntryFormVisibility() {
    const vacation = refs.entryType.value === "vacation";
    refs.statusField.classList.toggle("hidden", !vacation);
    refs.dayPartField.classList.toggle("hidden", !vacation);
    refs.entryType.querySelector('option[value="partner-free"]').textContent = `${state.names.partner} frei`;
    updateEntryPreview();
  }

  function updateEntryPreview() {
    const start = refs.entryStart.value;
    const end = refs.entryEnd.value;
    if (!start || !end || end < start) {
      refs.entryPreview.textContent = "Bitte einen gültigen Zeitraum wählen.";
      return;
    }
    if (refs.entryType.value === "vacation") {
      const years = [...new Set(eachDate(start, end).map(d => d.getFullYear()))];
      const text = years.map(year => `${year}: ${formatDays(countVacationDays(start, end, refs.entryDayPart.value, year))}`).join(" · ");
      refs.entryPreview.textContent = `Vom Urlaubskonto werden ${text} abgezogen. Wochenenden, Feiertage und deine eingetragenen freien Tage zählen nicht.`;
    } else {
      refs.entryPreview.textContent = "Dieser Eintrag wird angezeigt, aber nicht vom Urlaubskonto abgezogen.";
    }
  }

  function saveEntryFromForm(event) {
    event.preventDefault();
    const start = refs.entryStart.value;
    const end = refs.entryEnd.value;
    if (!start || !end || end < start) return showToast("Der Zeitraum ist nicht gültig.", "error");
    if (refs.entryDayPart.value === "half" && start !== end) return showToast("Ein halber Urlaubstag kann nur für einen einzelnen Tag eingetragen werden.", "error");
    const now = new Date().toISOString();
    const id = refs.entryId.value || cryptoRandomId();
    const existing = state.entries.find(e => e.id === id);
    const entry = {
      id,
      type: refs.entryType.value,
      status: refs.entryType.value === "vacation" ? refs.entryStatus.value : "",
      start,
      end,
      dayPart: refs.entryType.value === "vacation" ? refs.entryDayPart.value : "full",
      note: refs.entryNote.value.trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, entry); else state.entries.push(entry);
    saveLocal(true);
    void cloudUpsertEntry(entry);
    refs.entryDialog.close();
    renderAll();
    showToast("Eintrag gespeichert.");
  }

  function deleteCurrentEntry() {
    const id = refs.entryId.value;
    if (!id || !confirm("Diesen Eintrag wirklich löschen?")) return;
    state.entries = state.entries.filter(e => e.id !== id);
    saveLocal(true);
    void cloudDeleteEntry(id);
    refs.entryDialog.close();
    renderAll();
    showToast("Eintrag gelöscht.");
  }

  function openSeriesDialog(id = null) {
    const item = id ? state.series.find(s => s.id === id) : null;
    const yearStart = `${activeYear}-01-01`;
    const yearEnd = `${activeYear}-12-31`;
    refs.seriesDialogTitle.textContent = item ? "Serie bearbeiten" : "Serie anlegen";
    refs.seriesId.value = item?.id || "";
    refs.seriesType.value = item?.type || "own-free";
    refs.seriesWeekday.value = String(item?.weekday ?? 1);
    refs.seriesInterval.value = String(item?.interval || 1);
    refs.seriesStart.value = item?.start || yearStart;
    refs.seriesEnd.value = item?.end || yearEnd;
    refs.seriesTitle.value = item?.title || "";
    refs.deleteSeriesButton.classList.toggle("hidden", !item);
    updateSeriesFormLabels();
    if (!item && !refs.seriesTitle.value.trim()) refs.seriesTitle.value = suggestedSeriesTitle();
    refs.seriesDialog.showModal();
  }

  function updateSeriesFormLabels() {
    refs.seriesType.querySelector('option[value="partner-free"]').textContent = `${state.names.partner} frei`;
    if (!refs.seriesId.value && !refs.seriesTitle.value.trim()) {
      refs.seriesTitle.value = suggestedSeriesTitle();
    }
  }

  function suggestedSeriesTitle() {
    const weekdayName = WEEKDAY_NAMES[Number(refs.seriesWeekday?.value || 1)];
    const type = refs.seriesType?.value || "own-free";
    if (type === "partner-free") return `${state.names.partner} frei`;
    if (type === "comp-time") return `Ausgleichsfrei ${weekdayName}`;
    if (type === "saturday-work") return `Samstagsarbeit ${weekdayName}`;
    if (type === "other") return `Serientermin ${weekdayName}`;
    return `Freier ${weekdayName}`;
  }

  function saveSeriesFromForm(event) {
    event.preventDefault();
    if (refs.seriesEnd.value < refs.seriesStart.value) return showToast("Der Zeitraum der Serie ist nicht gültig.", "error");
    const now = new Date().toISOString();
    const id = refs.seriesId.value || cryptoRandomId();
    const existing = state.series.find(s => s.id === id);
    const item = {
      id,
      type: refs.seriesType.value,
      weekday: Number(refs.seriesWeekday.value),
      interval: Number(refs.seriesInterval.value),
      start: refs.seriesStart.value,
      end: refs.seriesEnd.value,
      title: refs.seriesTitle.value.trim(),
      overrides: existing?.overrides || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, item); else state.series.push(item);
    saveLocal(true);
    void cloudUpsertSeries(item);
    refs.seriesDialog.close();
    renderAll();
    showToast("Serientermin gespeichert.");
  }

  function deleteCurrentSeries() {
    const id = refs.seriesId.value;
    if (!id || !confirm("Diesen Serientermin wirklich löschen?")) return;
    state.series = state.series.filter(s => s.id !== id);
    saveLocal(true);
    void cloudDeleteSeries(id);
    refs.seriesDialog.close();
    renderAll();
    showToast("Serientermin gelöscht.");
  }

  function openSettings() {
    ensureYearSettings(activeYear);
    const ys = state.yearSettings[activeYear];
    refs.ownName.value = state.names.own;
    refs.partnerName.value = state.names.partner;
    refs.annualLeave.value = ys.annualLeave;
    refs.carryOver.value = ys.carryOver;
    refs.holidaysEnabled.checked = ys.holidaysEnabled;
    refs.settingsYearLabel.textContent = activeYear;
    document.querySelectorAll('input[name="workday"]').forEach(box => box.checked = ys.workdays.includes(Number(box.value)));
    refs.settingsDialog.showModal();
  }

  function saveSettingsFromForm(event) {
    event.preventDefault();
    const workdays = [...document.querySelectorAll('input[name="workday"]:checked')].map(el => Number(el.value));
    if (!workdays.length) return showToast("Bitte mindestens einen Arbeitstag auswählen.", "error");
    state.names.own = refs.ownName.value.trim() || "Markus";
    state.names.partner = refs.partnerName.value.trim() || "Frederike";
    state.yearSettings[activeYear] = {
      annualLeave: num(refs.annualLeave.value),
      carryOver: num(refs.carryOver.value),
      workdays,
      holidaysEnabled: refs.holidaysEnabled.checked
    };
    saveLocal(true);
    void cloudSaveSettings();
    refs.settingsDialog.close();
    renderAll();
    showToast("Einstellungen gespeichert.");
  }

  function getDayInfo(key) {
    const direct = state.entries
      .filter(e => key >= e.start && key <= e.end)
      .map(e => ({ ...e, source: "entry", title: e.note || displayTypeName(e.type) }));
    const recurring = state.series.flatMap(series => getSeriesOccurrencesOn(series, key).map(occurrence => ({
      ...series,
      id: `${series.id}:${occurrence.originalDate}`,
      seriesId: series.id,
      originalDate: occurrence.originalDate,
      currentDate: key,
      source: "series",
      isMoved: occurrence.originalDate !== key,
      dayPart: "full",
      title: series.title || displayTypeName(series.type)
    })));
    const exceptionNotices = state.series.flatMap(series => (series.overrides || [])
      .filter(override => override.originalDate === key && (override.cancelled || override.date !== override.originalDate))
      .map(override => ({
        id: `${series.id}:${override.originalDate}:exception`,
        seriesId: series.id,
        originalDate: override.originalDate,
        currentDate: key,
        source: "series-exception",
        type: "other",
        seriesType: series.type,
        isCancelled: override.cancelled,
        dayPart: "full",
        title: override.cancelled
          ? `${series.title || displayTypeName(series.type)} entfällt`
          : `${series.title || displayTypeName(series.type)} verschoben auf ${formatSingleDate(override.date)}`
      })));
    const items = [...direct, ...recurring, ...exceptionNotices];
    const hasSaturdayWork = items.some(i => i.type === "saturday-work");
    return {
      items,
      ownFree: !hasSaturdayWork && (items.some(i => ["own-free", "vacation", "comp-time"].includes(i.type)) || isWeekendOrHoliday(key)),
      partnerFree: items.some(i => i.type === "partner-free")
    };
  }

  function isWeekendOrHoliday(key) {
    const date = parseDate(key);
    const ys = state.yearSettings[date.getFullYear()] || { workdays: [1,2,3,4,5], holidaysEnabled: true };
    if (!ys.workdays.includes(date.getDay())) return true;
    return ys.holidaysEnabled && getHolidayMap(date.getFullYear()).has(key);
  }

  function isOwnNonWorkingDay(key) {
    if (isWeekendOrHoliday(key)) return true;
    if (state.entries.some(e => ["own-free", "comp-time"].includes(e.type) && key >= e.start && key <= e.end)) return true;
    if (state.series.some(s => ["own-free", "comp-time"].includes(s.type) && seriesOccursOn(s, key))) return true;
    return false;
  }

  function calculateVacationTotals(year) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    let booked = 0;
    let approved = 0;
    let taken = 0;
    eachDate(start, end).forEach(date => {
      const key = dateKey(date);
      if (isOwnNonWorkingDay(key)) return;
      const entries = state.entries.filter(entry => entry.type === "vacation" && key >= entry.start && key <= entry.end);
      if (!entries.length) return;
      const weight = entry => entry.dayPart === "half" && entry.start === entry.end ? 0.5 : 1;
      booked += Math.max(...entries.map(weight));
      const approvedEntries = entries.filter(entry => ["approved", "taken"].includes(entry.status));
      const takenEntries = entries.filter(entry => entry.status === "taken");
      if (approvedEntries.length) approved += Math.max(...approvedEntries.map(weight));
      if (takenEntries.length) taken += Math.max(...takenEntries.map(weight));
    });
    return { booked, approved, taken };
  }

  function countVacationDays(start, end, dayPart = "full", onlyYear = null) {
    if (!start || !end || end < start) return 0;
    if (dayPart === "half") {
      const date = parseDate(start);
      if (onlyYear !== null && date.getFullYear() !== onlyYear) return 0;
      return isOwnNonWorkingDay(start) ? 0 : 0.5;
    }
    return eachDate(start, end).reduce((sum, date) => {
      const key = dateKey(date);
      if (onlyYear !== null && date.getFullYear() !== onlyYear) return sum;
      return sum + (isOwnNonWorkingDay(key) ? 0 : 1);
    }, 0);
  }

  function seriesOccursOn(series, key) {
    return getSeriesOccurrencesOn(series, key).length > 0;
  }

  function getSeriesOccurrencesOn(series, key) {
    const occurrences = [];
    const overrides = Array.isArray(series.overrides) ? series.overrides : [];
    overrides.forEach(override => {
      if (!override.cancelled && override.date === key && override.originalDate !== key) {
        occurrences.push({ originalDate: override.originalDate, moved: true });
      }
    });
    if (baseSeriesOccursOn(series, key)) {
      const override = getSeriesOverride(series, key);
      if (!override || (!override.cancelled && override.date === key)) {
        occurrences.push({ originalDate: key, moved: false });
      }
    }
    return occurrences;
  }

  function baseSeriesOccursOn(series, key) {
    if (key < series.start || key > series.end) return false;
    const date = parseDate(key);
    if (date.getDay() !== Number(series.weekday)) return false;
    const first = firstWeekdayOnOrAfter(parseDate(series.start), Number(series.weekday));
    if (date < first) return false;
    const weeks = Math.floor(daysBetween(dateKey(first), key) / 7);
    return weeks % Number(series.interval || 1) === 0;
  }

  function getSeriesOverride(series, originalDate) {
    return (series.overrides || []).find(item => item.originalDate === originalDate) || null;
  }

  function setSeriesOverride(series, override) {
    series.overrides = Array.isArray(series.overrides) ? series.overrides : [];
    series.overrides = series.overrides.filter(item => item.originalDate !== override.originalDate);
    if (!(override.date === override.originalDate && !override.cancelled)) series.overrides.push(override);
    series.updatedAt = new Date().toISOString();
  }

  function firstWeekdayOnOrAfter(date, weekday) {
    const result = new Date(date);
    const diff = (weekday - result.getDay() + 7) % 7;
    result.setDate(result.getDate() + diff);
    return result;
  }


  function calculateCommonFreeRanges(year) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const commonKeys = eachDate(start, end).map(dateKey).filter(key => {
      const info = getDayInfo(key);
      return info.ownFree && info.partnerFree;
    });
    if (!commonKeys.length) return [];
    const ranges = [];
    let rangeStart = commonKeys[0];
    let previous = commonKeys[0];
    for (let i = 1; i < commonKeys.length; i++) {
      if (daysBetween(previous, commonKeys[i]) === 1) previous = commonKeys[i];
      else { ranges.push({ start: rangeStart, end: previous }); rangeStart = previous = commonKeys[i]; }
    }
    ranges.push({ start: rangeStart, end: previous });
    return ranges;
  }

  function getHolidayMap(year) {
    const ys = state.yearSettings[year];
    if (ys && ys.holidaysEnabled === false) return new Map();
    const easter = easterSunday(year);
    const holidays = [
      [`${year}-01-01`, "Neujahr"],
      [dateKey(addDays(easter, -2)), "Karfreitag"],
      [dateKey(addDays(easter, 1)), "Ostermontag"],
      [`${year}-05-01`, "Tag der Arbeit"],
      [dateKey(addDays(easter, 39)), "Christi Himmelfahrt"],
      [dateKey(addDays(easter, 50)), "Pfingstmontag"],
      [`${year}-10-03`, "Tag der Deutschen Einheit"],
      ...(year >= 2017 ? [[`${year}-10-31`, "Reformationstag"]] : []),
      [`${year}-12-25`, "1. Weihnachtstag"],
      [`${year}-12-26`, "2. Weihnachtstag"]
    ];
    return new Map(holidays);
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function displayTypeName(type) {
    if (type === "partner-free") return `${state.names.partner} frei`;
    if (type === "own-free") return `${state.names.own} frei`;
    if (type === "vacation") return `${state.names.own} Urlaub`;
    return TYPE_NAMES[type] || "Eintrag";
  }

  function intervalName(interval) {
    return Number(interval) === 1 ? "jede Woche" : `alle ${interval} Wochen`;
  }

  function openMenu() { refs.sideMenu.setAttribute("aria-hidden", "false"); }
  function closeMenu() { refs.sideMenu.setAttribute("aria-hidden", "true"); }

  async function exportBackup() {
    const json = JSON.stringify(state, null, 2);
    const fileName = "Urlaubskalender-Daten.json";
    const blob = new Blob([json], { type: "application/json" });

    try {
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: "Urlaubskalender-Sicherung", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markCurrentStateSafe();
        showToast("Sicherung wurde gespeichert.");
        return;
      }

      const file = new File([blob], fileName, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] }) && typeof navigator.share === "function") {
        await navigator.share({
          files: [file],
          title: "Urlaubskalender-Sicherung",
          text: "Diese Datei in OneDrive speichern und dort die vorhandene Sicherung ersetzen."
        });
        markCurrentStateSafe();
        showToast("Sicherung wurde zum Speichern bereitgestellt.");
        return;
      }

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      markCurrentStateSafe();
      showToast("Sicherungsdatei wurde heruntergeladen. Bitte in OneDrive ablegen.");
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      showToast("Die Sicherung konnte nicht erstellt werden.", "error");
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries) || !Array.isArray(raw.series)) {
        throw new Error("Unbekanntes Datenformat");
      }
      const parsed = normalizeState(raw);
      const importedDate = formatDateTime(parsed.updatedAt);
      const localDate = formatDateTime(state.updatedAt);
      const message = `Die Sicherung vom ${importedDate} ersetzt den lokalen Stand vom ${localDate}. Fortfahren?`;
      if (!confirm(message)) return;
      state = parsed;
      activeYear = new Date().getFullYear();
      ensureYearSettings(activeYear);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      markCurrentStateSafe();
      renderAll();
      closeMenu();
      if (currentUser && cloudReady) {
        const user = currentUser;
        stopCloudSync(false);
        await replaceCloudWithLocal(user);
        await startCloudSync(user);
        showToast("Sicherung wurde eingelesen und mit Firebase abgeglichen.");
      } else {
        showToast("Sicherung wurde eingelesen.");
      }
    } catch (error) {
      console.error(error);
      showToast("Die Sicherungsdatei ist ungültig.", "error");
    }
  }

  async function initFirebaseAuth() {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (error) {
      console.warn("Die dauerhafte Anmeldung konnte nicht vorbereitet werden", error);
    }

    onAuthStateChanged(auth, user => {
      void handleAuthStateChanged(user);
    });
  }

  async function handleAuthStateChanged(user) {
    currentUser = user || null;
    if (!currentUser) {
      stopCloudSync();
      syncState = "signed-out";
      updateBackupUi();
      return;
    }

    localStorage.setItem("urlaubskalender-login-email", currentUser.email || "");
    syncState = "connecting";
    updateBackupUi();
    await startCloudSync(currentUser);
  }

  function handleAccountAction() {
    if (currentUser) {
      const email = currentUser.email || "diesem Konto";
      if (!confirm(`Möchtest du dich wirklich von ${email} abmelden? Die lokalen Daten bleiben auf diesem Gerät erhalten.`)) return;
      void signOut(auth).catch(error => {
        console.error(error);
        showToast("Die Abmeldung ist fehlgeschlagen.", "error");
      });
      return;
    }

    refs.loginError.classList.add("hidden");
    refs.loginError.textContent = "";
    refs.loginEmail.value = localStorage.getItem("urlaubskalender-login-email") || "";
    refs.loginPassword.value = "";
    refs.loginDialog.showModal();
    setTimeout(() => (refs.loginEmail.value ? refs.loginPassword : refs.loginEmail).focus(), 50);
  }

  async function loginFromForm(event) {
    event.preventDefault();
    const email = refs.loginEmail.value.trim();
    const password = refs.loginPassword.value;
    refs.loginSubmitButton.disabled = true;
    refs.loginSubmitButton.textContent = "Anmeldung läuft …";
    refs.loginError.classList.add("hidden");

    try {
      await signInWithEmailAndPassword(auth, email, password);
      refs.loginPassword.value = "";
      refs.loginDialog.close();
      showToast("Anmeldung erfolgreich. Der Kalender wird jetzt abgeglichen.");
    } catch (error) {
      console.error(error);
      refs.loginError.textContent = firebaseAuthErrorText(error?.code);
      refs.loginError.classList.remove("hidden");
    } finally {
      refs.loginSubmitButton.disabled = false;
      refs.loginSubmitButton.textContent = "Anmelden";
    }
  }

  function firebaseAuthErrorText(code) {
    const messages = {
      "auth/invalid-credential": "E-Mail-Adresse oder Passwort stimmen nicht.",
      "auth/invalid-email": "Die E-Mail-Adresse ist nicht gültig.",
      "auth/user-disabled": "Dieser Benutzer wurde in Firebase deaktiviert.",
      "auth/too-many-requests": "Zu viele Anmeldeversuche. Bitte einige Minuten warten.",
      "auth/network-request-failed": "Firebase ist gerade nicht erreichbar. Bitte die Internetverbindung prüfen."
    };
    return messages[code] || "Die Anmeldung ist fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.";
  }

  function settingsDocument(user = currentUser) {
    return doc(db, "users", user.uid, "settings", "main");
  }

  function entriesCollection(user = currentUser) {
    return collection(db, "users", user.uid, "entries");
  }

  function seriesCollection(user = currentUser) {
    return collection(db, "users", user.uid, "series");
  }

  async function startCloudSync(user) {
    stopCloudSync(false);
    cloudReady = false;
    syncState = navigator.onLine ? "connecting" : "offline";
    updateBackupUi();

    try {
      const [settingsSnapshot, entriesSnapshot, seriesSnapshot] = await Promise.all([
        getDoc(settingsDocument(user)),
        getDocs(entriesCollection(user)),
        getDocs(seriesCollection(user))
      ]);

      const cloudHasData = settingsSnapshot.exists() || !entriesSnapshot.empty || !seriesSnapshot.empty;
      if (!navigator.onLine && !cloudHasData) {
        syncState = "offline";
        updateBackupUi();
        return;
      }
      if (!cloudHasData) {
        if (hasMeaningfulLocalData()) {
          const proceed = confirm(
            `In Firebase sind noch keine Kalenderdaten gespeichert. Soll der aktuelle Stand dieses Geräts jetzt hochgeladen werden?\n\n` +
            `${state.entries.length} Einträge und ${state.series.length} Serientermine werden übernommen.`
          );
          if (!proceed) {
            await signOut(auth);
            return;
          }
        }
        await replaceCloudWithLocal(user);
      } else {
        applyInitialCloudData(settingsSnapshot, entriesSnapshot, seriesSnapshot);
      }

      cloudReady = true;
      attachCloudListeners(user);
      lastSyncAt = new Date();
      markCurrentStateSafe();
      syncState = navigator.onLine ? "synced" : "offline";
      updateBackupUi();
    } catch (error) {
      console.error("Firebase-Start fehlgeschlagen", error);
      cloudReady = false;
      syncState = navigator.onLine ? "error" : "offline";
      updateBackupUi();
      showToast("Die Firebase-Synchronisierung konnte nicht gestartet werden.", "error");
    }
  }

  function stopCloudSync(clearUserState = true) {
    cloudUnsubscribers.forEach(unsubscribe => {
      try { unsubscribe(); } catch (error) { console.warn(error); }
    });
    cloudUnsubscribers = [];
    cloudReady = false;
    if (clearUserState) lastSyncAt = null;
  }

  function hasMeaningfulLocalData() {
    return state.entries.length > 0 || state.series.length > 0 || Number(state.revision) > 0;
  }

  function applyInitialCloudData(settingsSnapshot, entriesSnapshot, seriesSnapshot) {
    applyingCloudData = true;
    try {
      if (settingsSnapshot.exists()) applyCloudSettings(settingsSnapshot.data());
      state.entries = entriesSnapshot.docs.map(snapshot => normalizeCloudEntry(snapshot.id, snapshot.data()));
      state.series = seriesSnapshot.docs.map(snapshot => normalizeCloudSeries(snapshot.id, snapshot.data()));
      finishCloudStateUpdate();
    } finally {
      applyingCloudData = false;
    }
  }

  function attachCloudListeners(user) {
    const metadata = {
      settings: { pending: false, fromCache: true },
      entries: { pending: false, fromCache: true },
      series: { pending: false, fromCache: true }
    };

    cloudUnsubscribers.push(onSnapshot(settingsDocument(user), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.exists()) {
        applyingCloudData = true;
        try {
          applyCloudSettings(snapshot.data());
          finishCloudStateUpdate();
        } finally {
          applyingCloudData = false;
        }
      }
      updateCloudMetadata("settings", snapshot.metadata, metadata);
    }, cloudListenerError));

    cloudUnsubscribers.push(onSnapshot(entriesCollection(user), { includeMetadataChanges: true }, snapshot => {
      applyingCloudData = true;
      try {
        state.entries = snapshot.docs.map(item => normalizeCloudEntry(item.id, item.data()));
        finishCloudStateUpdate();
      } finally {
        applyingCloudData = false;
      }
      updateCloudMetadata("entries", snapshot.metadata, metadata);
    }, cloudListenerError));

    cloudUnsubscribers.push(onSnapshot(seriesCollection(user), { includeMetadataChanges: true }, snapshot => {
      applyingCloudData = true;
      try {
        state.series = snapshot.docs.map(item => normalizeCloudSeries(item.id, item.data()));
        finishCloudStateUpdate();
      } finally {
        applyingCloudData = false;
      }
      updateCloudMetadata("series", snapshot.metadata, metadata);
    }, cloudListenerError));
  }

  function cloudListenerError(error) {
    console.error("Firebase-Echtzeitabgleich fehlgeschlagen", error);
    syncState = navigator.onLine ? "error" : "offline";
    updateBackupUi();
  }

  function updateCloudMetadata(kind, snapshotMetadata, allMetadata) {
    allMetadata[kind] = {
      pending: snapshotMetadata.hasPendingWrites,
      fromCache: snapshotMetadata.fromCache
    };

    const values = Object.values(allMetadata);
    const hasPendingWrites = values.some(value => value.pending);
    if (!navigator.onLine) {
      syncState = "offline";
    } else if (hasPendingWrites) {
      syncState = "saving";
    } else {
      syncState = "synced";
      lastSyncAt = new Date();
      markCurrentStateSafe();
    }
    updateBackupUi();
  }

  function applyCloudSettings(data) {
    if (data?.names && typeof data.names === "object") {
      state.names = { ...state.names, ...data.names };
    }
    if (data?.yearSettings && typeof data.yearSettings === "object") {
      state.yearSettings = data.yearSettings;
    }
  }

  function finishCloudStateUpdate() {
    state.schemaVersion = 2;
    state.revision = (Number(state.revision) || 0) + 1;
    state.updatedAt = new Date().toISOString();
    ensureYearSettings(activeYear);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  }

  function normalizeCloudEntry(id, data) {
    return {
      id,
      type: data.type || "other",
      status: data.status || "",
      start: data.start,
      end: data.end,
      dayPart: data.dayPart || "full",
      note: data.note || "",
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }

  function normalizeCloudSeries(id, data) {
    return {
      id,
      type: data.type || "other",
      weekday: Number(data.weekday),
      interval: Number(data.interval || 1),
      start: data.start,
      end: data.end,
      title: data.title || displayTypeName(data.type),
      overrides: Array.isArray(data.overrides) ? data.overrides.map(item => ({
        originalDate: item.originalDate,
        date: item.date || item.originalDate,
        cancelled: Boolean(item.cancelled),
        updatedAt: item.updatedAt || new Date().toISOString()
      })) : [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }

  function cleanEntryForCloud(entry) {
    return {
      type: entry.type,
      status: entry.status || "",
      start: entry.start,
      end: entry.end,
      dayPart: entry.dayPart || "full",
      note: entry.note || "",
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      cloudUpdatedAt: serverTimestamp()
    };
  }

  function cleanSeriesForCloud(series) {
    return {
      type: series.type,
      weekday: Number(series.weekday),
      interval: Number(series.interval || 1),
      start: series.start,
      end: series.end,
      title: series.title || displayTypeName(series.type),
      overrides: Array.isArray(series.overrides) ? series.overrides.map(item => ({
        originalDate: item.originalDate,
        date: item.date || item.originalDate,
        cancelled: Boolean(item.cancelled),
        updatedAt: item.updatedAt || new Date().toISOString()
      })) : [],
      createdAt: series.createdAt || new Date().toISOString(),
      updatedAt: series.updatedAt || new Date().toISOString(),
      cloudUpdatedAt: serverTimestamp()
    };
  }

  function settingsForCloud(sourceState = state) {
    return {
      schemaVersion: 2,
      names: sourceState.names,
      yearSettings: sourceState.yearSettings,
      clientUpdatedAt: sourceState.updatedAt,
      cloudUpdatedAt: serverTimestamp()
    };
  }

  async function cloudUpsertEntry(entry) {
    if (!currentUser || !cloudReady || applyingCloudData) return;
    setCloudSavingState();
    try {
      await setDoc(doc(entriesCollection(), entry.id), cleanEntryForCloud(entry));
    } catch (error) {
      cloudWriteError(error);
    }
  }

  async function cloudDeleteEntry(id) {
    if (!currentUser || !cloudReady || applyingCloudData) return;
    setCloudSavingState();
    try {
      await deleteDoc(doc(entriesCollection(), id));
    } catch (error) {
      cloudWriteError(error);
    }
  }

  async function cloudUpsertSeries(series) {
    if (!currentUser || !cloudReady || applyingCloudData) return;
    setCloudSavingState();
    try {
      await setDoc(doc(seriesCollection(), series.id), cleanSeriesForCloud(series));
    } catch (error) {
      cloudWriteError(error);
    }
  }

  async function cloudDeleteSeries(id) {
    if (!currentUser || !cloudReady || applyingCloudData) return;
    setCloudSavingState();
    try {
      await deleteDoc(doc(seriesCollection(), id));
    } catch (error) {
      cloudWriteError(error);
    }
  }

  async function cloudSaveSettings() {
    if (!currentUser || !cloudReady || applyingCloudData) return;
    setCloudSavingState();
    try {
      await setDoc(settingsDocument(), settingsForCloud());
    } catch (error) {
      cloudWriteError(error);
    }
  }

  function setCloudSavingState() {
    syncState = navigator.onLine ? "saving" : "offline";
    updateBackupUi();
  }

  function cloudWriteError(error) {
    console.error("Firebase-Schreibfehler", error);
    syncState = navigator.onLine ? "error" : "offline";
    updateBackupUi();
    showToast("Eine Änderung konnte noch nicht mit Firebase abgeglichen werden.", "error");
  }

  async function replaceCloudWithLocal(user = currentUser) {
    if (!user) return;
    const localSnapshot = normalizeState(JSON.parse(JSON.stringify(state)));
    syncState = navigator.onLine ? "saving" : "offline";
    updateBackupUi();

    const [existingEntries, existingSeries] = await Promise.all([
      getDocs(entriesCollection(user)),
      getDocs(seriesCollection(user))
    ]);

    const localEntryIds = new Set(localSnapshot.entries.map(item => item.id));
    const localSeriesIds = new Set(localSnapshot.series.map(item => item.id));
    const operations = [];

    existingEntries.docs.forEach(item => {
      if (!localEntryIds.has(item.id)) operations.push({ action: "delete", ref: item.ref });
    });
    existingSeries.docs.forEach(item => {
      if (!localSeriesIds.has(item.id)) operations.push({ action: "delete", ref: item.ref });
    });

    operations.push({ action: "set", ref: settingsDocument(user), data: settingsForCloud(localSnapshot) });
    localSnapshot.entries.forEach(entry => operations.push({
      action: "set",
      ref: doc(entriesCollection(user), entry.id),
      data: cleanEntryForCloud(entry)
    }));
    localSnapshot.series.forEach(series => operations.push({
      action: "set",
      ref: doc(seriesCollection(user), series.id),
      data: cleanSeriesForCloud(series)
    }));

    for (let index = 0; index < operations.length; index += 400) {
      const batch = writeBatch(db);
      operations.slice(index, index + 400).forEach(operation => {
        if (operation.action === "delete") batch.delete(operation.ref);
        else batch.set(operation.ref, operation.data);
      });
      await batch.commit();
    }

    lastSyncAt = new Date();
    markCurrentStateSafe();
    syncState = navigator.onLine ? "synced" : "offline";
    updateBackupUi();
  }

  function updateConnectionStatus() {
    if (!currentUser) return;
    if (!navigator.onLine) {
      syncState = "offline";
      updateBackupUi();
      return;
    }
    if (!cloudReady) {
      syncState = "connecting";
      updateBackupUi();
      void startCloudSync(currentUser);
      return;
    }
    if (syncState === "offline") syncState = "connecting";
    updateBackupUi();
  }

  function markCurrentStateSafe() {
    localStorage.setItem(SAFE_REVISION_KEY, String(Number(state.revision) || 0));
    localStorage.setItem(SAFE_AT_KEY, new Date().toISOString());
    updateBackupUi();
  }

  function updateBackupUi() {
    if (!refs.backupHeadline) return;

    const email = currentUser?.email || "";
    const lastSyncText = lastSyncAt ? formatDateTime(lastSyncAt.toISOString()) : "noch nicht abgeschlossen";
    let headline = "Nur auf diesem Gerät gespeichert";
    let details = "Melde dich an, damit PC, iPhone und iPad automatisch denselben Stand erhalten.";
    let menuText = "Noch nicht angemeldet. Die Daten bleiben vorerst nur auf diesem Gerät.";
    let cssClass = "offline";

    if (currentUser) {
      if (syncState === "connecting") {
        headline = "Firebase wird verbunden";
        details = `${email} · der gemeinsame Kalenderstand wird geladen.`;
        menuText = `Angemeldet als ${email}. Verbindung wird hergestellt.`;
        cssClass = "saving";
      } else if (syncState === "saving") {
        headline = "Änderungen werden synchronisiert";
        details = `${email} · bitte das Gerät kurz online lassen.`;
        menuText = `Angemeldet als ${email}. Änderungen werden übertragen.`;
        cssClass = "saving";
      } else if (syncState === "synced") {
        headline = "Automatisch synchronisiert";
        details = `${email} · letzter Abgleich: ${lastSyncText}`;
        menuText = `Angemeldet als ${email}. Letzter Abgleich: ${lastSyncText}.`;
        cssClass = "online";
      } else if (syncState === "offline") {
        headline = "Offline – Änderungen bleiben gespeichert";
        details = `${email} · die Übertragung erfolgt automatisch, sobald wieder Internet verfügbar ist.`;
        menuText = `Angemeldet als ${email}. Der Kalender arbeitet gerade offline.`;
        cssClass = "offline";
      } else if (syncState === "error") {
        headline = "Synchronisierung fehlgeschlagen";
        details = `${email} · bitte Internetverbindung prüfen und die Seite neu laden.`;
        menuText = `Angemeldet als ${email}. Beim Abgleich ist ein Fehler aufgetreten.`;
        cssClass = "error";
      }
    }

    refs.backupHeadline.textContent = headline;
    refs.backupDetails.textContent = details;
    refs.backupStatus.textContent = menuText;
    refs.backupStatus.className = `sync-status ${cssClass}`;

    refs.accountButton.textContent = currentUser ? "Konto" : "Anmelden";
    refs.accountBarButton.textContent = currentUser ? "Abmelden" : "Anmelden";
    refs.accountMenuButton.textContent = currentUser ? `Abmelden (${email})` : "Bei Firebase anmelden";

    [refs.accountButton, refs.accountBarButton].forEach(button => {
      button.classList.remove("sync-online", "sync-saving", "sync-offline");
      if (currentUser && syncState === "synced") button.classList.add("sync-online");
      else if (currentUser && ["saving", "connecting"].includes(syncState)) button.classList.add("sync-saving");
      else if (currentUser) button.classList.add("sync-offline");
    });

    refs.backupBarButton.classList.remove("attention");
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "unbekannt";
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("service-worker.js").catch(error => console.warn("Service Worker", error));
    }
  }

  function showToast(message, type = "") {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.className = `toast show ${type}`;
    toastTimer = setTimeout(() => refs.toast.className = "toast", 3500);
  }

  function formatDays(value) {
    const n = num(value);
    return `${Number.isInteger(n) ? n : n.toFixed(1).replace(".", ",")} Tag${n === 1 ? "" : "e"}`;
  }

  function formatRange(start, end) {
    const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    if (start === end) return formatter.format(parseDate(start));
    return `${formatter.format(parseDate(start))} bis ${formatter.format(parseDate(end))}`;
  }

  function formatSingleDate(key) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(parseDate(key));
  }

  function formatShortRange(start, end) {
    const a = parseDate(start);
    const b = parseDate(end);
    const sameYear = a.getFullYear() === b.getFullYear();
    const sameMonth = sameYear && a.getMonth() === b.getMonth();
    if (sameMonth) return `${a.getDate()}.–${b.getDate()}. ${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
    if (sameYear) return `${a.getDate()}. ${MONTH_NAMES[a.getMonth()]}–${b.getDate()}. ${MONTH_NAMES[b.getMonth()]} ${a.getFullYear()}`;
    return `${formatSingleDate(start)} bis ${formatSingleDate(end)}`;
  }

  function startOfWeek(date) {
    const result = new Date(date);
    result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
    return result;
  }

  function isoWeekNumber(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  }

  function validDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const parsed = parseDate(value);
    return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
  }

  function formatTime(date) { return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date); }
  function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  function parseDate(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
  function addDays(date, amount) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function eachDate(start, end) { const dates = []; for (let d = parseDate(start), last = parseDate(end); d <= last; d = addDays(d,1)) dates.push(new Date(d)); return dates; }
  function rangeTouchesYear(start, end, year) { return start <= `${year}-12-31` && end >= `${year}-01-01`; }
  function cryptoRandomId() { return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }
})();
