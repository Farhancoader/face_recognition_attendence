import base64
import csv
import os
import pickle
from contextlib import asynccontextmanager
from datetime import datetime

import cv2
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sklearn.neighbors import KNeighborsClassifier

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
FACES_PATH = os.path.join(DATA_DIR, "faces_data.pkl")
NAMES_PATH = os.path.join(DATA_DIR, "names.pkl")

facedetect = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

knn = None
registered_names = []
model_loaded = False


TARGET_SAMPLES = 100
MIN_SAMPLES = 20

registration_sessions: dict[str, dict] = {}


class ImageRequest(BaseModel):
    image: str


class MarkAttendanceRequest(BaseModel):
    name: str


class RegisterNameRequest(BaseModel):
    name: str


class RegisterSampleRequest(BaseModel):
    name: str
    image: str


def load_model():
    global knn, registered_names, model_loaded
    if not os.path.isfile(FACES_PATH) or not os.path.isfile(NAMES_PATH):
        knn = None
        registered_names = []
        model_loaded = False
        return False

    with open(FACES_PATH, "rb") as f:
        faces = pickle.load(f)
    with open(NAMES_PATH, "rb") as f:
        labels = pickle.load(f)

    knn = KNeighborsClassifier(n_neighbors=5)
    knn.fit(faces, labels)
    registered_names = sorted(set(labels))
    model_loaded = True
    return True


def decode_image(base64_str: str):
    if "," in base64_str:
        base64_str = base64_str.split(",", 1)[1]
    img_bytes = base64.b64decode(base64_str)
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def today_str():
    return datetime.now().strftime("%Y-%m-%d")


def attendance_path(date=None):
    date = date or today_str()
    return os.path.join(DATA_DIR, f"attendance_{date}.csv")


def read_attendance(date=None):
    path = attendance_path(date)
    if not os.path.isfile(path):
        return []
    df = pd.read_csv(path)
    return df.to_dict(orient="records")


def already_marked(name, date=None):
    records = read_attendance(date)
    return any(r.get("Name") == name for r in records)


def mark_attendance(name, date=None):
    date = date or today_str()
    timestamp = datetime.now().strftime("%H:%M:%S")
    path = attendance_path(date)
    exists = os.path.isfile(path)

    with open(path, "a", newline="") as f:
        writer = csv.writer(f)
        if not exists:
            writer.writerow(["Name", "Time"])
        writer.writerow([name, timestamp])

    return timestamp


def recognize_face(frame):
    sample, box = extract_face_sample(frame)
    if sample is None:
        return None, None
    name = knn.predict(sample.reshape(1, -1))[0]
    return name, box


def extract_face_sample(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = facedetect.detectMultiScale(gray, 1.3, 5)

    if len(faces) == 0:
        return None, None

    x, y, w, h = faces[0]
    crop = frame[y : y + h, x : x + w]
    resized = cv2.resize(crop, (200, 200))
    flattened = resized.flatten()
    box = {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
    return flattened, box


def save_registered_face(name: str, samples: list):
    faces_data = np.asarray(samples)

    if os.path.isfile(NAMES_PATH):
        with open(NAMES_PATH, "rb") as f:
            names = pickle.load(f)
    else:
        names = []

    if os.path.isfile(FACES_PATH):
        with open(FACES_PATH, "rb") as f:
            faces = pickle.load(f)
    else:
        faces = np.empty((0, faces_data.shape[1]))

    names = names + [name] * len(samples)
    faces = np.append(faces, faces_data, axis=0)

    with open(NAMES_PATH, "wb") as f:
        pickle.dump(names, f)
    with open(FACES_PATH, "wb") as f:
        pickle.dump(faces, f)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(DATA_DIR, exist_ok=True)
    load_model()
    yield


app = FastAPI(title="Face Recognition Attendance", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/health")
async def health():
    return {
        "model_loaded": model_loaded,
        "registered_count": len(registered_names),
        "registered_names": registered_names,
    }


@app.post("/api/recognize")
async def recognize(body: ImageRequest):
    if not model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Face model not loaded. Register a face first.",
        )

    frame = decode_image(body.image)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    name, box = recognize_face(frame)
    if name is None:
        return {"success": True, "face_detected": False, "name": None}

    return {
        "success": True,
        "face_detected": True,
        "name": name,
        "box": box,
        "already_marked": already_marked(name),
    }


@app.post("/api/mark-attendance")
async def mark_attendance_route(body: MarkAttendanceRequest):
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Face model not loaded.")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    if name not in registered_names:
        raise HTTPException(status_code=400, detail="Unknown person")

    if already_marked(name):
        raise HTTPException(
            status_code=409,
            detail=f"{name} is already marked for today",
        )

    timestamp = mark_attendance(name)
    return {
        "success": True,
        "name": name,
        "time": timestamp,
        "date": today_str(),
        "message": f"Attendance marked for {name} at {timestamp}",
    }


@app.get("/api/attendance")
async def get_attendance(date: str | None = Query(default=None)):
    date = date or today_str()
    records = read_attendance(date)
    return {"date": date, "records": records, "count": len(records)}


@app.get("/api/dates")
async def list_dates():
    dates = []
    if os.path.isdir(DATA_DIR):
        for fname in os.listdir(DATA_DIR):
            if fname.startswith("attendance_") and fname.endswith(".csv"):
                dates.append(fname.replace("attendance_", "").replace(".csv", ""))
    dates.sort(reverse=True)
    return {"dates": dates}


@app.post("/api/register/start")
async def register_start(body: RegisterNameRequest):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    registration_sessions[name] = {"samples": []}
    return {"name": name, "captured": 0, "target": TARGET_SAMPLES}


@app.post("/api/register/sample")
async def register_sample(body: RegisterSampleRequest):
    name = body.name.strip()
    if name not in registration_sessions:
        raise HTTPException(status_code=400, detail="Start registration before capturing samples")

    session = registration_sessions[name]
    captured = len(session["samples"])
    if captured >= TARGET_SAMPLES:
        return {
            "face_detected": False,
            "captured": TARGET_SAMPLES,
            "target": TARGET_SAMPLES,
            "complete": True,
        }

    frame = decode_image(body.image)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    sample, box = extract_face_sample(frame)
    if sample is None:
        return {
            "face_detected": False,
            "captured": captured,
            "target": TARGET_SAMPLES,
            "complete": False,
        }

    session["samples"].append(sample)
    captured = len(session["samples"])
    return {
        "face_detected": True,
        "captured": captured,
        "target": TARGET_SAMPLES,
        "complete": captured >= TARGET_SAMPLES,
        "box": box,
    }


@app.post("/api/register/finish")
async def register_finish(body: RegisterNameRequest):
    name = body.name.strip()
    if name not in registration_sessions:
        raise HTTPException(status_code=400, detail="Start registration before saving")

    samples = registration_sessions[name]["samples"]
    if len(samples) < MIN_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {MIN_SAMPLES} samples, only have {len(samples)}",
        )

    save_registered_face(name, samples)
    del registration_sessions[name]
    load_model()

    return {
        "success": True,
        "name": name,
        "samples_saved": len(samples),
        "message": f"{name} registered with {len(samples)} face samples",
    }


@app.post("/api/register/cancel")
async def register_cancel(body: RegisterNameRequest):
    name = body.name.strip()
    registration_sessions.pop(name, None)
    return {"success": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
