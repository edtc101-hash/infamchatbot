/**
 * 로컬 TF-IDF 기반 임베딩 생성기
 * 외부 API 없이 로컬에서 텍스트 벡터화
 * 한국어 + 영어 지원, n-gram 기반
 */

// 글로벌 어휘 사전 (문서 전체에서 구축)
let vocabulary = new Map(); // word -> index
let idfValues = new Map();  // word -> IDF value
let vocabBuilt = false;

/**
 * 한국어/영어 텍스트 토큰화
 */
function tokenize(text) {
    const normalized = text.toLowerCase()
        .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const words = normalized.split(' ').filter(w => w.length >= 2);

    // 2-gram 추가 (의미 포착 강화)
    const bigrams = [];
    for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(words[i] + '_' + words[i + 1]);
    }

    return [...words, ...bigrams];
}

/**
 * 문서 집합에서 어휘 사전 및 IDF 구축
 * @param {string[]} documents - 전체 문서 배열
 */
function buildVocabulary(documents) {
    const docFreq = new Map(); // word -> 등장 문서 수
    const allTokens = new Set();

    // 문서별 단어 빈도 계산
    for (const doc of documents) {
        const tokens = new Set(tokenize(doc));
        for (const token of tokens) {
            allTokens.add(token);
            docFreq.set(token, (docFreq.get(token) || 0) + 1);
        }
    }

    // 빈도 기반 필터링: 너무 흔하거나 너무 드문 단어 제외
    const N = documents.length;
    const filteredTokens = [];
    for (const token of allTokens) {
        const df = docFreq.get(token) || 0;
        // 전체 문서의 80% 이상에 나타나면 제외 (불용어), 1회만 나타나면 유지 (고유 용어)
        if (df / N <= 0.8) {
            filteredTokens.push(token);
        }
    }

    // 빈도순 정렬 후 상위 N개 선택 (벡터 차원 제한)
    const MAX_DIM = 512;
    filteredTokens.sort((a, b) => (docFreq.get(b) || 0) - (docFreq.get(a) || 0));
    const selectedTokens = filteredTokens.slice(0, MAX_DIM);

    // 어휘 사전 구축
    vocabulary = new Map();
    idfValues = new Map();
    selectedTokens.forEach((token, idx) => {
        vocabulary.set(token, idx);
        const df = docFreq.get(token) || 1;
        idfValues.set(token, Math.log(N / df) + 1);
    });

    vocabBuilt = true;
    console.log(`📚 TF-IDF 어휘 사전 구축: ${vocabulary.size}개 단어, ${N}개 문서 기반`);
}

/**
 * TF-IDF 벡터 생성
 * @param {string} text - 입력 텍스트
 * @returns {number[]} TF-IDF 벡터
 */
function generateEmbeddingSync(text) {
    if (!vocabBuilt || vocabulary.size === 0) {
        return [];
    }

    const tokens = tokenize(text);
    const tf = new Map();

    // Term Frequency 계산
    for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
    }

    // TF-IDF 벡터 생성
    const vector = new Array(vocabulary.size).fill(0);
    for (const [token, freq] of tf) {
        const idx = vocabulary.get(token);
        if (idx !== undefined) {
            const tfVal = 1 + Math.log(freq); // 로그 스케일 TF
            const idfVal = idfValues.get(token) || 1;
            vector[idx] = tfVal * idfVal;
        }
    }

    // L2 정규화
    let norm = 0;
    for (const val of vector) norm += val * val;
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < vector.length; i++) {
            vector[i] /= norm;
        }
    }

    return vector;
}

/**
 * 임베딩 생성 (비동기 인터페이스 유지, 내부는 동기)
 * @param {string} text
 * @param {string} apiKey - 미사용 (호환성 유지)
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text, apiKey) {
    return generateEmbeddingSync(text);
}

/**
 * 배치 임베딩 생성
 * 어휘 사전이 없으면 먼저 구축
 */
async function generateEmbeddingsBatch(texts, apiKey, onProgress) {
    // 어휘 사전 구축 (최초 1회)
    if (!vocabBuilt) {
        buildVocabulary(texts);
    }

    const results = [];
    for (let i = 0; i < texts.length; i++) {
        const embedding = generateEmbeddingSync(texts[i]);
        results.push(embedding);
        if (onProgress && (i % 20 === 0 || i === texts.length - 1)) {
            onProgress(i + 1, texts.length);
        }
    }
    return results;
}

/** 캐시 통계 (호환성) */
function getCacheStats() {
    return {
        vocabularySize: vocabulary.size,
        vocabBuilt,
    };
}

/** 어휘 사전 리셋 */
function clearCache() {
    vocabulary = new Map();
    idfValues = new Map();
    vocabBuilt = false;
}

module.exports = {
    generateEmbedding,
    generateEmbeddingsBatch,
    getCacheStats,
    clearCache,
    buildVocabulary,
};
