/* ===== 할부지 편집기 — 그리드 뷰 ===== */

const state = {
    images: [],           // [{img, name, dataUrl, zoom, panX, panY, labels:[]}]
    selectedIndex: -1,
    frame: { w: 1080, h: 1080, label: '1:1' },
    logoImage: null,
    dragging: null,
    dragOffset: { x: 0, y: 0 },
    isPanning: false,
    lastPan: { x: 0, y: 0 }
};

let activeCanvas = null;

// === Init ===
(function init() {
    setFrame(1, 1);
    loadLogo();
    setupDragDrop();
})();

function loadLogo() {
    const svgImg = new Image();
    svgImg.crossOrigin = 'anonymous';
    svgImg.onload = () => {
        const size = 512;
        const off = document.createElement('canvas');
        off.width = size; off.height = size;
        off.getContext('2d').drawImage(svgImg, 0, 0, size, size);
        const bmp = new Image();
        bmp.onload = () => { state.logoImage = bmp; };
        bmp.src = off.toDataURL('image/png');
    };
    svgImg.src = '/infam-logo.svg';
}

function setupDragDrop() {
    const zone = document.getElementById('imageUploadZone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleMultiUpload(e.dataTransfer.files);
    });
}

// === Multi Image Upload ===
function handleMultiUpload(files) {
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                state.images.push({
                    img, name: file.name, dataUrl: e.target.result,
                    zoom: 1, panX: 0, panY: 0, labels: []
                });
                if (state.selectedIndex === -1) state.selectedIndex = 0;
                rebuildGrid();
                showControls();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function selectImage(index) {
    if (index < 0 || index >= state.images.length) return;
    state.selectedIndex = index;
    document.querySelectorAll('.preview-card').forEach((c, i) => c.classList.toggle('selected', i === index));
    const sel = state.images[index];
    document.getElementById('zoomSlider').value = Math.round(sel.zoom * 100);
    document.getElementById('zoomVal').textContent = Math.round(sel.zoom * 100);
    renderLabelList();
    attachHandlers();
}

function removeImage(index, e) {
    if (e) e.stopPropagation();
    state.images.splice(index, 1);
    if (state.images.length === 0) { state.selectedIndex = -1; hideControls(); }
    else if (state.selectedIndex >= state.images.length) state.selectedIndex = state.images.length - 1;
    rebuildGrid();
}

function showControls() {
    document.getElementById('canvasEmpty').style.display = 'none';
    document.getElementById('previewGrid').style.display = 'grid';
    document.getElementById('adjustSection').style.display = 'block';
    document.getElementById('aiSection').style.display = 'block';
}

function hideControls() {
    document.getElementById('canvasEmpty').style.display = '';
    document.getElementById('previewGrid').style.display = 'none';
    document.getElementById('adjustSection').style.display = 'none';
    document.getElementById('aiSection').style.display = 'none';
}

// === Grid ===
function rebuildGrid() {
    const grid = document.getElementById('previewGrid');
    grid.innerHTML = '';
    if (state.images.length === 0) { hideControls(); return; }
    showControls();

    state.images.forEach((im, i) => {
        const card = document.createElement('div');
        card.className = 'preview-card' + (i === state.selectedIndex ? ' selected' : '');
        card.onclick = () => selectImage(i);

        const cvs = document.createElement('canvas');
        cvs.id = `cvs-${i}`;
        cvs.width = state.frame.w;
        cvs.height = state.frame.h;
        card.appendChild(cvs);

        const num = document.createElement('span');
        num.className = 'preview-num';
        num.textContent = i + 1;
        card.appendChild(num);

        const btn = document.createElement('button');
        btn.className = 'preview-remove';
        btn.textContent = '✕';
        btn.onclick = (e) => removeImage(i, e);
        card.appendChild(btn);

        grid.appendChild(card);
    });

    renderAllCanvases();
    renderLabelList();
    attachHandlers();
}

// === Frame ===
function setFrame(rw, rh) {
    const base = 1080;
    state.frame.w = rw <= rh ? base : Math.round(base * rw / rh);
    state.frame.h = rw <= rh ? Math.round(base * rh / rw) : base;
    state.frame.label = `${rw}:${rh}`;
    state.images.forEach(im => { im.zoom = 1; im.panX = 0; im.panY = 0; });
    if (state.selectedIndex >= 0) {
        document.getElementById('zoomSlider').value = 100;
        document.getElementById('zoomVal').textContent = '100';
    }
    document.querySelectorAll('.frame-btn').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.frame-btn[data-ratio="${rw}:${rh}"]`);
    if (active) active.classList.add('active');
    rebuildGrid();
}

// === Zoom ===
function updateZoom() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    const v = parseInt(document.getElementById('zoomSlider').value);
    sel.zoom = v / 100;
    document.getElementById('zoomVal').textContent = v;
    renderSingleCanvas(state.selectedIndex);
}

function resetTransform() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    sel.zoom = 1; sel.panX = 0; sel.panY = 0;
    document.getElementById('zoomSlider').value = 100;
    document.getElementById('zoomVal').textContent = '100';
    renderSingleCanvas(state.selectedIndex);
}

// === Labels ===
function getLabels() {
    const sel = state.images[state.selectedIndex];
    return sel ? sel.labels : [];
}

function addLabel() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return alert('이미지를 먼저 업로드하세요.');
    const text = document.getElementById('labelText').value.trim();
    if (!text) return;
    const cx = state.frame.w / 2, cy = state.frame.h / 2;
    const size = parseInt(document.getElementById('labelSizeSlider').value);
    sel.labels.push({ text, x: cx, y: cy, size, pointerX: cx - 120, pointerY: cy + 120, pWidth: 4, pDotSize: 10 });
    document.getElementById('labelText').value = '';
    renderLabelList();
    renderSingleCanvas(state.selectedIndex);
}

function removeLabel(i) {
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    sel.labels.splice(i, 1);
    renderLabelList();
    renderSingleCanvas(state.selectedIndex);
}

function renderLabelList() {
    const labels = getLabels();
    document.getElementById('labelList').innerHTML = labels.map((l, i) =>
        `<div class="label-item"><span>📌 ${l.text} (${l.size}px)</span><button class="btn-remove" onclick="removeLabel(${i})">✕</button></div>`
    ).join('');
}

// === Canvas Rendering ===
function renderSingleCanvas(index) {
    const im = state.images[index];
    const cvs = document.getElementById(`cvs-${index}`);
    if (!cvs || !im) return;
    const ctx = cvs.getContext('2d');

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    // Image
    if (im.img) {
        const base = Math.max(state.frame.w / im.img.naturalWidth, state.frame.h / im.img.naturalHeight);
        const scale = base * im.zoom;
        const dw = im.img.naturalWidth * scale;
        const dh = im.img.naturalHeight * scale;
        ctx.drawImage(im.img, (cvs.width - dw) / 2 + im.panX, (cvs.height - dh) / 2 + im.panY, dw, dh);
    }

    // Dark overlay when dragging label
    if (state.dragging && (state.dragging.type === 'label' || state.dragging.type === 'labelPointer') && index === state.selectedIndex) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
    }

    // Labels with logo
    im.labels.forEach(l => drawLabel(ctx, l));
}

function renderAllCanvases() {
    state.images.forEach((_, i) => renderSingleCanvas(i));
}

function renderSelectedCanvas() {
    if (state.selectedIndex >= 0) renderSingleCanvas(state.selectedIndex);
}

function drawLabel(ctx, label) {
    const { text, x, y, size, pointerX, pointerY } = label;
    ctx.save();

    // Measure text
    ctx.font = `600 ${size}px Pretendard, sans-serif`;
    const tm = ctx.measureText(text);
    const pad = 12;
    const textW = tm.width;

    // Logo beside text
    let logoW = 0, logoH = 0, logoGap = 0;
    if (state.logoImage) {
        const ratio = state.logoImage.naturalHeight / state.logoImage.naturalWidth;
        logoH = size;
        logoW = logoH / ratio;
        logoGap = 8;
    }

    // Box: centered on (x, y)
    const contentW = logoW + logoGap + textW;
    const boxW = contentW + pad * 2;
    const boxH = size + pad * 2;
    const boxX = x - boxW / 2;
    const boxY = y - boxH / 2;

    // Pointer style (라벨 개별 속성 → 사이드바 폴백)
    const pColor = document.getElementById('pointerColor')?.value || '#ffffff';
    const pWidth = label.pWidth || parseInt(document.getElementById('pointerWidth')?.value || '4');
    const pDotSize = label.pDotSize || parseInt(document.getElementById('pointerDotSize')?.value || '10');

    // Pointer line (좌측 모서리에서 시작)
    ctx.beginPath();
    ctx.moveTo(pointerX, pointerY);
    ctx.lineTo(boxX, y);
    ctx.strokeStyle = pColor;
    ctx.lineWidth = pWidth;
    ctx.stroke();

    // Pointer dot
    ctx.beginPath();
    ctx.arc(pointerX, pointerY, pDotSize, 0, Math.PI * 2);
    ctx.fillStyle = pColor;
    ctx.fill();

    // Box background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    // Logo (left inside box, vertically centered)
    let textStartX = boxX + pad;
    if (state.logoImage && logoW > 0) {
        ctx.drawImage(state.logoImage, boxX + pad, boxY + (boxH - logoH) / 2, logoW, logoH);
        textStartX = boxX + pad + logoW + logoGap;
    }

    // Text (vertically centered)
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, textStartX, y);

    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// === Mouse Event Handlers ===
function getCoords(cvs, e) {
    const r = cvs.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cvs.width / r.width, y: (e.clientY - r.top) * cvs.height / r.height };
}

function hitLabel(pos, labels) {
    for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i];
        if (Math.hypot(pos.x - l.pointerX, pos.y - l.pointerY) < 20) return { type: 'labelPointer', index: i };
        const ctx = activeCanvas?.getContext('2d');
        if (ctx) {
            ctx.font = `600 ${l.size}px Pretendard, sans-serif`;
            const textW = ctx.measureText(l.text).width;
            let logoW = 0, logoGap = 0;
            if (state.logoImage) {
                const ratio = state.logoImage.naturalHeight / state.logoImage.naturalWidth;
                logoW = (l.size) / ratio;
                logoGap = 8;
            }
            const pad = 12;
            const boxW = logoW + logoGap + textW + pad * 2;
            const boxH = l.size + pad * 2;
            const boxX = l.x - boxW / 2;
            const boxY = l.y - boxH / 2;
            if (pos.x >= boxX && pos.x <= boxX + boxW && pos.y >= boxY && pos.y <= boxY + boxH)
                return { type: 'label', index: i };
        }
    }
    return null;
}

function onMouseDown(e) {
    if (!activeCanvas) return;
    const pos = getCoords(activeCanvas, e);
    const labels = getLabels();

    const hit = hitLabel(pos, labels);
    if (hit) {
        state.dragging = hit;
        if (hit.type === 'label') state.dragOffset = { x: pos.x - labels[hit.index].x, y: pos.y - labels[hit.index].y };
        activeCanvas.style.cursor = 'grabbing';
        renderSingleCanvas(state.selectedIndex);
        return;
    }

    // Pan image
    state.isPanning = true;
    state.lastPan = pos;
    activeCanvas.style.cursor = 'grabbing';
}

function onMouseMove(e) {
    if (!activeCanvas) return;
    const pos = getCoords(activeCanvas, e);
    const labels = getLabels();

    if (state.dragging) {
        const d = state.dragging;
        if (d.type === 'label') {
            const l = labels[d.index];
            const dx = pos.x - state.dragOffset.x - l.x;
            const dy = pos.y - state.dragOffset.y - l.y;
            l.x += dx; l.y += dy; l.pointerX += dx; l.pointerY += dy;
            state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
        } else if (d.type === 'labelPointer') {
            labels[d.index].pointerX = pos.x;
            labels[d.index].pointerY = pos.y;
        }
        renderSingleCanvas(state.selectedIndex);
    } else if (state.isPanning) {
        const sel = state.images[state.selectedIndex];
        if (sel) {
            sel.panX += pos.x - state.lastPan.x;
            sel.panY += pos.y - state.lastPan.y;
            state.lastPan = pos;
            renderSingleCanvas(state.selectedIndex);
        }
    } else {
        // Hover cursor
        activeCanvas.style.cursor = hitLabel(pos, labels) ? 'pointer' : 'grab';
    }
}

function onMouseUp() {
    state.dragging = null;
    state.isPanning = false;
    if (activeCanvas) {
        activeCanvas.style.cursor = 'grab';
        renderSingleCanvas(state.selectedIndex);
    }
}

function onWheel(e) {
    e.preventDefault();
    if (!activeCanvas) return;
    const pos = getCoords(activeCanvas, e);
    const labels = getLabels();

    // Label resize on hover
    for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i];
        const ctx = activeCanvas.getContext('2d');
        ctx.font = `600 ${l.size}px Pretendard, sans-serif`;
        const textW = ctx.measureText(l.text).width;
        let logoW = 0, logoGap = 0;
        if (state.logoImage) {
            const ratio = state.logoImage.naturalHeight / state.logoImage.naturalWidth;
            logoW = l.size / ratio; logoGap = 8;
        }
        const pad = 12;
        const boxW = logoW + logoGap + textW + pad * 2;
        const boxH = l.size + pad * 2;
        const boxX = l.x - boxW / 2;
        const boxY = l.y - boxH / 2;
        const onPointer = Math.hypot(pos.x - l.pointerX, pos.y - l.pointerY) < 20;
        const onBox = pos.x >= boxX && pos.x <= boxX + boxW && pos.y >= boxY && pos.y <= boxY + boxH;
        // 포인터 점 위에서 휠 → 선 굵기/점 크기 조절
        if (onPointer) {
            const delta = e.deltaY > 0 ? -1 : 1;
            l.pWidth = Math.max(1, Math.min(20, (l.pWidth || 4) + delta));
            l.pDotSize = Math.max(2, Math.min(40, (l.pDotSize || 10) + delta * 2));
            renderSingleCanvas(state.selectedIndex);
            return;
        }
        // 라벨 박스 위에서 휠 → 텍스트 크기 조절
        if (onBox) {
            l.size = Math.max(8, Math.min(80, l.size + (e.deltaY > 0 ? -1 : 1)));
            renderSingleCanvas(state.selectedIndex);
            return;
        }
    }

    // Image zoom
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    sel.zoom = Math.max(0.1, Math.min(5, sel.zoom * (e.deltaY > 0 ? 0.95 : 1.05)));
    document.getElementById('zoomSlider').value = Math.round(sel.zoom * 100);
    document.getElementById('zoomVal').textContent = Math.round(sel.zoom * 100);
    renderSingleCanvas(state.selectedIndex);
}

function attachHandlers() {
    if (activeCanvas) {
        activeCanvas.removeEventListener('mousedown', onMouseDown);
        activeCanvas.removeEventListener('mousemove', onMouseMove);
        activeCanvas.removeEventListener('mouseup', onMouseUp);
        activeCanvas.removeEventListener('mouseleave', onMouseUp);
        activeCanvas.removeEventListener('wheel', onWheel);
    }
    activeCanvas = state.selectedIndex >= 0 ? document.getElementById(`cvs-${state.selectedIndex}`) : null;
    if (activeCanvas) {
        activeCanvas.addEventListener('mousedown', onMouseDown);
        activeCanvas.addEventListener('mousemove', onMouseMove);
        activeCanvas.addEventListener('mouseup', onMouseUp);
        activeCanvas.addEventListener('mouseleave', onMouseUp);
        activeCanvas.addEventListener('wheel', onWheel, { passive: false });
    }
}

// === Download ===
function downloadImage() {
    if (state.selectedIndex < 0) return alert('이미지를 먼저 선택하세요.');
    const cvs = document.getElementById(`cvs-${state.selectedIndex}`);
    if (!cvs) return;
    const link = document.createElement('a');
    link.download = `halbuji-${state.frame.label}-${Date.now()}.png`;
    link.href = cvs.toDataURL('image/png');
    link.click();
}

function downloadAll() {
    if (state.images.length === 0) return alert('이미지를 먼저 업로드하세요.');
    state.images.forEach((_, i) => {
        const cvs = document.getElementById(`cvs-${i}`);
        if (!cvs) return;
        const link = document.createElement('a');
        link.download = `halbuji-${state.frame.label}-${i + 1}.png`;
        link.href = cvs.toDataURL('image/png');
        link.click();
    });
}

// === AI 4K Upscale ===
async function ai4KUpscale() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return alert('이미지를 먼저 선택하세요.');
    const cvs = document.getElementById(`cvs-${state.selectedIndex}`);
    if (!cvs) return;

    const btn = document.getElementById('aiOptimizeBtn');
    const progress = document.getElementById('aiProgress');
    const progressText = document.getElementById('aiProgressText');
    const resultMsg = document.getElementById('aiResultMsg');

    btn.disabled = true;
    btn.textContent = '⏳ 4K 업스케일 중...';
    progress.style.display = 'block';
    resultMsg.textContent = '';
    resultMsg.className = 'ai-result-msg';
    const fill = progress.querySelector('.ai-progress-fill');
    fill.style.animation = 'none'; fill.offsetHeight;
    fill.style.animation = 'aiProgress 15s ease-in-out forwards';
    progressText.textContent = '🚀 AI 4K 업스케일 중... (약 5~15초)';

    try {
        const imageData = cvs.toDataURL('image/jpeg', 0.95);
        const res = await fetch('/api/ai/enhance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageData, mode: '4k-upscale' })
        });
        const data = await res.json();

        if (data.success && data.image) {
            const enhanced = new Image();
            enhanced.onload = () => {
                sel.img = enhanced;
                sel.dataUrl = data.image;
                sel.zoom = 1; sel.panX = 0; sel.panY = 0;
                renderSingleCanvas(state.selectedIndex);
                fill.style.animation = 'none'; fill.style.width = '100%';
                resultMsg.textContent = `✅ 4K 완료! (${enhanced.naturalWidth}×${enhanced.naturalHeight})`;
                resultMsg.className = 'ai-result-msg success';
            };
            enhanced.src = data.image;
        } else {
            throw new Error(data.message || '4K 업스케일 실패');
        }
    } catch (err) {
        resultMsg.textContent = `❌ ${err.message}`;
        resultMsg.className = 'ai-result-msg error';
        fill.style.animation = 'none'; fill.style.width = '0%';
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 4K 스케일 업';
        progressText.textContent = '';
        setTimeout(() => { progress.style.display = 'none'; }, 3000);
    }
}

// === AI Auto Label ===
async function autoLabel() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return alert('이미지를 먼저 업로드하세요.');

    const btn = document.getElementById('autoLabelBtn');
    btn.disabled = true;
    btn.textContent = '🔍 분석 중...';

    try {
        // 현재 이미지(라벨 없이) 캡처
        const cvs = document.getElementById(`cvs-${state.selectedIndex}`);
        const imageData = cvs.toDataURL('image/jpeg', 0.8);

        const res = await fetch('/api/ai/auto-label', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageData })
        });
        const data = await res.json();

        if (data.success && data.labels && data.labels.length > 0) {
            const size = parseInt(document.getElementById('labelSizeSlider').value);
            data.labels.forEach(l => {
                sel.labels.push({
                    text: l.text,
                    x: Math.round(l.x * state.frame.w),
                    y: Math.round(l.y * state.frame.h),
                    size,
                    pointerX: Math.round(l.pointerX * state.frame.w),
                    pointerY: Math.round(l.pointerY * state.frame.h)
                });
            });
            renderLabelList();
            renderSingleCanvas(state.selectedIndex);
            alert(`✅ ${data.labels.length}개 자재 라벨이 자동 추가되었습니다!`);
        } else {
            throw new Error(data.message || '자재를 감지하지 못했습니다.');
        }
    } catch (err) {
        alert(`❌ ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 AI 자동 라벨 감지';
    }
}

// === AI Caption Generator ===
async function generateCaption() {
    const product = document.getElementById('captionProduct').value.trim();
    if (!product) return alert('제품명을 입력하세요.');

    const btn = document.getElementById('captionGenBtn');
    const result = document.getElementById('captionResult');
    const captionText = document.getElementById('captionText');
    const msg = document.getElementById('captionMsg');

    btn.disabled = true;
    btn.textContent = '⏳ 생성 중...';
    msg.textContent = '';
    msg.className = 'ai-result-msg';

    try {
        const tone = document.getElementById('captionTone').value;
        const res = await fetch('/api/ai/generate-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productName: product, tone })
        });
        const data = await res.json();

        if (data.success && data.caption) {
            captionText.textContent = data.caption;
            result.style.display = 'block';
            msg.textContent = `✅ 캡션 생성 완료 (${data.caption.length}자)`;
            msg.className = 'ai-result-msg success';
        } else {
            throw new Error(data.message || '캡션 생성 실패');
        }
    } catch (err) {
        msg.textContent = `❌ ${err.message}`;
        msg.className = 'ai-result-msg error';
    } finally {
        btn.disabled = false;
        btn.textContent = '✍️ 캡션 자동 생성';
    }
}

function copyCaption() {
    const text = document.getElementById('captionText').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const msg = document.getElementById('captionMsg');
        msg.textContent = '✅ 클립보드에 복사됨!';
        msg.className = 'ai-result-msg success';
        setTimeout(() => { msg.textContent = ''; }, 2000);
    });
}
