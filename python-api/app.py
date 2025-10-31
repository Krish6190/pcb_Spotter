from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from ultralytics import YOLO
import cv2
import numpy as np
from PIL import Image
import io
import os
import requests

app = Flask(__name__)
CORS(app)

# ✅ Download model from Hugging Face (public model, no token needed)

MODEL_FILE = "best.pt"
MODEL_URL = "https://huggingface.co/datasets/Krish619/pcb-model/resolve/main/best.pt"

# ✅ Ensure the model is available locally
if not os.path.exists(MODEL_FILE):
    print("📦 Downloading model from Hugging Face...")
    response = requests.get(MODEL_URL)
    if response.status_code == 200:
        with open(MODEL_FILE, "wb") as f:
            f.write(response.content)
        print("✅ Model downloaded successfully!")
    else:
        raise Exception(f"Failed to download model: {response.status_code} - {response.text}")

# ✅ Load YOLO model locally
from ultralytics import YOLO
model = YOLO(MODEL_FILE)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "model_loaded": True})

@app.route('/detect', methods=['POST'])
def detect_faults():
    try:
        if 'image' not in request.files:
            return jsonify({"error": "No image file provided"}), 400

        file = request.files['image']
        image_bytes = file.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        original_image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if original_image is None:
            return jsonify({"error": "Invalid image file"}), 400

        h, w = original_image.shape[:2]
        gray = cv2.cvtColor(original_image, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (640, 640))
        input_image = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)

        results = model(input_image)
        annotated = results[0].plot()
        final = cv2.resize(annotated, (w, h))
        final_rgb = cv2.cvtColor(final, cv2.COLOR_BGR2RGB)

        img_io = io.BytesIO()
        Image.fromarray(final_rgb).save(img_io, 'PNG', quality=95)
        img_io.seek(0)

        return send_file(img_io, mimetype='image/png')
    except Exception as e:
        print(f"❌ Error processing image: {e}")
        return jsonify({"error": f"Processing failed: {e}"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
