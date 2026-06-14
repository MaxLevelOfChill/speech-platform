
// Сервер анализа произношения


const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');

const { analyzePronunciation } = require('./pronunciation/analyze');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

async function checkFfmpeg() {
    return new Promise(resolve => {
        const p = spawn('ffmpeg', ['-version']);
        p.on('error', () => resolve(false));
        p.on('close', code => resolve(code === 0));
    });
}

// CORS

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin',  '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// GET /api/health

app.get('/api/health', async (req, res) => {
    res.json({
        ok:         true,
        allosaurus: await checkAllosaurus(),
        ffmpeg:     await checkFfmpeg(),
    });
});

async function checkAllosaurus() {
    return new Promise(resolve => {
        const py  = 'C:\\Users\\Lenovo\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
        const p   = spawn(py, ['-c', 'import allosaurus; print("ok")'], {
            shell: process.platform === 'win32',
        });
        let out = '';
        p.stdout.on('data', d => { out += d.toString(); });
        p.on('error', () => resolve(false));
        p.on('close', () => resolve(out.trim() === 'ok'));
    });
}

// POST /api/pronunciation

app.post('/api/pronunciation', upload.single('audio'), async (req, res) => {
    // Сохраняем переменные для удаления файла в случае ошибок
    let wavPathToDelete = null;

    try {
        const { referenceText, recognizedText, language } = req.body;
        
        // Проверяем, пришел ли файл
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Аудиофайл не получен' });
        }

        // Переводим буфер в WAV-путь
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const wavPath = path.join(tempDir, `${Date.now()}.wav`);
        wavPathToDelete = wavPath;

        await pcmToWav(req.file.buffer, wavPath);

        console.log(`[Allosaurus] Анализ: lang=${language}, ref="${(referenceText||'').slice(0,40)}"`);
        
        // Вызываем функцию анализа
        const analysisResult = await analyzePronunciation({ 
            referenceText, 
            recognizedText, 
            wavPath, 
            language 
        });

        // удаление
        // if (fs.existsSync(wavPath)) {
        //     fs.unlinkSync(wavPath);
        // }

        // Отправляем ответ клиенту
        return res.json(analysisResult);

    } catch (error) {
        console.error('Ошибка в роуте /api/pronunciation:', error);

        // Если файл успел создаться, но всё сломалось — подчищаем диск
        if (wavPathToDelete && fs.existsSync(wavPathToDelete)) {
            try { fs.unlinkSync(wavPathToDelete); } catch (e) {}
        }

        // Проверяем, не отправил ли сервер заголовки ранее, чтобы избежать ERR_HTTP_HEADERS_SENT
        if (!res.headersSent) {
            return res.status(500).json({ 
                success: false, 
                error: `Ошибка сервера: ${error.message}` 
            });
        }
    }
});

// Утилиты аудио

function pcmToWav(audioBuffer, outputPath) {
    return new Promise((resolve, reject) => {
        // Цепочка аудиофильтров для улучшения качества
        const filterChain = 'loudnorm=I=-16:LRA=11:TP=-1.5,' +
                    'highpass=f=80,' +
                    'silenceremove=start_periods=1:stop_periods=-1:start_threshold=-50dB:stop_threshold=-50dB,';

        const ffmpeg = spawn('ffmpeg', [
            '-y',                // Перезаписывать выходной файл
            '-i', 'pipe:0',      // Входные данные из stdin
            '-af', filterChain,  // Применение фильтров
            '-ar', '16000',      // Частота дискретизации 16 кГц
            '-ac', '1',          // Моно
            '-c:a', 'pcm_s16le', // Кодек PCM 16-bit little-endian
            outputPath
        ], { shell: process.platform === 'win32' });

        ffmpeg.stdin.write(audioBuffer);
        ffmpeg.stdin.end();

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg ошибка. Код: ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error('FFmpeg не найден в системе'));
        });
    });
}

// Старт

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('');
    console.log(`  http://localhost:${PORT}  (API готов)`);
    console.log('  Allosaurus: python + pip install allosaurus');
    console.log('');
});