/* 미라클 모닝 레벨업 — 서비스 워커 (v23.0)
 *
 * 원칙
 *  1) 앱 파일(같은 출처)은 network-first — 새 버전을 배포하면 항상 최신판이 뜬다.
 *     네트워크가 끊겼을 때만 캐시본으로 실행한다.
 *  2) index.html · manifest.webmanifest · version.json 같은 "버전을 알려 주는 파일"은
 *     cache: 'no-store' 로 받아 구버전 HTML 이 캐시에 남지 않게 한다.
 *  3) jsonstorage.com 등 외부 API 요청은 절대 캐시하지 않고 브라우저 네트워크로 그대로 통과시킨다.
 *     (파티/파트너 동기화가 옛 응답을 받는 일이 없도록)
 *  4) GET 이외(POST/PUT 등)는 손대지 않고 통과.
 *  5) 새 버전은 install 에서 skipWaiting, activate 에서 clients.claim + 옛 캐시 삭제로
 *     바로 활성화된다. (iOS Safari 홈 화면 PWA 포함)
 */
const VERSION = "mmm-2026-11-23-19";
const CACHE = "miracle-morning-" + VERSION;
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

// 항상 네트워크에서 새로 받아야 하는 파일 (구버전 HTML 캐시 방지)
function isFreshOnly(url) {
  return url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    url.pathname.endsWith("/version.json");
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // network-first — HTML/manifest/version.json 은 no-store 로 확실히 최신을 받는다
      const opts = { cache: isNavigation || isFreshOnly(url) ? "no-store" : "no-cache" };
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
