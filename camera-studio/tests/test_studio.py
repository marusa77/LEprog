import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import cv2
import numpy as np
from studio.config import Settings, load, save, MODES
from studio.engine import Engine
from studio.region import polygon_from_hands, apply_polygon

class StudioTests(unittest.TestCase):
    def setUp(self):
        self.frame=np.random.default_rng(7).integers(0,256,(180,320,3),dtype=np.uint8)

    def test_settings_round_trip_and_invalid_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'settings.json'
            save(Settings(mode='beauty',brightness=22,virtual=True),path)
            restored,warning=load(path)
            self.assertEqual(restored.brightness,22); self.assertFalse(restored.virtual)
            self.assertEqual(warning,'')
            path.write_text('broken',encoding='utf-8')
            self.assertTrue(load(path)[1])
        invalid=Settings.from_dict({'mode':'wrong','brightness':'bad','strength':float('nan'),'camera':-1})
        self.assertEqual(invalid.mode,'default'); self.assertEqual(invalid.brightness,0)
        self.assertEqual(invalid.strength,.5); self.assertEqual(invalid.camera,0)

    def test_save_failure_keeps_previous_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'settings.json'; save(Settings(brightness=10),path)
            with patch('studio.config.os.replace',side_effect=OSError('denied')):
                with self.assertRaises(OSError): save(Settings(brightness=50),path)
            self.assertEqual(load(path)[0].brightness,10)

    def test_default_preserves_input_and_beauty_changes_it(self):
        engine=Engine()
        try:
            original=self.frame.copy()
            result,_=engine.process(self.frame,Settings())
            np.testing.assert_array_equal(result,original)
            changed,_=engine.process(self.frame,Settings(mode='beauty',brightness=25))
            self.assertFalse(np.array_equal(changed,original))
            np.testing.assert_array_equal(self.frame,original)
        finally: engine.close()

    def test_polygon_effect_does_not_change_outside(self):
        polygon=np.array([[40,40],[200,40],[200,140],[40,140]],np.int32)
        mask=np.zeros(self.frame.shape[:2],np.uint8); cv2.fillConvexPoly(mask,polygon,255)
        for effect in ('mosaic','blur','gray'):
            result=apply_polygon(self.frame,polygon,effect,.5)
            np.testing.assert_array_equal(result[mask==0],self.frame[mask==0])
            self.assertFalse(np.array_equal(result[mask>0],self.frame[mask>0]))

    def test_hand_polygon_requires_four_non_degenerate_corners(self):
        def hand(thumb,index):
            points=[SimpleNamespace(x=.5,y=.5) for _ in range(21)]
            points[4]=SimpleNamespace(x=thumb[0],y=thumb[1]); points[8]=SimpleNamespace(x=index[0],y=index[1])
            return points
        hands=[hand((.2,.2),(.2,.8)),hand((.8,.2),(.8,.8))]
        self.assertEqual(polygon_from_hands(hands,320,180).shape,(4,2))
        self.assertIsNone(polygon_from_hands(hands[:1],320,180))
        self.assertIsNone(polygon_from_hands([hand((.5,.5),(.5,.5))]*2,320,180))

    def test_models_initialize_and_process_all_modes(self):
        engine=Engine()
        try:
            for mode in MODES:
                result,_=engine.process(self.frame,Settings(mode=mode))
                self.assertEqual(result.shape,self.frame.shape); self.assertEqual(result.dtype,np.uint8)
        finally: engine.close()

    def test_background_image_and_missing_image(self):
        from studio.background import Effect
        effect=Effect()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path=Path(folder)/'background.png'; cv2.imwrite(str(path),np.full((80,100,3),240,np.uint8))
                result,_=effect.apply(self.frame,Settings(background='image',background_path=str(path)))
                self.assertEqual(result.shape,self.frame.shape)
            with self.assertRaises(ValueError): effect.apply(self.frame,Settings(background='image'))
        finally: effect.close()

    def test_region_freeze_preserves_polygon(self):
        from studio.region import Effect
        effect=Effect()
        try:
            effect.polygon=np.array([[40,40],[200,40],[200,140],[40,140]],np.int32)
            expected=effect.polygon.copy()
            result,note=effect.apply(self.frame,Settings(),True)
            np.testing.assert_array_equal(effect.polygon,expected)
            self.assertFalse(np.array_equal(result,self.frame))
        finally: effect.close()

class FaceEffectTests(unittest.TestCase):
    def test_detected_face_effects_and_unmodified_surroundings(self):
        from studio.face import Effect
        effect=Effect.__new__(Effect)
        box=SimpleNamespace(origin_x=80,origin_y=40,width=80,height=80)
        eyes=[SimpleNamespace(x=.32,y=.36),SimpleNamespace(x=.43,y=.36)]
        detection=SimpleNamespace(bounding_box=box,keypoints=eyes)
        effect.detector=SimpleNamespace(detect=lambda _:SimpleNamespace(detections=[detection]))
        frame=np.random.default_rng(3).integers(0,256,(180,320,3),dtype=np.uint8)
        for name in ('glasses','mosaic','cartoon'):
            result,_=effect.apply(frame,Settings(face_effect=name))
            self.assertFalse(np.array_equal(result,frame))
            np.testing.assert_array_equal(result[:20],frame[:20])
        effect.detector=SimpleNamespace(detect=lambda _:SimpleNamespace(detections=[]))
        result,_=effect.apply(frame,Settings())
        np.testing.assert_array_equal(result,frame)

if __name__=='__main__': unittest.main()
