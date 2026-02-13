const CACHE = "tripapp-v1.5"; // ✅ 記得 bump 版本，讓舊快取失效
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // ✅ 清掉舊版本快取
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;

  // 只處理 GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ 1) Google Drive / googleusercontent / gstatic：一律走網路，不快取
  //    避免把某次 403/HTML/redirect 結果 cache 成「破圖」
  const isGoogleImageHost =
    url.hostname === "drive.google.com" ||
    url.hostname.endsWith("googleusercontent.com") ||
    url.hostname.endsWith("gstatic.com");

  if (isGoogleImageHost) {
    e.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // ✅ 2) App Shell：stale-while-revalidate（秒開 + 背景更新）
  const isAppAsset = ASSETS.some((p) => url.pathname.endsWith(p.replace("./", "/")) || url.pathname === "/" && p === "./");
  if (isAppAsset) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            // 成功才寫入快取
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        // 先回 cached，沒有才等網路
        return cached || (await fetchPromise) || (await cache.match("./index.html"));
      })()
    );
    return;
  }

  // ✅ 3) 其他請求：網路優先，失敗才退快取（避免快取污染）
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        return res;
      } catch (err) {
        const cached = await cache.match(req);
        return cached || cache.match("./index.html");
      }
    })()
  );
});
