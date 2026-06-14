if (!window.CONFIG) {
    console.error('Ошибка: создай файл config.js из config.example.js');
}

const firebaseConfig = window.CONFIG ? window.CONFIG.FIREBASE : null;
if (!firebaseConfig) throw new Error('Нет конфигурации Firebase!');

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognitionSupported = !!SpeechRecognition;

const exercisesDB = window.EXERCISES_DB || {};

const MOTIVATION_QUOTES = [
    { text: "Каждый день практики — шаг к чистой и уверенной речи.", author: "SpeechPlatform" },
    { text: "Ошибки в произношении — не приговор, а точки роста.", author: "Логопедическая практика" },
    { text: "Пять минут артикуляции сегодня лучше, чем час «когда-нибудь».", author: "SpeechPlatform" },
    { text: "Слушай себя внимательно — уши учат не хуже языка.", author: "Совет логопеда" },
    { text: "Иностранный язык начинается с правильного звука, а не с грамматики.", author: "SpeechPlatform" },
    { text: "Терпение и повторение творят чудеса в коррекции речи.", author: "SpeechPlatform" },
    { text: "Говори медленно — думай быстро. Чёткость важнее скорости.", author: "SpeechPlatform" }
];

const ACHIEVEMENTS_DEF = [
    { id: 'registered', icon: '', title: 'Добро пожаловать', desc: 'Создан аккаунт' },
    { id: 'first_diagnostic', icon: '', title: 'Первый анализ', desc: 'Пройдена диагностика', need: d => (d.diagnosticCount || 0) >= 1 },
    { id: 'five_exercises', icon: '', title: 'Зеленый', desc: '5 упражнений', need: d => totalExercises(d) >= 5 },
    { id: 'twenty_exercises', icon: '', title: 'Втянутый', desc: '20 упражнений', need: d => totalExercises(d) >= 20 },
    { id: 'streak_3', icon: '', title: '3 дня подряд', desc: 'Серия 3 дня', need: d => (d.streak || 0) >= 3 },
    { id: 'streak_7', icon: '', title: 'Неделя дисциплины', desc: 'Серия 7 дней', need: d => (d.streak || 0) >= 7 },
    { id: 'level_5', icon: '', title: 'Уровень 5', desc: 'Достигнут 5 уровень', need: d => getLevel(d.xp || 0) >= 5 }
];

function totalExercises(data) {
    const ex = data.exercises || {};
    return Object.values(ex).reduce((s, v) => s + (v || 0), 0);
}

function getLevel(xp) {
    return Math.floor(xp / 100) + 1;
}

function xpForNextLevel(xp) {
    const level = getLevel(xp);
    const currentLevelXp = (level - 1) * 100;
    const nextLevelXp = level * 100;
    return { level, current: xp - currentLevelXp, needed: nextLevelXp - currentLevelXp, percent: Math.min(100, ((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100) };
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

async function ensureUserProfile(user, displayName) {
    const ref = db.collection('users').doc(user.uid);
    const doc = await ref.get();
    if (!doc.exists) {
        await ref.set({
            email: user.email,
            displayName: displayName || user.email.split('@')[0],
            goals: ['Улучшить чёткость речи'],
            dailyGoalMinutes: 10,
            xp: 0,
            streak: 0,
            lastPracticeDate: null,
            diagnosticCount: 0,
            exercises: {},
            achievements: ['registered'],
            createdAt: new Date().toISOString()
        });
    }
}

async function awardXp(user, amount, reason) {
    if (!user) return;
    const ref = db.collection('users').doc(user.uid);
    const doc = await ref.get();
    const data = doc.data() || {};
    const today = todayKey();
    let streak = data.streak || 0;
    const last = data.lastPracticeDate;

    if (last === today) {
        // уже практиковался сегодня
    } else if (last === yesterdayKey()) {
        streak += 1;
    } else {
        streak = 1;
    }

    const newXp = (data.xp || 0) + amount;
    const unlocked = [...(data.achievements || [])];
    const newData = { ...data, xp: newXp, streak, lastPracticeDate: today };
    ACHIEVEMENTS_DEF.forEach(a => {
        if (a.need && a.need(newData) && !unlocked.includes(a.id)) unlocked.push(a.id);
    });

    await ref.set({
        xp: newXp,
        streak,
        lastPracticeDate: today,
        achievements: unlocked
    }, { merge: true });

    if (reason) showNotification(`+${amount} XP — ${reason}`, 'success');
}

function setActiveNavLink() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sp-navbar .nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === page) link.classList.add('active');
    });
}

if (document.getElementById('registerForm')) {
    document.getElementById('registerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const displayName = document.getElementById('displayName')?.value?.trim();
        auth.createUserWithEmailAndPassword(email, password)
            .then(async (cred) => {
                await ensureUserProfile(cred.user, displayName);
                window.location.href = 'index.html';
            })
            .catch(error => {
                const el = document.getElementById('registerError');
                if (el) el.innerText = translateFirebaseError(error.message);
            });
    });
}

if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        auth.signInWithEmailAndPassword(email, password)
            .then(() => window.location.href = 'index.html')
            .catch(error => {
                const el = document.getElementById('loginError');
                if (el) el.innerText = translateFirebaseError(error.message);
            });
    });
}

function translateFirebaseError(msg) {
    if (msg.includes('invalid-email')) return 'Некорректный email';
    if (msg.includes('wrong-password')) return 'Неверный пароль';
    if (msg.includes('user-not-found')) return 'Пользователь не найден';
    if (msg.includes('email-already-in-use')) return 'Email уже зарегистрирован';
    if (msg.includes('weak-password')) return 'Пароль слишком простой (минимум 6 символов)';
    return msg;
}

auth.onAuthStateChanged(async (user) => {
    const navAuth = document.getElementById('nav-auth');
    if (navAuth) {
        if (user) {
            await ensureUserProfile(user);
            const userDoc = await db.collection('users').doc(user.uid).get();
            const data = userDoc.data() || {};
            const name = data.displayName || user.email.split('@')[0];
            const lvl = getLevel(data.xp || 0);
            navAuth.innerHTML = `
                <li class="nav-item d-flex align-items-center">
                    <span class="sp-user-badge me-2">Ур. ${lvl}</span>
                </li>
                <li class="nav-item"><a class="nav-link" href="progress.html">${name}</a></li>
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
    if (document.getElementById('profileRoot')) loadProfile(user);
    if (document.getElementById('homeMotivation')) loadHomePage(user);
    if (document.getElementById('totalStats')) loadProgress(user);
});

let mediaRecorder;
let audioChunks = [];
let recordedBlob = null;
let audioUrl = null;
let recognition = null;
let finalTranscript = '';
let microphoneStream = null;
let currentLanguage = 'ru';

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

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
    notification.style.zIndex = '9999';
    notification.style.maxWidth = '400px';
    notification.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderPhoneticComparison(result) {
    const words = result.wordTranscription || [];
    if (!words.length) return '<p class="text-muted">Нет данных для сравнения</p>';

    const lang = result.language === 'en' ? 'en' : 'ru';
    
    let html = '<div class="phonetic-compare-block mt-4">';
    html += '</div>';

    if (!result.allosaurusUsed) {
        html += '<p class="small text-warning mb-2"> Allosaurus недоступен на сервере — оценка произведена по словарному fallback.</p>';
    }

    html += '<div class="d-flex flex-wrap align-items-start gap-3 p-3 bg-light rounded border border-secondary-subtle">';
    words.forEach((w, idx) => {
        const wordLabel = w.reference || w.heard || '—';
        const isExtra = w.type === 'insertion';
        const isDeleted = w.type === 'deletion';
        
        html += renderWordPhoneticGroup(wordLabel, w.phoneComparison, w.displayExpected, isExtra, isDeleted);
        
        if (idx < words.length - 1) {
            html += '<div class="align-self-center text-muted px-1 fw-bold">|</div>';
        }
    });
    html += '</div>';

    html += `<div class="phonetic-legend mt-3 d-flex flex-wrap gap-3 small">
        <div><span class="badge bg-success me-1">&nbsp;</span> Правильный звук</div>
        <div><span class="badge bg-danger me-1">&nbsp;</span> Ошибка произношения</div>
        <div><span class="badge bg-secondary me-1">&nbsp;</span> Пропущенный или неизвестный звук</div>
    </div>`;

    html += '</div>';
    return html;
}

function renderWordPhoneticGroup(label, phoneComparison, expectedDisplay, isExtra, isDeleted) {
    const comp = phoneComparison || [];
    
    let colorClass = 'text-dark';
    if (isExtra) colorClass = 'text-danger text-decoration-underline';
    if (isDeleted) colorClass = 'text-muted text-decoration-line-through';

    let html = `<div class="d-flex flex-column align-items-center text-center m-1 p-2 bg-white rounded border shadow-sm">
        <span class="fw-bold ${colorClass}">${escapeHtml(label)}</span>`;
    
    html += '<div class="d-flex gap-1 mt-2">';
    comp.forEach(p => {
        let badgeClass = 'bg-danger';
        if (p.correct === true) {
            badgeClass = 'bg-success';
        } else if (p.actual === '—' || p.expected === '—') {
            badgeClass = 'bg-secondary';
        } else if (p.actual === '?') {
            badgeClass = 'bg-secondary opacity-50';
        }

        const textToShow = (p.actual && p.actual !== '—' && p.actual !== '?')
            ? p.actual
            : p.expected;

        let titleTooltip = `Эталон: [${p.expected}]`;
        if (p.actual && p.actual !== '?') {
            titleTooltip += ` → Услышано: [${p.actual}]`;
        }
        if (p.correct) titleTooltip += ' ✓';

        html += `<span class="badge ${badgeClass} text-white font-monospace p-2"
                      style="min-width: 28px; cursor: help;"
                      title="${escapeHtml(titleTooltip)}">
                    ${escapeHtml(textToShow)}
                 </span>`;
    });
    html += '</div>';
    
    if (expectedDisplay && expectedDisplay !== '—' && !isExtra) {
        html += `<small class="text-muted mt-1" style="font-size: 0.75rem;">[${escapeHtml(expectedDisplay)}]</small>`;
    }
    
    html += '</div>';
    return html;
}

async function analyzeRealSpeech(audioBlob, referenceText, language) {
    const aiResultDiv = document.getElementById('aiAnalysisResult');
    const aiBlock = document.getElementById('aiAnalysisBlock');
    if (!aiBlock || !aiResultDiv) return;

    aiBlock.classList.remove('d-none');
    aiResultDiv.innerHTML = `
        <div class="d-flex align-items-center gap-3 text-secondary py-3">
            <div class="spinner-border text-primary" style="width: 2rem; height: 2rem;"></div>
            <div>
                <strong>Анализ произношения...</strong><br>
            </div>
        </div>
    `;

    try {
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('language', language === 'ru' ? 'ru' : 'en');
        formData.append('referenceText', referenceText);

        const response = await fetch('http://localhost:3001/api/pronunciation', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Ошибка сервера. Запустите: npm start');
        }

        const a = result.assessment;
        const comparisonHtml = renderPhoneticComparison(result);

        const scoreColor = a.overallScore >= 80 ? 'success' : a.overallScore >= 60 ? 'warning' : 'danger';

        let html = '<div class="ai-analysis-result">';
        html += `<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <h5 class="mb-0 text-${scoreColor}">Оценка: ${Math.round(a.overallScore)}/100</h5>
        </div>`;

        html += comparisonHtml;

        if (a.feedback?.length) {
            html += '<ul class="small text-muted mt-3 mb-0">';
            a.feedback.forEach(t => { html += `<li>${escapeHtml(t)}</li>`; });
            html += '</ul>';
        }
        if (result.recommendations && result.recommendations.length) {
            html += '<div class="mt-3 alert alert-info">';
            html += '<strong> Рекомендуемые упражнения:</strong> ';
            html += result.recommendations.join(', ');
            html += '<br><small class="text-muted">Для уточнения можете проанализировать речь повторно</small>';
            html += '</div>';
        }

        html += '</div>';
        aiResultDiv.innerHTML = html;
    } catch (error) {
        console.error('Analysis error:', error);
        aiResultDiv.innerHTML = `<div class="alert alert-danger"><strong>Ошибка анализа</strong><br>${escapeHtml(error.message)}</div>`;
    }
}

if (document.getElementById('startRecord')) {
    const startBtn = document.getElementById('startRecord');
    const stopBtn = document.getElementById('stopRecord');
    const playBtn = document.getElementById('playRecord');
    const downloadBtn = document.getElementById('downloadRecord');
    const saveBtn = document.getElementById('saveResult');
    const statusDiv = document.getElementById('recordingStatus');
    const recognizedTextDiv = document.getElementById('recognizedText');

    // Инициализация выбора фразы (через #phrases)
    document.querySelectorAll('#phrases .list-group-item, #phrases .phrase-item').forEach((item, i) => {
        if (i === 0) item.classList.add('active');
        item.classList.add('phrase-item');
        if (i === 0) {
            const refPreview = document.getElementById('referencePhrasePreview');
            if (refPreview) refPreview.textContent = item.innerText;
        }
        item.addEventListener('click', () => {
            document.querySelectorAll('#phrases .phrase-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            const refPreview = document.getElementById('referencePhrasePreview');
            if (refPreview) refPreview.textContent = item.innerText;
        });
    });


    requestMicrophoneOnce().then(stream => {
        if (!stream && statusDiv) statusDiv.innerHTML = 'Нет доступа к микрофону.';
    });

    startBtn.addEventListener('click', async () => {
        try {
            if (!microphoneStream) {
                alert('Не удалось получить доступ к микрофону. Перезагрузите страницу и разрешите доступ.');
                return;
            }
            const stream = microphoneStream;
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            finalTranscript = '';
            recognizedTextDiv.innerHTML = '';
            document.getElementById('aiAnalysisBlock')?.classList.add('d-none');

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (audioUrl) URL.revokeObjectURL(audioUrl);
                audioUrl = URL.createObjectURL(recordedBlob);
                playBtn.disabled = false;
                downloadBtn.disabled = false;
            };
            mediaRecorder.start();
            if (recognition) {
                recognition.start();
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

    const editBtn = document.getElementById('editText');
    if (editBtn) {
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
                finalTranscript = input.value.trim();
                recognizedTextDiv.innerHTML = finalTranscript;
                saveBtn.disabled = false;
            });
        });
    }

    document.getElementById('analyzeRealSpeech')?.addEventListener('click', async () => {
        if (!recordedBlob) {
            alert('Сначала запишите аудиоклип.');
            return;
        }
        const recognized = (recognizedTextDiv.innerText || '').trim();
        if (!recognized) {
            alert('Нет распознанного текста. Запишите речь или введите текст вручную.');
            return;
        }
        await analyzeRealSpeech(recordedBlob, recognized.trim(), currentLanguage);
        if (document.getElementById('saveResult')) {
            document.getElementById('saveResult').disabled = false;
        }
    });

    saveBtn.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) { showNotification('Войдите, чтобы сохранить результат', 'warning'); return; }
        await db.collection('diagnostics').doc(user.uid).set({
            text: finalTranscript,
            language: currentLanguage,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await db.collection('users').doc(user.uid).set({
            lastDiagnostic: finalTranscript.substring(0, 100),
            lastDiagnosticDate: new Date().toISOString(),
            diagnosticCount: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });
        await awardXp(user, 25, 'диагностика');
        saveBtn.textContent = 'Сохранено!';
        saveBtn.disabled = true;
        showNotification('Результат сохранён (+25 XP)', 'success');
        setTimeout(() => { saveBtn.textContent = 'Сохранить результат'; saveBtn.disabled = false; }, 3000);
    });

    if (recognitionSupported) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let manualStop = false;

        recognition.onresult = (event) => {
            let interim = '';
            let newFinal = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript;
                if (event.results[i].isFinal) newFinal += t + ' ';
                else interim += t;
            }
            if (newFinal) finalTranscript += newFinal;
            if (interim) recognizedTextDiv.innerHTML = `<em>${interim}</em>`;
            if (finalTranscript) {
                recognizedTextDiv.innerHTML = finalTranscript;
            }
        };

        recognition.onerror = (event) => {
            if (event.error !== 'no-speech' && statusDiv) statusDiv.innerHTML = `Ошибка: ${event.error}`;
        };

        recognition.onend = () => {
            if (mediaRecorder && mediaRecorder.state === 'recording' && !manualStop) {
                recognition.start();
            }
            manualStop = false;
        };

        stopBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            if (recognition) {
                manualStop = true;
                recognition.stop();
            }
            startBtn.disabled = false;
            stopBtn.disabled = true;
            if (finalTranscript) saveBtn.disabled = false;
        });
    }
}

function renderCategories(filter = '') {
    const container = document.getElementById('exerciseCategories');
    if (!container) return;
    container.innerHTML = '';
    const q = filter.toLowerCase().trim();
    let count = 0;

    for (const [category, data] of Object.entries(exercisesDB)) {
        const match = !q || category.toLowerCase().includes(q) ||
            data.description.toLowerCase().includes(q) ||
            data.exercises.some(ex => ex.name.toLowerCase().includes(q));
        if (!match) continue;
        count++;
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4 mb-4';
        col.innerHTML = `
            <div class="card exercise-category-card h-100 sp-card" onclick="showCategory('${category.replace(/'/g, "\\'")}')">
                <div class="card-header-bar" style="background:${data.color || '#6366f1'}"></div>
                <div class="card-body">
                    <div class="d-flex align-items-start gap-3">
                        <div>
                            <h5 class="card-title fw-bold mb-1">${category}</h5>
                            <span class="badge bg-light text-dark mb-2">${data.level || ''}</span>
                            <p class="card-text text-muted small mb-2">${data.description}</p>
                            <span class="badge rounded-pill" style="background:${data.color || '#6366f1'};color:#fff">${data.exercises.length} упражнений</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(col);
    }

    if (count === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted py-5">Ничего не найдено. Попробуйте другой запрос.</div>';
    }
}

function showCategory(category) {
    const data = exercisesDB[category];
    if (!data) return;
    document.getElementById('exerciseCategories')?.classList.add('d-none');
    document.getElementById('exerciseSearchWrap')?.classList.add('d-none');
    document.getElementById('exerciseDetail')?.classList.remove('d-none');
    const content = document.getElementById('exerciseContent');
    if (!content) return;

    content.innerHTML = `
        <div class="d-flex align-items-center gap-3 mb-3">
            <span style="font-size:2.5rem">${data.icon || ''}</span>
            <div>
                <h3 class="sp-page-title mb-0">${category}</h3>
                <p class="text-muted mb-0">${data.description}</p>
            </div>
        </div>
        <div class="row">
            ${data.exercises.map(ex => `
                <div class="col-md-6 mb-3">
                    <div class="card exercise-item-card sp-card h-100">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <strong>${ex.name}</strong>
                            </div>
                            ${ex.duration ? `<small class="text-muted">⏱ ${ex.duration}</small>` : ''}
                            ${ex.tip ? `<div class="alert alert-light py-2 px-3 mt-2 mb-2 small"><strong></strong> ${ex.tip}</div>` : ''}
                            <ol class="mb-3 ps-3">${ex.steps.map(s => `<li class="mb-1">${s}</li>`).join('')}</ol>
                            <button class="btn btn-sp-primary btn-sm"
                                onclick="markDone('${category.replace(/'/g, "\\'")}', '${ex.name.replace(/'/g, "\\'")}', this)">✓ Выполнено</button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function backToCategories() {
    document.getElementById('exerciseCategories')?.classList.remove('d-none');
    document.getElementById('exerciseSearchWrap')?.classList.remove('d-none');
    document.getElementById('exerciseDetail')?.classList.add('d-none');
}

async function markDone(category, exerciseName, btn) {
    btn.disabled = true;
    btn.textContent = ' Готово!';
    btn.classList.replace('btn-sp-primary', 'btn-secondary');
    const user = auth.currentUser;
    if (user) {
        await db.collection('users').doc(user.uid).set({
            exercises: { [category]: firebase.firestore.FieldValue.increment(1) },
            lastExercise: { category, name: exerciseName, date: new Date().toISOString() }
        }, { merge: true });
        await awardXp(user, 10, exerciseName);
    } else {
        showNotification('Войдите, чтобы сохранить прогресс', 'warning');
    }
}

async function loadHomePage(user) {
    const quoteEl = document.getElementById('dailyQuote');
    if (quoteEl) {
        const idx = new Date().getDate() % MOTIVATION_QUOTES.length;
        const q = MOTIVATION_QUOTES[idx];
        quoteEl.innerHTML = `<p class="motivation-quote mb-1">«${q.text}»</p><small class="text-muted">— ${q.author}</small>`;
    }

    const streakEl = document.getElementById('homeStreak');
    const xpEl = document.getElementById('homeXp');
    const goalEl = document.getElementById('homeDailyGoal');

    if (!user) {
        if (streakEl) streakEl.innerHTML = '<p class="text-muted">Войдите, чтобы видеть серию и XP</p>';
        return;
    }

    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.data() || {};
    const xpInfo = xpForNextLevel(data.xp || 0);

    if (streakEl) {
        streakEl.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <span class="streak-flame">${(data.streak || 0) > 0 ? '' : ''}</span>
                <div>
                    <div class="fw-bold fs-4">${data.streak || 0} ${daysWord(data.streak || 0)}</div>
                    <small class="text-muted">серия без перерыва</small>
                </div>
            </div>
        `;
    }
    if (xpEl) {
        xpEl.innerHTML = `
            <div class="mb-2"><span class="level-badge">Уровень ${xpInfo.level}</span> <span class="text-muted ms-2">${data.xp || 0} XP</span></div>
            <div class="xp-bar"><div class="xp-bar-fill" style="width:${xpInfo.percent}%"></div></div>
            <small class="text-muted mt-1 d-block">До следующего уровня: ${xpInfo.needed - xpInfo.current} XP</small>
        `;
    }
    if (goalEl) {
        const mins = data.dailyGoalMinutes || 10;
        const done = data.lastPracticeDate === todayKey();
        goalEl.innerHTML = `
            <p class="mb-2">Цель на сегодня: <strong>${mins} минут</strong> практики</p>
            <div class="progress" style="height:8px">
                <div class="progress-bar" style="width:${done ? 100 : 30}%;background:var(--sp-primary)"></div>
            </div>
            <small class="text-muted">${done ? ' Сегодня вы уже занимались!' : 'Начните с одного упражнения →'}</small>
        `;
    }
}

function daysWord(n) {
    const m = n % 10, h = n % 100;
    if (h >= 11 && h <= 14) return 'дней';
    if (m === 1) return 'день';
    if (m >= 2 && m <= 4) return 'дня';
    return 'дней';
}

async function loadProfile(user) {
    const root = document.getElementById('profileRoot');
    if (!root) return;

    if (!user) {
        root.innerHTML = `
            <div class="text-center py-5">
                <p class="text-muted">Войдите, чтобы открыть личный профиль</p>
                <a href="login.html" class="btn btn-sp-primary">Войти</a>
            </div>
        `;
        return;
    }

    const userDoc = await db.collection('users').doc(user.uid).get();
    const diagDoc = await db.collection('diagnostics').doc(user.uid).get();
    const data = userDoc.data() || {};
    const diagData = diagDoc.data() || {};
    const xpInfo = xpForNextLevel(data.xp || 0);
    const totalEx = totalExercises(data);
    const initials = (data.displayName || user.email).slice(0, 2).toUpperCase();

    root.innerHTML = `
        <div class="row mb-4">
            <div class="col-lg-8">
                <div class="sp-card p-4">
                    <div class="d-flex flex-wrap align-items-center gap-4">
                        <div class="profile-avatar">${initials}</div>
                        <div class="flex-grow-1">
                            <h2 class="sp-page-title mb-1" id="profileDisplayName">${data.displayName || 'Пользователь'}</h2>
                            <p class="text-muted mb-2">${user.email}</p>
                            <span class="level-badge">Уровень ${xpInfo.level}</span>
                            <span class="ms-2 text-muted">${data.xp || 0} XP</span>
                            <div class="xp-bar mt-3" style="max-width:320px">
                                <div class="xp-bar-fill" style="width:${xpInfo.percent}%"></div>
                            </div>
                            <small class="text-muted">${xpInfo.needed - xpInfo.current} XP до уровня ${xpInfo.level + 1}</small>
                        </div>
                        <div class="text-center">
                            <div class="streak-flame">${(data.streak || 0) > 0 ? '' : ''}</div>
                            <div class="fw-bold fs-3">${data.streak || 0}</div>
                            <small class="text-muted">дней подряд</small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mt-3 mt-lg-0">
                <div class="row g-2">
                    <div class="col-6"><div class="sp-card sp-stat"><div class="sp-stat-value">${data.diagnosticCount || 0}</div><div class="sp-stat-label">Диагностик</div></div></div>
                    <div class="col-6"><div class="sp-card sp-stat"><div class="sp-stat-value">${totalEx}</div><div class="sp-stat-label">Упражнений</div></div></div>
                    <div class="col-6"><div class="sp-card sp-stat"><div class="sp-stat-value">${(data.achievements || []).length}</div><div class="sp-stat-label">Наград</div></div></div>
                    <div class="col-6"><div class="sp-card sp-stat"><div class="sp-stat-value">${data.dailyGoalMinutes || 10}</div><div class="sp-stat-label">Мин/день</div></div></div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-lg-6 mb-3">
                <div class="sp-card p-4 h-100">
                    <h5 class="fw-bold mb-3"> Настройки профиля</h5>
                    <form id="profileForm">
                        <div class="mb-3">
                            <label class="form-label">Имя</label>
                            <input type="text" class="form-control" id="profileName" value="${data.displayName || ''}" maxlength="40">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Цели</label>
                            <input type="text" class="form-control" id="profileGoals" value="${(data.goals || []).join(', ')}">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Цель: минут в день</label>
                            <input type="number" class="form-control" id="profileDailyGoal" min="5" max="120" value="${data.dailyGoalMinutes || 10}">
                        </div>
                        <button type="submit" class="btn btn-sp-primary">Сохранить профиль</button>
                    </form>
                </div>
            </div>
            <div class="col-lg-6 mb-3">
                <div class="sp-card p-4 h-100">
                    <h5 class="fw-bold mb-3"> Достижения</h5>
                    <div class="row g-2" id="achievementsGrid"></div>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-md-6 mb-3">
                <div class="sp-card p-4">
                    <h5 class="fw-bold mb-3"> Последняя диагностика</h5>
                    <p class="small text-muted mb-2">${data.lastDiagnosticDate ? new Date(data.lastDiagnosticDate).toLocaleString('ru') : 'Ещё не проходили'}</p>
                    <p id="lastDiagnosticText">${diagData.text || '—'}</p>
                    <a href="diagnostic.html" class="btn btn-sp-outline btn-sm mt-2">Пройти снова</a>
                </div>
            </div>
        </div>
    `;

    const unlocked = data.achievements || ['registered'];
    const achGrid = document.getElementById('achievementsGrid');
    if (achGrid) {
        achGrid.innerHTML = ACHIEVEMENTS_DEF.map(a => {
            const isUnlocked = unlocked.includes(a.id) || (a.need && a.need(data));
            return `
                <div class="col-4 col-md-3">
                    <div class="achievement-badge ${isUnlocked ? 'unlocked' : 'locked'}">
                        <span class="ach-icon">${a.icon}</span>
                        <span class="ach-title">${a.title}</span>
                        <small class="text-muted" style="font-size:0.65rem">${a.desc}</small>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = document.getElementById('profileName').value.trim();
        const goals = document.getElementById('profileGoals').value.split(',').map(s => s.trim()).filter(Boolean);
        const dailyGoalMinutes = parseInt(document.getElementById('profileDailyGoal').value, 10) || 10;
        await db.collection('users').doc(user.uid).set({ displayName, goals, dailyGoalMinutes }, { merge: true });
        document.getElementById('profileDisplayName').textContent = displayName;
        showNotification('Профиль сохранён', 'success');
    });
}

async function loadProgress(user) {
    if (document.getElementById('profileRoot')) return;
    const totalStats = document.getElementById('totalStats');
    if (!totalStats) return;
    if (!user) {
        totalStats.innerHTML = '<a href="login.html">Войдите</a>, чтобы увидеть прогресс.';
        return;
    }
    try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        const data = userDoc.data() || {};
        totalStats.innerHTML = `
            <div>Уровень: <strong>${getLevel(data.xp || 0)}</strong> (${data.xp || 0} XP)</div>
            <div>Диагностик: <strong>${data.diagnosticCount || 0}</strong></div>
            <div>Упражнений: <strong>${totalExercises(data)}</strong></div>
            <div>Серия: <strong>${data.streak || 0} дн.</strong></div>
        `;
    } catch (e) {
        totalStats.innerHTML = 'Ошибка загрузки данных.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setActiveNavLink();
    if (document.getElementById('exerciseCategories')) {
        renderCategories();
        const search = document.getElementById('exerciseSearch');
        if (search) {
            search.addEventListener('input', () => renderCategories(search.value));
        }
    }
});