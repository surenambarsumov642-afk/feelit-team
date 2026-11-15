// Офлайн-кэш оболочки приложения + приём уведомлений. Запросы к серверу (Supabase) не кэшируются.
// Свои файлы всегда проверяются на сервере (cache: "no-cache"), поэтому обновления приходят сразу, а офлайн работает кэш.
const CACHE = "arise-v16";
const SHELL = ["./", "index.html", "styles.css", "glass.css", "app.js", "config.js", "foods.js", "skills.js", "gates.js", "exams.js", "phrases.js", "repcount.js", "pose.js", "scanner.js", "intro.js", "world.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;
  const isFont = url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com");
  if (url.origin === location.origin) {
    // сеть в приоритете и мимо HTTP-кэша браузера; кэш — если офлайн
    e.respondWith(fetch(req, { cache: "no-cache" }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else if (isFont) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r;
    })));
  }
});

/* ---------- уведомления ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "[СИСТЕМА]", {
    body: d.body || "", tag: d.tag || "arise", renotify: true,
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
