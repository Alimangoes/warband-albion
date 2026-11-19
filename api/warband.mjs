import { handleRequest } from '../server.mjs';

const paths = {
  home: '/',
  login: '/auth/discord',
  callback: '/auth/discord/callback',
  board: '/api/board',
  logout: '/api/logout',
  options: '/api/options',
  roster: '/api/roster',
  profile: '/api/profile',
  settings: '/api/settings',
  character: '/api/character',
  expertise: '/api/expertise',
  party: '/api/party',
  templates: '/api/templates',
  interactions: '/api/discord/interactions',
  action: '/api/party/action'
};

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/warband') {
    const route = url.searchParams.get('warbandRoute');
    if (Object.hasOwn(paths, route)) {
      url.searchParams.delete('warbandRoute');
      req.url = paths[route] + url.search;
    }
  }
  return handleRequest(req, res);
}
