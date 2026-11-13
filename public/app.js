const $ = (selector, root = document) => root.querySelector(selector);
const view = $('#view');
const dialog = $('#dialog');
const paths = {
  crest: 'M12 2 3.5 6v6c0 5 4 8 8.5 10 4.5-2 8.5-5 8.5-10V6L12 2z M8 14l7-7m-2 0h2v2m-9 4 5 5m-4-2-1 1m10-3-2-2',
  castle: 'M4 21V8h4v3h3V5h2v6h3V8h4v13H4zm6 0v-4a2 2 0 0 1 4 0v4M4 5v3m16-3v3',
  swords: 'm14 16 6 5m-4-7 5 5M4 3l4 1 12 12-4 4L4 8 3 4l1-1zm9 6 5-5 3-1-1 5-4 4M9 14l-6 6m1-3 3 4',
  flag: 'M5 22V3m0 1h13l-3 4 3 4H5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8-8a4 4 0 0 1 0 8',
  user: 'M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2m-8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
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
const pages = { board: 'Party board', mine: 'My signups', roster: 'Guild roster', settings: 'Settings', profile: 'Profile' };
const regions = { asia: 'Albion Asia', europe: 'Albion Europe', americas: 'Albion Americas' };
const activities = ['Roads of Avalon', 'PvE', 'PvP', 'Gathering', 'Faction Warfare', 'Other'];
const state = { board: null, page: 'board', filter: 'All parties' };
const localDate = date => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(date));
const localTime = date => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(date));
const ended = party => party.cancelled || Date.parse(party.starts) <= Date.now();
const capacity = party => party.roles.reduce((total, role) => total + role.count, 0);
const mine = party => party.signups.some(entry => entry.mine);
const regionOptions = selected => Object.entries(regions)
  .map(([id, label]) => '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + label + '</option>').join('');
const button = (label, action, classes = 'outline') => '<button type="button" class="button ' + classes + '" ' + action + '>' + label + '</button>';
const heading = (title, summary) => '<div class="page-heading"><h1>' + title + '</h1><p>' + summary + '</p></div>';
const empty = message => '<p class="empty">' + message + '</p>';
const errorLine = '<p class="error" role="alert"></p>';
const stat = (label, value, symbol, color, cls = '') =>
  '<div class="stat"><span class="stat-icon ' + color + '">' + icon(symbol) + '</span><div><small>' + label + '</small><strong class="' + cls + '">' + esc(value) + '</strong></div></div>';
const layout = (title, body) => '<header class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2><button type="button" class="button outline" data-close aria-label="Close">' + icon('close') + '</button></header>' + body;
let toastTimer;
function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, 4200);
}
async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
async function load() {
  state.board = await api('board');
  return state.board;
}
function shell() {
  const board = state.board;
  $('.create').hidden = !board.canManage;
  $('#mode').hidden = !board.demo;
  $('#server-name').textContent = board.server || 'Guild workspace';
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
}
function partyRow(party) {
  const count = party.signups.length;
  const total = capacity(party);
  const [color, symbol] = ({ 'Roads of Avalon': ['violet', 'swords'], PvE: ['red', 'shield'], Gathering: ['gold', 'pick'] })[party.type] || ['green', 'flag'];
  const status = party.cancelled ? 'Cancelled' : ended(party) ? 'Started' : count === total ? 'Full' : 'Open';
  const statusClass = ended(party) ? 'closed' : count === total ? 'full' : '';
  return '<article class="party"><div class="party-identity"><span class="party-icon ' + color + '">' + icon(symbol) +
    '</span><div><h3>' + esc(party.title) + '</h3><p>' + esc(party.type) + ' <span aria-hidden="true">·</span> ' + esc(party.zone) +
    '</p></div></div><div class="party-time"><strong>' + esc(localDate(party.starts)) + '</strong><small>' + esc(localTime(party.starts)) +
    '</small></div><div class="party-slots"><strong>' + count + ' / ' + total +
    ' slots</strong><progress class="progress" aria-label="Filled party slots" max="' + total + '" value="' + count + '"></progress></div>' +
    '<span class="status ' + statusClass + '"><i></i>' + status + '</span>' +
    button('View party ' + icon('chevron'), 'data-party="' + esc(party.id) + '"') + '</article>';
}
function boardPage(board) {
  const parties = [...board.parties].sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts));
  const open = parties.filter(party => !ended(party));
  const filtered = state.filter === 'Open slots' ? open.filter(party => party.signups.length < capacity(party)) :
    state.filter === 'My signups' ? parties.filter(mine) : parties;
  const hero = '<section class="hero"><div><p class="eyebrow">' + icon('crest') + ' Albion Online</p><h1>Party Board</h1><p>Find a run, claim your role, and rally your guild.</p>' +
    (board.canManage ? button(icon('plus') + ' Create party', 'data-create', 'primary') : '') + '</div></section>';
  const stats = '<div class="stats">' + stat('Upcoming parties', open.length, 'swords', 'red') +
    stat('Open slots', open.reduce((sum, party) => sum + capacity(party) - party.signups.length, 0), 'users', 'gold') +
    stat('Announcement channel', board.settings?.channel ? '#' + board.settings.channel : 'Setup required', 'hash', 'violet', 'channel-value') + '</div>';
  const filters = ['All parties', 'Open slots', 'My signups'].map(filter => '<button data-filter="' + filter +
    '" aria-pressed="' + (filter === state.filter) + '">' + filter + '</button>').join('');
  view.innerHTML = hero + stats + '<div class="section-head"><div><h2>Party listings</h2><p>Choose a party to see the roster and available roles.</p></div><div class="tabs" aria-label="Filter parties">' +
    filters + '</div></div>' + (filtered.length ? '<div class="party-list">' + filtered.map(partyRow).join('') + '</div>' : empty('No parties match this view.'));
}
async function render() {
  shell();
  const board = state.board;
  const page = state.page;
  view.setAttribute('aria-busy', 'false');
  if (!board.signedIn) {
    const query = new URLSearchParams(location.search);
    const party = query.get('party');
    const message = ({ server: 'Join the configured Discord server first.', failed: 'Discord sign-in failed. Try again or contact your organizer.',
      cancelled: 'Sign-in was cancelled or expired.' })[query.get('login')];
    view.innerHTML = '<section class="hero"><div><p class="eyebrow">Albion Online</p><h1>Party Board</h1><p>Sign in with Discord to access your guild’s parties.</p>' +
      (message ? '<p class="error" role="alert">' + message + '</p>' : '') +
      '<a class="button primary" href="/auth/discord' + (party ? '?party=' + encodeURIComponent(party) : '') + '">Continue with Discord ' + icon('arrow') + '</a></div></section>';
    return;
  }
  if (page === 'board') return boardPage(board);
  if (page === 'mine') {
    const parties = board.parties.filter(mine);
    view.innerHTML = heading('My signups', 'Review your parties and claimed roles.') +
      (parties.length ? '<div class="party-list">' + parties.map(partyRow).join('') + '</div>' : empty('You haven’t signed up for a party yet.'));
  }
  if (page === 'roster') {
    const header = heading('Guild roster', 'Look up the configured guild’s in-game members.');
    view.innerHTML = header + empty('Loading Albion roster…');
    try {
      const data = await api('roster');
      if (state.page !== page) return;
      view.innerHTML = header + (!data.guild ? empty('No Albion guild is configured.') :
        '<section class="panel"><h2>' + esc(data.guild) + '</h2><p>' + data.members.length + ' characters</p>' +
        '<ul class="roster">' + data.members.map(name => '<li>' + esc(name) + '</li>').join('') + '</ul></section>');
    } catch (error) {
      if (state.page === page) view.innerHTML = header + empty(esc(error.message));
    }
  }
  if (page === 'settings') await settingsPage(board);
  if (page === 'profile') profilePage(board);
}
async function settingsPage(board) {
  const current = board.settings || {};
  const title = heading('Settings', 'Manage your Discord and Albion connections.');
  if (!board.canConfigure) {
    view.innerHTML = title + '<section class="panel"><h2>' + esc(board.server) + '</h2><p>Your Discord roles · ' +
      esc(board.roles.join(', ') || 'Member') + '</p><p>Announcement channel · ' + esc(current.channel ? '#' + current.channel : 'Setup required') +
      '</p><p>Albion guild · ' + esc(current.albionGuild?.name || 'Setup required') + '</p></section>';
    return;
  }
  view.innerHTML = title + empty('Loading Discord roles and channels…');
  try {
    const { roles, channels } = await api('options');
    if (state.page !== 'settings') return;
    const option = (item, selected, prefix = '') => '<option value="' + esc(item.id) + '"' +
      (item.id === selected ? ' selected' : '') + '>' + prefix + esc(item.name) + '</option>';
    view.innerHTML = title + '<section class="panel"><h2>' + esc(board.server) + '</h2>' +
      '<form class="form-grid" data-form="settings"><label>Discord organizer role<select name="roleId"><option value="">Server admins only</option>' +
      roles.map(role => option(role, current.roleId)).join('') + '</select></label><label>Announcement channel<select required name="channelId">' +
      '<option value="">' + (channels.length ? 'Choose a channel' : 'Give the bot permission to post in a channel') + '</option>' +
      channels.map(channel => option(channel, current.channelId, '#')).join('') +
      '</select></label><label>Albion region<select name="region">' + regionOptions(current.region) +
      '</select></label><label>Albion guild name<input name="guild" maxlength="60" value="' + esc(current.albionGuild?.name) +
      '" placeholder="Exact guild name"><span class="hint">Set a guild to enable its roster and guild-only signups.</span></label>' +
      errorLine + '<div class="actions"><button class="button primary">Save settings</button></div></form></section>';
  } catch (error) {
    if (state.page === 'settings') view.innerHTML = title + empty(esc(error.message));
  }
}
function profilePage(board) {
  const character = board.character;
  view.innerHTML = heading('Profile', 'Link an Albion character to your Discord profile.') +
    '<section class="panel"><h2>' + esc(board.profile.name) + '</h2><p>Discord roles · ' + esc(board.roles.join(', ') || 'Member') + '</p>' +
    (character ? '<p>Linked character · ' + esc(character.name) + ' · ' + esc(character.guild || 'No guild listed') + '</p>' : '') +
    '<form class="form-grid" data-form="character"><label>Albion character name<input name="name" required minlength="2" maxlength="30" value="' +
    esc(character?.name) + '" placeholder="Exact character name"></label><label>Albion region<select name="region">' +
    regionOptions(character?.region || board.settings?.region) + '</select></label>' +
    '<p class="hint">Guild checks use public character data. Character ownership is self-reported.</p>' + errorLine +
    '<div class="actions"><button class="button primary">' + (character ? 'Refresh character' : 'Link character') + '</button>' +
    (character ? button('Unlink', 'data-unlink') : '') + (board.demo ? '' : button('Sign out', 'data-logout')) + '</div></form></section>';
}
function roleEdit(name = '', count = 1) {
  return '<div class="role-edit"><label>Role name<input name="roleName" required maxlength="36" value="' + esc(name) +
    '" placeholder="e.g. Healer"></label><label>Slots<input name="roleCount" type="number" min="1" max="20" value="' + count +
    '" required></label>' + button(icon('close'), 'data-remove-role aria-label="Remove role"') + '</div>';
}
function showDialog(html) {
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function slots() {
  const inputs = Array.from(dialog.querySelectorAll('[name="roleCount"]'));
  const total = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  $('#slot-total').textContent = total + ' / 20 slots';
  const add = $('[data-add-role]', dialog);
  add.disabled = inputs.length >= 20;
}
function createParty() {
  const settings = state.board.settings;
  if (!settings) {
    go('settings');
    toast('Save a Discord announcement channel to publish parties.');
    return;
  }
  const date = new Date(Date.now() + 3600000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => byte.toString(16).padStart(2, '0')).join('');
  showDialog(layout('Create party', '<form class="dialog-body form-grid" data-form="party" data-nonce="' + nonce +
    '"><label>Party name<input name="title" required minlength="2" maxlength="80" placeholder="e.g. Avalonian Roads Roam"></label>' +
    '<div class="form-grid two"><label>Activity<select name="type">' + activities.map(activity => '<option>' + activity + '</option>').join('') +
    '</select></label><label>Start time<input name="starts" type="datetime-local" value="' + local + '" required></label></div>' +
    '<label>Meeting location<input name="zone" required maxlength="80" placeholder="e.g. Thetford Portal"></label>' +
    '<label>Party notes<textarea name="summary" maxlength="420" rows="2" placeholder="Gear, IP, or meetup details"></textarea></label>' +
    '<div><div class="role-header"><strong>Party roles <small id="slot-total"></small></strong>' +
    button(icon('plus') + ' Add role', 'data-add-role') + '</div><div id="role-rows">' + roleEdit('Tank') + roleEdit('Healer') + roleEdit('DPS', 3) + '</div></div>' +
    (settings.albionGuild ? '<label class="check"><input name="guildOnly" type="checkbox"> Require membership in ' + esc(settings.albionGuild.name) + '</label>' : '') +
    '<p class="hint">' + (state.board.demo ? 'Demo announcement for ' : 'Announces automatically in ') + '#' + esc(settings.channel) + '.</p>' +
    errorLine + '<div class="actions"><button class="button primary">Publish party</button>' + button('Cancel', 'data-close') + '</div></form>'));
  slots();
}
function showParty(id) {
  const party = state.board.parties.find(item => item.id === id);
  if (!party) return toast('This party could not be found.');
  const closed = ended(party);
  const mayManage = state.board.canManage;
  const detail = party.roles.map((role, index) => {
    const people = party.signups.filter(entry => entry.role === index);
    const mine = people.some(entry => entry.mine);
    const full = people.length >= role.count;
    const control = closed ? '' : mine ? button('Leave', 'data-action="leave"') :
      button(full ? 'Full' : 'Claim slot', 'data-action="join" data-role="' + index + '"' + (full ? ' disabled' : ''));
    return '<div class="detail-role"><div><strong>' + esc(role.name) + ' · ' + people.length + '/' + role.count +
      '</strong><small>' + (people.map(entry => esc(entry.name) + (entry.mine ? ' (you)' : '')).join(', ') || 'Available') +
      '</small></div>' + control + '</div>';
  }).join('');
  const announcement = party.announcement === 'demo' ? 'Demo announcement · #' + party.channel :
    party.announcement === 'sent' ? 'Announced in #' + party.channel :
    party.announcement === 'failed' ? 'Announcement failed · ' + party.deliveryError : 'Announcement pending · #' + party.channel;
  const retry = mayManage && !closed && ['failed', 'pending'].includes(party.announcement);
  showDialog(layout(party.title, '<div class="dialog-body" data-active-party="' + esc(party.id) + '">' +
    '<p class="eyebrow">' + esc(party.type) + '</p><p><strong>' + esc(localDate(party.starts) + ' · ' + localTime(party.starts)) +
    '</strong><br><span class="hint">' + esc(party.zone + ' · Hosted by ' + party.host) + '</span></p>' +
    (party.summary ? '<p>' + esc(party.summary) + '</p>' : '') +
    (party.guildOnly ? '<p class="hint">Guild only · ' + esc(party.guild) + '</p>' : '') +
    (closed ? '<p class="status closed">' + (party.cancelled ? 'Cancelled' : 'Signups closed') + '</p>' : '') +
    '<div class="detail-roles">' + detail + '</div><p class="hint">' + esc(announcement) + '</p>' + errorLine +
    '<div class="actions">' + (party.messageUrl ? '<a class="button outline" href="' + esc(party.messageUrl) +
    '" target="_blank" rel="noopener noreferrer">Open Discord announcement</a>' : '') +
    (retry ? button('Retry announcement', 'data-action="retry"') : '') +
    (mayManage && !closed ? button('Cancel party', 'data-action="cancel"', 'outline danger') : '') + '</div></div>'));
}
function go(page) {
  if (!state.board || !Object.hasOwn(pages, page)) return;
  state.page = page;
  void render();
}
function saveResult(party) {
  const index = state.board.parties.findIndex(item => item.id === party.id);
  if (index === -1) state.board.parties.unshift(party);
  else state.board.parties[index] = party;
}
async function formTask(form, task) {
  const error = $('.error', form);
  const controls = [...form.querySelectorAll('button:not(:disabled)')];
  controls.forEach(control => control.disabled = true);
  error.textContent = '';
  try {
    await task();
  } catch (issue) {
    error.textContent = issue.message;
  } finally {
    controls.forEach(control => control.disabled = false);
  }
}
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const data = Object.fromEntries(fields);
  void formTask(form, async () => {
    if (form.dataset.form === 'party') {
      const roles = fields.getAll('roleName').map((name, index) => ({ name, count: Number(fields.getAll('roleCount')[index]) }));
      const starts = new Date(data.starts).toISOString();
      const party = await api('party', { ...data, starts, roles, guildOnly: fields.has('guildOnly'), nonce: form.dataset.nonce });
      saveResult(party);
      state.filter = 'All parties';
      go('board');
      showParty(party.id);
      toast(party.announcement === 'failed' ? 'Party published. Discord announcement failed.' : 'Party published.');
      return;
    }
    await api(form.dataset.form, data);
    await load();
    await render();
    toast(form.dataset.form === 'settings' ? 'Settings saved.' : 'Albion character linked.');
  });
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button');
  if (!el || !state.board) return;
  if (el.hasAttribute('data-close')) return dialog.close();
  if (el.dataset.page) return go(el.dataset.page);
  if (el.matches('[data-create], .create')) return createParty();
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
    el.closest('.role-edit').remove();
    slots();
    $('[data-add-role]', dialog).focus();
  }
  if (el.hasAttribute('data-unlink') || el.hasAttribute('data-logout')) {
    const form = el.closest('form');
    await formTask(form, async () => {
      if (el.hasAttribute('data-logout')) {
        await api('logout', {});
        location.assign('/');
      } else {
        await api('character', { unlink: true });
        await load();
        await render();
        toast('Character unlinked.');
      }
    });
  }
  if (el.dataset.action) {
    const container = el.closest('[data-active-party]');
    if (el.dataset.action === 'cancel' && !window.confirm('Cancel this party and close signups?')) return;
    await formTask(container, async () => {
      const party = await api('party/action', { id: container.dataset.activeParty, action: el.dataset.action, role: Number(el.dataset.role) });
      saveResult(party);
      await render();
      showParty(party.id);
      if (el.dataset.action === 'join') toast('Slot claimed.');
      if (el.dataset.action === 'leave') toast('Slot released.');
      if (el.dataset.action === 'cancel') toast('Party cancelled.');
    });
  }
});
dialog.addEventListener('input', event => {
  if (event.target.name === 'roleCount') slots();
});
load().then(async board => {
  await render();
  const id = new URLSearchParams(location.search).get('party');
  if (id && board.signedIn) showParty(id);
}).catch(error => {
  view.setAttribute('aria-busy', 'false');
  view.innerHTML = heading('Party board unavailable', esc(error.message)) +
    '<div class="actions"><a class="button outline" href="/">Reload board</a><button type="button" class="button outline" id="reconnect">Clear session</button></div>';
  $('#reconnect').addEventListener('click', () => api('logout', {}).then(() => location.assign('/')).catch(issue => toast(issue.message)));
});
