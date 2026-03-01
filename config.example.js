// config.example.js - скопируй это в config.js и вставь свои ключи
const CONFIG = {
    // Твой Hugging Face ключ (получи новый на huggingface.co/settings/tokens)
    HF_API_KEY: 'hf_твой_новый_ключ_сюда',
    
    // Твои Firebase ключи (они уже есть в app.js)
    FIREBASE: {
        apiKey: "AIzaSyCn59O1kv06-1Fu6iSeoPb9GXiC3scI_iY",
        authDomain: "speechplatform-195a9.firebaseapp.com",
        projectId: "speechplatform-195a9",
        storageBucket: "speechplatform-195a9.firebasestorage.app",
        messagingSenderId: "330018914814",
        appId: "1:330018914814:web:ef8766f970dbb7878b40af",
        measurementId: "G-2E41K0TS3S"
    }
};

window.CONFIG = CONFIG;