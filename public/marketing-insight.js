// 판매 데이터를 담을 배열
let salesData = [];

// DOM 요소 참조
const manualInputTabBtn = document.querySelector('[data-tab="manual-input"]');
const csvUploadTabBtn = document.querySelector('[data-tab="csv-upload"]');
const manualInputForm = document.getElementById('manual-input');
const csvUploadForm = document.getElementById('csv-upload');
const addDataForm = document.getElementById('addDataForm');
const sortSelect = document.getElementById('sortSelect');
const rankingTableBody = document.getElementById('rankingTableBody');
const totalSalesWidget = document.getElementById('totalSalesWidget');
const topProductWidget = document.getElementById('topProductWidget');
const importDemoDataBtn = document.getElementById('importDemoDataBtn');
const uploadZone = document.getElementById('uploadZone');
const csvFileInput = document.getElementById('csvFileInput');
const generateInsightBtn = document.getElementById('generateInsightBtn');
const aiInsightText = document.getElementById('aiInsightText');

// 전역 차트 객체 참조
let salesChartInstance = null;
let colorVolumeChartInstance = null;
let colorRevenueChartInstance = null;

// =========================================
// 초기화 및 이벤트 리스너
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  // ── 사이드바 페이지 네비게이션 ──────────────────────
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  const pageDashboard = document.querySelector('.content-scroll');
  const pageReels = document.getElementById('page-reels');
  const pageTranslator = document.getElementById('page-translator');
  const topHeader = document.querySelector('.top-header');

  function navigateTo(page) {
    // 모든 nav 비활성화
    navItems.forEach(n => n.classList.remove('active'));
    const active = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (active) active.classList.add('active');

    // 모든 페이지 숨기기
    if (pageDashboard) pageDashboard.style.display = 'none';
    if (pageReels) pageReels.style.display = 'none';
    if (pageTranslator) pageTranslator.style.display = 'none';

    if (page === 'reels') {
      if (pageReels) pageReels.style.display = 'block';
      if (topHeader) {
        topHeader.querySelector('h1').textContent = '릴스 대본 생성기';
        topHeader.querySelector('p').textContent = '인스타 릴스 마케팅 대본을 자동으로 생성합니다';
      }
      if (salesData.length > 0) generateReelsScript();
    } else if (page === 'translator') {
      if (pageTranslator) pageTranslator.style.display = 'flex';
      if (topHeader) {
        topHeader.querySelector('h1').textContent = '제조 요청 번역기';
        topHeader.querySelector('p').textContent = '제조 요청서를 중국어, 영어, 한국어로 자동 번역합니다';
      }
    } else {
      // 대시보드 표시
      if (pageDashboard) pageDashboard.style.display = '';
      if (topHeader) {
        topHeader.querySelector('h1').textContent = '대시보드 개요';
        topHeader.querySelector('p').textContent = '실시간 판매 데이터 및 순위 분석';
      }
      if (page === 'upload') {
        document.querySelector('.data-input-section')?.scrollIntoView({ behavior: 'smooth' });
        switchTab('csv');
      } else if (page === 'manual') {
        document.querySelector('.data-input-section')?.scrollIntoView({ behavior: 'smooth' });
        switchTab('manual');
      }
    }
  }

  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // ── 기존 탭 이벤트 ──────────────────────────────────
  manualInputTabBtn.addEventListener('click', () => switchTab('manual'));
  csvUploadTabBtn.addEventListener('click', () => switchTab('csv'));
  addDataForm.addEventListener('submit', handleManualInputSumit);
  importDemoDataBtn.addEventListener('click', loadDemoData);
  sortSelect.addEventListener('change', updateDashboard);
  setupCsvUpload();

  if (generateInsightBtn) {
    generateInsightBtn.addEventListener('click', generateAiInsight);
  }

  // 릴스 대본 생성 버튼 (페이지에 있는 버튼)
  document.addEventListener('click', e => {
    if (e.target.closest('#generateReelsBtn')) generateReelsScript();
    // 포맷 탭
    const reelsTab = e.target.closest('.reels-tab');
    if (reelsTab) {
      document.querySelectorAll('.reels-tab').forEach(t => t.classList.remove('active'));
      reelsTab.classList.add('active');
      if (salesData.length > 0) generateReelsScript();
    }
    // 타겟 오디언스 토글
    const audienceBtn = e.target.closest('.audience-btn');
    if (audienceBtn) {
      document.querySelectorAll('.audience-btn').forEach(b => b.classList.remove('active'));
      audienceBtn.classList.add('active');
      if (salesData.length > 0) generateReelsScript();
    }
    // 바이럴 라이브러리 토글
    const viralToggle = e.target.closest('#viralLibraryToggle') || e.target.closest('.viral-library-header');
    if (viralToggle) {
      const grid = document.getElementById('viralLibraryGrid');
      const btn = document.getElementById('viralLibraryToggle');
      if (grid) grid.classList.toggle('collapsed');
      if (btn) btn.classList.toggle('collapsed');
    }
  });
});

// =========================================
// 탭 전환 로직
// =========================================
function switchTab(tab) {
  if (tab === 'manual') {
    manualInputTabBtn.classList.add('active');
    csvUploadTabBtn.classList.remove('active');
    manualInputForm.style.display = 'block';
    csvUploadForm.style.display = 'none';

    // 애니메이션 효과
    manualInputForm.style.opacity = '0';
    setTimeout(() => manualInputForm.style.opacity = '1', 10);
  } else {
    csvUploadTabBtn.classList.add('active');
    manualInputTabBtn.classList.remove('active');
    csvUploadForm.style.display = 'block';
    manualInputForm.style.display = 'none';

    // 애니메이션 효과
    csvUploadForm.style.opacity = '0';
    setTimeout(() => csvUploadForm.style.opacity = '1', 10);
  }
}

// =========================================
// 데모 데이터 로더
// =========================================
function loadDemoData() {
  // 엑셀 구조에 맞는 Mock Data
  // 품목명에 색상이 포함된 실제 시나리오 데이터
  const rawDemoNames = [
    { productName: '무늬목 도어 화이트', spec: '900*2100', volume: 50, supplyPrice: 150000, vat: 15000, total: 165000 },
    { productName: '무늬목 도어 네이비', spec: '900*2100', volume: 30, supplyPrice: 150000, vat: 15000, total: 165000 },
    { productName: '무늬목 도어 월넛', spec: '900*2100', volume: 20, supplyPrice: 150000, vat: 15000, total: 165000 },
    { productName: 'ABS 도어 화이트', spec: '800*2000', volume: 70, supplyPrice: 80000, vat: 8000, total: 88000 },
    { productName: 'ABS 도어 그레이', spec: '800*2000', volume: 50, supplyPrice: 80000, vat: 8000, total: 88000 },
    { productName: '3연동 중문 블랙', spec: '1200*2100', volume: 10, supplyPrice: 450000, vat: 45000, total: 495000 },
    { productName: '3연동 중문 월넛', spec: '1200*2100', volume: 5, supplyPrice: 450000, vat: 45000, total: 495000 },
    { productName: '폴딩 도어 블랙 비스폰', spec: '3000*2300', volume: 5, supplyPrice: 1200000, vat: 120000, total: 1320000 },
    { productName: '폴딩 도어 화이트', spec: '3000*2300', volume: 3, supplyPrice: 1200000, vat: 120000, total: 1320000 },
    { productName: '스윙 도어 월넛', spec: '1000*2100', volume: 18, supplyPrice: 350000, vat: 35000, total: 385000 },
    { productName: '스윙 도어 그레이', spec: '1000*2100', volume: 12, supplyPrice: 350000, vat: 35000, total: 385000 },
    { productName: '중문 부속도어 화이트오크', spec: '500*2100', volume: 25, supplyPrice: 95000, vat: 9500, total: 104500 },
    { productName: '중문 부속도어 다크월넛', spec: '500*2100', volume: 15, supplyPrice: 95000, vat: 9500, total: 104500 },
  ];
  const demoData = rawDemoNames.map(d => ({
    id: generateId(),
    ...d,
    color: extractColorFromName(d.productName) || '미분류'
  }));

  // 기존 데이터에 합치기
  salesData = [...demoData, ...salesData];
  updateDashboard();

  alert('데모 데이터가 성공적으로 로드되었습니다.');
}

// =========================================
// 직접 입력 처리
// =========================================
function handleManualInputSumit(e) {
  e.preventDefault();

  const nameInput = document.getElementById('productName');
  const specInput = document.getElementById('spec');
  const colorInput = document.getElementById('colorName');
  const volumeInput = document.getElementById('salesVolume');
  const supplyPriceInput = document.getElementById('supplyPrice');

  const volume = parseInt(volumeInput.value, 10);
  const supplyPrice = parseInt(supplyPriceInput.value, 10) || 0;
  const vat = Math.floor(supplyPrice * 0.1);
  const total = supplyPrice + vat;

  const newData = {
    id: generateId(),
    productName: nameInput.value.trim(),
    spec: specInput.value.trim(),
    color: (colorInput && colorInput.value.trim())
      ? colorInput.value.trim()
      : (extractColorFromName(nameInput.value.trim()) || ''),
    volume: volume,
    supplyPrice: supplyPrice,
    vat: vat,
    total: total
  };

  salesData.push(newData);

  // 폼 초기화
  addDataForm.reset();

  // 대시보드 갱신
  updateDashboard();
}

// =========================================
// 엑셀 파싱 및 업로드 (SheetJS 사용)
// =========================================
function setupCsvUpload() {
  // 드래그 앤 드롭 스타일
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleExcelFile(e.dataTransfer.files[0]);
    }
  });

  // 파일 선택
  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleExcelFile(e.target.files[0]);
    }
  });
}

function handleExcelFile(file) {
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      // 첫 번째 시트를 사용
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // JSON 형태로 파싱 (header: 1옵션을 주어 배열의 배열로 가져옴)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      parseExcelData(jsonData);
    } catch (error) {
      console.error("Excel 파싱 오류:", error);
      alert("엑셀 파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  reader.readAsArrayBuffer(file);
}

function parseExcelData(rows) {
  let addedCount = 0;

  // 첫 행은 보통 타이틀이나 메타데이터일 가능성이 높음 (예: "회사명 : ...")
  // 품목별, 규격 등의 헤더를 찾아서 그 아래 데이터부터 읽어야함
  let startRowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // 첫 번째 컬럼이 '품목별'이라는 텍스트를 포함하고 있다면 데이터 시작점으로 간주
    const firstCellStr = String(row[0]).replace(/\s/g, '');
    if (firstCellStr.includes('품목별')) {
      startRowIndex = i + 1; // 헤더 다음 줄부터 데이터
      break;
    }
  }

  if (startRowIndex === -1) {
    // '품목별' 헤더를 못찾았다면, 그냥 적당히 2번째 행(index 1)부터 시작해봄
    startRowIndex = 1;
  }

  for (let i = startRowIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue; // 빈 줄이나 유효하지 않은 데이터 건너뛰기

    // 엑셀 컬럼 순서 가정: [품목별, 규격, 수량, 공급가액, 부가세, 합계]
    const productName = String(row[0] || '').trim();
    if (!productName) continue; // 품목명이 없으면 건너뜀

    const spec = String(row[1] || '').trim();
    const color = String(row[2] || '').trim();
    const volume = Number(row[3]) || Number(row[2]) || 0;
    const supplyPrice = Number(row[4]) || Number(row[3]) || 0;
    const vat = Number(row[5]) || Number(row[4]) || 0;
    const total = Number(row[6]) || Number(row[5]) || 0;

    // row[2]가 숫자이면 색상 컴럼이 없는 기존 형식
    const hasColorColumn = isNaN(Number(row[2])) && String(row[2]).trim() !== '';
    const parsedVolume = hasColorColumn ? (Number(row[3]) || 0) : (Number(row[2]) || 0);
    const parsedSupplyPrice = hasColorColumn ? (Number(row[4]) || 0) : (Number(row[3]) || 0);
    const parsedVat = hasColorColumn ? (Number(row[5]) || 0) : (Number(row[4]) || 0);
    const parsedTotal = hasColorColumn ? (Number(row[6]) || 0) : (Number(row[5]) || 0);

    // 색상: 컴럼에 있으면 사용, 없으면 품목명에서 자동 추출
    const detectedColor = hasColorColumn
      ? color
      : (extractColorFromName(productName) || '');

    salesData.push({
      id: generateId(),
      productName,
      spec,
      color: detectedColor,
      volume: parsedVolume,
      supplyPrice: parsedSupplyPrice,
      vat: parsedVat,
      total: parsedTotal
    });

    addedCount++;
  }

  if (addedCount > 0) {
    alert(`${addedCount}개의 데이터를 파일에서 성공적으로 가져왔습니다.`);
    updateDashboard();
  } else {
    alert('파일에서 유효한 데이터를 찾지 못했습니다. 엑셀 형식을 참조해주세요. (품목별, 규격, 수량, 공급가액, 부가세, 합계)');
  }

  csvFileInput.value = ''; // 입력 초기화
}

// =========================================
// 대시보드 업데이트 핵심 로직 (정렬, UI 렌더링, 차트)
// =========================================
function updateDashboard() {
  if (salesData.length === 0) {
    renderEmptyState();
    updateWidgets(0, '-');
    renderChart([]);
    return;
  }

  // 1. 데이터 정렬 (사용자 선택에 따라)
  const sortBy = sortSelect.value;
  let sortedData = [...salesData];

  if (sortBy === 'total') {
    sortedData.sort((a, b) => b.total - a.total); // 매출 합계 기준
  } else if (sortBy === 'volume') {
    sortedData.sort((a, b) => b.volume - a.volume); // 수량 기준
  }

  // 동일 제품명 병합 로직 (제품별 합계 차트/집계를 위함)
  const aggregatedData = aggregateByProduct(salesData);

  // 2. 위젯 업데이트
  const totalRevenue = aggregatedData.reduce((sum, item) => sum + item.total, 0);

  // 차트를 위한 정렬은 병합데이터 기준 옵션 값(매출 or 수량)으로
  if (sortBy === 'volume') {
    aggregatedData.sort((a, b) => b.volume - a.volume);
  } else {
    aggregatedData.sort((a, b) => b.total - a.total);
  }

  const topProduct = aggregatedData.length > 0 ? aggregatedData[0].productName : '-';
  updateWidgets(totalRevenue, topProduct);

  // 3. 랭킹 테이블 렌더링
  renderRankingTable(sortedData, sortBy);

  // 4. 차트 렌더링 (병합된 데이터 기준 top 5 위주 등 시각화 좋게)
  renderChart(aggregatedData, sortBy);

  // 5. 색상별 차트 렌더링
  updateColorProductFilter();
  const selectedProduct = document.getElementById('colorProductFilter').value;
  renderColorCharts(salesData, selectedProduct);
}

function aggregateByProduct(data) {
  const map = new Map();
  data.forEach(item => {
    if (map.has(item.productName)) {
      const existing = map.get(item.productName);
      existing.total += item.total;
      existing.volume += item.volume;
    } else {
      map.set(item.productName, {
        total: item.total,
        volume: item.volume
      });
    }
  });

  const aggArray = [];
  map.forEach((value, productName) => {
    aggArray.push({ productName, total: value.total, volume: value.volume });
  });

  return aggArray;
}

// =========================================
// UI 렌더링 함수들
// =========================================
function renderRankingTable(data, sortBy) {
  rankingTableBody.innerHTML = '';

  data.forEach((item, index) => {
    const tr = document.createElement('tr');

    // 순위 스타일링 (1,2,3위 하이라이트)
    const rank = index + 1;
    let rankClass = '';
    if (rank <= 3) {
      tr.classList.add(`rank-${rank}`);
    }

    // 숫자에 콤마 적용
    const formattedTotal = Math.floor(item.total).toLocaleString('ko-KR');
    const formattedSupply = Math.floor(item.supplyPrice).toLocaleString('ko-KR');
    const formattedVat = Math.floor(item.vat).toLocaleString('ko-KR');
    const formattedVolume = Math.floor(item.volume).toLocaleString('ko-KR');

    const thumbUrl = getProductThumbnail(item.productName);
    const thumbHtml = thumbUrl
      ? `<img class="catalog-thumb" src="${thumbUrl}" alt="${item.productName}" onerror="this.style.display='none'">`
      : `<span class="catalog-thumb-placeholder"><i class="ph ph-package"></i></span>`;

    tr.innerHTML = `
            <td>#${rank}</td>
            <td class="product-name-cell">${thumbHtml}<strong>${item.productName}</strong></td>
            <td>${item.spec}</td>
            <td>${formattedVolume} EA</td>
            <td>₩${formattedSupply}</td>
            <td>₩${formattedVat}</td>
            <td><strong>₩${formattedTotal}</strong></td>
        `;

    rankingTableBody.appendChild(tr);
  });
}

function updateWidgets(totalRevenue, topProduct) {
  totalSalesWidget.textContent = `₩${Math.floor(totalRevenue).toLocaleString('ko-KR')}`;
  topProductWidget.textContent = topProduct;
}

function renderEmptyState() {
  rankingTableBody.innerHTML = `
        <tr>
            <td colspan="7" class="empty-state">데이터가 없습니다. 엑셀 파일을 업로드하거나 데모를 로드하세요.</td>
        </tr>
    `;
}

// =========================================
// Chart.js 렌더링
// =========================================
function renderChart(aggregatedData, sortBy) {
  const ctx = document.getElementById('salesChart').getContext('2d');

  // 상위 6개 항목만 차트에 표시
  const chartData = aggregatedData.slice(0, 6);
  const labels = chartData.map(d => d.productName);

  // 기준에 따라 차일드 데이터 매핑
  let dataLabel = '매출 합계';
  let dataPoints = chartData.map(d => d.total);

  if (sortBy === 'volume') {
    dataLabel = '수량';
    dataPoints = chartData.map(d => d.volume);
  }

  // 차트 컬러 팔레트 (테마에 맞게)
  const bgColors = [
    'rgba(99, 102, 241, 0.8)',   // Indigo
    'rgba(236, 72, 153, 0.8)',   // Pink
    'rgba(16, 185, 129, 0.8)',   // Emerald
    'rgba(245, 158, 11, 0.8)',   // Amber
    'rgba(139, 92, 246, 0.8)',   // Violet
    'rgba(14, 165, 233, 0.8)'    // Sky
  ];

  const borderColors = bgColors.map(c => c.replace('0.8', '1'));

  if (salesChartInstance) {
    salesChartInstance.destroy(); // 기존 차트 초기화
  }

  if (chartData.length === 0) {
    return; // 데이터 없으면 안그림
  }

  salesChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        label: dataLabel,
        data: dataPoints,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'rgba(255, 255, 255, 0.8)',
            font: { family: 'Inter', size: 12 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 17, 26, 0.9)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 12,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed !== null) {
                if (sortBy === 'volume') {
                  label += Math.floor(context.parsed).toLocaleString('ko-KR') + ' 개';
                } else {
                  label += '₩' + Math.floor(context.parsed).toLocaleString('ko-KR');
                }
              }
              return label;
            }
          }
        }
      },
      cutout: '65%' // 도넛 두께
    }
  });
}

// =========================================
// 카탈로그 이미지 매핑 (Inpock 기반)
// =========================================
const CATALOG_IMAGES = [
  {
    keywords: ['ss', '소프트 스톤', '소프트스톤', 'soft stone', 'softstone'],
    label: '소프트 스톤',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756197040697.avif?w=600'
  },
  {
    keywords: ['cv', '카빙 스톤', '카빙스톤', 'carving stone', 'carvingstone'],
    label: '카빙 스톤',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756196444479.avif'
  },
  {
    keywords: ['cr', '크리스탈 블럭', '크리스탈블럭', 'crystal block', 'crystalblock'],
    label: '크리스탈 블럭',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756198418119.avif?w=600'
  },
  {
    keywords: ['703', '노이즈 템바보드', '노이즈템바보드', 'noise tembaboard'],
    label: '노이즈 템바보드',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/2/19/2025-2-19-1739951925007.webp?w=600&f=avif'
  },
  {
    keywords: ['wpc', '월패널', '인팸 월패널'],
    label: '인팸 월패널',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756194880586.avif'
  },
  {
    keywords: ['spc', '월패널 spc'],
    label: '월패널 (WPC,SPC)',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/22/2025-8-22-1755832156451.avif'
  },
  {
    keywords: ['ls', '라이트 스톤', '라이트스톤', 'light stone', 'lightstone'],
    label: '라이트 스톤',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756197056581.avif?w=600'
  },
  {
    keywords: ['is', '인팸 스톤', '인팸스톤', 'infam stone'],
    label: '인팸 스톤',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756197049684.avif?w=600'
  },
  {
    keywords: ['sp', '스텐 플레이트', '스텐플레이트', 'stainless plate', 'sten plate'],
    label: '스텐 플레이트',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756198406208.avif?w=600'
  },
  {
    keywords: ['ip', '아이스 플레이트', '아이스플레이트', 'ice plate'],
    label: '아이스 플레이트',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756198436064.avif?w=600'
  },
  {
    keywords: ['ap', '아크릴 플레이트', '아크릴플레이트', 'acrylic plate'],
    label: '아크릴 플레이트',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/7/11/2025-7-11-1752220170131.webp?w=600&f=avif'
  },
  {
    keywords: ['cb', '시멘트 블럭', '시멘트블럭', 'cement block'],
    label: '시멘트 블럭',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/2/19/2025-2-19-1739951925007.webp?w=600&f=avif'
  },
  {
    keywords: ['3d', '3D 블럭', '3d블럭', '3d block'],
    label: '3D 블럭',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/2/19/2025-2-19-1739951925007.webp?w=600&f=avif'
  },
  {
    keywords: ['코팅매트', '고급매트', '엠보', 'mat', '매트'],
    label: '고무매트',
    imageUrl: 'https://d13k46lqgoj3d6.cloudfront.net/2025/8/26/2025-8-26-1756194880586.avif'
  }
];

/**
 * 품목명에서 적절한 카탈로그 이미지 URL을 반환합니다.
 * @param {string} productName - 품목명 (예: "SS-01/화이트/600*600")
 * @returns {string|null} 매칭된 이미지 URL 또는 null
 */
function getProductThumbnail(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  // 품목명의 첫 부분(약어 코드)을 추출 (예: "SS-01" -> "ss", "CV12" -> "cv")
  const prefix = lower.split(/[\-\/\s_\.\d]/)[0].trim();

  for (const catalog of CATALOG_IMAGES) {
    for (const kw of catalog.keywords) {
      const kwLower = kw.toLowerCase();
      // 1. 접두사(prefix)가 키워드와 정확히 일치
      if (prefix === kwLower) return catalog.imageUrl;
      // 2. 전체 품목명에 키워드가 포함
      if (lower.includes(kwLower)) return catalog.imageUrl;
    }
  }
  return null;
}

// 유틸리티
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// =========================================
// 품목명에서 색상 키워드 자동 추출
// =========================================
// 우선순위 순서로 정렬 (긴 키워드 먼저 매칭)
const COLOR_KEYWORDS = [
  // 목재/무늬 계열
  '월넛', '웜월넛', '다크월넛', '화이트오크', '내추럴오크', '오크', '체리', '티크', '마호가니', '애쉬',
  '무늬목', '원목',
  // 무채색
  '화이트', '아이보리', '크림', '베이지', '샌드',
  '라이트그레이', '미들그레이', '다크그레이', '그레이', '그레이시',
  '블랙', '매트블랙', '글로시블랙',
  '실버', '메탈릭', '메탈', '매탈',
  // 유채색
  '네이비', '블루', '스카이블루',
  '레드', '버건디', '와인',
  '그린', '카키', '올리브',
  '옐로우', '머스타드',
  '핑크', '로즈',
  '골드', '브론즈', '브라운',
  '라벤더', '퍼플',
  '오렌지',
  // 영문 색상
  'white', 'black', 'gray', 'grey', 'silver', 'gold',
  'navy', 'blue', 'red', 'green', 'brown', 'beige',
  'walnut', 'oak', 'cherry',
];

/**
 * 품목명에서 색상 키워드를 추출합니다.
 * @param {string} name - 품목명
 * @returns {string} 추출된 색상 이름 or ''
 */
function extractColorFromName(name) {
  if (!name) return '';
  const lower = name.toLowerCase();
  // 긴 키워드 우선 매칭하기 위해 길이 내림차순 정렬
  const sorted = [...COLOR_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    if (lower.includes(kw.toLowerCase())) {
      // 원본 키워드의 한글 표기(대소문자 무관)를 정규화해 반환
      return kw.charAt(0).toUpperCase() + kw.slice(1);
    }
  }
  return '';
}

// =========================================
// 릴스 대본 생성 함수 (7포맷 + 타겟 대응)
// =========================================
function generateReelsScript() {
  const container = document.getElementById('reelsScriptContainer');
  if (!container) return;

  if (salesData.length === 0) {
    container.innerHTML = `<div class="reels-placeholder"><i class="ph ph-warning" style="font-size:2.5rem;color:#f59e0b;"></i><p>데이터가 없습니다. 먼저 데이터를 로드해주세요.</p></div>`;
    return;
  }

  // 현재 포맷 탭 확인
  const activeTab = document.querySelector('.reels-tab.active');
  const format = activeTab ? activeTab.dataset.format : 'problem';

  // 타겟 오디언스
  const activeAudience = document.querySelector('.audience-btn.active');
  const audience = activeAudience ? activeAudience.dataset.audience : 'consumer';

  // 집계 + 정렬 (매출 기준 상위 3개)
  const agg = aggregateByProduct(salesData).sort((a, b) => b.total - a.total);
  const top3 = agg.slice(0, 3);

  // 총 매출
  const totalRev = agg.reduce((s, d) => s + d.total, 0);

  // 대본 카드 생성
  const cards = top3.map((product, idx) => {
    const rank = idx + 1;
    const ratio = ((product.total / totalRev) * 100).toFixed(1);
    let script;
    switch (format) {
      case 'before': script = buildBeforeAfterScript(product, rank, audience); break;
      case 'construction': script = buildConstructionLogScript(product, rank, audience); break;
      case 'expert': script = buildExpertTipScript(product, rank, audience); break;
      case 'newmaterial': script = buildNewMaterialScript(product, rank, audience); break;
      case 'experiment': script = buildExperimentScript(product, rank, audience); break;
      case 'qna': script = buildQnAScript(product, rank, audience); break;
      default: script = buildProblemScript(product, rank, audience); break;
    }
    return renderReelsCard(product, rank, ratio, script, format);
  });

  container.innerHTML = cards.join('');
}

// =========================================
// 인팸 자재 지식 데이터베이스 (노션 FAQ 기반)
// =========================================
const PRODUCT_KNOWLEDGE = {
  wpc: {
    label: 'WPC 패널',
    badge: '💡 WPC',
    badgeClass: 'wpc',
    problemHooks: {
      consumer: [
        '❌ 벽 공사비용이 너무 비싸서 포기하셨나요?',
        '❌ 철거 먼지 때문에 리모델링 엄두도 못 내셨죠?',
        '❌ 무거운 타일 공사, 3일씩 걸리는 거 참고 계셨나요?',
        '❌ "인테리어 업체 견적이 왜 이렇게 비싸죠?"',
        '❌ 신혼집 벽, 도배만으로 만족하시나요?',
        '❌ 벽 인테리어 하고 싶은데 세입자라 못하겠다고요?',
        '❌ 거실 벽이 너무 심심해서 고민이셨죠?',
        '❌ 인테리어 견적서 보고 현타 온 적 있으시죠?',
        '❌ 아이 방 벽, 안전한 자재로 바꾸고 싶으셨죠?',
        '❌ 셀프 인테리어 하다가 벽에서 막히셨나요?',
      ],
      business: [
        '❌ 시공 현장에서 자재 절단 때문에 시간 낭비하셨나요?',
        '❌ 고객에게 고급자재 제안하면 비용 때문에 거절당하셨죠?',
        '❌ 철거 없이 시공할 수 있는 자재를 찾고 계시죠?',
        '❌ 시공 인건비는 오르는데 마진은 줄고 있으신가요?',
        '❌ 하루 만에 끝나는 벽체 시공, 가능하다고 생각하시나요?',
        '❌ 자재 발주했는데 현장 사이즈 안 맞는 경험?',
        '❌ 인테리어 업체라면 이 자재는 꼭 알아야 합니다',
        '❌ 고객이 "싸게 해주세요"할 때 답이 있습니다',
      ],
    },
    beforeAfterHooks: [
      '✨ 풀칠 한 번으로 이 벽이 완성됐어요',
      '✨ 공사 없이 하루 만에 완성된 거예요',
      '✨ 타일 철거 없이 이렇게 바뀔 수 있어요',
    ],
    problem: `타일 교체 = 비용·먼지·시간\n리모델링을 포기하게 만드는 3가지 이유.\n이제 다른 방법이 있습니다.`,
    solution: `인팸 WPC 패널로 해결하세요.\n✅ 기존 벽 위에 본드만으로 시공\n✅ 초경량(약 10kg) — 혼자서도 시공 가능\n✅ 트리머·수동톱으로 현장 절단 OK\n✅ 철거·먼지 없이 하루 만에 완성`,
    beforeText: `BEFORE ──────────\n› 낡고 칙칙한 기존 벽면\n› 비용·먼지에 막힌 리모델링\n› 포기하고 방치한 공간`,
    afterText: (name, color) => `AFTER ───────────\n› [${name}${color}] 시공 후\n› 프리미엄 스톤 텍스처로 완벽 변신\n› 공사 없이 하루 만에 완성`,
    detail: `📌 WPC 자재 포인트\n✔ 목재섬유+폴리머 복합 — 초경량\n✔ 일반 공구로 현장 직접 절단\n✔ 거실·침실·건식 공간 적합\n✔ 철거 없이 기존 벽 위 시공 가능`,
    cta: `프로필 링크에서\n무료 샘플 신청하고\n직접 느껴보세요 👆`,
    captionProblem: (name, color) => `공사비, 먼지, 시간... 리모델링 3가지 고민을 한 번에 해결하는 방법 🙌\n\n인팸 WPC 패널 [${name}${color}]\n기존 벽 위에 본드만으로 시공 완료!\n\n👉 무료 샘플·카다로그: 프로필 링크\n\n#인테리어패밀리 #인팸 #WPC패널 #인테리어자재 #공사없이인테리어 #벽패널 #릴스`,
    captionBefore: (name, color) => `BEFORE → AFTER 🤯 이게 같은 공간이에요!\n\n인팸 WPC 패널 [${name}${color}]\n› 철거 0 · 먼지 0 · 하루 만에 완성\n\n📩 샘플 신청: 프로필 링크\n\n#인테리어패밀리 #인팸 #비포애프터 #WPC패널 #인테리어 #릴스`,
  },
  spc: {
    label: 'SPC 패널',
    badge: '🚿 SPC',
    badgeClass: 'spc',
    problemHooks: {
      consumer: [
        '❌ 욕실 타일 깨진 거 몇 달째 방치하고 계세요?',
        '❌ 욕실 리모델링 견적 보고 식겁하셨죠?',
        '❌ 방수 안 되는 줄 알고 포기했던 벽 인테리어?',
        '❌ 욕실 줄눈 곰팡이, 아무리 닦아도 안 없어지죠?',
        '❌ 욕실 타일 교체비용 200만원 이상이라고요?',
        '❌ 화장실이 너무 낡아서 손님 초대 못 하시나요?',
        '❌ 욕실 벽에 패널 붙이면 방수 안 될 거라고요?',
        '❌ 호텔 같은 욕실, 꿈만 꾸고 계셨나요?',
      ],
      business: [
        '❌ 욕실 시공에서 방수 처리가 항상 걱정이시죠?',
        '❌ 타일 시공 후 줄눈 하자 클레임 경험 있으시죠?',
        '❌ 욕실 벽 자재 선택, 고객 만족도가 고민이시죠?',
        '❌ 습기 많은 공간에 시공 가능한 고급 자재 찾으시죠?',
        '❌ 타일 철거 비용이 전체 견적의 절반인 현실',
        '❌ 욕실 시공 기간을 반으로 줄일 수 있다면?',
      ],
    },
    beforeAfterHooks: [
      '✨ 욕실 타일, 이렇게 쉽게 바꿀 수 있어요',
      '✨ 욕실이 호텔처럼 바뀌는 데 하루면 충분해요',
      '✨ 방수되는 스톤 패널로 욕실이 바뀌었어요',
    ],
    problem: `욕실 타일 교체 = 최소 200만원 + 일주일\n무거운 타일, 방수 처리, 줄눈 관리까지\n이 고통을 끝낼 방법이 있습니다.`,
    solution: `인팸 SPC 패널로 해결하세요.\n✅ 완벽 방수 — 욕실 벽면 바로 적용 가능\n✅ 천연 스톤 텍스처 — 타일과 구분 불가\n✅ 기존 타일 위에 덧붙이기 시공 OK\n✅ 줄눈 청소 필요 없음 — 유지비 0`,
    beforeText: `BEFORE ──────────\n› 오염된 줄눈, 깨진 욕실 타일\n› 눅눅하고 어두운 욕실 분위기\n› 수백만원 공사비에 막힌 교체`,
    afterText: (name, color) => `AFTER ───────────\n› [${name}${color}] SPC 패널 시공\n› 호텔급 마블 텍스처로 변신\n› 방수 + 위생 + 고급감 모두 해결`,
    detail: `📌 SPC 자재 포인트\n✔ 석분+폴리머 — 완벽 방수\n✔ 욕실·주방·세탁실 벽면 적합\n✔ 줄눈 0 — 관리 초간편\n✔ 기존 타일 위 덧붙이기 가능`,
    cta: `프로필 링크에서\n욕실용 샘플 무료 신청\n지금 바로 확인하세요 👆`,
    captionProblem: (name, color) => `욕실 타일 교체, 몇 백만원 들 필요 없어요 🚿✨\n\n인팸 SPC 패널 [${name}${color}]\n› 방수 OK · 줄눈 없음 · 기존 타일 위 시공\n\n👉 샘플·카다로그: 프로필 링크\n\n#인테리어패밀리 #인팸 #SPC패널 #욕실인테리어 #방수벽재 #인테리어자재 #릴스`,
    captionBefore: (name, color) => `욕실이 호텔로 바뀌는 데... 하루면 충분해요 😲\n\n인팸 SPC 패널 [${name}${color}]\n› 방수 · 내구성 · 고급 텍스처 all-in-one\n\n📩 샘플 신청: 프로필 링크\n\n#인테리어패밀리 #인팸 #비포애프터 #욕실리모델링 #SPC패널 #릴스`,
  },
  softstone: {
    label: '소프트스톤',
    badge: '🔥 소프트스톤',
    badgeClass: 'soft',
    problemHooks: {
      consumer: [
        '❌ 벽난로 옆 벽, 열 때문에 자재 못 쓰고 계세요?',
        '❌ 곡면 벽, 어떤 자재로도 마감이 안 됐나요?',
        '❌ 천연석 느낌 원하는데 무게·비용이 문제라면?',
        '❌ 벽난로 옆 자재, 불안하지 않으세요?',
        '❌ 진짜 돌처럼 보이는 자재가 있다면?',
        '❌ 포인트 벽 하나로 집 분위기 바꾸고 싶으셨죠?',
      ],
      business: [
        '❌ 열에 약한 자재 때문에 벽난로 시공 거절하셨죠?',
        '❌ 곡면 벽 마감, 주문제작 외에 방법이 없었나요?',
        '❌ 천연석 무게 때문에 시공 포기한 현장 있으시죠?',
        '❌ 포인트 벽 시공에 차별화된 자재가 필요하시죠?',
        '❌ 고객이 "특별한 자재"를 원할 때 답이 있습니다',
      ],
    },
    beforeAfterHooks: [
      '✨ 화로 옆 벽, 이렇게 마감할 수 있었어요',
      '✨ 곡면 벽도 거뜬한 자재가 있었어요',
      '✨ 진짜 돌인 줄 알았는데... 소프트스톤이에요',
    ],
    problem: `벽난로 옆·곡면 공간은 일반 자재로 불가능\n열에 약하고, 구부러지지 않고,\n주문제작은 수백만원...`,
    solution: `인팸 소프트스톤으로 해결하세요.\n✅ 내열성 — 벽난로·난로 옆 시공 가능\n✅ 유연성 — 곡면·아치형 벽 마감 OK\n✅ 점토+시멘트 복합재 — 천연석 텍스처\n✅ 포인트 벽으로 공간 분위기 완전 전환`,
    beforeText: `BEFORE ──────────\n› 마감 안 된 벽난로 주변 벽\n› 곡면에 맞는 자재 못 찾아 방치\n› 밋밋하고 완성도 낮은 공간`,
    afterText: (name, color) => `AFTER ───────────\n› [${name}${color}] 소프트스톤 시공\n› 천연석 포인트 벽 완성\n› 내열·유연·고급감 모두 해결`,
    detail: `📌 소프트스톤 자재 포인트\n✔ 점토+시멘트 복합재 — 내열성\n✔ 유연성 — 곡면·아치 시공 가능\n✔ 천연석 질감 — 자연스러운 패턴\n✔ 포인트 벽·벽난로 주변 최적`,
    cta: `프로필 링크에서\n소프트스톤 샘플 신청\n공간이 달라집니다 👆`,
    captionProblem: (name, color) => `열도 견디고, 구부러지기도 하는 자재?! 🔥✨\n\n인팸 소프트스톤 [${name}${color}]\n› 벽난로 옆·곡면벽 시공 가능\n› 천연석 텍스처 그대로\n\n👉 샘플·카다로그: 프로필 링크\n\n#인테리어패밀리 #인팸 #소프트스톤 #포인트벽 #벽난로인테리어 #인테리어자재 #릴스`,
    captionBefore: (name, color) => `곡면 벽을 이렇게 마감하는 자재가 있었어요 😍\n\n인팸 소프트스톤 [${name}${color}]\n› 내열·유연·천연석 질감 삼위일체\n\n📩 샘플 신청: 프로필 링크\n\n#인테리어패밀리 #인팸 #비포애프터 #소프트스톤 #인테리어자재 #릴스`,
  },
  carving: {
    label: '카빙스톤',
    badge: '✨ 카빙스톤',
    badgeClass: 'carving',
    problemHooks: {
      consumer: [
        '❌ 고급스러운 포인트 벽, 비용 때문에 포기했나요?',
        '❌ 평범한 인테리어에서 벗어나고 싶으셨죠?',
        '❌ 럭셔리 공간, 자재 선택부터 막막하셨나요?',
        '❌ 대리석 포인트 벽, 무게와 비용이 문제죠?',
        '❌ 호텔 로비 같은 벽, 집에서도 가능할까요?',
        '❌ 고급 인테리어의 비밀은 벽에 있습니다',
      ],
      business: [
        '❌ VIP 고객에게 제안할 프리미엄 자재 찾으시죠?',
        '❌ 고급 마감재 시공 단가가 너무 높으신가요?',
        '❌ 럭셔리 공간 연출에 차별화된 무기가 필요하시죠?',
        '❌ 포인트 벽 하나로 시공 단가를 올릴 수 있다면?',
        '❌ 갤러리·호텔급 마감, 이 자재로 가능합니다',
      ],
    },
    beforeAfterHooks: [
      '✨ 포인트 벽 하나로 공간이 이렇게 달라져요',
      '✨ 럭셔리 텍스처, 이 자재로 완성됐어요',
      '✨ 갤러리 같은 공간, 벽 하나의 차이예요',
    ],
    problem: `고급 인테리어는 자재부터 다릅니다.\n평범한 도배·타일로는 낼 수 없는\n그 특별한 텍스처가 있습니다.`,
    solution: `인팸 카빙스톤으로 해결하세요.\n✅ 최고급 심미성 — 갤러리·럭셔리 호텔 수준\n✅ 독특한 입체 카빙 텍스처\n✅ 포인트 벽 하나로 공간 전체 레벨업\n✅ 기존 벽 위 본드 시공 — 공사 최소화`,
    beforeText: `BEFORE ──────────\n› 평범한 벽지, 밋밋한 마감\n› 고급감 없는 인테리어\n› 비싼 대리석은 엄두도 못 내`,
    afterText: (name, color) => `AFTER ───────────\n› [${name}${color}] 카빙스톤 포인트 벽\n› 갤러리·럭셔리 호텔급 분위기\n› 공간 전체 레벨이 달라짐`,
    detail: `📌 카빙스톤 자재 포인트\n✔ 최고급 심미성 — 독보적 텍스처\n✔ 포인트 벽 포지셔닝 최적\n✔ 기존 벽 위 본드 시공\n✔ 럭셔리 공간 연출의 완성`,
    cta: `프로필 링크에서\n카빙스톤 샘플·쇼룸 예약\n럭셔리 공간을 경험하세요 👆`,
    captionProblem: (name, color) => `이 텍스처, 실제로 보면 진짜 돌인 줄 알아요 ✨\n\n인팸 카빙스톤 [${name}${color}]\n› 포인트 벽 하나로 공간 전체 레벨업\n\n👉 샘플·쇼룸 예약: 프로필 링크\n\n#인테리어패밀리 #인팸 #카빙스톤 #포인트벽 #럭셔리인테리어 #인테리어자재 #릴스`,
    captionBefore: (name, color) => `같은 공간인데 왜 이렇게 다르게 보일까요? ✨\n\n인팸 카빙스톤 [${name}${color}]\n› 독보적 카빙 텍스처로 공간 격 상승\n\n📩 쇼룸 예약: 프로필 링크\n\n#인테리어패밀리 #인팸 #비포애프터 #카빙스톤 #럭셔리인테리어 #릴스`,
  },
  default: {
    label: '인팸 자재',
    badge: '🏠 인팸',
    badgeClass: '',
    problemHooks: {
      consumer: [
        '❌ 인테리어 마무리, 자재 선택에서 막히셨나요?',
        '❌ 비용·공사 때문에 리모델링 포기하셨나요?',
        '❌ 고급 인테리어 원하는데 예산이 문제라면?',
        '❌ 인테리어 자재, 어디서 어떻게 골라야 할지 모르겠죠?',
        '❌ 셀프 인테리어 도전하고 싶은데 자재가 문제?',
        '❌ 우리 집도 인스타에 나오는 그 인테리어 가능할까요?',
      ],
      business: [
        '❌ 자재 선택 때문에 견적이 늘어나고 계시죠?',
        '❌ 시공 효율과 고급감을 동시에 잡을 자재 찾으시죠?',
        '❌ 고객 만족도 높은 자재 라인업이 필요하시죠?',
        '❌ 인테리어 업계 종사자라면 알아야 할 자재입니다',
        '❌ 경쟁사와 차별화되는 자재 포트폴리오 원하시죠?',
      ],
    },
    beforeAfterHooks: [
      '✨ 자재 하나로 공간이 이렇게 달라져요',
      '✨ 인팸 자재로 공간이 완성됐습니다',
      '✨ 인테리어의 차이는 자재에서 시작해요',
    ],
    problem: `인테리어 고민의 본질은 자재 선택.\n비용·시간·품질, 세 가지를 동시에\n만족시키는 자재가 있을까요?`,
    solution: `인팸 자재로 해결하세요.\n✅ 기존 벽 위 본드 시공 — 철거 없음\n✅ 천연석·원목 느낌의 프리미엄 패턴\n✅ 현장 즉시 절단 — 맞춤 시공\n✅ 샘플·카다로그 무료 제공`,
    beforeText: `BEFORE ──────────\n› 낡고 밋밋한 기존 인테리어\n› 자재 선택 못 해 방치된 공간\n› 비용·시간에 막힌 리모델링`,
    afterText: (name, color) => `AFTER ───────────\n› [${name}${color}] 인팸 자재 시공\n› 프리미엄 텍스처로 완벽 변신\n› 하루 만에 달라진 공간`,
    detail: `📌 인팸 자재 포인트\n✔ WPC/SPC/소프트스톤/카빙스톤 라인업\n✔ 기존 벽 위 본드 시공\n✔ 현장 즉시 절단 가능\n✔ 샘플·쇼룸 무료 운영`,
    cta: `프로필 링크에서\n샘플·쇼룸 예약하고\n직접 확인하세요 👆`,
    captionProblem: (name, color) => `인테리어 고민, 이 자재 하나로 해결됩니다 🏠✨\n\n인팸 [${name}${color}]\n› 철거 없음 · 당일 시공 · 프리미엄 마감\n\n👉 샘플·카다로그: 프로필 링크\n\n#인테리어패밀리 #인팸 #인테리어자재 #벽패널 #인테리어 #릴스`,
    captionBefore: (name, color) => `같은 공간이 맞나요? BEFORE → AFTER 🤯\n\n인팸 [${name}${color}]\n› 본드 시공 · 당일 완성 · 퀄리티 UP\n\n📩 샘플 신청: 프로필 링크\n\n#인테리어패밀리 #인팸 #비포애프터 #인테리어자재 #릴스`,
  },
};

/**
 * 품목명에서 자재 종류를 감지합니다.
 * @param {string} name
 * @returns {string} wpc | spc | softstone | carving | default
 */
function detectMaterial(name) {
  const lower = name.toLowerCase();
  if (/소프트스톤|soft\s*stone|softstone/.test(lower)) return 'softstone';
  if (/카빙스톤|carving\s*stone|carvingstone/.test(lower)) return 'carving';
  if (/spc/.test(lower) || /욕실|bathroom|방수/.test(lower)) return 'spc';
  if (/wpc/.test(lower) || /벽패널|wall\s*panel|패널/.test(lower)) return 'wpc';
  // 일반 도어/자재는 제품 특성에 따라 구분
  if (/도어|door|중문/.test(lower)) return 'default';
  return 'default';
}

function buildProblemScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const mat = PRODUCT_KNOWLEDGE[detectMaterial(name)];
  const hooks = mat.problemHooks[audience] || mat.problemHooks.consumer;
  const hook = hooks[(rank - 1) % hooks.length];
  const ctaText = getCTA(audience, rank);
  return {
    hook, material: mat,
    overlayText: hook.replace('❌ ', ''),
    ctaType: audience === 'business' ? '📋 카다로그 요청' : '💬 댓글 유도',
    scenes: [
      { time: '0~2s', icon: '🎬', label: '훅(Hook)', text: hook },
      { time: '2~5s', icon: '😮', label: '문제 공감', text: mat.problem },
      { time: '5~12s', icon: '💡', label: '해결책 제시', text: mat.solution },
      { time: '12~17s', icon: '🤩', label: '변화 비교', text: `Before: ${mat.beforeText.split('\\n')[0]}\\nAfter: ${mat.afterText(shortName, colorStr).split('\\n')[0]}` },
      { time: '17~20s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: mat.captionProblem(shortName, colorStr),
  };
}

function buildBeforeAfterScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const mat = PRODUCT_KNOWLEDGE[detectMaterial(name)];
  const hook = mat.beforeAfterHooks[(rank - 1) % mat.beforeAfterHooks.length];
  const ctaText = getCTA(audience, rank);
  return {
    hook, material: mat,
    overlayText: '같은 공간 맞나요? 🤯',
    ctaType: '📸 저장 유도',
    scenes: [
      { time: '0~2s', icon: '🎬', label: '훅(Hook)', text: hook },
      { time: '2~6s', icon: '😟', label: 'BEFORE 장면', text: mat.beforeText },
      { time: '6~13s', icon: '🌟', label: 'AFTER 장면', text: mat.afterText(shortName, colorStr) },
      { time: '13~17s', icon: '📐', label: '디테일·자재 컷', text: mat.detail },
      { time: '17~20s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: mat.captionBefore(shortName, colorStr),
  };
}

function buildConstructionLogScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const mat = PRODUCT_KNOWLEDGE[detectMaterial(name)];
  const ctaText = getCTA(audience, rank);
  const hook = audience === 'business' ? `🏗️ ${mat.label} 현장 시공 — 8초 요약` : `🏗️ 8초 시공일지 — ${mat.label} 편`;
  return {
    hook, material: mat,
    overlayText: `8초 시공일지 🏗️ ${shortName}`,
    ctaType: '💬 댓글 유도',
    scenes: [
      { time: '0~1s', icon: '🎬', label: '훅(Hook)', text: hook },
      { time: '1~2s', icon: '📦', label: '자재 언박싱', text: `[${shortName}${colorStr}] 자재 도착\\n패키지 개봉 및 자재 확인 컷` },
      { time: '2~4s', icon: '✂️', label: '절단·준비', text: `현장 사이즈 맞춤 절단\\n${mat.detail.split('\\n').slice(1, 3).join('\\n')}` },
      { time: '4~6s', icon: '🔨', label: '시공 과정', text: `기존 벽 위 본드 도포 → 부착\\n빠른 몽타주 컷 (4~6컷)` },
      { time: '6~8s', icon: '✨', label: '완성 공개', text: mat.afterText(shortName, colorStr) },
      { time: '8~10s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: `🏗️ 8초 시공일지 — ${shortName}${colorStr}\\n\\n시공 전 → 시공 후\\n${mat.label}로 하루 만에 완성!\\n\\n💬 "카다로그" 댓글로 무료 자재 정보 받기\\n\\n#인테리어패밀리 #인팸 #시공일지 #${mat.label.replace(/\s/g, '')} #인테리어 #릴스`,
  };
}

function buildExpertTipScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const mat = PRODUCT_KNOWLEDGE[detectMaterial(name)];
  const ctaText = getCTA(audience, rank);
  const myths = [
    { myth: '자재 탓 하지 마세요', truth: '시공법이 90%입니다', tip: '좋은 자재도 잘못된 시공법 앞에선 무력합니다.' },
    { myth: '비싼 자재가 좋은 자재?', truth: '용도에 맞는 자재가 최고', tip: '가격이 아닌 공간 특성에 맞는 선택이 중요합니다.' },
    { myth: '벽 인테리어 = 철거 필수?', truth: '기존 벽 위에 시공 가능', tip: '먼지·소음 없이 하루 만에 벽 변신이 가능합니다.' },
  ];
  const mythData = myths[(rank - 1) % myths.length];
  const hook = `💡 "${mythData.myth}" — ${audience === 'business' ? '시공 전문가' : '인테리어'} 꿀팁`;
  return {
    hook, material: mat,
    overlayText: mythData.myth,
    ctaType: audience === 'business' ? '📋 전문가 상담' : '💾 저장 유도',
    scenes: [
      { time: '0~2s', icon: '🎬', label: '훅(Hook)', text: hook },
      { time: '2~5s', icon: '❌', label: '일반적 통념', text: `많은 분들이 이렇게 생각합니다:\\n"${mythData.myth}"\\n→ 이건 반은 맞고 반은 틀립니다.` },
      { time: '5~10s', icon: '✅', label: '전문가 팩트', text: `진실: ${mythData.truth}\\n\\n${mythData.tip}` },
      { time: '10~15s', icon: '📐', label: '자재 시연', text: `[${shortName}${colorStr}] 실제 시연\\n${mat.detail}` },
      { time: '15~18s', icon: '💡', label: '핵심 요약', text: `기억하세요:\\n✔ ${mythData.truth}\\n✔ 용도에 맞는 자재 선택이 답` },
      { time: '18~20s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: `💡 "${mythData.myth}" — 진짜일까요?\\n\\n정답: ${mythData.truth}\\n${mythData.tip}\\n\\n인팸 ${mat.label}로 직접 확인해보세요.\\n\\n${audience === 'business' ? '📋 전문가 상담: 프로필 링크' : '💾 저장해두고 시공 전 참고하세요!'}\\n\\n#인테리어패밀리 #인팸 #인테리어팁 #전문가조언 #${mat.label.replace(/\s/g, '')} #릴스`,
  };
}

function buildNewMaterialScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const mat = PRODUCT_KNOWLEDGE[detectMaterial(name)];
  const ctaText = getCTA(audience, rank);
  const hook = audience === 'business'
    ? `📢 시공업자 주목! ${mat.label} — 이런 자재 써보셨나요?`
    : `📢 이런 자재가 있었어요? ${mat.label} 처음 보시죠?`;
  return {
    hook, material: mat,
    overlayText: `이런 자재가? 😲 ${mat.label}`,
    ctaType: '🎁 샘플 신청',
    scenes: [
      { time: '0~2s', icon: '🎬', label: '훅(Hook)', text: hook },
      { time: '2~5s', icon: '😲', label: '호기심 자극', text: `${mat.label}을 아시나요?\\n대부분의 사람들이 모르는 자재입니다.` },
      { time: '5~10s', icon: '🔬', label: '자재 특성 시연', text: mat.detail },
      { time: '10~15s', icon: '🌟', label: '시공 결과물', text: mat.afterText(shortName, colorStr) },
      { time: '15~18s', icon: '💰', label: '가격·접근성', text: `생각보다 합리적인 가격\\n✔ 무료 샘플 제공\\n✔ 전국 배송 가능\\n✔ 시공 가이드 제공` },
      { time: '18~20s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: `📢 ${mat.label} — 이런 자재 처음 보시죠? 😲\\n\\n[${shortName}${colorStr}]\\n${mat.detail.split('\\n').slice(0, 3).join('\\n')}\\n\\n🎁 무료 샘플 신청: 프로필 링크\\n💬 "샘플" 댓글로 바로 신청!\\n\\n#인테리어패밀리 #인팸 #신자재 #${mat.label.replace(/\s/g, '')} #인테리어자재 #릴스`,
  };
}

// =========================================
// 유튜브 쇼츠 분석 기반 자재별 실험/Q&A 데이터
// (@interior__family/shorts 분석 반영)
// =========================================
const SHORTS_KNOWLEDGE = {
  wpc: {
    shockStats: [
      { stat: '1M 크기인데 고작 3kg!', emoji: '😮', detail: '일반 타일 대비 6배 가벼운 초경량 패널' },
      { stat: '시공비 50% 절감', emoji: '💰', detail: '철거 없이 기존 벽 위 본드 시공으로 비용 절반' },
      { stat: '먼지 0 · 소음 0 · 하루 완성', emoji: '✨', detail: '3일 걸리던 공사가 당일 완료' },
    ],
    experiments: [
      { test: '커터칼 재단 테스트', action: '커터칼로 WPC 패널을 직접 절단', result: '깔끔한 절단면 — 전문 공구 불필요!', icon: '✂️' },
      { test: '무게 비교 테스트', action: '한 손으로 WPC 패널 들어올리기', result: '초경량! 혼자서도 시공 가능', icon: '💪' },
      { test: '접착력 테스트', action: '본드 도포 후 벽면 부착 → 잡아당기기', result: '강력 접착 — 떨어지지 않음', icon: '🔗' },
    ],
    qnaTopics: [
      { q: 'WPC 패널 셀프 시공 가능한가요?', a: '네! 본드만 있으면 됩니다. 커터칼로 절단하고 본드로 붙이면 끝. 전문 시공 없이 혼자서도 하루 만에 완성 가능합니다.' },
      { q: 'WPC 패널 내구성은 어떤가요?', a: '목재섬유+폴리머 복합재질이라 변형·변색에 강합니다. 실내 환경에서 10년 이상 유지됩니다.' },
      { q: 'WPC 패널과 타일, 뭐가 다른가요?', a: '무게가 6배 가볍고, 철거 없이 기존 벽 위에 바로 시공 가능합니다. 비용은 절반 이하!' },
    ],
  },
  spc: {
    shockStats: [
      { stat: '방수율 100% — 욕실 벽면 OK', emoji: '🚿', detail: '석분+폴리머 소재로 완벽 방수' },
      { stat: '줄눈 0개 — 곰팡이 안녕', emoji: '🦠', detail: '줄눈 없는 원장 패널로 위생적' },
      { stat: '타일 교체비용 80% 절감', emoji: '💰', detail: '기존 타일 위 덧붙이기로 철거비 0원' },
    ],
    experiments: [
      { test: '방수 테스트', action: 'SPC 패널 위에 물을 쏟아 붓기', result: '완벽 방수! 물이 전혀 스며들지 않음', icon: '💧' },
      { test: '내구성 테스트', action: 'SPC 패널을 망치로 타격', result: '깨지지 않음 — 타일보다 강한 내충격성', icon: '🔨' },
      { test: '스크래치 테스트', action: '열쇠로 SPC 패널 표면 긁기', result: '스크래치 방지 코팅으로 흠집 없음', icon: '🔑' },
    ],
    qnaTopics: [
      { q: 'SPC 패널 욕실에 진짜 괜찮나요?', a: '석분+폴리머 복합 소재로 방수율 100%입니다. 욕실·주방·세탁실 벽면에 최적화되어 있습니다.' },
      { q: '기존 타일 위에 바로 붙일 수 있나요?', a: '네! 기존 타일 철거 없이 바로 위에 덧붙이기 시공이 가능합니다. 철거비 0원, 먼지 0입니다.' },
      { q: 'SPC 패널 관리는 어떻게 하나요?', a: '줄눈이 없어서 물걸레로 한 번 닦으면 끝! 곰팡이가 생길 틈이 없습니다.' },
    ],
  },
  softstone: {
    shockStats: [
      { stat: '3M 크기의 돌이 단 5kg?!', emoji: '😮', detail: '천연석 대비 10배 이상 가벼운 초경량 석재' },
      { stat: '300°C 내열 — 벽난로 옆 OK', emoji: '🔥', detail: '점토+시멘트 복합재의 뛰어난 내열성' },
      { stat: '곡면 시공도 끄떡없음', emoji: '🌀', detail: '유연한 소재로 아치형·곡면 벽 마감 가능' },
    ],
    experiments: [
      { test: '방염 테스트', action: '소프트스톤에 직접 불 붙이기 (토치)', result: '불에 타지 않음! 방염 성능 입증', icon: '🔥' },
      { test: '유연성 테스트', action: '소프트스톤을 90도로 휘어보기', result: '곡면 시공 가능 — 깨지지 않고 휘어짐', icon: '🌀' },
      { test: '무게 비교 테스트', action: '천연석 vs 소프트스톤 무게 비교', result: '10배 이상 가벼움! 한 손으로 OK', icon: '⚖️' },
    ],
    qnaTopics: [
      { q: '소프트스톤이면 진짜 곡면 시공 되나요?', a: '네! 점토+시멘트 복합재라 유연성이 뛰어납니다. 아치형 벽, 곡면 기둥 등 일반 석재로 불가능한 곳도 마감 가능합니다.' },
      { q: '벽난로 옆에 써도 안전한가요?', a: '300°C 이상 내열 성능이 검증되었습니다. 벽난로·화로 주변 벽면에 안심하고 사용 가능합니다.' },
      { q: '진짜 돌처럼 보이나요?', a: '천연 석재 원판에서 직접 패턴을 떠서 제작합니다. 눈으로 봐서는 진짜 돌과 구분이 안 됩니다!' },
    ],
  },
  carving: {
    shockStats: [
      { stat: '대리석의 1/5 무게, 2배 고급감', emoji: '✨', detail: '천연 대리석 무게의 20%로 럭셔리 표현' },
      { stat: '커터칼로 재단 가능한 대리석?!', emoji: '🔥', detail: '전문 석재 장비 없이 현장 절단 OK' },
      { stat: '포인트 벽 하나로 공간 가치 UP', emoji: '📈', detail: '럭셔리 호텔급 공간 연출' },
    ],
    experiments: [
      { test: '커터칼 재단 테스트', action: '카빙스톤을 커터칼로 직접 재단', result: '깔끔한 절단! 전문 장비 불필요', icon: '✂️' },
      { test: '질감 비교 테스트', action: '천연 대리석과 카빙스톤 나란히 비교', result: '구분 불가! 동일한 고급 텍스처', icon: '👁️' },
      { test: '설치 시연', action: '본드 도포 → 벽면 부착 과정 시연', result: '10분 만에 포인트 벽 완성', icon: '⏱️' },
    ],
    qnaTopics: [
      { q: '카빙스톤 실제로 만져보면 어때요?', a: '천연 석재에서 직접 패턴을 떠서 제작해 실제 돌의 질감이 그대로 살아있습니다. 직접 만져보시면 놀라실 겁니다.' },
      { q: '시공이 어렵지 않나요?', a: '커터칼로 재단 가능하고, 본드만으로 시공됩니다. 전문 석재 장비가 전혀 필요 없습니다.' },
      { q: '어떤 공간에 어울리나요?', a: '거실 포인트 벽, 현관, 침실 헤드 월 등 럭셔리 공간 연출이 필요한 곳에 최적입니다.' },
    ],
  },
  default: {
    shockStats: [
      { stat: '시공비 50% 절감 가능', emoji: '💰', detail: '철거 없이 기존 벽 위 시공으로 비용 절반' },
      { stat: '당일 배송 · 당일 시공', emoji: '🚀', detail: '주문 즉시 배송, 하루 만에 시공 완료' },
      { stat: '무료 샘플 즉시 발송', emoji: '📦', detail: '실제 자재 확인 후 결정 가능' },
    ],
    experiments: [
      { test: '무게 비교 테스트', action: '인팸 자재 vs 일반 타일 무게 비교', result: '최대 6배 가벼움! 시공 편의성 극대화', icon: '⚖️' },
      { test: '시공 속도 테스트', action: '타이머 켜고 1㎡ 시공 타임어택', result: '10분 이내 완성 — 초간편 시공', icon: '⏱️' },
      { test: '내구성 테스트', action: '자재 표면 스크래치·충격 테스트', result: '강화 코팅으로 흠집 없음', icon: '💪' },
    ],
    qnaTopics: [
      { q: '인팸 자재 샘플 받을 수 있나요?', a: '네! 프로필 링크에서 무료 샘플 신청하시면 실제 자재 샘플을 무료 발송해드립니다.' },
      { q: '셀프 시공 가능한가요?', a: '본드만 있으면 됩니다. 전문 시공 없이 혼자서도 가능하며, 시공 가이드 영상도 제공합니다.' },
      { q: '어떤 자재가 우리 집에 맞나요?', a: '공간 용도에 따라 WPC(거실), SPC(욕실), 소프트스톤(포인트벽), 카빙스톤(럭셔리)을 추천드립니다.' },
    ],
  },
};

// =========================================
// 🔬 실험검증형 대본 (쇼츠 최고 성과 패턴)
// =========================================
function buildExperimentScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const matKey = detectMaterial(name);
  const mat = PRODUCT_KNOWLEDGE[matKey];
  const shorts = SHORTS_KNOWLEDGE[matKey] || SHORTS_KNOWLEDGE.default;
  const ctaText = getCTA(audience, rank);

  const expData = shorts.experiments[(rank - 1) % shorts.experiments.length];
  const shockData = shorts.shockStats[(rank - 1) % shorts.shockStats.length];

  const hook = audience === 'business'
    ? `🔬 시공업자가 직접 검증! ${mat.label} ${expData.test}`
    : `🔬 ${shockData.stat} — 직접 실험해봤습니다!`;

  return {
    hook, material: mat,
    overlayText: `${shockData.emoji} ${shockData.stat}`,
    ctaType: '📸 저장 유도',
    scenes: [
      { time: '0~2s', icon: '🎬', label: '충격 훅(Hook)', text: `${hook}\\n\\n${shockData.emoji} "${shockData.stat}"` },
      { time: '2~5s', icon: expData.icon, label: '실험 준비', text: `실험: ${expData.test}\\n준비물 세팅 및 자재 클로즈업\\n[${shortName}${colorStr}]` },
      { time: '5~10s', icon: '🎥', label: '실험 진행', text: `${expData.action}\\n(슬로모션 + 클로즈업 컷)\\n시청자 시선을 사로잡는 시각적 증명` },
      { time: '10~14s', icon: '✅', label: '결과 공개', text: `결과: ${expData.result}\\n\\n${shockData.detail}` },
      { time: '14~17s', icon: '📐', label: '자재 스펙', text: mat.detail },
      { time: '17~20s', icon: '📲', label: 'CTA', text: ctaText },
    ],
    caption: `🔬 ${expData.test} — ${mat.label} 실험 결과!\\n\\n${shockData.emoji} ${shockData.stat}\\n${expData.result}\\n\\n[${shortName}${colorStr}]\\n\\n💾 저장해두고 시공 전 참고하세요!\\n👉 무료 샘플: 프로필 링크\\n\\n#인테리어패밀리 #인팸 #실험검증 #${mat.label.replace(/\s/g, '')} #인테리어자재 #쇼츠 #릴스`,
  };
}

// =========================================
// 💬 무물 Q&A 대본 (신뢰도 구축형)
// =========================================
function buildQnAScript(product, rank, audience) {
  const name = product.productName;
  const shortName = name.split(/[\s\/]+/).slice(0, 2).join(' ');
  const color = extractColorFromName(name);
  const colorStr = color ? ` ${color}` : '';
  const matKey = detectMaterial(name);
  const mat = PRODUCT_KNOWLEDGE[matKey];
  const shorts = SHORTS_KNOWLEDGE[matKey] || SHORTS_KNOWLEDGE.default;
  const ctaText = getCTA(audience, rank);

  const qna = shorts.qnaTopics[(rank - 1) % shorts.qnaTopics.length];
  const shockData = shorts.shockStats[(rank - 1) % shorts.shockStats.length];

  const hook = audience === 'business'
    ? `💬 시공업체 필독! "${qna.q}"`
    : `💬 인팸 무물 — "${qna.q}"`;

  return {
    hook, material: mat,
    overlayText: `Q. ${qna.q}`,
    ctaType: '💬 댓글로 질문',
    scenes: [
      { time: '0~2s', icon: '💬', label: '질문 소개', text: `${hook}\\n\\n구독자님의 질문을 공개합니다!` },
      { time: '2~5s', icon: '❓', label: '질문 상세', text: `Q. "${qna.q}"\\n\\n이런 궁금증, 많이들 하시죠?\\n오늘 확실하게 답변드립니다.` },
      { time: '5~12s', icon: '✅', label: '전문가 답변', text: `A. ${qna.a}` },
      { time: '12~16s', icon: '🔬', label: '실제 시연', text: `[${shortName}${colorStr}] 실제 시공/시연 장면\\n\\n${shockData.emoji} ${shockData.stat}\\n${shockData.detail}` },
      { time: '16~18s', icon: '💡', label: '추가 팁', text: mat.detail },
      { time: '18~20s', icon: '📲', label: 'CTA', text: `궁금한 점 댓글로 남겨주세요!\\n다음 무물에서 답변드립니다 💬\\n\\n${ctaText}` },
    ],
    caption: `💬 인팸 무물 — Q. ${qna.q}\\n\\nA. ${qna.a}\\n\\n[${shortName}${colorStr}]\\n${shockData.emoji} ${shockData.stat}\\n\\n❓ 궁금한 거 댓글로 남겨주세요!\\n👉 샘플·카다로그: 프로필 링크\\n\\n#인테리어패밀리 #인팸 #무물 #QnA #${mat.label.replace(/\s/g, '')} #인테리어자재 #릴스`,
  };
}

// CTA 패턴 (타겟·순서별 순환)
function getCTA(audience, rank) {
  const ctaPatterns = {
    consumer: [
      `💬 댓글로 "카다로그" 남겨주시면\\n무료 자재 카다로그를 DM으로 보내드려요!\\n\\n팔로우 + 댓글 = 카다로그 📩`,
      `💾 저장해두고 시공 전 참고하세요!\\n\\n프로필 링크에서\\n무료 샘플 신청하고\\n직접 느껴보세요 👆`,
      `🎁 무료 샘플 받아보세요!\\n\\nDM으로 "샘플" 보내주시면\\n실제 자재 샘플을 무료 발송해드려요 📦`,
    ],
    business: [
      `📋 시공 업체 전용 카다로그\\n\\n댓글로 "업체"라고 남겨주시면\\n도매 가격표 + 시공 가이드를 보내드립니다`,
      `🤝 파트너십 문의\\n\\n프로필 링크에서\\n업체 전용 견적·샘플 신청\\n전국 배송 가능 👆`,
      `📞 전문가 상담 예약\\n\\nDM 또는 프로필 링크에서\\n현장 방문 상담 예약하세요\\n공장 견학도 가능합니다 🏭`,
    ],
  };
  const patterns = ctaPatterns[audience] || ctaPatterns.consumer;
  return patterns[(rank - 1) % patterns.length];
}

function renderReelsCard(product, rank, ratio, script, format) {
  const formatLabels = { problem: '🎯 문제제시→해결', before: '✨ Before→After', construction: '🏗️ 8초 시공일지', expert: '💡 전문가 팁', newmaterial: '📢 신자재 소개', experiment: '🔬 실험검증', qna: '💬 무물Q&A' };
  const formatLabel = formatLabels[format] || formatLabels.problem;
  const rankColors = ['#fbbf24', '#94a3b8', '#b45309'];
  const rankColor = rankColors[rank - 1] || '#6366f1';
  const mat = script.material;

  const scenesHtml = script.scenes.map(s => `
    <div class="reels-scene">
      <div class="reels-scene-time">${s.time}</div>
      <div class="reels-scene-body">
        <div class="reels-scene-label">${s.icon} ${s.label}</div>
        <div class="reels-scene-text">${s.text.replace(/\\n/g, '<br>')}</div>
      </div>
    </div>
  `).join('');

  const overlayHtml = script.overlayText ? `
    <div class="reels-overlay-cue">
      <span class="reels-overlay-cue-label">📝 오버레이:</span>
      <span class="reels-overlay-cue-text">${script.overlayText}</span>
    </div>` : '';

  return `
    <div class="reels-card">
      <div class="reels-card-head">
        <div class="reels-card-rank" style="color:${rankColor};">#${rank}</div>
        <div class="reels-card-info">
          <div class="reels-card-product">${product.productName}</div>
          <div class="reels-card-meta">매출 점유율 ${ratio}% · 수량 ${product.volume.toLocaleString()}EA</div>
        </div>
        <span class="material-tag ${mat.badgeClass}" style="margin-left:auto;">${mat.badge}</span>
        <span class="reels-format-badge">${formatLabel}</span>
        ${script.ctaType ? `<span class="cta-type-badge">${script.ctaType}</span>` : ''}
      </div>

      <div class="reels-content-wrap">
        <div class="reels-phone-frame">
          <div class="reels-phone-notch"></div>
          <div class="reels-phone-screen">
            <div class="reels-hook-text">${script.hook}</div>
            <div class="reels-phone-tag">@interior__family</div>
          </div>
        </div>
        <div class="reels-timeline">
          <div class="reels-timeline-label">📋 씬 구성 (총 ${script.scenes.length}컷 · 약 20초)</div>
          ${scenesHtml}
        </div>
      </div>
      ${overlayHtml}
      <div class="reels-caption-box">
        <div class="reels-caption-label"><i class="ph ph-note-pencil"></i> 추천 캡션 (복사해서 사용하세요)</div>
        <div class="reels-caption-text">${script.caption.replace(/\\n/g, '<br>')}</div>
      </div>
    </div>
  `;
}









// =========================================
// 색상별 차트 관련 함수들
// =========================================

function aggregateByColor(data, productFilter) {
  const filtered = productFilter && productFilter !== 'all'
    ? data.filter(d => d.productName === productFilter)
    : data;

  const map = new Map();
  filtered.forEach(item => {
    const colorKey = (item.color && item.color.trim()) ? item.color.trim() : '미분류';
    if (map.has(colorKey)) {
      const e = map.get(colorKey);
      e.volume += item.volume;
      e.total += item.total;
    } else {
      map.set(colorKey, { color: colorKey, volume: item.volume, total: item.total });
    }
  });

  const arr = [];
  map.forEach(v => arr.push(v));
  return arr;
}

function updateColorProductFilter() {
  const filterSelect = document.getElementById('colorProductFilter');
  const currentVal = filterSelect.value;

  // 제품명 목록 수집
  const products = [...new Set(salesData.map(d => d.productName))];

  // 기존 옵션 제거 (전체만 남기기)
  filterSelect.innerHTML = '<option value="all">전체 제품</option>';
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    filterSelect.appendChild(opt);
  });

  // 이전 선택 복원
  if ([...filterSelect.options].some(o => o.value === currentVal)) {
    filterSelect.value = currentVal;
  }

  // 필터 변경 이벤트 (중복 방지)
  filterSelect.onchange = () => {
    renderColorCharts(salesData, filterSelect.value);
  };
}

function renderColorCharts(data, productFilter) {
  const colorData = aggregateByColor(data, productFilter);

  if (colorData.length === 0) {
    renderColorEmptyState();
    return;
  }

  // 색상 팔레트 (여러 색상에 대응)
  const PALETTE = [
    'rgba(99,102,241,0.85)',
    'rgba(236,72,153,0.85)',
    'rgba(16,185,129,0.85)',
    'rgba(245,158,11,0.85)',
    'rgba(139,92,246,0.85)',
    'rgba(14,165,233,0.85)',
    'rgba(251,113,133,0.85)',
    'rgba(52,211,153,0.85)',
    'rgba(251,191,36,0.85)',
    'rgba(167,139,250,0.85)',
  ];

  const labels = colorData.map(d => d.color);
  const volumeData = colorData.map(d => d.volume);
  const revenueData = colorData.map(d => d.total);
  const bgColors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
  const borderColors = bgColors.map(c => c.replace('0.85', '1'));

  const chartOptionsBase = (isCurrency) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: 'rgba(255,255,255,0.8)',
          font: { family: 'Inter', size: 12 },
          padding: 14,
          boxWidth: 14,
        }
      },
      tooltip: {
        backgroundColor: 'rgba(15,17,26,0.95)',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 12,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        callbacks: {
          label: function (context) {
            let label = context.label || '';
            if (label) label += ': ';
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
            if (isCurrency) {
              label += '₩' + Math.floor(context.parsed).toLocaleString('ko-KR') + ` (${pct}%)`;
            } else {
              label += Math.floor(context.parsed).toLocaleString('ko-KR') + ' EA' + ` (${pct}%)`;
            }
            return label;
          }
        }
      }
    },
    cutout: '62%'
  });

  // --- 수량 차트 ---
  const volCtx = document.getElementById('colorVolumeChart').getContext('2d');
  if (colorVolumeChartInstance) colorVolumeChartInstance.destroy();
  colorVolumeChartInstance = new Chart(volCtx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ label: '수량', data: volumeData, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 2, hoverOffset: 8 }]
    },
    options: chartOptionsBase(false)
  });

  // --- 매출 차트 ---
  const revCtx = document.getElementById('colorRevenueChart').getContext('2d');
  if (colorRevenueChartInstance) colorRevenueChartInstance.destroy();
  colorRevenueChartInstance = new Chart(revCtx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ label: '매출', data: revenueData, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 2, hoverOffset: 8 }]
    },
    options: chartOptionsBase(true)
  });

  // --- 색상 순위 목록 렌더링 ---
  renderColorRankingList(colorData, bgColors);
}

function renderColorRankingList(colorData, bgColors) {
  const container = document.getElementById('colorRankingList');
  if (!container) return;

  // 수량 기준 내림차순으로 정렬
  const sorted = [...colorData].sort((a, b) => b.volume - a.volume);
  const totalVol = sorted.reduce((s, d) => s + d.volume, 0);
  const totalRev = sorted.reduce((s, d) => s + d.total, 0);

  container.innerHTML = `
    <div class="color-rank-header">
      <span>색상</span>
      <span>수량</span>
      <span>비율(수량)</span>
      <span>매출</span>
      <span>비율(매출)</span>
    </div>
    ${sorted.map((d, i) => {
    const volPct = totalVol > 0 ? ((d.volume / totalVol) * 100).toFixed(1) : 0;
    const revPct = totalRev > 0 ? ((d.total / totalRev) * 100).toFixed(1) : 0;
    const color = bgColors[colorData.indexOf(d) % bgColors.length];
    return `
        <div class="color-rank-row">
          <span class="color-rank-name">
            <span class="color-dot" style="background:${color};"></span>
            <strong>#${i + 1}</strong> ${d.color}
          </span>
          <span>${d.volume.toLocaleString('ko-KR')} EA</span>
          <span>
            <div class="color-bar-wrap">
              <div class="color-bar" style="width:${volPct}%;background:${color};"></div>
              <span class="color-bar-label">${volPct}%</span>
            </div>
          </span>
          <span>₩${Math.floor(d.total).toLocaleString('ko-KR')}</span>
          <span>
            <div class="color-bar-wrap">
              <div class="color-bar" style="width:${revPct}%;background:${color};"></div>
              <span class="color-bar-label">${revPct}%</span>
            </div>
          </span>
        </div>
      `;
  }).join('')}
  `;
}

function renderColorEmptyState() {
  const volCtx = document.getElementById('colorVolumeChart').getContext('2d');
  const revCtx = document.getElementById('colorRevenueChart').getContext('2d');
  if (colorVolumeChartInstance) { colorVolumeChartInstance.destroy(); colorVolumeChartInstance = null; }
  if (colorRevenueChartInstance) { colorRevenueChartInstance.destroy(); colorRevenueChartInstance = null; }
  const container = document.getElementById('colorRankingList');
  if (container) container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:1.5rem;">색상 데이터가 없습니다. 데이터 입력 시 색상을 함께 입력하거나 데모 데이터를 로드하세요.</p>';
}

// =========================================
// AI 인사이트 생성 로직 (Gemini AI Mock)
// =========================================
function generateAiInsight() {
  if (salesData.length === 0) {
    alert('데이터가 없습니다. 먼저 엑셀 파일을 업로드하거나 데모 데이터를 로드해주세요.');
    return;
  }

  // 로딩 상태 표시
  generateInsightBtn.innerHTML = '<i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 분석 중...';
  generateInsightBtn.disabled = true;
  aiInsightText.innerHTML = '<span style="color: #a855f7; font-weight: 500; display: flex; align-items: center; gap: 0.5rem;"><i class="ph ph-circle-notch" style="animation: spin 1s linear infinite;"></i> 판매 지표 및 트렌드를 AI가 실시간 분석하고 있습니다. 잠시만 기다려주세요...</span>';

  setTimeout(() => {
    const aggregated = aggregateByProduct(salesData);
    aggregated.sort((a, b) => b.total - a.total);
    const topProduct = aggregated[0];
    const secondProduct = aggregated.length > 1 ? aggregated[1] : topProduct;
    const lastProduct = aggregated[aggregated.length - 1];
    const totalRevenue = aggregated.reduce((sum, item) => sum + item.total, 0);
    const totalVol = aggregated.reduce((sum, item) => sum + item.volume, 0);
    const topRatio = ((topProduct.total / totalRevenue) * 100).toFixed(1);
    const top2Ratio = (((topProduct.total + secondProduct.total) / totalRevenue) * 100).toFixed(1);
    const avgRevPerProduct = Math.floor(totalRevenue / aggregated.length);
    const highPerfCount = aggregated.filter(p => p.total > avgRevPerProduct).length;

    const insightHtml = `
<div style="color:#e2e8f0; animation: fadeIn 0.6s ease-out; width:100%; font-size:1.05rem; line-height:1.8;">

  <!-- 헤더 -->
  <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:1.5rem; padding-bottom:1rem; border-bottom:1px solid rgba(168,85,247,0.3);">
    <i class="ph ph-check-circle" style="color:#10b981; font-size:1.6rem;"></i>
    <h3 style="color:#a855f7; font-size:1.4rem; font-weight:700; margin:0;">분석 완료: Gemini AI 최고의 마케팅 전략 인사이트 리포트</h3>
  </div>

  <!-- 요약 박스 -->
  <div style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.25); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1.75rem;">
    <p style="margin:0 0 0.6rem 0; font-size:1.1rem;"><strong style="color:#c4b5fd;">📊 종합 시장 진단</strong></p>
    <p style="margin:0; color:#cbd5e1; line-height:1.8;">
      현재 총 <strong style="color:#fff;">${aggregated.length}개 품목</strong>에서 총 매출 <strong style="color:#10b981;">₩${Math.floor(totalRevenue).toLocaleString('ko-KR')}</strong>이 발생했습니다.
      전체 판매의 <strong style="color:#f59e0b;">${topRatio}%</strong>가 1위 품목 <strong style="color:#fff;">'${topProduct.productName}'</strong>에 집중되어 있으며,
      상위 2개 품목이 전체 매출의 <strong style="color:#f59e0b;">${top2Ratio}%</strong>를 차지하는 <strong style="color:#fc87a0;">고도의 집중형 포트폴리오</strong> 구조입니다.
      전체 품목 중 평균 매출(₩${avgRevPerProduct.toLocaleString('ko-KR')}) 이상을 달성한 품목은 <strong style="color:#fff;">${highPerfCount}개</strong>로,
      소수 핵심 품목이 수익을 이끄는 전형적인 <strong style="color:#c4b5fd;">파레토(80:20) 법칙</strong>이 적용되고 있습니다.
      단기적으로는 주력 품목의 점유율을 더욱 굳히고, 중장기적으로는 포트폴리오 다각화를 통해 리스크를 분산해야 합니다.
    </p>
  </div>

  <!-- 전략 제안 제목 -->
  <p style="color:#a855f7; font-weight:700; font-size:1.2rem; margin:0 0 1.25rem 0; display:flex; align-items:center; gap:0.4rem;">
    <i class="ph ph-lightning"></i> 5가지 핵심 마케팅 스케일업(Scale-up) 전략
  </p>

  <!-- 전략 1 -->
  <div style="background:rgba(168,85,247,0.07); border-left:4px solid #a855f7; border-radius:0 10px 10px 0; padding:1.25rem 1.5rem; margin-bottom:1.25rem;">
    <p style="color:#e2e8f0; font-weight:700; font-size:1.1rem; margin:0 0 0.6rem 0; display:flex; align-items:center; gap:0.5rem;">
      <i class="ph ph-trend-up" style="color:#a855f7;"></i> 전략 1. 주력 상품 크로스셀링(Cross-selling) 고객 여정 설계
    </p>
    <p style="color:#94a3b8; margin:0 0 0.5rem 0; line-height:1.8;">
      <strong style="color:#fff;">'${topProduct.productName}'</strong>의 구매 전환율이 가장 높습니다. 단순 제품 판매에 머무르지 않고, 구매자의 <strong>다음 행동</strong>을 설계해야 합니다.
      구매 완료 직후 "함께 구매하면 좋은 제품" 형태로 <strong style="color:#c4b5fd;">'${secondProduct.productName}'</strong>를 노출하는 크로스셀 배너를 삽입하고,
      설치/시공 서비스 및 A/S 멤버십 패키지를 묶음 구성하여 고객 1인당 매출(ARPU)을 최소 <strong style="color:#10b981;">15~25% 상승</strong>시킬 수 있습니다.
    </p>
    <p style="color:#6366f1; font-size:0.9rem; margin:0;">💡 실행 팁: 영업 담당자 스크립트에 크로스셀 멘트를 필수 포함시키고, 온라인 상품 페이지에 "세트 구매 특별가" 배지를 추가하세요.</p>
  </div>

  <!-- 전략 2 -->
  <div style="background:rgba(59,130,246,0.07); border-left:4px solid #3b82f6; border-radius:0 10px 10px 0; padding:1.25rem 1.5rem; margin-bottom:1.25rem;">
    <p style="color:#e2e8f0; font-weight:700; font-size:1.1rem; margin:0 0 0.6rem 0; display:flex; align-items:center; gap:0.5rem;">
      <i class="ph ph-buildings" style="color:#3b82f6;"></i> 전략 2. B2B 대형 거래처 집중 육성 프로그램
    </p>
    <p style="color:#94a3b8; margin:0 0 0.5rem 0; line-height:1.8;">
      현재 판매 구조는 <strong>다수의 소규모 거래</strong> 패턴으로 추정됩니다. 대형 건설사, 인테리어 시공사, 부동산 개발 업체 등 단건 수주 시
      수백~수천 개 단위 발주가 가능한 <strong style="color:#93c5fd;">B2B 파이프라인</strong>을 별도로 구축해야 합니다.
      핵심 품목인 <strong style="color:#fff;">'${topProduct.productName}'</strong>에 대한 <strong>볼륨 할인 구조(Volume Discount Tier)</strong>를 설계하고,
      100개, 500개, 1000개 이상 발주 시 각각 5%, 10%, 15% 할인을 적용하여 대형 계약 유인을 강화하세요.
    </p>
    <p style="color:#6366f1; font-size:0.9rem; margin:0;">💡 실행 팁: 분기별 B2B 전용 세미나를 개최하여 핵심 시공 파트너에게 신제품 프리뷰 및 교육 기회를 제공해 충성도를 높이세요.</p>
  </div>

  <!-- 전략 3 -->
  <div style="background:rgba(16,185,129,0.07); border-left:4px solid #10b981; border-radius:0 10px 10px 0; padding:1.25rem 1.5rem; margin-bottom:1.25rem;">
    <p style="color:#e2e8f0; font-weight:700; font-size:1.1rem; margin:0 0 0.6rem 0; display:flex; align-items:center; gap:0.5rem;">
      <i class="ph ph-recycle" style="color:#10b981;"></i> 전략 3. 저회전 품목 재고 번들 소진 + 신규 고객 유입 전략
    </p>
    <p style="color:#94a3b8; margin:0 0 0.5rem 0; line-height:1.8;">
      <strong style="color:#fff;">'${lastProduct.productName}'</strong>은 상대적으로 판매 회전율이 낮은 품목입니다. 이를 단독 판매하는 것은 마진 관리가 어렵지만,
      <strong style="color:#6ee7b7;">신규 고객 유입 미끼 상품(Lead Magnet)</strong>으로 활용하면 재고 소진과 신규 고객 확보를 동시에 달성할 수 있습니다.
      주력 품목 구매 고객에게 해당 품목을 <strong>원가 수준 특가</strong>로 제공하는 "1+1 프로모션" 혹은 "사은품 패키지"를 기획하고,
      SNS/블로그 채널에서 해당 이벤트를 집중 홍보하여 신규 유입 채널로 활용하세요.
    </p>
    <p style="color:#6366f1; font-size:0.9rem; margin:0;">💡 실행 팁: 네이버 스마트스토어, 쿠팡 등 온라인 채널에 해당 번들 패키지를 단독 SKU로 등록하여 노출 영역을 확대하세요.</p>
  </div>

  <!-- 전략 4 -->
  <div style="background:rgba(245,158,11,0.07); border-left:4px solid #f59e0b; border-radius:0 10px 10px 0; padding:1.25rem 1.5rem; margin-bottom:1.25rem;">
    <p style="color:#e2e8f0; font-weight:700; font-size:1.1rem; margin:0 0 0.6rem 0; display:flex; align-items:center; gap:0.5rem;">
      <i class="ph ph-chart-line-up" style="color:#f59e0b;"></i> 전략 4. 시즌 수요 예측 기반 사전 재고 확보 및 프로모션
    </p>
    <p style="color:#94a3b8; margin:0 0 0.5rem 0; line-height:1.8;">
      건자재 및 인테리어 업종은 <strong>봄(3~5월)과 가을(9~11월) 이사 시즌</strong>에 수요가 급격히 증가하는 특성이 있습니다.
      현재 판매 데이터를 토대로 이 기간 동안 <strong style="color:#fcd34d;">'${topProduct.productName}'</strong>의 수요가 평소 대비
      <strong style="color:#10b981;">30~50% 급증</strong>할 가능성이 높습니다. 시즌 6주 전부터 재고를 평소의 1.5~2배 수준으로 사전 확보하고,
      시즌 개막 시 <strong>"이사 완성 패키지"</strong> 등의 네이밍으로 묶음 상품을 런칭하면 적시 매출 극대화가 가능합니다.
    </p>
    <p style="color:#6366f1; font-size:0.9rem; margin:0;">💡 실행 팁: 공급업체와 사전 계약 물량을 확정하여 원자재/납기 리스크를 헤지(Hedge)하고 수익률을 보호하세요.</p>
  </div>

  <!-- 전략 5 -->
  <div style="background:rgba(236,72,153,0.07); border-left:4px solid #ec4899; border-radius:0 10px 10px 0; padding:1.25rem 1.5rem; margin-bottom:1.75rem;">
    <p style="color:#e2e8f0; font-weight:700; font-size:1.1rem; margin:0 0 0.6rem 0; display:flex; align-items:center; gap:0.5rem;">
      <i class="ph ph-star" style="color:#ec4899;"></i> 전략 5. 고객 리뷰 및 레퍼럴(추천) 마케팅 시스템 구축
    </p>
    <p style="color:#94a3b8; margin:0 0 0.5rem 0; line-height:1.8;">
      B2B·B2C 구분 없이 <strong>구전 효과(Word-of-Mouth)</strong>는 건자재 업종의 가장 강력한 마케팅 채널입니다.
      <strong style="color:#fff;">'${topProduct.productName}'</strong> 구매 완료 고객을 대상으로 시공 후기 / 포토 리뷰 작성 시
      <strong style="color:#f9a8d4;">다음 구매 5% 할인 쿠폰</strong>을 지급하는 리뷰 리워드 프로그램을 운영하고,
      지인 소개 시 <strong>소개자·피소개자 양측에게 각 3% 적립금을 지급</strong>하는 <strong>더블사이드 레퍼럴 구조</strong>를 도입하세요.
      이는 CAC(고객 획득 비용)를 줄이면서 신뢰도 높은 신규 고객을 유입시키는 최고 효율의 전략입니다.
    </p>
    <p style="color:#6366f1; font-size:0.9rem; margin:0;">💡 실행 팁: 네이버 플레이스, 구글 비즈니스 프로필에 리뷰를 집중 축적하면 지역 검색 SEO에도 즉각적인 효과가 나타납니다.</p>
  </div>

  <!-- 월별 실행 로드맵 -->
  <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1.5rem;">
    <p style="color:#c4b5fd; font-weight:700; font-size:1.1rem; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.4rem;">
      <i class="ph ph-calendar-check"></i> 분기별 실행 로드맵
    </p>
    <div style="display:grid; grid-template-columns: repeat(4,1fr); gap:0.75rem; font-size:0.95rem;">
      <div style="background:rgba(168,85,247,0.1); border-radius:8px; padding:0.9rem; text-align:center;">
        <div style="color:#a855f7; font-weight:700; margin-bottom:0.4rem;">1분기</div>
        <div style="color:#94a3b8; line-height:1.6;">크로스셀링 패키지 설계<br>B2B 볼륨 할인 구조 수립<br>리뷰 리워드 시스템 론칭</div>
      </div>
      <div style="background:rgba(59,130,246,0.1); border-radius:8px; padding:0.9rem; text-align:center;">
        <div style="color:#3b82f6; font-weight:700; margin-bottom:0.4rem;">2분기</div>
        <div style="color:#94a3b8; line-height:1.6;">봄 이사 시즌 프로모션<br>B2B 파트너 세미나 개최<br>저회전 번들 이벤트 실행</div>
      </div>
      <div style="background:rgba(16,185,129,0.1); border-radius:8px; padding:0.9rem; text-align:center;">
        <div style="color:#10b981; font-weight:700; margin-bottom:0.4rem;">3분기</div>
        <div style="color:#94a3b8; line-height:1.6;">성과 측정 · KPI 점검<br>레퍼럴 데이터 분석<br>가을 시즌 재고 사전 확보</div>
      </div>
      <div style="background:rgba(245,158,11,0.1); border-radius:8px; padding:0.9rem; text-align:center;">
        <div style="color:#f59e0b; font-weight:700; margin-bottom:0.4rem;">4분기</div>
        <div style="color:#94a3b8; line-height:1.6;">가을 시즌 패키지 런칭<br>연간 성과 리뷰·개선<br>내년도 전략 수립</div>
      </div>
    </div>
  </div>

  <!-- KPI 제안 -->
  <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1.5rem;">
    <p style="color:#c4b5fd; font-weight:700; font-size:1.1rem; margin:0 0 0.9rem 0; display:flex; align-items:center; gap:0.4rem;">
      <i class="ph ph-target"></i> 핵심 성과 지표 (KPI) 제안
    </p>
    <div style="display:grid; grid-template-columns: repeat(3,1fr); gap:0.75rem; font-size:0.95rem; text-align:center;">
      <div style="background:rgba(168,85,247,0.08); border-radius:8px; padding:0.9rem;">
        <div style="color:#a855f7; font-size:1.6rem; font-weight:700;">+20%</div>
        <div style="color:#94a3b8; margin-top:0.3rem;">월 매출 증가 목표</div>
      </div>
      <div style="background:rgba(16,185,129,0.08); border-radius:8px; padding:0.9rem;">
        <div style="color:#10b981; font-size:1.6rem; font-weight:700;">+15%</div>
        <div style="color:#94a3b8; margin-top:0.3rem;">고객 재구매율 향상</div>
      </div>
      <div style="background:rgba(59,130,246,0.08); border-radius:8px; padding:0.9rem;">
        <div style="color:#3b82f6; font-size:1.6rem; font-weight:700;">-30%</div>
        <div style="color:#94a3b8; margin-top:0.3rem;">저회전 재고 감축 목표</div>
      </div>
    </div>
  </div>


  <!-- 주차별 상세 액션플랜 -->
  <div style="margin-bottom:1.5rem;">
    <p style="color:#c4b5fd; font-weight:700; font-size:1.1rem; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.4rem;">
      <i class="ph ph-clock-countdown"></i> 즉시 실행 가능한 30일 액션플랜
    </p>

    <!-- Week 1 -->
    <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:1rem 1.25rem; margin-bottom:0.75rem;">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
        <span style="background:#a855f7; color:#fff; font-size:0.8rem; font-weight:700; padding:0.2rem 0.65rem; border-radius:20px;">1주차</span>
        <span style="color:#e2e8f0; font-weight:600;">기반 세팅 · 현황 파악</span>
      </div>
      <ul style="list-style:none; padding:0; margin:0; color:#94a3b8; font-size:0.95rem;">
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#a855f7; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span><strong style="color:#fff;">'${topProduct.productName}'</strong> 현재 재고 수량 및 납기 여력 정확히 파악</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#a855f7; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>최근 3개월 구매 고객 리스트 정리, 재구매 후보군 분류</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#a855f7; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>B2B 잠재 거래처 리스트 20곳 이상 발굴 (건설사/시공사/부동산 개발사)</span></li>
        <li style="padding:0.35rem 0; display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#a855f7; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>크로스셀링 묶음 상품 후보 조합 3가지 기획안 작성</span></li>
      </ul>
    </div>

    <!-- Week 2 -->
    <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:1rem 1.25rem; margin-bottom:0.75rem;">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
        <span style="background:#3b82f6; color:#fff; font-size:0.8rem; font-weight:700; padding:0.2rem 0.65rem; border-radius:20px;">2주차</span>
        <span style="color:#e2e8f0; font-weight:600;">프로모션 설계 · 채널 준비</span>
      </div>
      <ul style="list-style:none; padding:0; margin:0; color:#94a3b8; font-size:0.95rem;">
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#3b82f6; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>B2B 볼륨 할인 견적 템플릿 제작 (100/500/1000개 이상 단계별 가격표)</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#3b82f6; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>크로스셀링 패키지 정가 및 패키지가 설정, 상품 상세 페이지 업데이트</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#3b82f6; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>네이버 스마트스토어 / 쿠팡 번들 SKU 등록 및 이미지 제작</span></li>
        <li style="padding:0.35rem 0; display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#3b82f6; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>리뷰 리워드 정책 수립 (5% 할인 쿠폰 발급 프로세스 확정)</span></li>
      </ul>
    </div>

    <!-- Week 3 -->
    <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:1rem 1.25rem; margin-bottom:0.75rem;">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
        <span style="background:#10b981; color:#fff; font-size:0.8rem; font-weight:700; padding:0.2rem 0.65rem; border-radius:20px;">3주차</span>
        <span style="color:#e2e8f0; font-weight:600;">영업 활동 · 고객 접점 가동</span>
      </div>
      <ul style="list-style:none; padding:0; margin:0; color:#94a3b8; font-size:0.95rem;">
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#10b981; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>B2B 잠재 거래처 20곳에 볼륨 할인 제안서 발송 및 미팅 일정 확보</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#10b981; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>기존 구매 고객 대상 크로스셀링 패키지 문자/카카오 알림톡 발송</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#10b981; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span><strong style="color:#fff;">'${lastProduct.productName}'</strong> 재고 소진 번들 이벤트 SNS(인스타그램·블로그) 집중 홍보 시작</span></li>
        <li style="padding:0.35rem 0; display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#10b981; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>레퍼럴 프로그램 공지 및 3% 적립금 지급 체계 구축</span></li>
      </ul>
    </div>

    <!-- Week 4 -->
    <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:1rem 1.25rem; margin-bottom:1.5rem;">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
        <span style="background:#f59e0b; color:#fff; font-size:0.8rem; font-weight:700; padding:0.2rem 0.65rem; border-radius:20px;">4주차</span>
        <span style="color:#e2e8f0; font-weight:600;">성과 측정 · 다음 달 전략 수정</span>
      </div>
      <ul style="list-style:none; padding:0; margin:0; color:#94a3b8; font-size:0.95rem;">
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#f59e0b; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>크로스셀링 전환율, 번들 이벤트 판매량, B2B 미팅 성사율 집계</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#f59e0b; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>레퍼럴 추천 건수 및 리뷰 리워드 수령 건수 집계</span></li>
        <li style="padding:0.35rem 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#f59e0b; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>목표 대비 실적 비교 후 차월 프로모션 예산 재조정</span></li>
        <li style="padding:0.35rem 0; display:flex; align-items:flex-start; gap:0.5rem;"><i class="ph ph-check-square" style="color:#f59e0b; font-size:1rem; flex-shrink:0; margin-top:1px;"></i> <span>이사 성수기 대비 시즌 패키지 기획 착수 (6주 전 시작 원칙 준수)</span></li>
      </ul>
    </div>
  </div>

  <!-- 채널별 마케팅 예산 배분 -->
  <div style="background:rgba(30,33,48,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1.5rem;">
    <p style="color:#c4b5fd; font-weight:700; font-size:1.1rem; margin:0 0 1rem 0; display:flex; align-items:center; gap:0.4rem;">
      <i class="ph ph-currency-krw"></i> 권장 채널별 마케팅 예산 배분 (총 예산 대비 %)
    </p>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:0.95rem; min-width:480px;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
            <th style="padding:0.6rem 0.75rem; text-align:left; color:#94a3b8; font-weight:500;">채널</th>
            <th style="padding:0.6rem 0.75rem; text-align:center; color:#94a3b8; font-weight:500;">전략 목적</th>
            <th style="padding:0.6rem 0.75rem; text-align:center; color:#94a3b8; font-weight:500;">비중</th>
            <th style="padding:0.6rem 0.75rem; text-align:left; color:#94a3b8; font-weight:500;">핵심 KPI</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.65rem 0.75rem; color:#e2e8f0;">B2B 직접 영업</td>
            <td style="padding:0.65rem 0.75rem; text-align:center; color:#94a3b8;">대형 계약 수주</td>
            <td style="padding:0.65rem 0.75rem; text-align:center;"><span style="background:rgba(168,85,247,0.15); color:#c4b5fd; padding:0.2rem 0.6rem; border-radius:20px; font-weight:700;">35%</span></td>
            <td style="padding:0.65rem 0.75rem; color:#94a3b8;">미팅 성사율 30% 이상</td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.65rem 0.75rem; color:#e2e8f0;">온라인 쇼핑몰 광고</td>
            <td style="padding:0.65rem 0.75rem; text-align:center; color:#94a3b8;">번들 상품 노출</td>
            <td style="padding:0.65rem 0.75rem; text-align:center;"><span style="background:rgba(59,130,246,0.15); color:#93c5fd; padding:0.2rem 0.6rem; border-radius:20px; font-weight:700;">25%</span></td>
            <td style="padding:0.65rem 0.75rem; color:#94a3b8;">번들 ROAS 300% 이상</td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.65rem 0.75rem; color:#e2e8f0;">SNS·블로그 콘텐츠</td>
            <td style="padding:0.65rem 0.75rem; text-align:center; color:#94a3b8;">브랜드 신뢰도·SEO</td>
            <td style="padding:0.65rem 0.75rem; text-align:center;"><span style="background:rgba(16,185,129,0.15); color:#6ee7b7; padding:0.2rem 0.6rem; border-radius:20px; font-weight:700;">20%</span></td>
            <td style="padding:0.65rem 0.75rem; color:#94a3b8;">월 유입 10% 성장</td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.65rem 0.75rem; color:#e2e8f0;">고객 리텐션 (문자·앱)</td>
            <td style="padding:0.65rem 0.75rem; text-align:center; color:#94a3b8;">재구매 유도</td>
            <td style="padding:0.65rem 0.75rem; text-align:center;"><span style="background:rgba(245,158,11,0.15); color:#fcd34d; padding:0.2rem 0.6rem; border-radius:20px; font-weight:700;">12%</span></td>
            <td style="padding:0.65rem 0.75rem; color:#94a3b8;">재구매율 +15%p</td>
          </tr>
          <tr>
            <td style="padding:0.65rem 0.75rem; color:#e2e8f0;">레퍼럴·리뷰 리워드</td>
            <td style="padding:0.65rem 0.75rem; text-align:center; color:#94a3b8;">저비용 신규 유입</td>
            <td style="padding:0.65rem 0.75rem; text-align:center;"><span style="background:rgba(236,72,153,0.15); color:#f9a8d4; padding:0.2rem 0.6rem; border-radius:20px; font-weight:700;">8%</span></td>
            <td style="padding:0.65rem 0.75rem; color:#94a3b8;">CAC 20% 절감</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 주의사항 -->
  <p style="font-size:0.88rem; color:#6366f1; opacity:0.85; margin:0; display:flex; align-items:center; gap:0.4rem; line-height:1.6;">
    <i class="ph ph-info"></i>
    본 리포트는 업로드된 판매 데이터를 기반으로 Gemini AI 검색엔진 알고리즘을 활용하여 도출된 마케팅 전략 인사이트입니다. 실제 시장 환경에 따라 전략의 우선순위를 조정하여 적용하시기 바랍니다.
  </p>
</div>
        `;

    aiInsightText.innerHTML = insightHtml;

    generateInsightBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> 인사이트 재분석';
    generateInsightBtn.disabled = false;
  }, 2000);
}

// =========================================
// 번역기 (Translation Dashboard) — Unified Card Design
// =========================================
(function initTranslator() {
  document.addEventListener('DOMContentLoaded', () => {
    const translateBtn = document.getElementById('translateBtn');
    const translateSampleBtn = document.getElementById('translateSampleBtn');
    const translatorInput = document.getElementById('translatorInput');
    const translatorCards = document.getElementById('translatorCards');

    if (!translateBtn || !translatorInput) return;

    // 샘플 데이터 로드
    translateSampleBtn?.addEventListener('click', () => {
      translatorInput.value = '소프트스톤 SS-01 화이트 600x600mm 200장 제조 요청합니다.\n납기일: 2026년 3월 15일\n포장: 개별 포장 (10장씩 1박스)\n배송지: 중국 광저우 창고\n\n추가 요청사항:\n- 표면 UV코팅 처리\n- 모서리 보호캡 포함\n- 품질검사 성적서 동봉';
      translatorInput.focus();
    });

    // 번역 실행
    translateBtn.addEventListener('click', () => {
      const inputText = translatorInput.value.trim();
      if (!inputText) {
        alert('번역할 내용을 입력해주세요.');
        return;
      }
      executeTranslation(inputText, translatorCards);
    });

    // 이벤트 위임: 전체 복사 + 개별 섹션 복사
    translatorCards?.addEventListener('click', (e) => {
      // 전체 복사 버튼
      const copyAllBtn = e.target.closest('.translator-copy-all-btn');
      if (copyAllBtn) {
        const sections = translatorCards.querySelectorAll('.translator-lang-section');
        let allText = '';
        sections.forEach(section => {
          const langName = section.querySelector('.translator-lang-name')?.textContent || '';
          const textEl = section.querySelector('.translator-text');
          if (textEl) {
            allText += `[${langName}]\n${textEl.textContent.trim()}\n\n`;
          }
        });
        allText = allText.trim();

        copyToClipboard(allText, copyAllBtn, '<i class="ph ph-copy-simple"></i> 전체 복사', '<i class="ph ph-check"></i> 복사 완료!');
        return;
      }

      // 개별 섹션 복사 버튼
      const sectionCopyBtn = e.target.closest('.translator-section-copy');
      if (sectionCopyBtn) {
        const section = sectionCopyBtn.closest('.translator-lang-section');
        const textEl = section?.querySelector('.translator-text');
        if (!textEl) return;
        copyToClipboard(textEl.textContent.trim(), sectionCopyBtn, '<i class="ph ph-copy"></i>', '<i class="ph ph-check"></i>');
      }
    });
  });
})();

/** 클립보드 복사 헬퍼 */
function copyToClipboard(text, btn, originalHTML, successHTML) {
  navigator.clipboard.writeText(text).then(() => {
    showCopied(btn, originalHTML, successHTML);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopied(btn, originalHTML, successHTML);
  });
}

function showCopied(btn, originalHTML, successHTML) {
  btn.classList.add('copied');
  const prevHTML = btn.innerHTML;
  btn.innerHTML = successHTML;
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = originalHTML || prevHTML;
  }, 2000);
}

// =========================================
// Gemini API 설정
// =========================================
const GEMINI_API_KEY = 'AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * 제조 요청 텍스트를 Gemini 2.5 Pro로 번역하여 카드로 렌더링
 */
async function executeTranslation(inputText, container) {
  // 로딩 상태 — unified card with shimmer
  container.innerHTML = `
    <div class="translator-unified-card">
      <div class="translator-toolbar">
        <div class="translator-toolbar-left">
          <i class="ph ph-circle-notch" style="animation: spin 1s linear infinite;"></i>
          <span>Gemini 2.5 Pro 번역 중...</span>
        </div>
      </div>
      <div class="translator-sections">
        ${['🇨🇳 中文', '🇺🇸 English', '🇰🇷 한국어'].map(lang => `
          <div class="translator-lang-section" style="padding:1.25rem 1.5rem;">
            <div class="translator-section-label" style="min-width:120px;">
              <span style="font-size:1.3rem;">${lang.split(' ')[0]}</span>
              <span class="translator-lang-name" style="color:#64748b;">${lang.split(' ')[1]}</span>
            </div>
            <div class="translator-section-content">
              <div class="translator-loading" style="width:90%"></div>
              <div class="translator-loading" style="width:72%"></div>
              <div class="translator-loading" style="width:80%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  try {
    const translations = await callGeminiTranslation(inputText);
    container.innerHTML = renderTranslationCards(translations);
  } catch (error) {
    console.error('Gemini 번역 오류:', error);
    container.innerHTML = `
      <div class="translator-placeholder" style="border-color: rgba(239,68,68,0.3);">
        <i class="ph ph-warning" style="font-size:2.5rem; color:#ef4444;"></i>
        <p style="color:#fca5a5;"><strong>번역 오류가 발생했습니다.</strong></p>
        <p style="color:#94a3b8; font-size:0.85rem;">${error.message || '네트워크 오류 또는 API 키를 확인해주세요.'}</p>
        <button class="btn btn-secondary" onclick="executeTranslation(\`${inputText.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`, document.getElementById('translatorCards'))" style="margin-top:0.5rem;">
          <i class="ph ph-arrows-clockwise"></i> 다시 시도
        </button>
      </div>
    `;
  }
}

/**
 * Gemini 2.5 Pro API를 호출하여 번역 수행
 */
async function callGeminiTranslation(text) {
  const prompt = `당신은 인테리어 건축자재 분야의 전문 번역가입니다.

아래 한국어 텍스트를 중국어(简体中文)와 영어(English)로 정확하게 번역해주세요.

번역 시 주의사항:
1. 인테리어/건축자재 제조 분야의 전문 용어를 정확하게 번역하세요.
2. 제품 모델번호(예: SS-01)와 규격(예: 600x600mm)은 그대로 유지하세요.
3. 날짜, 수량, 단위 등 숫자 정보를 정확하게 변환하세요.
4. 중국어는 간체자(简体字)를 사용하세요.
5. 영어는 비즈니스/제조업에서 사용하는 공식적인 어조로 번역하세요.
6. 한국어 원문도 비즈니스 어조로 정제하여 포함하세요.
7. 번역 결과만 출력하세요. 설명이나 주석은 포함하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON만):
{
  "zh": "중국어 번역 결과",
  "en": "영어 번역 결과",
  "ko": "한국어 원문 (정제)"
}

번역할 텍스트:
${text}`;

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.8,
        maxOutputTokens: 4096,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || `API 응답 오류 (${response.status})`;
    throw new Error(errorMsg);
  }

  const data = await response.json();

  // Gemini 응답에서 텍스트 추출
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API에서 응답을 받지 못했습니다.');
  }

  // JSON 파싱 (마크다운 코드블록 제거 처리)
  let jsonStr = rawText.trim();
  // ```json ... ``` 또는 ``` ... ``` 패턴 제거
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  try {
    const translations = JSON.parse(jsonStr);
    return {
      zh: translations.zh || '번역 결과를 파싱할 수 없습니다.',
      en: translations.en || 'Could not parse translation result.',
      ko: translations.ko || text
    };
  } catch (parseError) {
    console.error('JSON 파싱 오류:', parseError, '\nRaw response:', rawText);
    // JSON 파싱 실패 시 텍스트에서 직접 추출 시도
    const zhMatch = rawText.match(/"zh"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    const enMatch = rawText.match(/"en"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    const koMatch = rawText.match(/"ko"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);

    if (zhMatch || enMatch) {
      return {
        zh: zhMatch ? zhMatch[1] : '파싱 오류',
        en: enMatch ? enMatch[1] : 'Parse error',
        ko: koMatch ? koMatch[1] : text
      };
    }
    throw new Error('Gemini 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
  }
}

/**
 * 번역 결과를 unified card로 렌더링
 */
function renderTranslationCards(translations) {
  const langs = [
    { code: 'zh', flag: '🇨🇳', name: '中文 (Chinese)', langCode: 'ZH-CN', text: translations.zh },
    { code: 'en', flag: '🇺🇸', name: 'English', langCode: 'EN-US', text: translations.en },
    { code: 'ko', flag: '🇰🇷', name: '한국어 (Korean)', langCode: 'KO-KR', text: translations.ko },
  ];

  const sections = langs.map(lang => `
    <div class="translator-lang-section lang-${lang.code}" style="animation: fadeIn 0.5s ease">
      <div class="translator-section-label">
        <span class="translator-lang-flag">${lang.flag}</span>
        <div class="translator-lang-info">
          <span class="translator-lang-name">${lang.name}</span>
          <span class="translator-lang-code">${lang.langCode}</span>
        </div>
      </div>
      <div class="translator-section-content">
        <div class="translator-text">${lang.text}</div>
      </div>
      <button class="translator-section-copy" title="이 섹션 복사">
        <i class="ph ph-copy"></i>
      </button>
    </div>
  `).join('');

  return `
    <div class="translator-unified-card" style="animation: fadeIn 0.4s ease">
      <div class="translator-toolbar">
        <div class="translator-toolbar-left">
          <i class="ph ph-check-circle"></i>
          <span>3개 국어 번역 완료</span>
        </div>
        <button class="translator-copy-all-btn">
          <i class="ph ph-copy-simple"></i> 전체 복사
        </button>
      </div>
      <div class="translator-sections">
        ${sections}
      </div>
    </div>
  `;
}

