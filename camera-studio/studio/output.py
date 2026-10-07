import pyvirtualcam

class Output:
    def __init__(self):
        try:
            self.camera=pyvirtualcam.Camera(width=1280,height=720,fps=30,fmt=pyvirtualcam.PixelFormat.BGR,backend='obs')
        except RuntimeError as e:
            raise RuntimeError('OBS Studioの仮想カメラが必要です。OBSをインストールし、OBS側の仮想カメラ出力を停止してから再試行してください。') from e

    def send(self,frame):
        self.camera.send(frame)
        self.camera.sleep_until_next_frame()

    def close(self): self.camera.close()
