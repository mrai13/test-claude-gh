// Where the login + data API lives.
// On app.<domain> it's api.<domain>. Anywhere else (local development) it's port 3000 on the same host.
const { protocol, hostname } = location;

export const API_BASE = hostname.startsWith('app.')
  ? `${protocol}//api.${hostname.slice(4)}`
  : `${protocol}//${hostname}:3000`;
