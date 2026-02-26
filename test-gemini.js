const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = 'AIzaSyD3wIhlwphHjTjZA9BNUjnO7RmPOgRfmLg';
const genAI = new GoogleGenerativeAI(API_KEY);

const modelsToTest = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro',
    'gemini-1.5-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-native-audio-latest'
];

async function run() {
    for (const modelName of modelsToTest) {
        console.log(`Testing ${modelName}...`);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const res = await model.generateContent("Say 'hello' in exactly one word. Nothing else.");
            console.log(`  -> SUCCESS: ${res.response.text().trim()}`);
            break; // Stop at the first working one
        } catch (e) {
            console.log(`  -> FAILED: ${e.message.split('\n')[0]}`);
        }
    }
}
run();
