// Проверяем наличие конфига
if (!window.CONFIG) {
    console.error('Ошибка: создай файл config.js из config.example.js');
}

// Берем конфиг из глобальной переменной
const firebaseConfig = window.CONFIG ? window.CONFIG.FIREBASE : null;

if (!firebaseConfig) {
    throw new Error('Нет конфигурации Firebase!');
}

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Проверка поддержки Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognitionSupported = !!SpeechRecognition;

// Регистрация
if (document.getElementById('registerForm')) {
    document.getElementById('registerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        auth.createUserWithEmailAndPassword(email, password)
            .then(() => { window.location.href = 'index.html'; })
            .catch((error) => { document.getElementById('registerError').innerText = error.message; });
    });
}

// Вход
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        auth.signInWithEmailAndPassword(email, password)
            .then(() => { window.location.href = 'index.html'; })
            .catch((error) => { document.getElementById('loginError').innerText = error.message; });
    });
}

// Отслеживание состояния пользователя (обновление меню)
auth.onAuthStateChanged((user) => {
    const navAuth = document.getElementById('nav-auth');
    if (navAuth) {
        if (user) {
            navAuth.innerHTML = `
                <li class="nav-item"><span class="nav-link">${user.email}</span></li>
                <li class="nav-item"><a class="nav-link" href="#" id="logout">Выйти</a></li>
            `;
            document.getElementById('logout')?.addEventListener('click', (e) => {
                e.preventDefault();
                auth.signOut();
            });
        } else {
            navAuth.innerHTML = `
                <li class="nav-item"><a class="nav-link" href="login.html">Вход</a></li>
                <li class="nav-item"><a class="nav-link" href="register.html">Регистрация</a></li>
            `;
        }
    }
    if (document.getElementById('totalStats')) {
        loadProgress(user);
    }
});

// ================== Диагностика ==================
let mediaRecorder;
let audioChunks = [];
let recordedBlob = null;
let audioUrl = null;
let recognition = null;
let finalTranscript = '';
let microphoneStream = null;

async function requestMicrophoneOnce() {
    if (microphoneStream) return microphoneStream;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphoneStream = stream;
        return stream;
    } catch (err) {
        console.warn('Не удалось получить доступ к микрофону:', err);
        return null;
    }
}

// ================== AI Анализ речи через Groq (БЕСПЛАТНО) ==================
//
// Используем Groq API с моделью Llama 3.3 70B.
// Groq — полностью бесплатен, не требует банковской карты.
// Получить ключ: https://console.groq.com → API Keys → Create Key
//
// Запрос идёт через локальный server.js (прокси),
// чтобы ключ не светился в браузере.

async function analyzeWithAI(text, language) {
    const aiResultDiv = document.getElementById('aiAnalysisResult');
    const aiBlock = document.getElementById('aiAnalysisBlock');

    if (!aiBlock || !aiResultDiv) return;

    aiBlock.classList.remove('d-none');
    aiResultDiv.innerHTML = `
        <div class="d-flex align-items-center gap-2 text-secondary py-2">
            <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
            <span>ИИ анализирует вашу речь...</span>
        </div>
    `;

    const langHint = language === 'en'
        ? 'Текст на английском языке. Для транскрипции используй IPA (British/American English).'
        : language === 'ru'
        ? 'Текст на русском языке. Для транскрипции используй русскую фонетическую транскрипцию.'
        : 'Определи язык автоматически (русский или английский) и применяй соответствующую транскрипцию.';

    const prompt = `Ты — эксперт по фонетике и логопедии. Проанализируй следующий текст, который человек произнёс вслух.

Текст: "${text}"

${langHint}

Дай структурированный анализ по четырём разделам:

1. 📝 Фонетическая транскрипция
Для каждого слова укажи транскрипцию в квадратных скобках. Формат: слово [транскрипция]

2. 🔍 Анализ произношения
Выдели потенциально сложные звуки или сочетания в этом тексте (шипящие, сонорные, стечения согласных, безударные гласные и т.д.)

3. 💡 Рекомендации
Дай 2–3 конкретных практических совета по улучшению произношения этого текста.

4. ⭐ Сложность произношения
Оцени текст по шкале 1–5 (1 — очень просто, 5 — очень сложно) и кратко объясни.

Отвечай только на русском языке. Будь конкретным и полезным.`;

    try {
        // Отправляем запрос на локальный прокси-сервер (server.js)
        // Прокси пересылает запрос в Groq API с нашим ключом
        const response = await fetch("http://localhost:3000/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ошибка сервера: ${response.status} — ${errText}`);
        }

        const data = await response.json();

        // Groq отвечает в OpenAI-совместимом формате
        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }

        const resultText = data.choices?.[0]?.message?.content || '';
        if (!resultText) throw new Error('Пустой ответ от нейросети');

        aiResultDiv.innerHTML = formatAIResponse(resultText);
        window.lastAIAnalysis = resultText;

        const saveBtn = document.getElementById('saveResult');
        if (saveBtn && finalTranscript) saveBtn.disabled = false;

    } catch (err) {
        console.error('Ошибка AI анализа:', err);
        aiResultDiv.innerHTML = `
            <div class="alert alert-warning mb-0">
                <strong>⚠️ Не удалось получить AI-анализ</strong><br>
                <small class="text-muted">${err.message}</small><br>
                <small class="text-muted d-block mt-1">
                    Убедитесь что: 1) запущен <code>node server.js</code> в терминале,
                    2) в <code>server.js</code> вставлен ключ от <a href="https://console.groq.com" target="_blank">console.groq.com</a>
                </small>
                <button class="btn btn-sm btn-outline-warning mt-2" id="retryAI">🔄 Повторить</button>
            </div>
        `;
        document.getElementById('retryAI')?.addEventListener('click', () => {
            if (finalTranscript) analyzeWithAI(finalTranscript, language);
        });
    }
}

// Форматирование ответа нейросети в красивый HTML
function formatAIResponse(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/^#{1,3}\s*(.+)$/gm, '<h6 class="ai-section-title">$1</h6>');
    text = text.replace(/^\d+\.\s+(📝|🔍|💡|⭐.+)$/gm, '<h6 class="ai-section-title">$1</h6>');
    text = text.replace(/^[-•]\s+(.+)$/gm, '<div class="ai-bullet-item">▸ $1</div>');
    text = text.replace(/\n\n/g, '<br>');
    text = text.replace(/\n/g, ' ');
    return `<div class="ai-response-body"><p>${text}</p></div>`;
}

if (document.getElementById('startRecord')) {
    const startBtn = document.getElementById('startRecord');
    const stopBtn = document.getElementById('stopRecord');
    const playBtn = document.getElementById('playRecord');
    const downloadBtn = document.getElementById('downloadRecord');
    const saveBtn = document.getElementById('saveResult');
    const statusDiv = document.getElementById('recordingStatus');
    const recognizedTextDiv = document.getElementById('recognizedText');
    const phoneticTextDiv = document.getElementById('phoneticText');
    const copyTextBtn = document.getElementById('copyText');
    const copyPhoneticBtn = document.getElementById('copyPhonetic');

    // Переключатели режима фонетики
    let modeSelector = document.getElementById('phoneticModeGroup');
    if (!modeSelector) {
        const div = document.createElement('div');
        div.className = 'btn-group mb-2';
        div.id = 'phoneticModeGroup';
        div.innerHTML = `
            <button class="btn btn-sm btn-outline-primary active" data-mode="auto">Авто (рус/англ)</button>
            <button class="btn btn-sm btn-outline-primary" data-mode="en">Только англ. IPA</button>
        `;
        phoneticTextDiv.parentElement.insertBefore(div, phoneticTextDiv);
        modeSelector = div;
    }
    let currentPhoneticMode = 'auto';

    modeSelector.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            modeSelector.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPhoneticMode = btn.dataset.mode;
            if (finalTranscript) getPhonetics(finalTranscript, currentPhoneticMode);
        });
    });

    const phoneticCache = {};

    // ---------- Локальный словарь английских слов (IPA) ----------
    const englishIPADict = {
        "the": "ðə", "be": "biː", "to": "tuː", "of": "ʌv", "and": "ənd",
        "a": "ə", "in": "ɪn", "that": "ðæt", "have": "hæv", "i": "aɪ",
        "it": "ɪt", "for": "fɔːr", "not": "nɒt", "on": "ɒn", "with": "wɪð",
        "he": "hiː", "as": "æz", "you": "juː", "do": "duː", "at": "æt",
        "this": "ðɪs", "but": "bʌt", "his": "hɪz", "by": "baɪ", "from": "frɒm",
        "they": "ðeɪ", "we": "wiː", "say": "seɪ", "her": "hɜːr", "she": "ʃiː",
        "or": "ɔːr", "an": "ən", "will": "wɪl", "my": "maɪ", "one": "wʌn",
        "all": "ɔːl", "would": "wʊd", "there": "ðeər", "their": "ðeər",
        "what": "wɒt", "so": "səʊ", "up": "ʌp", "out": "aʊt", "if": "ɪf",
        "about": "əˈbaʊt", "who": "huː", "get": "ɡet", "which": "wɪtʃ",
        "go": "ɡəʊ", "me": "miː", "when": "wen", "make": "meɪk", "can": "kæn",
        "like": "laɪk", "time": "taɪm", "no": "nəʊ", "just": "dʒʌst",
        "him": "hɪm", "know": "nəʊ", "take": "teɪk", "people": "ˈpiːpəl",
        "into": "ˈɪntuː", "year": "jɪər", "your": "jɔːr", "good": "ɡʊd",
        "some": "sʌm", "could": "kʊd", "them": "ðəm", "see": "siː",
        "other": "ˈʌðər", "than": "ðæn", "then": "ðen", "now": "naʊ",
        "look": "lʊk", "only": "ˈəʊnli", "come": "kʌm", "its": "ɪts",
        "over": "ˈəʊvər", "think": "θɪŋk", "also": "ˈɔːlsəʊ", "back": "bæk",
        "after": "ˈɑːftər", "use": "juːz", "two": "tuː", "how": "haʊ",
        "our": "aʊər", "work": "wɜːrk", "first": "fɜːrst", "well": "wel",
        "way": "weɪ", "even": "ˈiːvən", "new": "njuː", "want": "wɒnt",
        "because": "bɪˈkɒz", "any": "ˈeni", "these": "ðiːz", "give": "ɡɪv",
        "day": "deɪ", "most": "məʊst", "us": "ʌs", "hello": "həˈləʊ",
        "world": "wɜːrld", "english": "ˈɪŋɡlɪʃ", "please": "pliːz",
        "thank": "θæŋk", "sorry": "ˈsɒri", "yes": "jes", "help": "help",
        "water": "ˈwɔːtər", "food": "fuːd", "love": "lʌv", "home": "həʊm",
        "school": "skuːl", "book": "bʊk", "read": "riːd", "write": "raɪt",
        "speak": "spiːk", "learn": "lɜːrn", "study": "ˈstʌdi", "name": "neɪm",
        "very": "ˈveri", "much": "mʌtʃ", "here": "hɪər", "right": "raɪt",
        "old": "əʊld", "big": "bɪɡ", "same": "seɪm", "too": "tuː",
        "little": "ˈlɪtəl", "hand": "hænd", "place": "pleɪs", "great": "ɡreɪt",
        "where": "weər", "long": "lɒŋ", "need": "niːd", "often": "ˈɒfən"
    };

    // ---------- Русская фонетика ----------
    function russianPhonetic(word) {
        word = word.toLowerCase().replace(/ё/g, 'е');
        const vowels = 'аеиоуыэюя';
        const voiced = 'бвгджз';
        const voiceless = 'пфктшс';

        let result = '';
        const len = word.length;

        for (let i = 0; i < len; i++) {
            let ch = word[i];
            let next = i < len - 1 ? word[i + 1] : '';

            if (vowels.includes(ch)) {
                if (ch === 'о' && i !== len - 1) ch = 'а';
                else if (ch === 'е' && i !== len - 1) ch = 'и';
                else if (ch === 'я' && i !== len - 1) ch = 'и';
            }

            if (i === len - 1) {
                if (ch === 'б') ch = 'п';
                else if (ch === 'в') ch = 'ф';
                else if (ch === 'г') ch = 'к';
                else if (ch === 'д') ch = 'т';
                else if (ch === 'ж') ch = 'ш';
                else if (ch === 'з') ch = 'с';
            }
            if (voiced.includes(ch) && voiceless.includes(next)) {
                if (ch === 'б') ch = 'п';
                else if (ch === 'в') ch = 'ф';
                else if (ch === 'г') ch = 'к';
                else if (ch === 'д') ch = 'т';
                else if (ch === 'ж') ch = 'ш';
                else if (ch === 'з') ch = 'с';
            }
            if (voiceless.includes(ch) && voiced.includes(next)) {
                if (ch === 'п') ch = 'б';
                else if (ch === 'ф') ch = 'в';
                else if (ch === 'к') ch = 'г';
                else if (ch === 'т') ch = 'д';
                else if (ch === 'ш') ch = 'ж';
                else if (ch === 'с') ch = 'з';
            }
            result += ch;
        }
        return result;
    }

    // ---------- Вспомогательные функции сети ----------
    async function fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return response;
        } catch (err) {
            clearTimeout(id);
            throw err;
        }
    }

    async function fetchWithRetry(url, options = {}, retries = 2, timeout = 4000) {
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetchWithTimeout(url, options, timeout);
                if (response.ok) return response;
                throw new Error(`HTTP error ${response.status}`);
            } catch (err) {
                if (i === retries) throw err;
                await new Promise(r => setTimeout(r, 800));
            }
        }
    }

    // ---------- Английская фонетика (словарь + API) ----------
    async function getEnglishPhonetic(word) {
        if (englishIPADict[word]) return englishIPADict[word];

        let phonetic = '';
        try {
            const response = await fetchWithRetry(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, {}, 2, 4000
            );
            const data = await response.json();
            if (data[0]?.phonetic) phonetic = data[0].phonetic;
            else if (data[0]?.phonetics?.[0]?.text) phonetic = data[0].phonetics[0].text;
        } catch (e) { /* тихо пропускаем */ }

        if (!phonetic) {
            phonetic = word.split('').map(ch => {
                const map = { 'a': 'ə', 'e': 'ɛ', 'i': 'ɪ', 'o': 'ɒ', 'u': 'ʊ', 'y': 'j' };
                return map[ch] || ch;
            }).join('') + ' (прибл.)';
        }
        return phonetic;
    }

    // ---------- Основная функция базовой фонетики ----------
    async function getPhonetics(text, mode = 'auto') {
        if (!text || !text.trim()) return;

        phoneticTextDiv.innerHTML = 'Загрузка... <span class="spinner-border spinner-border-sm" role="status"></span>';

        const words = text.toLowerCase().match(/[a-zа-яё]+(?:['-][a-zа-яё]+)*/g) || [];
        if (words.length === 0) {
            phoneticTextDiv.innerHTML = '—';
            return;
        }

        const phonetics = [];

        for (const word of words) {
            const cacheKey = `${mode}_${word}`;
            if (phoneticCache[cacheKey]) {
                phonetics.push(`${word}: ${phoneticCache[cacheKey]}`);
                continue;
            }

            const isLatin = /^[a-z']+$/.test(word);
            let result = mode === 'en'
                ? await getEnglishPhonetic(word)
                : isLatin ? await getEnglishPhonetic(word) : russianPhonetic(word);

            phoneticCache[cacheKey] = result;
            phonetics.push(`${word}: ${result}`);
            await new Promise(r => setTimeout(r, 50));
        }

        phoneticTextDiv.innerHTML = phonetics.length > 0 ? phonetics.join('<br>') : '—';
        if (phonetics.length > 0) copyPhoneticBtn.disabled = false;

        // После базовой фонетики — запускаем AI-анализ через Groq
        analyzeWithAI(text, mode);
    }

    // ---------- Запрос микрофона ----------
    requestMicrophoneOnce().then(stream => {
        if (!stream) statusDiv.innerHTML = '⚠️ Нет доступа к микрофону. Проверьте разрешения.';
    });

    // ---------- Кнопки ----------
    startBtn.addEventListener('click', async () => {
        try {
            let stream = microphoneStream || await requestMicrophoneOnce();
            if (!stream) throw new Error('Микрофон не доступен');

            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            finalTranscript = '';
            recognizedTextDiv.innerHTML = '';
            phoneticTextDiv.innerHTML = '';
            window.lastAIAnalysis = '';

            const aiBlock = document.getElementById('aiAnalysisBlock');
            if (aiBlock) aiBlock.classList.add('d-none');

            mediaRecorder.ondataavailable = e => { audioChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (audioUrl) URL.revokeObjectURL(audioUrl);
                audioUrl = URL.createObjectURL(recordedBlob);
                playBtn.disabled = false;
                downloadBtn.disabled = false;
                statusDiv.innerHTML = '✅ Запись завершена.';
            };
            mediaRecorder.start();

            if (recognition) {
                recognition.start();
                statusDiv.innerHTML = '🎙️ Запись идёт... Говорите!';
            } else {
                statusDiv.innerHTML = '🎙️ Запись идёт... (распознавание недоступно)';
            }

            startBtn.disabled = true;
            stopBtn.disabled = false;
            playBtn.disabled = true;
            downloadBtn.disabled = true;
            saveBtn.disabled = true;

        } catch (err) {
            alert('Ошибка доступа к микрофону: ' + err.message);
        }
    });

    stopBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (recognition) recognition.stop();
        startBtn.disabled = false;
        stopBtn.disabled = true;
        if (finalTranscript) saveBtn.disabled = false;
    });

    playBtn.addEventListener('click', () => { if (audioUrl) new Audio(audioUrl).play(); });

    downloadBtn.addEventListener('click', () => {
        if (recordedBlob && audioUrl) {
            const a = document.createElement('a');
            a.href = audioUrl;
            a.download = 'speech-diagnostic.webm';
            a.click();
        }
    });

    copyTextBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(recognizedTextDiv.innerText);
        copyTextBtn.textContent = '✅ Скопировано';
        setTimeout(() => { copyTextBtn.textContent = 'Копировать текст'; }, 2000);
    });

    copyPhoneticBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(phoneticTextDiv.innerText);
        copyPhoneticBtn.textContent = '✅ Скопировано';
        setTimeout(() => { copyPhoneticBtn.textContent = 'Копировать фонетику'; }, 2000);
    });

    // Редактирование распознанного текста
    const editBtn = (() => {
        const existing = document.getElementById('editText');
        if (existing) return existing;
        const btn = document.createElement('button');
        btn.id = 'editText';
        btn.className = 'btn btn-warning btn-sm mt-2';
        btn.textContent = '✏️ Редактировать текст';
        recognizedTextDiv.parentElement.appendChild(btn);
        return btn;
    })();

    editBtn.addEventListener('click', () => {
        const input = document.createElement('textarea');
        input.value = recognizedTextDiv.innerText;
        input.className = 'form-control mb-2';
        input.rows = 3;
        recognizedTextDiv.innerHTML = '';
        recognizedTextDiv.appendChild(input);

        const saveEditBtn = document.createElement('button');
        saveEditBtn.textContent = 'Сохранить';
        saveEditBtn.className = 'btn btn-success btn-sm';
        recognizedTextDiv.appendChild(saveEditBtn);

        saveEditBtn.addEventListener('click', () => {
            const newText = input.value.trim();
            recognizedTextDiv.innerHTML = newText;
            finalTranscript = newText;
            getPhonetics(newText, currentPhoneticMode);
            saveBtn.disabled = false;
        });
    });

    // Кнопка повторного AI-анализа
    document.getElementById('reanalyzeBtn')?.addEventListener('click', () => {
        if (finalTranscript) analyzeWithAI(finalTranscript, currentPhoneticMode);
    });

    // Сохранение в Firestore
    saveBtn.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) { alert('Войдите, чтобы сохранить результат'); return; }

        await db.collection('diagnostics').doc(user.uid).set({
            text: finalTranscript,
            phonetics: phoneticTextDiv.innerText,
            aiAnalysis: window.lastAIAnalysis || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await db.collection('users').doc(user.uid).set({
            lastDiagnostic: finalTranscript.substring(0, 100),
            diagnosticCount: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });

        saveBtn.textContent = '✅ Сохранено!';
        saveBtn.disabled = true;
        setTimeout(() => { saveBtn.textContent = '💾 Сохранить результат'; }, 3000);
    });

    // Инициализация Web Speech API
    if (recognitionSupported) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let newFinal = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript;
                if (event.results[i].isFinal) newFinal += t + ' ';
                else interimTranscript += t;
            }
            if (newFinal) finalTranscript += newFinal;
            if (interimTranscript) recognizedTextDiv.innerHTML = `<em style="color:#888">${interimTranscript}</em>`;
            if (finalTranscript) {
                recognizedTextDiv.innerHTML = finalTranscript;
                copyTextBtn.disabled = false;
                getPhonetics(finalTranscript, currentPhoneticMode);
            }
        };

        recognition.onerror = (event) => {
            if (event.error !== 'no-speech') statusDiv.innerHTML = `❌ Ошибка: ${event.error}`;
        };

        recognition.onend = () => {
            if (finalTranscript) {
                statusDiv.innerHTML = '✅ Распознавание завершено';
                getPhonetics(finalTranscript, currentPhoneticMode);
            }
        };
    } else {
        recognizedTextDiv.innerHTML = '<span class="text-danger">❌ Распознавание не поддерживается. Используйте Chrome или Edge.</span>';
    }
}

// ================== База упражнений ==================
const exercisesDB = {
    "Звук Р": {
        icon: "🗣️",
        description: "Упражнения для постановки и автоматизации звука Р",
        exercises: [
            { name: "Лошадка", steps: ["Улыбнитесь, покажите зубы", "Цокайте языком медленно, затем быстрее", "Выполните 20 повторений"] },
            { name: "Грибок", steps: ["Улыбнитесь", "Присосите язык к нёбу", "Удержите 5–10 секунд", "Повторите 10 раз"] },
            { name: "Барабанщик", steps: ["Улыбнитесь, приоткройте рот", "Стучите кончиком языка по альвеолам", "Произносите Д-Д-Д быстро", "Ускоряйте постепенно"] }
        ]
    },
    "Звук Л": {
        icon: "👅",
        description: "Упражнения для постановки звука Л",
        exercises: [
            { name: "Пароход гудит", steps: ["Слегка прикусите кончик языка", "Тяните звук Ы-Ы-Ы", "Должен получаться звук похожий на Л", "Повторите 15 раз"] },
            { name: "Качели", steps: ["Широко откройте рот", "Поднимайте язык вверх-вниз", "Чередуйте быстро и медленно", "30 секунд"] }
        ]
    },
    "Шипящие звуки": {
        icon: "🐍",
        description: "Упражнения для Ш, Ж, Ч, Щ",
        exercises: [
            { name: "Чашечка", steps: ["Откройте рот", "Высуньте широкий язык", "Поднимите края языка вверх — форма чашки", "Удержите 10 секунд, повторите 10 раз"] },
            { name: "Фокус", steps: ["Высуньте широкий язык", "Поднимите его к верхней губе", "Подуйте на нос", "Повторите 5 раз"] }
        ]
    },
    "Скороговорки": {
        icon: "⚡",
        description: "Развитие дикции и чёткости речи",
        exercises: [
            { name: "Сибилянты", steps: ["Шла Саша по шоссе и сосала сушку", "Медленно 3 раза", "Ускоряйте постепенно", "До максимальной скорости"] },
            { name: "Сонорные", steps: ["На горе Арарат растёт красный виноград", "Следите за звуком Р", "3 раза медленно, 3 раза быстро"] },
            { name: "Смешанные", steps: ["Карл у Клары украл кораллы", "Выделяйте каждый слог", "Доводите до автоматизма"] }
        ]
    },
    "Дыхательные упражнения": {
        icon: "🫁",
        description: "Развитие речевого дыхания",
        exercises: [
            { name: "Свеча", steps: ["Поставьте свечу на 20 см", "Вдохните носом", "Медленно дуйте, не гася пламя", "Удержите 10 секунд"] },
            { name: "Долгий выдох", steps: ["Глубокий вдох", "Выдыхайте очень медленно", "Выдох — не менее 10 секунд"] }
        ]
    }
};

function renderCategories() {
    const container = document.getElementById('exerciseCategories');
    if (!container) return;
    container.innerHTML = '';
    for (const [category, data] of Object.entries(exercisesDB)) {
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-4';
        col.innerHTML = `
            <div class="card h-100 shadow-sm" style="cursor:pointer;transition:transform .15s"
                 onmouseover="this.style.transform='translateY(-3px)'"
                 onmouseout="this.style.transform=''"
                 onclick="showCategory('${category}')">
                <div class="card-body text-center">
                    <div style="font-size:2.5rem">${data.icon}</div>
                    <h5 class="card-title mt-2">${category}</h5>
                    <p class="card-text text-muted small">${data.description}</p>
                    <span class="badge bg-primary">${data.exercises.length} упражнений</span>
                </div>
            </div>
        `;
        container.appendChild(col);
    }
}

function showCategory(category) {
    const data = exercisesDB[category];
    if (!data) return;
    document.getElementById('exerciseCategories').classList.add('d-none');
    document.getElementById('exerciseDetail').classList.remove('d-none');
    document.getElementById('exerciseContent').innerHTML = `
        <h3>${data.icon} ${category}</h3>
        <p class="text-muted">${data.description}</p>
        <div class="row">
            ${data.exercises.map(ex => `
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header"><strong>${ex.name}</strong></div>
                        <div class="card-body">
                            <ol>${ex.steps.map(s => `<li>${s}</li>`).join('')}</ol>
                            <button class="btn btn-sm btn-success mt-2"
                                    onclick="markDone('${category}', '${ex.name}', this)">✅ Выполнено</button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function backToCategories() {
    document.getElementById('exerciseCategories').classList.remove('d-none');
    document.getElementById('exerciseDetail').classList.add('d-none');
}

async function markDone(category, exerciseName, btn) {
    btn.disabled = true;
    btn.textContent = '✔ Готово!';
    btn.classList.replace('btn-success', 'btn-secondary');
    const user = auth.currentUser;
    if (user) {
        await db.collection('users').doc(user.uid).set({
            exercises: { [category]: firebase.firestore.FieldValue.increment(1) }
        }, { merge: true });
    }
}

async function loadRecommendation() {
    const recDiv = document.getElementById('recommendation');
    if (!recDiv) return;
    const user = auth.currentUser;
    if (!user) {
        recDiv.innerHTML = '👋 <a href="login.html">Войдите</a>, чтобы получить персональные рекомендации.';
        return;
    }
    const doc = await db.collection('diagnostics').doc(user.uid).get();
    if (doc.exists && doc.data().text) {
        recDiv.innerHTML = `💡 На основе вашей диагностики рекомендуем работать над чёткостью произношения. Последний текст: "<em>${doc.data().text.substring(0, 80)}…</em>"`;
    } else {
        recDiv.innerHTML = '📋 Пройдите <a href="diagnostic.html">диагностику</a>, чтобы получить персональные рекомендации.';
    }
}

async function loadProgress(user) {
    const totalStats = document.getElementById('totalStats');
    const lastText = document.getElementById('lastDiagnosticText');
    const lastPhonetics = document.getElementById('lastDiagnosticPhonetics');
    if (!totalStats) return;
    if (!user) {
        totalStats.innerHTML = '<a href="login.html">Войдите</a>, чтобы увидеть прогресс.';
        return;
    }
    try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        const diagDoc = await db.collection('diagnostics').doc(user.uid).get();
        const userData = userDoc.data() || {};
        const diagData = diagDoc.data() || {};
        const diagnosticCount = userData.diagnosticCount || 0;
        const exercises = userData.exercises || {};
        const totalExercises = Object.values(exercises).reduce((sum, v) => sum + v, 0);

        totalStats.innerHTML = `Диагностик пройдено: <strong>${diagnosticCount}</strong><br>Упражнений выполнено: <strong>${totalExercises}</strong>`;
        if (lastText) lastText.textContent = diagData.text || '—';
        if (lastPhonetics) lastPhonetics.textContent = diagData.phonetics || '—';

        const ctx = document.getElementById('progressChart');
        if (ctx && Object.keys(exercises).length > 0) {
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(exercises),
                    datasets: [{ data: Object.values(exercises), backgroundColor: ['#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706'] }]
                },
                options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
            });
        } else if (ctx) {
            ctx.parentElement.innerHTML += '<p class="text-muted small mt-2 text-center">Пока нет выполненных упражнений.</p>';
        }
    } catch (e) {
        console.error('Ошибка загрузки прогресса:', e);
        totalStats.innerHTML = 'Ошибка загрузки данных.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('exerciseCategories')) {
        renderCategories();
        auth.onAuthStateChanged(loadRecommendation);
    }
});