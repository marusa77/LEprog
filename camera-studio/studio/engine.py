import importlib

class Engine:
    def __init__(self):
        self.effects = {}
        self.frozen = False

    def process(self, frame, settings):
        if settings.mode == 'default':
            return frame.copy(), 'デフォルト'
        if settings.mode not in self.effects:
            module = importlib.import_module('studio.' + settings.mode)
            self.effects[settings.mode] = module.Effect()
        return self.effects[settings.mode].apply(frame, settings, self.frozen)

    def close(self):
        for effect in self.effects.values():
            effect.close()
