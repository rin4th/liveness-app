import base64
from flask import Flask
from flask_socketio import SocketIO, emit
import cv2
import numpy as np
from PIL import Image
import io
import os

import torch
import torch.nn as nn
import xgboost as xgb
from torchvision.models import swin_t, efficientnet_v2_s
from torchvision.transforms import v2

class LivenessEnsemblePipeline:
    def __init__(self, model_dir, device):
        print("\n--- Menginisialisasi Sistem Ensemble untuk Inferensi ---")
        self.device = device
        self.model_dir = model_dir
        self.class_names = ['real', 'replay', 'print']

        self.swin_model = self._load_swin_model()
        self.effnet_model = self._load_effnet_model()
        self.xgb_model = self._load_xgb_model()

        self.transform = v2.Compose([
            v2.Resize((224, 224)),
            v2.ToImage(),
            v2.ToDtype(torch.float32, scale=True),
            v2.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        print("Sistem Ensemble siap digunakan.")

    def _load_swin_model(self):
        try:
            model = swin_t(weights=None, num_classes=3)
            model.head = nn.Sequential(nn.Dropout(p=0.5), nn.Linear(model.head.in_features, 3))
            model.load_state_dict(torch.load(os.path.join(self.model_dir, "swin_transformer_base-07-07-05.pth"), map_location=self.device))
            model.to(self.device)
            model.eval()
            print("Model Swin Transformer berhasil dimuat.")
            return model
        except FileNotFoundError:
            print(f"ERROR: File bobot 'final_swin_model.pth' tidak ditemukan.")
            return None

    def _load_effnet_model(self):
        try:
            model = efficientnet_v2_s(weights=None, num_classes=3)
            in_features = model.classifier[1].in_features
            model.classifier = nn.Sequential(nn.Dropout(p=0.5), nn.Linear(in_features, 3))
            model.load_state_dict(torch.load(os.path.join(self.model_dir, "efficientnet_v2_base-07-07-05.pth"), map_location=self.device))
            model.to(self.device)
            model.eval()
            print("Model EfficientNetV2 berhasil dimuat.")
            return model
        except FileNotFoundError:
            print(f"ERROR: File bobot 'final_effnet_model.pth' tidak ditemukan.")
            return None

    def _load_xgb_model(self):
        try:
            model = xgb.XGBClassifier()
            model.load_model(os.path.join(self.model_dir, "xgb_meta_learner-07-07-05.json"))
            print("Model XGBoost berhasil dimuat.")
            return model
        except (xgb.core.XGBoostError, FileNotFoundError):
            print(f"ERROR: File meta-learner 'final_xgb_meta_learner.json' tidak ditemukan.")
            return None

    def predict(self, image_pil):
        """Membuat prediksi pada satu gambar PIL dan mengembalikan hasilnya."""
        if not all([self.swin_model, self.effnet_model, self.xgb_model]):
            return None
            
        try:
            input_tensor = self.transform(image_pil).unsqueeze(0).to(self.device)

            with torch.no_grad():
                swin_probs = torch.nn.functional.softmax(self.swin_model(input_tensor), dim=1)
                effnet_probs = torch.nn.functional.softmax(self.effnet_model(input_tensor), dim=1)
                meta_features = torch.cat((swin_probs, effnet_probs), dim=1).cpu().numpy()
                
                final_probabilities = self.xgb_model.predict_proba(meta_features)[0]
                predicted_idx = np.argmax(final_probabilities)
                confidence = final_probabilities[predicted_idx]
                predicted_class = self.class_names[predicted_idx]

                return {
                    "className": predicted_class,
                    "confidence": float(confidence),
                }
        except Exception as e:
            print(f"Error saat prediksi: {e}")
            return None

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

MODEL_DIRECTORY = "models" 
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if torch.cuda.is_available():
    print(f"Run on: {torch.cuda.get_device_name(0)}")


ensemble_system = LivenessEnsemblePipeline(MODEL_DIRECTORY, DEVICE)


@app.route('/')
def index():
    return "Liveness Detection Backend (Ensemble Model) Running!"


@socketio.on('image')
def handle_image(data):
    image_data = base64.b64decode(data['image'])
    image_pil = Image.open(io.BytesIO(image_data)).convert("RGB")

    if image_pil is None:
        return

    prediction_result = ensemble_system.predict(image_pil)

    if prediction_result:
        emit('prediction_result', prediction_result)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8000)
