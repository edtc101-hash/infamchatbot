const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { BRAND_KNOWLEDGE } = require('./knowledge-base');
const { setApiKey, buildVectorStore, ragSearch, getRAGStatus } = require('./rag/rag-pipeline');

const app = express();
const PORT = process.env.PORT || 3000;
const FAQ_FILE = path.join(__dirname, 'faq-data.json');
const LEARNED_FILE = path.join(__dirname, 'learned-data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'infam2024';

// Gemini AI 초기화 (gemini-2.5-flash 모델 사용)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// RAG 파이프라인에 API 키 설정
setApiKey(GEMINI_API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// FAQ 데이터 로드
function loadFAQData() {
    try {
        const data = fs.readFileSync(FAQ_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('FAQ 파일 로드 오류:', e);
        return [];
    }
}

// FAQ 데이터 저장
function saveFAQData(data) {
    fs.writeFileSync(FAQ_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 제품 카탈로그 데이터 로드
const PRODUCT_FILE = path.join(__dirname, 'product-data.json');
function loadProductData() {
    try {
        if (fs.existsSync(PRODUCT_FILE)) {
            const data = fs.readFileSync(PRODUCT_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('제품 데이터 로드 오류:', e);
    }
    return [];
}

// ========================
// 학습 데이터 관리
// ========================
function loadLearnedData() {
    try {
        if (fs.existsSync(LEARNED_FILE)) {
            const data = fs.readFileSync(LEARNED_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('학습 데이터 로드 오류:', e);
    }
    return [];
}

function saveLearnedData(data) {
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function findRelevantLearned(message, LEARNED_DATA) {
    const msgLower = message.toLowerCase();
    const matched = [];
    for (const item of LEARNED_DATA) {
        let score = 0;
        if (item.keywords && item.keywords.length > 0) {
            for (const kw of item.keywords) {
                if (msgLower.includes(kw.toLowerCase())) score += 3;
            }
        }
        if (item.question) {
            const qWords = item.question.toLowerCase().split(/\s+/);
            for (const w of qWords) {
                if (w.length >= 2 && msgLower.includes(w)) score += 1;
            }
        }
        if (score > 0) {
            matched.push({ ...item, score });
        }
    }
    return matched.sort((a, b) => b.score - a.score).slice(0, 5);
}

// 관리자 수정 답변 직접 매칭 (priority >= 10인 admin_correction만 대상)
function findCorrectionMatch(message, LEARNED_DATA) {
    const msgLower = message.toLowerCase().replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '');
    const msgWords = msgLower.split(/\s+/).filter(w => w.length >= 2);
    if (msgWords.length === 0) return null;

    const corrections = LEARNED_DATA.filter(d => d.source === 'admin_correction' && d.priority >= 10);

    let bestMatch = null;
    let bestScore = 0;

    for (const corr of corrections) {
        const qLower = (corr.question || '').toLowerCase().replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '');
        const qWords = qLower.split(/\s+/).filter(w => w.length >= 2);
        if (qWords.length === 0) continue;

        // 단어 겹침 계산
        const overlap = msgWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw)));
        const coverageMsg = overlap.length / msgWords.length; // 메시지 커버율
        const coverageQ = overlap.length / qWords.length;     // 질문 커버율

        // 둘 다 40% 이상 겹쳐야 매칭
        if (coverageMsg >= 0.4 && coverageQ >= 0.4) {
            const score = (coverageMsg + coverageQ) / 2;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = corr;
            }
        }
    }

    return bestMatch;
}


// 고유 ID 생성
function generateId() {
    return 'faq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

// ========================
// 대화 히스토리 세션 관리
// ========================
const sessions = {};

function getSession(sessionId) {
    if (!sessions[sessionId]) {
        sessions[sessionId] = {
            history: [],
            createdAt: Date.now(),
            lastActive: Date.now(),
            messageCount: 0
        };
    }
    sessions[sessionId].lastActive = Date.now();
    return sessions[sessionId];
}

// ========================
// 응답 캐시
// ========================
const responseCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1시간

function getCacheKey(message) {
    return message.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getFromCache(message) {
    const key = getCacheKey(message);
    const cached = responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('💾 캐시 히트:', message.substring(0, 30));
        return cached;
    }
    return null;
}

function setCache(message, response, matchedFAQs) {
    const key = getCacheKey(message);
    responseCache.set(key, { response, matchedFAQs, timestamp: Date.now() });
    if (responseCache.size > 200) {
        const firstKey = responseCache.keys().next().value;
        responseCache.delete(firstKey);
    }
}

// ========================
// 직접 링크 스마트 폴백
// ========================
const GUIDE_LINKS = {
    'WPC': { name: 'WPC 월패널 시공 가이드', url: 'https://www.figma.com/deck/g3bpHP7liUM8SqVMdRF7TG/WPC-%EC%9B%94%ED%8C%A8%EB%84%90-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=GSiwjmAWARU5gOKF-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '월패널': { name: 'WPC 월패널 시공 가이드', url: 'https://www.figma.com/deck/g3bpHP7liUM8SqVMdRF7TG/WPC-%EC%9B%94%ED%8C%A8%EB%84%90-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=GSiwjmAWARU5gOKF-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '소프트': { name: '소프트 스톤 시공 가이드', url: 'https://www.figma.com/deck/aWxDw4xzjjkXugo1xGr27n/%EC%86%8C%ED%94%84%ED%8A%B8-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=HyB42bYAVeIbnNJW-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '카빙': { name: '카빙 스톤 시공 가이드', url: 'https://www.figma.com/deck/eu75cWR555KYE8zjcUwEX4/%EC%B9%B4%EB%B9%99-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=URjzXMQwVpsmjq7w-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '스텐': { name: '스텐 플레이트 시공 가이드', url: 'https://www.figma.com/deck/WrQ9wtjUov9uouEKdZfhuc/%EC%8A%A4%ED%85%90-%ED%94%8C%EB%A0%88%EC%9D%B4%ED%8A%B8-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34' },
    '크리스탈': { name: '크리스탈 블럭 시공 가이드', url: 'https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '유리블럭': { name: '크리스탈/유리 블럭 시공 가이드', url: 'https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
    '시멘트': { name: '시멘트 블럭 시공 가이드', url: 'https://www.figma.com/deck/0FFb3IQ7NhDg3kcfQKp4AV/%EC%8B%9C%EB%A9%98%ED%8A%B8-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=kj8AeRSAiO1tKyF1-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1' },
};

const SERVICE_LINKS = {
    '재고': { name: '재고 현황표 (당일 배송 확인)', url: 'https://drive.google.com/drive/folders/1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d' },
    '샘플': { name: '샘플 구매 바로가기', url: 'https://edtc101.cafe24.com/skin-skin16/index.html' },
    '쇼룸': { name: '쇼룸 위치 (네이버 지도)', url: 'https://naver.me/G1wCKANl' },
    '지도': { name: '쇼룸 위치 (네이버 지도)', url: 'https://naver.me/G1wCKANl' },
    '시공 사례': { name: '시공 사례 갤러리', url: 'https://www.notion.so/edtc/f71f248770b5409ba158a210ab71db7d?v=600a30831a484786b25e4f55293ff749' },
    '유튜브': { name: '인팸 유튜브 채널', url: 'https://www.youtube.com/@interior__family' },
    '카탈로그': { name: '전체 카탈로그 모음', url: 'https://link.inpock.co.kr/interiorfamily' },
};

const CATALOG_LINKS = {
    '인팸 월패널': { name: '인팸 월패널 카탈로그', url: 'https://drive.google.com/file/d/1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR/view' },
    'wpc': { name: 'WPC 월패널 카탈로그', url: 'https://drive.google.com/drive/u/4/folders/17BugkibGu-LGP-norCf4X3X_EQfY0d1w' },
    '카빙': { name: '카빙 스톤 카탈로그', url: 'https://drive.google.com/file/d/1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ/view' },
    '소프트': { name: '소프트 스톤 카탈로그', url: 'https://drive.google.com/file/d/1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT/view' },
    '라이트': { name: '라이트 스톤 카탈로그', url: 'https://drive.google.com/file/d/1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj/view' },
    '인팸스톤': { name: '인팸 스톤 카탈로그', url: 'https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view' },
    '인팸 스톤': { name: '인팸 스톤 카탈로그', url: 'https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view' },
    '스텐': { name: '스텐 플레이트 카탈로그', url: 'https://drive.google.com/file/d/14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG/view' },
    '크리스탈': { name: '크리스탈 블럭 카탈로그', url: 'https://drive.google.com/file/d/1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D/view' },
    '아이스': { name: '아이스 플레이트 카탈로그', url: 'https://drive.google.com/file/d/1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew/view' },
    '아크릴': { name: '아크릴 플레이트 카탈로그', url: 'https://drive.google.com/file/d/1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG/view' },
    '시멘트 블럭': { name: '시멘트 블럭 카탈로그', url: 'https://drive.google.com/file/d/1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6/view' },
    '스타': { name: '스타 스톤 카탈로그', url: 'https://drive.google.com/file/d/1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO/view' },
    '하드': { name: '하드 스톤 카탈로그', url: 'https://drive.google.com/file/d/1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP/view' },
    '노이즈': { name: '노이즈 템바보드 카탈로그', url: 'https://drive.google.com/file/d/1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q/view' },
    '브릭': { name: '브릭 스톤 카탈로그', url: 'https://drive.google.com/file/d/1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk/view' },
    '플로우': { name: '플로우 메탈 카탈로그', url: 'https://drive.google.com/file/d/18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH/view' },
    '3d': { name: '3D 블럭 카탈로그', url: 'https://drive.google.com/file/d/17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp/view' },
    '오로라': { name: '오로라 스톤 카탈로그', url: 'https://drive.google.com/file/d/1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK/view' },
    '오브제': { name: '오브제 프레임 카탈로그', url: 'https://drive.google.com/file/d/1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl/view' },
    '시멘트 플레이트': { name: '시멘트 플레이트 카탈로그', url: 'https://drive.google.com/file/d/1sj-SvwSxeae4E5l9gtaqCXxJIMWgcsmK/view' },
    '템바보드': { name: '템바보드 카탈로그', url: 'https://drive.google.com/file/d/10vJKO1wZaOOUVoJBwNfjHgED_at_XEME/view' },
    '재료': { name: '재료 분리대 카탈로그', url: 'https://drive.google.com/file/d/1zY1a-SGfIaFtZzfefy7-zE2x7D4nRWRf/view' }
};

function findDirectLinks(message) {
    const msg = message.toLowerCase();
    const links = [];
    const seen = new Set();

    const isInstall = msg.includes('시공') || msg.includes('설치') || msg.includes('방법') || msg.includes('가이드') || msg.includes('시방');
    if (isInstall) {
        for (const [kw, info] of Object.entries(GUIDE_LINKS)) {
            if (msg.includes(kw.toLowerCase()) && !seen.has(info.url)) {
                links.push(info);
                seen.add(info.url);
            }
        }
    }

    for (const [kw, info] of Object.entries(SERVICE_LINKS)) {
        if (msg.includes(kw) && !seen.has(info.url)) {
            links.push(info);
            seen.add(info.url);
        }
    }

    const isCatalogSearch = msg.includes('제품번호') || msg.includes('디자인') || msg.includes('규격') || msg.includes('가격') || msg.includes('카탈로그') || msg.includes('종류') || msg.includes('스펙');
    if (isCatalogSearch) {
        for (const [kw, info] of Object.entries(CATALOG_LINKS)) {
            if (msg.includes(kw.toLowerCase()) && !seen.has(info.url)) {
                links.push(info);
                seen.add(info.url);
            }
        }
    }

    return links;
}

// ========================
// 향상된 FAQ 키워드 매칭
// ========================
function findRelevantFAQs(message, FAQ_DATA) {
    const msgLower = message.toLowerCase();
    const msgTokens = msgLower.split(/\s+/);

    const scored = FAQ_DATA.map(faq => {
        let score = 0;

        // 키워드 매칭 (가중치 2)
        (faq.keywords || []).forEach(keyword => {
            const kwLower = keyword.toLowerCase();
            if (msgLower.includes(kwLower)) {
                score += 2;
                // 정확한 단어 매칭 보너스
                if (msgTokens.includes(kwLower)) score += 1;
            }
        });

        // 질문 텍스트 부분 매칭
        const qTokens = faq.question.toLowerCase().split(/\s+/);
        qTokens.forEach(token => {
            if (token.length >= 2 && msgLower.includes(token)) score += 0.5;
        });

        // 카테고리 매칭 보너스
        const categoryKeywords = {
            '제품': ['제품', '종류', '스펙', '가격', '샘플', '커스터마이징', '외장', '곡면', '재고'],
            '시공': ['시공', '설치', '방법', '가이드', '크랙', '보수', 'DIY'],
            '배송': ['배송', '배달', '운송', '택배', '당일', '전국', '배송비'],
            '결제': ['결제', '카드', '현금', '계좌', '세금계산서', '영수증'],
            '쇼룸': ['쇼룸', '방문', '위치', '주소', '대전']
        };

        if (categoryKeywords[faq.category]) {
            categoryKeywords[faq.category].forEach(ck => {
                if (msgLower.includes(ck)) score += 0.3;
            });
        }

        return { ...faq, score };
    });

    return scored.filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}

// 특정 제품번호 등 매칭 (공백/대시/슬래시 정규화)
function normalizeId(str) {
    return str.toLowerCase().replace(/[\s\-\/]+/g, '');
}

function findRelevantProducts(message, PRODUCT_DATA) {
    const msgLower = message.toLowerCase();
    const msgNorm = normalizeId(message);
    const matched = new Set();

    // 카테고리 키워드 매핑 (한국어 → 카테고리명)
    const categoryKeywords = {
        '소프트스톤': ['소프트스톤', '소프트 스톤', 'softstone', 'soft stone', '소프트'],
        '카빙스톤': ['카빙스톤', '카빙 스톤', 'carvingstone', 'carving stone', '카빙'],
        '라이트스톤': ['라이트스톤', '라이트 스톤', 'lightstone', '라이트'],
        '인팸스톤': ['인팸스톤', '인팸 스톤', 'infamstone', '인팸석'],
        '스텐 플레이트': ['스텐플레이트', '스텐 플레이트', 'stainless', 'stain plate', '스텐'],
        '크리스탈블럭': ['크리스탈블럭', '크리스탈 블럭', '크리스탈블록', 'crystal block', '크리스탈'],
        '아이스플레이트': ['아이스플레이트', '아이스 플레이트', 'ice plate', '아이스'],
        '아크릴 플레이트': ['아크릴플레이트', '아크릴 플레이트', 'acrylic plate', '아크릴'],
        '시멘트 블럭': ['시멘트블럭', '시멘트 블럭', '시멘트블록', 'cement block', '시멘트블'],
        '시멘트 플레이트': ['시멘트플레이트', '시멘트 플레이트', 'cement plate'],
        '스타스톤': ['스타스톤', '스타 스톤', 'starstone', 'star stone'],
        '하드스톤': ['하드스톤', '하드 스톤', 'hardstone', 'hard stone', '하드'],
        '노이즈 템바보드': ['노이즈템바', '노이즈 템바', 'noise temba', '노이즈'],
        '브릭스톤': ['브릭스톤', '브릭 스톤', 'brickstone', 'brick stone', '브릭'],
        '플로우메탈': ['플로우메탈', '플로우 메탈', 'flow metal', '플로우'],
        '3D 블럭': ['3d블럭', '3d 블럭', '3d블록', '3d block', '3d'],
        '오로라스톤': ['오로라스톤', '오로라 스톤', 'aurora stone', '오로라'],
        '오브제 프레임': ['오브제프레임', '오브제 프레임', 'objet frame', '오브제'],
        '템바보드': ['템바보드', '템바 보드', 'temba board', '템바'],
        '재료 분리대': ['분리대', '재료분리대', '재료 분리대'],
        '인팸 월패널': ['월패널', '인팸월패널', '인팸 월패널', 'wall panel', 'wpc']
    };

    // 1) 제품번호 정확 매칭 (정규화 후 비교)
    const seenIds = new Set();
    for (const p of PRODUCT_DATA) {
        const pIdNorm = normalizeId(p.productId);
        if (pIdNorm && pIdNorm.length >= 2 && msgNorm.includes(pIdNorm)) {
            matched.add(p);
            seenIds.add(pIdNorm);
        }
    }

    // 2) 역방향: 정규화된 제품번호가 메시지의 부분인지 체크
    //    (예: 사용자 "ss14" → 정규화 "ss14", 제품 "SS 14 / TYPE A" → "ss14typea" → includes "ss14")
    if (matched.size === 0) {
        for (const p of PRODUCT_DATA) {
            const pIdNorm = normalizeId(p.productId);
            // 제품ID의 앞부분이 사용자 입력에 포함되는지
            const pIdBase = pIdNorm.replace(/(type[a-z]?)$/i, '').trim();
            if (pIdBase && pIdBase.length >= 3 && msgNorm.includes(pIdBase)) {
                matched.add(p);
            }
        }
    }

    // 3) 카테고리 키워드 매칭 (제품번호 매칭이 없을 때만)
    if (matched.size === 0) {
        for (const [cat, keywords] of Object.entries(categoryKeywords)) {
            const catMatched = keywords.some(kw => msgLower.includes(kw.toLowerCase()));
            if (catMatched) {
                // 해당 카테고리의 제품 중 unique한 제품번호만 추출 (대표 한 개씩)
                const catProducts = PRODUCT_DATA.filter(p => p.category === cat);
                const uniqueIds = new Map();
                for (const p of catProducts) {
                    if (!uniqueIds.has(p.productId)) {
                        uniqueIds.set(p.productId, p);
                    }
                }
                for (const p of uniqueIds.values()) {
                    matched.add(p);
                }
            }
        }
    }

    return Array.from(matched).slice(0, 20);
}

// AI 없이 지식 베이스만으로 풍부한 답변
function buildSmartFallback(message, faqs) {
    const msg = message.toLowerCase();
    const directLinks = findDirectLinks(message);

    let baseAnswer = '';
    if (faqs.length > 0) {
        baseAnswer = faqs[0].answer;
        if (faqs.length > 1) {
            baseAnswer += '\n\n---\n\n📌 **추가 관련 정보:**\n' + faqs.slice(1, 3).map(f => `• ${f.question}: ${f.answer.substring(0, 80)}...`).join('\n');
        }
    } else {
        if (msg.includes('시공') || msg.includes('설치') || msg.includes('방법') || msg.includes('가이드')) {
            baseAnswer = '인팸은 제품별 전용 시공 가이드를 제공합니다! 아래에서 원하시는 제품의 시공 가이드를 바로 확인하실 수 있습니다.\n\n추가 문의: 010-6802-9124 (김동현 팀장)';
        } else if (msg.includes('재고') || msg.includes('당일')) {
            baseAnswer = '어떤 제품의 재고를 확인하고 싶으신가요? 아래에서 원하시는 제품의 카탈로그를 확인해 주세요!\n\n**월패널/패널류**\n- 인팸 월패널: https://drive.google.com/file/d/1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR/view\n- WPC/SPC 월패널: https://drive.google.com/drive/folders/17BugkibGu-LGP-norCf4X3X_EQfY0d1w\n\n**스톤류**\n- 카빙 스톤: https://drive.google.com/file/d/1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ/view\n- 소프트 스톤: https://drive.google.com/file/d/1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT/view\n- 라이트 스톤: https://drive.google.com/file/d/1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj/view\n- 인팸 스톤: https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view\n- 스타 스톤: https://drive.google.com/file/d/1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO/view\n- 하드 스톤: https://drive.google.com/file/d/1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP/view\n- 브릭 스톤: https://drive.google.com/file/d/1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk/view\n- 오로라 스톤: https://drive.google.com/file/d/1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK/view\n\n**플레이트/블럭류**\n- 스텐 플레이트: https://drive.google.com/file/d/14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG/view\n- 크리스탈 블럭: https://drive.google.com/file/d/1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D/view\n- 시멘트 블럭: https://drive.google.com/file/d/1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6/view\n- 아이스 플레이트: https://drive.google.com/file/d/1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew/view\n- 아크릴 플레이트: https://drive.google.com/file/d/1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG/view\n- 3D 블럭: https://drive.google.com/file/d/17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp/view\n\n**기타**\n- 노이즈 템바보드: https://drive.google.com/file/d/1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q/view\n- 플로우 메탈: https://drive.google.com/file/d/18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH/view\n- 오브제 프레임: https://drive.google.com/file/d/1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl/view\n\n제품명을 알려주시면 더 정확한 재고 정보를 안내해 드리겠습니다!';
        } else if (msg.includes('샘플')) {
            baseAnswer = '네! 샘플 구매가 가능합니다. 실물을 직접 확인하고 주문하실 수 있어요 😊';
        } else if (msg.includes('가격') || msg.includes('스펙') || msg.includes('카탈로그')) {
            baseAnswer = '인팸의 제품 종류가 1,000가지가 넘어 카탈로그를 통해 확인하시는 것이 가장 정확합니다! 📋';
        } else if (msg.includes('쇼룸') || msg.includes('위치') || msg.includes('주소')) {
            baseAnswer = '인팸 쇼룸은 **대전 유성구 학하동**에 위치해 있습니다. 방문 전 담당자에게 미리 연락해 주세요! 📍';
        } else {
            baseAnswer = '문의해 주셔서 감사합니다! 더 정확한 안내를 위해 담당자에게 직접 연락해 주시면 빠르게 도와드리겠습니다.\n\n김동현 팀장: 010-6802-9124\n이반석 프로: 010-7310-9124\n이종찬 팀장: 010-7453-9124';
        }
    }

    if (directLinks.length > 0) {
        const linkText = directLinks.map(l => `🔗 ${l.url}`).join('\n');
        return baseAnswer + '\n\n' + linkText;
    }

    return baseAnswer;
}

// ========================
// 채팅 API
// ========================
app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: '메시지를 입력해주세요.' });

    const session = getSession(sessionId);
    session.messageCount++;

    const FAQ_DATA = loadFAQData().filter(f => f.enabled !== false);
    const relevantFAQs = findRelevantFAQs(message, FAQ_DATA);
    const matchedFAQsForClient = relevantFAQs.slice(0, 3).map(f => ({
        question: f.question,
        category: f.category,
        score: f.score
    }));

    const PRODUCT_DATA = loadProductData();
    const relevantProducts = findRelevantProducts(message, PRODUCT_DATA);

    // RAG 벡터 검색 (의미 기반)
    let ragResults = [];
    try {
        ragResults = await ragSearch(message, 3);
    } catch (ragErr) {
        console.log('RAG 검색 스킵:', ragErr.message);
    }

    // 0. 관리자 수정 답변 직접 매칭 (AI 거치지 않고 그대로 반환)
    const LEARNED_DATA = loadLearnedData();
    const correctionMatch = findCorrectionMatch(message, LEARNED_DATA);
    if (correctionMatch) {
        console.log(`✏️ 관리자 수정 답변 직접 반환: "${message.substring(0, 30)}..."`);
        setCache(message, correctionMatch.answer, matchedFAQsForClient);
        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'model', content: correctionMatch.answer });
        return res.json({
            response: correctionMatch.answer,
            matchedFAQs: matchedFAQsForClient,
            ragSources: [],
            fromCorrection: true
        });
    }

    // 1. 캐시 확인
    const cached = getFromCache(message);
    if (cached) {
        return res.json({
            response: cached.response,
            fromCache: true,
            matchedFAQs: cached.matchedFAQs || matchedFAQsForClient
        });
    }

    // 2. AI 호출 (대화 히스토리 포함)
    const historyContext = session.history.length > 0
        ? `\n\n=== 이전 대화 맥락 (최근 ${Math.min(session.history.length, 10)}개) ===\n` +
        session.history.slice(-10).map(h => `${h.role === 'user' ? '고객' : '어시스턴트'}: ${h.content.substring(0, 100)}`).join('\n')
        : '';

    const systemPrompt = `${BRAND_KNOWLEDGE}

${relevantFAQs.length > 0 ? `=== 관련 FAQ 정보 (키워드 매칭됨) ===\n${relevantFAQs.map(faq => `[카테고리: ${faq.category}] Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}` : ''}

${relevantProducts.length > 0 ? `=== 관련 제품 카탈로그 정보 (제품번호 매칭됨) ===\n${relevantProducts.map(p => `[카테고리: ${p.category}] 제품번호: ${p.productId}, 디자인: ${p.design}, 규격: ${p.spec}, 가격: ${p.price}`).join('\n')}` : ''}

${ragResults.length > 0 ? `=== RAG 의미 검색 결과 (벡터 유사도 기반) ===\n${ragResults.map(r => `[유사도: ${r.score.toFixed(2)}] ${r.content}`).join('\n\n')}` : ''}

${historyContext}

${(() => {
            const relevantLearned = findRelevantLearned(message, LEARNED_DATA);
            return relevantLearned.length > 0 ? `=== 관리자가 직접 학습시킨 지식 (가장 우선! 이 답변을 그대로 사용하세요) ===\n${relevantLearned.map(l => `[${l.category}] Q: ${l.question}\nA: ${l.answer}`).join('\n\n')}` : '';
        })()}

=== 응답 지침 (매우 중요) ===
1. 항상 한국어로 답변하세요.
2. 인팸 제품과 서비스에 대한 질문에만 답변하세요.
3. 위의 FAQ 정보가 있으면 그것을 기반으로 답변하되, 더 자연스럽게 재구성하세요.
4. 모르는 정보는 솔직하게 답하고 담당자 연락처를 안내하세요.
5. 이모티콘(이모지)은 절대 사용하지 마세요. 모든 이모지 금지!
6. 답변은 간결하고 명확하게 해주세요.
7. 이전 대화 맥락이 있으면 참고하되, 현재 질문에 집중하세요.
8. 첫 문장에 "고객님, ~이 궁금하시군요!", "~에 대해 알려드릴게요!" 같은 앵무새식 인사말은 절대 하지 마세요. 바로 본론으로 들어가세요.
9. 자연스럽고 전문적인 톤으로 답변하세요. 과도하게 친절하거나 로봇처럼 느껴지는 표현은 피하세요.

=== 구체화 질문 (Narrowing Down) 지침 (가장 중요) ===
- 고객이 "얼마야?", "규격이 어떻게 돼?", "제품 설명해줘" 등 단순히 가격이나 스펙을 묻는 추상적인 질문을 할 경우, **반드시 구체적인 제품 카테고리나 제품번호(예: 703)를 알려달라고 정중하게 되물어보세요!** 
- (예: "어떤 제품의 가격이 궁금하신가요? 제품 카테고리(예: WPC 월패널)나 제품번호(예: 703)를 알려주시면 상세 스펙과 가격을 안내해 드리겠습니다.")
- 만약 위 "관련 제품 카탈로그 정보"에 구체적인 제품 데이터가 제공되었다면, 그 제품의 디자인, 규격, 가격 정보를 바탕으로 정확하게 답변해 주세요!

=== 링크 제공 규칙 (가장 중요!) ===
고객이 아래 주제를 언급하면 반드시 해당 직접 링크를 답변에 포함하세요.

[시공 가이드 질문 시]
- WPC 월패널 시공 → https://www.figma.com/deck/g3bpHP7liUM8SqVMdRF7TG/WPC-%EC%9B%94%ED%8C%A8%EB%84%90-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=GSiwjmAWARU5gOKF-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 소프트 스톤 시공 → https://www.figma.com/deck/aWxDw4xzjjkXugo1xGr27n/%EC%86%8C%ED%94%84%ED%8A%B8-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=HyB42bYAVeIbnNJW-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 카빙 스톤 시공 → https://www.figma.com/deck/eu75cWR555KYE8zjcUwEX4/%EC%B9%B4%EB%B9%99-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=URjzXMQwVpsmjq7w-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 스텐 플레이트 시공 → https://www.figma.com/deck/WrQ9wtjUov9uouEKdZfhuc/%EC%8A%A4%ED%85%90-%ED%94%8C%EB%A0%88%EC%9D%B4%ED%8A%B8-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34
- 크리스탈 블럭/유리 블럭 시공 → https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 시멘트 블럭 시공 → https://www.figma.com/deck/0FFb3IQ7NhDg3kcfQKp4AV/%EC%8B%9C%EB%A9%98%ED%8A%B8-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=kj8AeRSAiO1tKyF1-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1

[제품 카탈로그 (제품번호, 디자인, 규격, 가격 등 제품 세부정보 요청 시 해당 제품 링크 제공)]
- 인팸 월패널 → https://drive.google.com/file/d/1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR/view
- WPC 월패널 → https://drive.google.com/drive/u/4/folders/17BugkibGu-LGP-norCf4X3X_EQfY0d1w
- 카빙 스톤 → https://drive.google.com/file/d/1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ/view
- 소프트 스톤 → https://drive.google.com/file/d/1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT/view
- 라이트 스톤 → https://drive.google.com/file/d/1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj/view
- 인팸 스톤 → https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view
- 스텐 플레이트 → https://drive.google.com/file/d/14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG/view
- 크리스탈 블럭 → https://drive.google.com/file/d/1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D/view
- 아이스 플레이트 → https://drive.google.com/file/d/1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew/view
- 아크릴 플레이트 → https://drive.google.com/file/d/1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG/view
- 시멘트 블럭 → https://drive.google.com/file/d/1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6/view
- 스타 스톤 → https://drive.google.com/file/d/1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO/view
- 하드 스톤 → https://drive.google.com/file/d/1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP/view
- 노이즈 템바보드 → https://drive.google.com/file/d/1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q/view
- 브릭 스톤 → https://drive.google.com/file/d/1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk/view
- 플로우 메탈 → https://drive.google.com/file/d/18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH/view
- 3D 블럭 → https://drive.google.com/file/d/17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp/view
- 오로라 스톤 → https://drive.google.com/file/d/1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK/view
- 오브제 프레임 → https://drive.google.com/file/d/1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl/view
- 시멘트 플레이트 → https://drive.google.com/file/d/1sj-SvwSxeae4E5l9gtaqCXxJIMWgcsmK/view
- 템바보드 → https://drive.google.com/file/d/10vJKO1wZaOOUVoJBwNfjHgED_at_XEME/view
- 재료 분리대 → https://drive.google.com/file/d/1zY1a-SGfIaFtZzfefy7-zE2x7D4nRWRf/view

[재고/배송] 재고 현황표: https://drive.google.com/drive/folders/1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d
[샘플 구매] https://edtc101.cafe24.com/skin-skin16/index.html
[쇼룸/위치] 네이버 지도: https://naver.me/G1wCKANl
[시공 사례] https://www.notion.so/edtc/f71f248770b5409ba158a210ab71db7d?v=600a30831a484786b25e4f55293ff749
[유튜브] https://www.youtube.com/@interior__family

중요: 링크를 제공할 때는 🔗 이모티콘을 앞에 붙여주세요.

고객 질문: ${message}`;

    let aiResponse = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const chat = model.startChat({
                history: session.history.slice(-10).map(h => ({
                    role: h.role, parts: [{ text: h.content }]
                })),
                generationConfig: { maxOutputTokens: 1200, temperature: 0.7 }
            });
            const result = await chat.sendMessage(systemPrompt);
            aiResponse = result.response.text();
            console.log(`✅ AI 응답 성공 (시도 ${attempt})`);
            break;
        } catch (err) {
            const isQuota = err.status === 429;
            const isNotFound = err.status === 404;
            console.log(`AI 시도 ${attempt} 실패 (${err.status}):`, isQuota ? '할당량 초과' : isNotFound ? '모델 없음' : err.message);
            if (isNotFound || attempt === 2) break;
            if (isQuota) await new Promise(r => setTimeout(r, 2000));
        }
    }

    // AI 응답 성공
    if (aiResponse) {
        setCache(message, aiResponse, matchedFAQsForClient);
        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'model', content: aiResponse });
        if (session.history.length > 20) session.history = session.history.slice(-20);
        return res.json({
            response: aiResponse,
            matchedFAQs: matchedFAQsForClient,
            ragSources: ragResults.length > 0 ? ragResults.map(r => ({ title: r.title, score: r.score.toFixed(2), category: r.category })) : []
        });
    }

    // 스마트 폴백
    console.log('📚 스마트 폴백 사용');
    const fallbackResponse = buildSmartFallback(message, relevantFAQs);
    setCache(message, fallbackResponse, matchedFAQsForClient);
    res.json({
        response: fallbackResponse,
        fromFallback: true,
        matchedFAQs: matchedFAQsForClient
    });
});

// ========================
// 관리자 인증 API
// ========================
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: Buffer.from(ADMIN_PASSWORD + ':' + Date.now()).toString('base64') });
    } else {
        res.status(401).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
    }
});

function adminAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: '인증이 필요합니다.' });
    const decoded = Buffer.from(auth.replace('Bearer ', ''), 'base64').toString();
    if (decoded.startsWith(ADMIN_PASSWORD + ':')) {
        next();
    } else {
        res.status(401).json({ error: '인증이 유효하지 않습니다.' });
    }
}

// ========================
// FAQ CRUD API
// ========================
app.get('/api/admin/faq', adminAuth, (req, res) => {
    const { category, search } = req.query;
    let data = loadFAQData();
    if (category && category !== 'all') data = data.filter(f => f.category === category);
    if (search) {
        const s = search.toLowerCase();
        data = data.filter(f => f.question.toLowerCase().includes(s) || f.answer.toLowerCase().includes(s));
    }
    res.json({ data, total: data.length, categories: ['제품', '시공', '배송', '결제', '쇼룸'] });
});

app.get('/api/admin/faq/:id', adminAuth, (req, res) => {
    const data = loadFAQData();
    const item = data.find(f => f.id === req.params.id);
    if (!item) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json(item);
});

app.post('/api/admin/faq', adminAuth, (req, res) => {
    const { category, question, keywords, answer, enabled } = req.body;
    if (!category || !question || !answer) {
        return res.status(400).json({ error: '카테고리, 질문, 답변은 필수입니다.' });
    }
    const data = loadFAQData();
    const newItem = {
        id: generateId(), category,
        question: question.trim(),
        keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []),
        answer: answer.trim(),
        enabled: enabled !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    data.push(newItem);
    saveFAQData(data);
    res.json({ success: true, item: newItem });
});

app.put('/api/admin/faq/:id', adminAuth, (req, res) => {
    const data = loadFAQData();
    const idx = data.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    const { category, question, keywords, answer, enabled } = req.body;
    data[idx] = {
        ...data[idx],
        ...(category && { category }),
        ...(question && { question: question.trim() }),
        ...(keywords !== undefined && { keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()).filter(Boolean) }),
        ...(answer && { answer: answer.trim() }),
        ...(enabled !== undefined && { enabled }),
        updatedAt: new Date().toISOString()
    };
    saveFAQData(data);
    res.json({ success: true, item: data[idx] });
});

app.delete('/api/admin/faq/:id', adminAuth, (req, res) => {
    const data = loadFAQData();
    const idx = data.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    data.splice(idx, 1);
    saveFAQData(data);
    res.json({ success: true });
});

app.patch('/api/admin/faq/:id/toggle', adminAuth, (req, res) => {
    const data = loadFAQData();
    const idx = data.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    data[idx].enabled = !data[idx].enabled;
    data[idx].updatedAt = new Date().toISOString();
    saveFAQData(data);
    res.json({ success: true, enabled: data[idx].enabled });
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
    const data = loadFAQData();
    const categories = {};
    data.forEach(f => { categories[f.category] = (categories[f.category] || 0) + 1; });
    res.json({
        total: data.length,
        enabled: data.filter(f => f.enabled !== false).length,
        disabled: data.filter(f => f.enabled === false).length,
        categories,
        lastUpdated: data.reduce((latest, f) => f.updatedAt > latest ? f.updatedAt : latest, '')
    });
});

app.get('/api/faq', (req, res) => {
    const { category } = req.query;
    let data = loadFAQData().filter(f => f.enabled !== false);
    if (category) data = data.filter(f => f.category === category);
    res.json(data);
});

// ========================
// 학습 API (Self-Learning)
// ========================

// 관리자가 AI에게 가르치기 (대화 기반 자동 학습)
const learnSessions = {};

app.post('/api/admin/learn', adminAuth, async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: '메시지를 입력해주세요.' });

    // 학습 세션 관리
    if (!learnSessions[sessionId]) {
        learnSessions[sessionId] = { history: [] };
    }
    const session = learnSessions[sessionId];
    session.history.push({ role: 'user', content: message });

    try {
        const historyStr = session.history.slice(-10).map(h =>
            `${h.role === 'user' ? '관리자' : 'AI'}: ${h.content}`
        ).join('\n');

        const learnPrompt = `너는 인팸(InteriorFamily) 벽장재 전문 회사의 AI 어시스턴트야.
관리자가 너에게 새로운 지식을 가르치고 있어. 대화를 분석해서 두 가지를 해야 해:

1. 관리자에게 자연스럽게 한국어로 응답 (배운 내용을 확인하거나 추가 질문)
2. 학습할 가치가 있는 지식이 있다면, 반드시 응답 마지막에 다음 형식으로 추출:

---LEARNED---
[{"category":"시공 문제","question":"질문 형태","answer":"답변","keywords":["키워드1","키워드2"]}]
---END---

카테고리 종류: 시공 문제, 시공 팁, 제품 특성, 유지보수, 클레임 대응, 시공 주의사항, 기타

학습할 가치가 없는 일반 대화(인사, 감사 등)에는 ---LEARNED--- 블록을 넣지 마.
학습 내용은 반드시 인팸 제품/서비스와 관련된 실무 지식이어야 해.

=== 이전 대화 ===
${historyStr}

관리자의 최신 메시지에 응답해줘.`;

        const result = await model.generateContent(learnPrompt);
        let aiResponse = result.response.text();

        // 학습 데이터 추출
        let learnedItems = [];
        const learnMatch = aiResponse.match(/---LEARNED---(.*?)---END---/s);
        if (learnMatch) {
            try {
                let jsonStr = learnMatch[1].trim();
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
                }
                learnedItems = JSON.parse(jsonStr);

                // 학습 데이터 저장
                const existingData = loadLearnedData();
                for (const item of learnedItems) {
                    existingData.push({
                        id: 'learn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                        category: item.category || '기타',
                        question: item.question,
                        answer: item.answer,
                        keywords: item.keywords || [],
                        source: 'admin_teach',
                        learnedAt: new Date().toISOString()
                    });
                }
                saveLearnedData(existingData);
                console.log(`🧠 새로운 지식 ${learnedItems.length}건 학습 완료!`);
            } catch (parseErr) {
                console.error('학습 데이터 파싱 오류:', parseErr);
            }

            // 응답에서 학습 블록 제거
            aiResponse = aiResponse.replace(/---LEARNED---.*?---END---/s, '').trim();
        }

        session.history.push({ role: 'assistant', content: aiResponse });

        res.json({
            response: aiResponse,
            learnedCount: learnedItems.length,
            learnedItems: learnedItems.map(i => i.question)
        });
    } catch (error) {
        console.error('학습 AI 호출 오류:', error);
        res.status(500).json({ error: 'AI 호출에 실패했습니다.', detail: error.message });
    }
});

// 고객 대화 업로드 → AI 자동 학습
app.post('/api/admin/learn-conversation', adminAuth, async (req, res) => {
    const { conversation } = req.body;
    if (!conversation || conversation.trim().length < 20) {
        return res.status(400).json({ error: '대화 내용이 너무 짧습니다. 최소 20자 이상 입력해주세요.' });
    }

    try {
        const analyzePrompt = `너는 인팸(InteriorFamily) 벽장재 전문 회사의 AI 어시스턴트야.
아래는 관리자가 고객과 나눈 실제 대화야. 이 대화에서 인팸 제품/서비스에 대한 유용한 지식을 추출해줘.

=== 고객 대화 내용 ===
${conversation}
=== 끝 ===

위 대화를 분석해서:
1. 고객이 자주 물어볼 수 있는 질문과 그에 대한 적절한 답변을 추출해
2. 제품 특성, 시공 팁, 유지보수 방법, 클레임 대응 등 유용한 정보를 정리해
3. 반드시 아래 JSON 형식으로 추출해. 최대한 많이 추출해줘 (최소 1건, 최대 10건)

카테고리 종류: 시공 문제, 시공 팁, 제품 특성, 유지보수, 클레임 대응, 시공 주의사항, 배송, 가격, 기타

응답 형식:
먼저 한국어로 분석 요약을 간단히 적고, 마지막에 반드시 아래 블록을 넣어:

---LEARNED---
[{"category":"카테고리","question":"질문","answer":"답변","keywords":["키워드1","키워드2"]}]
---END---

일상적인 인사나 의미없는 대화에서는 추출하지 마. 실무에 도움되는 정보만 추출해.`;

        const result = await model.generateContent(analyzePrompt);
        let aiResponse = result.response.text();

        let learnedItems = [];
        const learnMatch = aiResponse.match(/---LEARNED---(.*?)---END---/s);
        if (learnMatch) {
            try {
                let jsonStr = learnMatch[1].trim();
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
                }
                learnedItems = JSON.parse(jsonStr);

                const existingData = loadLearnedData();
                for (const item of learnedItems) {
                    existingData.push({
                        id: 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                        category: item.category || '기타',
                        question: item.question,
                        answer: item.answer,
                        keywords: item.keywords || [],
                        source: 'conversation_upload',
                        learnedAt: new Date().toISOString()
                    });
                }
                saveLearnedData(existingData);
                console.log(`🧠 대화 분석으로 ${learnedItems.length}건 학습 완료!`);
            } catch (parseErr) {
                console.error('대화 분석 데이터 파싱 오류:', parseErr);
            }

            aiResponse = aiResponse.replace(/---LEARNED---.*?---END---/s, '').trim();
        }

        res.json({
            response: aiResponse,
            learnedCount: learnedItems.length,
            learnedItems: learnedItems.map(i => ({ question: i.question, category: i.category }))
        });
    } catch (error) {
        console.error('대화 분석 AI 호출 오류:', error);
        res.status(500).json({ error: 'AI 분석에 실패했습니다.', detail: error.message });
    }
});

// 답변 바로수정 → 학습 데이터로 저장
app.post('/api/admin/learn-correction', (req, res) => {
    const { question, answer } = req.body;
    if (!answer || answer.trim().length < 5) {
        return res.status(400).json({ error: '답변이 너무 짧습니다.' });
    }

    try {
        const existingData = loadLearnedData();

        // 같은 질문의 기존 수정 데이터가 있으면 업데이트
        const existingIdx = existingData.findIndex(d =>
            d.source === 'admin_correction' && d.question === question
        );

        const entry = {
            id: 'corr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            category: '관리자 수정',
            question: question || '직접 수정',
            answer: answer.trim(),
            keywords: extractKeywords(question + ' ' + answer),
            source: 'admin_correction',
            priority: 10,
            learnedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
            entry.id = existingData[existingIdx].id;
            existingData[existingIdx] = entry;
        } else {
            existingData.push(entry);
        }

        saveLearnedData(existingData);

        // 관련 캐시 무효화
        responseCache.clear();

        // RAG 벡터 스토어 비동기 리빌드 (수정 내용이 RAG 검색에도 반영)
        buildVectorStore().then(r => {
            if (r.success) console.log(`🔄 RAG 리빌드 완료 (수정 반영): ${r.totalDocuments}개 문서`);
        }).catch(() => { });

        console.log(`✏️ 답변 수정 학습 완료: "${question?.substring(0, 30)}..."`);
        res.json({ success: true, message: '수정이 학습에 반영되었습니다. 동일 질문에 수정한 답변이 그대로 반환됩니다.' });
    } catch (error) {
        console.error('답변 수정 저장 오류:', error);
        res.status(500).json({ error: '저장에 실패했습니다.' });
    }
});

// 키워드 자동 추출 헬퍼
function extractKeywords(text) {
    const stopWords = ['은', '는', '이', '가', '을', '를', '에', '의', '로', '으로', '과', '와', '하다', '있다', '없다', '되다', '않다'];
    const words = text.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '').split(/\s+/)
        .filter(w => w.length >= 2 && !stopWords.includes(w));
    return [...new Set(words)].slice(0, 8);
}

// 학습 데이터 CRUD
app.get('/api/admin/learned', adminAuth, (req, res) => {
    const data = loadLearnedData();
    const { category, search } = req.query;
    let filtered = data;
    if (category && category !== 'all') filtered = filtered.filter(d => d.category === category);
    if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(d =>
            d.question.toLowerCase().includes(s) ||
            d.answer.toLowerCase().includes(s) ||
            (d.keywords && d.keywords.some(k => k.toLowerCase().includes(s)))
        );
    }
    const categories = [...new Set(data.map(d => d.category))];
    res.json({ data: filtered, total: filtered.length, allTotal: data.length, categories });
});

app.put('/api/admin/learned/:id', adminAuth, (req, res) => {
    const data = loadLearnedData();
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    const { category, question, answer, keywords } = req.body;
    data[idx] = {
        ...data[idx],
        ...(category && { category }),
        ...(question && { question: question.trim() }),
        ...(answer && { answer: answer.trim() }),
        ...(keywords !== undefined && { keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()).filter(Boolean) }),
        updatedAt: new Date().toISOString()
    };
    saveLearnedData(data);
    res.json({ success: true, item: data[idx] });
});

app.delete('/api/admin/learned/:id', adminAuth, (req, res) => {
    const data = loadLearnedData();
    const idx = data.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    data.splice(idx, 1);
    saveLearnedData(data);
    res.json({ success: true });
});

// ========================
// RAG 관리 API
// ========================
app.get('/api/admin/rag-status', adminAuth, (req, res) => {
    const status = getRAGStatus();
    res.json(status);
});

app.post('/api/admin/rag-rebuild', adminAuth, async (req, res) => {
    try {
        const result = await buildVectorStore();
        // 캐시 무효화
        responseCache.clear();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RAG 상태 (인증 없이 - 기본 통계만)
app.get('/api/rag-info', (req, res) => {
    const status = getRAGStatus();
    res.json({
        totalDocuments: status.totalDocuments,
        isBuilding: status.isBuilding,
        lastBuilt: status.buildStatus?.builtAt || null,
    });
});

// 세션 정리 (1시간 활동 없는 세션 제거)
setInterval(() => {
    const cutoff = Date.now() - 3600000;
    Object.keys(sessions).forEach(key => {
        if (sessions[key].lastActive < cutoff) delete sessions[key];
    });
}, 3600000);

app.listen(PORT, async () => {
    const faqCount = loadFAQData().length;
    const learnCount = loadLearnedData().length;
    console.log(`🚀 인팸 AI 챗봇 서버 시작: http://localhost:${PORT}`);
    console.log(`📚 FAQ 데이터: ${faqCount}개 로드됨`);
    console.log(`🧠 학습 데이터: ${learnCount}개 로드됨`);
    console.log(`🔐 관리자 페이지: http://localhost:${PORT}/admin.html`);
    console.log(`📖 학습 페이지: http://localhost:${PORT}/learn.html`);
    console.log(`🔑 관리자 비밀번호: ${ADMIN_PASSWORD}`);

    // RAG 벡터 스토어 자동 빌드
    console.log('\n🔨 RAG 벡터 스토어 초기화 중...');
    const ragResult = await buildVectorStore();
    if (ragResult.success) {
        console.log(`✅ RAG 준비 완료: ${ragResult.totalDocuments}개 문서 인덱싱 (${ragResult.buildTime})`);
    } else {
        console.log(`⚠️ RAG 빌드 스킵: ${ragResult.reason}`);
    }
});
