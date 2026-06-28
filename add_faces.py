import cv2
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

faces_data = []
i=0
while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to grab frame")
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = facedetect.detectMultiScale(gray, 1.3, 5)

    for x,y,w,h in faces:

        crop_img = frame[y:y+h, x:x+w]
        resize_img = cv2.resize(crop_img, (200, 200))

        if len(faces_data) < 100 and i%10==0:
            faces_data.append(resize_img)
        i += 1
        cv2.putText(frame, f"Images Captured: {len(faces_data)}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.rectangle(frame, (x,y), (x+w, y+h), (0,255,0), 2)
    cv2.imshow("Camera Feed", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break
cap.release()
cv2.destroyAllWindows()