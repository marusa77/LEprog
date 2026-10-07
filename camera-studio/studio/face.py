import cv2
from studio.models import options, image, vision

class Effect:
    def __init__(self):
        self.detector=vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
            base_options=options('blaze_face_short_range.tflite'),min_detection_confidence=.5))

    def apply(self,frame,s,frozen=False):
        detections=self.detector.detect(image(frame)).detections
        result=frame.copy(); height,width=frame.shape[:2]
        for detection in detections:
            box=detection.bounding_box
            x=max(0,box.origin_x); y=max(0,box.origin_y)
            x2=min(width,box.origin_x+box.width); y2=min(height,box.origin_y+box.height)
            if x2<=x or y2<=y: continue
            roi=frame[y:y2,x:x2]; h,w=roi.shape[:2]
            if s.face_effect=='mosaic':
                block=int(8+40*s.strength)
                small=cv2.resize(roi,(max(1,w//block),max(1,h//block)),interpolation=cv2.INTER_AREA)
                result[y:y2,x:x2]=cv2.resize(small,(w,h),interpolation=cv2.INTER_NEAREST)
            elif s.face_effect=='cartoon':
                soft=cv2.bilateralFilter(roi,7,60,60)
                step=int(16+32*s.strength)
                result[y:y2,x:x2]=(soft//step)*step
            else:
                eyes=detection.keypoints[:2]
                points=[(int(p.x*width),int(p.y*height)) for p in eyes]
                if len(points)!=2: continue
                radius=max(5,int(w*(.12+.06*s.strength)))
                thickness=max(2,int(w*.025))
                for point in points: cv2.circle(result,point,radius,(20,20,20),thickness)
                cv2.line(result,points[0],points[1],(20,20,20),thickness)
        return result,'AI顔加工：'+s.face_effect+' / '+str(len(detections))+'顔（未検出の顔には適用されません）'

    def close(self): self.detector.close()
