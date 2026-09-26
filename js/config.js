// Where the login + data API lives.
// The app at <name>.<domain> uses <name>-api.<domain>, e.g. lifts.example.com → lifts-api.example.com.
// On localhost or an IP address (local development) it's port 3000 on the same host.
const { protocol, hostname } = location;
const local = hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.startsWith('[');
const [name, ...rest] = hostname.split('.');

export const API_BASE = local
  ? `${protocol}//${hostname}:3000`
  : `${protocol}//${[`${name}-api`, ...rest].join('.')}`;
