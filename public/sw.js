// LifeLoop Service Worker
const CACHE_NAME = 'lifeloop-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-caching some assets failed', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass-through API and non-GET requests directly to network
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  // Network-first for HTML pages so we always get the latest JS bundle hashes
  if (event.request.headers.get('accept')?.includes('text/html') || event.request.url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      }).catch(() => {
        return caches.match(event.request).then(cached => cached || caches.match('/'));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache static font or image assets dynamically
        if (
          response &&
          response.status === 200 &&
          (event.request.url.includes('fonts.gstatic.com') ||
           event.request.url.includes('fonts.googleapis.com') ||
           event.request.url.includes('/assets/'))
        ) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Fallback for HTML documents when offline
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/');
        }
      });
    })
  );
});

// Push notification received event listener
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'LifeLoop Reminder', body: event.data.text() };
    }
  }

  const title = data.title || 'LifeLoop Reminder';
  const options = {
    body: data.body || 'You have a reminder from LifeLoop.',
    icon: '/pwa-192x192.png',
    badge: '/icon.svg',
    data: {
      url: data.url || (data.itemId ? `/?item=${encodeURIComponent(data.itemId)}` : '/'),
      itemId: data.itemId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification clicked event listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

