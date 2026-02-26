"""
HTML Excel Export → 챗봇 학습 데이터 변환
$$$77bf.files / $$$1c0f.files 의 시트 HTML 파싱
핵심 시트: 자재, 메모, 샘플, 택배(배송), 용어, 답변
"""
import re
import json
import os
from html.parser import HTMLParser
from datetime import datetime

# ==============================
# HTML 테이블 파서
# ==============================
class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.current_row = []
        self.current_cell = ''
        self.in_td = False
        self.in_tr = False
    
    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.in_tr = True
            self.current_row = []
        elif tag in ('td', 'th'):
            self.in_td = True
            self.current_cell = ''
        elif tag == 'br' and self.in_td:
            self.current_cell += '\n'
    
    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.in_td = False
            self.current_row.append(self.current_cell.strip())
        elif tag == 'tr':
            self.in_tr = False
            if any(c for c in self.current_row):
                self.rows.append(self.current_row)
    
    def handle_data(self, data):
        if self.in_td:
            self.current_cell += data

def parse_html_table(filepath):
    """HTML 파일에서 테이블 행 추출"""
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            html = f.read()
    except:
        try:
            with open(filepath, 'r', encoding='euc-kr') as f:
                html = f.read()
        except:
            return []
    
    parser = TableParser()
    parser.feed(html)
    return parser.rows

def extract_keywords(text):
    stop = ['은', '는', '이', '가', '을', '를', '에', '의', '로', '과', '와', '있습니다', '합니다', '드립니다', '것', '수', '등', '및', '경우']
    words = re.sub(r'[^\uAC00-\uD7A3a-zA-Z0-9\s]', ' ', text).split()
    words = [w for w in words if len(w) >= 2 and w not in stop]
    return list(dict.fromkeys(words))[:10]

def categorize(text):
    t = text.lower()
    if any(k in t for k in ['시공', '부착', '접착', '설치', '하지작업', '마감', '절곡']): return '시공 가이드'
    if any(k in t for k in ['배송', '용달', '택배', '배달', '차량', '적재', '운송']): return '배송/물류'
    if any(k in t for k in ['샘플', '견본']): return '샘플'
    if any(k in t for k in ['가격', '견적', '단가', '원']): return '가격/견적'
    if any(k in t for k in ['소프트스톤', '소프트 스톤']): return '소프트 스톤'
    if any(k in t for k in ['카빙']): return '카빙 스톤'
    if any(k in t for k in ['스텐']): return '스텐 플레이트'
    if any(k in t for k in ['wpc', 'spc', '월패널', '패널']): return 'WPC/SPC 월패널'
    if any(k in t for k in ['시멘트', '블럭', '블록']): return '시멘트 블럭'
    if any(k in t for k in ['크리스탈']): return '크리스탈 블럭'
    if any(k in t for k in ['방염', '인증']): return '인증/방염'
    if any(k in t for k in ['용어', '뜻', '의미']): return '용어/전문지식'
    return '제품 지식'

# ==============================
# 시트별 데이터 추출
# ==============================
BASE_DIRS = [
    r'C:\Users\kimdy\AppData\Local\Temp\$$$77bf.files',
    r'C:\Users\kimdy\AppData\Local\Temp\$$$1c0f.files',
]

# 시트 매핑: 파일명 → (시트 이름, 추출 방식)
SHEET_MAP = {
    'sheet002.htm': ('자재', 'knowledge'),
    'sheet003.htm': ('메모', 'knowledge'),
    'sheet005.htm': ('샘플', 'knowledge'),
    'sheet006.htm': ('택배(배송)', 'knowledge'),
    'sheet009.htm': ('용어', 'terminology'),
    'sheet010.htm': ('답변', 'qa'),
    'sheet012.htm': ('궁금', 'qa'),
}

all_entries = []
seen_texts = set()  # 중복 방지
entry_id = 0

for base_dir in BASE_DIRS:
    if not os.path.exists(base_dir):
        print(f"⚠ 디렉토리 없음: {base_dir}")
        continue
    
    dir_name = os.path.basename(base_dir)
    print(f"\n=== 처리: {dir_name} ===")
    
    for filename, (sheet_name, extract_type) in SHEET_MAP.items():
        filepath = os.path.join(base_dir, filename)
        rows = parse_html_table(filepath)
        
        if not rows:
            print(f"  {sheet_name}: 데이터 없음 또는 파일 없음")
            continue
        
        count = 0
        for row in rows:
            cells = [c.strip() for c in row if c.strip()]
            if not cells:
                continue
            
            text = ' '.join(cells)
            if len(text) < 10:
                continue
            
            # 중복 방지 (핵심 텍스트 기준)
            text_key = text[:80].lower()
            if text_key in seen_texts:
                continue
            seen_texts.add(text_key)
            
            # 추출 방식에 따라 Q&A 생성
            if extract_type == 'qa':
                # 질문-답변 형태
                if len(cells) >= 2 and len(cells[0]) >= 5 and len(cells[1]) >= 5:
                    question = cells[0]
                    answer = cells[1]
                elif '?' in text or '?' in text:
                    parts = re.split(r'[?？]', text, maxsplit=1)
                    if len(parts) == 2 and len(parts[1].strip()) >= 5:
                        question = parts[0].strip() + '?'
                        answer = parts[1].strip()
                    else:
                        question = extract_keywords(text)[0] + ' 관련' if extract_keywords(text) else '정보'
                        answer = text
                else:
                    question = extract_keywords(text)[0] + ' 관련' if extract_keywords(text) else '정보'
                    answer = text
            elif extract_type == 'terminology':
                # 용어집: 첫 셀 = 용어, 나머지 = 설명
                if len(cells) >= 2:
                    question = f'{cells[0]}이/가 무엇인가요?'
                    answer = ' '.join(cells[1:])
                else:
                    question = extract_keywords(text)[0] + ' 관련' if extract_keywords(text) else '용어'
                    answer = text
            else:
                # 일반 지식
                kws = extract_keywords(text)
                question = kws[0] + ' 관련 정보' if kws else '제품 정보'
                answer = text
            
            if len(answer) < 10:
                continue
            
            entry_id += 1
            count += 1
            cat = categorize(text)
            
            all_entries.append({
                'id': f'html_{dir_name[:8]}_{entry_id}',
                'category': cat,
                'question': question,
                'answer': answer,
                'keywords': extract_keywords(text),
                'source': 'html_excel_export',
                'sheet': sheet_name,
                'learnedAt': datetime.now().isoformat()
            })
        
        print(f"  {sheet_name}: {count}개 항목 추출 ({len(rows)} 행)")

# ==============================
# 기존 learned-data.json에 병합
# ==============================
LEARNED_PATH = r'c:\Users\kimdy\인팸 쳇봇\learned-data.json'

print(f"\n총 {len(all_entries)}개 새 항목 추출", flush=True)

existing = []
if os.path.exists(LEARNED_PATH):
    with open(LEARNED_PATH, 'r', encoding='utf-8') as f:
        existing = json.load(f)

# 기존 HTML 데이터 제거 (재실행 시 중복 방지)
existing = [d for d in existing if d.get('source') != 'html_excel_export']
print(f"기존 학습 데이터: {len(existing)}개 (HTML 외)")

merged = existing + all_entries
with open(LEARNED_PATH, 'w', encoding='utf-8') as f:
    json.dump(merged, f, ensure_ascii=False, indent=2)

print(f"\n✅ learned-data.json 저장: 총 {len(merged)}개")
print(f"   - 기존: {len(existing)}개")
print(f"   - HTML 신규: {len(all_entries)}개")

# 카테고리별 통계
cats = {}
for e in all_entries:
    cats[e['category']] = cats.get(e['category'], 0) + 1
print("\n카테고리별:")
for c, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {c}: {n}개")

# 시트별 통계
sheets = {}
for e in all_entries:
    sheets[e['sheet']] = sheets.get(e['sheet'], 0) + 1
print("\n시트별:")
for s, n in sorted(sheets.items(), key=lambda x: -x[1]):
    print(f"  {s}: {n}개")
