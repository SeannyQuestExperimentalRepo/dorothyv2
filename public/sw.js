// TrendLine Service Worker
// Cache-first for static assets, network-first for API routes

const CACHE_NAME = "trendline-v1";
const STATIC_CACHE = "trendline-static-v1";

// Static assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

// Install: precache essential assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: strategy based on request type
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API routes — network only (stale API data could mislead betting decisions)
  if (url.pathname.startsWith("/api/")) return;

  // Skip monitoring/sentry tunnel
  if (url.pathname.startsWith("/monitoring")) return;

  // Static assets (JS, CSS, images, fonts): cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages: network-first, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Fallback to cached homepage
          return caches.match("/");
        });
      })
  );
});

// Handle messages from the app
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || "TrendLine";
    const options = {
      body: data.body || "New picks are ready!",
      icon: "/icons/icon-192.svg",
      badge: "/icons/icon-192.svg",
      data: { url: data.url || "/" },
      vibrate: [100, 50, 100],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // Fallback for plain text push
    event.waitUntil(
      self.registration.showNotification("TrendLine", {
        body: event.data.text(),
        icon: "/icons/icon-192.svg",
      })
    );
  }
});

// Notification click: open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if available
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(url);
      })
  );
});
