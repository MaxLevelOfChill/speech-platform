import sys
import json

def recognize(wav_path, language):
    try:
        from allosaurus.app import read_recognizer
        model = read_recognizer()
        
        # Allosaurus использует коды языков ISO 639-3
        lang_code = 'rus' if language == 'ru' else 'eng'
        
        result = model.recognize(wav_path, lang_code)
        phones = result.split() if result.strip() else []
        
        print(json.dumps({
            'success': True,
            'phones': phones,
            'raw': result
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e),
            'phones': []
        }))

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Usage: script.py <wav_path> <language>', 'phones': []}))
        sys.exit(1)
    recognize(sys.argv[1], sys.argv[2])