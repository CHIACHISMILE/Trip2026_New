const CACHE = "tripapp-v1.6"; // ✅ bump 版本
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest"];

const IMG_CACHE = "tripapp-img-v1"; // 圖片快取區

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k === CACHE || k === IMG_CACHE ? null : caches.delete(k)))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  const isGoogleImageHost =
    url.hostname === "drive.google.com" ||
    url.hostname.endsWith("googleusercontent.com") ||
    url.hostname.endsWith("gstatic.com");

  const isImageRequest =
    req.destination === "image" ||
    /\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i.test(url.pathname);

  // ✅ 0) Google 圖片：cache-first（離線可用），但只快取「真的圖片且成功」的回應
  if (isGoogleImageHost && isImageRequest) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(IMG_CACHE);

        // 先回快取（離線就靠它）
        const cached = await cache.match(req);
        if (cached) return cached;

        // 沒快取就抓網路
        try {
          const res = await fetch(req, { cache: "no-store" });

          // 只在成功且 content-type 是 image/* 時才寫快取
          const ct = (res.headers.get("content-type") || "").toLowerCase();
          if (res.ok && ct.startsWith("image/")) {
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          // 離線且沒快取：回傳一個空回應（讓前端 onerror 可處理）
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // ✅ 1) App Shell：stale-while-revalidate
  const isAppAsset =
    ASSETS.some((p) => url.pathname.endsWith(p.replace("./", "/"))) ||
    (url.pathname === "/" && ASSETS.includes("./"));

  if (isAppAsset) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);

        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        return cached || (await fetchPromise) || (await cache.match("./index.html"));
      })()
    );
    return;
  }

  // ✅ 2) 其他：網路優先，失敗退快取
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        return await fetch(req);
      } catch (err) {
        return (await cache.match(req)) || (await cache.match("./index.html"));
      }
    })()
  );
});
