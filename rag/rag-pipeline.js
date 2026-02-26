/**
 * RAG 파이프라인
 * FAQ, 제품, 학습 데이터를 벡터 스토어에 인덱싱하고
 * 쿼리에 대한 의미 기반 검색을 수행
 */

const fs = require('fs');
const path = require('path');
const { addDocumentsBatch, searchByEmbedding, getStats, clearVectors } = require('./vector-store');
const { generateEmbedding, generateEmbeddingsBatch } = require('./embeddings');

const FAQ_FILE = path.join(__dirname, '..', 'faq-data.json');
const PRODUCT_FILE = path.join(__dirname, '..', 'product-data.json');
const LEARNED_FILE = path.join(__dirname, '..', 'learned-data.json');
const BUILD_STATUS_FILE = path.join(__dirname, '..', 'rag-data', 'build-status.json');

let isBuilding = false;
let apiKey = null;

/** API 키 설정 */
function setApiKey(key) {
    apiKey = key;
}

/** 빌드 상태 저장 */
function saveBuildStatus(status) {
    const dir = path.dirname(BUILD_STATUS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BUILD_STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

/** 빌드 상태 로드 */
function loadBuildStatus() {
    if (!fs.existsSync(BUILD_STATUS_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(BUILD_STATUS_FILE, 'utf-8'));
    } catch { return null; }
}

/**
 * FAQ 데이터를 벡터 문서로 변환
 */
function prepareFAQDocuments() {
    if (!fs.existsSync(FAQ_FILE)) return [];
    const faqs = JSON.parse(fs.readFileSync(FAQ_FILE, 'utf-8'));
    return faqs
        .filter(f => f.enabled !== false)
        .map(faq => ({
            id: `faq_${faq.id || faq.question.substring(0, 20)}`,
            title: faq.question,
            content: `[${faq.category}] Q: ${faq.question}\nA: ${faq.answer}`,
            category: 'FAQ',
            keywords: faq.keywords || [],
        }));
}

/**
 * 제품 데이터를 벡터 문서로 변환 (카테고리별로 그룹핑)
 */
function prepareProductDocuments() {
    if (!fs.existsSync(PRODUCT_FILE)) return [];
    const products = JSON.parse(fs.readFileSync(PRODUCT_FILE, 'utf-8'));

    // 카테고리별로 그룹핑하여 하나의 문서로 만듦
    const categorized = {};
    for (const p of products) {
        const cat = p.category || '기타';
        if (!categorized[cat]) categorized[cat] = [];
        categorized[cat].push(p);
    }

    const docs = [];
    for (const [cat, prods] of Object.entries(categorized)) {
        // 카테고리 요약 문서
        const summary = prods.slice(0, 10).map(p =>
            `제품번호: ${p.productId}, 디자인: ${p.design}, 규격: ${p.spec}, 가격: ${p.price}`
        ).join('\n');

        docs.push({
            id: `product_cat_${cat.replace(/\s+/g, '_')}`,
            title: `${cat} 제품 카탈로그`,
            content: `[제품 카테고리: ${cat}] 총 ${prods.length}개 제품\n${summary}${prods.length > 10 ? `\n... 외 ${prods.length - 10}개 제품` : ''}`,
            category: '제품',
        });
    }

    return docs;
}

/**
 * 학습 데이터를 벡터 문서로 변환
 */
function prepareLearnedDocuments() {
    if (!fs.existsSync(LEARNED_FILE)) return [];
    try {
        const learned = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf-8'));
        return learned.map(item => ({
            id: `learned_${item.id || Date.now()}`,
            title: item.question || '학습 데이터',
            content: `[${item.category}] Q: ${item.question}\nA: ${item.answer}`,
            category: '학습',
            keywords: item.keywords || [],
        }));
    } catch { return []; }
}

/**
 * 전체 벡터 스토어 빌드 (FAQ + 제품 + 학습 데이터)
 * 서버 시작 시 또는 수동으로 호출
 */
async function buildVectorStore() {
    if (isBuilding) {
        console.log('⚠️ 벡터 스토어 빌드 진행 중... 중복 요청 무시');
        return { success: false, reason: 'already_building' };
    }
    if (!apiKey) {
        console.error('❌ API 키가 설정되지 않았습니다.');
        return { success: false, reason: 'no_api_key' };
    }

    isBuilding = true;
    const startTime = Date.now();
    console.log('🔨 RAG 벡터 스토어 빌드 시작...');

    try {
        // 1. 모든 문서 준비
        const faqDocs = prepareFAQDocuments();
        const productDocs = prepareProductDocuments();
        const learnedDocs = prepareLearnedDocuments();
        const allDocs = [...faqDocs, ...productDocs, ...learnedDocs];

        console.log(`📄 문서 준비 완료: FAQ ${faqDocs.length}개, 제품 ${productDocs.length}개, 학습 ${learnedDocs.length}개 (총 ${allDocs.length}개)`);

        if (allDocs.length === 0) {
            console.log('⚠️ 인덱싱할 문서가 없습니다.');
            isBuilding = false;
            return { success: true, totalDocuments: 0 };
        }

        // 2. 임베딩 생성
        const texts = allDocs.map(d => d.content);
        console.log('🧠 임베딩 생성 중...');

        const embeddings = await generateEmbeddingsBatch(texts, apiKey, (current, total) => {
            if (current % 10 === 0 || current === total) {
                console.log(`  📊 진행율: ${current}/${total} (${Math.round(current / total * 100)}%)`);
            }
        });

        // 3. 벡터 문서 생성 및 저장
        const vectorDocs = allDocs.map((doc, i) => ({
            ...doc,
            embedding: embeddings[i] || [],
            createdAt: new Date().toISOString(),
        })).filter(d => d.embedding.length > 0); // 빈 임베딩 제외

        clearVectors();
        const totalStored = addDocumentsBatch(vectorDocs);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const status = {
            success: true,
            totalDocuments: totalStored,
            faqCount: faqDocs.length,
            productCount: productDocs.length,
            learnedCount: learnedDocs.length,
            failedEmbeddings: allDocs.length - vectorDocs.length,
            buildTime: `${elapsed}s`,
            builtAt: new Date().toISOString(),
        };

        saveBuildStatus(status);
        console.log(`✅ RAG 벡터 스토어 빌드 완료! ${totalStored}개 문서, ${elapsed}초 소요`);

        isBuilding = false;
        return status;
    } catch (err) {
        console.error('❌ 벡터 스토어 빌드 실패:', err.message);
        isBuilding = false;
        return { success: false, reason: err.message };
    }
}

/**
 * RAG 검색: 쿼리 텍스트로 관련 문서 검색
 * @param {string} query - 검색 쿼리
 * @param {number} limit - 반환할 문서 수
 * @returns {Promise<Array>} 관련 문서 배열 (score 포함)
 */
async function ragSearch(query, limit = 5) {
    if (!apiKey) return [];

    try {
        const queryEmbedding = await generateEmbedding(query, apiKey);
        const results = searchByEmbedding(queryEmbedding, limit, 0.3);
        return results;
    } catch (err) {
        console.error('RAG 검색 오류:', err.message);
        return [];
    }
}

/**
 * RAG 상태 정보
 */
function getRAGStatus() {
    const stats = getStats();
    const buildStatus = loadBuildStatus();
    return {
        ...stats,
        buildStatus,
        isBuilding,
    };
}

module.exports = {
    setApiKey,
    buildVectorStore,
    ragSearch,
    getRAGStatus,
    prepareFAQDocuments,
    prepareProductDocuments,
    prepareLearnedDocuments,
};
