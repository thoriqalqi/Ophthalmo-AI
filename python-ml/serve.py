# ============================================================
# OPHTHALMO-AI — DR Specialist Service
#
# Model : ClementP/FundusDRGrading-resnet50 (HuggingFace)
# Tugas : Grading Retinopati Diabetik (0-4) dari foto fundus
#
# Endpoint:
#   POST /predict  { "image": "<base64>" }  → kontrak VISION_ENDPOINT + dr_grade/dr_label
#   GET  /health   → status model
#
# Jalankan (lokal):
#   pip install -r requirements.txt
#   uvicorn serve:app --host 0.0.0.0 --port 8000
#
# Lalu set di server/.env:
#   DR_ENDPOINT=http://localhost:8000/predict
# ============================================================

import base64
import io

import torch
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

MODEL_ID = "ClementP/FundusDRGrading-resnet50"

# Skala International Clinical Diabetic Retinopathy (ICDR)
GRADE_LABELS = {
    0: "No DR",
    1: "Mild NPDR",
    2: "Moderate NPDR",
    3: "Severe NPDR",
    4: "Proliferative DR",
}

app = FastAPI(title="Ophthalmo-AI — DR Specialist Service")

# Mengizinkan koneksi dari Express server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- muat model HuggingFace ----------
model = None
processor = None
transform = None


def _load_model():
    global model, processor, transform
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    model = AutoModelForImageClassification.from_pretrained(MODEL_ID)
    model.eval()
    try:
        processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    except Exception:
        # Model tanpa preprocessor_config.json → pakai transform ImageNet standar
        from torchvision import transforms

        transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])


try:
    _load_model()
    print(f"✅ Model DR '{MODEL_ID}' berhasil dimuat.")
except Exception as e:  # noqa: BLE001
    print(f"⚠️ Gagal memuat model '{MODEL_ID}': {e}")
    print("💡 Pastikan koneksi internet aktif saat pertama kali (download dari HuggingFace).")


def _grade_of_class(idx: int) -> int:
    """Petakan indeks kelas model → grade DR 0-4 (via id2label bila tersedia)."""
    label = str(model.config.id2label.get(idx, idx)).lower()
    digits = "".join(ch for ch in label if ch.isdigit())
    if digits:
        g = int(digits[0])
        if 0 <= g <= 4:
            return g
    for keyword, g in (("prolif", 4), ("severe", 3), ("moderate", 2), ("mild", 1), ("no", 0)):
        if keyword in label:
            return g
    return min(max(idx, 0), 4)


class PredictRequest(BaseModel):
    image: str  # base64 dari Express (boleh dengan prefix data:image/...)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "dr-specialist",
        "model": MODEL_ID,
        "model_loaded": model is not None,
    }


@app.post("/predict")
def predict(request: PredictRequest):
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=f"Model '{MODEL_ID}' tidak aktif. Cek log server & koneksi HuggingFace, lalu restart.",
        )

    # 1. Decode base64 gambar
    b64 = request.image
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Gambar base64 tidak valid: {e}")

    # 2. Preprocess + inference
    try:
        if processor is not None:
            inputs = processor(images=img, return_tensors="pt")
            with torch.no_grad():
                logits = model(**inputs).logits[0]
        else:
            tensor = transform(img).unsqueeze(0)
            with torch.no_grad():
                logits = model(pixel_values=tensor).logits[0]
        probs = F.softmax(logits, dim=-1).tolist()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gagal memproses gambar: {e}")

    # 3. Agregasi probabilitas per grade DR
    grade_probs = {g: 0.0 for g in GRADE_LABELS}
    for idx, p in enumerate(probs):
        grade_probs[_grade_of_class(idx)] += float(p)

    top_grade = max(grade_probs, key=grade_probs.get)
    top_label = GRADE_LABELS[top_grade]
    conf = grade_probs[top_grade]

    # severity mengikuti beratnya grade (0-4 → 0.0-1.0), sesuai kontrak VISION_ENDPOINT
    if top_grade == 0:
        detected_features = [{"feature": "Tidak terdeteksi Retinopati Diabetik (No DR)", "severity": 0.0}]
    else:
        detected_features = [{
            "feature": f"Retinopati Diabetik Grade {top_grade} ({top_label})",
            "severity": round(top_grade / 4, 2),
        }]

    return {
        "quality": "Baik",
        "segment": "Fundus (retina)",
        "detected_features": detected_features,
        "raw_summary": f"Model DR mendeteksi: Grade {top_grade} - {top_label} (conf: {conf:.2f})",
        "class_probabilities": {
            f"{lbl} (Grade {g})": round(grade_probs.get(g, 0.0), 4) for g, lbl in GRADE_LABELS.items()
        },
        "dr_grade": top_grade,
        "dr_label": top_label,
        "source": "fundus-dr-model",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
