import threading
import time
import cv2
import numpy as np

class Capture:
    def __init__(self, index, demo=False):
        self.demo = demo
        self.lock = threading.Lock()
        self.latest = None
        self.sequence = 0
        self.error = ''
        self.stop_event = threading.Event()
        self.cap = None
        if not demo:
            self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                self.cap.release()
                raise RuntimeError('カメラを開けません。番号・Windowsのカメラ権限・他のアプリの使用状況を確認してください。')
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        try:
            while not self.stop_event.is_set():
                if self.demo:
                    frame = np.zeros((720, 1280, 3), np.uint8)
                    frame[:] = (80, 100, 130)
                    cv2.circle(frame, (int(640 + 250 * np.sin(time.monotonic())), 360), 120, (170, 200, 230), -1)
                    self.stop_event.wait(1 / 30)
                else:
                    ok, frame = self.cap.read()
                    if not ok:
                        self.error = 'カメラから映像を取得できません。停止して再接続してください。'
                        break
                frame = cv2.resize(frame, (1280, 720))
                with self.lock:
                    self.sequence += 1
                    self.latest = (self.sequence, time.perf_counter(), frame)
        finally:
            if self.cap:
                self.cap.release()

    def get(self):
        with self.lock:
            return self.latest

    def close(self):
        self.stop_event.set()
        self.thread.join(timeout=2)
