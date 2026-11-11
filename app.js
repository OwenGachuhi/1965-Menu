/*
 * 1965 Cafeteria Menu — static app for GitHub Pages.
 *
 * Everything the page shows comes from menu.json. Students get a read-only
 * menu, a live open/closed badge, and calorie/price calculators. Kitchen
 * managers can unlock an editor and commit menu.json back to the repository
 * through the GitHub REST API (or download it as a backup).
 *
 * No build step, no framework, no backend.
 */
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const MENU_PATH = 'menu.json';
  const GITHUB_API = 'https://api.github.com';
  const STORAGE_KEYS = {
    repo: 'cafeteriaMenu.github.repo',
    branch: 'cafeteriaMenu.github.branch',
    token: 'cafeteriaMenu.github.token',
  };

  const STATUS = {
    open: {
      label: 'Open Now • Full Cafeteria Menu Available',
      classes: 'bg-emerald-400 text-emerald-950',
      icon: 'circle-check',
    },
    afternoon: {
      label: 'Afternoon Hours • Espresso Bar & Baked Goods Only',
      classes: 'bg-amber-400 text-amber-950',
      icon: 'coffee',
    },
    closed: {
      label: 'Cafeteria Currently Closed • Viewing Menu',
      classes: 'bg-red-700 text-white ring-2 ring-red-300/60',
      icon: 'clock',
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    menu: null,          // working copy rendered on the page (edited by the manager)
    published: '',       // JSON string of the last loaded / published menu
    activeTab: 'all',
    selections: {},      // stationId -> array of selected item ids (calculators)
    lastStatus: null,
    unlocked: false,
    managerTab: 'settings',
    gh: { repo: '', branch: 'main', token: '', remember: false },
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const icon = (name, extra = '') =>
    `<i data-lucide="${esc(name)}" aria-hidden="true" class="${esc(extra)}"></i>`;

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const fmtPrice = (n) => `$${Number(n).toFixed(2)}`;

  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return NaN;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return NaN;
    return h * 60 + min;
  }

  function fmtTime(hhmm) {
    const total = toMinutes(hhmm);
    if (Number.isNaN(total)) return '—';
    const h24 = Math.floor(total / 60);
    const min = total % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(min).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
  }

  const uid = (prefix) =>
    `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const serializeMenu = (menu) => `${JSON.stringify(menu, null, 2)}\n`;

  function defaultAfternoonNotice(hours) {
    return `From ${fmtTime(hours.main_close)} to ${fmtTime(hours.espresso_close)}, main stations are closed; only the Espresso Bar is open, serving coffee and Bakery items.`;
  }

  // ---------------------------------------------------------------------------
  // Menu loading + normalisation
  // ---------------------------------------------------------------------------
  function normalizeItem(item) {
    return {
      id: String(item.id || uid('item')),
      name: String(item.name ?? ''),
      price: isNum(item.price) ? item.price : null,
      calories: isNum(item.calories) ? item.calories : null,
      description: String(item.description ?? ''),
      allergens: Array.isArray(item.allergens) ? item.allergens.map(String) : [],
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      available: item.available !== false,
    };
  }

  function normalizeMenu(raw) {
    const menu = raw && typeof raw === 'object' ? raw : {};
    menu.settings = Object.assign(
      { cafeteria_name: 'Cafeteria', admin_passcode_sha256: '', nutrition_advisory: '' },
      menu.settings,
    );
    menu.hours = Object.assign(
      { open: '08:00', main_close: '14:30', espresso_close: '16:00', main_label: 'Breakfast & Lunch' },
      menu.hours,
    );
    if (typeof menu.hours.afternoon_notice !== 'string') {
      menu.hours.afternoon_notice = defaultAfternoonNotice(menu.hours);
    }
    menu.stations = (Array.isArray(menu.stations) ? menu.stations : []).map((st) => ({
      ...st,
      id: String(st.id || uid('station')),
      name: String(st.name ?? ''),
      tagline: String(st.tagline ?? ''),
      note: String(st.note ?? ''),
      hours_group: st.hours_group === 'espresso' ? 'espresso' : 'main',
      builder: st.builder && typeof st.builder === 'object' ? st.builder : null,
      sections: (Array.isArray(st.sections) ? st.sections : []).map((sec) => ({
        ...sec,
        id: String(sec.id || uid('section')),
        title: String(sec.title ?? ''),
        price_note: String(sec.price_note ?? ''),
        builder: sec.builder && typeof sec.builder === 'object' ? sec.builder : null,
        items: (Array.isArray(sec.items) ? sec.items : []).map(normalizeItem),
      })),
    }));
    return menu;
  }

  async function loadMenu() {
    // Cache-busting query so students see a fresh publish as soon as Pages updates.
    const res = await fetch(`${MENU_PATH}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${MENU_PATH}`);
    return normalizeMenu(await res.json());
  }

  function showLoadError(err) {
    const fileHint =
      location.protocol === 'file:'
        ? '<p class="mt-2">You opened the file directly from your computer. Browsers block loading <code>menu.json</code> that way. Use the GitHub Pages link, or run <code>python3 -m http.server</code> in this folder and open <code>http://localhost:8000</code>.</p>'
        : '';
    $('#app').innerHTML = `
      <div role="alert" class="rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
        <p class="font-bold">The menu could not be loaded.</p>
        <p class="mt-1 text-sm">${esc(err.message)}</p>
        ${fileHint}
      </div>`;
    $('#status-banner').innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Time-of-day status
  // ---------------------------------------------------------------------------
  function getStatus(now = new Date()) {
    const h = state.menu.hours;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const open = toMinutes(h.open);
    const mainClose = toMinutes(h.main_close);
    const espressoClose = toMinutes(h.espresso_close);
    if (minutes >= open && minutes < mainClose) return 'open';
    if (minutes >= mainClose && minutes < espressoClose) return 'afternoon';
    return 'closed';
  }

  function isStationServing(station, status) {
    if (status === 'open') return true;
    if (status === 'afternoon') return station.hours_group === 'espresso';
    return false;
  }

  function renderStatusBanner() {
    const h = state.menu.hours;
    const status = getStatus();
    const s = STATUS[status];
    state.lastStatus = status;
    $('#status-banner').innerHTML = `
      <h2 id="hours-heading" class="sr-only">Operating hours and live status</h2>
      <div class="flex flex-wrap items-center gap-3">
        <span id="status-badge" role="status"
              class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow ${s.classes}">
          ${icon(s.icon)} ${esc(s.label)}
        </span>
        <span id="status-time" class="text-sm text-emerald-100"></span>
      </div>
      <dl class="mt-4 grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl bg-white/10 p-3">
          <dt class="text-xs font-semibold uppercase tracking-wide text-emerald-200">Main Cafeteria Stations</dt>
          <dd class="mt-0.5 font-semibold">${esc(h.main_label)}: ${fmtTime(h.open)} – ${fmtTime(h.main_close)}</dd>
        </div>
        <div class="rounded-xl bg-white/10 p-3">
          <dt class="text-xs font-semibold uppercase tracking-wide text-emerald-200">Bakery &amp; Espresso Bar</dt>
          <dd class="mt-0.5 font-semibold">${fmtTime(h.open)} – ${fmtTime(h.espresso_close)}</dd>
        </div>
      </dl>
      <div class="mt-3 flex gap-2 rounded-xl border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
        ${icon('coffee', 'mt-0.5 shrink-0')}
        <p><strong>Late Afternoon Service (${fmtTime(h.main_close)} – ${fmtTime(h.espresso_close)}):</strong>
          ${esc(h.afternoon_notice)}</p>
      </div>`;
    updateStatusTime();
  }

  function updateStatusTime() {
    const el = $('#status-time');
    if (el) {
      const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      el.textContent = `As of ${t} (your local time)`;
    }
  }

  function tick() {
    if (!state.menu) return;
    if (getStatus() !== state.lastStatus) {
      // Status changed (e.g. 2:30 PM passed): refresh banner + "serving now" pills.
      renderStatusBanner();
      renderView();
      refreshIcons();
    } else {
      updateStatusTime();
    }
  }

  // ---------------------------------------------------------------------------
  // Public view: tabs
  // ---------------------------------------------------------------------------
  function tabList() {
    return [
      { id: 'all', name: 'All Stations', icon: 'layout-grid' },
      ...state.menu.stations.map((st) => ({ id: st.id, name: st.name, icon: st.icon || 'utensils' })),
    ];
  }

  function renderTabs() {
    const tabs = tabList();
    if (!tabs.some((t) => t.id === state.activeTab)) state.activeTab = 'all';
    $('#station-tabs').innerHTML = tabs
      .map((t) => {
        const active = t.id === state.activeTab;
        return `
          <button type="button" role="tab" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}"
                  aria-selected="${active}" aria-controls="app" tabindex="${active ? 0 : -1}"
                  class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition
                         ${active ? 'bg-emerald-800 text-white shadow' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}">
            ${icon(t.icon)} ${esc(t.name)}
          </button>`;
      })
      .join('');
    $('#app').setAttribute('aria-labelledby', `tab-${state.activeTab}`);
  }

  function activateTab(id, { focus = false } = {}) {
    state.activeTab = id;
    renderTabs();
    renderView();
    refreshIcons();
    history.replaceState(null, '', id === 'all' ? location.pathname + location.search : `#${id}`);
    const btn = $(`#tab-${CSS.escape(id)}`);
    if (btn) {
      btn.scrollIntoView({ block: 'nearest', inline: 'center' });
      if (focus) btn.focus();
    }
  }

  function onTabKeydown(e) {
    const btn = e.target.closest('[role="tab"]');
    if (!btn) return;
    const ids = tabList().map((t) => t.id);
    const idx = ids.indexOf(btn.dataset.tab);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(idx + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(idx - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (next) {
      e.preventDefault();
      activateTab(next, { focus: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Public view: cards and badges
  // ---------------------------------------------------------------------------
  function tagChip(tag) {
    const t = tag.toLowerCase();
    let cls = 'bg-sky-100 text-sky-900';
    let ic = 'tag';
    if (t.includes('vegetarian') || t.includes('vegan')) { cls = 'bg-emerald-100 text-emerald-900'; ic = 'leaf'; }
    else if (t.includes('halal')) { cls = 'bg-teal-100 text-teal-900'; ic = 'shield-check'; }
    else if (t.includes('gluten')) { cls = 'bg-amber-100 text-amber-900'; ic = 'wheat'; }
    return `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}">${icon(ic)} ${esc(tag)}</span>`;
  }

  const allergenChip = (a) =>
    `<span class="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-900">${icon('triangle-alert')} ${esc(a)}</span>`;

  const calorieChip = (cal) =>
    `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">${esc(cal)} Cal</span>`;

  function itemChips(item) {
    const chips = [];
    if (isNum(item.calories)) chips.push(calorieChip(item.calories));
    item.tags.forEach((t) => chips.push(tagChip(t)));
    item.allergens.forEach((a) => chips.push(allergenChip(a)));
    return chips.length ? `<div class="mt-2 flex flex-wrap gap-1.5">${chips.join('')}</div>` : '';
  }

  const soldOutBadge = () => `
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span class="-rotate-6 rounded-md border-2 border-white bg-red-700 px-4 py-1 text-lg font-black uppercase tracking-[0.2em] text-white shadow-lg ring-2 ring-red-800">
        Sold Out
      </span>
    </div>`;

  function itemCard(item) {
    const sold = !item.available;
    return `
      <li class="relative rounded-xl border p-4 shadow-sm ${sold ? 'border-slate-300 bg-slate-100' : 'border-slate-200 bg-white'}">
        <div class="${sold ? 'opacity-50 grayscale' : ''}">
          <div class="flex items-start justify-between gap-3">
            <h4 class="font-semibold leading-snug ${sold ? 'line-through decoration-2' : ''}">${esc(item.name)}</h4>
            ${isNum(item.price) ? `<span class="whitespace-nowrap font-bold text-emerald-900">${fmtPrice(item.price)}</span>` : ''}
          </div>
          ${item.description ? `<p class="mt-1 text-sm text-slate-600">${esc(item.description)}</p>` : ''}
          ${itemChips(item)}
        </div>
        ${sold ? soldOutBadge() : ''}
      </li>`;
  }

  function sectionCards(section) {
    const headingId = `sec-${section.id}`;
    return `
      <section aria-labelledby="${esc(headingId)}" class="mt-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
          <h3 id="${esc(headingId)}" class="text-lg font-bold">${esc(section.title)}</h3>
          ${section.price_note ? `<p class="text-sm font-semibold text-emerald-800">${esc(section.price_note)}</p>` : ''}
        </div>
        ${section.items.length
          ? `<ul class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${section.items.map(itemCard).join('')}</ul>`
          : '<p class="mt-3 text-sm text-slate-500">No items listed right now.</p>'}
      </section>`;
  }

  function stationHeader(station, status) {
    const serving = isStationServing(station, status);
    return `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-2xl text-emerald-800">${icon(station.icon || 'utensils')}</span>
          <div>
            <h2 class="text-xl font-extrabold sm:text-2xl">${esc(station.name)}</h2>
            ${station.tagline ? `<p class="text-sm font-medium text-slate-600">${esc(station.tagline)}</p>` : ''}
          </div>
        </div>
        <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${serving ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'}">
          <span class="h-2 w-2 rounded-full ${serving ? 'bg-emerald-600' : 'bg-slate-500'}" aria-hidden="true"></span>
          ${serving ? 'Serving now' : 'Not serving right now'}
        </span>
      </div>
      ${station.note ? `<p class="mt-3 flex gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-950">${icon('info', 'mt-0.5 shrink-0')}<span>${esc(station.note)}</span></p>` : ''}`;
  }

  function weightBanner(station) {
    if (station.pricing_model !== 'by_weight') return '';
    const rate = isNum(station.price_per_lb) ? `<p class="text-base font-bold text-emerald-900">Current rate: ${fmtPrice(station.price_per_lb)} per lb</p>` : '';
    return `
      <div class="mt-4 flex gap-3 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4">
        <span class="text-2xl text-emerald-800">${icon('scale')}</span>
        <div>
          <p class="text-lg font-extrabold text-emerald-950">Priced by Weight — Pay per lb at the register</p>
          ${rate}
          ${station.price_per_lb_display ? `<p class="text-sm font-medium text-emerald-900">${esc(station.price_per_lb_display)}</p>` : ''}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Public view: calorie / price calculator
  // ---------------------------------------------------------------------------
  function builderSections(station) {
    return station.sections.filter((sec) => sec.builder);
  }

  function getSelectedItems(station) {
    const ids = new Set(state.selections[station.id] || []);
    const picked = [];
    builderSections(station).forEach((sec) =>
      sec.items.forEach((item) => {
        if (ids.has(item.id) && item.available) picked.push(item);
      }),
    );
    return picked;
  }

  function pruneSelections() {
    // Drop selections for items that were removed or marked Sold Out.
    state.menu.stations.forEach((st) => {
      if (!state.selections[st.id]) return;
      state.selections[st.id] = getSelectedItems(st).map((i) => i.id);
    });
  }

  function builderOption(station, section, item) {
    const sold = !item.available;
    const checked = (state.selections[station.id] || []).includes(item.id);
    const group = section.builder.select === 'single' ? section.builder.group || section.id : '';
    const inputId = `opt-${station.id}-${item.id}`;
    const meta = [];
    if (isNum(item.calories)) meta.push(`${item.calories} Cal`);
    if (station.builder.show_price && isNum(item.price)) meta.push(fmtPrice(item.price));
    return `
      <div class="relative">
        <label for="${esc(inputId)}"
               class="flex h-full items-start gap-3 rounded-xl border p-3 transition
                      ${sold
                        ? 'cursor-not-allowed border-slate-300 bg-slate-100 opacity-50 grayscale'
                        : 'cursor-pointer border-slate-200 bg-white hover:border-emerald-500 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-50 has-[:checked]:ring-1 has-[:checked]:ring-emerald-700'}">
          <input id="${esc(inputId)}" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-emerald-700"
                 data-builder="${esc(station.id)}" data-item="${esc(item.id)}" data-group="${esc(group)}"
                 ${checked && !sold ? 'checked' : ''} ${sold ? 'disabled' : ''} />
          <span class="min-w-0 flex-1">
            <span class="flex items-start justify-between gap-2">
              <span class="font-semibold leading-snug">${esc(item.name)}${sold ? '<span class="sr-only"> (sold out)</span>' : ''}</span>
              ${meta.length ? `<span class="whitespace-nowrap text-sm font-semibold text-slate-700">${esc(meta.join(' · '))}</span>` : ''}
            </span>
            ${item.description ? `<span class="mt-1 block text-sm text-slate-600">${esc(item.description)}</span>` : ''}
            ${item.tags.length || item.allergens.length
              ? `<span class="mt-2 flex flex-wrap gap-1.5">${item.tags.map(tagChip).join('')}${item.allergens.map(allergenChip).join('')}</span>`
              : ''}
          </span>
        </label>
        ${sold ? soldOutBadge() : ''}
      </div>`;
  }

  function builderTotals(station) {
    const picked = getSelectedItems(station);
    const calories = picked.reduce((sum, i) => sum + (isNum(i.calories) ? i.calories : 0), 0);
    const price = picked.reduce((sum, i) => sum + (isNum(i.price) ? i.price : 0), 0);
    const missingCalories = picked.some((i) => !isNum(i.calories));
    const noCaloriesKnown = picked.length > 0 && picked.every((i) => !isNum(i.calories));
    const calorieText = noCaloriesKnown ? 'Calories not listed*' : `${calories} Cal${missingCalories ? '*' : ''}`;
    const showPrice = Boolean(station.builder.show_price);
    return `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Your total</p>
          <p class="text-2xl font-extrabold text-emerald-900">${calorieText}</p>
          ${showPrice ? `<p class="font-semibold text-slate-800">Estimated price: ${fmtPrice(price)}</p>` : ''}
        </div>
        <button type="button" data-reset-builder="${esc(station.id)}"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">
          ${icon('rotate-ccw')} Reset
        </button>
      </div>
      <p class="mt-1 text-sm text-slate-600">${picked.length ? esc(picked.map((i) => i.name).join(', ')) : 'Nothing selected yet.'}</p>
      ${missingCalories ? '<p class="mt-1 text-xs text-slate-500">* Some selected items do not list calories. Ask staff for full nutrition details.</p>' : ''}
      ${station.pricing_model === 'by_weight' ? '<p class="mt-1 text-xs text-slate-500">Final price is by weight at the register.</p>' : ''}`;
  }

  function builderPanel(station) {
    const headingId = `builder-${station.id}`;
    const what = station.builder.show_price ? 'calories and estimated price' : 'calories';
    return `
      <section aria-labelledby="${esc(headingId)}" class="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="border-b border-slate-200 p-4">
          <h3 id="${esc(headingId)}" class="flex items-center gap-2 text-lg font-bold">${icon('calculator')} ${esc(station.builder.title || 'Calculator')}</h3>
          <p class="mt-1 text-sm text-slate-600">Check the items you want to see your live total ${what}. This is a calculator only. Order at the station.</p>
        </div>
        <div class="space-y-6 p-4">
          ${builderSections(station)
            .map((sec) => `
              <fieldset>
                <legend class="text-base font-bold">${esc(sec.title)}
                  ${sec.builder.select === 'single' ? '<span class="text-sm font-normal text-slate-500">(pick one)</span>' : ''}
                  ${sec.price_note && sec.price_note.toLowerCase() !== 'pick one' ? `<span class="text-sm font-semibold text-emerald-800">· ${esc(sec.price_note)}</span>` : ''}
                </legend>
                <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  ${sec.items.map((item) => builderOption(station, sec, item)).join('') || '<p class="text-sm text-slate-500">No options listed.</p>'}
                </div>
              </fieldset>`)
            .join('')}
        </div>
        <div id="totals-${esc(station.id)}" class="sticky bottom-0 rounded-b-2xl border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
          ${builderTotals(station)}
        </div>
      </section>`;
  }

  function updateTotals(stationId) {
    const station = state.menu.stations.find((s) => s.id === stationId);
    const box = $(`#totals-${CSS.escape(stationId)}`);
    if (station && box) {
      box.innerHTML = builderTotals(station);
      refreshIcons();
    }
  }

  function onBuilderChange(e) {
    const input = e.target.closest('input[data-builder]');
    if (!input) return;
    const sid = input.dataset.builder;
    const selected = new Set(state.selections[sid] || []);
    if (input.checked) {
      const group = input.dataset.group;
      if (group) {
        // Single-choice group (e.g. one bread, one entree): clear the others.
        $$(`input[data-builder="${CSS.escape(sid)}"][data-group="${CSS.escape(group)}"]`).forEach((other) => {
          if (other !== input) {
            other.checked = false;
            selected.delete(other.dataset.item);
          }
        });
      }
      selected.add(input.dataset.item);
    } else {
      selected.delete(input.dataset.item);
    }
    state.selections[sid] = Array.from(selected);
    updateTotals(sid);
  }

  function onAppClick(e) {
    const reset = e.target.closest('[data-reset-builder]');
    if (reset) {
      const sid = reset.dataset.resetBuilder;
      state.selections[sid] = [];
      $$(`input[data-builder="${CSS.escape(sid)}"]`).forEach((i) => { i.checked = false; });
      updateTotals(sid);
      $(`[data-reset-builder="${CSS.escape(sid)}"]`)?.focus();
      return;
    }
    const goto = e.target.closest('[data-goto-tab]');
    if (goto) {
      activateTab(goto.dataset.gotoTab);
      window.scrollTo({ top: 0 });
      $('#main').focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Public view: pages
  // ---------------------------------------------------------------------------
  function renderAllStations(status) {
    return `
      <p class="text-sm text-slate-600">The full menu for every station. Pick a station tab above for details${state.menu.stations.some((s) => s.builder) ? ' and the calorie calculators' : ''}.</p>
      <div class="mt-4 space-y-8">
        ${state.menu.stations
          .map((st) => `
            <article class="rounded-2xl border border-slate-200 bg-white/60 p-4 sm:p-6">
              ${stationHeader(st, status)}
              ${weightBanner(st)}
              ${st.sections.map(sectionCards).join('')}
              ${st.builder
                ? `<button type="button" data-goto-tab="${esc(st.id)}"
                           class="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
                     ${icon('calculator')} Open ${esc(st.builder.title || 'calculator')}
                   </button>`
                : ''}
            </article>`)
          .join('')}
      </div>`;
  }

  function renderStation(station, status) {
    const plainSections = station.builder ? station.sections.filter((s) => !s.builder) : station.sections;
    return `
      <article>
        ${stationHeader(station, status)}
        ${weightBanner(station)}
        ${station.builder && builderSections(station).length ? builderPanel(station) : ''}
        ${plainSections.map(sectionCards).join('')}
      </article>`;
  }

  function renderView() {
    pruneSelections();
    const status = getStatus();
    const station = state.menu.stations.find((s) => s.id === state.activeTab);
    $('#app').innerHTML = station ? renderStation(station, status) : renderAllStations(status);
  }

  function renderChrome() {
    const { settings } = state.menu;
    $('#cafeteria-name').textContent = settings.cafeteria_name || 'Cafeteria';
    document.title = `${settings.cafeteria_name || 'Cafeteria'} Menu`;
    if (settings.nutrition_advisory) {
      $('#nutrition-advisory span').textContent = settings.nutrition_advisory;
    }
    const updated = new Date(state.menu.last_updated);
    $('#last-updated').textContent = Number.isNaN(updated.getTime())
      ? ''
      : `Menu last updated ${updated.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    $('#header-manager-btn').classList.toggle('hidden', !state.unlocked);
    $('#header-manager-btn').classList.toggle('inline-flex', state.unlocked);
  }

  function renderAll() {
    renderChrome();
    renderStatusBanner();
    renderTabs();
    renderView();
    refreshIcons();
  }

  const renderAllSoon = debounce(renderAll, 300);

  // ---------------------------------------------------------------------------
  // Kitchen Manager: GitHub settings + login
  // ---------------------------------------------------------------------------
  function detectRepoFromLocation() {
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return '';
    const owner = m[1];
    const first = location.pathname.split('/').filter(Boolean)[0];
    // Project site: owner.github.io/repo/...  User site: owner.github.io/
    const repo = first && !/\.html?$/i.test(first) ? first : `${owner}.github.io`;
    return `${owner}/${decodeURIComponent(repo)}`;
  }

  function safeStorage(fn) {
    try { return fn(window.localStorage); } catch { return null; }
  }

  function initGitHubSettings() {
    const savedToken = safeStorage((ls) => ls.getItem(STORAGE_KEYS.token)) || '';
    state.gh = {
      repo: safeStorage((ls) => ls.getItem(STORAGE_KEYS.repo)) || detectRepoFromLocation(),
      branch: safeStorage((ls) => ls.getItem(STORAGE_KEYS.branch)) || 'main',
      token: savedToken,
      remember: Boolean(savedToken),
    };
  }

  function persistGitHubSettings() {
    safeStorage((ls) => {
      ls.setItem(STORAGE_KEYS.repo, state.gh.repo);
      ls.setItem(STORAGE_KEYS.branch, state.gh.branch);
      if (state.gh.remember && state.gh.token) ls.setItem(STORAGE_KEYS.token, state.gh.token);
      else ls.removeItem(STORAGE_KEYS.token);
    });
  }

  async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('This browser blocks secure hashing on this page. Open the site over https:// (GitHub Pages) or http://localhost.');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('overflow-hidden');
  }

  function openLogin() {
    const form = $('#login-form');
    form.reset();
    form.repo.value = state.gh.repo;
    form.branch.value = state.gh.branch || 'main';
    form.token.value = state.gh.token;
    form.remember.checked = state.gh.remember;
    $('#login-error').classList.add('hidden');
    openDialog($('#login-dialog'));
    form.passcode.focus();
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const errorEl = $('#login-error');
    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    };
    if (!state.menu) return showError('The menu has not loaded yet. Reload the page and try again.');
    try {
      const hash = await sha256Hex(form.passcode.value);
      if (hash !== state.menu.settings.admin_passcode_sha256) {
        form.passcode.select();
        return showError('Incorrect passcode. Please try again.');
      }
    } catch (err) {
      return showError(err.message);
    }
    state.gh = {
      repo: form.repo.value.trim(),
      branch: form.branch.value.trim() || 'main',
      token: form.token.value.trim(),
      remember: form.remember.checked,
    };
    persistGitHubSettings();
    state.unlocked = true;
    $('#login-dialog').close();
    renderChrome();
    openManager();
  }

  // ---------------------------------------------------------------------------
  // Kitchen Manager: dashboard rendering
  // ---------------------------------------------------------------------------
  const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  const cardCls = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm';

  function managerTabs() {
    return [
      { id: 'settings', name: 'Hours & Settings', icon: 'settings' },
      ...state.menu.stations.map((st) => ({ id: st.id, name: st.name, icon: st.icon || 'utensils' })),
    ];
  }

  function renderManagerTabs() {
    $('#manager-tabs').innerHTML = managerTabs()
      .map((t) => {
        const active = t.id === state.managerTab;
        return `
          <button type="button" role="tab" data-manager-tab="${esc(t.id)}" aria-selected="${active}"
                  class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold
                         ${active ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}">
            ${icon(t.icon)} ${esc(t.name)}
          </button>`;
      })
      .join('');
  }

  function field({ label, scope, fieldName, value, type = 'text', s = '', hint = '', attrs = '' }) {
    const id = `f-${scope}-${s}-${fieldName}`;
    const isArea = type === 'textarea';
    const dataType = type === 'number' ? 'number' : 'text';
    const control = isArea
      ? `<textarea id="${esc(id)}" rows="3" class="${inputCls}" data-scope="${scope}" data-field="${esc(fieldName)}" data-s="${esc(s)}" data-type="text" ${attrs}>${esc(value)}</textarea>`
      : `<input id="${esc(id)}" type="${type}" class="${inputCls}" value="${esc(value ?? '')}" data-scope="${scope}" data-field="${esc(fieldName)}" data-s="${esc(s)}" data-type="${dataType}" ${attrs} />`;
    return `
      <div>
        <label for="${esc(id)}" class="block text-sm font-semibold">${esc(label)}</label>
        ${control}
        ${hint ? `<p class="mt-1 text-xs text-slate-500">${hint}</p>` : ''}
      </div>`;
  }

  function renderSettingsPanel() {
    const { hours, settings } = state.menu;
    const weightStations = state.menu.stations
      .map((st, s) => ({ st, s }))
      .filter(({ st }) => st.pricing_model === 'by_weight');

    return `
      <div class="space-y-4">
        <section class="${cardCls}" aria-labelledby="m-hours">
          <h3 id="m-hours" class="flex items-center gap-2 text-base font-bold">${icon('clock')} Cafeteria Operating Hours</h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            ${field({ label: 'Cafeteria opens', scope: 'hours', fieldName: 'open', value: hours.open, type: 'time' })}
            ${field({ label: 'Main stations close', scope: 'hours', fieldName: 'main_close', value: hours.main_close, type: 'time' })}
            ${field({ label: 'Espresso Bar & Bakery close', scope: 'hours', fieldName: 'espresso_close', value: hours.espresso_close, type: 'time' })}
            ${field({ label: 'Main service label', scope: 'hours', fieldName: 'main_label', value: hours.main_label })}
          </div>
          <div class="mt-3">
            ${field({ label: 'Late afternoon notice', scope: 'hours', fieldName: 'afternoon_notice', value: hours.afternoon_notice, type: 'textarea', hint: 'Updates automatically when you change the times above, unless you have written your own text.' })}
          </div>
        </section>

        ${weightStations
          .map(({ st, s }) => `
            <section class="${cardCls}" aria-labelledby="m-weight-${s}">
              <h3 id="m-weight-${s}" class="flex items-center gap-2 text-base font-bold">${icon('scale')} ${esc(st.name)} Pay-by-Weight</h3>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                ${field({ label: 'Rate per lb ($)', scope: 'station', fieldName: 'price_per_lb', value: st.price_per_lb, type: 'number', s, attrs: 'step="0.01" min="0" inputmode="decimal" placeholder="Leave blank to hide"', hint: 'Leave blank to show only the text below.' })}
                ${field({ label: 'Price display text', scope: 'station', fieldName: 'price_per_lb_display', value: st.price_per_lb_display, s })}
              </div>
            </section>`)
          .join('')}

        <section class="${cardCls}" aria-labelledby="m-general">
          <h3 id="m-general" class="flex items-center gap-2 text-base font-bold">${icon('store')} General</h3>
          <div class="mt-3 grid gap-3">
            ${field({ label: 'Cafeteria name', scope: 'settings', fieldName: 'cafeteria_name', value: settings.cafeteria_name })}
            ${field({ label: 'Nutrition & allergy advisory (footer)', scope: 'settings', fieldName: 'nutrition_advisory', value: settings.nutrition_advisory, type: 'textarea' })}
          </div>
        </section>

        <section class="${cardCls}" aria-labelledby="m-pass">
          <h3 id="m-pass" class="flex items-center gap-2 text-base font-bold">${icon('lock')} Change Admin Passcode</h3>
          <p class="mt-1 text-xs text-slate-500">The new passcode takes effect for everyone after you publish. The passcode only unlocks this editor. Your GitHub token is what actually allows changes to the live site.</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label for="new-pass" class="block text-sm font-semibold">New passcode</label>
              <input id="new-pass" type="password" autocomplete="new-password" class="${inputCls}" /></div>
            <div><label for="new-pass2" class="block text-sm font-semibold">Confirm new passcode</label>
              <input id="new-pass2" type="password" autocomplete="new-password" class="${inputCls}" /></div>
          </div>
          <button type="button" data-action="set-passcode" class="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Set new passcode</button>
        </section>

        <section class="${cardCls}" aria-labelledby="m-gh">
          <h3 id="m-gh" class="flex items-center gap-2 text-base font-bold">${icon('cloud-upload')} GitHub Connection</h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label for="gh-repo" class="block text-sm font-semibold">Repository (owner/repo)</label>
              <input id="gh-repo" data-gh="repo" type="text" spellcheck="false" autocomplete="off" class="${inputCls} font-mono" value="${esc(state.gh.repo)}" /></div>
            <div><label for="gh-branch" class="block text-sm font-semibold">Branch</label>
              <input id="gh-branch" data-gh="branch" type="text" spellcheck="false" autocomplete="off" class="${inputCls} font-mono" value="${esc(state.gh.branch)}" /></div>
            <div class="sm:col-span-2"><label for="gh-token" class="block text-sm font-semibold">Personal Access Token</label>
              <input id="gh-token" data-gh="token" type="password" spellcheck="false" autocomplete="off" placeholder="github_pat_…" class="${inputCls} font-mono" value="${esc(state.gh.token)}" /></div>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-gh="remember" class="h-4 w-4 accent-emerald-700" ${state.gh.remember ? 'checked' : ''} /> Remember token on this device</label>
            <button type="button" data-action="forget-token" class="text-sm font-semibold text-red-700 underline-offset-2 hover:underline">Forget saved token</button>
          </div>
        </section>
      </div>`;
  }

  function stockToggle(item, s, k, i) {
    const inStock = item.available;
    return `
      <button type="button" data-action="toggle" data-s="${s}" data-k="${k}" data-i="${i}"
              aria-label="${esc(item.name || 'Item')}: ${inStock ? 'In Stock' : 'Sold Out'}. Activate to mark ${inStock ? 'Sold Out' : 'In Stock'}."
              class="inline-flex w-28 shrink-0 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-bold
                     ${inStock ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200' : 'bg-red-700 text-white hover:bg-red-800'}">
        ${inStock ? 'In Stock' : 'Sold Out'}
      </button>`;
  }

  function renderManagerRow(s, k, i) {
    const item = state.menu.stations[s].sections[k].items[i];
    const base = `data-scope="item" data-s="${s}" data-k="${k}" data-i="${i}"`;
    const id = `m-${s}-${k}-${i}`;
    return `
      <li id="row-${id}" class="rounded-lg border p-3 ${item.available ? 'border-slate-200 bg-white' : 'border-red-300 bg-red-50'}">
        <div class="flex flex-wrap items-center gap-2">
          ${stockToggle(item, s, k, i)}
          <label for="${id}-name" class="sr-only">Item name</label>
          <input id="${id}-name" type="text" ${base} data-field="name" data-type="text" value="${esc(item.name)}"
                 class="min-w-0 flex-1 basis-44 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" />
          <label class="flex items-center gap-1 text-sm text-slate-600">$
            <input type="number" step="0.01" min="0" inputmode="decimal" ${base} data-field="price" data-type="number"
                   value="${isNum(item.price) ? esc(item.price) : ''}" placeholder="—" aria-label="Price"
                   class="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>
          <label class="flex items-center gap-1 text-sm text-slate-600">Cal
            <input type="number" step="1" min="0" inputmode="numeric" ${base} data-field="calories" data-type="number"
                   value="${isNum(item.calories) ? esc(item.calories) : ''}" placeholder="—" aria-label="Calories"
                   class="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>
        </div>
        <details class="mt-2">
          <summary class="cursor-pointer text-sm font-medium text-slate-600">Description, allergens, tags, delete</summary>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label for="${id}-desc" class="block text-xs font-semibold">Description</label>
              <textarea id="${id}-desc" rows="2" ${base} data-field="description" data-type="text" class="${inputCls}">${esc(item.description)}</textarea>
            </div>
            <div>
              <label for="${id}-all" class="block text-xs font-semibold">Allergen badges (comma separated)</label>
              <input id="${id}-all" type="text" ${base} data-field="allergens" data-type="list" value="${esc(item.allergens.join(', '))}" placeholder="Contains Gluten, Contains Dairy" class="${inputCls}" />
            </div>
            <div>
              <label for="${id}-tags" class="block text-xs font-semibold">Tags (comma separated)</label>
              <input id="${id}-tags" type="text" ${base} data-field="tags" data-type="list" value="${esc(item.tags.join(', '))}" placeholder="Vegetarian, Gluten-Free" class="${inputCls}" />
            </div>
          </div>
          <button type="button" data-action="delete-item" data-s="${s}" data-k="${k}" data-i="${i}"
                  class="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
            ${icon('trash-2')} Delete this item
          </button>
        </details>
      </li>`;
  }

  function renderManagerSection(s, k) {
    const section = state.menu.stations[s].sections[k];
    const inStock = section.items.filter((i) => i.available).length;
    const base = `data-scope="section" data-s="${s}" data-k="${k}" data-type="text"`;
    return `
      <section id="msec-${s}-${k}" class="${cardCls}">
        <div class="grid gap-2 sm:grid-cols-2">
          <div><label for="msec-${s}-${k}-title" class="block text-xs font-semibold">Section title</label>
            <input id="msec-${s}-${k}-title" type="text" ${base} data-field="title" value="${esc(section.title)}" class="${inputCls} font-bold" /></div>
          <div><label for="msec-${s}-${k}-note" class="block text-xs font-semibold">Price note (optional)</label>
            <input id="msec-${s}-${k}-note" type="text" ${base} data-field="price_note" value="${esc(section.price_note)}" class="${inputCls}" /></div>
        </div>
        <p class="mt-2 text-xs text-slate-500">${inStock} of ${section.items.length} in stock${section.builder ? ' · used in the calorie calculator' : ''}</p>
        <ul class="mt-2 space-y-2">
          ${section.items.map((_, i) => renderManagerRow(s, k, i)).join('')}
        </ul>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" data-action="add-item" data-s="${s}" data-k="${k}"
                  class="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
            ${icon('plus')} Add item to ${esc(section.title || 'this section')}
          </button>
          <button type="button" data-action="delete-section" data-s="${s}" data-k="${k}"
                  class="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
            ${icon('trash-2')} Delete section
          </button>
        </div>
      </section>`;
  }

  function renderStationPanel(s) {
    const st = state.menu.stations[s];
    return `
      <div class="space-y-4">
        <section class="${cardCls}">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="flex items-center gap-2 text-base font-bold">${icon(st.icon || 'utensils')} ${esc(st.name)}</h3>
            <div class="flex flex-wrap gap-2">
              <button type="button" data-action="all-in-stock" data-s="${s}" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Mark all In Stock</button>
              <button type="button" data-action="all-sold-out" data-s="${s}" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Mark all Sold Out</button>
            </div>
          </div>
          <div class="mt-3 grid gap-3">
            ${field({ label: 'Tagline', scope: 'station', fieldName: 'tagline', value: st.tagline, s })}
            ${field({ label: 'Station note (shown to students)', scope: 'station', fieldName: 'note', value: st.note, s, type: 'textarea' })}
          </div>
        </section>
        ${st.sections.map((_, k) => renderManagerSection(s, k)).join('')}
        <button type="button" data-action="add-section" data-s="${s}"
                class="inline-flex items-center gap-1 rounded-lg border-2 border-dashed border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
          ${icon('plus')} Add new section (e.g. Daily Specials)
        </button>
      </div>`;
  }

  function renderManagerBody({ keepScroll = false } = {}) {
    const body = $('#manager-body');
    const scroll = body.scrollTop;
    const s = state.menu.stations.findIndex((st) => st.id === state.managerTab);
    if (s === -1) state.managerTab = 'settings';
    body.innerHTML = s === -1 ? renderSettingsPanel() : renderStationPanel(s);
    body.scrollTop = keepScroll ? scroll : 0;
    refreshIcons();
  }

  function openManager() {
    renderManagerTabs();
    renderManagerBody();
    updateDirtyIndicator();
    openDialog($('#manager-dialog'));
    refreshIcons();
  }

  // ---------------------------------------------------------------------------
  // Kitchen Manager: editing
  // ---------------------------------------------------------------------------
  const isDirty = () => serializeMenu(state.menu) !== state.published;

  function updateDirtyIndicator() {
    const el = $('#manager-dirty');
    if (!el) return;
    const dirty = isDirty();
    el.textContent = dirty ? 'Unpublished changes — students will not see them until you publish.' : 'All changes published.';
    el.className = dirty ? 'text-xs font-semibold text-amber-700' : 'text-xs text-slate-500';
  }

  function markChanged() {
    updateDirtyIndicator();
    renderAllSoon();
  }

  function setStatus(message, kind = 'info', html = false) {
    const el = $('#manager-status');
    const styles = {
      info: 'bg-sky-50 text-sky-900',
      success: 'bg-emerald-50 text-emerald-900',
      error: 'bg-red-50 text-red-900',
    };
    el.className = `mb-2 rounded-lg px-3 py-2 text-sm font-medium ${styles[kind] || styles.info}`;
    if (html) el.innerHTML = message;
    else el.textContent = message;
  }

  function readValue(el) {
    const type = el.dataset.type;
    if (type === 'number') {
      const raw = el.value.trim();
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    if (type === 'list') return el.value.split(',').map((v) => v.trim()).filter(Boolean);
    return el.value;
  }

  function onManagerInput(e) {
    const el = e.target;

    if (el.dataset.gh) {
      const key = el.dataset.gh;
      state.gh[key] = key === 'remember' ? el.checked : el.value.trim();
      if (key === 'branch' && !state.gh.branch) state.gh.branch = 'main';
      persistGitHubSettings();
      return;
    }

    const scope = el.dataset.scope;
    if (!scope) return;
    const fieldName = el.dataset.field;
    const value = readValue(el);
    const { menu } = state;

    if (scope === 'item') {
      menu.stations[el.dataset.s].sections[el.dataset.k].items[el.dataset.i][fieldName] = value;
    } else if (scope === 'section') {
      menu.stations[el.dataset.s].sections[el.dataset.k][fieldName] = value;
    } else if (scope === 'station') {
      menu.stations[el.dataset.s][fieldName] = value;
    } else if (scope === 'settings') {
      menu.settings[fieldName] = value;
    } else if (scope === 'hours') {
      const before = defaultAfternoonNotice(menu.hours);
      menu.hours[fieldName] = value;
      if (['main_close', 'espresso_close'].includes(fieldName) && menu.hours.afternoon_notice === before) {
        // Keep the auto-generated notice in sync with the times.
        menu.hours.afternoon_notice = defaultAfternoonNotice(menu.hours);
        const notice = $('[data-scope="hours"][data-field="afternoon_notice"]');
        if (notice) notice.value = menu.hours.afternoon_notice;
      }
    }
    markChanged();
  }

  function replaceSection(s, k, focusSelector) {
    const el = $(`#msec-${s}-${k}`);
    if (!el) return renderManagerBody({ keepScroll: true });
    el.outerHTML = renderManagerSection(s, k);
    refreshIcons();
    if (focusSelector) $(focusSelector)?.focus();
  }

  async function onManagerClick(e) {
    const tabBtn = e.target.closest('[data-manager-tab]');
    if (tabBtn) {
      state.managerTab = tabBtn.dataset.managerTab;
      renderManagerTabs();
      renderManagerBody();
      $(`[data-manager-tab="${CSS.escape(state.managerTab)}"]`)?.focus();
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const s = Number(btn.dataset.s);
    const k = Number(btn.dataset.k);
    const i = Number(btn.dataset.i);
    const station = state.menu.stations[s];

    switch (btn.dataset.action) {
      case 'toggle': {
        const item = station.sections[k].items[i];
        item.available = !item.available;
        replaceSection(s, k, `[data-action="toggle"][data-s="${s}"][data-k="${k}"][data-i="${i}"]`);
        markChanged();
        break;
      }
      case 'add-item': {
        const items = station.sections[k].items;
        items.push(normalizeItem({ id: uid('item'), name: 'New item', available: true }));
        replaceSection(s, k, `#m-${s}-${k}-${items.length - 1}-name`);
        $(`#m-${s}-${k}-${items.length - 1}-name`)?.select();
        markChanged();
        break;
      }
      case 'delete-item': {
        const item = station.sections[k].items[i];
        if (!window.confirm(`Delete "${item.name || 'this item'}"? This cannot be undone after you publish.`)) return;
        station.sections[k].items.splice(i, 1);
        replaceSection(s, k, `[data-action="add-item"][data-s="${s}"][data-k="${k}"]`);
        markChanged();
        break;
      }
      case 'add-section': {
        station.sections.push({ id: uid('section'), title: 'Daily Specials', price_note: '', builder: null, items: [] });
        renderManagerBody({ keepScroll: true });
        const input = $(`#msec-${s}-${station.sections.length - 1}-title`);
        input?.focus();
        input?.select();
        markChanged();
        break;
      }
      case 'delete-section': {
        const sec = station.sections[k];
        if (!window.confirm(`Delete the whole "${sec.title || 'untitled'}" section and its ${sec.items.length} item(s)?`)) return;
        station.sections.splice(k, 1);
        renderManagerBody({ keepScroll: true });
        markChanged();
        break;
      }
      case 'all-in-stock':
      case 'all-sold-out': {
        const available = btn.dataset.action === 'all-in-stock';
        station.sections.forEach((sec) => sec.items.forEach((it) => { it.available = available; }));
        renderManagerBody({ keepScroll: true });
        $(`[data-action="${btn.dataset.action}"][data-s="${s}"]`)?.focus();
        markChanged();
        break;
      }
      case 'set-passcode': {
        const p1 = $('#new-pass').value;
        const p2 = $('#new-pass2').value;
        if (p1.length < 6) return setStatus('The new passcode must be at least 6 characters.', 'error');
        if (p1 !== p2) return setStatus('The two passcodes do not match.', 'error');
        try {
          state.menu.settings.admin_passcode_sha256 = await sha256Hex(p1);
        } catch (err) {
          return setStatus(err.message, 'error');
        }
        $('#new-pass').value = '';
        $('#new-pass2').value = '';
        setStatus('New passcode set. Publish to make it permanent.', 'success');
        markChanged();
        break;
      }
      case 'forget-token': {
        state.gh.token = '';
        state.gh.remember = false;
        persistGitHubSettings();
        renderManagerBody({ keepScroll: true });
        setStatus('Saved token removed from this device.', 'success');
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Kitchen Manager: validation, download, publish
  // ---------------------------------------------------------------------------
  function validateMenu(menu) {
    const errors = [];
    const h = menu.hours;
    const open = toMinutes(h.open);
    const mainClose = toMinutes(h.main_close);
    const espressoClose = toMinutes(h.espresso_close);
    if ([open, mainClose, espressoClose].some(Number.isNaN)) {
      errors.push('All three operating-hour times are required.');
    } else if (!(open < mainClose && mainClose <= espressoClose)) {
      errors.push('Hours must be in order: opening time, then main stations close, then Espresso Bar close.');
    }
    menu.stations.forEach((st) => {
      if (st.price_per_lb != null && !(st.price_per_lb >= 0)) errors.push(`${st.name}: rate per lb must be 0 or more.`);
      st.sections.forEach((sec) => {
        if (!sec.title.trim()) errors.push(`${st.name}: every section needs a title.`);
        sec.items.forEach((it) => {
          const where = `${st.name} → ${sec.title || 'section'}`;
          if (!it.name.trim()) errors.push(`${where}: an item is missing its name.`);
          if (it.price != null && !(it.price >= 0)) errors.push(`${where} → ${it.name}: price must be 0 or more.`);
          if (it.calories != null && !(it.calories >= 0)) errors.push(`${where} → ${it.name}: calories must be 0 or more.`);
        });
      });
    });
    return errors;
  }

  function buildOutput() {
    const out = JSON.parse(JSON.stringify(state.menu));
    out.last_updated = new Date().toISOString();
    out.stations.forEach((st) => {
      if (isNum(st.price_per_lb)) st.price_per_lb = Math.round(st.price_per_lb * 100) / 100;
      st.sections.forEach((sec) =>
        sec.items.forEach((it) => {
          it.name = it.name.trim();
          if (isNum(it.price)) it.price = Math.round(it.price * 100) / 100;
          if (isNum(it.calories)) it.calories = Math.round(it.calories);
        }),
      );
    });
    return out;
  }

  function checkValid() {
    const errors = validateMenu(state.menu);
    if (errors.length) {
      setStatus(
        `<strong>Please fix before saving:</strong><ul class="mt-1 list-disc pl-5">${errors.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`,
        'error',
        true,
      );
      return false;
    }
    return true;
  }

  function onDownload() {
    if (!checkValid()) return;
    const out = buildOutput();
    const blob = new Blob([serializeMenu(out)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'menu.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('menu.json downloaded. Upload it to the repository to publish manually, or keep it as a backup.', 'success');
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function githubError(res) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    const messages = {
      401: 'GitHub rejected the token (401). Check that it was copied correctly and has not expired.',
      403: 'The token is not allowed to change this repository (403). It needs "Contents: Read and write" access to this repository.',
      404: 'Repository, branch, or file not found (404). Check owner/repo and branch, and that the token was granted access to this repository.',
      409: 'menu.json changed on GitHub while you were saving (409). Press Publish again.',
      422: 'GitHub could not apply the update (422). Check that the branch name is correct.',
    };
    const base = messages[res.status] || `GitHub returned an error (${res.status}).`;
    return new Error(detail ? `${base} GitHub says: "${detail}"` : base);
  }

  async function onPublish() {
    if (!checkValid()) return;
    const { repo, branch, token } = state.gh;
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo || '')) {
      state.managerTab = 'settings';
      renderManagerTabs();
      renderManagerBody();
      $('#gh-repo')?.focus();
      return setStatus('Enter the repository as owner/repo in GitHub Connection.', 'error');
    }
    if (!token) {
      state.managerTab = 'settings';
      renderManagerTabs();
      renderManagerBody();
      $('#gh-token')?.focus();
      return setStatus('Enter your GitHub Personal Access Token in GitHub Connection to publish.', 'error');
    }

    const [owner, name] = repo.split('/');
    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${MENU_PATH}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const publishBtn = $('#publish-btn');
    publishBtn.disabled = true;
    setStatus('Publishing to GitHub…', 'info');

    try {
      // 1) Get the current file sha (needed to update an existing file).
      let sha;
      const getRes = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
      if (getRes.ok) sha = (await getRes.json()).sha;
      else if (getRes.status !== 404) throw await githubError(getRes);

      // 2) Commit the new menu.json.
      const out = buildOutput();
      const body = {
        message: `Update cafeteria menu (${new Date().toLocaleString()})`,
        content: utf8ToBase64(serializeMenu(out)),
        branch,
      };
      if (sha) body.sha = sha;
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!putRes.ok) throw await githubError(putRes);
      const result = await putRes.json();

      state.menu = normalizeMenu(out);
      state.published = serializeMenu(state.menu);
      updateDirtyIndicator();
      renderManagerBody({ keepScroll: true });
      renderAll();
      const commitUrl = result.commit && result.commit.html_url;
      setStatus(
        `Published! Students will see the update after GitHub Pages refreshes (usually 1–2 minutes).${commitUrl ? ` <a class="underline" href="${esc(commitUrl)}" target="_blank" rel="noopener">View commit</a>` : ''}`,
        'success',
        true,
      );
    } catch (err) {
      const msg = err instanceof TypeError
        ? 'Could not reach GitHub. Check your internet connection and try again.'
        : err.message;
      setStatus(msg, 'error');
    } finally {
      publishBtn.disabled = false;
    }
  }

  function onDiscard() {
    if (!isDirty()) return setStatus('There are no unpublished changes.', 'info');
    if (!window.confirm('Discard all unpublished changes?')) return;
    state.menu = normalizeMenu(JSON.parse(state.published));
    renderManagerTabs();
    renderManagerBody({ keepScroll: true });
    updateDirtyIndicator();
    renderAll();
    setStatus('Changes discarded.', 'success');
  }

  function onLogout() {
    if (isDirty() && !window.confirm('You have unpublished changes. Log out and discard them?')) return;
    if (isDirty()) state.menu = normalizeMenu(JSON.parse(state.published));
    state.unlocked = false;
    if (!state.gh.remember) state.gh.token = '';
    $('#manager-dialog').close();
    $('#manager-status').classList.add('hidden');
    renderAll();
    $('#manager-login-btn').focus();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function bindEvents() {
    $('#station-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) activateTab(btn.dataset.tab);
    });
    $('#station-tabs').addEventListener('keydown', onTabKeydown);
    $('#app').addEventListener('change', onBuilderChange);
    $('#app').addEventListener('click', onAppClick);

    const openManagerOrLogin = () => (state.unlocked ? openManager() : openLogin());
    $('#manager-login-btn').addEventListener('click', openManagerOrLogin);
    $('#header-manager-btn').addEventListener('click', openManagerOrLogin);
    $('#login-form').addEventListener('submit', onLoginSubmit);

    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('close', () => {
        if (!$$('dialog').some((d) => d.open)) document.body.classList.remove('overflow-hidden');
      });
      dialog.addEventListener('click', (e) => {
        if (e.target.closest('[data-close-dialog]')) dialog.close();
      });
    });

    $('#manager-body').addEventListener('input', onManagerInput);
    $('#manager-body').addEventListener('change', onManagerInput);
    $('#manager-body').addEventListener('click', onManagerClick);
    $('#manager-tabs').addEventListener('click', onManagerClick);
    $('#publish-btn').addEventListener('click', onPublish);
    $('#download-btn').addEventListener('click', onDownload);
    $('#discard-btn').addEventListener('click', onDiscard);
    $('#logout-btn').addEventListener('click', onLogout);

    window.addEventListener('beforeunload', (e) => {
      if (state.unlocked && state.menu && isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function init() {
    bindEvents();
    initGitHubSettings();
    refreshIcons();
    try {
      state.menu = await loadMenu();
      state.published = serializeMenu(state.menu);
    } catch (err) {
      showLoadError(err);
      return;
    }
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash && state.menu.stations.some((s) => s.id === fromHash)) state.activeTab = fromHash;
    renderAll();
    setInterval(tick, 30 * 1000);
  }

  init();
})();
