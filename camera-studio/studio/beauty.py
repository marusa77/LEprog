import cv2
import numpy as np

class Effect:
    def apply(self, frame, s, frozen=False):
        value=frame.astype(np.float32)
        value[:,:,0]-=s.warmth*.5
        value[:,:,2]+=s.warmth*.5
        value+=s.brightness
        result=np.clip(value,0,255).astype(np.uint8)
        hsv=cv2.cvtColor(result,cv2.COLOR_BGR2HSV)
        hsv[:,:,1]=np.clip(hsv[:,:,1].astype(np.float32)*s.saturation,0,255).astype(np.uint8)
        result=cv2.cvtColor(hsv,cv2.COLOR_HSV2BGR)
        if s.smooth>0:
            soft=cv2.bilateralFilter(result,7,40,40)
            result=cv2.addWeighted(result,1-s.smooth,soft,s.smooth,0)
        return result,'見栄え補正（滑らかさは映像全体に適用）'

    def close(self): pass
