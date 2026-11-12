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

  // Station color themes. Each palette lists Tailwind shades 50…950 as "R G B"
  // plus the header background / text / muted-text colors.
  const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const THEMES = {
    green: {
      label: 'Green',
      brand: ['236 253 245', '209 250 229', '167 243 208', '110 231 183', '52 211 153', '16 185 129', '5 150 105', '4 120 87', '6 95 70', '6 78 59', '2 44 34'],
      header: ['6 78 59', '255 255 255', '167 243 208'],
      meta: '#065f46',
    },
    blue: {
      label: 'Blue',
      brand: ['239 246 255', '219 234 254', '191 219 254', '147 197 253', '96 165 250', '59 130 246', '37 99 235', '29 78 216', '30 64 175', '30 58 138', '23 37 84'],
      header: ['30 64 175', '255 255 255', '191 219 254'],
      meta: '#1e40af',
    },
    yellow: {
      label: 'Yellow',
      brand: ['254 252 232', '254 249 195', '254 240 138', '253 224 71', '250 204 21', '234 179 8', '202 138 4', '161 98 7', '133 77 14', '113 63 18', '66 32 6'],
      // Bright yellow header with dark text keeps contrast readable.
      header: ['250 204 21', '66 32 6', '113 63 18'],
      meta: '#facc15',
    },
    red: {
      label: 'Red',
      brand: ['254 242 242', '254 226 226', '254 202 202', '252 165 165', '248 113 113', '239 68 68', '220 38 38', '185 28 28', '153 27 27', '127 29 29', '69 10 10'],
      header: ['185 28 28', '255 255 255', '254 202 202'],
      meta: '#b91c1c',
    },
    pink: {
      label: 'Pink',
      brand: ['253 242 248', '252 231 243', '251 207 232', '249 168 212', '244 114 182', '236 72 153', '219 39 119', '190 24 93', '157 23 77', '131 24 67', '80 7 36'],
      header: ['219 39 119', '255 255 255', '253 242 248'],
      meta: '#db2777',
    },
    teal: {
      label: 'Teal',
      brand: ['240 253 250', '204 251 241', '153 246 228', '94 234 212', '45 212 191', '20 184 166', '13 148 136', '15 118 110', '17 94 89', '19 78 74', '4 47 46'],
      header: ['15 118 110', '255 255 255', '153 246 228'],
      meta: '#0f766e',
    },
  };
  const DEFAULT_THEME = 'green';

  function applyTheme(name) {
    const theme = THEMES[name] || THEMES[DEFAULT_THEME];
    const root = document.documentElement.style;
    SHADES.forEach((n, i) => root.setProperty(`--brand-${n}`, theme.brand[i]));
    root.setProperty('--header-bg', theme.header[0]);
    root.setProperty('--header-fg', theme.header[1]);
    root.setProperty('--header-muted', theme.header[2]);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.meta);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    menu: null,          // working copy rendered on the page (edited by the manager)
    published: '',       // JSON string of the last loaded / published menu
    activeTab: 'all',
    selections: {},      // stationId -> array of selected item ids (calculators)
    cart: {},            // "stationId::itemId" -> quantity (estimated cart)
    cartOpen: false,
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

  // ---------------------------------------------------------------------------
  // Menu loading + normalisation
  // ---------------------------------------------------------------------------
  function normalizeItem(item) {
    return {
      id: String(item.id || uid('item')),
      name: String(item.name ?? ''),
      // Optional text shown in brackets after the name, e.g. this week's pizza flavor.
      ...(item.bracket ? { bracket: String(item.bracket) } : {}),
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
      {
        cafeteria_name: 'Cafeteria',
        admin_passcode_sha256: '',
        nutrition_advisory: '',
        sales_tax_percent: 6.25,
        sales_tax_label: 'MA sales tax',
      },
      menu.settings,
    );
    if (!isNum(menu.settings.sales_tax_percent)) menu.settings.sales_tax_percent = 0;

    // Older menu.json files used one combined "open → main_close" window.
    const hours = menu.hours && typeof menu.hours === 'object' ? menu.hours : {};
    if (!hours.breakfast_start && hours.open) {
      hours.breakfast_start = hours.open;
      hours.espresso_open = hours.open;
      hours.lunch_end = hours.main_close;
    }
    delete hours.open;
    delete hours.main_close;
    delete hours.main_label;
    delete hours.afternoon_notice; // The late-afternoon callout was removed.
    menu.hours = Object.assign(
      {
        breakfast_start: '08:00',
        breakfast_end: '11:30',
        lunch_start: '11:30',
        lunch_end: '15:00',
        espresso_open: '14:00',
        espresso_close: '18:00',
      },
      hours,
    );
    menu.stations = (Array.isArray(menu.stations) ? menu.stations : []).map((st) => ({
      ...st,
      id: String(st.id || uid('station')),
      name: String(st.name ?? ''),
      tagline: String(st.tagline ?? ''),
      note: String(st.note ?? ''),
      // main = breakfast through lunch, lunch = lunch only, espresso = Espresso Bar hours.
      hours_group: ['espresso', 'lunch'].includes(st.hours_group) ? st.hours_group : 'main',
      theme: THEMES[st.theme] ? st.theme : DEFAULT_THEME,
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
    menu.announcements = (Array.isArray(menu.announcements) ? menu.announcements : []).map(normalizeAnnouncement);
    return menu;
  }

  function normalizeAnnouncement(a) {
    const lines = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
    return {
      id: String(a.id || uid('announcement')),
      visible: a.visible !== false,
      title: String(a.title ?? ''),
      subtitle: String(a.subtitle ?? ''),
      items_title: String(a.items_title ?? ''),
      items: lines(a.items),
      highlights: lines(a.highlights),
      closing: String(a.closing ?? ''),
    };
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
  const nowMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes();
  const inWindow = (minutes, start, end) => minutes >= toMinutes(start) && minutes < toMinutes(end);

  // Main stations run from the start of breakfast to the end of lunch.
  const mainServing = (m = nowMinutes()) => inWindow(m, state.menu.hours.breakfast_start, state.menu.hours.lunch_end);
  const espressoServing = (m = nowMinutes()) => inWindow(m, state.menu.hours.espresso_open, state.menu.hours.espresso_close);

  function getStatus(now = new Date()) {
    const m = nowMinutes(now);
    if (mainServing(m)) return 'open';
    if (m >= toMinutes(state.menu.hours.lunch_end) && espressoServing(m)) return 'afternoon';
    return 'closed';
  }

  function currentMeal(m = nowMinutes()) {
    const h = state.menu.hours;
    if (inWindow(m, h.breakfast_start, h.breakfast_end)) return 'breakfast';
    if (inWindow(m, h.lunch_start, h.lunch_end)) return 'lunch';
    return null;
  }

  function isStationServing(station) {
    if (station.hours_group === 'espresso') return espressoServing();
    if (station.hours_group === 'lunch') return inWindow(nowMinutes(), state.menu.hours.lunch_start, state.menu.hours.lunch_end);
    return mainServing();
  }

  // Changes whenever anything time-dependent on the page should re-render.
  const timeKey = () => `${getStatus()}|${currentMeal()}|${espressoServing()}`;

  function scheduleCard(label, start, end, isNow) {
    return `
      <div class="rounded-xl p-3 ${isNow ? 'bg-header-fg/20 ring-2 ring-header-fg/60' : 'bg-header-fg/10'}">
        <dt class="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-header-muted">
          ${label}
          ${isNow ? '<span class="rounded-full bg-header-fg px-2 py-0.5 text-[0.65rem] font-bold text-header">Now</span>' : ''}
        </dt>
        <dd class="mt-0.5 font-semibold">${fmtTime(start)} – ${fmtTime(end)}</dd>
      </div>`;
  }

  function renderStatusBanner() {
    const h = state.menu.hours;
    const status = getStatus();
    const s = STATUS[status];
    const meal = currentMeal();
    state.lastStatus = timeKey();
    $('#status-banner').innerHTML = `
      <h2 id="hours-heading" class="sr-only">Operating hours and live status</h2>
      <div class="flex flex-wrap items-center gap-3">
        <span id="status-badge" role="status"
              class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow ${s.classes}">
          ${icon(s.icon)} ${esc(s.label)}
        </span>
        <span id="status-time" class="text-sm text-header-muted"></span>
      </div>
      <dl class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        ${scheduleCard('Breakfast', h.breakfast_start, h.breakfast_end, meal === 'breakfast')}
        ${scheduleCard('Lunch', h.lunch_start, h.lunch_end, meal === 'lunch')}
        ${scheduleCard('Espresso Bar &amp; Bakery', h.espresso_open, h.espresso_close, espressoServing())}
      </dl>`;
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
    if (timeKey() !== state.lastStatus) {
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
                         ${active ? 'bg-brand-800 text-white shadow' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}">
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

  const itemName = (item) =>
    `${esc(item.name)}${item.bracket ? ` <span class="font-medium text-slate-600">(${esc(item.bracket)})</span>` : ''}`;

  function itemCard(item, station, section) {
    const sold = !item.available;
    // Priced items outside the calculators can be added to the estimated cart.
    const key = cartKey(station, item);
    const addable = !sold && isNum(item.price) && !section.builder;
    return `
      <li class="relative flex flex-col rounded-xl border p-4 shadow-sm ${sold ? 'border-slate-300 bg-slate-100' : 'border-slate-200 bg-white'}">
        <div class="flex-1 ${sold ? 'opacity-50 grayscale' : ''}">
          <div class="flex items-start justify-between gap-3">
            <h4 class="font-semibold leading-snug ${sold ? 'line-through decoration-2' : ''}">${itemName(item)}</h4>
            ${isNum(item.price) ? `<span class="whitespace-nowrap font-bold text-brand-900">${fmtPrice(item.price)}</span>` : ''}
          </div>
          ${item.description ? `<p class="mt-1 text-sm text-slate-600">${esc(item.description)}</p>` : ''}
          ${itemChips(item)}
        </div>
        ${addable ? `<div class="mt-3 flex justify-end" data-cart-ctl="${esc(key)}">${cartControl(key, item)}</div>` : ''}
        ${sold ? soldOutBadge() : ''}
      </li>`;
  }

  function sectionCards(section, station) {
    const headingId = `sec-${section.id}`;
    return `
      <section aria-labelledby="${esc(headingId)}" class="mt-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
          <h3 id="${esc(headingId)}" class="text-lg font-bold">${esc(section.title)}</h3>
          ${section.price_note ? `<p class="text-sm font-semibold text-brand-800">${esc(section.price_note)}</p>` : ''}
        </div>
        ${section.items.length
          ? `<ul class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${section.items.map((item) => itemCard(item, station, section)).join('')}</ul>`
          : '<p class="mt-3 text-sm text-slate-500">No items listed right now.</p>'}
      </section>`;
  }

  function stationHeader(station, status) {
    const serving = isStationServing(station, status);
    return `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-2xl text-brand-800">${icon(station.icon || 'utensils')}</span>
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
    const rate = isNum(station.price_per_lb) ? `<p class="text-base font-bold text-brand-900">Current rate: ${fmtPrice(station.price_per_lb)} per lb</p>` : '';
    return `
      <div class="mt-4 flex gap-3 rounded-xl border-2 border-brand-700 bg-brand-50 p-4">
        <span class="text-2xl text-brand-800">${icon('scale')}</span>
        <div>
          <p class="text-lg font-extrabold text-brand-950">Priced by Weight — Pay per lb at the register</p>
          ${rate}
          ${station.price_per_lb_display ? `<p class="text-sm font-medium text-brand-900">${esc(station.price_per_lb_display)}</p>` : ''}
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
                        : 'cursor-pointer border-slate-200 bg-white hover:border-brand-500 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-700'}">
          <input id="${esc(inputId)}" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
                 data-builder="${esc(station.id)}" data-item="${esc(item.id)}" data-group="${esc(group)}"
                 ${checked && !sold ? 'checked' : ''} ${sold ? 'disabled' : ''} />
          <span class="min-w-0 flex-1">
            <span class="flex items-start justify-between gap-2">
              <span class="font-semibold leading-snug">${itemName(item)}${sold ? '<span class="sr-only"> (sold out)</span>' : ''}</span>
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
    const missingCalories = picked.some((i) => !isNum(i.calories));
    const noCaloriesKnown = picked.length > 0 && picked.every((i) => !isNum(i.calories));
    const calorieText = noCaloriesKnown ? 'Not listed*' : `${calories} Cal${missingCalories ? '*' : ''}`;
    const label = (text) => `<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${text}</p>`;

    let priceBlock;
    if (station.pricing_model === 'by_weight') {
      const rate = isNum(station.price_per_lb) ? `${fmtPrice(station.price_per_lb)}/lb` : 'Weighed';
      priceBlock = `
        ${label('Est. price')}
        <p class="text-2xl font-extrabold text-slate-900">By weight</p>
        <p class="text-xs text-slate-600">${esc(rate)} at the register${taxRate() > 0 ? ` + ${esc(taxText())}` : ''}</p>`;
    } else {
      const { subtotal, tax, total } = cartPrice(picked);
      priceBlock = `
        ${label('Est. price')}
        <p class="text-2xl font-extrabold text-slate-900">${fmtPrice(total)}</p>
        <p class="text-xs text-slate-600">${taxRate() > 0
          ? `${fmtPrice(subtotal)} + ${fmtPrice(tax)} ${esc(taxText())}`
          : 'No sales tax added'}</p>`;
    }

    return `
      <div class="grid grid-cols-2 gap-4" aria-live="polite" aria-atomic="true">
        <div>
          ${label('Calories')}
          <p class="text-2xl font-extrabold text-brand-900">${calorieText}</p>
        </div>
        <div class="border-l border-slate-200 pl-4">${priceBlock}</div>
      </div>
      <div class="mt-2 flex items-start justify-between gap-3">
        <p class="min-w-0 text-sm text-slate-600">${picked.length ? esc(picked.map((i) => i.name).join(', ')) : 'Nothing selected yet.'}</p>
        <button type="button" data-reset-builder="${esc(station.id)}"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">
          ${icon('rotate-ccw')} Reset
        </button>
      </div>
      ${missingCalories ? '<p class="mt-1 text-xs text-slate-500">* Some selected items do not list calories. Ask staff for full nutrition details.</p>' : ''}
      <p class="mt-1 text-xs text-slate-500">Estimate only. Your selections are also added to the estimated cart at the bottom of the screen.</p>`;
  }

  // ---- Sales tax (rate is editable in the Kitchen Manager dashboard) ----
  const taxRate = () => (isNum(state.menu.settings.sales_tax_percent) ? state.menu.settings.sales_tax_percent : 0);
  const taxText = () => `${state.menu.settings.sales_tax_label || 'sales tax'} (${taxRate()}%)`;

  // Work in whole cents to avoid floating-point rounding errors.
  const priceCents = (item) => (isNum(item.price) ? Math.round(item.price * 100) : 0);

  function totalsFromCents(subtotalCents) {
    const taxCents = Math.round((subtotalCents * taxRate()) / 100);
    return { subtotal: subtotalCents / 100, tax: taxCents / 100, total: (subtotalCents + taxCents) / 100 };
  }

  const cartPrice = (items) => totalsFromCents(items.reduce((sum, i) => sum + priceCents(i), 0));

  // ---------------------------------------------------------------------------
  // Public view: estimated cart (bottom of the screen)
  //
  // The cart is a price estimate only. It holds items added with "+ Add" on
  // menu cards, plus whatever is checked in the Deli / Grill calculators.
  // ---------------------------------------------------------------------------
  const MAX_QTY = 20;
  const cartKey = (station, item) => `${station.id}::${item.id}`;

  function findCartItem(key) {
    const [stationId, itemId] = key.split('::');
    const station = state.menu.stations.find((s) => s.id === stationId);
    if (!station) return null;
    for (const sec of station.sections) {
      if (sec.builder) continue;
      const item = sec.items.find((i) => i.id === itemId);
      if (item && item.available && isNum(item.price)) return { station, item };
    }
    return null;
  }

  function pruneCart() {
    // Drop items that were deleted, repriced to blank, or marked Sold Out.
    Object.keys(state.cart).forEach((key) => {
      if (!findCartItem(key)) delete state.cart[key];
    });
  }

  function cartControl(key, item) {
    const qty = state.cart[key] || 0;
    const name = esc(item.name);
    const btn = 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-bold text-brand-900 hover:bg-brand-100';
    if (!qty) {
      return `<button type="button" data-cart-add="${esc(key)}" aria-label="Add ${name} to estimated cart"
                      class="${btn} gap-1 border border-brand-700 bg-white">${icon('plus')} Add</button>`;
    }
    return `
      <div class="inline-flex items-center rounded-lg border border-brand-700 bg-brand-50">
        <button type="button" data-cart-dec="${esc(key)}" aria-label="Remove one ${name}" class="${btn}">${icon('minus')}</button>
        <span class="min-w-[2rem] text-center text-sm font-bold" aria-label="${qty} ${name} in cart">${qty}</span>
        <button type="button" data-cart-inc="${esc(key)}" aria-label="Add one more ${name}" class="${btn}" ${qty >= MAX_QTY ? 'disabled' : ''}>${icon('plus')}</button>
      </div>`;
  }

  function cartLines() {
    const lines = [];
    Object.entries(state.cart).forEach(([key, qty]) => {
      const found = findCartItem(key);
      if (found) lines.push({ type: 'item', key, qty, ...found, cents: priceCents(found.item) * qty });
    });
    state.menu.stations.forEach((station) => {
      if (!station.builder) return;
      const picked = getSelectedItems(station);
      if (!picked.length) return;
      const byWeight = station.pricing_model === 'by_weight';
      lines.push({
        type: 'plate', station, picked, byWeight,
        cents: byWeight ? 0 : picked.reduce((sum, i) => sum + priceCents(i), 0),
      });
    });
    return lines;
  }

  function cartSummary() {
    const lines = cartLines();
    const count = lines.reduce((n, l) => n + (l.type === 'item' ? l.qty : 1), 0);
    const totals = totalsFromCents(lines.reduce((sum, l) => sum + l.cents, 0));
    return { lines, count, ...totals, hasWeight: lines.some((l) => l.byWeight) };
  }

  function cartLineHtml(line) {
    if (line.type === 'item') {
      return `
        <li class="flex items-center gap-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-snug">${itemName(line.item)}</p>
            <p class="text-xs text-slate-500">${esc(line.station.name)} · ${fmtPrice(line.item.price)} each</p>
          </div>
          ${cartControl(line.key, line.item)}
          <span class="w-20 shrink-0 text-right text-sm font-semibold">${fmtPrice(line.cents / 100)}</span>
        </li>`;
    }
    return `
      <li class="flex items-center gap-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-snug">${esc(line.station.name)} ${esc(line.station.builder.cart_label || (line.byWeight ? 'sandwich' : 'plate'))}</p>
          <p class="text-xs text-slate-500">${esc(line.picked.map((i) => i.name).join(', '))}</p>
        </div>
        <button type="button" data-plate-remove="${esc(line.station.id)}" aria-label="Remove ${esc(line.station.name)} selections"
                class="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Remove</button>
        <span class="w-20 shrink-0 text-right text-sm font-semibold">${line.byWeight ? 'By weight' : fmtPrice(line.cents / 100)}</span>
      </li>`;
  }

  function renderCartBar() {
    const bar = $('#cart-bar');
    if (!bar || !state.menu) return;
    const { lines, count, subtotal, tax, total, hasWeight } = cartSummary();
    const taxed = taxRate() > 0;
    const weighed = lines.filter((l) => l.byWeight).map((l) => l.station.name);
    const hint = count
      ? `${taxed ? `incl. ${fmtPrice(tax)} ${esc(taxText())}` : 'No sales tax added'}${hasWeight ? ' · weighed items not included' : ''}`
      : 'Tap + Add on any item to estimate your total';

    const panel = `
      <div id="cart-panel" class="max-h-[55vh] overflow-y-auto border-b border-slate-200 px-4 pb-3 pt-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-bold">Estimated cart</h2>
          ${count ? '<button type="button" data-cart-clear class="rounded-lg px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50">Clear cart</button>' : ''}
        </div>
        ${lines.length
          ? `<ul class="mt-1 divide-y divide-slate-100">${lines.map(cartLineHtml).join('')}</ul>`
          : '<p class="mt-2 text-sm text-slate-600">Your cart is empty. Tap <strong>+ Add</strong> on a menu item, or check items in a station calculator.</p>'}
        <dl class="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div class="flex justify-between"><dt>Subtotal</dt><dd>${fmtPrice(subtotal)}</dd></div>
          ${taxed ? `<div class="flex justify-between"><dt>${esc(taxText())}</dt><dd>${fmtPrice(tax)}</dd></div>` : ''}
          <div class="flex justify-between text-base font-extrabold text-brand-900"><dt>Estimated total</dt><dd>${fmtPrice(total)}</dd></div>
        </dl>
        <p class="mt-2 text-xs text-slate-500">Estimate only. This is not an order; pay at the register, where prices and tax are final.${hasWeight ? ` ${esc(weighed.join(' and '))} ${weighed.length > 1 ? 'are' : 'is'} priced by weight and not included in the total.` : ''}</p>
      </div>`;

    bar.innerHTML = `
      <div class="mx-auto max-w-6xl px-2 pb-2 sm:px-6">
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_-6px_24px_rgba(0,0,0,0.12)]">
          ${state.cartOpen ? panel : ''}
          <button type="button" data-cart-toggle aria-expanded="${state.cartOpen}" aria-controls="cart-panel"
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
            <span class="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-800 text-lg text-white">
              ${icon('shopping-cart')}
              ${count ? `<span class="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-amber-400 px-1 text-xs font-bold text-amber-950">${count}</span>` : ''}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated cart · ${count} ${count === 1 ? 'item' : 'items'}</span>
              <span class="block truncate text-xs text-slate-600">${hint}</span>
            </span>
            <span class="text-xl font-extrabold text-brand-900">${fmtPrice(total)}</span>
            <span class="text-slate-500">${icon(state.cartOpen ? 'chevron-down' : 'chevron-up')}</span>
            <span class="sr-only">${state.cartOpen ? 'Hide' : 'Show'} cart details</span>
          </button>
        </div>
      </div>`;
    refreshIcons();
  }

  function announceCart() {
    const { count, total } = cartSummary();
    $('#cart-live').textContent = `Estimated cart: ${count} ${count === 1 ? 'item' : 'items'}, ${fmtPrice(total)} with tax.`;
  }

  function setCartQty(key, qty) {
    if (qty <= 0) delete state.cart[key];
    else state.cart[key] = Math.min(qty, MAX_QTY);
    const found = findCartItem(key);
    $$(`[data-cart-ctl="${CSS.escape(key)}"]`).forEach((el) => {
      el.innerHTML = found ? cartControl(key, found.item) : '';
    });
    renderCartBar();
    announceCart();
  }

  // Handles cart buttons in the menu and in the cart bar. Returns true if handled.
  function onCartClick(e) {
    const el = e.target.closest('[data-cart-add],[data-cart-inc],[data-cart-dec],[data-cart-toggle],[data-cart-clear],[data-plate-remove]');
    if (!el) return false;
    const inBar = Boolean(el.closest('#cart-bar'));
    const scope = inBar ? $('#cart-bar') : $('#app');
    const d = el.dataset;
    let focusSel = null;

    if (d.cartAdd) {
      setCartQty(d.cartAdd, 1);
      focusSel = `[data-cart-inc="${CSS.escape(d.cartAdd)}"]`;
    } else if (d.cartInc) {
      setCartQty(d.cartInc, (state.cart[d.cartInc] || 0) + 1);
      focusSel = `[data-cart-inc="${CSS.escape(d.cartInc)}"]`;
    } else if (d.cartDec) {
      const next = (state.cart[d.cartDec] || 0) - 1;
      setCartQty(d.cartDec, next);
      focusSel = next > 0 ? `[data-cart-dec="${CSS.escape(d.cartDec)}"]` : (inBar ? '[data-cart-toggle]' : `[data-cart-add="${CSS.escape(d.cartDec)}"]`);
    } else if ('cartToggle' in d) {
      state.cartOpen = !state.cartOpen;
      renderCartBar();
      focusSel = '[data-cart-toggle]';
    } else if ('cartClear' in d) {
      state.cart = {};
      Object.keys(state.selections).forEach((sid) => { state.selections[sid] = []; });
      renderView();
      refreshIcons();
      announceCart();
      focusSel = '[data-cart-toggle]';
    } else if (d.plateRemove) {
      state.selections[d.plateRemove] = [];
      $$(`input[data-builder="${CSS.escape(d.plateRemove)}"]`).forEach((i) => { i.checked = false; });
      updateTotals(d.plateRemove);
      announceCart();
      focusSel = '[data-cart-toggle]';
    }
    refreshIcons();
    if (focusSel) (scope.querySelector(focusSel) || $('[data-cart-toggle]'))?.focus();
    return true;
  }

  function builderPanel(station) {
    const headingId = `builder-${station.id}`;
    const what = station.pricing_model === 'by_weight'
      ? 'calories'
      : `calories and estimated cart price${taxRate() > 0 ? `, including ${taxRate()}% ${state.menu.settings.sales_tax_label || 'sales tax'}` : ''}`;
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
                  ${sec.price_note && sec.price_note.toLowerCase() !== 'pick one' ? `<span class="text-sm font-semibold text-brand-800">· ${esc(sec.price_note)}</span>` : ''}
                </legend>
                <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  ${sec.items.map((item) => builderOption(station, sec, item)).join('') || '<p class="text-sm text-slate-500">No options listed.</p>'}
                </div>
              </fieldset>`)
            .join('')}
        </div>
        <div id="totals-${esc(station.id)}" style="bottom: var(--cart-h, 0px)" class="sticky rounded-b-2xl border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
          ${builderTotals(station)}
        </div>
      </section>`;
  }

  function updateTotals(stationId) {
    const station = state.menu.stations.find((s) => s.id === stationId);
    const box = $(`#totals-${CSS.escape(stationId)}`);
    if (station && box) box.innerHTML = builderTotals(station);
    renderCartBar();
    refreshIcons();
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
    if (onCartClick(e)) return;
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
  function announcementCard(a) {
    return `
      <article class="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm sm:p-6">
        <h3 class="text-2xl font-extrabold leading-tight text-amber-950 sm:text-3xl">${esc(a.title)}</h3>
        ${a.subtitle ? `<p class="mt-1 text-base font-medium text-amber-900">${esc(a.subtitle)}</p>` : ''}
        ${a.items.length
          ? `${a.items_title ? `<h4 class="mt-4 text-sm font-bold uppercase tracking-wide text-amber-800">${esc(a.items_title)}</h4>` : ''}
             <ul class="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
               ${a.items.map((it) => `<li class="text-amber-950">${esc(it)}</li>`).join('')}
             </ul>`
          : ''}
        ${a.highlights.length
          ? `<p class="mt-4 flex flex-wrap gap-2">${a.highlights
              .map((h) => `<span class="rounded-full bg-amber-900 px-3 py-1 text-sm font-bold text-white">${esc(h)}</span>`)
              .join('')}</p>`
          : ''}
        ${a.closing ? `<p class="mt-4 font-semibold italic text-amber-950">${esc(a.closing)}</p>` : ''}
      </article>`;
  }

  function renderAnnouncements() {
    const list = state.menu.announcements.filter((a) => a.visible && a.title.trim());
    if (!list.length) return '';
    return `
      <section aria-labelledby="announcements-heading" class="mb-8">
        <h2 id="announcements-heading" class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          ${icon('megaphone')} Announcements
        </h2>
        <div class="mt-3 grid gap-4 ${list.length > 1 ? 'lg:grid-cols-2' : ''}">${list.map(announcementCard).join('')}</div>
      </section>`;
  }

  function renderAllStations(status) {
    return `
      ${renderAnnouncements()}
      <p class="text-sm text-slate-600">The full menu for every station. Pick a station tab above for details${state.menu.stations.some((s) => s.builder) ? ' and the calorie calculators' : ''}.</p>
      <div class="mt-4 space-y-8">
        ${state.menu.stations
          .map((st) => `
            <article class="rounded-2xl border border-slate-200 bg-white/60 p-4 sm:p-6">
              ${stationHeader(st, status)}
              ${weightBanner(st)}
              ${st.sections.map((sec) => sectionCards(sec, st)).join('')}
              ${st.builder
                ? `<button type="button" data-goto-tab="${esc(st.id)}"
                           class="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900">
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
        ${plainSections.map((sec) => sectionCards(sec, station)).join('')}
      </article>`;
  }

  function renderView() {
    pruneSelections();
    const status = getStatus();
    const station = state.menu.stations.find((s) => s.id === state.activeTab);
    pruneCart();
    applyTheme(station ? station.theme : DEFAULT_THEME);
    $('#app').innerHTML = station ? renderStation(station, status) : renderAllStations(status);
    renderCartBar();
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
      { id: 'announcements', name: 'Announcements', icon: 'megaphone' },
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

  function field({ label, scope, fieldName, value, type = 'text', s = '', hint = '', attrs = '', lines = false }) {
    const id = `f-${scope}-${s}-${fieldName}`;
    const isArea = type === 'textarea';
    const dataType = type === 'number' ? 'number' : 'text';
    // lines: textarea edits a list, one entry per line.
    const control = isArea
      ? `<textarea id="${esc(id)}" rows="${lines ? 6 : 3}" class="${inputCls}" data-scope="${scope}" data-field="${esc(fieldName)}" data-s="${esc(s)}" data-type="${lines ? 'lines' : 'text'}" ${attrs}>${esc(lines ? value.join('\n') : value)}</textarea>`
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
          <p class="mt-1 text-xs text-slate-500">Main stations show as open from the start of breakfast to the end of lunch.</p>
          ${[
            ['Breakfast', 'breakfast_start', 'breakfast_end'],
            ['Lunch', 'lunch_start', 'lunch_end'],
            ['Espresso Bar & Bakery', 'espresso_open', 'espresso_close'],
          ]
            .map(([name, start, end]) => `
              <fieldset class="mt-3">
                <legend class="text-sm font-bold">${esc(name)}</legend>
                <div class="grid grid-cols-2 gap-3">
                  ${field({ label: 'Starts', scope: 'hours', fieldName: start, value: hours[start], type: 'time' })}
                  ${field({ label: 'Ends', scope: 'hours', fieldName: end, value: hours[end], type: 'time' })}
                </div>
              </fieldset>`)
            .join('')}
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

        <section class="${cardCls}" aria-labelledby="m-tax">
          <h3 id="m-tax" class="flex items-center gap-2 text-base font-bold">${icon('receipt')} Sales Tax (calculator estimates)</h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            ${field({ label: 'Tax rate (%)', scope: 'settings', fieldName: 'sales_tax_percent', value: settings.sales_tax_percent, type: 'number', attrs: 'step="0.01" min="0" max="100" inputmode="decimal"', hint: 'Massachusetts meals tax is 6.25%, or 7% in towns with the 0.75% local meals tax. Enter 0 if your cafeteria does not charge tax (for example, student meals at a school are often exempt).' })}
            ${field({ label: 'Tax label', scope: 'settings', fieldName: 'sales_tax_label', value: settings.sales_tax_label })}
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
    // Items that use a bracket (e.g. weekly pizza flavor) show it in the main row for quick edits.
    const hasBracket = typeof item.bracket === 'string';
    const bracketInput = `
      <label for="${id}-bracket" class="block text-xs font-semibold">Bracket text <span class="font-normal text-slate-500">(shown after the name, e.g. this week's flavor)</span></label>
      <input id="${id}-bracket" type="text" ${base} data-field="bracket" data-type="text" value="${esc(item.bracket || '')}" placeholder="Leave blank for none" class="${inputCls}" />`;
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
        ${hasBracket ? `<div class="mt-2">${bracketInput}</div>` : ''}
        <details class="mt-2">
          <summary class="cursor-pointer text-sm font-medium text-slate-600">${hasBracket ? 'Description' : 'Bracket, description'}, allergens, tags, delete</summary>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            ${hasBracket ? '' : `<div class="sm:col-span-2">${bracketInput}</div>`}
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
            <div>
              <label for="st-theme-${s}" class="block text-sm font-semibold">Color theme (used while students view this tab)</label>
              <select id="st-theme-${s}" data-scope="station" data-field="theme" data-s="${s}" data-type="text" class="${inputCls}">
                ${Object.entries(THEMES).map(([key, t]) => `<option value="${key}" ${st.theme === key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
              </select>
            </div>
          </div>
        </section>
        ${st.sections.map((_, k) => renderManagerSection(s, k)).join('')}
        <button type="button" data-action="add-section" data-s="${s}"
                class="inline-flex items-center gap-1 rounded-lg border-2 border-dashed border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
          ${icon('plus')} Add new section (e.g. Daily Specials)
        </button>
      </div>`;
  }

  function renderAnnouncementsPanel() {
    const list = state.menu.announcements;
    return `
      <div class="space-y-4">
        <p class="text-sm text-slate-600">Announcements appear at the top of the <strong>All Stations</strong> home page. Uncheck <strong>Show on home page</strong> to hide one without deleting it.</p>
        ${list
          .map((a, i) => `
            <section class="${cardCls}" aria-labelledby="ann-${i}-h">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 id="ann-${i}-h" class="flex items-center gap-2 text-base font-bold">${icon('megaphone')} ${esc(a.title || 'Untitled announcement')}</h3>
                <label class="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" data-scope="announcement" data-s="${i}" data-field="visible" data-type="checkbox" class="h-4 w-4 accent-emerald-700" ${a.visible ? 'checked' : ''} />
                  Show on home page
                </label>
              </div>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                ${field({ label: 'Title', scope: 'announcement', fieldName: 'title', value: a.title, s: i })}
                ${field({ label: 'Subtitle', scope: 'announcement', fieldName: 'subtitle', value: a.subtitle, s: i })}
                ${field({ label: 'List heading', scope: 'announcement', fieldName: 'items_title', value: a.items_title, s: i, hint: 'For example "Includes". Leave blank for none.' })}
                <div></div>
                ${field({ label: 'List items (one per line)', scope: 'announcement', fieldName: 'items', value: a.items, s: i, type: 'textarea', lines: true })}
                ${field({ label: 'Highlights (one per line, shown as badges)', scope: 'announcement', fieldName: 'highlights', value: a.highlights, s: i, type: 'textarea', lines: true })}
                <div class="sm:col-span-2">
                  ${field({ label: 'Closing line', scope: 'announcement', fieldName: 'closing', value: a.closing, s: i })}
                </div>
              </div>
              <button type="button" data-action="delete-announcement" data-s="${i}"
                      class="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                ${icon('trash-2')} Delete announcement
              </button>
            </section>`)
          .join('')}
        <button type="button" data-action="add-announcement"
                class="inline-flex items-center gap-1 rounded-lg border-2 border-dashed border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
          ${icon('plus')} Add announcement
        </button>
      </div>`;
  }

  function renderManagerBody({ keepScroll = false } = {}) {
    const body = $('#manager-body');
    const scroll = body.scrollTop;
    const s = state.menu.stations.findIndex((st) => st.id === state.managerTab);
    if (state.managerTab === 'announcements') {
      body.innerHTML = renderAnnouncementsPanel();
    } else if (s !== -1) {
      body.innerHTML = renderStationPanel(s);
    } else {
      state.managerTab = 'settings';
      body.innerHTML = renderSettingsPanel();
    }
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
    if (type === 'lines') return el.value.split('\n').map((v) => v.trim()).filter(Boolean);
    if (type === 'checkbox') return el.checked;
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
    } else if (scope === 'announcement') {
      menu.announcements[el.dataset.s][fieldName] = value;
    } else if (scope === 'hours') {
      menu.hours[fieldName] = value;
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
      case 'add-announcement': {
        state.menu.announcements.push(normalizeAnnouncement({ title: 'New announcement', visible: true }));
        renderManagerBody({ keepScroll: true });
        const input = $(`#f-announcement-${state.menu.announcements.length - 1}-title`);
        input?.focus();
        input?.select();
        markChanged();
        break;
      }
      case 'delete-announcement': {
        const a = state.menu.announcements[s];
        if (!window.confirm(`Delete the "${a.title || 'untitled'}" announcement?`)) return;
        state.menu.announcements.splice(s, 1);
        renderManagerBody({ keepScroll: true });
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
    const t = Object.fromEntries(
      ['breakfast_start', 'breakfast_end', 'lunch_start', 'lunch_end', 'espresso_open', 'espresso_close']
        .map((k) => [k, toMinutes(h[k])]),
    );
    if (Object.values(t).some(Number.isNaN)) {
      errors.push('Every start and end time (Breakfast, Lunch, Espresso Bar) is required.');
    } else {
      if (!(t.breakfast_start < t.breakfast_end)) errors.push('Breakfast must end after it starts.');
      if (!(t.lunch_start < t.lunch_end)) errors.push('Lunch must end after it starts.');
      if (!(t.espresso_open < t.espresso_close)) errors.push('The Espresso Bar must close after it opens.');
      if (t.breakfast_end > t.lunch_start) errors.push('Breakfast must end before (or when) lunch starts.');
      if (t.lunch_end > t.espresso_close) errors.push('The Espresso Bar must close at or after the end of lunch.');
    }
    menu.announcements.forEach((a) => {
      if (a.visible && !a.title.trim()) errors.push('Every announcement shown on the home page needs a title.');
    });
    const tax = menu.settings.sales_tax_percent;
    if (tax != null && !(tax >= 0 && tax <= 100)) errors.push('Sales tax rate must be between 0 and 100%.');
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
          if (typeof it.bracket === 'string') {
            it.bracket = it.bracket.trim();
            if (!it.bracket) delete it.bracket;
          }
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
    $('#cart-bar').addEventListener('click', onCartClick);
    $('#cart-bar').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.cartOpen) {
        state.cartOpen = false;
        renderCartBar();
        $('[data-cart-toggle]')?.focus();
      }
    });
    // Keep page content and sticky calculator totals clear of the fixed cart bar.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        document.documentElement.style.setProperty('--cart-h', `${$('#cart-bar').offsetHeight}px`);
      }).observe($('#cart-bar'));
    }

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
