const { normalizeWord } = require('./lexicon');

function tokenize(text, lang) {
    const re = lang === 'en' ? /[a-z']+/gi : /[а-яё]+/gi;
    return (text.match(re) || []).map(w => normalizeWord(w, lang)).filter(Boolean);
}

/**
 * Выравнивание слов (алгоритм Вагнера–Фишера) для оценки произношения.
 */
function alignWords(reference, hypothesis, lang) {
    const ref = tokenize(reference, lang);
    const hyp = tokenize(hypothesis, lang);
    const n = ref.length;
    const m = hyp.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    const bt = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));

    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (ref[i - 1] === hyp[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
                bt[i][j] = 'match';
            } else {
                const sub = dp[i - 1][j - 1] + 1;
                const ins = dp[i][j - 1] + 1;
                const del = dp[i - 1][j] + 1;
                const min = Math.min(sub, ins, del);
                dp[i][j] = min;
                bt[i][j] = min === sub ? 'sub' : min === ins ? 'ins' : 'del';
            }
        }
    }

    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && bt[i][j] === 'match') {
            ops.unshift({ type: 'correct', reference: ref[i - 1], hypothesis: hyp[j - 1], refIndex: i - 1, hypIndex: j - 1 });
            i--; j--;
        } else if (i > 0 && j > 0 && bt[i][j] === 'sub') {
            ops.unshift({ type: 'substitution', reference: ref[i - 1], hypothesis: hyp[j - 1], refIndex: i - 1, hypIndex: j - 1 });
            i--; j--;
        } else if (j > 0 && (i === 0 || bt[i][j] === 'ins')) {
            ops.unshift({ type: 'insertion', reference: null, hypothesis: hyp[j - 1], hypIndex: j - 1 });
            j--;
        } else {
            ops.unshift({ type: 'deletion', reference: ref[i - 1], hypothesis: null, refIndex: i - 1 });
            i--;
        }
    }

    const correct = ops.filter(o => o.type === 'correct').length;
    const accuracy = ref.length > 0 ? Math.round((correct / ref.length) * 100) : 0;

    return {
        reference: ref,
        hypothesis: hyp,
        operations: ops,
        correct,
        substitutions: ops.filter(o => o.type === 'substitution').length,
        insertions: ops.filter(o => o.type === 'insertion').length,
        deletions: ops.filter(o => o.type === 'deletion').length,
        wordAccuracy: accuracy
    };
}

module.exports = { alignWords, tokenize };
