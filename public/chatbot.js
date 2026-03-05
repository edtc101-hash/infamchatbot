// 인팸 AI 챗봇 프론트엔드 - v2.0 완전 재구축
// 7가지 핵심 기능: AI 답변, 지식 베이스, FAQ 매칭, 대화 히스토리, 빠른 질문, 연락처, 바로가기

const API_URL = '/api/chat';
const sessionId = 'session_' + Math.random().toString(36).substring(2);
let isLoading = false;
let messageCount = 0;

const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// 링크 메타데이터
const LINK_META = {
    'figma.com': { icon: '📐', label: '시공 가이드 보기' },
    'drive.google.com': { icon: '📋', label: '카탈로그/자료 보기' },
    'notion.so': { icon: '📸', label: '시공 사례 보기' },
    'youtube.com': { icon: '🎥', label: '유튜브 영상 보기' },
    'instagram.com': { icon: '📸', label: '인스타그램 보기' },
    'naver.me': { icon: '📍', label: '지도 바로가기' },
    'cafe24.com': { icon: '✨', label: '샘플 구매하기' },
    'inpock.co.kr': { icon: '🔗', label: '카탈로그 모음 보기' },
    'infamglobal.com': { icon: '🌐', label: '홈페이지 가기' },
    'buly.kr': { icon: '✨', label: '샘플 구매하기' },
};

function getLinkMeta(url) {
    const domain = Object.keys(LINK_META).find(d => url.includes(d));
    return domain ? LINK_META[domain] : { icon: '🔗', label: '바로가기' };
}

function getLinkName(url, surroundingText) {
    const patterns = [
        { match: /소프트.?스톤.*시공|시공.*소프트.?스톤/, name: '소프트 스톤 시공 가이드' },
        { match: /WPC.*시공|시공.*WPC|월패널.*시공/, name: 'WPC 월패널 시공 가이드' },
        { match: /카빙.*시공|시공.*카빙/, name: '카빙 스톤 시공 가이드' },
        { match: /스텐.*시공|시공.*스텐/, name: '스텐 플레이트 시공 가이드' },
        { match: /크리스탈.*시공|시공.*크리스탈/, name: '크리스탈 블럭 시공 가이드' },
        { match: /시멘트.*시공|시공.*시멘트/, name: '시멘트 블럭 시공 가이드' },
        { match: /재고/, name: '재고 현황표 (당일 배송 확인)' },
        { match: /샘플/, name: '샘플 구매 바로가기' },
        { match: /지도|쇼룸|위치/, name: '쇼룸 위치 (네이버 지도)' },
        { match: /시공.?사례|사례/, name: '시공 사례 갤러리' },
        { match: /유튜브/, name: '유튜브 채널' },
        { match: /인스타/, name: '인스타그램' },
        { match: /카탈로그|카탈/, name: '카탈로그 보기' },
    ];
    for (const p of patterns) {
        if (p.match.test(surroundingText)) return p.name;
    }
    return getLinkMeta(url).label;
}
// URL 유효성 검사
function isValidUrl(url) {
    try {
        const u = new URL(url);
        if (!u.hostname.includes('.')) return false;
        if (u.hostname.length < 4) return false;
        const validDomains = ['figma.com', 'drive.google.com', 'notion.so', 'youtube.com', 'youtu.be',
            'instagram.com', 'naver.me', 'cafe24.com', 'inpock.co.kr', 'infamglobal.com', 'buly.kr',
            'google.com', 'naver.com', 'kakao.com'];
        const isKnown = validDomains.some(d => u.hostname.includes(d));
        return isKnown || url.length >= 25;
    } catch {
        return false;
    }
}

// URL → 이름 직접 매핑 (Google Drive 파일 ID 기반)
const KNOWN_URL_NAMES = {
    // 카탈로그
    '1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR': '인팸 월패널 카탈로그',
    '17BugkibGu-LGP-norCf4X3X_EQfY0d1w': 'WPC/SPC 월패널 카탈로그',
    '1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ': '카빙 스톤 카탈로그',
    '1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT': '소프트 스톤 카탈로그',
    '1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj': '라이트 스톤 카탈로그',
    '1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4': '인팸 스톤 카탈로그',
    '14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG': '스텐 플레이트 카탈로그',
    '1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D': '크리스탈 블럭 카탈로그',
    '1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew': '아이스 플레이트 카탈로그',
    '1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG': '아크릴 플레이트 카탈로그',
    '1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6': '시멘트 블럭 카탈로그',
    '1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO': '스타 스톤 카탈로그',
    '1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP': '하드 스톤 카탈로그',
    '1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q': '노이즈 템바보드 카탈로그',
    '1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk': '브릭 스톤 카탈로그',
    '18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH': '플로우 메탈 카탈로그',
    '17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp': '3D 블럭 카탈로그',
    '1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK': '오로라 스톤 카탈로그',
    '1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl': '오브제 프레임 카탈로그',
    // 재고
    '1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d': '재고 현황표',
};

// URL에서 알려진 이름 찾기
function getKnownUrlName(url) {
    for (const [fileId, name] of Object.entries(KNOWN_URL_NAMES)) {
        if (url.includes(fileId)) return name;
    }
    // figma.com 시공 가이드
    if (url.includes('figma.com')) {
        if (url.includes('%EC%86%8C%ED%94%84%ED%8A%B8')) return '소프트 스톤 시공 가이드';
        if (url.includes('%EC%9B%94%ED%8C%A8%EB%84%90') || url.includes('WPC')) return 'WPC 월패널 시공 가이드';
        if (url.includes('%EC%B9%B4%EB%B9%99')) return '카빙 스톤 시공 가이드';
        if (url.includes('%EC%8A%A4%ED%85%90')) return '스텐 플레이트 시공 가이드';
        if (url.includes('%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88')) return '크리스탈 블럭 시공 가이드';
        if (url.includes('%EC%8B%9C%EB%A9%98%ED%8A%B8')) return '시멘트 블럭 시공 가이드';
        return '시공 가이드';
    }
    // 기타 알려진 도메인
    if (url.includes('edtc101.cafe24.com')) return '샘플 구매하기';
    if (url.includes('naver.me/G1wCKANl')) return '쇼룸 위치 (네이버 지도)';
    if (url.includes('link.inpock.co.kr')) return '전체 카탈로그 모음';
    if (url.includes('youtube.com/@interior__family')) return '유튜브 채널';
    if (url.includes('instagram.com/interior__family')) return '인스타그램';
    if (url.includes('infamglobal.com')) return '공식 홈페이지';
    if (url.includes('notion.so')) return '시공 사례 갤러리';
    return null;
}

// 메시지 포맷팅 - marked.js 기반 마크다운 변환 + URL → 카드
function formatMessage(text) {
    // URL 앞 라벨 텍스트도 포함하여 캡처 (예: "크리스탈 블럭 카탈로그: https://...")
    const urlPattern = /((?:[가-힣a-zA-Z0-9\s]+[:\-→]\s*)?(?:🔗\s*)?)(https?:\/\/[^\s\n<>"')\]]+)/g;
    const usedUrls = new Set();
    const linkCards = [];

    // 1단계: URL을 먼저 추출하고 카드로 변환할 준비
    let textForMd = text.replace(urlPattern, (fullMatch, prefix, url) => {
        url = url.replace(/[.,;:!?]+$/, '');
        if (!isValidUrl(url)) return '';

        if (!usedUrls.has(url)) {
            usedUrls.add(url);
            const meta = getLinkMeta(url);

            // 1순위: 알려진 URL 직접 매칭
            let name = getKnownUrlName(url);

            // 2순위: 앞 라벨 텍스트에서 이름 추출
            if (!name && prefix) {
                const label = prefix.replace(/[:\-→🔗\s]+$/g, '').trim();
                if (label.length >= 2) name = label;
            }

            // 3순위: 도메인 메타
            if (!name) {
                name = meta.label || '바로가기';
            }

            linkCards.push({ url, name, icon: meta.icon });
        }

        return '';  // 라벨 + URL 모두 제거 (카드로 대체)
    });

    // 2단계: 불필요한 이모지 링크 마크다운 정리
    textForMd = textForMd
        .replace(/🔗\s*/g, '')
        .replace(/^\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // 3단계: marked.js로 마크다운 변환
    let formatted;
    if (typeof marked !== 'undefined' && marked.parse) {
        // marked 설정
        marked.setOptions({
            breaks: true,      // 줄바꿈을 <br>로 변환
            gfm: true,         // GitHub Flavored Markdown
            headerIds: false,
            mangle: false,
        });
        formatted = marked.parse(textForMd);
        // marked가 <p> 태그로 감싸므로, 최상위 불필요 <p> 정리
        formatted = formatted.trim();
    } else {
        // marked.js 로드 실패 시 폴백
        formatted = textForMd
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^- (.+)/gm, '• $1')
            .replace(/\n/g, '<br>');
    }

    // 4단계: 카드 HTML
    let cardsHtml = '';
    if (linkCards.length > 0) {
        cardsHtml = `<div class="link-cards">` +
            linkCards.map(card => `
            <a href="${escapeAttr(card.url)}" target="_blank" rel="noopener" class="link-card">
              <span class="link-card-icon">${card.icon}</span>
              <div class="link-card-text">
                <span class="link-card-name">${escapeHtml(card.name)}</span>
                <span class="link-card-url">${escapeHtml(card.url)}</span>
              </div>
              <span class="link-card-arrow">→</span>
            </a>`).join('') +
            `</div>`;
    }

    return formatted + cardsHtml;
}

function truncateUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname + (u.pathname.length > 30 ? u.pathname.substring(0, 30) + '...' : u.pathname);
    } catch { return url.substring(0, 45) + '...'; }
}
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(text) {
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 이모티콘 제거 유틸리티
function stripEmojis(text) {
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

// 봇 메시지 복사 — "고객 전달용 답변" 영역만 추출하여 복사
function copyBotMessage(btn) {
    const group = btn.closest('.message-group');
    const rawText = group.getAttribute('data-raw-text') || '';

    // "고객 전달용 답변" 영역만 추출 (내부 참고 메모 제외)
    let customerText = rawText;
    const customerMatch = rawText.match(/(?:📋\s*고객\s*전달용\s*답변[:\s]*)((?:.|\n)*?)(?=💡\s*내부\s*참고\s*메모|$)/i);
    if (customerMatch) {
        customerText = customerMatch[1].trim();
    } else {
        // 폴백: 내부 참고 메모 이후 제거
        const memoIdx = rawText.indexOf('💡 내부 참고 메모');
        if (memoIdx > 0) {
            customerText = rawText.substring(0, memoIdx).trim();
        }
        // "고객 전달용 답변:" 헤더 자체도 제거
        customerText = customerText.replace(/^📋\s*고객\s*전달용\s*답변[:\s]*/i, '').trim();
    }

    // 마크다운 서식 정리 (** 볼드 등 제거)
    customerText = customerText
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/^[\-\*]\s+/gm, '• ')
        .replace(/^#+\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    navigator.clipboard.writeText(customerText).then(() => {
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> 복사됨!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg> 📋 고객 전달용 복사';
            btn.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = customerText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '복사됨!';
        setTimeout(() => { btn.textContent = '📋 고객 전달용 복사'; }, 2000);
    });
}

// 사이드바 토글
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menuBtn');
    if (window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        !menuBtn.contains(e.target) &&
        sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});

// 소스 배지 생성
function getSourceBadge(data) {
    if (data.fromCorrection) return '<span class="source-badge faq">✏️ 관리자 수정 답변</span>';
    if (data.fromCache) return '<span class="source-badge cache">💾 캐시 응답</span>';
    if (data.fromFallback) return '<span class="source-badge fallback">📚 지식 베이스 응답</span>';
    if (data.ragSources && data.ragSources.length > 0 && data.matchedFAQs && data.matchedFAQs.length > 0)
        return '<span class="source-badge ai">🧠 RAG + FAQ + AI</span>';
    if (data.ragSources && data.ragSources.length > 0)
        return '<span class="source-badge ai">🧠 RAG + AI 답변</span>';
    if (data.matchedFAQs && data.matchedFAQs.length > 0) return '<span class="source-badge faq">🔍 FAQ 매칭 + AI</span>';
    return '<span class="source-badge ai">🤖 AI 생성 답변</span>';
}

// FAQ 매칭 카드 — 대화창에 표시하지 않음 (사용자 요청)
function getFAQMatchHtml(matchedFAQs) {
    return '';
}

// RAG 소스 카드 생성 — 고객 채팅 데이터 기준
function getRAGSourceHtml(ragSources) {
    if (!ragSources || ragSources.length === 0) return '';
    return `<div class="faq-match-card" style="border-left-color: #8b5cf6;">
        <div class="faq-match-title" style="color: #8b5cf6;">고객 채팅 데이터를 기준으로 ${ragSources.length}건 참조</div>
        <div class="faq-match-list">
            ${ragSources.map(r => {
        const pct = Math.round(parseFloat(r.score) * 100);
        return `<div class="faq-match-item" onclick="openEditPopup('rag', '${escapeAttr(r.title)}', '${escapeAttr(r.content || '')}', '${escapeAttr(r.category)}', ${pct})" title="클릭하여 편집">[${escapeHtml(r.category)}] ${escapeHtml(r.title)} <span style="color:#8b5cf6;font-size:11px;font-weight:600;">${pct}%</span></div>`;
    }).join('')}
        </div>
    </div>`;
}

// === 편집 팝업 ===
function openEditPopup(type, question, answer, category, score) {
    // 기존 팝업 제거
    const old = document.getElementById('editPopupOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'editPopupOverlay';
    overlay.className = 'edit-popup-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const typeLabel = type === 'faq' ? '📋 FAQ 편집' : '🧠 RAG 학습 데이터 편집';
    const scoreHtml = score ? `<span class="edit-popup-score">${score}% 유사도</span>` : '';
    const catHtml = category ? `<span class="edit-popup-cat">${category}</span>` : '';

    overlay.innerHTML = `
    <div class="edit-popup">
        <div class="edit-popup-header">
            <div class="edit-popup-title">${typeLabel} ${catHtml} ${scoreHtml}</div>
            <button class="edit-popup-close" onclick="this.closest('.edit-popup-overlay').remove()">✕</button>
        </div>
        <div class="edit-popup-body">
            <label class="edit-popup-label">질문 (Q)</label>
            <textarea class="edit-popup-textarea" id="popupQuestion" rows="2">${question}</textarea>
            <label class="edit-popup-label">답변 (A)</label>
            <textarea class="edit-popup-textarea" id="popupAnswer" rows="6" placeholder="수정할 답변을 입력하세요...">${answer}</textarea>
        </div>
        <div class="edit-popup-footer">
            <button class="edit-popup-cancel" onclick="this.closest('.edit-popup-overlay').remove()">취소</button>
            <button class="edit-popup-save" onclick="savePopupEdit(this)">💾 저장 & 학습</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    // 답변이 비어있으면 답변 textarea에 포커스
    setTimeout(() => {
        const target = answer ? document.getElementById('popupQuestion') : document.getElementById('popupAnswer');
        if (target) target.focus();
    }, 100);
}

async function savePopupEdit(btn) {
    const overlay = btn.closest('.edit-popup-overlay');
    const question = document.getElementById('popupQuestion').value.trim();
    const answer = document.getElementById('popupAnswer').value.trim();
    if (!question || !answer) { alert('질문과 답변을 모두 입력해주세요.'); return; }

    btn.disabled = true;
    btn.textContent = '저장 중...';

    try {
        const res = await fetch('/api/admin/learn-correction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, answer })
        });
        const data = await res.json();
        if (data.success) {
            btn.textContent = '✅ 저장 완료!';
            btn.style.background = '#22c55e';
            setTimeout(() => overlay.remove(), 1200);
        } else {
            alert('저장 실패: ' + (data.error || '알 수 없는 오류'));
            btn.disabled = false;
            btn.textContent = '💾 저장 & 학습';
        }
    } catch (e) {
        alert('저장 요청 실패: ' + e.message);
        btn.disabled = false;
        btn.textContent = '💾 저장 & 학습';
    }
}

// 후속 질문 버튼 생성
function getSuggestedQuestionsHtml(suggestedQuestions) {
    if (!suggestedQuestions || suggestedQuestions.length === 0) return '';
    return `<div class="suggested-questions">
        <div class="suggested-title">💡 이런 것도 궁금하신가요?</div>
        <div class="suggested-list">
            ${suggestedQuestions.map(q => `<button class="suggested-btn" onclick="sendQuickMessage('${escapeAttr(q)}')">${escapeHtml(q)}</button>`).join('')}
        </div>
    </div>`;
}

// 메시지 전송
let lastUserQuestion = '';
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading) return;

    const welcome = document.getElementById('welcomeSection');
    if (welcome) welcome.remove();

    addMessage(message, 'user');
    lastUserQuestion = message;
    messageInput.value = '';
    autoResize(messageInput);
    messageCount++;

    isLoading = true;
    sendBtn.disabled = true;
    const typingEl = showTypingIndicator();

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId })
        });
        const data = await response.json();
        typingEl.remove();

        let responseText = data.response || '오류가 발생했습니다.';
        // 빈 링크/괄호 정리
        responseText = responseText
            .replace(/^(\s*\n)+/, '')
            .replace(/\[([^\]]+)\]\(\s*\)/g, '$1')
            .replace(/\(\s*\)/g, '')
            .trim();
        const sourceBadge = getSourceBadge(data);
        const faqMatchHtml = getFAQMatchHtml(data.matchedFAQs) + getRAGSourceHtml(data.ragSources);

        // 후속 질문 HTML 생성
        const suggestedHtml = getSuggestedQuestionsHtml(data.suggestedQuestions);

        addMessage(responseText, 'bot', sourceBadge, faqMatchHtml + suggestedHtml, lastUserQuestion);
    } catch (error) {
        typingEl.remove();
        console.error('채팅 API 오류:', error);
        addMessage(
            '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.\n\n계속 연결이 안 되면 담당자에게 문의해 주세요.\n김동현 팀장: 010-6802-9124',
            'bot',
            '<span class="source-badge fallback">⚠️ 서버 연결 실패</span>'
        );
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function sendQuickMessage(msg) {
    messageInput.value = msg;
    sendMessage();
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}

function addMessage(text, type, sourceBadge = '', faqMatchHtml = '', originalQuestion = '') {
    const group = document.createElement('div');
    group.className = `message-group ${type}`;
    if (type === 'bot' && originalQuestion) {
        group.setAttribute('data-question', originalQuestion);
    }
    // 원본 텍스트 저장 (편집 시 사용)
    if (type === 'bot') {
        group.setAttribute('data-raw-text', text);
    }

    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const avatar = type === 'bot'
        ? `<div class="msg-avatar bot"><img src="infam-logo.svg" alt="InFam" style="width: 100%; height: 100%; border-radius: 50%; object-fit: contain;"></div>`
        : `<div class="msg-avatar user">👤</div>`;
    const formattedText = formatMessage(text);

    const copyBtnHtml = type === 'bot' ? `<button class="copy-msg-btn" onclick="copyBotMessage(this)" title="고객 전달용 답변만 복사"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg> 📋 고객 전달용 복사</button>` : '';
    const editBtnHtml = type === 'bot' ? `<button class="edit-msg-btn" onclick="editBotMessage(this)" title="답변 수정 후 학습">✏️ 바로수정</button>` : '';

    group.innerHTML = `
    <div class="message-row">
      ${type === 'bot' ? avatar : ''}
      <div class="bubble">${formattedText}${faqMatchHtml}</div>
      ${type === 'user' ? avatar : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="message-time">${timeStr}</span>
      ${type === 'bot' ? sourceBadge : ''}
      ${copyBtnHtml}
      ${editBtnHtml}
    </div>
  `;

    chatMessages.appendChild(group);
    scrollToBottom();
    return group;
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = `
    <div class="msg-avatar bot"><img src="infam-logo.svg" alt="InFam" style="width: 100%; height: 100%; border-radius: 50%; object-fit: contain;"></div>
    <div class="typing-bubble">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>
  `;
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function clearChat() {
    messageCount = 0;
    chatMessages.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'welcome-section';
    welcome.id = 'welcomeSection';
    welcome.innerHTML = `
    <div class="welcome-logo"><img src="infam-logo.svg" alt="InFam" style="width: 50px; height: 50px; object-fit: contain;"></div>
    <h2 class="welcome-title">인팸 CS 어시스턴트 👋</h2>
    <p class="welcome-subtitle">고객의 질문을 입력하면, 바로 전달 가능한 답변을 생성해 드립니다.<br>생성된 답변의 <strong>📋 고객 전달용 복사</strong> 버튼을 눌러 카카오톡/문자로 보내세요!</p>
    <div class="feature-chips">
      <div class="chip">🏠 벽장재 전문</div>
      <div class="chip">🚛 전국 배송</div>
      <div class="chip">📋 1,000+ 제품</div>
      <div class="chip">⚡ 당일 배송 가능</div>
    </div>
    <div class="welcome-quick-questions">
      <p class="welcome-suggest-title">자주 들어오는 고객 질문을 클릭해 보세요</p>
      <div class="welcome-quick-btns">
        <button class="welcome-quick-btn" onclick="sendQuickMessage('제품 종류가 어떻게 되나요?')">🏠 제품 종류</button>
        <button class="welcome-quick-btn" onclick="sendQuickMessage('배송은 어떻게 진행되나요?')">🚛 배송 안내</button>
        <button class="welcome-quick-btn" onclick="sendQuickMessage('시공 방법이 어떻게 되나요?')">🔨 시공 방법</button>
        <button class="welcome-quick-btn" onclick="sendQuickMessage('샘플을 받아볼 수 있나요?')">📦 샘플 구매</button>
        <button class="welcome-quick-btn" onclick="sendQuickMessage('재고 확인은 어떻게 하나요?')">📊 재고 확인</button>
        <button class="welcome-quick-btn" onclick="sendQuickMessage('쇼룸 위치가 어디인가요?')">📍 쇼룸 위치</button>
      </div>
    </div>
  `;
    chatMessages.appendChild(welcome);
    messageInput.focus();
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// === 바로수정 기능 ===
function editBotMessage(btn) {
    const group = btn.closest('.message-group');
    const bubble = group.querySelector('.bubble');
    const rawText = group.getAttribute('data-raw-text') || bubble.innerText;
    if (group.classList.contains('editing')) return;
    group.classList.add('editing');
    group.setAttribute('data-original-html', bubble.innerHTML);
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = rawText;
    textarea.rows = Math.max(5, rawText.split('\n').length + 2);
    const editActions = document.createElement('div');
    editActions.className = 'edit-actions';
    editActions.innerHTML = '<button class="edit-ai-btn" onclick="aiImproveAnswer(this)">🤖 AI 개선</button><button class="edit-save-btn" onclick="saveBotEdit(this)">저장 & 학습</button><button class="edit-cancel-btn" onclick="cancelBotEdit(this)">취소</button>';
    bubble.innerHTML = '';
    bubble.appendChild(textarea);
    bubble.appendChild(editActions);
    textarea.focus();
    btn.style.display = 'none';
}

async function saveBotEdit(btn) {
    const group = btn.closest('.message-group');
    const bubble = group.querySelector('.bubble');
    const textarea = bubble.querySelector('.edit-textarea');
    const editedText = textarea.value.trim();
    const question = group.getAttribute('data-question') || '';
    if (!editedText) { alert('답변 내용을 입력해주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '저장 중...';
    try {
        const res = await fetch('/api/admin/learn-correction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, answer: editedText })
        });
        const data = await res.json();
        group.setAttribute('data-raw-text', editedText);
        bubble.innerHTML = formatMessage(editedText);
        const badge = document.createElement('div');
        badge.className = 'edit-success-badge';
        badge.textContent = '수정 완료 - 학습에 반영됨';
        bubble.appendChild(badge);
        setTimeout(function () { badge.remove(); }, 4000);
        group.classList.remove('editing');
        const editBtn = group.querySelector('.edit-msg-btn');
        if (editBtn) editBtn.style.display = '';
    } catch (e) {
        alert('저장 실패: ' + e.message);
        btn.disabled = false;
        btn.textContent = '저장 & 학습';
    }
}

function cancelBotEdit(btn) {
    const group = btn.closest('.message-group');
    const bubble = group.querySelector('.bubble');
    bubble.innerHTML = group.getAttribute('data-original-html');
    group.classList.remove('editing');
    const editBtn = group.querySelector('.edit-msg-btn');
    if (editBtn) editBtn.style.display = '';
}

// AI로 답변 개선
async function aiImproveAnswer(btn) {
    const group = btn.closest('.message-group');
    const bubble = group.querySelector('.bubble');
    const textarea = bubble.querySelector('.edit-textarea');
    const question = group.getAttribute('data-question') || '';
    const currentAnswer = textarea.value.trim();

    if (!currentAnswer) {
        alert('개선할 답변 내용이 없습니다.');
        return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🧠 AI 분석 중...';
    btn.style.opacity = '0.7';

    try {
        const res = await fetch('/api/admin/improve-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, currentAnswer })
        });
        const data = await res.json();

        if (data.success && data.improvedAnswer) {
            textarea.value = data.improvedAnswer;
            textarea.style.borderColor = '#22c55e';
            textarea.style.background = '#f0fdf4';
            btn.textContent = '✅ 개선 완료!';
            setTimeout(() => {
                btn.textContent = '🤖 AI 개선';
                btn.disabled = false;
                btn.style.opacity = '1';
                textarea.style.borderColor = '';
                textarea.style.background = '';
            }, 2000);
        } else {
            alert('AI 개선 실패: ' + (data.error || '알 수 없는 오류'));
            btn.textContent = originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    } catch (e) {
        alert('AI 개선 요청 실패: ' + e.message);
        btn.textContent = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}
