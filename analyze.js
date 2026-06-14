/**
 * analyze.js – анализ произношения
 * - Allosaurus: реальные фонемы из записи
 * - Omogre (ru) + словарь (en/fallback): эталонные фонемы
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { alignWords } = require('./align-words');
const { recognizePhones } = require('./allosaurus-runner');
const { wordToPhones, normalizeWord } = require('./lexicon');

// Путь к скрипту Omogre (лежит в корне проекта)
const OMOGRE_SCRIPT = path.join(__dirname, '..', 'omogre_transcribe.py');

// ---------------------------------------------------------------------
// Вызов Omogre для получения IPA
// ---------------------------------------------------------------------
async function getIpaFromOmogre(text) {
    return new Promise((resolve) => {
        if (!fs.existsSync(OMOGRE_SCRIPT)) {
            console.error(`[Omogre] Скрипт не найден: ${OMOGRE_SCRIPT}`);
            resolve(null);
            return;
        }

        const pythonCmd = 'python';
        const args = [OMOGRE_SCRIPT, text];
        console.log(`[Omogre] execFile: ${pythonCmd} ${args.join(' ')}`);
        
        execFile(pythonCmd, args, {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1' }
        }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Omogre] execFile error: ${error.message}`);
                resolve(null);
                return;
            }
            if (stderr) {
                console.error(`[Omogre] stderr: ${stderr}`);
            }
            console.log(`[Omogre] stdout: ${stdout}`);
            try {
                const result = JSON.parse(stdout);
                resolve(result.ipa || null);
            } catch (e) {
                console.error(`[Omogre] JSON parse error: ${e.message}`);
                resolve(null);
            }
        });
    });
}

// ---------------------------------------------------------------------
// Эталонные фонемы: для русского – Omogre, иначе словарь
// ---------------------------------------------------------------------
async function buildExpectedPhones(text, language) {
    if (language !== 'ru') {
        console.log('[buildExpectedPhones] Non-Russian, using dictionary');
        return buildExpectedPhonesFromDict(text, language);
    }

    console.log(`[Omogre] Request for: "${text}"`);
    const ipaFull = await getIpaFromOmogre(text);
    if (!ipaFull) {
        console.warn('[Omogre] No IPA, fallback to dictionary');
        return buildExpectedPhonesFromDict(text, language);
    }

    // Убираем знаки ударения и долготы
    const cleanIpa = ipaFull.replace(/[ˈˌ`ː]/g, '');
    console.log('[Omogre] Cleaned IPA:', cleanIpa);

    const re = /[а-яё]+/gi;
    const words = (text.match(re) || []).map(w => w.toLowerCase());
    if (words.length === 0) return [];

    const ipaParts = cleanIpa.split(/\s+/).filter(p => p.length > 0);
    if (ipaParts.length !== words.length) {
        console.warn(`[Omogre] Word count mismatch: ${ipaParts.length} vs ${words.length}, fallback`);
        return buildExpectedPhonesFromDict(text, language);
    }

    const result = [];
    for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi];
        const wordIpa = ipaParts[wi];
        const phones = wordIpa ? wordIpa.split('') : [];
        phones.forEach((p, pi) => {
            result.push({ phoneme: p, word, wordIndex: wi, phoneIndex: pi });
        });
    }
    console.log('[Omogre] Generated expected phones:', result.map(r => r.phoneme).join(''));
    return result;
}

// Старый словарный метод (синхронный) – используется как fallback
function buildExpectedPhonesFromDict(text, language) {
    const re = language === 'en' ? /[a-z']+/gi : /[а-яё]+/gi;
    const tokens = (text.match(re) || []).map(w => normalizeWord(w, language)).filter(Boolean);
    const result = [];
    tokens.forEach((word, wi) => {
        const phones = wordToPhones(word, language);
        phones.forEach((p, pi) => {
            result.push({ phoneme: p, word, wordIndex: wi, phoneIndex: pi });
        });
    });
    return result;
}

// ---------------------------------------------------------------------
// Построение wordTranscription (правильная версия, с expectedMap)
// ---------------------------------------------------------------------
function buildWordTranscription(wordAlignment, allosaurusPhones, expectedPhonesFlat, phoneAlignment, lang) {
    // Строим карту: слово → его ожидаемые фонемы (из expectedPhonesFlat)
    const expectedMap = new Map(); // key: wordIndex, value: массив фонем
    for (const ep of expectedPhonesFlat) {
        if (ep.wordIndex !== undefined && ep.phoneme !== ' ') {
            if (!expectedMap.has(ep.wordIndex)) expectedMap.set(ep.wordIndex, []);
            expectedMap.get(ep.wordIndex).push(ep.phoneme);
        }
    }

    const opsByWord = phoneAlignment ? groupAlignmentOpsByWord(phoneAlignment.ops, expectedPhonesFlat) : null;
    const words = [];

    for (const op of wordAlignment.operations) {
        if (op.type === 'correct' || op.type === 'substitution') {
            const expectedPhones = expectedMap.get(op.refIndex) || [];
            let phoneComparison = [];

            if (opsByWord && opsByWord[op.refIndex]) {
                phoneComparison = opsByWord[op.refIndex].map(o => ({
                    expected: o.expected || '—',
                    actual:   o.actual   || '—',
                    correct:  o.ok,
                }));
                // Если не хватает, дополняем ожидаемыми
                if (phoneComparison.length < expectedPhones.length) {
                    for (let i = phoneComparison.length; i < expectedPhones.length; i++) {
                        phoneComparison.push({ expected: expectedPhones[i], actual: '—', correct: false });
                    }
                }
            } else {
                // Нет выравнивания – показываем только ожидаемые (серые)
                phoneComparison = expectedPhones.map(p => ({ expected: p, actual: '?', correct: false }));
            }

            const actualPhones = phoneComparison.filter(p => p.actual !== '—' && p.actual !== '?').map(p => p.actual);
            const allOk = phoneComparison.length > 0 && phoneComparison.every(p => p.correct);

            words.push({
                type: op.type,
                reference: op.reference,
                heard: op.hypothesis,
                expectedPhones,
                actualPhones,
                phoneComparison,
                wordCorrect: op.type === 'correct' && allOk,
                displayExpected: expectedPhones.join(' '),
                displayActual: actualPhones.join(' ') || '—'
            });
        } else if (op.type === 'deletion') {
            const expectedPhones = expectedMap.get(op.refIndex) || [];
            words.push({
                type: 'deletion',
                reference: op.reference,
                heard: null,
                expectedPhones,
                actualPhones: [],
                phoneComparison: expectedPhones.map(p => ({ expected: p, actual: '—', correct: false })),
                wordCorrect: false,
                displayExpected: expectedPhones.join(' '),
                displayActual: '—'
            });
        } else if (op.type === 'insertion') {
            words.push({
                type: 'insertion',
                reference: null,
                heard: op.hypothesis,
                expectedPhones: [],
                actualPhones: [],
                phoneComparison: [],
                wordCorrect: false,
                displayExpected: '—',
                displayActual: '—'
            });
        }
    }
    return words;
}

// ---------------------------------------------------------------------
// Выравнивание фонем (только одна версия)
// ---------------------------------------------------------------------
function alignPhoneSequences(expected, actual) {
    const exp = expected.map(e => normalizeIPA(e.phoneme || e));
    const act = actual.map(a => normalizeIPA(a));
    const n = exp.length, m = act.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    const bt = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const match = phonesMatch(exp[i - 1], act[j - 1]);
            const sub = dp[i - 1][j - 1] + (match ? 0 : 1);
            const del = dp[i - 1][j] + 1;
            const ins = dp[i][j - 1] + 1;
            const min = Math.min(sub, del, ins);
            dp[i][j] = min;
            if (min === sub) bt[i][j] = match ? 'match' : 'sub';
            else if (min === del) bt[i][j] = 'del';
            else bt[i][j] = 'ins';
        }
    }
    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && (bt[i][j] === 'match' || bt[i][j] === 'sub')) {
            ops.unshift({ type: bt[i][j], expected: exp[i - 1], actual: act[j - 1], ok: bt[i][j] === 'match', expMeta: expected[i - 1] });
            i--; j--;
        } else if (i > 0 && (j === 0 || bt[i][j] === 'del')) {
            ops.unshift({ type: 'del', expected: exp[i - 1], actual: null, ok: false, expMeta: expected[i - 1] });
            i--;
        } else {
            ops.unshift({ type: 'ins', expected: null, actual: act[j - 1], ok: false });
            j--;
        }
    }
    const correct = ops.filter(o => o.ok).length;
    const accuracy = expected.length > 0 ? Math.round((correct / expected.length) * 100) : 0;
    return { ops, accuracy, correct, total: expected.length };
}

function groupAlignmentOpsByWord(ops, expectedPhonesFlat) {
    const posToWord = {};
    let pos = 0;
    for (const ep of expectedPhonesFlat) posToWord[pos++] = ep.wordIndex;
    const byWord = {};
    let expPos = 0;
    for (const op of ops) {
        const wi = op.expMeta?.wordIndex ?? posToWord[expPos] ?? 0;
        if (!byWord[wi]) byWord[wi] = [];
        byWord[wi].push(op);
        if (op.type !== 'ins') expPos++;
    }
    return byWord;
}

function normalizeIPA(phone) {
    if (!phone) return '';
    // Приводим к нормальной форме NFD (символ + диакритика разделены)
    let norm = phone.toLowerCase().normalize('NFD');
    // Удаляем все символы из диапазона комбинируемых диакритик (U+0300–U+036F)
    norm = norm.replace(/[\u0300-\u036f]/g, '');
    // Также удаляем явно указанные символы
    norm = norm.replace(/[ˈˌ̪̝̞]/g, '');
    return norm.trim();
}

const SIMILAR_GROUPS = [
    new Set(['r', 'ɾ', 'ɹ', 'ɻ']), new Set(['r', 'rʲ']), new Set(['l', 'lʲ', 'ɫ']),
    new Set(['s', 'sʲ']), new Set(['z', 'zʲ']),
    new Set(['t', 't̪', 'tʲ']), new Set(['d', 'd̪', 'dʲ']), new Set(['n', 'nʲ']),
    new Set(['p', 'pʲ']), new Set(['b', 'bʲ']), new Set(['m', 'mʲ']), new Set(['v', 'vʲ']), new Set(['f', 'fʲ']),
    new Set(['k', 'kʲ']), new Set(['g', 'gʲ']), new Set(['x', 'xʲ']),
    new Set(['ʃ', 'ɕ', 'ʂ']), new Set(['ʒ', 'ʑ']),
    new Set(['a', 'ɑ', 'ä', 'ɐ', 'ə']), new Set(['e', 'ɛ']), new Set(['i', 'ɪ']), new Set(['o', 'ɔ']), new Set(['u', 'ʊ']), new Set(['ɨ']), new Set(['j']),
];
const PHONEME_TO_CATEGORY = {
    // Русские звуки
    'r': 'Звук Р', 'rʲ': 'Звук Р',
    'l': 'Звук Л', 'lʲ': 'Звук Л',
    's': 'Свистящие (С, З, Ц)', 'sʲ': 'Свистящие (С, З, Ц)',
    'z': 'Свистящие (С, З, Ц)', 'zʲ': 'Свистящие (С, З, Ц)',
    'ʂ': 'Шипящие (Ш, Ж, Ч, Щ)', 'ɕ': 'Шипящие (Ш, Ж, Ч, Щ)',
    'ʒ': 'Шипящие (Ш, Ж, Ч, Щ)', 'tʃ': 'Шипящие (Ш, Ж, Ч, Щ)',
    'θ': 'English — TH sounds', 'ð': 'English — TH sounds',
    'ɹ': 'English — R & L', 'l': 'English — R & L', 
    'æ': 'English — Vowels', 'ɪ': 'English — Vowels', 'ʊ': 'English — Vowels',
    'e': 'Дикция и скороговорки (RU)', 'ɛ': 'Дикция и скоговорки (RU)',
    'o': 'Дикция и скороговорки (RU)', 'ɔ': 'Дикция и скороговорки (RU)',
    'a': 'Дикция и скороговорки (RU)', 'ɐ': 'Дикция и скороговорки (RU)',
    'ə': 'Дикция и скороговорки (RU)',
    // Добавьте другие по необходимости
};

function phonesMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    for (const g of SIMILAR_GROUPS) if (g.has(a) && g.has(b)) return true;
    return false;
}

function estimatePhonemeAccuracy(wordAlignment, lang) {
    let ok = 0, total = 0;
    for (const op of wordAlignment.operations) {
        if (op.type === 'correct') {
            const n = wordToPhones(op.reference, lang).length;
            ok += n; total += n;
        } else if (op.type === 'substitution') {
            total += wordToPhones(op.reference, lang).length;
        } else if (op.type === 'deletion') {
            total += wordToPhones(op.reference, lang).length;
        }
    }
    return total > 0 ? Math.round((ok / total) * 100) : 0;
}
function analyzeReliableErrors(phoneAlignment, expectedPhonesFlat) {
    if (!phoneAlignment || !phoneAlignment.ops) return [];

    const errorStats = {}; // { expectedPhoneme: { total, interGroup } }

    for (const op of phoneAlignment.ops) {
        if (!op.ok && op.actual && op.expected) {
            const expected = op.expected;
            const actual = op.actual;
            if (!errorStats[expected]) {
                errorStats[expected] = { total: 0, interGroup: 0 };
            }
            errorStats[expected].total++;
            // межгрупповая ошибка? (не совпадают и не в одной группе схожести)
            if (!phonesMatch(expected, actual)) {
                errorStats[expected].interGroup++;
            }
        }
    }

    // Частота встречаемости фонемы в эталонной транскрипции
    const expectedCount = {};
    for (const ep of expectedPhonesFlat) {
        const ph = ep.phoneme;
        expectedCount[ph] = (expectedCount[ph] || 0) + 1;
    }

    const reliableErrors = [];
    for (const [ph, stats] of Object.entries(errorStats)) {
        const occurrences = expectedCount[ph] || 0;
        if (occurrences < 2) continue; // редкий звук – не учитываем
        // Условие: >=2 серьёзных ошибок ИЛИ >=4 любых ошибок
        if (stats.interGroup >= 2 || stats.total >= 4) {
            reliableErrors.push(ph);
        }
    }
    return reliableErrors;
}

// Преобразование надёжных ошибок в категории упражнений
function getRecommendationCategories(reliablePhonemes, lang) {
    const categoriesSet = new Set();
    for (const ph of reliablePhonemes) {
        const cat = PHONEME_TO_CATEGORY[ph];
        if (cat) categoriesSet.add(cat);
    }
    if (categoriesSet.size === 0 && reliablePhonemes.length > 0) {
        categoriesSet.add('Артикуляционная гимнастика');
    }
    return Array.from(categoriesSet);
}

function buildWordHint(w) {
    if (w.type === 'deletion') return `Пропущено слово: «${w.reference}»`;
    if (w.type === 'insertion') return `Лишнее слово: «${w.heard}»`;
    const bad = (w.phoneComparison || []).filter(p => !p.correct && p.expected !== '—').map(p => `${p.expected}→${p.actual}`).slice(0,3).join(', ');
    return `«${w.reference}»: эталон [${w.displayExpected}] → в записи [${w.displayActual}]${bad ? ` (${bad})` : ''}`;
}

function buildFeedback(overall, phonemes, allosaurusOk, lang) {
    const tips = [];
    if (overall >= 85) tips.push('Отличное произношение! Продолжай в том же духе');
    else if (overall >= 70) tips.push('Хороший результат! Обрати внимание на выделенные красным звуки.');
    else if (overall >= 50) tips.push('Есть над чем поработать. Повтори фразу медленнее, следи за каждым звуком.');
    else tips.push('Много ошибок в звуках. Попробуй сначала по словам, потом всю фразу.');
    return tips;
}

// ---------------------------------------------------------------------
// Основная функция анализа
// ---------------------------------------------------------------------
async function analyzePronunciation({ referenceText, recognizedText, wavPath, language }) {
    const lang = language === 'ru' ? 'ru' : 'en';
    const ref  = (referenceText || '').trim();
    const hyp  = (recognizedText || '').trim();

    if (!ref) return { success: false, error: 'Не указан эталонный текст' };

    const safeHyp = ref; 
    const wordAlignment = alignWords(ref, safeHyp, lang);

    const allosaurusResult = await recognizePhones(wavPath, lang);
    const expectedPhones = await buildExpectedPhones(ref, lang);

    let phoneAlignment = null;
    if (allosaurusResult.success && allosaurusResult.phones.length > 0 && expectedPhones.length > 0) {
        phoneAlignment = alignPhoneSequences(expectedPhones, allosaurusResult.phones);
    }

    const wordTranscription = buildWordTranscription(
        wordAlignment,
        allosaurusResult.phones || [],
        expectedPhones,
        phoneAlignment,
        lang
    );

    const wordAccuracy    = wordAlignment.wordAccuracy;
    const phonemeAccuracy = phoneAlignment ? phoneAlignment.accuracy : estimatePhonemeAccuracy(wordAlignment, lang);
    const overallScore = phonemeAccuracy;

    let reliableErrorPhonemes = [];
    let recommendationCategories = [];
    if (phoneAlignment) {
        reliableErrorPhonemes = analyzeReliableErrors(phoneAlignment, expectedPhones);
        recommendationCategories = getRecommendationCategories(reliableErrorPhonemes, lang);
    }

    const problematicWords = wordTranscription.filter(w => !w.wordCorrect).map(w => ({
        type: w.type, expected: w.reference, heard: w.heard, hint: buildWordHint(w),
    }));

    return {
        success: true,
        recognizedText: hyp,
        referenceText:  ref,
        method: allosaurusResult.success ? 'allosaurus+omogre' : 'omogre-only',
        allosaurusUsed:  allosaurusResult.success,
        allosaurusPhones: allosaurusResult.phones || [],
        wordTranscription,
        transcriptionFromRecording: allosaurusResult.success
            ? (allosaurusResult.raw || allosaurusResult.phones.join(' '))
            : wordTranscription.filter(w => w.actualPhones?.length).map(w => w.displayActual).join(' | '),
        phoneAlignment,
        assessment: {
            overallScore, wordAccuracy, phonemeAccuracy,
            correctWords:  wordAlignment.correct,
            totalWords:    wordAlignment.reference.length,
            substitutions: wordAlignment.substitutions,
            deletions:     wordAlignment.deletions,
            insertions:    wordAlignment.insertions,
            problematicWords,
            feedback: buildFeedback(overallScore, phonemeAccuracy, allosaurusResult.success, lang),
        },
        recommendations: recommendationCategories,
    };
}

module.exports = { analyzePronunciation };