(() => {
  "use strict";

  const STORAGE_KEY = "urlaubskalender-data-v1";
  const SAFE_REVISION_KEY = "urlaubskalender-safe-revision";
  const SAFE_AT_KEY = "urlaubskalender-safe-at";
  const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const STATUS_NAMES = { planned: "geplant", requested: "beantragt", approved: "genehmigt", taken: "genommen" };
  const TYPE_NAMES = { vacation: "Urlaub", "own-free": "Freier Tag", "partner-free": "Partnerin frei", other: "Sonstiges" };

  let state = loadLocalState();
  let activeYear = new Date().getFullYear();
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const refs = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheRefs();
    bindEvents();
    ensureYearSettings(activeYear);
    renderAll();
    registerServiceWorker();
  }

  function cacheRefs() {
    [
      "toast", "backupButton", "backupBarButton", "loadButton", "backupHeadline", "backupDetails", "menuButton",
      "prevYear", "nextYear", "yearButton", "todayButton", "addEntryButton", "addSeriesButton",
      "summaryCards", "calendar", "entryFilter", "entryList", "commonFreeList", "sideMenu", "backupStatus", "settingsButton",
      "seriesListButton", "exportButton", "importInput", "backupHelpButton", "printButton",
      "entryDialog", "entryForm", "entryDialogTitle", "entryId", "entryType", "entryStatus", "entryStart", "entryEnd", "entryDayPart",
      "entryNote", "entryPreview", "deleteEntryButton", "statusField", "dayPartField", "seriesDialog", "seriesForm", "seriesDialogTitle",
      "seriesId", "seriesType", "seriesWeekday", "seriesInterval", "seriesStart", "seriesEnd", "seriesTitle", "deleteSeriesButton",
      "settingsDialog", "settingsForm", "ownName", "partnerName", "annualLeave", "carryOver", "holidaysEnabled", "settingsYearLabel",
      "seriesListDialog", "seriesList", "newSeriesFromList", "backupHelpDialog", "legendOwn", "legendPartner"
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
    refs.backupButton.addEventListener("click", exportBackup);
    refs.backupBarButton.addEventListener("click", exportBackup);
    refs.exportButton.addEventListener("click", () => { closeMenu(); exportBackup(); });
    refs.loadButton.addEventListener("click", () => refs.importInput.click());
    refs.importInput.addEventListener("change", importBackup);
    refs.backupHelpButton.addEventListener("click", () => { closeMenu(); refs.backupHelpDialog.showModal(); });
    refs.printButton.addEventListener("click", () => { closeMenu(); window.print(); });

    refs.entryForm.addEventListener("submit", saveEntryFromForm);
    refs.entryType.addEventListener("change", updateEntryFormVisibility);
    [refs.entryStart, refs.entryEnd, refs.entryType, refs.entryDayPart].forEach(el => el.addEventListener("change", updateEntryPreview));
    refs.deleteEntryButton.addEventListener("click", deleteCurrentEntry);

    refs.seriesForm.addEventListener("submit", saveSeriesFromForm);
    refs.deleteSeriesButton.addEventListener("click", deleteCurrentSeries);
    refs.settingsForm.addEventListener("submit", saveSettingsFromForm);
    refs.entryFilter.addEventListener("change", renderEntryList);
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
    updateBackupUi();
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
      showToast("Sicherung wurde eingelesen.");
    } catch (error) {
      console.error(error);
      showToast("Die Sicherungsdatei ist ungültig.", "error");
    }
  }

  function markCurrentStateSafe() {
    localStorage.setItem(SAFE_REVISION_KEY, String(Number(state.revision) || 0));
    localStorage.setItem(SAFE_AT_KEY, new Date().toISOString());
    updateBackupUi();
  }

  function updateBackupUi() {
    if (!refs.backupHeadline) return;
    const safeRevision = Number(localStorage.getItem(SAFE_REVISION_KEY));
    const hasSafeRevision = localStorage.getItem(SAFE_REVISION_KEY) !== null;
    const isDirty = !hasSafeRevision || safeRevision !== Number(state.revision || 0);
    const safeAt = localStorage.getItem(SAFE_AT_KEY);

    if (isDirty) {
      refs.backupHeadline.textContent = "Neue Änderungen noch nicht für andere Geräte gesichert";
      refs.backupDetails.textContent = "Auf diesem Gerät sind sie gespeichert. Jetzt eine Sicherung in OneDrive ablegen.";
      refs.backupStatus.textContent = "Neue Änderungen vorhanden. Vor dem Gerätewechsel bitte sichern.";
      refs.backupButton.classList.add("attention");
      refs.backupBarButton.classList.add("attention");
    } else {
      const when = safeAt ? formatDateTime(safeAt) : "gerade eben";
      refs.backupHeadline.textContent = "Aktueller Stand wurde gesichert oder geladen";
      refs.backupDetails.textContent = `Letzter gesicherter Stand: ${when}`;
      refs.backupStatus.textContent = `Letzter gesicherter oder geladener Stand: ${when}`;
      refs.backupButton.classList.remove("attention");
      refs.backupBarButton.classList.remove("attention");
    }
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
