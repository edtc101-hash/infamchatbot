const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');

// Gemini AI 초기화
const API_KEY = 'AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg';
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
const fileManager = new GoogleAIFileManager(API_KEY);

const CATALOG_DIR = path.join(__dirname, 'catalogs');
const OUTPUT_FILE = path.join(__dirname, 'product-data.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateJSONFromPDF(category, pdfPath) {
    const prompt = `
다음은 '${category}' 제품의 카탈로그 PDF 문서입니다.
이 문서에서 모든 개별 제품의 정보를 찾아내어 JSON 배열 형태로 만들어주세요.

추출할 필드:
- "productId" (예: 제품번호, 모델명 등 - 없으면 빈 문자열)
- "design" (예: 디자인 이름, 색상 등)
- "spec" (예: 규격, 크기, 두께 등)
- "price" (예: 가격 정보)

출력 형식 (반드시 JSON 배열만 출력할 것):
[
  {
    "category": "${category}",
    "productId": "703",
    "design": "크림 오크",
    "spec": "1220 x 2440 x 5mm",
    "price": "35,000원"
  }
]
`;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Upload the file
            console.log(`Uploading ${category}...`);
            const uploadResponse = await fileManager.uploadFile(pdfPath, {
                mimeType: "application/pdf",
                displayName: category,
            });
            console.log(`Upload complete: ${uploadResponse.file.uri}`);

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            fileData: {
                                mimeType: uploadResponse.file.mimeType,
                                fileUri: uploadResponse.file.uri
                            }
                        },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0.1 }
            });

            let content = result.response.text();

            if (content.includes('\`\`\`json')) {
                content = content.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
            } else if (content.includes('\`\`\`')) {
                content = content.split('\`\`\`')[1].split('\`\`\`')[0].trim();
            }

            return JSON.parse(content);
        } catch (e) {
            console.log(`[Attempt ${attempt}] Error for ${category}:`, e.message);
            if (e.status === 429) {
                console.log("Rate limited. Waiting 10 seconds...");
                await sleep(10000);
            } else {
                await sleep(4000);
            }
        }
    }
    return [];
}

async function main() {
    const allProducts = [];

    // Process top-level PDFs
    const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.pdf'));
    for (const file of files) {
        const category = file.replace('.pdf', '');
        console.log(`Processing ${category}...`);

        const pdfPath = path.join(CATALOG_DIR, file);
        const products = await generateJSONFromPDF(category, pdfPath);

        if (products && products.length > 0) {
            allProducts.push(...products);
            console.log(`  -> Extracted ${products.length} products.`);
        } else {
            console.log(`  -> No products extracted.`);
        }
        await sleep(4000); // rate limit 방지
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allProducts, null, 2), 'utf-8');
    console.log(`\nSuccessfully saved ${allProducts.length} product items to product-data.json`);
}

main().catch(console.error);
