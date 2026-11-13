export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const regions = {
  americas: 'gameinfo.albiononline.com',
  europe: 'gameinfo-ams.albiononline.com',
  asia: 'gameinfo-sgp.albiononline.com'
};

const discordRoot = 'https://discord.com/api/v10';
export async function request(url, options = {}, service) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' });
  } catch {
    throw new Problem(502, service + ' could not be reached. Try again shortly.');
  }
  if (!response.ok) {
    if (response.status === 429) throw new Problem(429, service + ' is rate limiting requests. Try again shortly.');
    if (response.status === 404) throw new Problem(404, service + ' could not find that record.');
    if (response.status === 403) throw new Problem(403, service + ' denied access. Check the bot permissions and channel.');
    throw new Problem(502, service + ' returned an error. Check the integration configuration.');
  }
  try {
    return await response.json();
  } catch {
    throw new Problem(502, service + ' returned an unexpected response.');
  }
}

export function discord(path, auth, data) {
  return request(discordRoot + path, {
    headers: { Authorization: auth, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { method: 'POST', body: JSON.stringify(data) } : {})
  }, 'Discord');
}

export function albion(region, path) {
  if (!Object.hasOwn(regions, region)) throw new Problem(400, 'Choose an Albion region.');
  return request('https://' + regions[region] + '/api/gameinfo/' + path, {}, 'Albion');
}

export const isAdmin = (permissions) => Boolean(BigInt(permissions) & 40n);
export const canPost = (guildId, roles, member, channel) => {
  const held = roles.filter(role => role.id === guildId || member.roles.includes(role.id));
  let permissions = held.reduce((all, role) => all | BigInt(role.permissions), 0n);
  if (permissions & 8n) return true;
  const overwrites = channel.permission_overwrites || [];
  const everyone = overwrites.find(row => row.id === guildId);
  const assigned = overwrites.filter(row => row.type === 0 && member.roles.includes(row.id));
  const specific = overwrites.find(row => row.type === 1 && row.id === member.user.id);
  for (const group of [[everyone], assigned, [specific]]) {
    const allow = group.reduce((bits, row) => bits | BigInt(row?.allow || 0), 0n);
    const deny = group.reduce((bits, row) => bits | BigInt(row?.deny || 0), 0n);
    permissions = (permissions & ~deny) | allow;
  }
  return (permissions & 3072n) === 3072n;
};
