const CACHE_NAME = '2026-trip-app-v1.21'; // 若有大改版，改這個版本號 (例如 v2) 使用者就會重新下載
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/vue@3/dist/vue.global.js',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://img.icons8.com/color/180/snowflake.png'
];

// 安裝：快取核心檔案
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 啟動：刪除舊快取
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// 攔截請求：有快取用快取，沒快取才上網
self.addEventListener('fetch', (e) => {
  // 對於 API 請求 (Google Script)，採用 "網路優先，失敗則回退" (Network First)
  if (e.request.url.includes('script.google.com')) {
    return; // API 請求交給前端 fetch 處理，這裡不快取，避免資料不同步
  }

  // 對於靜態資源 (Vue, Tailwind, HTML)，採用 "快取優先" (Cache First)
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // 動態快取其他圖片或資源
          cache.put(e.request, response.clone());
          return response;
        });
      });
    })
  );
});
