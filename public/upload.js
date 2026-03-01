let authToken = '';
let selectedFiles = [];
let extractedKnowledge = [];
let allExpanded = false;

// === 로그인 처리 ===
async function doLogin() {
    const pw = document.getElementById('loginPw').value;
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (data.success) {
            authToken = data.token;
            document.getElementById('loginOverlay').style.display = 'none';
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('loginError').style.display = 'block';
    }
}

// === 드래그 앤 드롭 이벤트 ===
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
    }
});

// 파일 포맷 사이즈
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 아이콘 매핑
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'pdf') return '📕';
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return '📊';
    return '📝';
}

// 파일 선택 처리
function handleFiles(files) {
    const allowedExts = ['txt', 'pdf', 'xlsx', 'xls', 'csv'];

    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!allowedExts.includes(ext)) {
            showStatus(`지원하지 않는 파일 형식입니다: ${file.name}`, 'error');
            continue;
        }

        if (file.size > 10 * 1024 * 1024) {
            showStatus(`파일 크기가 10MB를 초과합니다: ${file.name}`, 'error');
            continue;
        }

        if (!selectedFiles.some(f => f.name === file.name)) {
            selectedFiles.push(file);
        }
    }

    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function renderFileList() {
    const listEl = document.getElementById('fileList');
    const uploadBtn = document.getElementById('uploadBtn');

    if (selectedFiles.length === 0) {
        listEl.style.display = 'none';
        uploadBtn.style.display = 'none';
        return;
    }

    listEl.style.display = 'block';
    uploadBtn.style.display = 'block';

    listEl.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-info">
                <span class="file-icon">${getFileIcon(file.name)}</span>
                <div>
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatBytes(file.size)}</div>
                </div>
            </div>
            <button class="file-remove" onclick="removeFile(${index})" title="삭제">❌</button>
        `;
        listEl.appendChild(item);
    });
}

function showStatus(message, type) {
    const box = document.getElementById('statusBox');
    box.className = `status-box ${type}`;
    if (type === 'loading') {
        box.innerHTML = `<span class="spinner"></span>${message}`;
    } else {
        box.innerHTML = message;
    }
}

// 카테고리 아이콘
function getCategoryIcon(cat) {
    const icons = {
        '제품': '📦', '시공': '🔨', '배송': '🚛', '결제': '💳',
        '견적': '📋', '기타': '📌', '관리자 수정': '✏️'
    };
    return icons[cat] || '📌';
}

// 카테고리별 CSS 클래스
function getCategoryClass(cat) {
    const map = { '제품': 'cat-제품', '시공': 'cat-시공', '배송': 'cat-배송', '결제': 'cat-결제', '견적': 'cat-견적' };
    return map[cat] || 'cat-기타';
}

// ========================
// 지식 시각화 렌더링
// ========================
function renderKnowledgeResults(data) {
    const resultsEl = document.getElementById('knowledgeResults');
    const items = data.items || [];
    extractedKnowledge = items;

    if (items.length === 0) {
        resultsEl.classList.remove('show');
        return;
    }

    // 통계
    const categories = {};
    items.forEach(item => {
        const cat = item.category || '기타';
        categories[cat] = (categories[cat] || 0) + 1;
    });

    const totalKeywords = items.reduce((sum, item) => sum + (item.keywords || []).length, 0);

    // 상단 통계 배지
    const statsEl = document.getElementById('resultsStats');
    statsEl.innerHTML = `
        <div class="stat-badge">
            <span class="stat-num">${items.length}</span>
            <span class="stat-label">지식 조각</span>
        </div>
        <div class="stat-badge">
            <span class="stat-num">${Object.keys(categories).length}</span>
            <span class="stat-label">카테고리</span>
        </div>
        <div class="stat-badge">
            <span class="stat-num">${totalKeywords}</span>
            <span class="stat-label">키워드</span>
        </div>
    `;

    // 카테고리 탭
    const tabsEl = document.getElementById('categoryTabs');
    const totalCount = items.length;
    let tabsHTML = `<button class="cat-tab active" onclick="filterCategory('all')">전체 <span class="cat-count">${totalCount}</span></button>`;
    const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    sortedCats.forEach(([cat, count]) => {
        tabsHTML += `<button class="cat-tab" onclick="filterCategory('${cat}')">${getCategoryIcon(cat)} ${cat} <span class="cat-count">${count}</span></button>`;
    });
    tabsEl.innerHTML = tabsHTML;

    // 서브타이틀 업데이트
    document.getElementById('resultsSubtitle').textContent =
        `AI가 문서에서 ${items.length}개의 Q&A 지식 조각을 추출했습니다 (${data.ragTotal || 0}개 RAG 문서 반영)`;

    // 카드 그리드 렌더링
    renderCards(items);

    // 결과 영역 표시
    resultsEl.classList.add('show');

    // 스크롤
    setTimeout(() => {
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
}

function renderCards(items) {
    const gridEl = document.getElementById('knowledgeGrid');
    gridEl.innerHTML = '';

    if (items.length === 0) {
        gridEl.innerHTML = `<div class="empty-filter">해당 카테고리에 추출된 지식이 없습니다.</div>`;
        return;
    }

    items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'knowledge-card';
        card.style.animationDelay = `${Math.min(index * 0.06, 1)}s`;

        const catClass = getCategoryClass(item.category);
        const keywords = (item.keywords || []).slice(0, 8);
        // 답변 미리보기 (80자)
        const answerPreview = (item.answer || '').length > 80
            ? (item.answer || '').substring(0, 80) + '...'
            : item.answer || '';

        card.innerHTML = `
            <div class="card-header" onclick="toggleCard(${index})">
                <div class="card-number">${index + 1}</div>
                <span class="card-category ${catClass}">${getCategoryIcon(item.category)} ${item.category || '기타'}</span>
                <div class="card-question">${escapeHtml(item.question || '')}</div>
                <button class="card-toggle" id="toggle-btn-${index}">▼</button>
            </div>
            <div class="card-body" id="card-body-${index}">
                <div class="card-answer">${escapeHtml(item.answer || '')}</div>
                ${keywords.length > 0 ? `
                <div class="card-keywords">
                    ${keywords.map(kw => `<span class="keyword-tag">#${escapeHtml(kw)}</span>`).join('')}
                </div>` : ''}
            </div>
        `;

        gridEl.appendChild(card);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleCard(index) {
    const body = document.getElementById(`card-body-${index}`);
    const btn = document.getElementById(`toggle-btn-${index}`);
    if (body && btn) {
        body.classList.toggle('open');
        btn.classList.toggle('open');
    }
}

function toggleAll() {
    allExpanded = !allExpanded;
    const btn = document.getElementById('toggleAllBtn');
    btn.textContent = allExpanded ? '전체 접기' : '전체 펼치기';

    document.querySelectorAll('.card-body').forEach(body => {
        if (allExpanded) body.classList.add('open');
        else body.classList.remove('open');
    });
    document.querySelectorAll('.card-toggle').forEach(toggle => {
        if (allExpanded) toggle.classList.add('open');
        else toggle.classList.remove('open');
    });
}

function filterCategory(cat) {
    // 탭 활성화
    document.querySelectorAll('.cat-tab').forEach(tab => tab.classList.remove('active'));
    event.target.closest('.cat-tab').classList.add('active');

    // 필터 적용
    if (cat === 'all') {
        renderCards(extractedKnowledge);
    } else {
        renderCards(extractedKnowledge.filter(item => (item.category || '기타') === cat));
    }

    allExpanded = false;
    document.getElementById('toggleAllBtn').textContent = '전체 펼치기';
}

// ========================
// 업로드 실행
// ========================
async function uploadFiles() {
    if (selectedFiles.length === 0) return;
    if (!authToken) {
        document.getElementById('loginOverlay').style.display = 'flex';
        return;
    }

    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;

    // 결과 영역 숨기기
    document.getElementById('knowledgeResults').classList.remove('show');

    showStatus('파일을 서버로 전송하고 AI가 지식을 추출 중입니다... (수십 초 정도 소요될 수 있습니다)', 'loading');

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('documents', file));

    try {
        const response = await fetch('/api/admin/upload-knowledge', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(
                `✅ <b>업로드 성공!</b><br>총 <b>${data.chunksExtracted}개</b>의 지식 조각이 추출되어 학습 완료되었습니다.<br><br>RAG 벡터 리빌드: ${data.ragTotal}개 문서 반영됨`,
                'success'
            );
            selectedFiles = [];
            renderFileList();

            // 추출된 지식 시각화
            if (data.items && data.items.length > 0) {
                renderKnowledgeResults(data);
            }
        } else {
            showStatus(`업로드 실패: ${data.error || '알 수 없는 오류'}`, 'error');
        }
    } catch (err) {
        showStatus(`네트워크 오류가 발생했습니다: ${err.message}`, 'error');
    } finally {
        uploadBtn.disabled = false;
    }
}
