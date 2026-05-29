# Настройка анализа произношения (MFA + Vosk)

## Как это работает

| Компонент | Роль |
|-----------|------|
| **Vosk** | Распознаёт, *что* вы сказали (текст гипотезы) |
| **MFA** | Выравнивает *эталонный* текст с аудио → фонемы и тайминги |
| **Словарь** | Эталонные фонемы для слов из фразы |

**Оценка:**
- 55% — совпадение слов (эталон vs распознанное Vosk)
- 45% — фонемы (словарь + MFA alignment)

Vosk **нужен** для сравнения «что должны были сказать» vs «что сказали».  
MFA **нужен** для настоящего фонемного разбора с таймингами.

## 1. FFmpeg

```bash
# Windows (winget)
winget install ffmpeg

# или скачайте с https://ffmpeg.org и добавьте в PATH
ffmpeg -version
```

## 2. Vosk (уже в проекте)

Модели должны лежать в:
- `models/vosk-model-ru-0.42`
- `models/vosk-model-en-us-0.42`

## 3. Montreal Forced Aligner (MFA)

### Установка (Windows, через Conda — рекомендуется)

```bash
conda create -n mfa -c conda-forge montreal-forced-aligner
conda activate mfa
mfa version
```

### Скачать модели

```bash
# Английский
mfa model download acoustic english_mfa
mfa model download dictionary english_us_arpa

# Русский
mfa model download acoustic russian_mfa
mfa model download dictionary russian_mfa
```

Модели сохраняются в: `C:\Users\<ИМЯ>\Documents\MFA\pretrained_models\`

### Проверка

```bash
curl http://localhost:3001/api/health
```

В ответе должно быть `"mfa": true` и `"english": { "acoustic": true, "dictionary": true }`.

## 4. Запуск сервера

```bash
cd c:\Projects\speech
npm start
```

Откройте `diagnostic.html` → запись → **Анализ произношения**.

## Устранение проблем

| Проблема | Решение |
|---------|---------|
| MFA не установлен | `conda install montreal-forced-aligner` |
| Модели не найдены | `mfa model download ...` (см. выше) |
| OOV слова | Добавьте слова в `pronunciation/lexicon.js` |
| FFmpeg error | Установите ffmpeg в PATH |
| Низкий балл при хорошей речи | Говорите чётче; проверьте выбранный язык RU/EN |

## Переменные окружения

- `MFA_ROOT` — путь к `pretrained_models` (по умолчанию `~/Documents/MFA/pretrained_models`)
- `USE_VOSK=false` — отключить Vosk (без ASR анализ неполный)
- `PORT=3001` — порт сервера
