import sys
import json
import os

sys.stdout.reconfigure(encoding='utf-8')
os.environ["PYTHONIOENCODING"] = "utf-8"

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No input text"}))
        return
    text = ' '.join(sys.argv[1:])
    try:
        from omogre import Transcriptor
    except ImportError:
        print(json.dumps({"error": "Omogre not installed"}))
        return
    transcriber = Transcriptor(data_path=os.path.join(os.getcwd(), "omogre_data"), download=False)
    res = transcriber.transcribe([text])
    ipa = res[0] if res else ''
    print(json.dumps({"ipa": ipa}))
    sys.stdout.flush()

if __name__ == "__main__":
    main()