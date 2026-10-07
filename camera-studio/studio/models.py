from pathlib import Path
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from studio.config import ROOT

MODELS = {
    'selfie_segmenter.tflite': 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    'blaze_face_short_range.tflite': 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
}

def options(name):
    path=ROOT/'models'/name
    if not path.exists():
        raise RuntimeError('AIモデルがありません。先に setup_models.py を実行してください。')
    return python.BaseOptions(model_asset_path=str(path))

def image(frame):
    return mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
