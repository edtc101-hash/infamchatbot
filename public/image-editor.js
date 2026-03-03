/* ===== 할부지 편집기 — JavaScript ===== */

// === State ===
const state = {
    images: [],           // [{img, name, zoom, panX, panY, dataUrl}]
    selectedIndex: -1,
    frame: { w: 1080, h: 1080, label: '1:1' },
    logoImage: null,
    logoPos: { x: 0, y: 0 },
    logoSize: 60,
    labels: [],
    dragging: null,
    dragOffset: { x: 0, y: 0 },
    isPanning: false,
    lastPan: { x: 0, y: 0 }
};

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

// === Init ===
(function init() {
    setFrame(1, 1);
    loadAutoLogo();
    setupDragDrop();
})();

function loadAutoLogo() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        state.logoImage = img;
        autoPositionLogo();
        renderCanvas();
    };
    img.src = '/infam-logo.svg';
}

function autoPositionLogo() {
    if (!state.logoImage) return;
    const pad = 20;
    state.logoPos.x = state.frame.w - state.logoSize - pad;
    state.logoPos.y = state.frame.h - state.logoSize * (state.logoImage.naturalHeight / state.logoImage.naturalWidth) - pad;
}

// === Drag & Drop ===
function setupDragDrop() {
    const zone = document.getElementById('imageUploadZone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
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
                    zoom: 1, panX: 0, panY: 0
                });
                if (state.selectedIndex === -1) selectImage(0);
                else renderGallery();
                showCanvas();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function selectImage(index) {
    if (index < 0 || index >= state.images.length) return;
    state.selectedIndex = index;
    const sel = state.images[index];
    document.getElementById('zoomSlider').value = Math.round(sel.zoom * 100);
    document.getElementById('zoomVal').textContent = Math.round(sel.zoom * 100);
    renderGallery();
    renderCanvas();
}

function removeImage(index, e) {
    if (e) e.stopPropagation();
    state.images.splice(index, 1);
    if (state.images.length === 0) {
        state.selectedIndex = -1;
        hideCanvas();
    } else {
        if (state.selectedIndex >= state.images.length) state.selectedIndex = state.images.length - 1;
        selectImage(state.selectedIndex);
    }
    renderGallery();
}

function renderGallery() {
    const g = document.getElementById('imageGallery');
    if (state.images.length === 0) { g.innerHTML = ''; return; }
    g.innerHTML = state.images.map((im, i) => `
        <div class="gallery-item${i === state.selectedIndex ? ' selected' : ''}" onclick="selectImage(${i})">
            <img src="${im.dataUrl}" alt="${im.name}">
            <button class="gallery-remove" onclick="removeImage(${i}, event)">✕</button>
            <span class="gallery-num">${i + 1}</span>
        </div>
    `).join('');
}

function showCanvas() {
    document.getElementById('canvasEmpty').style.display = 'none';
    document.getElementById('canvasContainer').style.display = 'block';
    document.getElementById('adjustSection').style.display = 'block';
    document.getElementById('aiSection').style.display = 'block';
}

function hideCanvas() {
    document.getElementById('canvasEmpty').style.display = '';
    document.getElementById('canvasContainer').style.display = 'none';
    document.getElementById('adjustSection').style.display = 'none';
    document.getElementById('aiSection').style.display = 'none';
}

// === Frame Presets ===
function setFrame(rw, rh) {
    const base = 1080;
    if (rw <= rh) {
        state.frame.w = base;
        state.frame.h = Math.round(base * rh / rw);
    } else {
        state.frame.h = base;
        state.frame.w = Math.round(base * rw / rh);
    }
    state.frame.label = `${rw}:${rh}`;
    canvas.width = state.frame.w;
    canvas.height = state.frame.h;
    autoPositionLogo();
    // Reset all image transforms to fit new frame
    state.images.forEach(im => { im.zoom = 1; im.panX = 0; im.panY = 0; });
    if (state.selectedIndex >= 0) {
        document.getElementById('zoomSlider').value = 100;
        document.getElementById('zoomVal').textContent = '100';
    }
    // Update active button
    document.querySelectorAll('.frame-btn').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.frame-btn[data-ratio="${rw}:${rh}"]`);
    if (active) active.classList.add('active');
    renderCanvas();
}

// === Zoom ===
function updateZoom() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    const v = parseInt(document.getElementById('zoomSlider').value);
    sel.zoom = v / 100;
    document.getElementById('zoomVal').textContent = v;
    renderCanvas();
}

function resetTransform() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    sel.zoom = 1; sel.panX = 0; sel.panY = 0;
    document.getElementById('zoomSlider').value = 100;
    document.getElementById('zoomVal').textContent = '100';
    renderCanvas();
}

// === Logo ===
function updateLogoSize() {
    const v = parseInt(document.getElementById('logoSizeSlider').value);
    document.getElementById('logoSizeVal').textContent = v;
    state.logoSize = v;
    autoPositionLogo();
    renderCanvas();
}

// === Watermark ===
function toggleWmControls() {
    document.getElementById('wmControls').style.display =
        document.getElementById('showWatermark').checked ? 'block' : 'none';
}
function updateWmOpacity() {
    document.getElementById('wmOpacityVal').textContent = document.getElementById('wmOpacitySlider').value;
    renderCanvas();
}

// === Labels ===
function addLabel() {
    const text = document.getElementById('labelText').value.trim();
    if (!text) return;
    const cx = state.frame.w / 2, cy = state.frame.h / 2;
    state.labels.push({ text, x: cx, y: cy, size: 14, pointerX: cx - 60, pointerY: cy + 40 });
    document.getElementById('labelText').value = '';
    renderLabelList();
    renderCanvas();
}

function removeLabel(i) {
    state.labels.splice(i, 1);
    renderLabelList();
    renderCanvas();
}

function renderLabelList() {
    document.getElementById('labelList').innerHTML = state.labels.map((l, i) =>
        `<div class="label-item"><span>📌 ${l.text}</span><button class="btn-remove" onclick="removeLabel(${i})">✕</button></div>`
    ).join('');
}

// === Canvas Rendering ===
function getBaseScale(img) {
    if (!img) return 1;
    return Math.max(state.frame.w / img.naturalWidth, state.frame.h / img.naturalHeight);
}

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw selected image
    const sel = state.images[state.selectedIndex];
    if (sel && sel.img) {
        const base = getBaseScale(sel.img);
        const scale = base * sel.zoom;
        const dw = sel.img.naturalWidth * scale;
        const dh = sel.img.naturalHeight * scale;
        const dx = (canvas.width - dw) / 2 + sel.panX;
        const dy = (canvas.height - dh) / 2 + sel.panY;
        ctx.drawImage(sel.img, dx, dy, dw, dh);
    }

    // Watermark
    if (document.getElementById('showWatermark').checked && state.logoImage) drawWatermark();
    // Logo
    if (document.getElementById('showLogo').checked && state.logoImage) drawLogo();
    // Labels
    state.labels.forEach(l => drawLabel(l));
}

function drawLogo() {
    const img = state.logoImage;
    const s = state.logoSize;
    const ratio = img.naturalHeight / img.naturalWidth;
    ctx.drawImage(img, state.logoPos.x, state.logoPos.y, s, s * ratio);
}

function drawWatermark() {
    const img = state.logoImage;
    if (!img) return;
    const opacity = parseInt(document.getElementById('wmOpacitySlider').value) / 100;
    const tileSize = 100;
    const ratio = img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 6);
    for (let x = -canvas.width; x < canvas.width; x += tileSize + 80) {
        for (let y = -canvas.height; y < canvas.height; y += tileSize * ratio + 80) {
            ctx.drawImage(img, x, y, tileSize, tileSize * ratio);
        }
    }
    ctx.restore();
}

function drawLabel(label) {
    const { text, x, y, size, pointerX, pointerY } = label;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pointerX, pointerY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pointerX, pointerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.font = `600 ${size}px Pretendard, sans-serif`;
    const m = ctx.measureText(text);
    const pad = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, x - pad, y - size - pad + 2, m.width + pad * 2, size + pad * 2, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
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

// === Canvas Mouse Interactions ===
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * canvas.width / rect.width,
        y: (e.clientY - rect.top) * canvas.height / rect.height
    };
}

canvas.addEventListener('mousedown', e => {
    const pos = getCanvasCoords(e);
    // Check label pointers
    for (let i = state.labels.length - 1; i >= 0; i--) {
        const l = state.labels[i];
        if (Math.hypot(pos.x - l.pointerX, pos.y - l.pointerY) < 15) {
            state.dragging = { type: 'labelPointer', index: i };
            canvas.style.cursor = 'move';
            return;
        }
    }
    // Check label boxes
    for (let i = state.labels.length - 1; i >= 0; i--) {
        const l = state.labels[i];
        ctx.font = `600 ${l.size}px Pretendard, sans-serif`;
        const tw = ctx.measureText(l.text).width + 16;
        const th = l.size + 16;
        if (pos.x >= l.x - 8 && pos.x <= l.x - 8 + tw && pos.y >= l.y - l.size - 6 && pos.y <= l.y - l.size - 6 + th) {
            state.dragging = { type: 'label', index: i };
            state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
            canvas.style.cursor = 'move';
            return;
        }
    }
    // Check logo
    if (state.logoImage && document.getElementById('showLogo').checked) {
        const ratio = state.logoImage.naturalHeight / state.logoImage.naturalWidth;
        const lw = state.logoSize, lh = state.logoSize * ratio;
        if (pos.x >= state.logoPos.x && pos.x <= state.logoPos.x + lw &&
            pos.y >= state.logoPos.y && pos.y <= state.logoPos.y + lh) {
            state.dragging = { type: 'logo' };
            state.dragOffset = { x: pos.x - state.logoPos.x, y: pos.y - state.logoPos.y };
            canvas.style.cursor = 'grabbing';
            return;
        }
    }
    // Otherwise: pan image
    state.isPanning = true;
    state.lastPan = pos;
    canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', e => {
    const pos = getCanvasCoords(e);
    if (state.dragging) {
        const d = state.dragging;
        if (d.type === 'logo') {
            state.logoPos.x = pos.x - state.dragOffset.x;
            state.logoPos.y = pos.y - state.dragOffset.y;
        } else if (d.type === 'label') {
            const l = state.labels[d.index];
            const dx = pos.x - state.dragOffset.x - l.x;
            const dy = pos.y - state.dragOffset.y - l.y;
            l.x += dx; l.y += dy; l.pointerX += dx; l.pointerY += dy;
            state.dragOffset = { x: pos.x - l.x, y: pos.y - l.y };
        } else if (d.type === 'labelPointer') {
            state.labels[d.index].pointerX = pos.x;
            state.labels[d.index].pointerY = pos.y;
        }
        renderCanvas();
    } else if (state.isPanning) {
        const sel = state.images[state.selectedIndex];
        if (sel) {
            sel.panX += pos.x - state.lastPan.x;
            sel.panY += pos.y - state.lastPan.y;
            state.lastPan = pos;
            renderCanvas();
        }
    }
});

canvas.addEventListener('mouseup', () => {
    state.dragging = null;
    state.isPanning = false;
    canvas.style.cursor = 'default';
});

canvas.addEventListener('mouseleave', () => {
    state.dragging = null;
    state.isPanning = false;
    canvas.style.cursor = 'default';
});

// Mouse wheel zoom
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const sel = state.images[state.selectedIndex];
    if (!sel) return;
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    sel.zoom = Math.max(0.1, Math.min(5, sel.zoom * delta));
    document.getElementById('zoomSlider').value = Math.round(sel.zoom * 100);
    document.getElementById('zoomVal').textContent = Math.round(sel.zoom * 100);
    renderCanvas();
}, { passive: false });

// === Download ===
function downloadImage() {
    if (state.selectedIndex < 0) return alert('이미지를 먼저 업로드하세요.');
    const link = document.createElement('a');
    link.download = `halbuji-${state.frame.label}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function downloadAll() {
    if (state.images.length === 0) return alert('이미지를 먼저 업로드하세요.');
    const origIndex = state.selectedIndex;
    state.images.forEach((_, i) => {
        state.selectedIndex = i;
        renderCanvas();
        const link = document.createElement('a');
        link.download = `halbuji-${state.frame.label}-${i + 1}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
    state.selectedIndex = origIndex;
    renderCanvas();
}

// === AI 4K Upscale ===
async function ai4KUpscale() {
    const sel = state.images[state.selectedIndex];
    if (!sel) return alert('이미지를 먼저 업로드하세요.');

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
    fill.style.animation = 'none';
    fill.offsetHeight;
    fill.style.animation = 'aiProgress 20s ease-in-out forwards';
    progressText.textContent = '🚀 AI 4K 업스케일 중... (약 10~20초)';

    try {
        const imageData = canvas.toDataURL('image/jpeg', 0.95);
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
                renderCanvas();
                renderGallery();
                fill.style.animation = 'none';
                fill.style.width = '100%';
                resultMsg.textContent = `✅ 4K 업스케일 완료! (${enhanced.naturalWidth}×${enhanced.naturalHeight})`;
                resultMsg.className = 'ai-result-msg success';
            };
            enhanced.src = data.image;
        } else {
            throw new Error(data.message || '4K 업스케일 실패');
        }
    } catch (err) {
        resultMsg.textContent = `❌ ${err.message}`;
        resultMsg.className = 'ai-result-msg error';
        fill.style.animation = 'none';
        fill.style.width = '0%';
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 4K 스케일 업';
        progressText.textContent = '';
        setTimeout(() => { progress.style.display = 'none'; }, 3000);
    }
}
