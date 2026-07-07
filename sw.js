const SW_VERSION = "20260706-v3";
const CACHE_NAME = `aps-vagas-${SW_VERSION}`;

// Arquivos HTML sempre buscados da rede (nunca do cache)
const NETWORK_FIRST = ["/", "/index.html", "/admin.html"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isHtml = event.request.mode === "navigate" ||
    NETWORK_FIRST.some((path) => url.pathname === path || url.pathname.endsWith(path));

  if (isHtml) {
    // HTML: sempre da rede, fallback para cache se offline
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // JS/CSS/imagens: cache-first, mas revalida com nova versão
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
