from sklearn.neighbors import KNeighborsClassifier

import cv2
import pickle
import numpy as np
import os
import csv
import time
import datetime
from win32com.client import Dispatch

def speak(text):
    speaker = Dispatch("SAPI.SpVoice")
    speaker.Speak(text)

def get_camera():
    cap = cv2.VideoCapture(1)

    if cap.isOpened():
        print("Using USB camera")
        return cap

    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        print("Using default camera")
        return cap

    print("No camera found")
    return None

cap = get_camera()

facedetect = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

with open ("data/faces_data.pkl", "rb") as f:
    Faces = pickle.load(f)
with open ("data/names.pkl", "rb") as f:
    Labels = pickle.load(f)

knn = KNeighborsClassifier(n_neighbors=5)
knn.fit(Faces, Labels)

col_names = ["Name","Time"]

while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to grab frame")
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = facedetect.detectMultiScale(gray, 1.3, 5)

    for x,y,w,h in faces:
        cv2.rectangle(frame, (x,y), (x+w, y+h), (0,255,0), 2)
        ts = time.time()
        date = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
        timestamp = datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')
        exist = os.path.isfile(f"data/attendance_{date}.csv")

        crop_img = frame[y:y+h, x:x+w]
        resize_img = cv2.resize(crop_img, (200, 200)).flatten().reshape(1, -1)
        output = knn.predict(resize_img)
        cv2.putText(frame, f"Name: {output[0]}", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        attendance = [output[0], timestamp]
    cv2.imshow("Camera Feed", frame)

    k = cv2.waitKey(1)
    if k== ord('q'):
        break
    if k== ord('o'):
        speak(f"Hello {output[0]}, your attendance has been marked at {timestamp}")
        if exist:
            with open(f"data/attendance_{date}.csv", "a") as f:
                writer = csv.writer(f)
                writer.writerow(attendance)
            f.close()
        else:
            with open(f"data/attendance_{date}.csv", "w") as f:
                writer = csv.writer(f)
                writer.writerow(col_names)
            f.close()
cap.release()
cv2.destroyAllWindows()
