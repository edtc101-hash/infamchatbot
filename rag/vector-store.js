/**
 * 로컬 JSON 기반 벡터 스토어
 * mcp-ragchat의 vector-store.ts를 JavaScript로 포팅
 * 코사인 유사도 검색으로 의미 기반 문서 검색
 */

const fs = require('fs');
const path = require('path');

const VECTORS_DIR = path.join(__dirname, '..', 'rag-data');

// 디렉토리 초기화
if (!fs.existsSync(VECTORS_DIR)) {
    fs.mkdirSync(VECTORS_DIR, { recursive: true });
}

function vectorsPath() {
    return path.join(VECTORS_DIR, 'vectors.json');
}

/** 벡터 데이터 로드 */
function loadVectors() {
    const p = vectorsPath();
    if (!fs.existsSync(p)) return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
        console.error('벡터 데이터 로드 오류:', e.message);
        return [];
    }
}

/** 벡터 데이터 저장 */
function saveVectors(docs) {
    fs.writeFileSync(vectorsPath(), JSON.stringify(docs, null, 2), 'utf-8');
}

/** 문서 추가 (같은 ID면 교체) */
function addDocument(doc) {
    const docs = loadVectors();
    const idx = docs.findIndex(d => d.id === doc.id);
    if (idx >= 0) docs[idx] = doc;
    else docs.push(doc);
    saveVectors(docs);
}

/** 여러 문서 일괄 추가 (성능 최적화) */
function addDocumentsBatch(newDocs) {
    const docs = loadVectors();
    for (const doc of newDocs) {
        const idx = docs.findIndex(d => d.id === doc.id);
        if (idx >= 0) docs[idx] = doc;
        else docs.push(doc);
    }
    saveVectors(docs);
    return docs.length;
}

/** 코사인 유사도 계산 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

/** 임베딩 벡터로 유사 문서 검색 */
function searchByEmbedding(queryEmbedding, limit = 5, minScore = 0.3) {
    const docs = loadVectors();
    if (docs.length === 0) return [];

    const scored = docs
        .map(doc => ({
            id: doc.id,
            title: doc.title,
            content: doc.content,
            category: doc.category || '',
            score: cosineSimilarity(queryEmbedding, doc.embedding),
        }))
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return scored;
}

/** 벡터 스토어 통계 */
function getStats() {
    const docs = loadVectors();
    const categories = {};
    docs.forEach(d => {
        const cat = d.category || '기타';
        categories[cat] = (categories[cat] || 0) + 1;
    });

    const p = vectorsPath();
    let lastBuilt = null;
    if (fs.existsSync(p)) {
        lastBuilt = fs.statSync(p).mtime.toISOString();
    }

    return {
        totalDocuments: docs.length,
        categories,
        lastBuilt,
        vectorsDimension: docs.length > 0 ? docs[0].embedding.length : 0,
    };
}

/** 벡터 스토어 초기화 (전체 삭제) */
function clearVectors() {
    saveVectors([]);
}

module.exports = {
    loadVectors,
    saveVectors,
    addDocument,
    addDocumentsBatch,
    searchByEmbedding,
    cosineSimilarity,
    getStats,
    clearVectors,
};
