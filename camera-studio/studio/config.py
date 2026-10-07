import json
import math
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODES = ('default', 'beauty', 'background', 'region', 'face')

@dataclass
class Settings:
    mode: str = 'default'
    camera: int = 0
    brightness: float = 0
    warmth: float = 0
    saturation: float = 1
    smooth: float = 0
    strength: float = 0.5
    background: str = 'blur'
    background_path: str = ''
    region_effect: str = 'mosaic'
    face_effect: str = 'glasses'
    mirror: bool = False
    virtual: bool = False

    @classmethod
    def from_dict(cls, value):
        if not isinstance(value, dict):
            raise ValueError('設定はオブジェクトである必要があります')
        s = cls(**{k: v for k, v in value.items() if k in {f.name for f in fields(cls)}})
        if s.mode not in MODES:
            s.mode = 'default'
        for name, lo, hi, default in [('brightness', -60, 60, 0), ('warmth', -40, 40, 0),
                                      ('saturation', 0, 2, 1), ('smooth', 0, 1, 0), ('strength', 0, 1, .5)]:
            v = getattr(s, name)
            setattr(s, name, max(lo, min(hi, v)) if isinstance(v, (int, float)) and math.isfinite(v) else default)
        s.camera = s.camera if type(s.camera) is int and 0 <= s.camera <= 10 else 0
        for name, choices in [('background', ('blur', 'image')), ('region_effect', ('mosaic', 'blur', 'gray')),
                              ('face_effect', ('glasses', 'mosaic', 'cartoon'))]:
            if getattr(s, name) not in choices:
                setattr(s, name, choices[0])
        s.background_path = s.background_path if isinstance(s.background_path, str) else ''
        s.mirror = s.mirror is True
        s.virtual = False  # 出力は毎回ユーザー操作で開始する
        return s

def load(path=ROOT / 'settings.json'):
    if not path.exists():
        return Settings(), ''
    try:
        return Settings.from_dict(json.loads(path.read_text(encoding='utf-8'))), ''
    except (OSError, ValueError, TypeError):
        return Settings(), '設定を読み込めませんでした。初期設定を使用します。'

def save(settings, path=ROOT / 'settings.json'):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, path)
