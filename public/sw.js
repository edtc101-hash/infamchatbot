// 인팸 AI 챗봇 Service Worker - 오프라인 지원 + 캐싱
const CACHE_NAME = 'infam-chatbot-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/chatbot.js',
    '/infam-logo.svg',
    '/manifest.json',
];

// 설치 시 정적 자산 캐시
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 활성화 시 이전 캐시 삭제
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// 네트워크 우선, 실패 시 캐시 폴백 전략
self.addEventListener('fetch', (e) => {
    const { request } = e;

    // API 요청은 항상 네트워크
    if (request.url.includes('/api/')) {
        e.respondWith(
            fetch(request).catch(() =>
                new Response(JSON.stringify({
                    response: '현재 오프라인 상태입니다. 네트워크 연결 후 다시 시도해주세요.',
                    fromOffline: true
                }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // 정적 자산: 네트워크 우선, 실패 시 캐시
    e.respondWith(
        fetch(request)
            .then(response => {
                // 성공하면 캐시 업데이트
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
