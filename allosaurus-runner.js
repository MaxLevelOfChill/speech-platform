const { execFile } = require('child_process');
const path = require('path');

// Абсолютный путь к Python (как в server.js)
const PYTHON_CMD = 'C:\\Users\\Lenovo\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
const SCRIPT_PATH = path.join(__dirname, 'allosaurus_recognize.py');

function recognizePhones(wavPath, language) {
    return new Promise((resolve) => {
        const lang = language === 'ru' ? 'ru' : 'en';
        console.log(`[Allosaurus] execFile: ${PYTHON_CMD} ${SCRIPT_PATH} ${wavPath} ${lang}`);
        execFile(PYTHON_CMD, [SCRIPT_PATH, wavPath, lang], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1' }
        }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Allosaurus] execFile error: ${error.message}`);
                resolve({ success: false, error: error.message, phones: [] });
                return;
            }
            if (stderr) {
                console.error(`[Allosaurus] stderr: ${stderr}`);
            }
            console.log(`[Allosaurus] stdout: ${stdout}`);
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                console.error(`[Allosaurus] JSON parse error: ${stdout}`);
                resolve({ success: false, error: 'Parse error', phones: [] });
            }
        });
    });
}

module.exports = { recognizePhones };