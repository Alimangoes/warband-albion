const $ = (selector, root = document) => root.querySelector(selector);
const view = $('#view');
const dialog = $('#dialog');
const paths = {
  castle: 'M4 21V8h4v3h3V5h2v6h3V8h4v13H4zm6 0v-4a2 2 0 0 1 4 0v4M4 5v3m16-3v3',
  swords: 'M3 3l4 1 10 10-3 3L4 7 3 3z M12.5 18.5l6-6 M15.5 15.5l4.5 4.5 M18.5 21.5l3-3 ' +
    'M13 8l4-4 4-1-1 4-4 4 M8 13l-1 1 3 3 1-1 M5.5 12.5l6 6 M8.5 15.5L4 20 M2.5 18.5l3 3',
  flag: 'M5 22V3m0 1h13l-3 4 3 4H5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8-8a4 4 0 0 1 0 8',
  user: 'M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2m-8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  userPlus: 'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0v6m-3-3h6',
  crown: 'm3 6 5 4 4-6 4 6 5-4-2 13H5L3 6z',
  check: 'm5 12 4 4L19 6',
  gear: 'm10 2-.7 3-2 .9L4.5 5 2 9l2.3 2v2L2 15l2.5 4 2.8-.9 2 .9.7 3h4l.7-3 2-.9 2.8.9 2.5-4-2.3-2v-2L22 9l-2.5-4-2.8.9-2-.9L14 2zm2 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z',
  chevron: 'm9 6 6 6-6 6', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  hash: 'M5 9h15M4 15h15M10 4 7 20m10-16-3 16',
  shield: 'M12 22c5-2 8-5 8-10V5l-8-3-8 3v7c0 5 3 8 8 10zm0-15v10m-4-7h8',
  pick: 'm4 20 13-13m-8-4c6 0 11 5 11 11-2-4-6-8-11-11z',
  arrow: 'M4 12h15m-6-6 6 6-6 6'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
document.querySelectorAll('[data-icon]').forEach(item => item.innerHTML = icon(item.dataset.icon));
const esc = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const pages = { board: 'Party board', mine: 'My signups', roster: 'Guild members', guests: 'Guests', settings: 'Settings', profile: 'Profile', restricted: 'Party access' };
const regions = { asia: 'Albion Asia', europe: 'Albion Europe', americas: 'Albion Americas' };
const activities = ['Roads of Avalon', 'PvE', 'PvP', 'Gathering', 'Faction Warfare', 'Other'];
const state = { board: null, page: 'board', filter: 'All parties' };
const unreadTabs = new Map();
const rosterEntries = new Map();
const itemTabs = new Set(['board', 'mine', 'roster', 'guests']);
const unreadDot = (page, id) => unreadTabs.get(page)?.has(id) ?
  '<span class="item-unread" role="img" aria-label="Unread update" title="Unread update"></span>' : '';
function renderTabBadges() {
  document.querySelectorAll('.sidebar [data-page]').forEach(control => {
    const page = control.dataset.page;
    const count = page === state.page ? 0 : unreadTabs.get(page)?.size || 0;
    let badge = $('.nav-unread', control);
    if (!badge && count) {
      badge = document.createElement('span');
      badge.className = 'nav-unread';
      control.append(badge);
    }
    if (!badge) return;
    badge.hidden = !count;
    if (count && badge.dataset.count !== String(count)) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.dataset.count = count;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', count + (count === 1 ? ' unread update' : ' unread updates'));
    }
    if (control.closest('.mobile-nav')) {
      const label = pages[control.dataset.page];
      control.setAttribute('aria-label', count ? label + ', ' + badge.getAttribute('aria-label') : label);
    }
  });
}
function trackTabChanges(page, before, after) {
  const tracksItems = itemTabs.has(page);
  if (!before || (page === state.page && !tracksItems)) return;
  const unread = unreadTabs.get(page) || new Set();
  for (const [id, value] of after) if (value !== before.get(id)) unread.add(id);
  if (tracksItems) {
    for (const id of unread) if (!after.has(id)) unread.delete(id);
  }
  if (unread.size) unreadTabs.set(page, unread);
  else unreadTabs.delete(page);
}
function markItemRead(page, id, row) {
  if (!unreadTabs.get(page)?.delete(id)) return;
  if (row) $('.item-unread', row)?.remove();
  renderTabBadges();
}
function trackBoardTabs(board, previous) {
  const parties = entries => new Map(entries.map(party => [party.id, JSON.stringify(party)]));
  trackTabChanges('board', parties(previous.parties), parties(board.parties));
  trackTabChanges('mine', parties(previous.parties.filter(mine)), parties(board.parties.filter(mine)));
  trackTabChanges('profile', new Map([['profile', profileSnapshot(previous)]]), new Map([['profile', profileSnapshot(board)]]));
  if (showsSettings(board) && showsSettings(previous)) {
    trackTabChanges('settings', new Map([['settings', settingsSnapshot(previous)]]), new Map([['settings', settingsSnapshot(board)]]));
  }
}
const pendingDiscordRoles = [];
const pendingDiscordRemovals = new Set();
let pendingWrites = 0;
let boardVersion = 0;
const localDate = date => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(date));
const localTime = date => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(date));
const ended = party => Boolean(party.cancelled || party.finished || party.startedAt || (!party.waitUntilFull && Date.parse(party.starts) <= Date.now()));
const fillStatus = party => party.signups.length === capacity(party) ? 'Ready · All slots filled' : 'Waiting for slots';
const capacity = party => party.roles.reduce((total, role) => total + role.count, 0);
const mine = party => party.signups.some(entry => entry.mine) || party.waitlist?.some(entry => entry.mine);
const regionOptions = selected => Object.entries(regions)
  .map(([id, label]) => '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + label + '</option>').join('');
const button = (label, action, classes = 'outline') => '<button type="button" class="button ' + classes + '" ' + action + '>' + label + '</button>';
const heading = (title, summary) => '<div class="page-heading"><h1>' + title + '</h1><p>' + summary + '</p></div>';
const albionLogo = '<img class="hero-albion-logo" src="/albion-online-logo.png" width="96" height="54" alt="Albion Online">';
const empty = message => '<p class="empty">' + message + '</p>';
const loadingState = (message, skeleton = false) => {
  const status = '<div class="load-status" role="status"><span class="load-ring" aria-hidden="true"></span>' +
    '<span>' + esc(message) + '</span></div>';
  return skeleton ? '<div class="load-panel">' + status +
    '<div class="load-skeleton" aria-hidden="true"><span></span><span></span></div></div>' : status;
};
const errorLine = '<p class="error" role="alert"></p>';
const stat = (label, value, symbol, color, cls = '') =>
  '<div class="stat"><span class="stat-icon ' + color + '">' + icon(symbol) + '</span><div><small>' + label + '</small><strong class="' + cls + '">' + esc(value) + '</strong></div></div>';
const dialogClose = '<button type="button" class="button outline" data-close aria-label="Close">' + icon('close') + '</button>';
const layout = (title, body) => '<header class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2>' + dialogClose + '</header>' + body;
let toastTimer;
function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, 4200);
}
async function api(path, data) {
  const writing = data !== undefined;
  if (writing) {
    pendingWrites++;
    boardVersion++;
  }
  try {
    const response = await fetch('/api/' + path, writing ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    } : {});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'The request failed.'), {
      status: response.status, templateConflict: result.templateConflict
    });
    return result;
  } finally {
    if (writing) pendingWrites--;
  }
}
async function load() {
  boardVersion++;
  state.board = await api('board');
  queueRefresh();
  return state.board;
}
const listingOpen = () => state.page === 'board' || state.page === 'mine';
const boardReady = board => board?.signedIn && !board.onboarding;
const shouldRefresh = () => state.board?.signedIn;
const partySnapshot = board => JSON.stringify([board.canManage, board.settings?.channel,
  board.parties, board.parties.map(ended)]);
let renderedSnapshot;
let refreshTimer;
let refreshing = false;
let refreshDelay = 12000;
function queueRefresh(delay = refreshDelay + Math.random() * 3000) {
  clearTimeout(refreshTimer);
  if (!document.hidden && shouldRefresh()) {
    refreshTimer = setTimeout(refreshBoard, delay);
  }
}
function refreshViewKeepingFocus(container, redraw) {
  const active = document.activeElement;
  const controls = 'button, a[href], input, textarea, select';
  const controlKey = control => JSON.stringify([control.closest('form')?.dataset.form, control.dataset, control.name,
    control.matches('input[type="checkbox"]') ? control.value : '', control.getAttribute('aria-label'),
    control.matches('button, a[href]') ? control.textContent.trim() : '']);
  const focused = container.contains(active) && active.matches(controls);
  const row = focused ? active.closest('.party') : null;
  const partyId = row?.dataset.party;
  const key = focused && controlKey(active);
  const selection = focused && active.selectionStart != null && [active.selectionStart, active.selectionEnd];
  const scroll = container.scrollTop;
  redraw();
  if (focused) {
    const candidates = partyId ? [...container.querySelectorAll('.party')].find(item =>
      item.dataset.party === partyId)?.querySelectorAll(controls) : container.querySelectorAll(controls);
    const replacement = [...(candidates || [])].find(control => controlKey(control) === key);
    replacement?.focus({ preventScroll: true });
    if (selection) replacement?.setSelectionRange(...selection);
  }
  container.scrollTop = scroll;
}
function redrawKeepingDrafts(redraw) {
  const fields = '[data-form="settings"], [data-form="character"], [data-form="expertise"], [data-form="setup-roles"], [data-form="discord-guide"]';
  const inputs = 'input:not([type="hidden"], [data-remove-discord-role]), select, textarea';
  const key = input => JSON.stringify([input.form.dataset.form, input.name, input.type === 'checkbox' ? input.value : '']);
  const drafts = new Map();
  for (const form of view.querySelectorAll(fields)) {
    for (const input of form.querySelectorAll(inputs)) {
      const checkbox = input.type === 'checkbox';
      const initial = checkbox ? input.defaultChecked : input instanceof HTMLSelectElement
        ? ([...input.options].findLast(option => option.defaultSelected) || input.options[0])?.value : input.defaultValue;
      const value = checkbox ? input.checked : input.value;
      if (value !== initial) drafts.set(key(input), value);
    }
  }
  refreshViewKeepingFocus(view, () => {
    redraw();
    for (const form of view.querySelectorAll(fields)) {
      for (const input of form.querySelectorAll(inputs)) {
        const value = drafts.get(key(input));
        if (value === undefined) continue;
        if (input.type === 'checkbox') input.checked = value;
        else if (!(input instanceof HTMLSelectElement) || [...input.options].some(option => option.value === value)) input.value = value;
        if (input.name === 'requireLoginRole' || input.name === 'guideEnabled') input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
}
const settingsSnapshot = board => JSON.stringify([board.settings, board.canConfigure, board.requireMatchingNickname,
  board.roles, board.server, board.expertiseRoles]);
const profileSnapshot = board => JSON.stringify([board.profile, board.character, board.roles, board.expertise,
  board.expertiseRoles, board.settings?.region]);
const onboardingSnapshot = board => JSON.stringify([board.guild, board.region, board.guest, board.guildError, board.expertise, board.expertiseRoles, board.workspaces]);
let renderedSettings;
let renderedProfile;
const nextRosterRefresh = new Map();
const rosterRequests = new Map();
let nextOptionsRefresh = 0;
let settingsOptions;
async function loadRoster(page, layout, stillCurrent) {
  const request = Symbol(page);
  rosterRequests.set(page, request);
  nextRosterRefresh.set(page, Date.now() + 45000);
  const path = page === 'guests' ? 'roster?guests=1' : layout ? 'roster' : 'roster?summary=1';
  const data = await api(path);
  if (!stillCurrent() || rosterRequests.get(page) !== request) return;
  const entries = new Map(data.members.map(member => [member.id, JSON.stringify([
    member.name, member.guild || '', Boolean(member.guildMaster), Boolean(member.signedUp), [...(member.playRoles || [])].sort()
  ])]));
  trackTabChanges(page, rosterEntries.get(page), entries);
  rosterEntries.set(page, entries);
  renderTabBadges();
  if (layout?.isConnected) renderRoster(layout, data, state.board);
}
async function refreshPageData(board, previous, version) {
  const roster = $('[data-guild-layout][data-loaded]', view);
  const rosterChanged = JSON.stringify([board.settings?.region, board.settings?.albionGuild, board.guestsEnabled]) !==
    JSON.stringify([previous.settings?.region, previous.settings?.albionGuild, previous.guestsEnabled]);
  const needsSettings = state.page === 'settings' && showsSettings(board);
  const settingsChanged = needsSettings && renderedSettings !== settingsSnapshot(board);
  const refreshOptions = needsSettings && board.canConfigure && !settingsLoading &&
    (settingsChanged || Date.now() >= nextOptionsRefresh);
  const library = dialog.open && $('[data-template-library][data-loaded]', dialog);
  const editor = dialog.open && $('[data-template-id]:not([data-template-id=""])', dialog);
  const tasks = [];
  const stillCurrent = () => version === boardVersion && !document.hidden;
  for (const page of ['roster', 'guests']) {
    if (page === 'guests' && !board.guestsEnabled && !rosterChanged && page !== state.page) continue;
    if (!rosterChanged && Date.now() < (nextRosterRefresh.get(page) ?? 0)) continue;
    if (page === state.page && !roster) continue;
    tasks.push(loadRoster(page, page === state.page ? roster : null, stillCurrent));
  }
  if (refreshOptions) {
    nextOptionsRefresh = Date.now() + 45000;
    tasks.push(api('options').then(choices => {
      if (stillCurrent() && state.page === 'settings' && !settingsLoading &&
          (settingsChanged || JSON.stringify(choices) !== JSON.stringify(settingsOptions))) {
        redrawKeepingDrafts(() => settingsPage(board, choices));
      }
    }));
  } else if (settingsChanged && !board.canConfigure) {
    void settingsPage(board);
  }
  if ((library || editor) && board.canManage) {
    tasks.push(api('templates').then(templates => {
      if (!stillCurrent() || !dialog.open) return;
      if (library?.isConnected && !library.hasAttribute('aria-busy')) redrawTemplateLibrary(library, templates);
      if (editor?.isConnected && !editor.hasAttribute('aria-busy')) updateOpenTemplate(editor, templates);
    }));
  }
  await Promise.allSettled(tasks);
}
async function refreshBoard() {
  if (refreshing || document.hidden || !shouldRefresh()) return;
  if (pendingWrites) return queueRefresh();
  const version = boardVersion;
  refreshing = true;
  try {
    const board = await api('board');
    if (version !== boardVersion || document.hidden || !shouldRefresh()) return;
    refreshDelay = 12000;
    const activeParty = dialog.open && $('[data-active-party]', dialog)?.dataset.activeParty;
    const previousParty = activeParty && state.board.parties?.find(party => party.id === activeParty);
    const previous = state.board;
    state.board = board;
    if (!board.signedIn || previous.onboarding !== board.onboarding) {
      if (dialog.open) dialog.close();
      await render();
      return;
    }
    if (!boardReady(board)) {
      if (onboardingSnapshot(board) !== onboardingSnapshot(previous)) redrawKeepingDrafts(() => onboardingPage(board));
      return;
    }
    trackBoardTabs(board, previous);
    shell();
    updateProfileBadges(board);
    if (!board.canManage && dialog.open && dialog.querySelector('[data-template-library], [data-form="party"]')) dialog.close();
    if (state.page === 'settings' && (!showsSettings(board) || previous.canConfigure !== board.canConfigure)) {
      await render();
      return;
    }
    if (listingOpen() && partySnapshot(board) !== renderedSnapshot) refreshViewKeepingFocus(view, () => { void render(); });
    if (state.page === 'profile' && renderedProfile !== profileSnapshot(board)) redrawKeepingDrafts(() => profilePage(board));
    if (activeParty) {
      const current = board.parties.find(party => party.id === activeParty);
      if (!current) {
        dialog.close();
        toast('This party was removed.');
      } else if (JSON.stringify(previousParty) !== JSON.stringify(current) || previous.canManage !== board.canManage ||
          ended(current) !== Boolean($('.status.closed', dialog))) {
        refreshViewKeepingFocus(dialog, () => showParty(activeParty));
      }
    }
    await refreshPageData(board, previous, version);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      if (version !== boardVersion || !shouldRefresh()) return;
      if (dialog.open) dialog.close();
      state.board = { signedIn: false };
      await render();
      toast(error.message);
    }
    refreshDelay = Math.min(refreshDelay * 2, 60000);
  } finally {
    refreshing = false;
    queueRefresh();
  }
}
function showServerImage(serverImage, visible) {
  serverImage.hidden = !visible;
  serverImage.previousElementSibling.hidden = visible;
}
function updateServerIcon(iconUrl) {
  const src = iconUrl || null;
  for (const serverImage of document.querySelectorAll('[data-server-image]')) {
    if (serverImage.getAttribute('src') === src) continue;
    showServerImage(serverImage, false);
    serverImage.onload = () => showServerImage(serverImage, true);
    serverImage.onerror = () => showServerImage(serverImage, false);
    if (src) serverImage.src = src;
    else serverImage.removeAttribute('src');
  }
}
const showsSettings = board => board.canManage || board.canConfigure;
function updateOrganizerNav(board) {
  document.querySelectorAll('[data-organizer-nav]').forEach(item => { item.hidden = !showsSettings(board); });
}
const avatarContents = url => icon('user') + (url ? '<img class="discord-avatar" src="' + esc(url) + '" alt="">' : '');
document.addEventListener('error', event => {
  if (event.target.matches?.('.discord-avatar')) event.target.hidden = true;
}, true);
function updateProfileAvatar(board) {
  const tile = $('#profile-avatar');
  const url = board.profile?.avatarUrl || '';
  if (tile.dataset.avatar === url) return;
  tile.dataset.avatar = url;
  tile.innerHTML = avatarContents(url);
}
const rosterBadge = (symbol, label) => '<span class="roster-badge ' + symbol + '" role="img" aria-label="' +
  esc(label) + '" title="' + esc(label) + '">' + (symbol === 'scales' ? '⚖️' : icon(symbol)) + '</span>';
function memberBadges({ guildMaster, signedUp, organizer }, organizerRoleName) {
  return (guildMaster ? rosterBadge('crown', 'Guild master') : '') +
    (signedUp ? rosterBadge('check', 'Signed up to Warband') : '') +
    (organizer ? rosterBadge('scales', organizerRoleName || 'Server admin') : '');
}
function updateProfileBadges(board) {
  const guild = board.settings?.albionGuild;
  const character = board.character;
  const badges = memberBadges({ guildMaster: Boolean(character && character.region === board.settings?.region &&
      character.id === guild?.master?.id), signedUp: Boolean(character), organizer: board.canManage }, board.organizerRoleName);
  document.querySelectorAll('[data-profile-badges]').forEach(row => {
    if (row.innerHTML !== badges) row.innerHTML = badges;
  });
}
function shell() {
  const board = state.board;
  $('#workspace-switch').hidden = !board.multiServer;
  updateOrganizerNav(board);
  updateProfileAvatar(board);
  $('#mode').hidden = !board.demo;
  $('#server-name').textContent = board.server || 'Guild workspace';
  updateServerIcon(board.serverIcon);
  $('#server-detail').textContent = board.settings?.region ? regions[board.settings.region] : 'Albion Online';
  $('#profile-name').textContent = board.character?.name || board.profile?.name || 'Your profile';
  $('#profile-detail').textContent = board.character?.guild || board.roles?.[0] || 'Albion character';
  $('#breadcrumb').textContent = pages[state.page];
  document.querySelectorAll('[data-page]').forEach(el => {
    const current = el.dataset.page === state.page;
    el.classList.toggle('active', current);
    if (current) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  if (!showsSettings(board)) unreadTabs.delete('settings');
  if (!itemTabs.has(state.page)) unreadTabs.delete(state.page);
  renderTabBadges();
}
function partyRow(party) {
  const count = party.signups.length;
  const total = capacity(party);
  const [color, symbol] = ({ 'Roads of Avalon': ['violet', 'swords'], PvE: ['red', 'shield'], Gathering: ['gold', 'pick'] })[party.type] || ['green', 'flag'];
  const status = party.cancelled ? 'Cancelled' : party.finished ? 'Finished' : ended(party) ? 'Started' :
    party.waitUntilFull ? (count === total ? 'Ready' : 'Waiting') : count === total ? 'Full' : 'Open';
  const statusClass = ended(party) ? 'closed' : count === total ? 'full' : '';
  return '<article class="party" data-party="' + esc(party.id) + '"><a class="party-card-link" href="/?party=' + esc(party.id) +
    '" data-open-party="' + esc(party.id) + '" aria-label="View party: ' + esc(party.title) + '"></a>' +
    '<div class="party-identity"><span class="party-icon ' + color + '">' + icon(symbol) +
    '</span><div><h3>' + unreadDot(state.page, party.id) + esc(party.title) + '</h3><p>' + esc(party.type) + ' <span aria-hidden="true">·</span> ' + esc(party.zone) +
    '</p><div class="party-time">' + (party.waitUntilFull ? '<strong>Wait until full</strong>' :
      '<strong>' + esc(localDate(party.starts)) + '</strong><small>' + esc(localTime(party.starts)) + '</small>') +
    '</div></div></div><div class="party-slots"><strong>' + count + ' / ' + total +
    ' slots</strong><progress class="progress" aria-label="Filled party slots" max="' + total + '" value="' + count + '"></progress></div>' +
    '<span class="status ' + statusClass + '"><i></i>' + status + '</span>' +
    '<div class="actions party-actions">' +
    (state.board.canManage ? (party.canPingRoster ? button('Ping roster', 'data-list-action="ping"') : '') +
      (!party.startedAt && !party.cancelled && !party.finished && count ? button('Start party', 'data-list-action="start"', 'primary') : '') +
      (!party.cancelled && !party.finished ? button('Finish', 'data-list-action="finish"') : '') +
      button('Delete', 'data-list-action="delete"', 'outline danger') : '') +
    '</div><span class="party-chevron" aria-hidden="true"><svg viewBox="0 0 24 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 12 12-12 12"/></svg></span></article>';
}
function boardPage(board) {
  renderedSnapshot = partySnapshot(board);
  const startTime = party => party.waitUntilFull ? Infinity : Date.parse(party.starts);
  const parties = [...board.parties].sort((a, b) => startTime(a) - startTime(b));
  const open = parties.filter(party => !ended(party));
  const filtered = state.filter === 'Open slots' ? open.filter(party => party.signups.length < capacity(party)) :
    state.filter === 'My signups' ? parties.filter(mine) : parties;
  const hero = '<section class="hero"><div>' + albionLogo + '<h1>Party Board</h1><p>Find a run, claim your role, and rally your guild.</p>' +
    (board.canManage ? '<div class="actions">' + button(icon('plus') + ' Create party', 'data-create', 'primary') +
      button('Templates', 'data-templates') + '</div>' : '') + '</div></section>';
  const stats = '<div class="stats">' + stat('Upcoming parties', open.length, 'swords', 'red') +
    stat('Open slots', open.reduce((sum, party) => sum + capacity(party) - party.signups.length, 0), 'users', 'gold') +
    stat('Announcement channel', board.settings?.channel ? '#' + board.settings.channel : 'Setup required', 'hash', 'violet', 'channel-value') + '</div>';
  const filters = ['All parties', 'Open slots', 'My signups'].map(filter => '<button data-filter="' + filter +
    '" aria-pressed="' + (filter === state.filter) + '">' + filter + '</button>').join('');
  view.innerHTML = hero + stats + '<div class="section-head"><div><h2>Party listings</h2><p>Choose a party to see the roster and available roles.</p></div><div class="tabs" aria-label="Filter parties">' +
    filters + '</div></div>' + (filtered.length ? '<div class="party-list">' + filtered.map(partyRow).join('') + '</div>' : empty('No parties match this view.'));
}
async function render() {
  const board = state.board;
  if (board.multiServer && !board.onboarding && board.canConfigure && !board.settings) state.page = 'settings';
  if (state.page === 'settings' && !showsSettings(board)) state.page = 'board';
  const page = state.page;
  const ready = board.signedIn && !board.onboarding;
  $('.sidebar').hidden = !ready;
  $('.topbar').hidden = !ready;
  document.body.classList.toggle('onboarding', !ready);
  view.setAttribute('aria-busy', 'false');
  if (!board.signedIn) {
    unreadTabs.clear();
    rosterEntries.clear();
    nextRosterRefresh.clear();
    rosterRequests.clear();
    const query = new URLSearchParams(location.search);
    const party = query.get('party');
    const server = query.get('server');
    const loginParams = new URLSearchParams();
    if (party) loginParams.set('party', party);
    if (server) loginParams.set('server', server);
    const reason = query.get('login');
    const accessMessage = reason === 'server' ? 'To sign in to Warband, you must be a member of the Discord server and complete any required membership screening.' :
      reason === 'role' ? 'To sign in to Warband, you must be a member of the Discord server and have the required access role. Please contact a server administrator for assistance.' : '';
    const message = board.loginError || ({ failed: 'Discord sign-in failed. Try again or contact your organizer.',
      cancelled: 'Sign-in was cancelled or expired.' })[reason];
    view.innerHTML = '<section class="hero"><div>' + albionLogo + '<h1>Party Board</h1><p>Sign in with Discord to access your guild’s parties.</p>' +
      (message ? '<p class="error" role="alert">' + esc(message) + '</p>' : '') +
      '<div class="actions"><a class="button primary" data-discord-login href="/auth/discord' + (loginParams.size ? '?' + esc(loginParams) : '') + '">Continue with Discord ' + icon('arrow') + '</a>' +
      (board.inviteUrl ? '<a class="button outline" href="' + esc(board.inviteUrl) + '" target="_blank" rel="noopener noreferrer">Add to Discord ' + icon('plus') + '</a>' : '') + '</div>' +
      (accessMessage ? '<p class="login-access-message" role="alert">' + accessMessage + '</p>' : '') + '</div></section>';
    return;
  }
  if (page === 'restricted') {
    if (ready) shell();
    view.innerHTML = heading('Guild-only party', esc(state.restrictedParty)) +
      '<div class="actions">' + button(ready ? 'Back to party board' : 'Continue setup', 'data-page="board"') + '</div>';
    return;
  }
  if (board.onboarding) return onboardingPage(board);
  shell();
  if (page === 'board') return boardPage(board);
  if (page === 'mine') {
    renderedSnapshot = partySnapshot(board);
    const parties = board.parties.filter(mine);
    view.innerHTML = heading('My signups', 'Review your parties and claimed roles.') +
      (parties.length ? '<div class="party-list">' + parties.map(partyRow).join('') + '</div>' : empty('You haven’t signed up for a party yet.'));
  }
  if (page === 'roster' || page === 'guests') {
    const guests = page === 'guests';
    const header = heading(pages[page], guests ? 'Select a guest to view profile.' : 'Select a guild member to view profile.');
    view.innerHTML = header + '<div data-guild-layout="' + page + '">' +
      loadingState(guests ? 'Loading guests…' : 'Loading guild members…', true) + '</div>';
    const layout = $('[data-guild-layout]', view);
    try {
      await loadRoster(page, layout, () => layout.isConnected);
    } catch (error) {
      if (layout.isConnected) layout.innerHTML = empty(esc(error.message));
    } finally {
      layout.dataset.loaded = '';
    }
  }
  if (page === 'settings') await settingsPage(board);
  if (page === 'profile') profilePage(board);
}
const rosterSnapshots = new WeakMap();
function renderRoster(layout, data, board) {
  const snapshot = JSON.stringify(data);
  if (rosterSnapshots.get(layout) === snapshot) return;
  rosterSnapshots.set(layout, snapshot);
  const search = $('.guild-member-search', layout)?.value || '';
  const active = $('[data-guild-member].active', layout)?.dataset.guildMember;
  const guests = data.guests === true;
  const searchLabel = guests ? 'Search guests' : 'Search members';
  const rosterHeading = guests ? '<h2>Linked guests</h2>' :
    '<div class="guild-roster-identity"><span class="server-icon"><span>' + icon('castle') +
    '</span><img data-server-image width="33" height="33" alt="" hidden></span><div><h2>' +
    esc(data.guild?.name) + ' members</h2><small>' + esc(regions[data.region] || 'Albion Online') + '</small></div></div>';
  layout.className = 'guild-layout';
  refreshViewKeepingFocus(layout, () => {
    layout.innerHTML = !data.guild && !guests ? empty('No Albion guild is configured.') :
        '<section class="panel"><header class="guild-roster-heading">' + rosterHeading +
        '<input type="search" class="guild-member-search" aria-label="' + (guests ? searchLabel : 'Search guild members') +
        '" placeholder="' + searchLabel + '" autocomplete="off" maxlength="80"></header>' +
        '<p>' + data.members.length + (guests ? ' linked' : ' characters · Guild ID ' + esc(data.guild.id)) +
        '</p><ul class="roster guild-members">' + data.members.map(member =>
          '<li><button type="button" class="nav-button" data-guild-member="' + esc(member.id) +
          '" aria-pressed="false" aria-haspopup="dialog"><span class="profile-icon">' + avatarContents(member.avatarUrl) +
          '</span><span><strong>' + unreadDot(layout.dataset.guildLayout, member.id) + esc(member.name) + '</strong>' + (guests ? '<small>' + esc(member.guild || 'No guild') + '</small>' :
            '<span class="member-badges">' + memberBadges(member, data.organizerRoleName) + '</span>') +
          '</span></button></li>').join('') + '</ul><p class="hint" data-member-search-status aria-live="polite"></p></section>';
    updateServerIcon(state.board.serverIcon);
    if (data.guild || guests) {
      setupGuildSelection(layout, data, board, active);
      const input = $('.guild-member-search', layout);
      input.value = search;
      input.dispatchEvent(new Event('input'));
    }
  });
  const current = dialog.open && $('.guild-profile-dialog', dialog);
  if (current) {
    const member = data.members?.find(item => item.id === current.dataset.member);
    if (!member || data.region !== current.dataset.region || (data.guild?.id || '') !== current.dataset.guild) dialog.close();
    else updateGuildProfileHeading(current, member, data);
  }
}
let settingsLoading;
async function settingsPage(board, choices) {
  const current = board.settings || {};
  const title = heading('Settings', 'Manage your Discord and Albion connections.');
  renderedSettings = settingsSnapshot(board);
  if (!board.canConfigure) {
    view.innerHTML = title + '<section class="panel"><h2>' + esc(board.server) + '</h2><p>Your Discord roles · ' +
      esc(board.roles.join(', ') || 'Member') + '</p><p>Announcement channel · ' + esc(current.channel ? '#' + current.channel : 'Setup required') +
      '</p><p>Albion guild · ' + esc(current.albionGuild?.name || 'Setup required') +
      '</p><p>Guild master · ' + esc(current.albionGuild?.master?.name || 'Unassigned') + '</p></section>';
    return;
  }
  let loading;
  try {
    if (!choices) {
      view.innerHTML = title + '<div data-settings-loading>' + loadingState('Loading Discord roles and channels…', true) + '</div>';
      loading = settingsLoading = $('[data-settings-loading]', view);
      choices = await api('options');
      if (!loading.isConnected || !state.board.canConfigure) return;
      nextOptionsRefresh = Date.now() + 45000;
    }
    settingsOptions = choices;
    const { roles, channels } = choices;
    const loginRoleIds = current.loginRoleIds ?? (current.loginRoleId ? [current.loginRoleId] : []);
    const option = (item, selected, prefix = '') => '<option value="' + esc(item.id) + '"' +
      (item.id === selected ? ' selected' : '') + '>' + prefix + esc(item.name) + '</option>';
    view.innerHTML = title + '<section class="panel"><h2>' + esc(board.server) + '</h2>' +
      '<form class="form-grid" data-form="settings" data-settings-revision="' + esc(current.revision) +
      '"><label>Discord organizer role<select name="roleId"><option value="">Server admins only</option>' +
      roles.map(role => option(role, current.roleId)).join('') + '</select></label>' +
      '<label class="settings-switch"><input type="checkbox" role="switch" name="requireLoginRole" aria-controls="required-sign-in-role"' +
      (current.requireLoginRole ? ' checked' : '') + '><span class="switch-track" aria-hidden="true"></span> Require a Discord role to sign in</label>' +
      '<fieldset class="expertise" id="required-sign-in-role"' + (current.requireLoginRole ? '' : ' hidden disabled') +
      '><legend>Allowed sign-in roles</legend><p class="hint">Members and admins need at least one of these roles.</p>' +
      roles.map(role => '<label class="check"><input type="checkbox" name="loginRoleIds" value="' + esc(role.id) + '"' +
        (loginRoleIds.includes(role.id) ? ' checked' : '') + '> ' + esc(role.name) + '</label>').join('') + '</fieldset>' +
      '<label>Guest role<select name="guestRoleId"><option value="">Guest access off</option>' +
      roles.map(role => option(role, current.guestRoleId)).join('') + '</select>' +
      '<span class="hint">Assign this role through Discord or Albion Assistant. If sign-in roles are required, include it in the allowed list. ' +
      'Members with this role use guest access and can join open parties.</span></label>' +
      '<label class="settings-switch"><input type="checkbox" role="switch" name="requireMatchingNickname"' + (board.requireMatchingNickname ? ' checked' : '') +
      ' aria-describedby="matching-nickname-help"><span class="switch-track" aria-hidden="true"></span> Require Discord server nickname to match Albion character</label>' +
      '<p class="hint" id="matching-nickname-help">Enable this for servers that use Albion Assistant to set member nicknames. It applies when a member links a new character.</p>' +
      '<label>Announcement channel<select required name="channelId">' +
      '<option value="">' + (channels.length ? 'Choose a channel' : 'Give the bot permission to post in a channel') + '</option>' +
      channels.map(channel => option(channel, current.channelId, '#')).join('') +
      '</select></label><label>Albion region<select name="region">' + regionOptions(current.region) +
      '</select></label><label>Albion guild ID<input name="albionGuildId" maxlength="60" value="' + esc(current.albionGuild?.id) +
      '" placeholder="Guild ID from the Albion Killboard" spellcheck="false"><span class="hint">Use the ID from the guild’s Killboard URL for the selected region.</span></label>' +
      (current.albionGuild ? '<p class="hint">Connected Albion guild · ' + esc(current.albionGuild.name) + '</p>' : '') +
      (board.demo ? '' : '<label>Guild master<input name="guildMaster" maxlength="30" value="' +
        esc(current.albionGuild?.master?.name) + '" placeholder="Exact Albion character name" spellcheck="false">' +
        '<span class="hint">This character receives the crown in Guild members.</span></label>') +
      errorLine + '<div class="actions"><button class="button primary">Save settings</button></div></form></section>' +
      (board.demo ? '' : discordGuidePanel(choices) + '<section class="panel settings-roles"><h2>Discord roles</h2>' +
        '<form class="form-grid" data-form="setup-roles"><p>Uncheck roles to remove them, then click Save roles. Removed roles are deleted from Discord and cleared from member selections. New roles are created with permissions off.</p>' +
        '<ul class="roster" data-saved-discord-roles aria-label="Saved roles"></ul>' +
        '<ul class="roster" data-pending-discord-roles aria-label="Pending roles" hidden></ul>' +
        '<div class="label"><label for="discord-role-name">Role name</label><div class="role-name-input">' +
        '<input id="discord-role-name" name="name" maxlength="100" autocomplete="off">' +
        '<button class="button outline" value="add">Add</button></div></div>' +
        errorLine + '<div class="actions"><button class="button primary" value="save" data-save-discord-roles disabled>Save roles</button>' +
        '<button class="button outline" value="sync" formnovalidate aria-describedby="discord-role-sync-help">Sync Discord roles</button></div>' +
        '<p class="hint" id="discord-role-sync-help">Use Sync Discord roles to restore missing saved roles in Discord. Pending changes are applied with Save roles.</p></form></section>');
    const roleForm = $('[data-form="setup-roles"]', view);
    if (roleForm) renderPendingDiscordRoles(roleForm);
  } catch (error) {
    if (loading?.isConnected) {
      renderedSettings = undefined;
      view.innerHTML = title + empty(esc(error.message));
    }
  } finally {
    if (loading && loading === settingsLoading) settingsLoading = null;
  }
}
function discordGuidePanel({ channels, guide = {} }) {
  const enabled = guide.enabled === true;
  return '<section class="panel settings-guide"><h2>Warband guide</h2>' +
    '<form class="form-grid" data-form="discord-guide"><p>Post Warband sign-in instructions to Discord. Saving again in the same channel edits the existing post.</p>' +
    '<label class="settings-switch"><input type="checkbox" role="switch" name="guideEnabled" aria-controls="guide-channel"' +
    (enabled ? ' checked' : '') + '><span class="switch-track" aria-hidden="true"></span> Enable Warband guide</label>' +
    '<label id="guide-channel"' + (enabled ? '' : ' hidden') + '>Guide text channel<select name="channelId"' +
    (enabled ? ' required' : ' disabled') + '><option value="">Choose a text channel</option>' +
    channels.filter(channel => channel.type === 0).map(channel => '<option value="' + esc(channel.id) + '"' +
      (guide.channelId === channel.id ? ' selected' : '') + '>#' + esc(channel.name) + '</option>').join('') +
    '</select><span class="hint">Warband needs View Channel, Send Messages, and Embed Links.</span></label>' +
    (guide.pending ? '<p class="hint">A guide update is pending. Save again to finish it.</p>' : '') + errorLine +
    '<div class="actions"><button class="button primary">Save guide</button>' +
    (guide.messageUrl ? '<a class="button outline" href="' + esc(guide.messageUrl) + '" target="_blank" rel="noopener noreferrer">Open guide in Discord</a>' : '') +
    '</div></form></section>';
}
function renderPendingDiscordRoles(form) {
  const saved = state.board.expertiseRoles;
  for (const name of pendingDiscordRemovals) if (!saved.includes(name)) pendingDiscordRemovals.delete(name);
  const names = new Set(saved.map(name => name.toLowerCase()));
  for (let index = pendingDiscordRoles.length - 1; index >= 0; index--) {
    if (names.has(pendingDiscordRoles[index].toLowerCase())) pendingDiscordRoles.splice(index, 1);
  }
  $('[data-saved-discord-roles]', form).innerHTML = state.board.expertiseRoles.map(name =>
    '<li><label class="check"><input type="checkbox" data-remove-discord-role value="' + esc(name) + '"' +
    (pendingDiscordRemovals.has(name) ? '' : ' checked') + ' aria-label="Keep ' + esc(name) + '">' +
    '<strong>' + esc(name) + '</strong></label></li>').join('');
  const list = $('[data-pending-discord-roles]', form);
  list.hidden = pendingDiscordRoles.length === 0;
  list.innerHTML = pendingDiscordRoles.map((name, index) => '<li class="actions"><strong>' + esc(name) +
    '</strong><small>Pending</small>' + button(icon('close'), 'data-discard-discord-role="' + index +
    '" aria-label="Discard pending role ' + esc(name) + '"', 'outline') + '</li>').join('');
  updateDiscordRoleSave(form);
}
function updateDiscordRoleSave(form) {
  $('[data-save-discord-roles]', form).disabled = !pendingDiscordRoles.length && !pendingDiscordRemovals.size;
}
function discardRoleRemoval(name) {
  pendingDiscordRemovals.delete(name);
  state.board.expertiseRoles = state.board.expertiseRoles.filter(role => role !== name);
}
function workspaceChoices(servers, inviteUrl) {
  return '<section class="panel workspace-choices"><div class="workspace-list">' + servers.map(server =>
    '<div class="workspace-choice"><span class="server-icon">' + icon('castle') + '</span><div><strong>' + esc(server.name) + '</strong><small>' +
    (server.installed ? 'Warband is connected' : 'Invite Warband to this server first') + '</small></div>' +
    (server.installed ? button('Open server', 'data-select-workspace="' + esc(server.id) + '"', 'primary') :
      server.canInstall ? '<a class="button outline" href="' + esc(inviteUrl + '&guild_id=' + encodeURIComponent(server.id)) +
      '" target="_blank" rel="noopener noreferrer">Add to Discord</a>' : '') + '</div>').join('') + '</div>' +
    (!servers.length ? '<p class="hint">No eligible servers were found. Sign out and sign in again with an account that belongs to an enabled server.</p>' : '') +
    '<p class="error" role="alert"></p></section>';
}
function onboardingPage(board) {
  const signOut = (board.multiServer && board.onboarding !== 'workspace' ? button('Switch server', 'data-switch-workspace') : '') + button('Sign out', 'data-onboarding-logout');
  if (board.onboarding === 'workspace') {
    view.innerHTML = heading('Choose a Discord server', 'Open a server workspace or invite Warband to get started.') +
      workspaceChoices(board.workspaces || [], board.inviteUrl) + '<div class="actions profile-roles">' + signOut + '</div>';
    return;
  }
  if (board.onboarding === 'guild-setup') {
    view.innerHTML = heading('Guild setup pending', 'A Discord admin needs to connect the Albion guild before you can continue.') +
      '<div class="actions">' + signOut + '</div>' + errorLine;
    return;
  }
  if (board.onboarding === 'roles') {
    view.innerHTML = heading('Choose your roles', 'Select the roles you play to finish setting up Warband.') +
      '<section class="panel">' + expertiseForm(board, '', '', 'join', signOut) + '</section>';
    return;
  }
  view.innerHTML = heading('Link your Albion character', board.guest ? 'Enter the exact name of a character outside ' + esc(board.guild) + '.' :
    'Enter the exact name of your character in ' + esc(board.guild) + '.') +
    '<section class="panel"><form class="form-grid" data-form="character"><input type="hidden" name="region" value="' +
    esc(board.region) + '"><label>Albion character name<input name="name" required minlength="2" maxlength="30" autocomplete="off"></label>' +
    '<p class="hint">' + esc(regions[board.region]) +
    (board.requireMatchingNickname ? ' · Use the character name in your Albion Assistant server nickname.' : '') + '</p>' +
    '<p class="error" role="alert">' + esc(board.guildError) + '</p>' +
    '<div class="actions"><button class="button primary">Link character</button>' + signOut + '</div></form></section>';
}
async function openRequestedParty() {
  const id = new URLSearchParams(location.search).get('party');
  const board = state.board;
  if (!id || !board.signedIn || (board.onboarding && !board.guest)) return;
  if (board.parties?.some(party => party.id === id)) {
    history.replaceState(null, '', '/');
    return showParty(id);
  }
  view.insertAdjacentHTML('beforeend', loadingState('Opening party…'));
  const status = view.lastElementChild;
  try {
    const access = await api('party?id=' + encodeURIComponent(id));
    if (!state.board.signedIn || state.page !== 'board') return;
    history.replaceState(null, '', '/');
    if (access.party && boardReady(state.board)) {
      saveResult(access.party);
      showParty(id);
    } else if (access.restricted) {
      state.restrictedParty = access.restricted;
      go('restricted');
    }
  } catch (error) {
    if (boardReady(state.board)) {
      history.replaceState(null, '', '/');
      toast(error.message);
    }
  } finally {
    status.remove();
  }
}
function profilePage(board) {
  renderedProfile = profileSnapshot(board);
  const character = board.character;
  view.innerHTML = heading('Profile', 'Manage your linked Albion character and Discord roles.') +
    '<div class="profile-settings">' +
    '<section class="panel"><div class="profile-heading"><span class="profile-icon">' + avatarContents(board.profile.avatarUrl) +
    '</span><div><h2>' + esc(board.profile.name) + '</h2><div class="member-badges" data-profile-badges></div></div></div>' +
    '<p>Discord roles · ' + esc(board.roles.join(', ') || 'Member') + '</p>' +
    (character ? '<p>Linked character · ' + esc(character.name) + ' · ' + esc(character.guild || 'No guild listed') + '</p>' : '') +
    '<form class="form-grid" data-form="character"><label>Albion character name<input name="name" required minlength="2" maxlength="30" value="' +
    esc(character?.name) + '" placeholder="Exact character name"></label><label>Albion region<select name="region">' +
    regionOptions(character?.region || board.settings?.region) + '</select></label>' +
    '<p class="hint">Guild checks use public character data. Character ownership is self-reported.</p>' + errorLine +
    '<div class="actions"><button class="button primary">' + (character ? 'Refresh character' : 'Link character') + '</button>' +
    (character ? button('Unlink', 'data-unlink') : '') + (board.demo ? '' : button('Sign out', 'data-logout')) + '</div></form></section>' +
    '<section class="panel"><h2>Roles</h2>' + expertiseForm(board) + '</section></div>';
  updateProfileBadges(board);
}
function guildProfileIdentity(member, data) {
  const roles = (member.playRoles ?? []).map(esc).join(' · ');
  const identity = [data.guests ? member.guild || 'No guild' : data.guild.name, regions[data.region]].filter(Boolean).join(' · ');
  return '<div class="guild-profile-title"><h2 id="dialog-title">' + esc(member.name) + '</h2>' +
    (roles ? '<p class="guild-profile-roles">' + roles + '</p>' : '') +
    '</div><p class="guild-profile-identity">' + esc(identity) + '</p>';
}
function updateGuildProfileHeading(current, member, data) {
  const heading = $('.guild-profile-heading', current.parentElement);
  const identity = guildProfileIdentity(member, data);
  if (heading.innerHTML !== identity) heading.innerHTML = identity;
}
function setupGuildSelection(rosterLayout, data, board, active) {
  const controls = [...rosterLayout.querySelectorAll('[data-guild-member]')];
  const search = $('.guild-member-search', rosterLayout);
  const status = $('[data-member-search-status]', rosterLayout);
  const names = data.members.map(member => [member.name, data.guests ? member.guild : ''].filter(Boolean).join(' ').toLowerCase());
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    controls.forEach((control, index) => {
      const visible = names[index].includes(query);
      control.closest('li').hidden = !visible;
      if (visible) matches++;
    });
    const category = data.guests ? 'guests' : 'guild members';
    status.textContent = matches ? '' : query ? 'No ' + category + ' match your search.' : 'No ' + category + ' are listed.';
  });
  function markSelection(selectedId) {
    for (const control of controls) {
      const active = control.dataset.guildMember === selectedId;
      control.classList.toggle('active', active);
      control.setAttribute('aria-pressed', String(active));
    }
  }
  markSelection(active);
  controls.forEach((control, index) => control.addEventListener('click', () => {
    const member = data.members[index];
    markItemRead(rosterLayout.dataset.guildLayout, member.id, control);
    markSelection(member.id);
    control.focus({ preventScroll: true });
    const header = '<header class="dialog-head"><div class="guild-profile-heading">' +
      guildProfileIdentity(member, data) + '</div>' + dialogClose + '</header>';
    const history = board.demo ? '<p>Live character stats are unavailable in demo mode.</p>' :
      '<div class="tabs" role="group" aria-label="Albion combat history">' +
      Object.entries(profileTabs).map(([key, label]) => '<button type="button" data-profile-tab="' + key +
        '" aria-pressed="false" aria-controls="albion-profile-content">' + label + '</button>').join('') +
      '</div><div id="albion-profile-content" aria-live="polite"></div>';
    showDialog(header + '<div class="dialog-body albion-profile guild-profile-dialog" data-member="' + esc(member.id) +
      '" data-region="' + esc(data.region) + '" data-guild="' + esc(data.guild?.id) + '">' + history + '</div>');
    if (!board.demo) setupAlbionProfile($('.guild-profile-dialog', dialog), member.id, data.guests);
  }));
}
const profileTabs = { kills: 'Kills', deaths: 'Deaths' };
const fameFormat = new Intl.NumberFormat();
const fameText = value => value === null ? 'Unavailable' : fameFormat.format(value);
const combatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function profileDetails(tab, data) {
  if (!data.events.length) return '<p class="hint">Albion returned no recent PvP ' + tab + ' for this character.</p>';
  const fameLabel = tab === 'kills' ? 'Kill fame' : 'Death fame';
  return '<p class="hint">Showing up to ' + esc(data.limit) + ' recent PvP ' + tab + ' from Albion.</p>' +
    '<ul class="profile-combat">' + data.events.map(event => {
      const summary = '<span><strong>' + esc(event.opponent) +
        '</strong><time datetime="' + esc(event.timestamp) + '">' + esc(combatDate.format(new Date(event.timestamp))) +
        '</time></span><span class="combat-fame">' + fameLabel + ' · ' + fameText(event.fame) + '</span>';
      return '<li>' + (event.id ? '<details data-combat-event="' + esc(event.id) + '"><summary>' + summary +
        icon('chevron') + '</summary><div class="combat-reveal"><div class="combat-detail" aria-live="polite"></div></div></details>' :
        '<div class="combat-summary">' + summary + '</div>') + '</li>';
    }).join('') + '</ul>';
}
const combatSlots = { MainHand: 'Weapon', OffHand: 'Offhand', Head: 'Head', Armor: 'Chest',
  Shoes: 'Feet', Cape: 'Cape', Bag: 'Bag', Mount: 'Mount', Food: 'Food', Potion: 'Potion' };
const combatGearGrid = [
  'Bag', 'Head', 'Cape', 'MainHand', 'Armor', 'OffHand',
  'Potion', 'Shoes', 'Food', '', 'Mount', ''
];
const equipmentSilhouette = '<svg class="combat-silhouette" viewBox="0 0 110 150" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M55 5c-6 0-9 4-9 10l1 9-3 4-11 5-10 13-11 8-6 8-3 11 3 2 5-10 6-4-2 5 2 2 8-11 11-6 5-6 2 14-2 13 2 15 3 13-1 13 3 17-3 8 2 4h9l3-3-2-9 3-18-1-13 1-10 1 10-1 13 3 18-2 9 3 3h9l2-4-3-8 3-17-1-13 3-13 2-15-2-13 2-14 5 6 11 6 8 11 2-2-2-5 6 4 5 10 3-2-3-11-6-8-11-8-10-13-11-5-3-4 1-9c0-6-3-10-9-10Z"/></svg>';
const equipmentSlotShapes = {
  Bag: 'M9 5V4a3 3 0 0 1 6 0v1h2.4a2 2 0 0 1 2 1.8l1.2 12a2 2 0 0 1-2 2.2H5.4a2 2 0 0 1-2-2.2l1.2-12A2 2 0 0 1 6.6 5H9Zm2 0h2V4a1 1 0 0 0-2 0v1ZM7 12v5h10v-5H7Z',
  Cape: 'm7 3 5 2 5-2 3 4-2 4 3 10-6-2-3 2-3-2-6 2 3-10-2-4 3-4Z',
  Potion: 'M9 2h6v3h-1v4a7 7 0 1 1-4 0V5H9V2Zm-2 13a5 5 0 0 0 10 0H7Z',
  Food: 'm3 3 6 6 1 3 1 1 7-9c2-2 4-1 4 0l-4 7-4 3 6 6-2 2-6-7-6 7-2-2 6-7-2-1-3-1-5-6 2 1 4 4 1-1-4-5Z',
  Mount: 'm17 2 1 3 3 3 1 7-4 2-4-4-3 3 1 4h6v2H4v-2l3-1 1-6-2-3 2-5 5-2 4-1Zm1 7v2h2V9h-2Z'
};
function combatItemIcon(item, size) {
  const [id, enchantment] = item.id.split('@');
  const variant = [enchantment ? 'Enchantment .' + enchantment : '', itemQualities[item.quality - 1]].filter(Boolean);
  const meta = [combatSlots[item.slot], ...variant, item.count > 1 ? '×' + fameText(item.count) : ''].filter(Boolean);
  const market = item.market;
  const source = market?.source === 'older-sales' ? 'Older sales' : market?.source === 'listings' ? 'Listing estimate' : '';
  const pricedQuality = market?.quality !== (item.quality ?? 1) ? itemQualities[market?.quality - 1] : '';
  const marketValue = market ? 'Est. market value ' + fameText(market.total) + ' silver' +
    (item.count > 1 ? ' (' + fameText(market.unit) + ' each)' : '') : 'Market value unavailable';
  const description = esc([item.name, ...meta, marketValue, source, pricedQuality ? 'Based on ' + pricedQuality + ' quality' : '']
    .filter(Boolean).join(' · '));
  return '<span class="combat-item" title="' + description + '"><img class="item-icon" alt="' + description +
    '" loading="lazy" width="' + size + '" height="' + size + '" src="' + esc(itemIcon(id, enchantment, item.quality ?? 1)) + '">' +
    (item.count > 1 ? '<span class="combat-item-count" aria-hidden="true">' + fameText(item.count) + '</span>' : '') + '</span>';
}
function combatItems(items) {
  return '<ul class="combat-gear-icons">' + items.map(item => '<li>' + combatItemIcon(item, 44) + '</li>').join('') + '</ul>';
}
function silverEstimate(estimate, tooltipId) {
  if (!estimate || estimate.silver === null) return 'Unavailable';
  const amount = fameText(estimate.silver);
  if (estimate.priced >= estimate.total) return amount;
  return '<span class="silver-estimate" tabindex="0" aria-describedby="' + esc(tooltipId) + '">' + amount +
    '<span class="silver-estimate-tooltip" id="' + esc(tooltipId) + '" role="tooltip">' +
    esc(estimate.priced + '/' + estimate.total + ' stacks priced') + '</span></span>';
}
function combatDetails(data, eventId) {
  const gear = (label, player, isVictim = false) => {
    const affiliation = [player.allianceTag ? '[' + player.allianceTag + ']' : '', player.guild].filter(Boolean).join(' ');
    const itemPower = fameText(Math.round(player.itemPower));
    const equipped = new Map(player.gear.map(item => [item.slot, item]));
    return '<section class="combat-player' + (isVictim && data.type !== 'Knockdown' ? ' combat-victim' : '') +
      '" aria-label="' + label + '"><h3><span>' + esc(player.name) + '</span>' +
      (player.itemPower > 0 ? '<small title="Average item power" aria-label="' + esc(itemPower + ' average item power') +
        '">' + itemPower + '</small>' : '') + '</h3>' +
      (affiliation ? '<p class="combat-affiliation">' + esc(affiliation) + '</p>' : '') +
      '<div class="combat-equipment" role="group" aria-label="' + label + ' equipment">' + equipmentSilhouette +
      combatGearGrid.map(slot => {
        const item = equipped.get(slot);
        if (item) return '<div class="combat-slot">' + combatItemIcon(item, 80) + '</div>';
        if (!slot) return '<span aria-hidden="true"></span>';
        const emptyLabel = 'Empty ' + combatSlots[slot].toLowerCase() + ' slot';
        const shape = equipmentSlotShapes[slot];
        return '<span class="combat-slot combat-placeholder" role="img" aria-label="' + emptyLabel + '" title="' +
          emptyLabel + '">' + (shape ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="' +
            shape + '"/></svg>' : '') + '</span>';
      }).join('') + '</div><p class="combat-build">Est. build value <strong>' +
      silverEstimate(player.build, 'silver-' + eventId + (isVictim ? '-victim' : '-killer')) + '</strong></p></section>';
  };
  const result = '<div class="combat-result"><span class="combat-type">' + esc(data.type) + '</span>' +
    '<dl><div><dt>Kill fame</dt><dd>' + fameText(data.fame ?? null) + '</dd></div>' +
    '<div><dt>Est. silver lost</dt><dd>' + silverEstimate(data.silverLost, 'silver-' + eventId + '-lost') + '</dd></div></dl>' +
    (data.timestamp ? '<time datetime="' + esc(data.timestamp) + '">' + esc(combatDate.format(new Date(data.timestamp))) + '</time>' : '') +
    '</div>';
  return '<div class="combat-gears">' + gear('Killer', data.killer) + result + gear('Victim', data.victim, true) +
    '</div><p class="hint combat-market-note">Hover over an item for its market value and any price fallback. Build values include equipped gear, mounts, food and potions. Estimated loss also includes the victim’s inventory.</p>' +
    '<section><h3>Victim inventory</h3>' + (data.inventory === null ? '<p class="hint">Inventory unavailable.</p>' :
      data.inventory.length ? combatItems(data.inventory) : '<p class="hint">No inventory items reported.</p>') + '</section>';
}
function setupCombatEvent(details, loads, memberQuery) {
  const body = $('.combat-detail', details);
  const id = details.dataset.combatEvent;
  let pending = false;
  let rendered = false;
  async function loadEvent() {
    if (!details.open || pending || rendered) return;
    pending = true;
    body.innerHTML = loadingState('Loading fight details…');
    if (!loads.has(id)) {
      loads.set(id, api('profile?' + memberQuery + '&view=event&id=' + encodeURIComponent(id)).catch(error => {
        loads.delete(id);
        throw error;
      }));
    }
    try {
      const data = await loads.get(id);
      if (!details.isConnected) return;
      body.innerHTML = combatDetails(data, id);
      rendered = true;
    } catch (error) {
      if (!details.isConnected) return;
      body.innerHTML = '<p class="error">' + esc(error.message) + '</p>' + button('Try again', 'data-combat-retry');
      $('[data-combat-retry]', body).addEventListener('click', () => {
        $('summary', details).focus();
        loadEvent();
      });
    } finally {
      pending = false;
    }
  }
  details.addEventListener('toggle', loadEvent);
}
let stopCombatRefresh;
function updateCombatHistory(content, tab, data, combatLoads, memberQuery) {
  const existing = $('.profile-combat', content);
  const draft = document.createElement('template');
  draft.innerHTML = profileDetails(tab, data);
  const incoming = $('.profile-combat', draft.content);
  const active = document.activeElement;
  if (existing && incoming) {
    const previous = new Map([...existing.querySelectorAll('[data-combat-event]')]
      .map(details => [details.dataset.combatEvent, details]));
    let next = existing.firstElementChild;
    for (const row of [...incoming.children]) {
      const details = $('[data-combat-event]', row);
      const kept = details && previous.get(details.dataset.combatEvent);
      const item = kept?.parentElement ?? row;
      if (kept) {
        const summary = $('summary', kept);
        const text = $('summary', details).innerHTML;
        if (summary.innerHTML !== text) summary.innerHTML = text;
        previous.delete(details.dataset.combatEvent);
      } else if (details) setupCombatEvent(details, combatLoads, memberQuery);
      if (item !== next) existing.insertBefore(item, next);
      next = item.nextElementSibling;
    }
    while (next) {
      const obsolete = next;
      next = next.nextElementSibling;
      obsolete.remove();
    }
    if (active !== document.activeElement && existing.contains(active)) active.focus({ preventScroll: true });
  } else {
    content.replaceChildren(draft.content);
    content.querySelectorAll('[data-combat-event]').forEach(details => setupCombatEvent(details, combatLoads, memberQuery));
  }
}
function setupAlbionProfile(panel, memberId, guests) {
  const memberQuery = 'member=' + encodeURIComponent(memberId) + (guests ? '&directory=guests' : '');
  const content = $('#albion-profile-content', panel);
  const tabs = [...panel.querySelectorAll('[data-profile-tab]')];
  const loads = new Map();
  const combatLoads = new Map();
  const controller = new AbortController();
  let timer;
  let selected;
  let interval = 10000;
  let selection = 0;
  let displayed;
  let running;
  const ready = current => !controller.signal.aborted && panel.isConnected && dialog.open && current === selection;
  function queue(current) {
    clearTimeout(timer);
    if (ready(current) && !document.hidden) timer = setTimeout(() => refresh(selected, current), interval);
  }
  async function refresh(tab, current) {
    if (!ready(current) || document.hidden || running === current) return;
    running = current;
    if (displayed === undefined) content.innerHTML = loadingState('Loading ' + profileTabs[tab].toLowerCase() + '…', true);
    try {
      if (!loads.has(tab)) loads.set(tab, api('profile?' + memberQuery + '&view=' + tab).finally(() => loads.delete(tab)));
      const data = await loads.get(tab);
      if (!ready(current)) return;
      interval = 10000;
      const snapshot = JSON.stringify(data);
      if (snapshot === displayed) return;
      updateCombatHistory(content, tab, data, combatLoads, memberQuery);
      displayed = snapshot;
    } catch (error) {
      if (!ready(current)) return;
      interval = Math.min(interval * 2, 60000);
      if (displayed === undefined || [401, 403, 404].includes(error.status)) {
        displayed = undefined;
        content.innerHTML = '<p class="error">' + esc(error.message) + '</p>' + button('Try again', 'data-profile-retry');
        $('[data-profile-retry]', content).addEventListener('click', () => {
          tabs.find(button => button.dataset.profileTab === tab)?.focus();
          void refresh(tab, current);
        });
      }
    } finally {
      if (running === current) running = undefined;
      if (ready(current)) {
        queue(current);
      }
    }
  }
  function select(tab) {
    clearTimeout(timer);
    selected = tab;
    displayed = undefined;
    interval = 10000;
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.profileTab === tab)));
    content.innerHTML = '';
    void refresh(tab, ++selection);
  }
  function resume() {
    clearTimeout(timer);
    if (!document.hidden) void refresh(selected, selection);
  }
  document.addEventListener('visibilitychange', resume, { signal: controller.signal });
  window.addEventListener('online', resume, { signal: controller.signal });
  stopCombatRefresh = () => {
    controller.abort();
    clearTimeout(timer);
  };
  tabs.forEach(button => button.addEventListener('click', () => select(button.dataset.profileTab)));
  select('kills');
}
function expertiseForm(board, partyId = '', role = '', action = 'join', extraActions = '') {
  return '<form class="form-grid' + (partyId ? ' dialog-body' : '') + '" data-form="expertise" data-join-party="' +
    esc(partyId) + '" data-join-role="' + esc(role) + '" data-join-action="' + esc(action) + '"><fieldset class="expertise"><legend>Select all that apply</legend>' +
    board.expertiseRoles.map(name => '<label class="check"><input type="checkbox" name="expertise" value="' + esc(name) +
      '"' + (board.expertise.includes(name) ? ' checked' : '') + '>' + esc(name) + '</label>').join('') +
    '</fieldset>' + errorLine + '<div class="actions"><button class="button primary">' +
    (partyId ? action === 'waitlist' ? 'Save roles and join waitlist' : 'Save roles and claim slot' : 'Save roles') + '</button>' + extraActions + '</div></form>';
}
const buildSlots = { weapon: 'Weapon', offhand: 'Offhand', head: 'Head piece', chest: 'Chest piece',
  feet: 'Foot piece', cape: 'Cape', food: 'Food', potion: 'Potion' };
const itemQualities = ['Normal', 'Good', 'Outstanding', 'Excellent', 'Masterpiece'];
let itemCatalog, itemCatalogReady = false;
function loadItems() {
  return itemCatalog ||= fetch('/albion-items.json').then(response => {
    if (!response.ok) throw new Error('Albion items could not be loaded. Try opening the build again.');
    return response.json();
  }).then(items => {
    itemCatalogReady = true;
    return items;
  }).catch(error => { itemCatalog = undefined; throw error; });
}
const itemIcon = (id, enchantment, quality) => 'https://render.albiononline.com/v1/item/' +
  encodeURIComponent(id + (enchantment ? '@' + enchantment : '')) + '.png?quality=' + quality + '&size=64';
const itemOption = (value, label, selected) => '<option value="' + esc(value) + '"' +
  (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
function buildSlot(slot, label, item) {
  return '<fieldset class="build-slot" data-build-slot="' + slot + '"><legend>' + label + '</legend>' +
    '<div class="build-controls"><span class="build-icon"><img class="item-icon" width="40" height="40" alt=""' +
    (item ? ' src="' + esc(itemIcon(item.id, item.enchantment, item.quality)) + '"' : ' hidden') + '></span>' +
    '<div class="item-picker"><input type="search" data-item-search role="combobox" aria-autocomplete="list" aria-expanded="false"' +
    ' aria-label="Search ' + label + '" placeholder="Search item name" autocomplete="off" value="' + esc(item?.name) + '">' +
    '<input type="hidden" data-item-id value="' + esc(item?.id) + '"><ul class="item-results" role="listbox" hidden></ul></div>' +
    '<div class="build-filters"><label>Tier<select data-item-tier>' +
    Array.from({ length: 8 }, (_, i) => itemOption(i + 1, 'T' + (i + 1), item?.id[1] ?? 4)).join('') + '</select></label>' +
    '<label>Enchantment<select data-item-enchant>' + itemOption(item?.enchantment ?? 0, '.' + (item?.enchantment ?? 0)) +
    '</select></label><label>Quality<select data-item-quality>' +
    itemOption(item?.quality ?? 1, itemQualities[(item?.quality ?? 1) - 1]) + '</select></label></div></div></fieldset>';
}
function roleEdit(name = '', count = 1, build = {}) {
  return '<div data-party-role><div class="role-edit"><label>Role name<input name="roleName" required maxlength="36" value="' + esc(name) +
    '" placeholder="e.g. Healer"></label><label>Slots<input name="roleCount" type="number" min="1" max="20" value="' + esc(count) +
    '" required></label>' + button(icon('close'), 'data-remove-role aria-label="Remove role"') + '</div>' +
    '<details class="role-build" data-role-build><summary>Recommended build' + (Object.keys(build).length ? ' · ' + Object.keys(build).length + ' items' : '') +
    '</summary><div class="build-grid">' + Object.entries(buildSlots).map(([slot, label]) => buildSlot(slot, label, build[slot])).join('') +
    '</div><div class="hint" data-build-note role="status"></div></details></div>';
}
let pickerCount = 0;
function closeItems(field) {
  const search = $('[data-item-search]', field);
  $('.item-results', field).hidden = true;
  search.setAttribute('aria-expanded', 'false');
  search.removeAttribute('aria-activedescendant');
}
function suggestItems(field, catalog) {
  const search = $('[data-item-search]', field);
  if (document.activeElement !== search || field.disabled) return;
  const list = $('.item-results', field);
  list.id ||= 'build-items-' + ++pickerCount;
  const query = search.value.trim().toLowerCase();
  const tier = $('[data-item-tier]', field).value;
  const selected = $('[data-item-id]', field).value;
  const matches = catalog.filter(([id, name, slot]) => slot === field.dataset.buildSlot && id[1] === tier &&
    (selected || name.toLowerCase().includes(query) || id.toLowerCase().includes(query))).slice(0, 40);
  list.innerHTML = matches.length ? matches.map(([id, name], index) => '<li role="option" aria-selected="false" id="' +
    list.id + '-' + index + '" data-item-choice="' + esc(id) + '">' + esc(name) + '</li>').join('') :
    '<li role="presentation" class="hint">No matching items at this tier.</li>';
  list.hidden = false;
  search.setAttribute('aria-controls', list.id);
  search.setAttribute('aria-expanded', 'true');
  search.removeAttribute('aria-activedescendant');
}
function updateItemSlot(field, catalog) {
  const item = catalog.find(row => row[0] === $('[data-item-id]', field).value);
  const enchant = $('[data-item-enchant]', field);
  const quality = $('[data-item-quality]', field);
  const previousEnchant = enchant.value, previousQuality = quality.value;
  enchant.innerHTML = (item?.[3] || [0]).map(value => itemOption(value, '.' + value, previousEnchant)).join('');
  quality.innerHTML = itemQualities.slice(0, item?.[4] || 1).map((label, i) => itemOption(i + 1, label, previousQuality)).join('');
  const image = $('.item-icon', field);
  image.hidden = !item;
  if (item) image.src = itemIcon(item[0], Number(enchant.value), Number(quality.value));
  return item;
}
function updateBuild(build, catalog) {
  const weapon = updateItemSlot($('[data-build-slot="weapon"]', build), catalog);
  const offhand = $('[data-build-slot="offhand"]', build);
  offhand.disabled = Boolean(weapon?.[5]);
  $('[data-build-note]', build).textContent = offhand.disabled ? 'This two-handed weapon uses both hands.' : '';
  for (const field of build.querySelectorAll('[data-build-slot]:not([data-build-slot="weapon"])')) updateItemSlot(field, catalog);
}
function readBuild(row) {
  const result = {};
  for (const slot of row.querySelectorAll('[data-build-slot]:not(:disabled)')) {
    const id = $('[data-item-id]', slot).value;
    if (id) result[slot.dataset.buildSlot] = { id, enchantment: Number($('[data-item-enchant]', slot).value),
      quality: Number($('[data-item-quality]', slot).value) };
  }
  return result;
}
function showBuild(build, roleIndex) {
  if (!build) return '';
  return '<ul class="build-preview" aria-label="Recommended build">' +
    Object.entries(buildSlots).filter(([slot]) => build[slot]).map(([slot, label]) => {
      const item = build[slot];
      const tooltipId = 'role-item-' + roleIndex + '-' + slot;
      return '<li><button type="button" class="build-item" aria-label="' + esc(item.name) +
        '" aria-describedby="' + tooltipId + '"><img class="item-icon" width="32" height="32" loading="lazy" alt="" src="' +
        esc(itemIcon(item.id, item.enchantment, item.quality)) + '"></button><span class="build-tooltip" role="tooltip" id="' +
        tooltipId + '"><strong aria-hidden="true">' + esc(item.name) + '</strong>' + label + ' · T' + esc(item.id[1]) +
        '.' + esc(item.enchantment) + ' · ' + esc(itemQualities[item.quality - 1]) + '</span></li>';
    }).join('') + '</ul>';
}
function showDialog(html) {
  stopCombatRefresh?.();
  stopCombatRefresh = undefined;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
let backdropDialog;
const outsideDialog = (dialog, event) => {
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
};
document.addEventListener('pointerdown', event => {
  backdropDialog = event.target instanceof HTMLDialogElement && outsideDialog(event.target, event) ? event.target : null;
});
document.addEventListener('click', event => {
  if (backdropDialog === event.target && backdropDialog?.open && outsideDialog(backdropDialog, event)) backdropDialog.close();
  backdropDialog = null;
});
dialog.addEventListener('close', () => {
  if (!dialog.open) {
    stopCombatRefresh?.();
    stopCombatRefresh = undefined;
  }
  if (!dialog.open) $('[data-template-conflict]')?.close();
  if (!dialog.open && $('.guild-profile-dialog', dialog)) dialog.replaceChildren();
});
function slots() {
  const inputs = Array.from(dialog.querySelectorAll('[name="roleCount"]'));
  const total = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  $('#slot-total').textContent = total + ' / 20 slots';
  const add = $('[data-add-role]', dialog);
  add.disabled = inputs.length >= 20;
}
async function showTemplates() {
  showDialog(layout('Templates', '<div class="dialog-body" data-template-library>' + loadingState('Loading templates…', true) + '</div>'));
  const library = $('[data-template-library]', dialog);
  await loadTemplateLibrary(library);
}
const templateSnapshots = new WeakMap();
function redrawTemplateLibrary(library, templates) {
  const snapshot = JSON.stringify(templates);
  if (templateSnapshots.get(library)?.snapshot === snapshot) return;
  templateSnapshots.set(library, { snapshot, templates });
  refreshViewKeepingFocus(library, () => {
    library.innerHTML = '<div class="actions"><button type="button" class="button outline" data-import-template>Import template</button>' +
      '<input type="file" data-template-file accept="application/json,.json" aria-label="Import template file" hidden></div>' +
      '<p class="hint">Import a Warband JSON file to review before saving. Discord mentions must be selected again for this server.</p>' +
      (templates.length ? '<ul class="template-list">' + templates.map(template =>
      '<li><div><strong>' + esc(template.title) + '</strong><p class="hint">' + esc(template.type) + ' · ' +
      esc(template.zone) + ' · ' + capacity(template) + ' slots</p></div>' +
      '<div class="actions">' + button('Use template', 'data-use-template="' + esc(template.id) + '" aria-label="Use template: ' + esc(template.title) + '"') +
      button('Export', 'data-export-template="' + esc(template.id) + '" aria-label="Export template: ' + esc(template.title) + '"', 'outline') +
      button(icon('close'), 'data-delete-template="' + esc(template.id) + '" aria-label="Delete template: ' + esc(template.title) + '"', 'outline danger') +
      '</div></li>').join('') + '</ul>' : empty('No saved templates. Use Save template in the party form to add one.')) + errorLine;
  });
}
async function loadTemplateLibrary(library) {
  library.addEventListener('change', async event => {
    if (!event.target.matches('[data-template-file]')) return;
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    await formTask(library, $('[data-import-template]', library), async () => {
      if (file.size > 24000) throw new Error('Choose a template file smaller than 24 KB.');
      let contents;
      try { contents = JSON.parse(await file.text()); }
      catch { throw new Error('This file is not valid JSON. Export a template from Warband and try again.'); }
      const draft = await api('templates', { action: 'import-preview', file: contents });
      if (!library.isConnected || !dialog.open) return;
      createParty(draft);
      const status = $('[data-template-status]', dialog);
      status.textContent = 'Imported draft. Review the details, start time and Discord mentions, then click Save template. Nothing has been saved or published yet.';
      status.hidden = false;
    });
  });
  library.addEventListener('click', async event => {
    if (event.target.closest('[data-import-template]')) return $('[data-template-file]', library).click();
    const exportControl = event.target.closest('[data-export-template]');
    if (exportControl) {
      const source = templateSnapshots.get(library).templates.find(item => item.id === exportControl.dataset.exportTemplate);
      const template = Object.fromEntries(['title', 'type', 'zone', 'summary', 'roles', 'starts', 'guildOnly', 'waitUntilFull', 'announcementThread']
        .filter(field => source[field] !== undefined).map(field => [field, source[field]]));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'warband-template', version: 1, template }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = (source.title.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'warband') + '.warband.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const control = event.target.closest('[data-use-template]');
    if (control) return createParty(templateSnapshots.get(library).templates.find(template => template.id === control.dataset.useTemplate));
    const remove = event.target.closest('[data-delete-template]');
    if (remove && window.confirm('Delete this template for all organizers?')) {
      await formTask(library, remove, async () => {
        const template = templateSnapshots.get(library).templates.find(item => item.id === remove.dataset.deleteTemplate);
        try {
          await api('templates', { action: 'delete', id: template.id, revision: template.revision ?? null });
        } catch (error) {
          if (error.status === 409) {
            toast(error.message);
            queueRefresh(0);
          }
          throw error;
        }
        if (dialog.open && library.isConnected) redrawTemplateLibrary(library, await api('templates'));
      });
    }
  });
  try {
    const templates = await api('templates');
    if (dialog.open && library.isConnected) redrawTemplateLibrary(library, templates);
  } catch (error) {
    if (dialog.open && library.isConnected) library.innerHTML = empty(esc(error.message));
  } finally {
    library.dataset.loaded = '';
  }
}
const templateDrafts = new WeakMap();
const templateDraft = form => JSON.stringify([...form.querySelectorAll('input, select, textarea')]
  .map(input => [input.value, input.checked]));
function updateOpenTemplate(form, templates) {
  const latest = templates.find(template => template.id === form.dataset.templateId);
  const warning = $('[data-template-change]', form);
  if (!latest) {
    warning.textContent = 'Another organizer deleted this template.';
    warning.hidden = false;
  } else if ((latest.revision ?? '') !== form.dataset.templateRevision) {
    if (templateDraft(form) === templateDrafts.get(form) && !$('[data-role-build][open]', form)) {
      refreshViewKeepingFocus(dialog, () => createParty(latest));
    } else {
      warning.textContent = 'Another organizer saved changes. Your draft is still open.';
      warning.hidden = false;
    }
  }
}
function confirmTemplateOverride() {
  const warning = document.createElement('dialog');
  warning.dataset.templateConflict = '';
  warning.setAttribute('aria-labelledby', 'template-conflict-title');
  warning.setAttribute('aria-describedby', 'template-conflict-description');
  warning.innerHTML = '<header class="dialog-head"><h2 id="template-conflict-title">Template changed</h2></header>' +
    '<form method="dialog" class="dialog-body"><p id="template-conflict-description">Another organizer saved this template while you were editing. ' +
    'Override changes to replace their saved version with yours, or cancel to discard your draft and return to the template library.</p>' +
    '<div class="actions"><button class="button primary" value="override">Override changes</button>' +
    '<button class="button outline" value="cancel" autofocus>Cancel changes</button></div></form>';
  document.body.append(warning);
  return new Promise(resolve => {
    warning.addEventListener('close', () => {
      warning.remove();
      resolve(warning.returnValue === 'override');
    }, { once: true });
    warning.showModal();
  });
}
async function saveTemplate(form, details) {
  const draft = templateDraft(form);
  const request = { ...details, id: form.dataset.templateId, revision: form.dataset.templateRevision || null };
  while (dialog.open && form.isConnected) {
    try {
      const saved = await api('templates', request);
      form.dataset.templateId = saved.id;
      form.dataset.templateRevision = saved.revision ?? '';
      templateDrafts.set(form, draft);
      $('[data-template-change]', form).hidden = true;
      const status = $('[data-template-status]', form);
      status.textContent = 'Template saved.';
      status.hidden = false;
      return;
    } catch (error) {
      if (!error.templateConflict || !dialog.open || !form.isConnected) throw error;
      const override = await confirmTemplateOverride();
      if (!dialog.open || !form.isConnected) return;
      if (!override) return showTemplates();
      request.revision = error.templateConflict.revision;
    }
  }
}
function createParty(template, editing = false) {
  const settings = state.board.settings;
  const deliveryLocked = editing && Boolean(template.messageUrl || template.threadId);
  const mentionRoles = state.board.mentionRoles || [];
  const selectedRoles = new Set(template?.mentionRoleIds || (template?.mentionRoleId ? [template.mentionRoleId] : []));
  const waitUntilFull = template?.waitUntilFull === true;
  const savedStart = Date.parse(template?.starts);
  const date = new Date(Number.isFinite(savedStart) ? savedStart : Date.now() + 3600000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => byte.toString(16).padStart(2, '0')).join('');
  showDialog(layout(editing ? 'Edit party' : 'Create party', '<form class="dialog-body form-grid" data-form="party" data-edit-party="' +
    (editing ? esc(template.id) : '') + '" data-template-id="' + (editing ? '' : esc(template?.id)) +
    '" data-template-revision="' + (editing ? '' : esc(template?.revision)) + '" data-nonce="' + nonce +
    '"><label>Party name<input name="title" required minlength="2" maxlength="80" placeholder="e.g. Avalonian Roads Roam" value="' +
    esc(template?.title) + '"></label>' +
    '<div class="form-grid party-schedule"><label><span class="party-schedule-heading">Activity</span><select name="type">' + activities.map(activity =>
      '<option' + (activity === template?.type ? ' selected' : '') + '>' + activity + '</option>').join('') +
    '</select></label><div class="party-start-field"><div class="party-schedule-heading"><label for="party-start-time">Start time</label>' +
    '<label class="settings-switch"><input type="checkbox" role="switch" name="waitUntilFull" aria-controls="party-start-time"' +
    (waitUntilFull ? ' checked' : '') + '><span class="switch-track" aria-hidden="true"></span> Wait until full</label></div>' +
    '<input id="party-start-time" name="starts" type="datetime-local" value="' + local + '"' +
    (waitUntilFull ? ' disabled' : ' required') + '>' +
    (!editing && savedStart <= Date.now() ? '<span class="hint">Choose a future time before publishing.</span>' : '') + '</div></div>' +
    '<label>Meeting location<input name="zone" required maxlength="80" placeholder="e.g. Thetford Portal" value="' + esc(template?.zone) + '"></label>' +
    '<label>Party notes<textarea name="summary" maxlength="420" rows="2" placeholder="Gear, IP, or meetup details">' +
    esc(template?.summary) + '</textarea></label>' +
    '<div><div class="role-header"><strong>Party roles <small id="slot-total"></small></strong>' +
    button(icon('plus') + ' Add role', 'data-add-role') + '</div><div id="role-rows">' +
    (template ? template.roles.map(role => roleEdit(role.name, role.count, role.build)).join('') : roleEdit('Tank') + roleEdit('Healer') + roleEdit('DPS', 3)) + '</div></div>' +
    (settings?.albionGuild || template?.guildOnly ? '<label class="check"><input name="guildOnly" type="checkbox"' +
      (template?.guildOnly ? ' checked' : '') + '> Require membership in ' +
      esc(settings?.albionGuild?.name || 'the configured Albion guild') + '</label>' : '') +
    (deliveryLocked ? '' : '<fieldset class="expertise"><legend>Discord announcement</legend>' +
      '<label class="check"><input type="checkbox" name="announcementThread"' +
      (template?.announcementThread ? ' checked' : '') + '> Post in its own public thread</label>' +
      '<div class="announcement-roles" role="group" aria-label="Roles to mention"><strong>Roles to mention</strong>' +
      (mentionRoles.length ? mentionRoles.map(role => '<label class="check"><input type="checkbox" name="mentionRoleIds" value="' +
        esc(role.id) + '"' + (selectedRoles.has(role.id) ? ' checked' : '') + '> @' + esc(role.name) + '</label>').join('') :
        '<p class="hint">No Discord roles available.</p>') + '</div></fieldset>') +
    '<p class="hint">' + (editing ? 'Saving updates the Discord announcement.' :
      settings ? 'Parties announce in #' + esc(settings.channel) + '.' :
      'Choose an announcement channel in Settings before publishing.') + '</p>' +
    '<p class="hint" data-template-status role="status" hidden></p><p class="hint" data-template-change role="status" hidden></p>' +
    errorLine + '<div class="actions"><button class="button primary">' + (editing ? 'Save edit' : 'Publish party') + '</button>' +
    (editing ? '' : '<button class="button outline" name="template" formnovalidate>Save template</button>') +
    button('Cancel', 'data-close') + '</div></form>'));
  slots();
  const form = $('[data-form="party"]', dialog);
  templateDrafts.set(form, templateDraft(form));
}
function showParty(id) {
  const party = state.board.parties.find(item => item.id === id);
  if (!party) return toast('This party could not be found.');
  const row = $('[data-party="' + CSS.escape(id) + '"]', view)?.closest('.party');
  markItemRead('board', id, row);
  markItemRead('mine', id, row);
  const closed = ended(party);
  const mayManage = state.board.canManage;
  const detail = party.roles.map((role, index) => {
    const people = party.signups.filter(entry => entry.role === index);
    const mine = people.some(entry => entry.mine);
    const waiting = (party.waitlist || []).filter(entry => entry.role === index);
    const myWait = waiting.find(entry => entry.mine);
    const full = people.length + waiting.filter(entry => entry.offered).length >= role.count || waiting.some(entry => !entry.mine);
    const control = closed ? '' : mine ? button('Leave', 'data-action="leave"') :
      myWait && !myWait.offered ? button('Leave waitlist', 'data-action="leave-waitlist"') :
      button(myWait?.offered ? 'Accept slot' : full ? 'Join waitlist' : 'Claim slot',
        'data-action="' + (myWait?.offered || !full ? 'join' : 'waitlist') + '" data-role="' + index + '"', myWait?.offered ? 'primary' : 'outline');
    const signupList = mayManage && !closed && people.length ?
      '<ul class="detail-signups">' + people.map(entry =>
        '<li><small>' + esc(entry.name) + (entry.mine ? ' (you)' : '') + '</small>' +
        (entry.signupId ? button('Remove', 'data-action="remove-signup" data-signup-id="' + esc(entry.signupId) +
          '" data-signup-name="' + esc(entry.name) + '" aria-label="Remove ' + esc(entry.name) + ' from party"', 'outline danger') : '') +
        '</li>').join('') + '</ul>' :
      '<small>' + (people.map(entry => esc(entry.name) + (entry.mine ? ' (you)' : '')).join(', ') || 'Available') + '</small>';
    const waitlist = waiting.length ? '<section class="role-waitlist" aria-label="' + esc(role.name) + ' waitlist"><div class="waitlist-heading">' +
      icon('users') + '<strong>Waitlist · ' + esc(role.name) + '</strong><span>' + waiting.length + '</span></div><ol>' +
      waiting.map((entry, position) => '<li' + (entry.offered ? ' class="slot-offered"' : '') + '><span class="waitlist-person"><strong>' +
        esc(entry.name) + (entry.mine ? ' (you)' : '') + '</strong><small>' + (entry.offered ? 'Slot offered · Ready to accept' : 'Waiting · Position ' + (position + 1)) +
        '</small></span>' + (!closed && entry.mine && entry.offered ? button('Decline', 'data-action="leave-waitlist"') : '') +
        (!closed && mayManage && entry.signupId ? button('Remove', 'data-action="remove-waitlist" data-signup-id="' + esc(entry.signupId) +
          '" data-signup-name="' + esc(entry.name) + '" aria-label="Remove ' + esc(entry.name) + ' from waitlist"', 'outline danger') : '') +
        '</li>').join('') + '</ol></section>' : '';
    return '<div class="detail-role"><div class="detail-role-info"><strong>' + esc(role.name) + ' · ' + people.length + '/' + role.count +
      '</strong>' + signupList + '</div>' + showBuild(role.build, index) + control + waitlist + '</div>';
  }).join('');
  const announcement = party.announcement === 'demo' ? 'Demo announcement · #' + party.channel :
    party.announcement === 'sent' ? 'Announced in #' + party.channel :
    party.announcement === 'failed' ? 'Announcement failed · ' + party.deliveryError : 'Announcement pending · #' + party.channel;
  const retry = mayManage && (party.messageUrl || (!party.cancelled && !party.finished)) &&
    ['failed', 'pending'].includes(party.announcement);
  showDialog(layout(party.title, '<div class="dialog-body" data-active-party="' + esc(party.id) + '">' +
    '<p class="eyebrow">' + esc(party.type) + '</p><p><strong>' + esc(party.waitUntilFull ? (closed ? 'No scheduled start' : fillStatus(party)) :
      localDate(party.starts) + ' · ' + localTime(party.starts)) +
    '</strong><br><span class="hint">' + esc(party.zone + ' · Hosted by ' + party.host) + '</span></p>' +
    (party.summary ? '<p>' + esc(party.summary) + '</p>' : '') +
    (party.guildOnly ? '<p class="hint">Guild only · ' + esc(party.guild) + '</p>' : '') +
    (closed ? '<p class="status closed">' + (party.cancelled ? 'Cancelled' : party.finished ? 'Finished' : party.startedAt ? 'Started · Roster locked' : 'Signups closed') + '</p>' : '') +
    '<div class="detail-roles">' + detail + '</div><p class="hint">' + esc(announcement) + '</p>' + errorLine +
    '<div class="actions">' + (party.messageUrl ? '<a class="button outline" href="' + esc(party.messageUrl) +
    '" target="_blank" rel="noopener noreferrer">Open Discord announcement</a>' : '') +
    (retry ? button('Retry announcement', 'data-action="retry"') : '') +
    (mayManage && !party.startedAt && !party.cancelled && !party.finished ?
      (party.signups.length ? button('Start party', 'data-action="start"', 'primary') : '') + button('Edit party', 'data-edit-party="' + esc(id) + '"') : '') +
    (mayManage && !closed ? button('Cancel party', 'data-action="cancel"', 'outline danger') : '') + '</div></div>'));
}
let pageMotion;
function go(page) {
  if (!state.board || !Object.hasOwn(pages, page)) return;
  if (page === 'settings' && !showsSettings(state.board)) return;
  const changed = state.page !== page;
  state.page = page;
  void render();
  if (changed) {
    pageMotion?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pageMotion = view.animate([{ opacity: .72, translate: '0 5px' }, { opacity: 1, translate: '0 0' }],
        { duration: 220, easing: 'ease-in-out' });
    }
  }
  queueRefresh(0);
}
function saveResult(party) {
  const index = state.board.parties.findIndex(item => item.id === party.id);
  if (index === -1) state.board.parties.unshift(party);
  else state.board.parties[index] = party;
}
function showControlLoading(control, loading) {
  if (!control) return;
  if (loading) control.setAttribute('aria-busy', 'true');
  else control.removeAttribute('aria-busy');
}
async function formTask(form, submitter, task) {
  if (form.hasAttribute('aria-busy')) return;
  form.setAttribute('aria-busy', 'true');
  const error = $('.error', form);
  const controls = [...form.querySelectorAll('button:not(:disabled)')];
  controls.forEach(control => control.disabled = true);
  showControlLoading(submitter, true);
  error.textContent = '';
  try {
    await task();
  } catch (issue) {
    error.textContent = issue.message;
  } finally {
    form.removeAttribute('aria-busy');
    showControlLoading(submitter, false);
    controls.forEach(control => control.disabled = false);
  }
}
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const data = Object.fromEntries(fields);
  if (form.dataset.form === 'setup-roles') {
    const action = event.submitter?.value || 'add';
    if (action === 'add') {
      const input = form.elements.name;
      const name = input.value.trim();
      const duplicate = [...state.board.expertiseRoles, ...pendingDiscordRoles]
        .some(role => role.toLowerCase() === name.toLowerCase());
      $('.error', form).textContent = !name ? 'Enter a role name.' : duplicate ? 'A role with that name already exists.' : '';
      if (!name || duplicate) return;
      pendingDiscordRoles.push(name);
      input.value = '';
      renderPendingDiscordRoles(form);
      input.focus();
      return;
    }
    if (action === 'save' && pendingDiscordRemovals.size &&
        !window.confirm('Delete the selected roles from Warband and Discord? This removes them from every member.')) return;
    const removalControls = [...form.querySelectorAll('[data-remove-discord-role]')];
    removalControls.forEach(control => control.disabled = true);
    void formTask(form, event.submitter, async () => {
      if (action === 'save') {
        while (pendingDiscordRoles.length) {
          await api('expertise', { setup: true, action: 'add', name: pendingDiscordRoles[0] });
          state.board.expertiseRoles.push(pendingDiscordRoles.shift());
        }
        for (const name of pendingDiscordRemovals) {
          await api('expertise', { setup: true, action: 'delete', name });
          discardRoleRemoval(name);
        }
      } else {
        await api('expertise', { setup: true, action: 'sync' });
      }
      await load();
      if (state.page === 'settings') await render();
      toast(action === 'save' ? 'Discord roles saved.' : 'Discord roles synced.');
    }).finally(() => {
      if (form.isConnected) renderPendingDiscordRoles(form);
    });
    return;
  }
  void formTask(form, event.submitter, async () => {
    if (form.dataset.form === 'discord-guide') {
      const enabled = fields.has('guideEnabled');
      const guide = await api('settings', { action: 'discord-guide', enabled, channelId: data.channelId });
      if (form.isConnected) {
        settingsOptions = { ...settingsOptions, guide };
        form.closest('.settings-guide').outerHTML = discordGuidePanel(settingsOptions);
        $('[data-form="discord-guide"] button', view).focus({ preventScroll: true });
      }
      toast(enabled ? 'Warband guide saved in Discord.' : 'Warband guide removed.');
      return;
    }
    if (form.dataset.form === 'expertise') {
      const selected = fields.getAll('expertise');
      const result = await api('expertise', { roles: selected });
      state.board.expertise = selected;
      if (form.dataset.joinParty) {
        const party = await api('party/action', { id: form.dataset.joinParty, action: form.dataset.joinAction || 'join', role: Number(form.dataset.joinRole) });
        saveResult(party);
        await render();
        showParty(party.id);
      } else {
        const completingOnboarding = state.board.onboarding === 'roles';
        await load();
        await render();
        if (completingOnboarding) openRequestedParty();
      }
      toast((form.dataset.joinParty ? form.dataset.joinAction === 'waitlist' ? 'Added to the waitlist.' : 'Slot claimed.' : 'Roles saved.') +
        (result.synced ? '' : result.reason === 'setup' ? ' A Discord admin needs to configure role sync.' :
          ' Discord role sync was incomplete. Save your roles again to retry.'));
      return;
    }
    if (form.dataset.form === 'party') {
      const roles = [...form.querySelectorAll('[data-party-role]')].map(row => ({
        name: $('[name="roleName"]', row).value, count: Number($('[name="roleCount"]', row).value), build: readBuild(row)
      }));
      const details = { ...data, roles, guildOnly: fields.has('guildOnly'),
        waitUntilFull: fields.has('waitUntilFull'), announcementThread: fields.has('announcementThread'), mentionRoleIds: fields.getAll('mentionRoleIds') };
      const templateStatus = $('[data-template-status]', form);
      templateStatus.hidden = true;
      if (event.submitter?.name === 'template') {
        const start = new Date(data.starts);
        if (data.starts && !Number.isFinite(start.getTime())) throw new Error('Choose a valid template start time.');
        return saveTemplate(form, { ...details, starts: data.starts ? start.toISOString() : null });
      }
      const id = form.dataset.editParty;
      const current = state.board.parties.find(party => party.id === id);
      const selectedStart = new Date(data.starts);
      const starts = details.waitUntilFull ? null : current && Math.floor(Date.parse(current.starts) / 60000) === Math.floor(selectedStart.getTime() / 60000)
        ? current.starts : selectedStart.toISOString();
      const party = await api('party', { ...details, starts, nonce: form.dataset.nonce, ...(id ? { id, action: 'edit' } : {}) });
      saveResult(party);
      state.filter = 'All parties';
      go('board');
      showParty(party.id);
      toast((id ? 'Party updated.' : 'Party published.') +
        (party.announcement === 'failed' ? ' Discord announcement failed.' : ''));
      return;
    }
    const linkingDuringOnboarding = state.board.onboarding === 'character';
    if (form.dataset.form === 'settings') {
      data.requireLoginRole = fields.has('requireLoginRole');
      data.loginRoleIds = fields.getAll('loginRoleIds');
      data.requireMatchingNickname = fields.has('requireMatchingNickname');
      data.revision = form.dataset.settingsRevision || null;
    }
    try {
      await api(form.dataset.form, data);
    } catch (error) {
      if (form.dataset.form === 'settings' && error.status === 409) {
        toast(error.message);
        queueRefresh(0);
      }
      throw error;
    }
    await load();
    await render();
    if (linkingDuringOnboarding) openRequestedParty();
    toast(form.dataset.form === 'settings' ? 'Settings saved.' : 'Albion character linked.');
  });
});
view.addEventListener('change', event => {
  if (event.target.name === 'guideEnabled') {
    const group = $('#guide-channel', event.target.form);
    const channel = $('select', group);
    group.hidden = channel.disabled = !event.target.checked;
    channel.required = event.target.checked;
    return;
  }
  if (event.target.hasAttribute('data-remove-discord-role')) {
    const { value, checked, form } = event.target;
    if (checked) pendingDiscordRemovals.delete(value);
    else pendingDiscordRemovals.add(value);
    updateDiscordRoleSave(form);
    return;
  }
  if (event.target.name !== 'requireLoginRole') return;
  const group = $('#required-sign-in-role', event.target.form);
  const enabled = event.target.checked;
  group.hidden = !enabled;
  group.disabled = !enabled;
});
document.addEventListener('click', async event => {
  const partyLink = event.target.closest('[data-open-party]');
  if (partyLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    if (state.board) showParty(partyLink.dataset.openParty);
    return;
  }
  const login = event.target.closest('[data-discord-login]');
  if (login && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    if (login.hasAttribute('aria-busy')) event.preventDefault();
    else showControlLoading(login, true);
    return;
  }
  const el = event.target.closest('button');
  if (!el || !state.board) return;
  if (el.hasAttribute('data-switch-workspace')) {
    el.disabled = true;
    showControlLoading(el, true);
    try {
      const data = await api('workspaces');
      showDialog(layout('Choose a Discord server', '<div class="dialog-body">' + workspaceChoices(data.servers, data.inviteUrl) + '</div>'));
    } catch (error) { toast(error.message); }
    finally { el.disabled = false; showControlLoading(el, false); }
    return;
  }
  if (el.dataset.selectWorkspace) {
    const container = el.closest('.workspace-choices');
    await formTask(container, el, async () => {
      const data = await api('workspaces', { id: el.dataset.selectWorkspace });
      const params = new URLSearchParams(location.search);
      params.set('server', data.selected);
      if (state.board.workspaceId && state.board.workspaceId !== data.selected) params.delete('party');
      location.assign('/?' + params);
    });
    return;
  }
  if (el.hasAttribute('data-discard-discord-role')) {
    const form = el.closest('form');
    pendingDiscordRoles.splice(Number(el.dataset.discardDiscordRole), 1);
    renderPendingDiscordRoles(form);
    form.elements.name.focus();
    return;
  }
  if (el.hasAttribute('data-onboarding-logout')) {
    el.disabled = true;
    showControlLoading(el, true);
    try {
      await api('logout', {});
      location.reload();
    } catch (error) {
      el.disabled = false;
      showControlLoading(el, false);
      toast(error.message);
    }
    return;
  }
  if (el.hasAttribute('data-close')) return dialog.close();
  if (el.dataset.page) return go(el.dataset.page);
  if (el.hasAttribute('data-create')) return createParty();
  if (el.dataset.editParty) {
    const party = state.board.parties.find(item => item.id === el.dataset.editParty);
    if (party) createParty(party, true);
    return;
  }
  if (el.hasAttribute('data-templates')) return showTemplates();
  if (el.dataset.filter) {
    state.filter = el.dataset.filter;
    boardPage(state.board);
    document.querySelectorAll('[data-filter]').forEach(filter => {
      if (filter.dataset.filter === state.filter) filter.focus();
    });
  }
  if (el.dataset.party) return showParty(el.dataset.party);
  if (el.hasAttribute('data-add-role')) {
    $('#role-rows').insertAdjacentHTML('beforeend', roleEdit());
    $('#role-rows').lastElementChild.querySelector('input').focus();
    slots();
  }
  if (el.hasAttribute('data-remove-role')) {
    el.closest('[data-party-role]').remove();
    slots();
    $('[data-add-role]', dialog).focus();
  }
  if (el.hasAttribute('data-unlink') || el.hasAttribute('data-logout')) {
    const form = el.closest('form');
    await formTask(form, el, async () => {
      if (el.hasAttribute('data-logout')) {
        await api('logout', {});
        location.assign('/');
      } else {
        await api('character', { unlink: true });
        await load();
        await render();
        toast('Character unlinked and roles reset.');
      }
    });
  }
  if (el.dataset.action) {
    const container = el.closest('[data-active-party]');
    if (['join', 'waitlist'].includes(el.dataset.action) && state.board.expertiseRoles.length && !state.board.expertise.length) {
      showDialog(layout('Choose your roles', expertiseForm(state.board, container.dataset.activeParty, el.dataset.role, el.dataset.action)));
      return;
    }
    if (el.dataset.action === 'cancel' && !window.confirm('Cancel this party and close signups?')) return;
    if (el.dataset.action === 'start' && !window.confirm('Start this party and lock the roster? New claims and waitlist changes will close.')) return;
    const removingSignup = ['remove-signup', 'remove-waitlist'].includes(el.dataset.action);
    if (removingSignup && !window.confirm('Remove ' + el.dataset.signupName + ' from this party?')) return;
    await formTask(container, el, async () => {
      const party = await api('party/action', { id: container.dataset.activeParty, action: el.dataset.action,
        ...(removingSignup ? { signupId: el.dataset.signupId } : { role: Number(el.dataset.role) }) });
      const reopen = dialog.open && container.isConnected;
      saveResult(party);
      await render();
      if (reopen) showParty(party.id);
      if (el.dataset.action === 'join') toast('Slot claimed.');
      if (el.dataset.action === 'leave') toast('Slot released.');
      if (el.dataset.action === 'cancel') toast('Party cancelled.');
      if (el.dataset.action === 'start') toast('Party started. The roster is locked.');
      if (el.dataset.action === 'waitlist') toast('Added to the waitlist.');
      if (el.dataset.action === 'leave-waitlist') toast('You left the waitlist.');
      if (removingSignup) toast(el.dataset.signupName + (el.dataset.action === 'remove-waitlist' ? ' was removed from the waitlist.' : ' was removed from the party.') +
        (party.announcement === 'failed' ? ' Discord announcement update failed.' : ''));
    });
  }
  if (el.dataset.listAction) {
    const { listAction: action } = el.dataset;
    const id = el.closest('.party').dataset.party;
    const prompt = {
      delete: 'Permanently delete this party, its signups, and any linked Discord thread?',
      finish: 'Finish this party and close signups?',
      start: 'Start this party and lock the roster? New claims and waitlist changes will close.',
      ping: 'Mention everyone who claimed a slot in this party’s Discord thread?'
    };
    if (!window.confirm(prompt[action])) return;
    el.disabled = true;
    showControlLoading(el, true);
    try {
      const party = await api('party/action', { id, action });
      if (action === 'ping') {
        toast(state.board.demo ? 'Roster ping simulated.' : 'Roster ping posted in the Discord thread.');
        return;
      }
      if (party.deleted) {
        state.board.parties = state.board.parties.filter(item => item.id !== id);
        markItemRead('board', id);
        markItemRead('mine', id);
      } else saveResult(party);
      await render();
      toast(party.deleted ? 'Party deleted.' : action === 'start' ? 'Party started. The roster is locked.' : 'Party finished.');
    } catch (error) {
      toast(error.message);
    } finally {
      el.disabled = false;
      showControlLoading(el, false);
    }
  }
});
dialog.addEventListener('input', event => {
  if (event.target.name === 'roleCount') slots();
});
async function refreshBuild(build) {
  const note = $('[data-build-note]', build);
  if (!itemCatalogReady && !note.firstElementChild) {
    note.innerHTML = '<span class="load-status"><span class="load-ring" aria-hidden="true"></span>Loading Albion items…</span>';
  }
  try {
    const catalog = await loadItems();
    if (build.isConnected) updateBuild(build, catalog);
  } catch (error) {
    if (build.isConnected) note.textContent = error.message;
  }
}
dialog.addEventListener('toggle', event => {
  if (event.target.matches('[data-role-build][open]')) void refreshBuild(event.target);
}, true);
async function suggestFor(search) {
  const field = search.closest('[data-build-slot]');
  await refreshBuild(field.closest('[data-role-build]'));
  if (itemCatalog && field.isConnected) suggestItems(field, await itemCatalog);
}
dialog.addEventListener('focusin', event => {
  if (event.target.matches('[data-item-search]')) void suggestFor(event.target);
});
dialog.addEventListener('focusout', event => {
  if (event.target.matches('[data-item-search]')) closeItems(event.target.closest('[data-build-slot]'));
});
dialog.addEventListener('input', event => {
  if (!event.target.matches('[data-item-search]')) return;
  $('[data-item-id]', event.target.closest('[data-build-slot]')).value = '';
  void suggestFor(event.target);
});
async function chooseItem(option) {
  const field = option.closest('[data-build-slot]');
  $('[data-item-id]', field).value = option.dataset.itemChoice;
  $('[data-item-search]', field).value = option.textContent;
  closeItems(field);
  await refreshBuild(field.closest('[data-role-build]'));
}
dialog.addEventListener('pointerdown', event => {
  if (event.target.closest('[data-item-choice]')) event.preventDefault();
});
dialog.addEventListener('click', event => {
  const item = event.target.closest('.build-item');
  if (item) item.focus();
  const option = event.target.closest('[data-item-choice]');
  if (option) void chooseItem(option);
});
dialog.addEventListener('keydown', event => {
  const search = event.target;
  if (event.key === 'Escape' && search.matches('.build-item')) {
    event.preventDefault();
    search.closest('li').classList.add('tooltip-dismissed');
    return;
  }
  if (!search.matches('[data-item-search]')) return;
  const field = search.closest('[data-build-slot]');
  const list = $('.item-results', field);
  if (event.key === 'Escape' && !list.hidden) {
    event.preventDefault();
    closeItems(field);
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) || list.hidden) return;
  event.preventDefault();
  const options = [...list.querySelectorAll('[data-item-choice]')];
  if (!options.length) return;
  const current = options.findIndex(option => option.id === search.getAttribute('aria-activedescendant'));
  if (event.key === 'Enter') return void chooseItem(options[Math.max(current, 0)]);
  const next = event.key === 'ArrowDown' ? Math.min(current + 1, options.length - 1) :
    current < 0 ? options.length - 1 : Math.max(current - 1, 0);
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === next)));
  search.setAttribute('aria-activedescendant', options[next].id);
  options[next].scrollIntoView({ block: 'nearest' });
});
dialog.addEventListener('focusout', event => {
  if (event.target.matches('.build-item')) event.target.closest('li').classList.remove('tooltip-dismissed');
});
dialog.addEventListener('change', async event => {
  if (event.target.name === 'waitUntilFull') {
    const input = $('#party-start-time', event.target.form);
    input.disabled = event.target.checked;
    input.required = !event.target.checked;
    return;
  }
  const build = event.target.closest('[data-role-build]');
  if (!build) return;
  if (event.target.matches('[data-item-tier]')) {
    const field = event.target.closest('[data-build-slot]');
    const selected = $('[data-item-id]', field);
    if (selected.value) {
      await refreshBuild(build);
      if (!itemCatalog || !field.isConnected) return;
      const id = 'T' + event.target.value + selected.value.slice(2);
      const variant = (await itemCatalog).find(row => row[0] === id);
      selected.value = variant?.[0] || '';
      if (variant) $('[data-item-search]', field).value = variant[1];
    }
  }
  void refreshBuild(build);
});
document.addEventListener('visibilitychange', () => queueRefresh(0));
window.addEventListener('online', () => queueRefresh(0));
window.addEventListener('pageshow', () => showControlLoading($('[data-discord-login]'), false));
load().then(async () => {
  await render();
  openRequestedParty();
}).catch(error => {
  view.setAttribute('aria-busy', 'false');
  view.innerHTML = heading('Party board unavailable', esc(error.message)) +
    '<div class="actions"><a class="button outline" href="/">Reload board</a><button type="button" class="button outline" id="reconnect">Clear session</button></div>';
  $('#reconnect').addEventListener('click', async event => {
    const control = event.currentTarget;
    control.disabled = true;
    showControlLoading(control, true);
    try {
      await api('logout', {});
      location.assign('/');
    } catch (issue) {
      control.disabled = false;
      showControlLoading(control, false);
      toast(issue.message);
    }
  });
});
