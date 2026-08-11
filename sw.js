/* Creating Room — Service Worker
   v19以降：ページ本体（HTML）はネットワーク優先（常に最新を取得、オフライン時のみキャッシュ）。
   その他の静的ファイルはキャッシュ優先＋裏で更新（stale-while-revalidate）。 */
const CACHE = 'creating-room-v33';
const SHELL = ['./', './index.html', './manifest.webmanifest', './vendor/supabase.js', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 同一オリジンのGETのみ対象（Supabase API・認証は対象外）
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // ページ本体（ナビゲーション）＝ネットワーク優先。成功したらキャッシュも更新。
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        try {
          const res = await fetch(e.request);
          if (res && res.ok) cache.put('./index.html', res.clone());
          return res;
        } catch (_) {
          return (await cache.match('./index.html')) || (await cache.match('./'));
        }
      })
    );
    return;
  }

  // 静的ファイル＝キャッシュ優先＋裏で更新
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request).then(res => {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
