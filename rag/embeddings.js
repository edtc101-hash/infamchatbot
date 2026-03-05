/**
 * Gemini Embedding API 기반 임베딩 생성기
 * text-embedding-004 → gemini-embedding-001 (3072차원, 100+ 언어 지원)
 * 의미 기반 벡터 검색을 위한 실제 신경망 임베딩
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = path.join(__dirname, '..', 'rag-data', 'embedding-cache.json');

// 임베딩 캐시 (API 호출 절약)
let embeddingCache = new Map();
let cacheLoaded = false;

/** 캐시 로드 */
function loadCache() {
    if (cacheLoaded) return;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            embeddingCache = new Map(Object.entries(data));
            console.log(`📦 임베딩 캐시 로드: ${embeddingCache.size}개`);
        }
    } catch (e) {
        console.warn('임베딩 캐시 로드 실패:', e.message);
    }
    cacheLoaded = true;
}

/** 캐시 저장 */
function saveCache() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = Object.fromEntries(embeddingCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf-8');
    } catch (e) {
        console.warn('임베딩 캐시 저장 실패:', e.message);
    }
}

/** 캐시 키 생성 (SHA-256 해시 — 충돌 방지) */
function cacheKey(text) {
    const str = text.trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(str, 'utf-8').digest('hex').substring(0, 16);
    return `emb_${hash}`;
}

/**
 * Gemini Embedding API로 단일 텍스트 임베딩 생성
 * @param {string} text - 입력 텍스트
 * @param {string} apiKey - Gemini API 키
 * @returns {Promise<number[]>} 768차원 임베딩 벡터
 */
async function generateEmbedding(text, apiKey) {
    loadCache();
    const key = cacheKey(text);
    if (embeddingCache.has(key)) {
        return embeddingCache.get(key);
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'models/gemini-embedding-001',
                    content: { parts: [{ text }] },
                    outputDimensionality: 768  // MRL: 768차원으로 축소 (성능 최적화)
                })
            }
        );

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Embedding API ${response.status}: ${errBody.substring(0, 200)}`);
        }

        const data = await response.json();
        const embedding = data.embedding?.values;
        if (!embedding || embedding.length === 0) {
            throw new Error('빈 임베딩 반환됨');
        }

        embeddingCache.set(key, embedding);
        return embedding;
    } catch (err) {
        console.error(`임베딩 생성 실패: ${err.message}`);
        return [];
    }
}

/**
 * 배치 임베딩 생성 (레이트 리밋 핸들링 포함)
 * @param {string[]} texts - 입력 텍스트 배열
 * @param {string} apiKey - Gemini API 키
 * @param {Function} onProgress - 진행 콜백
 * @returns {Promise<number[][]>} 임베딩 벡터 배열
 */
async function generateEmbeddingsBatch(texts, apiKey, onProgress) {
    loadCache();

    const results = [];
    let apiCalls = 0;
    let cacheHits = 0;
    const BATCH_SIZE = 5;      // 동시 요청 수
    const DELAY_MS = 200;      // 배치 간 딜레이

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (text) => {
            const key = cacheKey(text);
            if (embeddingCache.has(key)) {
                cacheHits++;
                return embeddingCache.get(key);
            }

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'models/gemini-embedding-001',
                            content: { parts: [{ text }] },
                            outputDimensionality: 768
                        })
                    }
                );

                if (response.status === 429) {
                    // 레이트 리밋 — 잠시 대기 후 재시도
                    await new Promise(r => setTimeout(r, 3000));
                    const retryResp = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: 'models/gemini-embedding-001',
                                content: { parts: [{ text }] },
                                outputDimensionality: 768
                            })
                        }
                    );
                    if (!retryResp.ok) return [];
                    const retryData = await retryResp.json();
                    const emb = retryData.embedding?.values || [];
                    if (emb.length > 0) embeddingCache.set(key, emb);
                    apiCalls++;
                    return emb;
                }

                if (!response.ok) {
                    console.warn(`임베딩 실패 (${response.status}): ${text.substring(0, 40)}...`);
                    return [];
                }

                const data = await response.json();
                const emb = data.embedding?.values || [];
                if (emb.length > 0) {
                    embeddingCache.set(key, emb);
                    apiCalls++;
                }
                return emb;
            } catch (err) {
                console.warn(`임베딩 오류: ${err.message}`);
                return [];
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (onProgress) {
            onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length);
        }

        // 레이트 리밋 방지 딜레이
        if (i + BATCH_SIZE < texts.length && apiCalls > 0) {
            await new Promise(r => setTimeout(r, DELAY_MS));
        }
    }

    // 캐시 저장
    saveCache();
    console.log(`🧠 임베딩 완료: API ${apiCalls}회 호출, 캐시 ${cacheHits}회 히트`);

    return results;
}

/** 캐시 통계 */
function getCacheStats() {
    return {
        cacheSize: embeddingCache.size,
        cacheLoaded,
    };
}

/** 캐시 초기화 */
function clearCache() {
    embeddingCache = new Map();
    cacheLoaded = false;
    try {
        if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch (e) { }
}

module.exports = {
    generateEmbedding,
    generateEmbeddingsBatch,
    getCacheStats,
    clearCache,
};
