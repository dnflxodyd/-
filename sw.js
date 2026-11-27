/* 미라클 모닝 레벨업 — 서비스 워커 (v31.6)
 *
 * 원칙
 *  1) 앱 파일(같은 출처)은 network-first — 새 버전을 배포하면 항상 최신판이 뜬다.
 *     네트워크가 끊겼을 때만 캐시본으로 실행한다.
 *     · cache:'no-cache' 로 조건부 요청(ETag)을 보내 바뀐 게 없으면 304 로 본문을 아낀다.
 *  2) index.html · manifest.webmanifest · version.json 같은 "버전을 알려 주는 파일"은
 *     항상 서버에 재확인해 구버전 HTML 이 캐시에 남지 않게 한다.
 *  3) assets/ 의 캐릭터 그림 · 썸네일 · 폰트는 내용이 바뀌지 않는 정적 파일이므로
 *     cache-first — 두 번째 실행부터는 네트워크 없이 즉시 뜬다.
 *     (파일 내용이 바뀌면 VERSION 이 올라가고 activate 에서 옛 캐시를 지운다)
 *  4) jsonstorage.com 등 외부 API 요청은 절대 캐시하지 않고 브라우저 네트워크로 그대로 통과시킨다.
 *  5) GET 이외(POST/PUT 등)는 손대지 않고 통과.
 *  6) 새 버전은 install 에서 skipWaiting, activate 에서 clients.claim + 옛 캐시 삭제로
 *     바로 활성화된다. (iOS Safari 홈 화면 PWA 포함)
 */
const VERSION = "mmm-2026-11-27-01";
const CACHE = "miracle-morning-" + VERSION;
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json",
  "./assets/Jua.woff2",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

// 내용이 변하지 않는 정적 자산 — cache-first
function isAsset(url) {
  return /\/assets\/[^/]+\.(webp|png|jpe?g|svg|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나 실패해도 설치는 계속 (설치 조건은 충족하되 코어 캐시는 최대한)
    await Promise.all(CORE.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 구버전 캐시 전부 삭제
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 페이지에서 새 버전을 바로 적용하고 싶을 때
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GET 이외 요청(동기화 POST 등)은 그대로 네트워크로
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 외부 API·CDN·확장 프로그램 등 다른 출처는 절대 캐시하지 않는다
  if (url.origin !== self.location.origin) return;
  // about:, blob:, data: 등
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  const isNavigation = req.mode === "navigate";
  const asset = isAsset(url);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // 정적 자산 — 캐시 우선 (두 번째 실행부터 즉시)
    if (asset) {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type === "basic") {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        const again = await cache.match(req, { ignoreSearch: true });
        if (again) return again;
        throw e;
      }
    }

    try {
      // network-first — HTML/manifest/version.json 은 재확인해서 항상 최신을 받는다
      const opts = { cache: "no-cache" };
      const fresh = await fetch(req, opts);
      if (fresh && fresh.ok && fresh.type === "basic") {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // 오프라인 — 캐시본, 없으면 내비게이션은 index.html
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (isNavigation) {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
