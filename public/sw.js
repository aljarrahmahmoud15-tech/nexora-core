// Makes the site installable as an app. It caches NOTHING: every request goes to the network,
// so balances and bookings are never served from an old copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
