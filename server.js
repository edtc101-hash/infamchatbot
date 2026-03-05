const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const { BRAND_KNOWLEDGE } = require('./knowledge-base');

// .env 파일 로드 (로컬 개발용)
try { require('dotenv').config(); } catch { /* dotenv 미설치 시 무시 */ }

// 업로드 설정
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
const { setApiKey, buildVectorStore, ragSearch, getRAGStatus } = require('./rag/rag-pipeline');
const igGraphApi = require('./ig-graph-api');

const app = express();
const PORT = process.env.PORT || 3000;
const FAQ_FILE = path.join(__dirname, 'faq-data.json');
const LEARNED_FILE = path.join(__dirname, 'learned-data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'infam2024';

// Gemini AI 초기화 — 최신 모델 (2026.02 changelog)
// 추론/분석: gemini-3.1-pro-preview (최고 성능 추론 + 멀티모달 이해)
// 이미지 생성: gemini-3.1-flash-image-preview (Nano Banana 2) / gemini-3-pro-image-preview
// 시각 분석: gemini-3-flash-preview (시각적·공간적 추론 강화)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY 환경변수가 설정되지 않았습니다!');
    console.error('   로컬: .env 파일에 GEMINI_API_KEY=... 추가');
    console.error('   Render: Dashboard → Environment Variables에서 설정');
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' }); // 채팅/학습용 (최고 성능 모델)
const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // 빠른 분석용 (폴백)
const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // 시각 분석용

// Nano Banana 2 (Gemini 3.1 Flash Image — 최신 이미지 생성)
const GEMINI_IMAGE_API_KEY = process.env.GEMINI_IMAGE_API_KEY || GEMINI_API_KEY;
const genAINB = new GoogleGenAI({ apiKey: GEMINI_IMAGE_API_KEY });
const IMAGE_GEN_MODEL = 'gemini-2.0-flash-preview-image-generation'; // 가장 빠른 이미지 생성 모델
const IMAGE_GEN_FALLBACK = 'gemini-2.0-flash'; // 폴백

// RAG 파이프라인에 API 키 설정
setApiKey(GEMINI_API_KEY);

app.use(cors());
app.use(express.json({ limit: '100mb' }));
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


// ========================
// 질문 의도 분류 (Intent Classification)
// ========================
function classifyIntent(message) {
    const msg = message.toLowerCase();

    // 의도별 키워드 사전 (우선순위 순)
    const intents = [
        {
            id: '인사_감사',
            keywords: ['안녕', '감사', '고마', '수고', '반갑', '처음', '도움', '감사합니다', '고맙습니다'],
            patterns: [/^(안녕|감사|반갑|수고)/, /^(hi|hello)/i]
        },
        {
            id: '회사_정보',
            keywords: ['인재상', '업무관', '비전', 'EDTC', '회사', '기업', '문화', '계명', '인팸소개', '조직'],
            patterns: [/인팸.*(뭐|무엇|어떤|소개)/, /회사.*(소개|정보|문화)/]
        },
        {
            id: '가격_규격',
            keywords: ['가격', '얼마', '단가', '비용', '원', '규격', '사이즈', '크기', '두께', '무게',
                '스펙', '치수', '길이', '너비', '폭', '높이', 'mm', 'cm', 'kg',
                '평당', '장당', '박스당', '묶음'],
            patterns: [/\d+\s*(mm|cm|m|평|장)/, /얼마/]
        },
        {
            id: '시공',
            keywords: ['시공', '설치', '시방', '가이드', '방법', '붙이기', '크랙', '보수', '하자',
                'DIY', '접착', '본드', '코너', '마감', '몰딩', '줄눈', '타카', '시멘트'],
            patterns: [/어떻게\s*(시공|설치|붙|작업)/]
        },
        {
            id: '배송',
            keywords: ['배송', '배달', '운송', '택배', '당일', '출고', '도착', '배송비', '운임',
                '화물', '착불', '선불', '퀵', '직배송'],
            patterns: [/언제\s*(배송|도착|받)/, /며칠\s*(걸|소요)/]
        },
        {
            id: '제품_소개',
            keywords: ['종류', '제품', '소개', '장점', '특징', '차이', '비교', '추천', '뭐가',
                '어떤', '용도', '방수', '내열', '내구성', '불연', '친환경'],
            patterns: [/어떤\s*(제품|종류)/, /(뭐|무엇).*추천/]
        },
        {
            id: '재고_샘플',
            keywords: ['재고', '샘플', '견본', '실물', '쇼룸', '방문', '위치', '주소', '몇장', '남아'],
            patterns: [/재고\s*(있|확인|남)/, /샘플\s*(구매|주문|받)/]
        },
        {
            id: '결제',
            keywords: ['결제', '카드', '현금', '계좌', '세금계산서', '영수증', '할인', '대량'],
            patterns: []
        }
    ];

    let bestIntent = { id: '기타', score: 0 };

    for (const intent of intents) {
        let score = 0;
        for (const kw of intent.keywords) {
            if (msg.includes(kw)) score += 3;
        }
        for (const pattern of intent.patterns) {
            if (pattern.test(msg)) score += 5;
        }
        if (score > bestIntent.score) {
            bestIntent = { id: intent.id, score };
        }
    }

    return bestIntent;
}

// 의도 기반 컨텍스트 필터링 — 관련 데이터만 우선 주입
function filterContextByIntent(intent, { relevantFAQs, relevantProducts, ragResults, relevantLearned }) {
    const contextBlocks = [];

    // 관리자 학습 데이터 — 항상 최우선 (의도에 맞는 것만)
    if (relevantLearned.length > 0) {
        const filtered = relevantLearned.filter(l => {
            const cat = (l.category || '').toLowerCase();
            if (intent.id === '가격_규격') return cat.includes('가격') || cat.includes('제품') || cat.includes('규격');
            if (intent.id === '배송') return cat.includes('배송');
            if (intent.id === '시공') return cat.includes('시공');
            return true; // 기타 의도는 모든 학습 데이터 포함
        });
        const items = (filtered.length > 0 ? filtered : relevantLearned).slice(0, 3);
        contextBlocks.push(`[관리자 학습 지식 — 최우선 참고]\n${items.map(l => `Q: ${l.question}\nA: ${l.answer}`).join('\n\n')}`);
    }

    // 의도별 컨텍스트 우선순위 조정
    if (intent.id === '가격_규격') {
        // 가격/규격 질문 → 제품 데이터 최우선
        if (relevantProducts.length > 0) {
            contextBlocks.unshift(`[★ 핵심 참고: 매칭 제품의 가격·규격 정보]\n${relevantProducts.slice(0, 15).map(p => `${p.category} | ${p.productId} | 디자인: ${p.design} | 규격: ${p.spec} | 가격: ${p.price}`).join('\n')}`);
        }
        if (ragResults.length > 0) {
            const priceRag = ragResults.filter(r => /가격|규격|스펙|사이즈/.test(r.content));
            if (priceRag.length > 0) {
                contextBlocks.push(`[의미 검색 — 가격/규격 관련]\n${priceRag.map(r => `(${r.score.toFixed(2)}) ${r.content}`).join('\n\n')}`);
            }
        }
    } else if (intent.id === '시공') {
        // 시공 질문 → RAG(시공 가이드) 최우선
        if (ragResults.length > 0) {
            contextBlocks.push(`[★ 핵심 참고: 시공 관련 정보]\n${ragResults.map(r => `(${r.score.toFixed(2)}) ${r.content}`).join('\n\n')}`);
        }
        if (relevantFAQs.length > 0) {
            const installFAQs = relevantFAQs.filter(f => f.category === '시공');
            if (installFAQs.length > 0) {
                contextBlocks.push(`[시공 FAQ]\n${installFAQs.slice(0, 3).map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}`);
            }
        }
    } else if (intent.id === '배송') {
        // 배송 질문 → 배송 FAQ 최우선
        if (relevantFAQs.length > 0) {
            const deliveryFAQs = relevantFAQs.filter(f => f.category === '배송');
            if (deliveryFAQs.length > 0) {
                contextBlocks.unshift(`[★ 핵심 참고: 배송 FAQ]\n${deliveryFAQs.slice(0, 3).map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}`);
            }
        }
        if (ragResults.length > 0) {
            const deliveryRag = ragResults.filter(r => /배송|배달|택배|운송/.test(r.content));
            if (deliveryRag.length > 0) {
                contextBlocks.push(`[배송 관련 의미 검색]\n${deliveryRag.map(r => `(${r.score.toFixed(2)}) ${r.content}`).join('\n\n')}`);
            }
        }
    } else {
        // 기타 의도 — 기존 방식 유지 (모든 소스 포함)
        if (ragResults.length > 0) {
            contextBlocks.push(`[의미 검색 결과]\n${ragResults.map(r => `(${r.score.toFixed(2)}) ${r.content}`).join('\n\n')}`);
        }
        if (relevantFAQs.length > 0) {
            contextBlocks.push(`[관련 FAQ]\n${relevantFAQs.slice(0, 3).map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}`);
        }
        if (relevantProducts.length > 0) {
            contextBlocks.push(`[매칭 제품 정보]\n${relevantProducts.slice(0, 10).map(p => `${p.category} | ${p.productId} | ${p.design} | ${p.spec} | ${p.price}`).join('\n')}`);
        }
    }

    return contextBlocks;
}

// 고유 ID 생성
function generateId() {
    return 'faq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

// ========================
// 대화 히스토리 세션 관리
// ========================
const sessions = {};
const SESSION_TTL = 1000 * 60 * 30; // 30분 비활성 시 만료

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

// 만료 세션 정리 (5분마다)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const sid of Object.keys(sessions)) {
        if (now - sessions[sid].lastActive > SESSION_TTL) {
            delete sessions[sid];
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`🧹 만료 세션 ${cleaned}개 정리`);
}, 1000 * 60 * 5);

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
// ERP 재고 직접 조회 (AI 컨텍스트 주입용)
// ========================
function lookupERPInventory(message) {
    try {
        const erpFile = path.join(__dirname, 'erp-scraped-data.json');
        if (!fs.existsSync(erpFile)) return [];
        const erp = JSON.parse(fs.readFileSync(erpFile, 'utf-8'));
        if (!erp.inventory) return [];

        const msgLower = message.toLowerCase().replace(/[\s\-\/]+/g, '');
        const matched = [];
        for (const item of erp.inventory) {
            const nameNorm = (item.name || '').toLowerCase().replace(/[\s\-\/]+/g, '');
            if (nameNorm && nameNorm.length >= 2 && msgLower.includes(nameNorm)) {
                matched.push(item);
            }
        }
        return matched;
    } catch {
        return [];
    }
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

    // ERP 재고 직접 조회
    const erpInventory = lookupERPInventory(message);

    // RAG 벡터 검색 (의미 기반)
    let ragResults = [];
    try {
        ragResults = await ragSearch(message, 5);
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

    // 2. 의도 분류 (Intent Classification)
    const intent = classifyIntent(message);
    console.log(`🎯 의도 분류: ${intent.id} (점수: ${intent.score})`);

    // 3. AI 호출 (대화 히스토리 포함)
    const historyContext = session.history.length > 0
        ? `\n\n[이전 대화 맥락]\n` +
        session.history.slice(-10).map(h => `${h.role === 'user' ? '고객' : '상담사'}: ${h.content.substring(0, 150)}`).join('\n')
        : '';

    // 관리자 학습 데이터 (최우선)
    const relevantLearned = findRelevantLearned(message, LEARNED_DATA);

    // 의도 기반 컨텍스트 선별 주입
    const contextBlocks = filterContextByIntent(intent, {
        relevantFAQs, relevantProducts, ragResults, relevantLearned
    });

    // ERP 재고 직접 매칭 결과 주입
    if (erpInventory.length > 0) {
        const erpText = erpInventory.map(i =>
            `${i.name} (${i.color || '-'}) | 규격: ${i.spec} | 두께: ${i.thickness} | **현재 재고: ${i.qty}장**`
        ).join('\n');
        contextBlocks.unshift(`[★ ERP 실시간 재고 — 정확한 데이터]\n${erpText}`);
    }

    const contextSection = contextBlocks.length > 0
        ? `\n\n=== 참고 자료 (질문 의도에 맞는 정보만 선별됨) ===\n${contextBlocks.join('\n\n')}`
        : '';

    // 시스템 인스트럭션 (고정 — 매 요청마다 반복하지 않음)
    const systemInstruction = `당신은 인팸(InteriorFamily)의 **내부 CS 어시스턴트**입니다.
직원이 고객으로부터 받은 질문을 입력하면, 고객에게 바로 전달(복사-붙여넣기) 가능한 답변 초안을 생성합니다.

${BRAND_KNOWLEDGE}

=== 답변 생성 규칙 ===
1. 참고 자료에 구체적 정보가 있으면 그것을 근거로 정확히 답변하세요.
2. 참고 자료에 없는 정보는 절대 지어내지 마세요. "정확한 사항은 담당자 확인이 필요합니다"로 안내하세요.
3. ERP 재고 데이터가 있으면 반드시 재고 수량을 포함하여 답변하세요.

=== 답변 형식 (필수) ===
답변은 반드시 아래 두 영역으로 나누어 작성하세요:

**📋 고객 전달용 답변:**
(아래 내용은 직원이 그대로 복사해서 카카오톡/문자로 고객에게 보낼 수 있는 텍스트입니다)
- 격식체 필수: "~합니다", "~드리겠습니다" ("~해요", "~이에요" 금지)
- 마크다운 서식(**, ##, - 등) 사용 금지. 일반 텍스트만 사용하세요.
- 줄바꿈과 이모지를 적절히 활용하여 가독성 좋게 작성하세요.
- 인사말은 "안녕하세요, 인팸입니다!" 또는 적절한 인사로 시작하세요.
- 간결하되 충분한 정보 제공: 3~6문장 + 관련 링크.
- 마무리는 "추가 문의 사항이 있으시면 편하게 말씀해 주세요!" 등 친절한 마무리로 끝내세요.
- 관련 링크가 있으면 자연스럽게 포함하세요.

**💡 내부 참고 메모:**
(아래는 직원만 참고할 내용으로, 고객에게 전달하지 않습니다)
- 답변의 근거가 된 출처 (FAQ, RAG 검색 결과, 카탈로그 등)
- 추가로 확인이 필요한 사항
- 고객에게 후속으로 물어볼 만한 사항 제안

=== 후속 질문 생성 (필수) ===
내부 참고 메모 이후에 반드시 아래 형식으로 후속 질문 3개를 추가하세요:
---SUGGESTED---
["고객이 추가로 물어볼 수 있는 질문 1", "질문 2", "질문 3"]
---END---

=== 링크 활용 ===
관련 제품/서비스 언급 시 아래 링크를 고객 전달용 답변에 자연스럽게 포함하세요:
- 재고 확인: https://drive.google.com/drive/folders/1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d
- 샘플 구매: https://buly.kr/6MrEuTY
- 시공 사례: https://www.notion.so/edtc/f71f248770b5409ba158a210ab71db7d?v=600a30831a484786b25e4f55293ff749
- 쇼룸 위치: https://naver.me/G1wCKANl
- 전체 카탈로그: https://link.inpock.co.kr/interiorfamily`;

    // 사용자 메시지 (변동 부분만)
    const userMessage = `🎯 질문 의도: 【${intent.id}】
${contextSection}${historyContext}

고객으로부터 받은 질문: ${message}`;

    let aiResponse = null;
    const modelsToTry = [
        { m: model, name: 'gemini-2.5-pro' },
        { m: flashModel, name: 'gemini-2.5-flash' }
    ];

    for (const { m, name } of modelsToTry) {
        try {
            const chat = m.startChat({
                systemInstruction: { parts: [{ text: systemInstruction }] },
                history: session.history.slice(-10).map(h => ({
                    role: h.role, parts: [{ text: h.content }]
                })),
                generationConfig: {
                    maxOutputTokens: 2500,
                    temperature: 0.1,
                    topP: 0.85,
                    topK: 20
                }
            });
            const result = await chat.sendMessage(userMessage);
            aiResponse = result.response.text();
            console.log(`✅ AI 응답 성공 (모델: ${name}, 의도: ${intent.id})`);
            break;
        } catch (err) {
            const isQuota = err.status === 429;
            const isNotFound = err.status === 404;
            console.log(`⚠️ AI ${name} 실패 (${err.status}):`, isQuota ? '할당량 초과' : isNotFound ? '모델 없음' : err.message);
            if (isQuota) await new Promise(r => setTimeout(r, 2000));
        }
    }

    // AI 응답 성공 — 후속 질문 추출
    if (aiResponse) {
        let suggestedQuestions = [];
        const suggestMatch = aiResponse.match(/---SUGGESTED---(.*?)---END---/s);
        if (suggestMatch) {
            try {
                let jsonStr = suggestMatch[1].trim();
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
                }
                suggestedQuestions = JSON.parse(jsonStr);
                if (!Array.isArray(suggestedQuestions)) suggestedQuestions = [];
            } catch (e) {
                console.log('후속 질문 파싱 실패:', e.message);
            }
            // 응답에서 후속 질문 블록 제거
            aiResponse = aiResponse.replace(/---SUGGESTED---.*?---END---/s, '').trim();
        }

        setCache(message, aiResponse, matchedFAQsForClient);
        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'model', content: aiResponse });
        if (session.history.length > 20) session.history = session.history.slice(-20);
        return res.json({
            response: aiResponse,
            matchedFAQs: matchedFAQsForClient,
            ragSources: ragResults.length > 0 ? ragResults.map(r => ({ title: r.title, score: r.score.toFixed(2), category: r.category, content: r.content || '' })) : [],
            suggestedQuestions,
            intent: intent.id
        });
    }

    // 스마트 폴백 + 의도 기반 후속 질문
    console.log('📚 스마트 폴백 사용');
    const fallbackResponse = buildSmartFallback(message, relevantFAQs);
    const fallbackSuggestions = {
        '인사_감사': ['어떤 제품을 취급하나요?', '인팸은 어떤 회사인가요?', '쇼룸 위치가 어디인가요?'],
        '회사_정보': ['어떤 제품이 있나요?', '쇼룸 방문 가능한가요?', '배송은 어떻게 되나요?'],
        '가격_규격': ['샘플 구매는 어떻게 하나요?', '재고가 있나요?', '대량 주문 할인도 가능한가요?'],
        '배송': ['당일 배송 가능한 제품은 무엇인가요?', '배송비는 얼마인가요?', '제주/도서산간 배송도 가능한가요?'],
        '시공': ['시공 시 필요한 부자재는 뭔가요?', 'DIY 시공이 가능한가요?', '시공 후 관리 방법은?'],
        '제품_소개': ['어떤 제품이 가장 인기있나요?', '샘플을 받아볼 수 있나요?', '쇼룸에서 직접 볼 수 있나요?'],
        '재고_샘플': ['당일 배송이 가능한가요?', '가격이 어떻게 되나요?', '대량 구매 시 할인이 되나요?'],
        '기타': ['제품 종류가 어떻게 되나요?', '배송은 어떻게 진행되나요?', '쇼룸 위치가 어디인가요?']
    };
    // 폴백 응답은 캐시하지 않음 (AI 복구 후 저품질 응답 방지)
    res.json({
        response: fallbackResponse,
        fromFallback: true,
        matchedFAQs: matchedFAQsForClient,
        suggestedQuestions: fallbackSuggestions[intent.id] || fallbackSuggestions['기타'],
        intent: intent.id
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
            learnedItems: learnedItems.map(i => ({ question: i.question, answer: i.answer, category: i.category, keywords: i.keywords || [] }))
        });
    } catch (error) {
        console.error('대화 분석 AI 호출 오류:', error);
        res.status(500).json({ error: 'AI 분석에 실패했습니다.', detail: error.message });
    }
});

// AI로 답변 개선하기
app.post('/api/admin/improve-answer', adminAuth, async (req, res) => {
    const { question, answer, category, keywords } = req.body;
    if (!question || !answer) {
        return res.status(400).json({ error: 'question과 answer는 필수입니다.' });
    }
    try {
        const improvePrompt = `너는 인팸(InteriorFamily) 벽장재 전문 회사의 시니어 기술 전문가야.
아래 Q&A의 답변을 검토하고, **더 정확하고 전문적이며 고객에게 도움이 되는 답변**으로 개선해.

=== 기존 Q&A ===
카테고리: ${category || '기타'}
질문: ${question}
현재 답변: ${answer}
키워드: ${(keywords || []).join(', ')}
=== 끝 ===

📋 개선 지침:
1. 기존 답변의 핵심 내용은 유지하되, 더 정확하고 구체적으로 보완해.
2. 숫자, 수치, 규격 등 구체적 데이터가 있으면 반드시 포함해.
3. 실무에서 자주 발생하는 주의사항이나 팁이 있으면 추가해.
4. 문장을 자연스럽고 친절하게 다듬어.
5. 문서에 없는 내용은 지어내지 마.

✅ 출력 형식 — 오직 JSON만 출력해:
{"improved_answer": "개선된 답변 내용", "improved_keywords": ["보완된 키워드1", "키워드2"]}`;

        const result = await model.generateContent(improvePrompt);
        let aiText = result.response.text();

        // JSON 추출
        let jsonStr = aiText;
        if (aiText.includes('```json')) {
            jsonStr = aiText.split('```json')[1].split('```')[0].trim();
        } else if (aiText.includes('```')) {
            jsonStr = aiText.split('```')[1].split('```')[0].trim();
        }
        const improved = JSON.parse(jsonStr);

        console.log(`✅ AI 답변 개선 완료: "${question.substring(0, 30)}..."`);
        res.json({
            success: true,
            improved_answer: improved.improved_answer || answer,
            improved_keywords: improved.improved_keywords || keywords
        });
    } catch (error) {
        console.error('AI 답변 개선 오류:', error);
        res.status(500).json({ error: 'AI 답변 개선에 실패했습니다.', detail: error.message });
    }
});

// 문서 파일 업로드 → 텍스트 추출 → AI 자동 파싱 및 학습 (강화된 파이프라인)
app.post('/api/admin/upload-knowledge', adminAuth, upload.array('documents'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '업로드된 파일이 없습니다.' });
    }

    try {
        let extractedText = '';
        const fileNames = [];

        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            const filePath = file.path;
            fileNames.push(file.originalname);

            try {
                if (ext === '.txt') {
                    extractedText += `\n[${file.originalname} 문서 내용]\n` + fs.readFileSync(filePath, 'utf8') + '\n';
                } else if (ext === '.pdf') {
                    const dataBuffer = fs.readFileSync(filePath);
                    const pdfData = await pdf(dataBuffer);
                    extractedText += `\n[${file.originalname} 문서 내용]\n` + pdfData.text + '\n';
                } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
                    const workbook = xlsx.readFile(filePath);
                    let excelText = '';
                    workbook.SheetNames.forEach(sheetName => {
                        const sheet = workbook.Sheets[sheetName];
                        const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                        excelText += `=== Sheet: ${sheetName} ===\n`;
                        json.forEach(row => {
                            if (row.length > 0) excelText += row.join(' | ') + '\n';
                        });
                    });
                    extractedText += `\n[${file.originalname} 문서 내용]\n` + excelText + '\n';
                }
            } catch (err) {
                console.error(`파일 처리 오류 (${file.originalname}):`, err);
            } finally {
                try { fs.unlinkSync(filePath); } catch (e) { } // 임시 파일 삭제
            }
        }

        if (!extractedText.trim()) {
            return res.status(400).json({ error: '파일에서 텍스트를 추출하지 못했습니다.' });
        }

        console.log(`📄 텍스트 추출 완료: ${extractedText.length}자 (파일: ${fileNames.join(', ')})`);

        // ─── 1단계: 스마트 청킹 (오버랩 포함, 확대) ───
        const CHUNK_SIZE = 8000;   // 6000→8000 (청크 수 30% 감소)
        const OVERLAP = 400;
        const chunks = [];
        for (let i = 0; i < extractedText.length; i += CHUNK_SIZE - OVERLAP) {
            const chunk = extractedText.slice(i, i + CHUNK_SIZE).trim();
            if (chunk.length > 100) chunks.push(chunk);
        }
        console.log(`📦 ${chunks.length}개 청크로 분할 (${CHUNK_SIZE}자 기준, ${OVERLAP}자 오버랩)`);

        let totalExtractedItems = [];
        const startTime = Date.now();

        // ─── 2단계: Gemini Flash로 병렬 Q&A 추출 (3개 동시) ───
        // flashModel은 전역 변수 (gemini-2.5-flash) 사용
        const CONCURRENCY = 3; // 동시 처리 수

        async function processChunk(chunk, index) {
            const analyzePrompt = `너는 인팸(InteriorFamily) 벽장재 전문 회사의 시니어 지식 관리자야.
아래는 직원이 업로드한 실무 문서의 일부야. 이 내용을 분석해서 **고객 서비스 AI 챗봇**이 즉시 활용할 수 있는 고품질 Q&A 지식으로 변환해.

=== 문서 내용 (파트 ${index + 1}/${chunks.length}) ===
${chunk}
=== 끝 ===

📋 **추출 지침 (매우 중요):**
1. 문서에서 모든 유용한 정보를 빠짐없이 추출해. 최소 3건 ~ 최대 15건까지 추출 가능.
2. **질문(question)**: 고객이 실제로 물어볼 법한 자연스러운 질문으로 작성. 구체적으로.
3. **답변(answer)**: 문서 원본 내용을 기반으로 정확하고 상세하게 작성. 숫자, 수치, 규격 등 구체적 데이터를 반드시 포함.
4. **키워드(keywords)**: 검색에 활용될 핵심 단어 3~8개. 제품명, 기술용어, 동의어 포함.
5. **카테고리(category)**: 제품, 시공, 배송, 가격, 견적, 유지보수, 시공 팁, 시공 주의사항, 클레임 대응, 기타 중 택 1.

⚠️ 절대 하지 말 것:
- 문서에 없는 내용을 지어내지 마.
- 너무 일반적이거나 추상적인 QA는 안 돼.
- 인사말이나 의미없는 정보는 제외.

✅ 출력 형식 — 오직 아래 형태만 출력해. 다른 텍스트 절대 없이 JSON만:
---LEARNED---
[
  {"category":"카테고리","question":"구체적 질문","answer":"상세하고 정확한 답변","keywords":["키워드1","키워드2","키워드3"]}
]
---END---`;

            try {
                const result = await flashModel.generateContent(analyzePrompt);
                let aiResponse = result.response.text();

                const match = aiResponse.match(/---LEARNED---\s*([\s\S]*?)\s*---END---/);
                if (match && match[1]) {
                    let jsonStr = match[1].trim();
                    if (jsonStr.includes('```json')) {
                        jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
                    } else if (jsonStr.includes('```')) {
                        jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
                    }
                    const parsedItems = JSON.parse(jsonStr);
                    if (Array.isArray(parsedItems)) {
                        console.log(`  ✅ 청크 ${index + 1}: ${parsedItems.length}건 추출`);
                        return parsedItems;
                    }
                }
                console.warn(`  ⚠️ 청크 ${index + 1}: ---LEARNED--- 블록 미발견`);
                return [];
            } catch (aiErr) {
                console.error(`  ❌ 청크 ${index + 1} AI 호출 실패:`, aiErr.message);
                return [];
            }
        }

        // 병렬 배치 처리 (CONCURRENCY개씩 동시 실행)
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map((chunk, batchIdx) => processChunk(chunk, i + batchIdx));
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(items => totalExtractedItems.push(...items));
            console.log(`  📊 배치 ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(chunks.length / CONCURRENCY)} 완료`);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🧠 총 ${totalExtractedItems.length}건 Q&A 추출 완료 (${elapsed}초 소요, Flash 병렬×${CONCURRENCY})`);

        if (totalExtractedItems.length === 0) {
            return res.status(400).json({ error: '문서는 인식되었으나 유의미한 Q&A 지식을 추출하지 못했습니다. 형식을 확인해주세요.' });
        }

        // ─── 3단계: learned-data.json에 Q&A 저장 ───
        const existingData = loadLearnedData();
        for (const item of totalExtractedItems) {
            existingData.push({
                id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                category: item.category || '기타',
                question: item.question,
                answer: item.answer,
                keywords: item.keywords || [],
                source: 'document_upload',
                sourceFile: fileNames.join(', '),
                learnedAt: new Date().toISOString()
            });
        }
        saveLearnedData(existingData);

        // ─── 4단계: 원문 텍스트 청크도 RAG에 직접 저장 (Q&A 외에 원본 검색 지원) ───
        const rawChunkSize = 1500;
        const rawOverlap = 200;
        const rawChunks = [];
        for (let i = 0; i < extractedText.length; i += rawChunkSize - rawOverlap) {
            const chunk = extractedText.slice(i, i + rawChunkSize).trim();
            if (chunk.length > 100) rawChunks.push(chunk);
        }
        // 원문 청크를 learned-data에 RAG 전용 항목으로 추가
        for (let i = 0; i < Math.min(rawChunks.length, 30); i++) {
            existingData.push({
                id: 'rawdoc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                category: '문서 원문',
                question: `[${fileNames.join(', ')}] 문서 내용 (${i + 1}/${Math.min(rawChunks.length, 30)})`,
                answer: rawChunks[i],
                keywords: fileNames.flatMap(n => n.replace(/\.[^.]+$/, '').split(/[\s_-]+/)),
                source: 'document_raw_chunk',
                sourceFile: fileNames.join(', '),
                learnedAt: new Date().toISOString()
            });
        }
        saveLearnedData(existingData);

        // ─── 5단계: 캐시 무효화 + RAG 벡터 스토어 비동기 리빌드 ───
        responseCache.clear();
        buildVectorStore().then(r => {
            console.log(`✅ 문서 업로드 후 RAG 재빌드 완료: ${r.totalDocuments}개 문서`);
        }).catch(console.error);

        console.log(`🎉 파일 업로드 학습 완료! Q&A ${totalExtractedItems.length}건 + 원문청크 ${Math.min(rawChunks.length, 30)}건`);

        res.json({
            success: true,
            extractedCount: totalExtractedItems.length,
            chunksExtracted: totalExtractedItems.length,
            rawChunksStored: Math.min(rawChunks.length, 30),
            ragTotal: existingData.length + loadFAQData().length + loadProductData().length,
            items: totalExtractedItems.map(item => ({
                category: item.category || '기타',
                question: item.question,
                answer: item.answer,
                keywords: item.keywords || []
            }))
        });
    } catch (error) {
        console.error('파일 업로드 파싱 오류:', error);
        res.status(500).json({ error: '파일 처리 및 분석 중 에러가 발생했습니다.', detail: error.message });
    }
});

// AI로 답변 개선하기
app.post('/api/admin/improve-answer', async (req, res) => {
    const { question, currentAnswer } = req.body;
    if (!question && !currentAnswer) {
        return res.status(400).json({ error: '질문 또는 현재 답변이 필요합니다.' });
    }

    try {
        // 관련 지식 검색
        const relevantFAQs = question ? searchFAQ(question, FAQ_DATA).slice(0, 3) : [];
        const relevantLearned = question ? findRelevantLearned(question, LEARNED_DATA).slice(0, 3) : [];
        let ragResults = [];
        if (question && vectorStore) {
            try { ragResults = vectorStore.search(question, 3); } catch (e) { }
        }

        const knowledgeContext = [
            relevantFAQs.length > 0 ? `[FAQ 정보]\n${relevantFAQs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : '',
            ragResults.length > 0 ? `[RAG 검색 결과]\n${ragResults.map(r => r.content).join('\n\n')}` : '',
            relevantLearned.length > 0 ? `[학습된 지식]\n${relevantLearned.map(l => `Q: ${l.question}\nA: ${l.answer}`).join('\n\n')}` : ''
        ].filter(Boolean).join('\n\n');

        const improvePrompt = `너는 인팸(InteriorFamily) 벽장재 전문 회사의 베테랑 영업 매니저야.

아래 고객 질문에 대한 기존 답변을 더 정확하고, 더 자연스럽고, 더 전문적으로 개선해줘.

=== 고객 질문 ===
${question || '(질문 없음)'}

=== 현재 답변 (개선 필요) ===
${currentAnswer || '(답변 없음)'}

${knowledgeContext ? `=== 참고할 수 있는 지식 데이터 ===\n${knowledgeContext}` : ''}

=== 개선 지침 ===
1. 기존 답변의 틀린 정보는 수정하고, 부족한 정보는 보완해.
2. 편안하고 자연스러운 대화체로 작성해. "~해요", "~드릴게요" 존댓말 사용.
3. "안녕하세요", "반갑습니다" 같은 인사말은 절대 넣지 마. 바로 본론.
4. 실무 팁이나 현장 경험을 자연스럽게 섞어줘.
5. 마지막에 자연스러운 후속 질문 1개를 넣어줘.
6. 위 "참고할 수 있는 지식 데이터"가 있으면 적극 활용해.
7. 답변만 출력해. 다른 설명이나 메타 정보는 쓰지 마.`;

        const result = await model.generateContent(improvePrompt);
        const improved = result.response.text();

        console.log('🤖 AI 답변 개선 완료:', (question || '').substring(0, 30));
        res.json({ success: true, improvedAnswer: improved });
    } catch (error) {
        console.error('AI 답변 개선 오류:', error);
        res.status(500).json({ error: 'AI 답변 개선 중 오류가 발생했습니다.' });
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

// ========================
// 회사소개 콘텐츠 API
// ========================
const COMPANY_CONTENT_FILE = path.join(__dirname, 'company-content.json');

app.get('/api/company-content', (req, res) => {
    try {
        if (fs.existsSync(COMPANY_CONTENT_FILE)) {
            const data = JSON.parse(fs.readFileSync(COMPANY_CONTENT_FILE, 'utf8'));
            res.json(data);
        } else {
            res.status(404).json({ error: '저장된 콘텐츠가 없습니다.' });
        }
    } catch (e) {
        res.status(500).json({ error: '콘텐츠 로드 실패' });
    }
});

app.post('/api/company-content', (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '콘텐츠가 비어있습니다.' });
        const data = { content, updatedAt: new Date().toISOString() };
        fs.writeFileSync(COMPANY_CONTENT_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log('🏢 회사소개 콘텐츠 저장됨');
        res.json({ success: true, updatedAt: data.updatedAt });
    } catch (e) {
        res.status(500).json({ error: '저장 실패' });
    }
});

// ========================
// 인팸 디자인 AI — 이미지 제작소 API
// ========================

// 디자인 분석: 파일 업로드 → Gemini Vision으로 톤앤매너 분석
app.post('/api/design/analyze', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });

        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/png';

        console.log(`🎨 디자인 분석 요청: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);

        const analyzeModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

        const prompt = `당신은 전문 디자인 분석가입니다. 업로드된 이미지/문서에서 디자인 톤앤매너를 분석해주세요.

다음 항목들을 JSON 형식으로 분석 결과를 반환해주세요:

1. colors: 감지된 주요 색상 최대 6개 (hex 코드와 용도를 포함)
2. fonts: 감지된 폰트/타이포그래피 스타일 (폰트명 추정, 용도, 굵기)
3. styles: 디자인 스타일 키워드 (예: "모던", "미니멀", "기업형", "고급스러운" 등)
4. layout: 레이아웃 구조 한국어로 설명 (2-3문장)

반드시 JSON 형식으로 반환하세요. 코드 블록 없이 순수 JSON만 반환하세요.

예시:
{
  "colors": [{"hex": "#3a7d44", "usage": "주요 브랜드 색상"}, {"hex": "#ffffff", "usage": "배경"}],
  "fonts": [{"name": "Pretendard", "usage": "제목", "weight": "Bold"}, {"name": "Noto Sans KR", "usage": "본문", "weight": "Regular"}],
  "styles": ["모던", "깔끔한", "기업형"],
  "layout": "상단 헤더 + 중앙 콘텐츠 영역 + 하단 푸터 구조..."
}`;

        const result = await analyzeModel.generateContent([
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } }
        ]);

        const responseText = result.response.text();
        console.log('✅ 디자인 분석 완료');

        // JSON 파싱 시도
        let analysisData;
        try {
            // ```json ... ``` 블록 제거
            const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            analysisData = JSON.parse(cleaned);
        } catch {
            // 파싱 실패 시 기본 구조 반환
            analysisData = {
                colors: [{ hex: '#3a7d44', usage: '주요 색상' }, { hex: '#ffffff', usage: '배경' }],
                fonts: [{ name: '감지 불가', usage: '전체', weight: '-' }],
                styles: ['분석 중 파싱 오류'],
                layout: responseText.substring(0, 300),
            };
        }

        // 파일 정리
        try { fs.unlinkSync(filePath); } catch { }

        res.json(analysisData);
    } catch (err) {
        console.error('❌ 디자인 분석 오류:', err.message);
        res.status(500).json({ error: '분석 중 오류 발생: ' + err.message });
    }
});

// 디자인 수정: Nano Banana (gemini-3.1-flash-image-preview) — 네이티브 이미지 생성/편집
app.post('/api/design/modify', async (req, res) => {
    try {
        const { message, analysis, sessionId, attachmentDataUrl, imageUrl } = req.body;

        if (!message && !imageUrl && !attachmentDataUrl) return res.status(400).json({ error: '메시지가 없습니다' });

        console.log(`🎨 디자인 수정 요청 (Nano Banana): ${(message || '').substring(0, 50)}...`);

        let contextInfo = '';
        if (analysis) {
            contextInfo = `
현재 학습된 톤앤매너:
- 색상 팔레트: ${(analysis.colors || []).map(c => `${c.hex}(${c.usage})`).join(', ')}
- 폰트: ${(analysis.fonts || []).map(f => `${f.name}(${f.usage})`).join(', ')}
- 디자인 스타일: ${(analysis.styles || []).join(', ')}
- 레이아웃: ${analysis.layout || '없음'}`;
        }

        const systemPrompt = `당신은 이미지 편집 도구입니다. 
사용자가 업로드한 원본 이미지를 **부분적으로만 수정**하세요.

# 핵심 규칙 (반드시 지킬 것):
1. **절대 새로운 이미지를 처음부터 생성하지 마세요.** 원본 이미지를 기반으로 요청한 부분만 수정하세요.
2. 원본 이미지의 전체 구도, 레이아웃, 스타일, 톤앤매너를 그대로 유지하세요.
3. 사용자가 지시한 영역/요소만 최소한으로 변경하세요.
4. 변경하지 않은 부분은 원본과 완전히 동일해야 합니다.
5. 한국어로 짧게 답변하세요. "수정 완료했습니다" 정도면 충분합니다.
6. 이미지가 첨부된 경우, 반드시 수정된 이미지를 반환하세요.

${contextInfo}

사용자 수정 요청:`;

        // Nano Banana용 콘텐츠 구성
        const contents = [];
        const promptText = systemPrompt + '\n' + (message || '이 이미지를 분석해주세요.');

        const contentParts = [{ text: promptText }];

        // 첨부 이미지 처리 (data URL)
        if (attachmentDataUrl && attachmentDataUrl.startsWith('data:')) {
            const match = attachmentDataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                contentParts.push({
                    inlineData: { mimeType: match[1], data: match[2] }
                });
            }
        }

        // URL 이미지 다운로드 후 첨부
        if (imageUrl) {
            try {
                const imgResp = await fetch(imageUrl);
                if (imgResp.ok) {
                    const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                    const imgMime = imgResp.headers.get('content-type') || 'image/jpeg';
                    contentParts.push({
                        inlineData: { mimeType: imgMime, data: imgBuffer.toString('base64') }
                    });
                }
            } catch (e) {
                console.warn('이미지 다운로드 실패:', e.message);
            }
        }

        contents.push({ role: 'user', parts: contentParts });

        // Nano Banana로 이미지 생성 시도
        let responseText = '';
        let generatedImageBase64 = null;

        try {
            const result = await genAINB.models.generateContent({
                model: 'gemini-3.1-flash-image-preview',
                contents: contents,
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            });

            // 응답 파싱: 텍스트 + 이미지
            if (result.candidates && result.candidates[0] && result.candidates[0].content) {
                for (const part of result.candidates[0].content.parts) {
                    if (part.text) {
                        responseText += part.text;
                    } else if (part.inlineData) {
                        generatedImageBase64 = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        console.log('🖼️ 이미지 생성 완료!');
                    }
                }
            }
        } catch (nbErr) {
            console.warn('⚠️ Nano Banana 실패, gemini-2.5-pro로 폴백:', nbErr.message);
            // 폴백: gemini-2.5-pro
            const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
            const fallbackParts = contentParts;
            const fallbackResult = await fallbackModel.generateContent(fallbackParts);
            responseText = fallbackResult.response.text();
        }

        if (!responseText && !generatedImageBase64) {
            responseText = '이미지가 생성되었습니다.';
        }

        console.log(`✅ 디자인 AI 응답 완료 (Nano Banana${generatedImageBase64 ? ' + 이미지' : ''})`);

        res.json({
            response: responseText,
            generatedImage: generatedImageBase64,
        });
    } catch (err) {
        console.error('❌ 디자인 수정 오류:', err.message);
        res.status(500).json({ response: '⚠️ 처리 중 오류가 발생했습니다: ' + err.message });
    }
});

// URL에서 이미지 추출
app.post('/api/design/extract-images', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL이 없습니다' });

        console.log(`🔗 이미지 추출 요청: ${url}`);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
            redirect: 'follow',
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const $ = cheerio.load(html);

        const images = [];
        const seen = new Set();

        $('img').each((_, el) => {
            let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
            const alt = $(el).attr('alt') || '';

            if (!src || src.startsWith('data:')) return;

            // 상대 URL → 절대 URL 변환
            try {
                src = new URL(src, url).href;
            } catch { return; }

            // 중복 및 아이콘/트래커 제외
            if (seen.has(src)) return;
            if (src.includes('pixel') || src.includes('tracking') || src.includes('1x1')) return;
            if (src.endsWith('.svg') && !alt) return;

            seen.add(src);
            images.push({ url: src, alt: alt.substring(0, 100) });
        });

        // OG 이미지 추가
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && !seen.has(ogImage)) {
            try {
                const ogUrl = new URL(ogImage, url).href;
                images.unshift({ url: ogUrl, alt: 'OG Image' });
            } catch { }
        }

        console.log(`✅ 이미지 ${images.length}개 추출 완료`);
        res.json({ images: images.slice(0, 30) });
    } catch (err) {
        console.error('❌ 이미지 추출 오류:', err.message);
        res.status(500).json({ error: '이미지 추출 실패: ' + err.message });
    }
});

// 디자인 생성: 프리셋 기반 에셋 생성
app.post('/api/design/generate', async (req, res) => {
    try {
        const { preset, analysis, parameters } = req.body;
        console.log(`🎨 디자인 생성 요청: ${preset}`);

        const designModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

        let contextInfo = '';
        if (analysis) {
            contextInfo = `학습된 톤앤매너: 색상(${(analysis.colors || []).map(c => c.hex).join(',')}), 폰트(${(analysis.fonts || []).map(f => f.name).join(',')}), 스타일(${(analysis.styles || []).join(',')})`;
        }

        const prompt = `당신은 전문 웹 디자인 AI입니다. 다음 요청에 맞는 HTML 코드를 생성해주세요.

${contextInfo}

작업 유형: ${preset}
추가 파라미터: ${JSON.stringify(parameters || {})}

# 규칙:
1. 완전한 HTML 코드를 생성하세요 (인라인 CSS 포함).
2. 학습된 색상 팔레트와 폰트를 적용하세요.
3. 모바일 반응형으로 제작하세요.
4. Google Fonts를 사용하세요 (Pretendard, Noto Sans KR).
5. 한국어 콘텐츠로 작성하세요.

완전한 HTML 코드만 반환하세요.`;

        const result = await designModel.generateContent(prompt);
        const responseText = result.response.text();

        res.json({ html: responseText, preset });
    } catch (err) {
        console.error('❌ 디자인 생성 오류:', err.message);
        res.status(500).json({ error: '생성 중 오류 발생: ' + err.message });
    }
});

// ========================
// 콘텐츠 자동화 대시보드 백엔드 자동 실행
// ========================
const { spawn } = require('child_process');
let contentDashboardProcess = null;

function startContentDashboard() {
    const backendDir = path.resolve(__dirname, '..', '콘텐츠 자동화 대시보드', 'backend');

    if (!fs.existsSync(backendDir)) {
        console.log('⚠️ 콘텐츠 자동화 대시보드 폴더를 찾을 수 없습니다:', backendDir);
        return;
    }

    console.log('🎬 콘텐츠 자동화 대시보드 백엔드 시작 중...');

    contentDashboardProcess = spawn('python', ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000'], {
        cwd: backendDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    contentDashboardProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`  [콘텐츠] ${msg}`);
    });

    contentDashboardProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('INFO:')) console.log(`  [콘텐츠 ERR] ${msg}`);
        // uvicorn은 INFO를 stderr로 출력
        if (msg.includes('Uvicorn running') || msg.includes('Started server')) {
            console.log('✅ 콘텐츠 자동화 대시보드: http://localhost:8000');
        }
    });

    contentDashboardProcess.on('error', (err) => {
        console.log('⚠️ 콘텐츠 대시보드 실행 실패:', err.message);
        console.log('   → Python/uvicorn이 설치되어 있는지 확인해주세요');
    });

    contentDashboardProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
            console.log(`⚠️ 콘텐츠 대시보드 종료 (코드: ${code})`);
        }
        contentDashboardProcess = null;
    });
}

// 서버 종료 시 FastAPI도 함께 종료
function cleanupContentDashboard() {
    if (contentDashboardProcess) {
        console.log('🔒 콘텐츠 대시보드 백엔드 종료...');
        contentDashboardProcess.kill();
        contentDashboardProcess = null;
    }
}

process.on('exit', () => { cleanupContentDashboard(); });
process.on('SIGINT', () => { cleanupContentDashboard(); process.exit(); });
process.on('SIGTERM', () => { cleanupContentDashboard(); process.exit(); });

// (Qwen-Image-Layered 서비스 — 비활성화됨)

// ========================
// AI 이미지 분석/생성 API (Hugging Face Inference)
// ========================
const HF_TOKEN = process.env.HF_TOKEN || '';

// POST /api/ai/analyze-image — BLIP 이미지 캡셔닝
app.post('/api/ai/analyze-image', async (req, res) => {
    try {
        const { image } = req.body; // base64 data URL or URL
        if (!image) return res.status(400).json({ error: '이미지가 필요합니다.' });

        let imageBuffer;
        if (image.startsWith('data:')) {
            // base64 data URL → buffer
            const base64Data = image.split(',')[1];
            imageBuffer = Buffer.from(base64Data, 'base64');
        } else {
            // URL → fetch → buffer
            const fetch = (await import('node-fetch')).default;
            const imgRes = await fetch(image);
            if (!imgRes.ok) throw new Error('이미지 다운로드 실패');
            imageBuffer = Buffer.from(await imgRes.arrayBuffer());
        }

        if (!HF_TOKEN) {
            // HF 토큰이 없으면 Gemini 3 Flash Vision으로 대체 분석 (시각·공간 추론 강화)
            const base64 = imageBuffer.toString('base64');
            const mimeType = 'image/png';
            try {
                const result = await visionModel.generateContent([
                    { inlineData: { mimeType, data: base64 } },
                    '이 이미지를 디자인 전문가 관점에서 자세히 분석해주세요. 다음 항목을 포함하세요:\n1. 색상 팔레트 (HEX 코드 포함)\n2. 레이아웃 구조 (그리드, 섹션 배치)\n3. 타이포그래피 (폰트 스타일, 크기 비율)\n4. 시각적 스타일 (미니멀, 모던, 대담 등)\n5. 디자인 개선 제안\n한국어로 답변하세요.'
                ]);
                return res.json({ caption: result.response.text(), model: 'gemini-3-flash-preview' });
            } catch (geminiErr) {
                return res.json({ caption: '⚠️ 이미지 분석 불가 (API 키 설정 필요)', error: true });
            }
        }

        // Hugging Face BLIP API 호출
        const fetch = (await import('node-fetch')).default;
        const hfRes = await fetch('https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/octet-stream',
            },
            body: imageBuffer,
        });

        if (!hfRes.ok) {
            const errText = await hfRes.text();
            throw new Error(`HF API 오류: ${hfRes.status} - ${errText}`);
        }

        const data = await hfRes.json();
        const caption = Array.isArray(data) ? data[0]?.generated_text || '분석 결과 없음' : data.generated_text || '분석 결과 없음';

        res.json({ caption, model: 'blip-image-captioning-large' });
    } catch (err) {
        console.error('AI 이미지 분석 오류:', err.message);
        res.status(500).json({ error: err.message, caption: '⚠️ 이미지 분석 중 오류 발생: ' + err.message });
    }
});

// POST /api/ai/generate-image — Nano Banana 2 (gemini-3.1-flash-image-preview) 이미지 생성
app.post('/api/ai/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: '프롬프트가 필요합니다.' });

        // 1. Nano Banana 2 (gemini-3.1-flash-image-preview) — 최신 이미지 생성 모델
        const modelsToTry = [IMAGE_GEN_MODEL, IMAGE_GEN_FALLBACK];
        for (const modelName of modelsToTry) {
            try {
                console.log(`🎨 이미지 생성 시도: ${modelName}`);
                const result = await genAINB.models.generateContent({
                    model: modelName,
                    contents: [{
                        role: 'user',
                        parts: [{ text: `Generate an image: ${prompt}` }]
                    }],
                    config: { responseModalities: ['TEXT', 'IMAGE'] }
                });

                // 이미지 파트 찾기
                if (result.candidates && result.candidates[0]) {
                    const parts = result.candidates[0].content.parts || [];
                    for (const part of parts) {
                        if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                            const imgBase64 = part.inlineData.data;
                            const mimeType = part.inlineData.mimeType;
                            console.log(`✅ 이미지 생성 성공: ${modelName}`);
                            return res.json({
                                image: `data:${mimeType};base64,${imgBase64}`,
                                model: modelName
                            });
                        }
                    }
                }
            } catch (genErr) {
                console.log(`⚠️ ${modelName} 실패:`, genErr.message);
            }
        }

        // 2. Hugging Face Stable Diffusion XL 대체
        if (HF_TOKEN) {
            const fetch = (await import('node-fetch')).default;
            const hfRes = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${HF_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ inputs: prompt }),
            });

            if (!hfRes.ok) {
                const errText = await hfRes.text();
                throw new Error(`HF API 오류: ${hfRes.status} - ${errText}`);
            }

            const buffer = Buffer.from(await hfRes.arrayBuffer());
            const base64 = buffer.toString('base64');
            return res.json({
                image: `data:image/png;base64,${base64}`,
                model: 'stable-diffusion-xl-base-1.0'
            });
        }

        res.status(400).json({ error: 'AI 이미지 생성을 위해 HF_TOKEN 환경변수를 설정하세요.', message: '⚠️ HF_TOKEN 미설정' });
    } catch (err) {
        console.error('AI 이미지 생성 오류:', err.message);
        res.status(500).json({ error: err.message, message: '⚠️ 이미지 생성 중 오류 발생: ' + err.message });
    }
});

// ========================
// 디자인 스튜디오 API
// ========================

// 파일 업로드용 multer 설정 (디자인)
const designUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// POST /api/design/analyze — 이미지 분석 (톤앤매너 추출)
app.post('/api/design/analyze', designUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });

        const base64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/png';

        const result = await visionModel.generateContent([
            { inlineData: { mimeType, data: base64 } },
            `이 이미지의 디자인 톤앤매너를 분석해주세요. 반드시 다음 JSON 형식으로만 응답하세요:
{
  "colors": [{"hex": "#XXXXXX", "name": "색상명"}],
  "fonts": [{"name": "폰트명", "usage": "용도", "weight": "굵기"}],
  "styles": ["스타일키워드1", "스타일키워드2"],
  "scores": {"색상조화": 0.85, "레이아웃": 0.9, "가독성": 0.8, "전문성": 0.88}
}
JSON만 반환하세요.`
        ]);

        const text = result.response.text();
        let parsed;
        try {
            // JSON 블록 추출
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { colors: [], fonts: [], styles: ['분석됨'] };
        } catch {
            parsed = { colors: [], fonts: [], styles: ['분석됨'], rawText: text };
        }

        res.json(parsed);
    } catch (err) {
        console.error('디자인 분석 오류:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/design/modify — 이미지 부분 수정 (원본 이미지 + 명령 → 수정된 이미지)
app.post('/api/design/modify', async (req, res) => {
    try {
        const { message, analysis, imageUrl, attachmentDataUrl, sessionId } = req.body;
        if (!message && !imageUrl && !attachmentDataUrl) {
            return res.status(400).json({ error: '메시지 또는 이미지가 필요합니다.' });
        }

        // 이미지 데이터 추출
        let imageBase64 = null;
        let imageMime = 'image/png';

        if (attachmentDataUrl && attachmentDataUrl.startsWith('data:')) {
            const [header, data] = attachmentDataUrl.split(',');
            const mimeMatch = header.match(/data:([^;]+)/);
            imageMime = mimeMatch ? mimeMatch[1] : 'image/png';
            imageBase64 = data;
        } else if (imageUrl) {
            try {
                const fetch = (await import('node-fetch')).default;
                const imgRes = await fetch(imageUrl);
                if (imgRes.ok) {
                    const buffer = Buffer.from(await imgRes.arrayBuffer());
                    imageBase64 = buffer.toString('base64');
                }
            } catch (fetchErr) {
                console.log('이미지 다운로드 실패:', fetchErr.message);
            }
        }

        // 톤앤매너 컨텍스트 구성
        let contextText = '';
        if (analysis) {
            if (analysis.colors) contextText += `기존 색상: ${analysis.colors.map(c => c.hex).join(', ')}. `;
            if (analysis.fonts) contextText += `기존 폰트: ${analysis.fonts.map(f => f.name).join(', ')}. `;
            if (analysis.styles) contextText += `기존 스타일: ${analysis.styles.join(', ')}. `;
        }

        let responseText = '';
        let generatedImage = null;

        // === 이미지가 첨부된 경우: Nano Banana 2/Pro로 이미지 편집 ===
        if (imageBase64) {
            const editPrompt = `이 이미지에서 요청한 부분만 수정하세요. 절대 새로운 이미지를 처음부터 만들지 마세요.\n원본 이미지의 구도, 레이아웃, 스타일을 그대로 유지하면서 아래 요청 사항만 변경하세요.\n${contextText ? '톤앤매너: ' + contextText : ''}\n수정 요청: ${message}`;

            // 1차 시도: Nano Banana 2 (gemini-3.1-flash-image-preview)
            try {
                console.log('🖼️ Nano Banana 2로 이미지 편집 시도...');
                const editResult = await genAINB.models.generateContent({
                    model: IMAGE_GEN_MODEL,
                    contents: [{
                        role: 'user',
                        parts: [
                            { inlineData: { mimeType: imageMime, data: imageBase64 } },
                            { text: editPrompt }
                        ]
                    }],
                    config: { responseModalities: ['TEXT', 'IMAGE'] }
                });

                if (editResult.candidates && editResult.candidates[0]) {
                    const editParts = editResult.candidates[0].content.parts || [];
                    for (const part of editParts) {
                        if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                            generatedImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                            console.log('✅ Nano Banana 2 이미지 편집 성공');
                        }
                        if (part.text) {
                            responseText += part.text;
                        }
                    }
                }
            } catch (nb2Err) {
                console.log('⚠️ Nano Banana 2 편집 실패:', nb2Err.message);
            }

            // 2차 시도: Nano Banana Pro (fallback)
            if (!generatedImage) {
                try {
                    console.log('🖼️ Nano Banana Pro로 이미지 편집 재시도...');
                    const editResult2 = await genAINB.models.generateContent({
                        model: IMAGE_GEN_FALLBACK,
                        contents: [{
                            role: 'user',
                            parts: [
                                { inlineData: { mimeType: imageMime, data: imageBase64 } },
                                { text: editPrompt }
                            ]
                        }],
                        config: { responseModalities: ['TEXT', 'IMAGE'] }
                    });

                    if (editResult2.candidates && editResult2.candidates[0]) {
                        const editParts2 = editResult2.candidates[0].content.parts || [];
                        for (const part of editParts2) {
                            if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                                generatedImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                                console.log('✅ Nano Banana Pro 이미지 편집 성공');
                            }
                            if (part.text) responseText += part.text;
                        }
                    }
                } catch (nbpErr) {
                    console.log('⚠️ Nano Banana Pro 편집 실패:', nbpErr.message);
                }
            }

            // 3차 시도: Vision 모델로 분석만 제공 (이미지 편집 불가 시)
            if (!generatedImage && !responseText) {
                try {
                    const analysisResult = await visionModel.generateContent([
                        { inlineData: { mimeType: imageMime, data: imageBase64 } },
                        { text: `사용자가 이 이미지에 대해 다음 수정을 요청했습니다: "${message}"\n\n1. 이 이미지의 현재 상태를 분석해주세요.\n2. 요청된 수정 사항을 어떻게 적용하면 좋을지 구체적으로 안내해주세요.\n한국어로 답변하세요.` }
                    ]);
                    responseText = analysisResult.response.text();
                } catch (visionErr) {
                    responseText = '이미지 분석에 실패했습니다. 다시 시도해주세요.';
                }
            }

            if (!responseText) responseText = generatedImage ? '✅ 이미지가 수정되었습니다. 아래에서 다운로드하세요.' : '이미지 수정을 시도했으나 처리할 수 없었습니다.';

        } else {
            // === 이미지 없이 텍스트만: Vision 모델로 답변 ===
            try {
                const textResult = await visionModel.generateContent([
                    { text: `당신은 인팸 디자인 AI입니다. ${contextText}\n\n사용자 요청: ${message}\n\n디자인 전문가 관점에서 구체적으로 답변하세요. 한국어로 답변하세요.` }
                ]);
                responseText = textResult.response.text();
            } catch (textErr) {
                responseText = '⚠️ 처리 중 오류: ' + textErr.message;
            }
        }

        res.json({ response: responseText, generatedImage, analysis });

    } catch (err) {
        console.error('디자인 수정 오류:', err.message);
        res.status(500).json({ error: err.message, response: '⚠️ 처리 중 오류: ' + err.message });
    }
});

// POST /api/design/extract-images — URL에서 이미지 추출
app.post('/api/design/extract-images', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });

        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const images = [];
        const seen = new Set();

        $('img').each((i, el) => {
            let src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (!src || src.startsWith('data:')) return;
            if (!src.startsWith('http')) {
                try { src = new URL(src, url).href; } catch { return; }
            }
            if (seen.has(src)) return;
            seen.add(src);
            images.push({ url: src, alt: $(el).attr('alt') || '' });
        });

        res.json({ images: images.slice(0, 50) });
    } catch (err) {
        console.error('이미지 추출 오류:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================
// Ecount ERP API 프록시
// ========================
const ECOUNT_COM_CODE = process.env.ECOUNT_COM_CODE || '';
const ECOUNT_USER_ID = process.env.ECOUNT_USER_ID || '';
const ECOUNT_API_CERT_KEY = process.env.ECOUNT_API_CERT_KEY || '';

// Ecount 세션 캐시
let ecountSession = {
    zone: null,
    sessionId: null,
    lastLogin: null,
    baseUrl: null,
};

// Zone 조회
async function ecountGetZone() {
    try {
        const resp = await fetch('https://oapi.ecount.com/OAPI/V2/Zone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                COM_CODE: ECOUNT_COM_CODE,
                API_CERT_KEY: ECOUNT_API_CERT_KEY,
            }),
        });
        const data = await resp.json();
        if (data.Status == 200 && data.Data?.ZONE) {
            ecountSession.zone = data.Data.ZONE;
            ecountSession.baseUrl = `https://oapi${data.Data.ZONE}.ecount.com`;
            console.log(`📊 Ecount Zone 획득: ${data.Data.ZONE}, Base: ${ecountSession.baseUrl}`);
            return data.Data.ZONE;
        }
        console.error('❌ Ecount Zone 조회 실패:', JSON.stringify(data));
        return null;
    } catch (err) {
        console.error('❌ Ecount Zone 오류:', err.message);
        return null;
    }
}

// 로그인 → Session ID
async function ecountLogin() {
    if (!ecountSession.zone) {
        const zone = await ecountGetZone();
        if (!zone) return null;
    }
    try {
        const resp = await fetch(`${ecountSession.baseUrl}/OAPI/V2/OAPILogin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                COM_CODE: ECOUNT_COM_CODE,
                USER_ID: ECOUNT_USER_ID,
                API_CERT_KEY: ECOUNT_API_CERT_KEY,
                LAN_TYPE: 'ko-KR',
                ZONE: ecountSession.zone,
            }),
        });
        const data = await resp.json();
        const sessionId = data.Data?.Datas?.SESSION_ID || data.Data?.Sessionid || data.Data?.SESSION_ID;
        const hostUrl = data.Data?.Datas?.HOST_URL;
        const code = data.Data?.Code;
        if (sessionId && code === '00') {
            ecountSession.sessionId = sessionId;
            ecountSession.lastLogin = Date.now();
            if (hostUrl) {
                ecountSession.baseUrl = `https://${hostUrl}`;
                console.log(`📊 Ecount HOST_URL: ${hostUrl}`);
            }
            console.log('✅ Ecount 로그인 성공 (Session: ' + sessionId.substring(0, 20) + '...)');
            return sessionId;
        }
        const errMsg = data.Data?.Message || `Code: ${code}`;
        console.error(`❌ Ecount 로그인 실패: ${errMsg}`);
        console.error('   응답:', JSON.stringify(data));
        return null;
    } catch (err) {
        console.error('❌ Ecount 로그인 오류:', err.message);
        return null;
    }
}

// 세션 확보 (캐시 or 재로그인 — 30분마다 갱신)
async function ensureEcountSession() {
    const SESSION_TTL = 30 * 60 * 1000; // 30분
    if (ecountSession.sessionId && ecountSession.lastLogin && (Date.now() - ecountSession.lastLogin < SESSION_TTL)) {
        return ecountSession.sessionId;
    }
    return await ecountLogin();
}

// Ecount API 호출 헬퍼 (자동 재로그인)
async function ecountApiCall(endpoint, body = {}, method = 'POST') {
    const sessionId = await ensureEcountSession();
    if (!sessionId) return { error: 'Ecount 세션 확보 실패' };

    // SESSION_ID는 URL 쿼리 파라미터로 전달 (Ecount V2 표준)
    const url = `${ecountSession.baseUrl}/OAPI/V2/${endpoint}?SESSION_ID=${encodeURIComponent(sessionId)}`;
    try {
        const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: method === 'POST' ? JSON.stringify(body) : undefined,
        });
        const data = await resp.json();

        // 디버그 로깅
        const dataKeys = data.Data ? Object.keys(data.Data) : [];
        console.log(`📡 Ecount API [${endpoint}] Status=${data.Status}, DataKeys=[${dataKeys.join(',')}]`);
        if (data.Data?.Datas) {
            const datas = data.Data.Datas;
            const count = Array.isArray(datas) ? datas.length : typeof datas === 'object' ? Object.keys(datas).length : 0;
            console.log(`   ↳ Datas: ${count} items`);
        }
        if (data.Errors && data.Errors.length) {
            console.log(`   ↳ Errors: ${JSON.stringify(data.Errors)}`);
        }

        // 세션 만료 시 재로그인 후 재시도
        if (data.Status == 401 || data.Status == 403 ||
            (data.Errors && data.Errors.some(e => e.Message?.includes('login')))) {
            console.log('🔄 Ecount 세션 만료, 재로그인...');
            ecountSession.sessionId = null;
            const newSession = await ecountLogin();
            if (!newSession) return { error: '재로그인 실패' };
            const retryUrl = `${ecountSession.baseUrl}/OAPI/V2/${endpoint}?SESSION_ID=${encodeURIComponent(newSession)}`;
            const retryResp = await fetch(retryUrl, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: method === 'POST' ? JSON.stringify(body) : undefined,
            });
            return await retryResp.json();
        }

        return data;
    } catch (err) {
        console.error(`❌ Ecount API [${endpoint}] 오류:`, err.message);
        return { error: err.message };
    }
}

// Ecount 응답에서 실제 데이터 배열 추출 헬퍼
function extractEcountData(result) {
    if (!result || result.error) return [];
    // Ecount V2: Data.Datas (array or object)
    const datas = result?.Data?.Datas;
    if (Array.isArray(datas)) return datas;
    // Datas가 객체인 경우 (일부 API)
    if (datas && typeof datas === 'object') {
        // 값들이 배열이면 첫 번째 배열 반환
        const vals = Object.values(datas);
        for (const v of vals) {
            if (Array.isArray(v)) return v;
        }
        return [datas];
    }
    // Data.Result 폴백
    if (Array.isArray(result?.Data?.Result)) return result.Data.Result;
    if (Array.isArray(result?.Data)) return result.Data;
    return [];
}

// --- ERP API 엔드포인트 ---

// 재고 현황
app.get('/api/erp/inventory', async (req, res) => {
    try {
        const { page = 1, perPage = 100, searchText = '' } = req.query;
        const result = await ecountApiCall('InventoryBalance/GetListInventoryBalanceStatus', {
            PAGE: parseInt(page),
            PER_PAGE: parseInt(perPage),
            SEARCH_TEXT: searchText,
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 재고 (위치별)
app.get('/api/erp/inventory-by-location', async (req, res) => {
    try {
        const { page = 1, perPage = 100 } = req.query;
        const result = await ecountApiCall('InventoryBalance/GetListInventoryBalanceStatusByLocation', {
            PAGE: parseInt(page),
            PER_PAGE: parseInt(perPage),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 매출 현황
app.get('/api/erp/sales', async (req, res) => {
    try {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const { fromDate, toDate, page = 1, perPage = 100 } = req.query;
        const result = await ecountApiCall('Sale/GetListSaleSlip', {
            SL_FROM: fromDate || firstDay.toISOString().split('T')[0].replace(/-/g, ''),
            SL_TO: toDate || today.toISOString().split('T')[0].replace(/-/g, ''),
            PAGE: parseInt(page),
            PER_PAGE: parseInt(perPage),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 매입 현황
app.get('/api/erp/purchases', async (req, res) => {
    try {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const { fromDate, toDate, page = 1, perPage = 100 } = req.query;
        const result = await ecountApiCall('Purchase/GetListPurchaseSlip', {
            SL_FROM: fromDate || firstDay.toISOString().split('T')[0].replace(/-/g, ''),
            SL_TO: toDate || today.toISOString().split('T')[0].replace(/-/g, ''),
            PAGE: parseInt(page),
            PER_PAGE: parseInt(perPage),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 품목 목록
app.get('/api/erp/items', async (req, res) => {
    try {
        const { page = 1, perPage = 200, searchText = '' } = req.query;
        const result = await ecountApiCall('Item/GetListItem', {
            PAGE: parseInt(page),
            PER_PAGE: parseInt(perPage),
            SEARCH_TEXT: searchText,
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 종합 요약 (여러 API를 합산)
app.get('/api/erp/summary', async (req, res) => {
    try {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const fromDate = firstDay.toISOString().split('T')[0].replace(/-/g, '');
        const toDate = today.toISOString().split('T')[0].replace(/-/g, '');

        // 병렬 API 호출 (각각 에러 핸들링)
        const safeCall = async (ep, body) => {
            try { return await ecountApiCall(ep, body); }
            catch (e) { console.log(`⚠️ ERP API [${ep}] 실패: ${e.message}`); return { Status: 500, Data: {} }; }
        };
        const [inventoryResult, salesResult, purchasesResult] = await Promise.all([
            safeCall('InventoryBalance/GetListInventoryBalanceStatusByLocation', { BASE_DATE: toDate, PAGE: 1, PER_PAGE: 500 }),
            safeCall('Sale/SaveSale', { SL_FROM: fromDate, SL_TO: toDate, PAGE: 1, PER_PAGE: 500, SEARCH_TYPE: 'LIST' }),
            safeCall('Purchase/SavePurchase', { SL_FROM: fromDate, SL_TO: toDate, PAGE: 1, PER_PAGE: 500, SEARCH_TYPE: 'LIST' }),
        ]);

        // 재고 요약
        let totalInventoryQty = 0;
        let totalInventoryAmt = 0;
        let lowStockItems = [];
        let inventoryItems = extractEcountData(inventoryResult);
        let salesItems = extractEcountData(salesResult);
        let purchaseItems = extractEcountData(purchasesResult);
        console.log(`📊 API 결과 — 재고: ${inventoryItems.length}건, 매출: ${salesItems.length}건, 매입: ${purchaseItems.length}건`);

        // API 데이터가 모두 비어있으면 스크랩 데이터 사용
        if (inventoryItems.length === 0 && salesItems.length === 0 && purchaseItems.length === 0) {
            console.log('📂 API 데이터 비었음 → 스크랩 데이터 사용');
            try {
                const scraped = JSON.parse(fs.readFileSync(path.join(__dirname, 'erp-scraped-data.json'), 'utf8'));
                const salesAmt = scraped.summary?.totalSalesAmt || scraped.sales.reduce((s, i) => s + (i.amount || 0), 0);
                const purchaseAmt = scraped.summary?.totalPurchaseAmt || scraped.purchases.reduce((s, i) => s + (i.amount || 0), 0);
                const invQty = scraped.summary?.totalInventoryQty || scraped.inventory.reduce((s, i) => s + (i.qty || 0), 0);
                const lowStock = scraped.inventory.filter(i => i.qty > 0 && i.qty <= 10);
                return res.json({
                    success: true, source: 'scraped',
                    period: scraped.period,
                    inventory: { totalQty: invQty, totalAmt: 0, itemCount: scraped.inventory.length, lowStockItems: lowStock, raw: scraped.inventory },
                    sales: { totalAmt: salesAmt, count: scraped.sales.length, raw: scraped.sales },
                    purchases: { totalAmt: purchaseAmt, count: scraped.purchases.length, raw: scraped.purchases },
                    updatedAt: scraped.scrapedAt,
                });
            } catch (e) { console.log('⚠️ 스크랩 데이터 파일 없음'); }
        }

        inventoryItems.forEach(item => {
            const qty = parseFloat(item.BAL_QTY || item.QUANTITY || item.QTY || 0);
            const amt = parseFloat(item.BAL_AMT || item.AMOUNT || item.AMT || 0);
            totalInventoryQty += qty;
            totalInventoryAmt += amt;
            if (qty > 0 && qty <= 10) {
                lowStockItems.push({
                    name: item.PROD_DES || item.ITEM_NAME || item.PROD_NM || '품목',
                    code: item.PROD_CD || item.ITEM_CODE || '',
                    qty,
                });
            }
        });

        // 매출 요약
        let totalSalesAmt = 0;
        let salesCount = salesItems.length;
        salesItems.forEach(item => {
            totalSalesAmt += parseFloat(item.SUPPLY_AMT || item.AMOUNT || item.TOT_AMT || 0);
        });

        // 매입 요약
        let totalPurchasesAmt = 0;
        let purchasesCount = purchaseItems.length;
        purchaseItems.forEach(item => {
            totalPurchasesAmt += parseFloat(item.SUPPLY_AMT || item.AMOUNT || item.TOT_AMT || 0);
        });

        res.json({
            success: true,
            period: { from: fromDate, to: toDate },
            inventory: {
                totalQty: totalInventoryQty,
                totalAmt: totalInventoryAmt,
                itemCount: Array.isArray(inventoryItems) ? inventoryItems.length : 0,
                lowStockItems: lowStockItems.slice(0, 10),
                raw: inventoryItems,
            },
            sales: {
                totalAmt: totalSalesAmt,
                count: salesCount,
                raw: salesItems,
            },
            purchases: {
                totalAmt: totalPurchasesAmt,
                count: purchasesCount,
                raw: purchaseItems,
            },
            updatedAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error('❌ ERP 종합 요약 오류:', err.message);
        // Fallback to scraped data
        try {
            const scraped = JSON.parse(fs.readFileSync(path.join(__dirname, 'erp-scraped-data.json'), 'utf8'));
            const salesAmt = scraped.summary?.totalSalesAmt || scraped.sales.reduce((s, i) => s + (i.amount || 0), 0);
            const purchaseAmt = scraped.summary?.totalPurchaseAmt || scraped.purchases.reduce((s, i) => s + (i.amount || 0), 0);
            const invQty = scraped.summary?.totalInventoryQty || scraped.inventory.reduce((s, i) => s + (i.qty || 0), 0);
            const lowStock = scraped.inventory.filter(i => i.qty > 0 && i.qty <= 10);
            res.json({
                success: true, source: 'scraped',
                period: scraped.period,
                inventory: { totalQty: invQty, totalAmt: 0, itemCount: scraped.inventory.length, lowStockItems: lowStock, raw: scraped.inventory },
                sales: { totalAmt: salesAmt, count: scraped.sales.length, raw: scraped.sales },
                purchases: { totalAmt: purchaseAmt, count: scraped.purchases.length, raw: scraped.purchases },
                updatedAt: scraped.scrapedAt,
            });
        } catch (e2) {
            res.status(500).json({ error: err.message });
        }
    }
});

// 스크랩된 데이터 직접 제공
app.get('/api/erp/scraped', (req, res) => {
    try {
        const scraped = JSON.parse(fs.readFileSync(path.join(__dirname, 'erp-scraped-data.json'), 'utf8'));
        res.json({ success: true, ...scraped });
    } catch (e) {
        res.status(404).json({ error: '스크랩된 데이터가 없습니다.' });
    }
});

// Ecount 세션 상태 확인
app.get('/api/erp/status', (req, res) => {
    res.json({
        connected: !!ecountSession.sessionId,
        zone: ecountSession.zone,
        lastLogin: ecountSession.lastLogin ? new Date(ecountSession.lastLogin).toISOString() : null,
        configured: !!(ECOUNT_COM_CODE && ECOUNT_USER_ID && ECOUNT_API_CERT_KEY),
    });
});

// ========================
// AI 이미지 최적화 (Nano Banana 2 — Gemini 3.1 Flash Image)
// ========================
app.post('/api/ai/enhance', async (req, res) => {
    try {
        const { image, mode } = req.body;
        if (!image) return res.status(400).json({ success: false, message: '이미지가 필요합니다.' });

        // base64 데이터 추출 (JPEG만 사용 — Gemini 이미지 모델 요구사항)
        let base64Data;
        const base64Match = image.match(/^data:image\/\w+;base64,(.+)$/);
        if (!base64Match) return res.status(400).json({ success: false, message: '올바른 이미지 형식이 아닙니다.' });
        base64Data = base64Match[1];

        // 최적화 프롬프트 (professional 전문 보정)
        const prompt = mode === 'professional'
            ? 'Enhance this image to professional commercial photography quality. Improve lighting naturally, optimize color temperature, increase sharpness and clarity, reduce noise, enhance details. Keep the original composition and content exactly the same. Output a high-quality enhanced version.'
            : 'Enhance this image quality: improve brightness, contrast, color saturation, sharpness. Remove noise. Keep original composition and content unchanged. Output enhanced image.';

        console.log(`🎨 AI 이미지 최적화 시작 (모드: ${mode || 'auto'}, 키: ${GEMINI_IMAGE_API_KEY ? '설정됨' : '미설정'})`);

        // @google/genai SDK로 이미지 편집
        let result = null;
        const modelList = [IMAGE_GEN_MODEL, IMAGE_GEN_FALLBACK];

        for (const modelName of modelList) {
            try {
                console.log(`  → 시도: ${modelName}`);
                const response = await genAINB.models.generateContent({
                    model: modelName,
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: base64Data
                                    }
                                },
                                { text: prompt }
                            ]
                        }
                    ],
                    config: {
                        responseModalities: ['Text', 'Image'],
                    }
                });

                console.log(`  → 응답 수신, candidates: ${response.candidates?.length || 0}`);

                // 응답에서 이미지 부분 추출
                if (response?.candidates?.[0]?.content?.parts) {
                    for (const part of response.candidates[0].content.parts) {
                        if (part.inlineData?.data) {
                            result = {
                                mimeType: part.inlineData.mimeType || 'image/jpeg',
                                data: part.inlineData.data
                            };
                            console.log(`  ✅ 이미지 추출 성공 (${modelName})`);
                            break;
                        }
                    }
                }

                if (result) break;
                console.log(`  ⚠️ ${modelName}: 이미지 파트 없음`);

            } catch (modelErr) {
                console.error(`  ❌ ${modelName} 실패:`, modelErr.message);
            }
        }

        if (!result) {
            return res.status(500).json({
                success: false,
                message: 'AI 이미지 최적화에 실패했습니다. 이미지 모델이 아직 지원되지 않거나 API 한도를 초과했을 수 있습니다.'
            });
        }

        res.json({
            success: true,
            image: `data:${result.mimeType};base64,${result.data}`,
            model: 'Nano Banana 2'
        });

    } catch (e) {
        console.error('❌ AI 최적화 오류:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================
// Instagram Graph API 엔드포인트
// ========================

// 계정 정보 조회
app.get('/api/ig/account', async (req, res) => {
    try {
        const info = await igGraphApi.getAccountInfo();
        res.json(info);
    } catch (e) {
        res.status(500).json({ connected: false, message: e.message });
    }
});

// 즉시 게시
app.post('/api/ig/publish', async (req, res) => {
    try {
        const { image, caption } = req.body;
        if (!image) return res.status(400).json({ success: false, message: '이미지가 필요합니다.' });
        const result = await igGraphApi.publishImage(image, caption);
        res.json(result);
    } catch (e) {
        console.error('❌ Instagram 게시 실패:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 예약 게시
app.post('/api/ig/schedule', async (req, res) => {
    try {
        const { image, caption, scheduledAt } = req.body;
        if (!image || !scheduledAt) return res.status(400).json({ success: false, message: '이미지와 예약 시간이 필요합니다.' });
        const result = await igGraphApi.scheduleImage(image, caption, scheduledAt);
        res.json(result);
    } catch (e) {
        console.error('❌ Instagram 예약 실패:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================
// AI 자동 라벨 감지 API (Gemini Vision)
// ========================
app.post('/api/ai/auto-label', async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: '이미지가 필요합니다.' });

    try {
        console.log('🏷️ AI 자동 라벨 감지 시작...');

        const base64Match = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
        if (!base64Match) throw new Error('유효하지 않은 이미지 형식');

        const mimeType = `image/${base64Match[1]}`;
        const base64Data = base64Match[2];

        const prompt = `당신은 인테리어 자재 전문가입니다. 이 사진을 분석하여 보이는 자재/제품을 식별해주세요.

각 자재에 대해 다음 정보를 JSON 배열로 반환하세요:
- text: 자재의 제품명 또는 코드 (예: "ss-13", "오크 바닥재", "대리석 타일", "PVC 몰딩" 등). 가능하면 구체적인 제품 코드 형식으로 작성.
- x: 해당 자재가 사진에서 위치하는 x 좌표 비율 (0.0~1.0, 왼쪽이 0, 오른쪽이 1)
- y: 해당 자재가 사진에서 위치하는 y 좌표 비율 (0.0~1.0, 위가 0, 아래가 1)
- pointerX: 라벨이 가리킬 정확한 자재 위치의 x 비율 (자재의 중심점)
- pointerY: 라벨이 가리킬 정확한 자재 위치의 y 비율 (자재의 중심점)

라벨 위치(x,y)는 포인터 위치에서 약간 떨어진 곳에 배치하세요 (겹치지 않도록).
최대 5개까지만 식별하세요.

반드시 아래 형식의 JSON만 출력하세요. 다른 텍스트는 포함하지 마세요:
[{"text":"제품명","x":0.3,"y":0.2,"pointerX":0.4,"pointerY":0.5}]`;

        const result = await genAINB.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: prompt }
                ]
            }],
            config: { temperature: 0.3, maxOutputTokens: 500 }
        });

        let responseText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        // JSON 추출 (```json ... ``` 감싸기 처리)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('라벨 데이터를 추출할 수 없습니다.');

        const labels = JSON.parse(jsonMatch[0]);
        console.log(`✅ AI 자동 라벨 감지 완료: ${labels.length}개 자재 식별`);
        res.json({ success: true, labels });
    } catch (err) {
        console.error('❌ 자동 라벨 오류:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========================
// AI 인스타 캡션 자동 생성 API
// ========================
app.post('/api/ai/generate-caption', async (req, res) => {
    const { productName, tone } = req.body;
    if (!productName) return res.status(400).json({ success: false, message: '제품명이 필요합니다.' });

    try {
        console.log(`✍️ AI 캡션 생성 요청: ${productName}`);

        const prompt = `당신은 인테리어 자재 전문 인스타그램 마케터입니다.
아래 제품에 대한 인스타그램 게시물 캡션을 한국어로 작성해주세요.

제품명: ${productName}
톤: ${tone || '전문적이면서 세련된'}

규칙:
1. 첫 줄은 눈에 띄는 후킹 문구 (이모지 포함)
2. 제품의 장점과 적용 공간을 자연스럽게 설명 (2~3문장)
3. 시공/인테리어 팁 한 줄
4. CTA(Call to Action) 문구
5. 관련 해시태그 8~12개 (마지막 줄)
6. 전체 길이는 인스타그램에 적합하게 200~400자
7. 브랜드명 @interior__family 를 자연스럽게 포함

캡션만 출력하세요. 다른 설명은 하지 마세요.`;

        const result = await genAINB.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.8, maxOutputTokens: 600 }
        });

        const caption = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!caption) throw new Error('캡션 생성 실패');

        console.log(`✅ 캡션 생성 완료 (${caption.length}자)`);
        res.json({ success: true, caption });
    } catch (err) {
        console.error('❌ 캡션 생성 오류:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========================
// AI 이미지 최적화 API (Nano Banana 2)
// ========================
app.post('/api/ai/enhance', async (req, res) => {
    const { image, mode } = req.body;
    if (!image) return res.status(400).json({ success: false, message: '이미지가 필요합니다.' });

    try {
        // base64 데이터 추출 (data:image/jpeg;base64,... 형식 처리)
        const base64Match = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
        if (!base64Match) throw new Error('유효하지 않은 이미지 형식입니다.');

        const mimeType = `image/${base64Match[1]}`;
        const base64Data = base64Match[2];

        console.log(`🤖 AI 이미지 최적화 요청 (모드: ${mode || 'professional'})`);

        const prompt = mode === '4k-upscale'
            ? `이 이미지를 4K 해상도(3840x2160 이상)로 업스케일해주세요:
- 초고해상도 업스케일링: 픽셀을 보간하여 4K 수준의 선명한 디테일 생성
- 텍스처 복원: 업스케일 과정에서 손실되는 텍스처를 AI로 복원
- 노이즈 제거: 업스케일 시 발생하는 아티팩트 제거
- 엣지 선명도: 경계선을 자연스럽고 선명하게 처리
- 인테리어 제품 사진에 최적화된 전문적인 품질로 출력
원본 이미지의 구조와 색상을 유지하면서 해상도만 극대화해주세요.`
            : `이 이미지를 최고 품질로 향상시켜주세요:
- 고해상도 업스케일링: 세부 텍스처와 선명도 극대화
- 색상 보정: 자연스럽고 생동감 있는 색상, 화이트 밸런스 최적화
- 선명도 향상: 엣지 및 디테일 강조
- 노이즈 제거: 깔끔하고 선명한 결과물
- 인테리어 제품 사진에 최적화된 전문적인 품질로 출력
원본 이미지의 구조와 내용을 유지하면서 품질만 향상시켜주세요.`;

        // Nano Banana 2 (gemini-3.1-flash-image-preview) 시도
        let resultImage = null;
        let usedModel = IMAGE_GEN_MODEL;

        for (const modelName of [IMAGE_GEN_MODEL, IMAGE_GEN_FALLBACK]) {
            try {
                const result = await genAINB.models.generateContent({
                    model: modelName,
                    contents: [{
                        role: 'user',
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            },
                            { text: prompt }
                        ]
                    }],
                    config: {
                        responseModalities: ['IMAGE', 'TEXT'],
                        temperature: 0.2
                    }
                });

                // 응답에서 이미지 추출
                if (result.candidates && result.candidates[0]) {
                    const parts = result.candidates[0].content.parts;
                    for (const part of parts) {
                        if (part.inlineData && part.inlineData.data) {
                            resultImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                            usedModel = modelName;
                            break;
                        }
                    }
                }

                if (resultImage) {
                    console.log(`✅ AI 이미지 최적화 성공 (모델: ${usedModel})`);
                    break;
                }
            } catch (modelErr) {
                console.log(`⚠️ 모델 ${modelName} 실패:`, modelErr.message);
                if (modelName === IMAGE_GEN_FALLBACK) throw modelErr;
            }
        }

        if (!resultImage) {
            throw new Error('이미지 생성 결과를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }

        return res.json({
            success: true,
            image: resultImage,
            model: usedModel,
            message: 'AI 최적화 완료'
        });

    } catch (err) {
        console.error('❌ AI 이미지 최적화 오류:', err.message);

        // API 키 문제나 모델 없음 오류인 경우 더 명확한 메시지
        let userMessage = err.message;
        if (err.message.includes('API_KEY') || err.message.includes('401')) {
            userMessage = 'API 키 오류입니다. 서버 환경변수를 확인해 주세요.';
        } else if (err.message.includes('404') || err.message.includes('not found')) {
            userMessage = '이미지 생성 모델을 사용할 수 없습니다. API 키 권한을 확인해 주세요.';
        } else if (err.message.includes('429')) {
            userMessage = 'API 호출 한도 초과입니다. 잠시 후 다시 시도해 주세요.';
        }

        return res.status(500).json({ success: false, message: userMessage });
    }
});

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

    // 로컬 환경에서만 자식 서비스 실행 (클라우드에는 Python 서비스 없음)
    if (!process.env.RENDER) {
        startContentDashboard();
    } else {
        console.log('☁️ 클라우드 환경 — 자식 서비스(콘텐츠 대시보드/Qwen) 스킵');
    }
});
