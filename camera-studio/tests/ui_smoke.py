import time
import tkinter as tk
from app import App

root=tk.Tk(); root.withdraw(); app=App(root,demo=True)
app.start()
started=time.monotonic(); changed=False; checked=False
while time.monotonic()-started<3:
    root.update(); time.sleep(.01)
    if time.monotonic()-started>.5 and not changed:
        app.select_mode(1); app.set_value('brightness',20); changed=True
    if time.monotonic()-started>1.5 and not checked:
        assert app.images[1].image is not None
        assert app.settings.mode=='beauty'
        checked=True; app.stop()
    if checked and not app.worker.is_alive(): break
assert checked
assert not app.worker.is_alive(),'Worker did not stop'
root.destroy()
print('UI preview, mode switching, worker shutdown: OK')
