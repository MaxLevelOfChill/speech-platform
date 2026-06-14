/**
 * lexicon.js
 * Единый модуль транскрипции под формат Allosaurus IPA.
 */

// Карта перевода русских букв напрямую в международный IPA Allosaurus
const PHONEME_MAP_RU = {
    'ш': 'ʂ', 'с': 's', 'л': 'l', 'а': 'a',
    'п': 'p', 'о': 'o', 'е': 'e', 'и': 'i',
    'у': 'u', 'к': 'k', 'н': 'n', 'г': 'g', 'р': 'r',
    'в': 'v', 'д': 'd', 'т': 't', 'ы': 'ɨ', 'й': 'j', 'х': 'x',
    'м': 'm', 'з': 'z', 'б': 'b', 'ц': 'ts', 'ч': 'tʃ', 'ж': 'ʒ',
    'щ': 'ɕ', 'ф': 'f', 'ю': 'u', 'я': 'a', 'э': 'e'
};

// Карта перевода американского стандарта ARPABET в IPA Allosaurus
const PHONEME_MAP_EN = {
    'SH': 'ʃ', 'S': 's', 'L': 'l', 'AE': 'æ', 'IH': 'ɪ',
    'P': 'p', 'OW': 'oʊ', 'AA': 'ɑː', 'B': 'b', 'G': 'ɡ',
    'R': 'r', 'V': 'v', 'D': 'd', 'T': 't', 'M': 'm', 'Z': 'z', 'K': 'k',
    'CH': 'tʃ', 'TH': 'θ', 'DH': 'ð', 'NG': 'ŋ', 'HH': 'h', 'Y': 'j',
    'W': 'w', 'F': 'f', 'ZH': 'ʒ', 'N': 'n', 'EH': 'ɛ', 'AH': 'ə', 'AO': 'ɔ',
    'AY': 'aɪ', 'ER': 'ər', 'EY': 'eɪ', 'IY': 'i', 'UH': 'ʊ', 'UW': 'u'
};

function normalizeWord(word, lang) {
    if (!word) return '';
    return word.toLowerCase().replace(/[^a-zа-яё'-]/gi, '');
}

function convertToAllosaurusPhones(phones, lang) {
    const map = lang === 'en' ? PHONEME_MAP_EN : PHONEME_MAP_RU;
    return phones.map(p => {
        const cleanP = p.toUpperCase().replace(/[0-2]/g, ''); 
        if (lang === 'en') {
            return map[cleanP] || p.toLowerCase(); 
        } else {
            return map[p] || p;
        }
    });
}

/**
 * Динамическая генерация IPA для русского языка (учитывает аканье и оглушение)
 */
function generateRussianDynamicIPA(word) {
    word = word.toLowerCase().replace(/ё/g, 'е');
    const vowels = new Set(['а','о','у','ы','э','я','е','ю','и']);
    const softeningVowels = new Set(['я','е','ё','ю','и','ь']);
    const alwaysHard = new Set(['ж','ш','ц']);
    const devoicingMap = {б:'п', в:'ф', г:'к', д:'т', ж:'ш', з:'с'};

    const letters = word.split('');
    const phones = [];

    for (let i = 0; i < letters.length; i++) {
        let ch = letters[i];
        let next = letters[i+1] || '';
        
        // 1. Редукция гласных (упрощённая)
        if (vowels.has(ch)) {
            if (ch === 'о') ch = 'a';
            else if (ch === 'е') ch = 'i';
            else if (ch === 'я') ch = 'i';
            // 'ы', 'у', 'а', 'и' остаются как есть
        }
        
        // 2. Оглушение конечного согласного
        if (i === letters.length-1 && devoicingMap[ch]) {
            ch = devoicingMap[ch];
        }
        
        // 3. Конвертация буквы в IPA (без мягкости)
        let ipa = convertToAllosaurusPhones([ch], 'ru')[0];
        if (!ipa) ipa = ch; // fallback
        
        // 4. Палатализация (мягкость)
        const isConsonant = !vowels.has(ch) && ch !== 'ь' && ch !== 'ъ';
        if (isConsonant && !alwaysHard.has(ch) && softeningVowels.has(next)) {
            phones.push(ipa + 'ʲ');   // добавляем мягкость как суффикс
        } else {
            phones.push(ipa);
        }
    }
    
    return phones;
}

/**
 * Английский посимвольный фоллбэк
 */
function graphemeToArpabetFallback(word) {
    const map = {
        th: 'TH', sh: 'SH', ch: 'CH', ng: 'NG', ph: 'F', ee: 'IY', ea: 'IY', oo: 'UW',
        a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH',
        b: 'B', c: 'K', d: 'D', f: 'F', g: 'G', h: 'HH',
        j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P',
        q: 'K', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W',
        x: 'K S', y: 'Y', z: 'Z'
    };
    const result = [];
    let i = 0;
    while (i < word.length) {
        const dig = word.slice(i, i + 2);
        if (map[dig]) {
            result.push(...map[dig].split(' '));
            i += 2;
            continue;
        }
        const ch = word[i];
        if (map[ch]) result.push(...map[ch].split(' '));
        i++;
    }
    return result;
}

function wordToPhones(word, lang) {
    const w = normalizeWord(word, lang);
    if (!w) return [];
    
    if (lang === 'en') {
        const arpabetPhones = graphemeToArpabetFallback(w);
        return convertToAllosaurusPhones(arpabetPhones, lang);
    } else {
        return generateRussianDynamicIPA(w);
    }
}

module.exports = {
    wordToPhones,
    normalizeWord
};