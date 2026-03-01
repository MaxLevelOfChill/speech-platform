const http = require('http');
const https = require('https');

// =====================================================
//  HuggingFace Inference API — БЕСПЛАТНО, без карты
//  Ключ начинается с hf_...
// =====================================================
const HF_API_KEY = process.env.HF_API_KEY || 'hf_твой_ключ_для_тестов';
const PORT = 3000;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/analyze') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Неверный JSON' }));
                return;
            }

            const userMessage = parsed.messages?.[0]?.content || '';

            // Llama 3.1 8B через novita — бесплатно, работает в РФ
            const requestBody = JSON.stringify({
                model: 'meta-llama/Llama-3.1-8B-Instruct:novita',
                messages: [{ role: 'user', content: userMessage }],
                max_tokens: 1024,
                temperature: 0.3
            });

            const options = {
                hostname: 'router.huggingface.co',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HF_API_KEY}`,
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            const apiReq = https.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', chunk => { data += chunk; });
                apiRes.on('end', () => {
                    console.log('Ответ от HF:', data.substring(0, 200));
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: { message: JSON.stringify(parsed.error) } }));
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(data);
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: { message: 'Ошибка парсинга: ' + data.substring(0, 100) } }));
                    }
                });
            });

            apiReq.on('error', (e) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: e.message } }));
            });

            apiReq.write(requestBody);
            apiReq.end();
        });

    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log('====================================');
    console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
    console.log('====================================');
    console.log('Это окно не закрывай!');
});