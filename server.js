const express = require('express');
const multer = require('multer');
const vosk = require('vosk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const app = express();

const upload = multer({ storage: multer.memoryStorage() });

const MODELS = {
    ru: path.join(__dirname, 'models', 'vosk-model-ru-0.42'),
    en: path.join(__dirname, 'models', 'vosk-model-en-us-0.42')
};

console.log('Загрузка моделей Vosk...');
const voskModels = {
    ru: new vosk.Model(MODELS.ru),
    en: new vosk.Model(MODELS.en)
};
console.log(' Модели загружены');

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.post('/api/pronunciation', upload.single('audio'), async (req, res) => {
    const { language, referenceText } = req.body;
    const audioBuffer = req.file.buffer;

    try {
        const pcmBuffer = await convertToPCM(audioBuffer);

        const model = voskModels[language] || voskModels.en;
        const rec = new vosk.Recognizer({ model, sampleRate: 16000 });
        rec.SetWords(true);

        const chunkSize = 8000;
        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
            const chunk = pcmBuffer.slice(i, i + chunkSize);
            rec.acceptWaveform(chunk);
        }

        const result = JSON.parse(rec.finalResult());
        rec.free();

        if (!result.text) {
            return res.json({ success: false, error: 'Речь не распознана' });
        }

        const aligned = await performForcedAlignment(pcmBuffer, result.result, language);
        const assessment = assessPronunciation(aligned, referenceText, language);

        res.json({
            success: true,
            recognizedText: result.text,
            words: aligned,
            assessment: assessment,
            phonemes: extractPhonemes(aligned)
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function convertToPCM(audioBuffer) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
            '-ar', '16000',
            '-ac', '1',
            '-f', 's16le',
            'pipe:1'
        ]);

        let pcmData = [];
        ffmpeg.stdout.on('data', chunk => pcmData.push(chunk));
        ffmpeg.stderr.on('data', () => {});
        ffmpeg.on('close', code => {
            if (code === 0) resolve(Buffer.concat(pcmData));
            else reject(new Error(`FFmpeg error: ${code}`));
        });

        ffmpeg.stdin.write(audioBuffer);
        ffmpeg.stdin.end();
    });
}

async function performForcedAlignment(pcmBuffer, words, language) {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempWav = path.join(tempDir, `temp_${Date.now()}.wav`);
    const tempTxt = path.join(tempDir, `temp_${Date.now()}.txt`);

    const text = words.map(w => w.word).join(' ');
    fs.writeFileSync(tempTxt, text);
    await pcmToWav(pcmBuffer, tempWav);

    return new Promise((resolve, reject) => {
        const mfa = spawn('mfa', [
            'align',
            '--single_speaker',
            '--clean',
            tempWav,
            tempTxt,
            language === 'ru' ? 'russian' : 'english_us_arpa',
            path.join(tempDir, 'output')
        ]);

        mfa.on('close', async (code) => {
            const outputFile = path.join(tempDir, 'output', path.basename(tempWav, '.wav') + '.TextGrid');
            if (fs.existsSync(outputFile)) {
                const textgrid = fs.readFileSync(outputFile, 'utf8');
                const phonemes = parseTextGrid(textgrid);
                fs.unlinkSync(tempWav);
                fs.unlinkSync(tempTxt);
                fs.unlinkSync(outputFile);
                resolve(phonemes);
            } else {
                reject(new Error('MFA alignment failed'));
            }
        });
    });
}

function pcmToWav(pcmBuffer, outputPath) {
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(16000, 24);
    wavHeader.writeUInt32LE(32000, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40);

    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
    fs.writeFileSync(outputPath, wavBuffer);
}

function parseTextGrid(textgrid) {
    const phonemes = [];
    const lines = textgrid.split('\n');
    let inPhonemeTier = false;
    let current = {};

    for (const line of lines) {
        if (line.includes('name = "phones"')) inPhonemeTier = true;
        if (!inPhonemeTier) continue;

        if (line.includes('intervals [')) current = {};
        if (line.includes('xmin =')) current.start = parseFloat(line.split('=')[1]);
        if (line.includes('xmax =')) current.end = parseFloat(line.split('=')[1]);
        if (line.includes('text =')) {
            current.phoneme = line.split('=')[1].trim().replace(/"/g, '');
            if (current.phoneme && current.phoneme !== '') {
                phonemes.push({ ...current });
            }
        }
    }
    return phonemes;
}

function assessPronunciation(actualPhonemes, referenceText, language) {
    const referencePhonemes = getReferencePhonemes(referenceText, language);
    let totalScore = 0;
    let phonemeCount = 0;
    const details = [];

    for (let i = 0; i < Math.min(actualPhonemes.length, referencePhonemes.length); i++) {
        const actual = actualPhonemes[i];
        const ref = referencePhonemes[i];
        const distance = phonemeDistance(actual.phoneme, ref.phoneme);
        const score = Math.max(0, 100 - distance * 20);
        details.push({
            phoneme: ref.phoneme,
            actual: actual.phoneme,
            score: score,
            start: actual.start,
            end: actual.end
        });
        totalScore += score;
        phonemeCount++;
    }
    return {
        overallScore: phonemeCount > 0 ? totalScore / phonemeCount : 0,
        details
    };
}

function phonemeDistance(p1, p2) {
    if (p1 === p2) return 0;
    const groups = {
        vowels: ['a','e','i','o','u','ə','ɐ','ɑ','ɔ','ɛ','ɪ','ʊ'],
        plosives: ['p','b','t','d','k','g'],
        fricatives: ['f','v','s','z','ʃ','ʒ','θ','ð'],
        sonorants: ['l','r','m','n','ŋ','w','j']
    };
    for (const g of Object.values(groups)) {
        if (g.includes(p1) && g.includes(p2)) return 1;
    }
    return 2;
}

function getReferencePhonemes(text, language) {
    const words = text.toLowerCase().split(' ');
    const phonemes = [];
    words.forEach((word, idx) => {
        for (let i = 0; i < word.length; i++) {
            phonemes.push({
                phoneme: word[i],
                start: idx * 0.5 + i * 0.1,
                end: idx * 0.5 + (i + 1) * 0.1
            });
        }
    });
    return phonemes;
}

function extractPhonemes(aligned) {
    return aligned.map(p => p.phoneme).join(' ');
}

const PORT = 3001;
app.listen(PORT, () => {
    console.log(` Воск идет по ${PORT}`);
});