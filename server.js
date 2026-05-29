/**
 * Сервер анализа произношения
 *
 * Vosk  — распознавание речи (что сказал пользователь)
 * MFA   — forced alignment эталонного текста (фонемы + тайминги)
 * Словарь — эталонные фонемы для оценки
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { analyzePronunciation } = require('./pronunciation/analyze');
const { checkMfaInstalled, getMfaStatus } = require('./pronunciation/mfa-runner');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const USE_VOSK = process.env.USE_VOSK !== 'false';
const VOSK_MODELS = {
    ru: path.join(__dirname, 'models', 'vosk-model-ru-0.42'),
    en: path.join(__dirname, 'models', 'vosk-model-en-us-0.42')
};

let voskModels = null;

function initVosk() {
    if (!USE_VOSK) return;
    try {
        const vosk = require('vosk');
        vosk.setLogLevel(-1);
        voskModels = {};
        for (const [lang, modelPath] of Object.entries(VOSK_MODELS)) {
            if (fs.existsSync(modelPath)) {
                voskModels[lang] = new vosk.Model(modelPath);
                console.log(`✓ Vosk ${lang}: ${modelPath}`);
            } else {
                console.warn(`✗ Модель Vosk не найдена: ${modelPath}`);
            }
        }
    } catch (err) {
        console.warn('Vosk недоступен:', err.message);
        voskModels = null;
    }
}

initVosk();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/api/health', async (req, res) => {
    const mfa = await checkMfaInstalled();
    res.json({
        ok: true,
        vosk: !!(voskModels && Object.keys(voskModels).length),
        voskLanguages: voskModels ? Object.keys(voskModels) : [],
        mfa: mfa.installed,
        mfaVersion: mfa.version,
        mfaModels: getMfaStatus(),
        ffmpeg: await checkFfmpeg()
    });
});

async function checkFfmpeg() {
    return new Promise(resolve => {
        const p = spawn('ffmpeg', ['-version']);
        p.on('error', () => resolve(false);
        p.on('close', code => resolve(code === 0));
    });
}

app.post('/api/pronunciation', upload.single('audio'), async (req, res) => {
    const language = req.body.language === 'ru' ? 'ru' : 'en';
    const referenceText = (req.body.referenceText || '').trim();

    if (!req.file?.buffer?.length) {
        return res.status(400).json({ success: false, error: 'Аудиофайл не получен' });
    }
    if (!referenceText) {
        return res.status(400).json({ success: false, error: 'Укажите эталонный текст (referenceText)' });
    }

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const wavPath = path.join(tempDir, `rec_${Date.now()}.wav`);

    try {
        const pcmBuffer = await convertToPCM(req.file.buffer);
        await pcmToWav(pcmBuffer, wavPath);

        let recognizedText = '';
        let voskWords = [];

        if (voskModels?.[language] || voskModels?.en) {
            const vosk = require('vosk');
            const model = voskModels[language] || voskModels.en;
            const rec = new vosk.Recognizer({ model, sampleRate: 16000 });
            rec.setWords(true);

            const chunkSize = 8000;
            for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
                rec.acceptWaveform(pcmBuffer.slice(i, i + chunkSize));
            }
            const result = JSON.parse(rec.finalResult());
            rec.free();
            recognizedText = result.text || '';
            voskWords = result.result || [];
        } else {
            return res.status(503).json({
                success: false,
                error: 'Vosk не загружен. Проверьте папку models/ или установите USE_VOSK=false с другим ASR.'
            });
        }

        const analysis = await analyzePronunciation({
            referenceText,
            recognizedText,
            wavPath,
            language
        });

        if (!analysis.success) {
            return res.json(analysis);
        }

        res.json({
            ...analysis,
            voskWords
        });

    } catch (error) {
        console.error('Pronunciation error:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch { /* */ }
    }
});

function convertToPCM(audioBuffer) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        const chunks = [];
        ffmpeg.stdout.on('data', c => chunks.push(c));
        ffmpeg.stderr.on('data', () => {});
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error('FFmpeg: установите ffmpeg и добавьте в PATH'));
        });
        ffmpeg.stdin.write(audioBuffer);
        ffmpeg.stdin.end();
    });
}

function pcmToWav(pcmBuffer, outputPath) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    fs.writeFileSync(outputPath, Buffer.concat([header, pcmBuffer]));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    const mfa = await checkMfaInstalled();
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  SpeechPlatform — анализ произношения`);
    console.log(`  http://localhost:${PORT}`);
    console.log('───────────────────────────────────────────');
    console.log(`  Vosk (распознавание): ${voskModels ? '✓' : '✗'}`);
    console.log(`  MFA  (фонемы):        ${mfa.installed ? '✓ ' + mfa.version : '✗ не установлен'}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
});
