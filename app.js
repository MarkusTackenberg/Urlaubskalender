(() => {
  "use strict";

  const STORAGE_KEY = "urlaubskalender-data-v1";
  const CLIENT_ID_KEY = "urlaubskalender-ms-client-id";
  const PERMISSION_MODE_KEY = "urlaubskalender-ms-permission-mode";
  const SYNC_BASE_KEY = "urlaubskalender-last-synced-updated-at";
  const REMOTE_FILE = "urlaubskalender.json";
  const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
  const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const STATUS_NAMES = { planned: "geplant", requested: "beantragt", approved: "genehmigt", taken: "genommen" };
  const TYPE_NAMES = { vacation: "Urlaub", "own-free": "Freier Tag", "partner-free": "Partnerin frei", other: "Sonstiges" };

  let state = loadLocalState();
  let activeYear = new Date().getFullYear();
  let msalInstance = null;
  let currentAccount = null;
  let remoteMeta = { id: null, eTag: null };
  let syncTimer = null;
  let syncBlocked = false;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const refs = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheRefs();
    bindEvents();
    ensureYearSettings(activeYear);
    renderAll();
    updateSetupFields();
    registerServiceWorker();
    await initializeMicrosoft();
  }

  function cacheRefs() {
    [
      "toast", "syncButton", "menuButton", "prevYear", "nextYear", "yearButton", "todayButton", "addEntryButton", "addSeriesButton",
      "summaryCards", "calendar", "entryFilter", "entryList", "commonFreeList", "sideMenu", "syncStatus", "settingsButton",
      "seriesListButton", "manualSyncButton", "exportButton", "importInput", "printButton", "setupButton", "logoutButton",
      "entryDialog", "entryForm", "entryDialogTitle", "entryId", "entryType", "entryStatus", "entryStart", "entryEnd", "entryDayPart",
      "entryNote", "entryPreview", "deleteEntryButton", "statusField", "dayPartField", "seriesDialog", "seriesForm", "seriesDialogTitle",
      "seriesId", "seriesType", "seriesWeekday", "seriesInterval", "seriesStart", "seriesEnd", "seriesTitle", "deleteSeriesButton",
      "settingsDialog", "settingsForm", "ownName", "partnerName", "annualLeave", "carryOver", "holidaysEnabled", "settingsYearLabel",
      "seriesListDialog", "seriesList", "newSeriesFromList", "setupDialog", "setupForm", "clientIdInput", "permissionModeInput", "redirectUriInput", "clearClientIdButton",
      "conflictDialog", "conflictExportButton", "conflictKeepLocalButton", "conflictLoadRemoteButton", "legendOwn", "legendPartner"
    ].forEach(id => refs[id] = $(id));
  }

  function bindEvents() {
    refs.prevYear.addEventListener("click", () => changeYear(activeYear - 1));
    refs.nextYear.addEventListener("click", () => changeYear(activeYear + 1));
    refs.yearButton.addEventListener("click", () => {
      const year = Number(prompt("Jahr eingeben", String(activeYear)));
      if (Number.isInteger(year) && year >= 1900 && year <= 2200) changeYear(year);
    });
    refs.todayButton.addEventListener("click", () => changeYear(new Date().getFullYear()));
    refs.addEntryButton.addEventListener("click", () => openEntryDialog());
    refs.addSeriesButton.addEventListener("click", () => openSeriesDialog());
    refs.menuButton.addEventListener("click", openMenu);
    document.querySelectorAll("[data-close-menu]").forEach(el => el.addEventListener("click", closeMenu));
    document.querySelectorAll("[data-close-dialog]").forEach(el => el.addEventListener("click", () => $(el.dataset.closeDialog).close()));

    refs.settingsButton.addEventListener("click", () => { closeMenu(); openSettings(); });
    refs.seriesListButton.addEventListener("click", () => { closeMenu(); renderSeriesList(); refs.seriesListDialog.showModal(); });
    refs.newSeriesFromList.addEventListener("click", () => { refs.seriesListDialog.close(); openSeriesDialog(); });
    refs.manualSyncButton.addEventListener("click", async () => { closeMenu(); await syncNow(true); });
    refs.exportButton.addEventListener("click", () => { closeMenu(); exportBackup(); });
    refs.importInput.addEventListener("change", importBackup);
    refs.printButton.addEventListener("click", () => { closeMenu(); window.print(); });
    refs.setupButton.addEventListener("click", () => { closeMenu(); updateSetupFields(); refs.setupDialog.showModal(); });
    refs.syncButton.addEventListener("click", handleSyncButton);
    refs.logoutButton.addEventListener("click", logoutMicrosoft);

    refs.entryForm.addEventListener("submit", saveEntryFromForm);
    refs.entryType.addEventListener("change", updateEntryFormVisibility);
    [refs.entryStart, refs.entryEnd, refs.entryType, refs.entryDayPart].forEach(el => el.addEventListener("change", updateEntryPreview));
    refs.deleteEntryButton.addEventListener("click", deleteCurrentEntry);

    refs.seriesForm.addEventListener("submit", saveSeriesFromForm);
    refs.deleteSeriesButton.addEventListener("click", deleteCurrentSeries);
    refs.settingsForm.addEventListener("submit", saveSettingsFromForm);
    refs.setupForm.addEventListener("submit", saveSetupFromForm);
    refs.clearClientIdButton.addEventListener("click", clearClientId);
    refs.entryFilter.addEventListener("change", renderEntryList);

    refs.conflictExportButton.addEventListener("click", exportBackup);
    refs.conflictKeepLocalButton.addEventListener("click", async () => {
      if (!confirm("Der aktuelle lokale Stand überschreibt den neueren OneDrive-Stand. Wirklich fortfahren?")) return;
      refs.conflictDialog.close();
      await overwriteRemoteWithLocal();
    });
    refs.conflictLoadRemoteButton.addEventListener("click", async () => {
      refs.conflictDialog.close();
      await loadRemoteState(true);
    });

    window.addEventListener("online", () => { updateSyncUi(); scheduleSync(); });
    window.addEventListener("offline", updateSyncUi);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentAccount && !syncBlocked) syncNow(false);
    });
  }

  function defaultState() {
    return {
      schemaVersion: 1,
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
    next.series = Array.isArray(input?.series) ? input.series : [];
    next.revision = Number.isFinite(Number(input?.revision)) ? Number(input.revision) : 0;
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
    if (isUserChange) scheduleSync();
  }

  function changeYear(year) {
    activeYear = year;
    ensureYearSettings(activeYear);
    renderAll();
  }

  function renderAll() {
    refs.yearButton.textContent = activeYear;
    refs.legendOwn.textContent = `${state.names.own} Urlaub`;
    refs.legendPartner.textContent = `${state.names.partner} frei`;
    const partnerFilter = refs.entryFilter?.querySelector('option[value="partner-free"]');
    if (partnerFilter) partnerFilter.textContent = `${state.names.partner} frei`;
    renderSummary();
    renderCalendar();
    renderEntryList();
    renderCommonFree();
    updateSyncUi();
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
        const classes = ["day-cell"];
        if ([0,6].includes(date.getDay())) classes.push("weekend");
        if (key === today) classes.push("today");
        if (holidays.has(key)) classes.push("holiday");
        if (info.ownFree && info.partnerFree) classes.push("both-free");
        const titleParts = [];
        if (holidays.has(key)) titleParts.push(holidays.get(key));
        info.items.forEach(item => titleParts.push(item.title));
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
    refs.calendar.querySelectorAll("[data-date]").forEach(button => button.addEventListener("click", () => openDay(button.dataset.date)));
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
    refs.seriesList.innerHTML = series.map(item => `<div class="entry-item">
      <i class="entry-swatch ${item.type}"></i>
      <div class="entry-main"><div class="entry-title">${escapeHtml(item.title)}</div><div class="entry-meta">${WEEKDAY_NAMES[item.weekday]} · ${intervalName(item.interval)} · ${formatRange(item.start, item.end)}</div></div>
      <div class="entry-actions"><button class="small-button" type="button" data-edit-series="${item.id}">Bearbeiten</button></div>
    </div>`).join("");
    refs.seriesList.querySelectorAll("[data-edit-series]").forEach(btn => btn.addEventListener("click", () => {
      refs.seriesListDialog.close();
      openSeriesDialog(btn.dataset.editSeries);
    }));
  }

  function openDay(date) {
    const directEntries = state.entries.filter(e => date >= e.start && date <= e.end);
    if (directEntries.length === 1) openEntryDialog(directEntries[0].id);
    else openEntryDialog(null, date);
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
    refs.entryDialog.close();
    renderAll();
    showToast("Eintrag gespeichert.");
  }

  function deleteCurrentEntry() {
    const id = refs.entryId.value;
    if (!id || !confirm("Diesen Eintrag wirklich löschen?")) return;
    state.entries = state.entries.filter(e => e.id !== id);
    saveLocal(true);
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
    refs.seriesTitle.value = item?.title || "Freier Montag";
    refs.deleteSeriesButton.classList.toggle("hidden", !item);
    refs.seriesType.querySelector('option[value="partner-free"]').textContent = `${state.names.partner} frei`;
    refs.seriesDialog.showModal();
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
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, item); else state.series.push(item);
    saveLocal(true);
    refs.seriesDialog.close();
    renderAll();
    showToast("Serientermin gespeichert.");
  }

  function deleteCurrentSeries() {
    const id = refs.seriesId.value;
    if (!id || !confirm("Diesen Serientermin wirklich löschen?")) return;
    state.series = state.series.filter(s => s.id !== id);
    saveLocal(true);
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
    refs.settingsDialog.close();
    renderAll();
    showToast("Einstellungen gespeichert.");
  }

  function getDayInfo(key) {
    const direct = state.entries.filter(e => key >= e.start && key <= e.end).map(e => ({ ...e, title: e.note || displayTypeName(e.type) }));
    const recurring = state.series.filter(s => seriesOccursOn(s, key)).map(s => ({ ...s, dayPart: "full" }));
    const items = [...direct, ...recurring];
    return {
      items,
      ownFree: items.some(i => ["own-free", "vacation"].includes(i.type)) || isWeekendOrHoliday(key),
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
    if (state.entries.some(e => e.type === "own-free" && key >= e.start && key <= e.end)) return true;
    if (state.series.some(s => s.type === "own-free" && seriesOccursOn(s, key))) return true;
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
    if (key < series.start || key > series.end) return false;
    const date = parseDate(key);
    if (date.getDay() !== Number(series.weekday)) return false;
    const first = firstWeekdayOnOrAfter(parseDate(series.start), Number(series.weekday));
    if (date < first) return false;
    const weeks = Math.floor(daysBetween(dateKey(first), key) / 7);
    return weeks % Number(series.interval || 1) === 0;
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

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Urlaubskalender_Sicherung_${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast("Datensicherung wurde erstellt.");
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = normalizeState(JSON.parse(await file.text()));
      if (!confirm("Die eingelesene Sicherung ersetzt die derzeitigen lokalen Daten. Fortfahren?")) return;
      state = parsed;
      activeYear = new Date().getFullYear();
      ensureYearSettings(activeYear);
      saveLocal(true);
      renderAll();
      closeMenu();
      showToast("Datensicherung wurde eingelesen.");
    } catch (error) {
      console.error(error);
      showToast("Die Sicherungsdatei ist ungültig.", "error");
    }
  }

  function updateSetupFields() {
    refs.clientIdInput.value = localStorage.getItem(CLIENT_ID_KEY) || "";
    refs.permissionModeInput.value = localStorage.getItem(PERMISSION_MODE_KEY) || "personal";
    refs.redirectUriInput.value = getRedirectUri();
  }

  async function saveSetupFromForm(event) {
    event.preventDefault();
    const clientId = refs.clientIdInput.value.trim();
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return showToast("Die Anwendungs-ID sieht nicht gültig aus.", "error");
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    localStorage.setItem(PERMISSION_MODE_KEY, refs.permissionModeInput.value || "personal");
    refs.setupDialog.close();
    showToast("Anwendungs-ID gespeichert. Microsoft-Verbindung wird vorbereitet.");
    await initializeMicrosoft(true);
  }

  async function clearClientId() {
    if (!confirm("Anwendungs-ID und Microsoft-Anmeldung auf diesem Gerät entfernen? Die Kalenderdaten bleiben erhalten.")) return;
    try { if (msalInstance && currentAccount) await msalInstance.logoutRedirect({ account: currentAccount, postLogoutRedirectUri: getRedirectUri() }); }
    catch (error) { console.warn(error); }
    localStorage.removeItem(CLIENT_ID_KEY);
    localStorage.removeItem(PERMISSION_MODE_KEY);
    localStorage.removeItem(SYNC_BASE_KEY);
    msalInstance = null;
    currentAccount = null;
    remoteMeta = { id: null, eTag: null };
    refs.setupDialog.close();
    updateSyncUi();
  }

  function getRedirectUri() {
    if (location.protocol === "file:") return "Die OneDrive-Anmeldung funktioniert erst über die veröffentlichte HTTPS-Adresse.";
    return `${location.origin}${location.pathname}`;
  }

  async function initializeMicrosoft(force = false) {
    const clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId || location.protocol === "file:" || typeof msal === "undefined") {
      updateSyncUi();
      return;
    }
    if (msalInstance && !force) return;
    try {
      msalInstance = new msal.PublicClientApplication({
        auth: {
          clientId,
          authority: "https://login.microsoftonline.com/common",
          redirectUri: getRedirectUri(),
          postLogoutRedirectUri: getRedirectUri(),
          navigateToLoginRequestUrl: true
        },
        cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true }
      });
      const response = await msalInstance.handleRedirectPromise();
      if (response?.account) msalInstance.setActiveAccount(response.account);
      currentAccount = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
      if (currentAccount) {
        msalInstance.setActiveAccount(currentAccount);
        await loadRemoteState(false);
      }
    } catch (error) {
      console.error("Microsoft-Initialisierung fehlgeschlagen", error);
      showToast(humanizeMsError(error), "error");
    }
    updateSyncUi();
  }

  async function handleSyncButton() {
    const clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      updateSetupFields();
      refs.setupDialog.showModal();
      return;
    }
    if (!msalInstance) await initializeMicrosoft(true);
    if (!currentAccount) await loginMicrosoft();
    else await syncNow(true);
  }

  function getGraphScopes() {
    return [localStorage.getItem(PERMISSION_MODE_KEY) === "business" ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"];
  }

  async function loginMicrosoft() {
    if (!msalInstance) return showToast("Die Microsoft-Anmeldung ist noch nicht eingerichtet.", "warning");
    try {
      await msalInstance.loginRedirect({ scopes: ["openid", "profile", ...getGraphScopes()], prompt: "select_account" });
    } catch (error) {
      console.error(error);
      showToast(humanizeMsError(error), "error");
    }
  }

  async function logoutMicrosoft() {
    closeMenu();
    if (!msalInstance || !currentAccount) return;
    await msalInstance.logoutRedirect({ account: currentAccount, postLogoutRedirectUri: getRedirectUri() });
  }

  async function getAccessToken() {
    if (!msalInstance || !currentAccount) throw new Error("Nicht mit Microsoft verbunden.");
    try {
      const result = await msalInstance.acquireTokenSilent({ account: currentAccount, scopes: getGraphScopes() });
      return result.accessToken;
    } catch (error) {
      if (error instanceof msal.InteractionRequiredAuthError) {
        await msalInstance.acquireTokenRedirect({ account: currentAccount, scopes: getGraphScopes() });
        throw new Error("Anmeldung wird erneuert.");
      }
      throw error;
    }
  }

  async function graphFetch(path, options = {}) {
    const token = await getAccessToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${GRAPH_ROOT}${path}`, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Microsoft Graph ${response.status}: ${text || response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function getRemoteMetadata() {
    try {
      const response = await graphFetch(`/me/drive/special/approot:/${encodeURIComponent(REMOTE_FILE)}?$select=id,name,eTag,lastModifiedDateTime`);
      return await response.json();
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function loadRemoteState(force = false) {
    if (!currentAccount || !navigator.onLine) return;
    setSyncStatus("OneDrive wird geladen …");
    try {
      const meta = await getRemoteMetadata();
      if (!meta) {
        await saveRemoteState(true);
        return;
      }
      const response = await graphFetch(`/me/drive/items/${meta.id}/content`);
      const remoteState = normalizeState(await response.json());
      const syncBase = localStorage.getItem(SYNC_BASE_KEY);
      const localHasData = state.revision > 0 || state.entries.length > 0 || state.series.length > 0;
      const remoteHasData = remoteState.revision > 0 || remoteState.entries.length > 0 || remoteState.series.length > 0;
      const localChanged = syncBase ? state.updatedAt !== syncBase : localHasData;
      const remoteChanged = syncBase ? remoteState.updatedAt !== syncBase : remoteHasData;

      remoteMeta = { id: meta.id, eTag: meta.eTag };

      if (!force && localChanged && remoteChanged && state.updatedAt !== remoteState.updatedAt) {
        syncBlocked = true;
        setSyncStatus("Konflikt: lokale und OneDrive-Daten wurden geändert");
        refs.conflictDialog.showModal();
        return;
      }
      if (!force && localChanged && !remoteChanged) {
        await saveRemoteState(false, false, true);
        return;
      }

      state = remoteState;
      ensureYearSettings(activeYear);
      syncBlocked = false;
      saveLocal(false);
      markSyncBase();
      renderAll();
      setSyncStatus(`Mit ${currentAccount.username || "Microsoft"} verbunden`);
      showToast("OneDrive-Daten geladen.");
    } catch (error) {
      console.error(error);
      setSyncStatus("OneDrive konnte nicht geladen werden");
      showToast(humanizeGraphError(error), "error");
    }
  }

  function scheduleSync() {
    if (!currentAccount || !navigator.onLine || syncBlocked) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => saveRemoteState(false), 1800);
  }

  async function syncNow(showMessage) {
    if (!currentAccount) return handleSyncButton();
    if (!navigator.onLine) return showToast("Keine Internetverbindung. Lokal ist alles gespeichert.", "warning");
    if (syncBlocked) return refs.conflictDialog.showModal();
    await saveRemoteState(false, showMessage);
  }

  async function saveRemoteState(createIfMissing = false, showMessage = false, forceOverwrite = false) {
    if (!currentAccount || !navigator.onLine || (syncBlocked && !forceOverwrite)) return;
    clearTimeout(syncTimer);
    setSyncStatus("Speichert in OneDrive …");
    try {
      let meta = await getRemoteMetadata();
      if (!forceOverwrite && meta && remoteMeta.eTag && meta.eTag !== remoteMeta.eTag) {
        syncBlocked = true;
        setSyncStatus("Konflikt: neuere OneDrive-Daten vorhanden");
        refs.conflictDialog.showModal();
        return;
      }
      const body = JSON.stringify(state, null, 2);
      let response;
      if (meta) {
        const headers = { "Content-Type": "application/json" };
        if (meta.eTag) headers["If-Match"] = meta.eTag;
        response = await graphFetch(`/me/drive/items/${meta.id}/content`, { method: "PUT", headers, body });
      } else {
        response = await graphFetch(`/me/drive/special/approot:/${encodeURIComponent(REMOTE_FILE)}:/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body
        });
      }
      const saved = await response.json();
      remoteMeta = { id: saved.id, eTag: saved.eTag };
      syncBlocked = false;
      markSyncBase();
      setSyncStatus(`Gespeichert · ${formatTime(new Date())}`);
      if (showMessage || createIfMissing) showToast("Mit OneDrive synchronisiert.");
    } catch (error) {
      console.error(error);
      if (error.status === 412) {
        syncBlocked = true;
        setSyncStatus("Konflikt: Daten wurden auf einem anderen Gerät geändert");
        refs.conflictDialog.showModal();
      } else {
        setSyncStatus("OneDrive-Speicherung fehlgeschlagen");
        if (showMessage) showToast(humanizeGraphError(error), "error");
      }
    }
  }

  async function overwriteRemoteWithLocal() {
    if (!currentAccount || !navigator.onLine) return;
    try {
      const meta = await getRemoteMetadata();
      remoteMeta = meta ? { id: meta.id, eTag: meta.eTag } : { id: null, eTag: null };
      syncBlocked = false;
      await saveRemoteState(!meta, true, true);
    } catch (error) {
      console.error(error);
      showToast(humanizeGraphError(error), "error");
    }
  }

  function markSyncBase() {
    localStorage.setItem(SYNC_BASE_KEY, state.updatedAt);
  }

  function updateSyncUi() {
    const hasClientId = Boolean(localStorage.getItem(CLIENT_ID_KEY));
    if (currentAccount) {
      refs.syncButton.textContent = navigator.onLine ? "Synchronisieren" : "Offline";
      refs.logoutButton.classList.remove("hidden");
      if (!refs.syncStatus.textContent || refs.syncStatus.textContent === "Nur lokal gespeichert") setSyncStatus(`Mit ${currentAccount.username || "Microsoft"} verbunden`);
    } else {
      refs.syncButton.textContent = hasClientId ? "OneDrive verbinden" : "OneDrive einrichten";
      refs.logoutButton.classList.add("hidden");
      setSyncStatus(hasClientId ? "Microsoft-Anmeldung noch nicht verbunden" : "Nur lokal gespeichert");
    }
  }

  function setSyncStatus(text) { refs.syncStatus.textContent = text; }

  function humanizeGraphError(error) {
    const message = String(error?.message || error);
    if (message.includes("403")) return `Microsoft hat den Zugriff abgelehnt. Bitte die App-Berechtigung ${getGraphScopes()[0]} prüfen.`;
    if (message.includes("401")) return "Die Microsoft-Anmeldung ist abgelaufen. Bitte erneut verbinden.";
    if (message.includes("404")) return "Der OneDrive-App-Ordner konnte nicht gefunden werden.";
    return "OneDrive konnte nicht synchronisiert werden. Die Daten bleiben lokal erhalten.";
  }

  function humanizeMsError(error) {
    const message = String(error?.errorMessage || error?.message || error);
    if (message.includes("redirect_uri")) return "Die Umleitungsadresse stimmt nicht mit der Microsoft-App-Registrierung überein.";
    if (message.includes("client_id") || message.includes("application")) return "Die Microsoft-Anwendungs-ID ist falsch oder nicht freigeschaltet.";
    return "Die Microsoft-Anmeldung konnte nicht abgeschlossen werden.";
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
