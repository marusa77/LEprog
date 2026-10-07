import argparse
import copy
import queue
import threading
import time
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import cv2
from PIL import Image, ImageTk
from studio.config import MODES, load, save
from studio.capture import Capture
from studio.engine import Engine

LABELS = ('デフォルト', '見栄え補正', '背景加工', '指先の四角形', 'AI顔加工')

class App:
    def __init__(self, root, demo=False):
        self.root, self.demo = root, demo
        self.settings, warning = load()
        self.lock = threading.Lock()
        self.preview = queue.Queue(maxsize=1)
        self.events = queue.Queue()
        self.stop_event = threading.Event()
        self.worker = None
        self.frozen = False
        root.title('Camera Studio')
        root.geometry('1180x850')
        root.protocol('WM_DELETE_WINDOW', self.exit)
        self.status = tk.StringVar(value=warning or '開始を押すとカメラが起動します。')
        top = ttk.Frame(root, padding=10); top.pack(fill='x')
        ttk.Label(top, text='カメラ番号').pack(side='left')
        self.camera = tk.IntVar(value=self.settings.camera)
        ttk.Spinbox(top, from_=0, to=10, width=4, textvariable=self.camera).pack(side='left', padx=8)
        self.start_button = ttk.Button(top, text='開始', command=self.start); self.start_button.pack(side='left')
        ttk.Button(top, text='停止', command=self.stop).pack(side='left', padx=5)
        ttk.Button(top, text='設定を保存', command=self.persist).pack(side='left', padx=5)
        self.virtual = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text='仮想カメラへ出力', variable=self.virtual, command=lambda:self.set_value('virtual', self.virtual.get())).pack(side='left', padx=10)
        self.mirror = tk.BooleanVar(value=self.settings.mirror)
        ttk.Checkbutton(top, text='左右反転', variable=self.mirror, command=lambda:self.set_value('mirror', self.mirror.get())).pack(side='left')
        modes = ttk.Frame(root, padding=10); modes.pack(fill='x')
        self.mode = tk.StringVar(value=self.settings.mode)
        for i, label in enumerate(LABELS):
            ttk.Radiobutton(modes, text=label, value=MODES[i], variable=self.mode, command=self.change_mode).pack(side='left', padx=7)
            root.bind('<Control-Key-' + str(i + 1) + '>', lambda e, n=i:self.select_mode(n))
        ttk.Label(root, text='Ctrl+1〜5：モード切替（このアプリが選択されているとき）').pack(anchor='w', padx=15)
        views = ttk.Frame(root, padding=10); views.pack(fill='both', expand=True)
        self.images = []
        for title in ('元の映像', 'Discordへ送る映像'):
            pane = ttk.LabelFrame(views, text=title, padding=5); pane.pack(side='left', fill='both', expand=True)
            label = ttk.Label(pane, anchor='center'); label.pack(fill='both', expand=True); self.images.append(label)
        controls = ttk.Frame(root, padding=10); controls.pack(fill='x')
        self.values = {}
        for row, (name, title, lo, hi) in enumerate([('brightness','明るさ',-60,60), ('warmth','色味（青 ← → 暖色）',-40,40), ('saturation','彩度',0,2), ('smooth','滑らかさ（全体）',0,1), ('strength','加工の強さ',0,1)]):
            ttk.Label(controls, text=title).grid(row=row, column=0, sticky='w')
            var = tk.DoubleVar(value=getattr(self.settings,name)); self.values[name] = var
            ttk.Scale(controls, from_=lo, to=hi, variable=var, command=lambda v,n=name:self.set_value(n,float(v))).grid(row=row,column=1,sticky='ew',padx=10)
        controls.columnconfigure(1, weight=1)
        choices = ttk.Frame(root, padding=10); choices.pack(fill='x')
        for name, label, options in [('background','背景',('blur','image')), ('region_effect','範囲加工',('mosaic','blur','gray')), ('face_effect','顔加工',('glasses','mosaic','cartoon'))]:
            ttk.Label(choices, text=label).pack(side='left',padx=5)
            var = tk.StringVar(value=getattr(self.settings,name))
            box = ttk.Combobox(choices, textvariable=var, values=options, state='readonly', width=10); box.pack(side='left')
            box.bind('<<ComboboxSelected>>', lambda e,n=name,v=var:self.set_value(n,v.get()))
        ttk.Button(choices, text='背景画像を選ぶ', command=self.pick_background).pack(side='left',padx=5)
        self.freeze_button = ttk.Button(choices, text='範囲を固定', command=self.freeze); self.freeze_button.pack(side='left',padx=5)
        ttk.Label(root, textvariable=self.status, wraplength=1120, padding=10).pack(fill='x')
        root.after(30,self.refresh)

    def set_value(self,name,value):
        with self.lock:
            setattr(self.settings,name,value)

    def change_mode(self):
        self.set_value('mode',self.mode.get())
        self.frozen=False
        self.freeze_button.configure(text='範囲を固定')

    def select_mode(self,index):
        self.mode.set(MODES[index]); self.change_mode()

    def freeze(self):
        self.frozen=not self.frozen
        self.freeze_button.configure(text='固定を解除' if self.frozen else '範囲を固定')

    def pick_background(self):
        path=filedialog.askopenfilename(filetypes=[('画像','*.png *.jpg *.jpeg *.webp')])
        if path:
            self.set_value('background_path',path)

    def persist(self):
        try:
            with self.lock:
                save(self.settings)
            self.status.set('設定を保存しました。')
        except OSError as e:
            messagebox.showerror('保存できません',str(e))

    def start(self):
        if self.worker and self.worker.is_alive(): return
        try: index=self.camera.get()
        except tk.TclError:
            messagebox.showerror('カメラ番号','0〜10の整数を入力してください。'); return
        if not 0<=index<=10: return
        self.set_value('camera',index)
        self.stop_event.clear()
        self.start_button.configure(state='disabled')
        self.worker=threading.Thread(target=self.process,args=(index,),daemon=True)
        self.worker.start()

    def stop(self):
        self.stop_event.set()
        self.status.set('停止しています…')

    def process(self,index):
        capture=None; engine=Engine(); output=None; seq=-1; last=time.perf_counter()
        try:
            capture=Capture(index,self.demo)
            while not self.stop_event.is_set():
                latest=capture.get()
                if capture.error: raise RuntimeError(capture.error)
                if latest is None or latest[0]==seq:
                    self.stop_event.wait(.005); continue
                seq,captured,raw=latest
                with self.lock: settings=copy.copy(self.settings)
                engine.frozen=self.frozen
                t=time.perf_counter()
                try:
                    processed,note=engine.process(raw,settings)
                except Exception as e:
                    processed=raw*0; note='加工を利用できません（映像は黒にしています）：'+str(e)
                if settings.mirror:
                    processed=cv2.flip(processed,1); raw=cv2.flip(raw,1)
                # 仮想カメラ出力は専用モジュールで追加する
                if settings.virtual:
                    try:
                        if output is None:
                            from studio.output import Output
                            output=Output()
                        output.send(processed)
                    except Exception as e:
                        note+=' / 仮想カメラ：'+str(e)
                        with self.lock: self.settings.virtual=False
                        self.events.put('virtual_off')
                        if output: output.close(); output=None
                elif output:
                    output.close(); output=None
                now=time.perf_counter(); fps=1/max(now-last,.0001); last=now
                item=(raw,processed,f'{note} / 処理 {(now-t)*1000:.0f}ms / 取得後 {(now-captured)*1000:.0f}ms / {fps:.1f}fps（通信遅延は含みません）')
                try: self.preview.get_nowait()
                except queue.Empty: pass
                self.preview.put_nowait(item)
        except Exception as e:
            self.events.put(str(e))
        finally:
            if output: output.close()
            if capture: capture.close()
            engine.close()
            self.events.put('stopped')

    def refresh(self):
        try:
            while True:
                event=self.events.get_nowait()
                if event=='stopped':
                    self.start_button.configure(state='normal')
                elif event=='virtual_off': self.virtual.set(False)
                else: self.status.set(event)
        except queue.Empty: pass
        try:
            raw,processed,note=self.preview.get_nowait()
            for label,frame in zip(self.images,(raw,processed)):
                image=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)); image.thumbnail((550,310))
                photo=ImageTk.PhotoImage(image); label.configure(image=photo); label.image=photo
            self.status.set(note)
        except queue.Empty: pass
        self.root.after(30,self.refresh)

    def exit(self):
        self.stop_event.set()
        if self.worker and self.worker.is_alive():
            self.root.after(50,self.exit); return
        self.root.destroy()

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--demo',action='store_true'); args=parser.parse_args()
    root=tk.Tk(); App(root,args.demo); root.mainloop()
