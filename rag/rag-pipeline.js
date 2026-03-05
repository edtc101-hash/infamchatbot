/**
 * RAG 파이프라인
 * FAQ, 제품, 학습 데이터를 벡터 스토어에 인덱싱하고
 * 쿼리에 대한 의미 기반 검색을 수행
 */

const fs = require('fs');
const path = require('path');
const { addDocumentsBatch, searchByEmbedding, getStats, clearVectors } = require('./vector-store');
const { generateEmbedding, generateEmbeddingsBatch } = require('./embeddings');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch (e) { console.warn('pdf-parse 미설치'); }
let xlsx;
try { xlsx = require('xlsx'); } catch (e) { console.warn('xlsx 미설치'); }

const FAQ_FILE = path.join(__dirname, '..', 'faq-data.json');
const PRODUCT_FILE = path.join(__dirname, '..', 'product-data.json');
const LEARNED_FILE = path.join(__dirname, '..', 'learned-data.json');
const ERP_FILE = path.join(__dirname, '..', 'erp-scraped-data.json');
const COMPANY_FILE = path.join(__dirname, '..', 'company-content.json');
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
        const summary = prods.slice(0, 20).map(p =>
            `제품번호: ${p.productId}, 디자인: ${p.design}, 규격: ${p.spec}, 가격: ${p.price}`
        ).join('\n');

        docs.push({
            id: `product_cat_${cat.replace(/\s+/g, '_')}`,
            title: `${cat} 제품 카탈로그`,
            content: `[제품 카테고리: ${cat}] 총 ${prods.length}개 제품\n${summary}${prods.length > 20 ? `\n... 외 ${prods.length - 20}개 제품` : ''}`,
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
 * ERP 재고/매출 데이터를 벡터 문서로 변환
 */
function prepareERPDocuments() {
    if (!fs.existsSync(ERP_FILE)) return [];
    try {
        const erp = JSON.parse(fs.readFileSync(ERP_FILE, 'utf-8'));
        const docs = [];

        // 재고 데이터 — 제품별 문서
        if (erp.inventory && erp.inventory.length > 0) {
            const inventoryContent = erp.inventory.map(item =>
                `제품코드: ${item.code}, 제품명: ${item.name}, 규격: ${item.spec}, 색상: ${item.color}, 두께: ${item.thickness}, 재고수량: ${item.qty}장`
            ).join('\n');
            docs.push({
                id: 'erp_inventory_all',
                title: 'ERP 재고 현황 (전체)',
                content: `[실시간 재고 현황 — 스크래핑 일시: ${erp.scrapedAt}]\n총 ${erp.inventory.length}개 품목, 총 재고 ${erp.summary?.totalInventoryQty || ''}장\n\n${inventoryContent}`,
                category: 'ERP재고',
                keywords: ['재고', '수량', '있나요', '몇장', '남아'],
            });

            // 개별 인기 제품별 문서 (재고 10장 이상인 것)
            for (const item of erp.inventory.filter(i => i.qty >= 10)) {
                docs.push({
                    id: `erp_inv_${item.code}`,
                    title: `${item.name} ${item.color || ''} 재고`,
                    content: `[재고] ${item.name} (${item.color || '-'}) | 규격: ${item.spec} | 두께: ${item.thickness} | 현재 재고: ${item.qty}장 (${erp.scrapedAt} 기준)`,
                    category: 'ERP재고',
                    keywords: [item.name, item.color, '재고'].filter(Boolean),
                });
            }
        }

        // 최근 매출 요약
        if (erp.sales && erp.sales.length > 0) {
            const recentSales = erp.sales.slice(0, 10).map(s =>
                `${s.date} | ${s.customer} | ${s.product} | 수량: ${s.qty} | 금액: ${s.amount?.toLocaleString()}원 | 상태: ${s.status}`
            ).join('\n');
            docs.push({
                id: 'erp_sales_recent',
                title: '최근 매출/주문 현황',
                content: `[최근 영업 현황 — ${erp.period?.from} ~ ${erp.period?.to}]\n총 매출: ${erp.summary?.totalSalesAmt?.toLocaleString()}원, ${erp.summary?.salesCount}건\n\n${recentSales}`,
                category: 'ERP매출',
            });
        }

        return docs;
    } catch (e) {
        console.warn('ERP 데이터 파싱 실패:', e.message);
        return [];
    }
}

/**
 * 회사 정보/문화 데이터를 벡터 문서로 변환
 */
function prepareCompanyDocuments() {
    if (!fs.existsSync(COMPANY_FILE)) return [];
    try {
        const company = JSON.parse(fs.readFileSync(COMPANY_FILE, 'utf-8'));
        const htmlContent = company.content || '';
        // HTML 태그 제거
        const text = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 30) return [];

        return [{
            id: 'company_info',
            title: '인팸(InteriorFamily) 회사 소개 및 문화',
            content: `[회사 정보] ${text}`,
            category: '회사정보',
            keywords: ['인재상', '업무관', 'EDTC', '비전', '기업', '회사', '인팸'],
        }];
    } catch (e) {
        console.warn('회사 정보 파싱 실패:', e.message);
        return [];
    }
}

/**
 * 카탈로그 PDF 데이터를 벡터 문서로 변환
 * catalogs/ 폴더의 PDF에서 텍스트 추출 → 청킹
 */
async function prepareCatalogDocuments() {
    const catalogDir = path.join(__dirname, '..', 'catalogs');
    if (!fs.existsSync(catalogDir)) return [];

    const docs = [];
    const pdfFiles = fs.readdirSync(catalogDir).filter(f => f.endsWith('.pdf'));

    for (const file of pdfFiles) {
        try {
            if (typeof pdfParse !== 'function') continue;
            const dataBuffer = fs.readFileSync(path.join(catalogDir, file));
            const pdfData = await pdfParse(dataBuffer);
            const text = (pdfData && pdfData.text) ? pdfData.text.trim() : '';

            if (!text || text.length < 50) continue;

            const productName = file.replace('.pdf', '').trim();

            // 텍스트를 800자 청크로 분할 (200자 오버랩)
            const CHUNK_SIZE = 800;
            const OVERLAP = 200;
            const chunks = [];

            for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
                const chunk = text.substring(i, i + CHUNK_SIZE).trim();
                if (chunk.length > 50) chunks.push(chunk);
            }

            // 최대 5개 청크만 (비용 절감)
            const selectedChunks = chunks.slice(0, 5);
            selectedChunks.forEach((chunk, idx) => {
                docs.push({
                    id: `catalog_${productName}_${idx}`,
                    title: `${productName} 카탈로그 (${idx + 1}/${selectedChunks.length})`,
                    content: `[제품 카탈로그: ${productName}] ${chunk}`,
                    category: '카탈로그',
                });
            });
        } catch (err) {
            console.warn(`📄 카탈로그 파싱 실패: ${file} — ${err.message}`);
        }
    }
    return docs;
}

/**
 * Excel 데이터를 벡터 문서로 변환
 * data/ 폴더의 xlsx 파일 파싱
 */
function prepareExcelDocuments() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) return [];

    const docs = [];
    const xlsxFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));

    for (const file of xlsxFiles) {
        try {
            if (!xlsx) continue;
            const wb = xlsx.readFile(path.join(dataDir, file));

            for (const sheetName of wb.SheetNames) {
                const ws = wb.Sheets[sheetName];
                const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

                if (rows.length === 0) continue;

                // 20행씩 그룹핑하여 문서화
                for (let i = 0; i < rows.length; i += 20) {
                    const group = rows.slice(i, i + 20);
                    const content = group.map(row =>
                        Object.entries(row)
                            .filter(([, v]) => v !== '' && v !== null && v !== undefined)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' | ')
                    ).join('\n');

                    if (content.length > 50) {
                        docs.push({
                            id: `excel_${file}_${sheetName}_${i}`,
                            title: `${file} - ${sheetName} (행 ${i + 1}~${Math.min(i + 20, rows.length)})`,
                            content: `[데이터: ${file} / ${sheetName}]\n${content}`,
                            category: '데이터',
                        });
                    }
                }
            }
        } catch (err) {
            console.warn(`📊 Excel 파싱 실패: ${file} — ${err.message}`);
        }
    }
    return docs;
}

/**
 * 전체 벡터 스토어 빌드 (FAQ + 제품 + 학습 + 카탈로그 + Excel)
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
        const catalogDocs = await prepareCatalogDocuments();
        const excelDocs = prepareExcelDocuments();
        const erpDocs = prepareERPDocuments();
        const companyDocs = prepareCompanyDocuments();
        const allDocs = [...faqDocs, ...productDocs, ...learnedDocs, ...catalogDocs, ...excelDocs, ...erpDocs, ...companyDocs];

        console.log(`📄 문서 준비 완료: FAQ ${faqDocs.length}개, 제품 ${productDocs.length}개, 학습 ${learnedDocs.length}개, 카탈로그 ${catalogDocs.length}개, Excel ${excelDocs.length}개, ERP ${erpDocs.length}개, 회사 ${companyDocs.length}개 (총 ${allDocs.length}개)`);

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
        const results = searchByEmbedding(queryEmbedding, limit, 0.25);
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
    prepareERPDocuments,
    prepareCompanyDocuments,
};
