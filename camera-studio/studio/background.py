import cv2
import numpy as np
from studio.models import options, image, vision

class Effect:
    def __init__(self):
        self.segmenter=vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=options('selfie_segmenter.tflite'),output_confidence_masks=True))
        self.path=None; self.background=None

    def apply(self,frame,s,frozen=False):
        if s.background=='image':
            if not s.background_path: raise ValueError('背景画像を選んでください')
            if self.path!=s.background_path:
                loaded=cv2.imdecode(np.fromfile(s.background_path,dtype=np.uint8),cv2.IMREAD_COLOR)
                if loaded is None: raise ValueError('背景画像を読み込めません')
                self.background=loaded; self.path=s.background_path
            h,w=frame.shape[:2]; bh,bw=self.background.shape[:2]
            scale=max(w/bw,h/bh)
            bg=cv2.resize(self.background,(max(w,round(bw*scale)),max(h,round(bh*scale))))
            y=(bg.shape[0]-h)//2; x=(bg.shape[1]-w)//2; bg=bg[y:y+h,x:x+w]
        else:
            bg=cv2.GaussianBlur(frame,(0,0),2+25*s.strength)
        result=self.segmenter.segment(image(frame))
        mask=result.confidence_masks[0].numpy_view().copy()
        mask=cv2.resize(mask,(frame.shape[1],frame.shape[0]))
        mask=np.clip((mask-.2)/.6,0,1)
        mask=cv2.GaussianBlur(mask,(5,5),0)[:,:,None]
        return np.clip(frame*mask+bg*(1-mask),0,255).astype(np.uint8),'背景加工：'+s.background

    def close(self): self.segmenter.close()
