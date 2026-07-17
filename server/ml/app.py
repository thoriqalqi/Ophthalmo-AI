from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import tensorflow as tf
import numpy as np
from PIL import Image
import io
import base64
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Ophthalmo-AI ML Vision Service")

# Mengizinkan koneksi dari Express server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model Keras .h5 (Pastikan file ai.h5 diletakkan di folder yang sama)
try:
    model = tf.keras.models.load_model("ai.h5")
    print("✅ Model Keras 'ai.h5' berhasil dimuat.")
except Exception as e:
    model = None
    print(f"⚠️ Model 'ai.h5' belum terdeteksi atau gagal dimuat: {e}")
    print("💡 Silakan drop file 'ai.h5' Anda ke folder server/ml/ ini.")

class PredictRequest(BaseModel):
    image: str  # Base64 string dari Express

@app.post("/predict")
def predict(request: PredictRequest):
    if model is None:
        raise HTTPException(
            status_code=503, 
            detail="Model 'ai.h5' tidak aktif. Silakan letakkan file ai.h5 di folder server/ml/ lalu restart server Python."
        )
    
    try:
        # 1. Decode base64 gambar
        img_bytes = base64.b64decode(request.image)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        
        # 2. Preprocessing (sesuaikan dengan target size training APTOS Anda)
        img = img.resize((224, 224))  # default standard EfficientNet / MobileNet
        img_array = np.array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        # 3. Predict menggunakan Keras
        preds = model.predict(img_array)[0]
        
        # Kelas APTOS 2019: 
        # 0: Normal, 1: Mild, 2: Moderate, 3: Severe, 4: Proliferative
        classes = ["No DR", "Mild", "Moderate", "Severe", "Proliferative DR"]
        pred_class_idx = int(np.argmax(preds))
        pred_class_name = classes[pred_class_idx]
        
        # Ekstrak tingkat deteksi fitur
        detected_features = []
        for i, score in enumerate(preds):
            if score > 0.15:  # threshold probabilitas 15%
                detected_features.append({
                    "feature": f"Retinopati Diabetik - Tingkat {classes[i]}",
                    "severity": float(score)
                })

        return {
            "quality": "Baik",
            "segment": "Retina (Fundus)",
            "detected_features": detected_features,
            "class_probabilities": {classes[i]: float(preds[i]) for i in range(len(classes))},
            "raw_summary": f"Hasil klasifikasi APTOS 2019 menunjukkan indikasi {pred_class_name} dengan probabilitas tertinggi {float(preds[pred_class_idx])*100:.1f}%."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memproses gambar: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
