import os
import fitz  # PyMuPDF
import gdown
import json
import google.generativeai as genai
import time
import glob

# Gemini API 설정
genai.configure(api_key='AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg')
model = genai.GenerativeModel('gemini-1.5-flash')

PDF_LINKS = {
    '인팸 월패널': '1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR',
    '카빙스톤': '1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ',
    '소프트스톤': '1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT',
    '라이트스톤': '1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj',
    '인팸스톤': '1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4',
    '스텐 플레이트': '14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG',
    '크리스탈블럭': '1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D',
    '아이스플레이트': '1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew',
    '아크릴 플레이트': '1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG',
    '시멘트 블럭': '1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6',
    '스타스톤': '1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO',
    '하드스톤': '1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP',
    '노이즈템바 보드': '1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q',
    '브릭스톤': '1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk',
    '플로우메탈': '18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH',
    '3D 블럭': '17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp',
    '오로라스톤': '1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK',
    '오브제 프레임': '1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl',
    '시멘트 플레이트': '1sj-SvwSxeae4E5l9gtaqCXxJIMWgcsmK',
    '템바보드': '10vJKO1wZaOOUVoJBwNfjHgED_at_XEME',
    '재료 분리대': '1zY1a-SGfIaFtZzfefy7-zE2x7D4nRWRf'
}

# WPC 월패널은 폴더 URL이라 별도 처리하거나 일단 스킵하고 나중에 매뉴얼 추가 가능. gdown.download_folder 사용 가능.
WPC_FOLDER = '17BugkibGu-LGP-norCf4X3X_EQfY0d1w'

DOWNLOAD_DIR = 'catalogs'
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def extract_text_from_pdf(pdf_path):
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text("text") + "\n"
        return text
    except Exception as e:
        print(f"Error reading {pdf_path}: {e}")
        return ""

import requests

API_KEY = 'AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg'
API_URL = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={API_KEY}'

def generate_json_from_text(category, text):
    prompt = f"""
다음은 '{category}' 제품의 카탈로그에서 추출한 텍스트입니다.
여기서 모든 개별 제품의 정보를 찾아내어 JSON 배열 형태로 만들어주세요.

추출할 필드:
- "productId" (예: 제품번호, 모델명 등 - 없으면 빈 문자열)
- "design" (예: 디자인 이름, 색상 등)
- "spec" (예: 규격, 크기, 두께 등)
- "price" (예: 가격 정보)

출력 형식 (반드시 JSON 배열만 출력할 것):
[
  {{
    "category": "{category}",
    "productId": "703",
    "design": "크림 오크",
    "spec": "1220 x 2440 x 5mm",
    "price": "35,000원"
  }}
]

카탈로그 추출 텍스트:
{text[:15000]}  # 텍스트 길이 제한
"""
    try:
        payload = {
            "contents": [{"parts":[{"text": prompt}]}]
        }
        headers = {'Content-Type': 'application/json'}
        response = requests.post(API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        content = data['candidates'][0]['content']['parts'][0]['text']
        
        # Markdown JSON 블록 제거
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        return json.loads(content)
    except Exception as e:
        print(f"Error generating JSON for {category}: {e}")
        return []

all_products = []

print("1. Downloading WPC Folder...")
try:
    gdown.download_folder(id=WPC_FOLDER, output=os.path.join(DOWNLOAD_DIR, 'WPC_월패널'), quiet=False)
except Exception as e:
    print(f"Error downloading WPC: {e}")

print("2. Downloading individual PDFs...")
for name, file_id in PDF_LINKS.items():
    output_path = os.path.join(DOWNLOAD_DIR, f"{name}.pdf")
    if not os.path.exists(output_path):
        print(f"Downloading {name}...")
        try:
            gdown.download(id=file_id, output=output_path, quiet=False)
        except Exception as e:
            print(f"Failed to download {name}: {e}")
    else:
        print(f"{name} already downloaded.")

print("\n3. Extracting and AI parsing...")
# Process individual files
for name in PDF_LINKS.keys():
    pdf_path = os.path.join(DOWNLOAD_DIR, f"{name}.pdf")
    if os.path.exists(pdf_path):
        print(f"Processing {name}...")
        text = extract_text_from_pdf(pdf_path)
        if text.strip():
            products = generate_json_from_text(name, text)
            if products:
                all_products.extend(products)
                print(f"  -> Extracted {len(products)} products.")
        time.sleep(2) # rate limit 방지

# Process WPC folder files
wpc_dir = os.path.join(DOWNLOAD_DIR, 'WPC_월패널')
if os.path.exists(wpc_dir):
    for root, dirs, files in os.walk(wpc_dir):
        for file in files:
            if file.endswith('.pdf'):
                pdf_path = os.path.join(root, file)
                print(f"Processing WPC PDF: {file}...")
                text = extract_text_from_pdf(pdf_path)
                if text.strip():
                    products = generate_json_from_text('WPC 월패널', text)
                    if products:
                        all_products.extend(products)
                        print(f"  -> Extracted {len(products)} products.")
                time.sleep(2)

# Save to JSON
with open('product-data.json', 'w', encoding='utf-8') as f:
    json.dump(all_products, f, ensure_ascii=False, indent=2)

print(f"\nSuccessfully saved {len(all_products)} product items to product-data.json")
