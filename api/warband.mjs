import { handleRequest } from '../server.mjs';

const paths = {
  home: '/',
  login: '/auth/discord',
  callback: '/auth/discord/callback',
  board: '/api/board',
  logout: '/api/logout',
  options: '/api/options',
  roster: '/api/roster',
  settings: '/api/settings',
  character: '/api/character',
  party: '/api/party',
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
