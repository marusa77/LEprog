import time
import cv2
import numpy as np
from studio.models import options, image, vision

def polygon_from_hands(hands,width,height):
    if len(hands)!=2: return None
    points=np.array([[np.clip(hand[i].x,0,1)*(width-1),np.clip(hand[i].y,0,1)*(height-1)]
                     for hand in hands for i in (4,8)],dtype=np.float32)
    hull=cv2.convexHull(points).reshape(-1,2)
    if len(hull)!=4 or cv2.contourArea(hull)<400: return None
    return hull.astype(np.int32)

def apply_polygon(frame,polygon,effect,strength):
    mask=np.zeros(frame.shape[:2],np.uint8); cv2.fillConvexPoly(mask,polygon,255)
    if effect=='gray':
        altered=cv2.cvtColor(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),cv2.COLOR_GRAY2BGR)
    elif effect=='blur':
        altered=cv2.GaussianBlur(frame,(0,0),2+25*strength)
    else:
        h,w=frame.shape[:2]; block=int(8+48*strength)
        altered=cv2.resize(cv2.resize(frame,(max(1,w//block),max(1,h//block)),interpolation=cv2.INTER_AREA),(w,h),interpolation=cv2.INTER_NEAREST)
    return np.where(mask[:,:,None]>0,altered,frame)

class Effect:
    def __init__(self):
        self.detector=vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=options('hand_landmarker.task'),running_mode=vision.RunningMode.VIDEO,num_hands=2))
        self.polygon=None; self.timestamp=0

    def apply(self,frame,s,frozen=False):
        if not frozen:
            self.timestamp=max(self.timestamp+1,int(time.monotonic()*1000))
            result=self.detector.detect_for_video(image(frame),self.timestamp)
            self.polygon=polygon_from_hands(result.hand_landmarks,frame.shape[1],frame.shape[0])
        if self.polygon is None:
            return frame.copy(),'両手の親指・人差し指で四角形を作ってください（範囲未検出）'
        processed=apply_polygon(frame,self.polygon,s.region_effect,s.strength)
        # 枠はプレビュー専用にせず、出力にも表示して範囲を分かりやすくする
        cv2.polylines(processed,[self.polygon],True,(70,220,100),2)
        return processed,'指先の範囲：'+('固定中' if frozen else '追従中')

    def close(self): self.detector.close()
