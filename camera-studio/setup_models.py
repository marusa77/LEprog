import argparse
import os
import urllib.request
from studio.models import MODELS
from studio.config import ROOT

def main():
    parser=argparse.ArgumentParser(description='公式のMediaPipeモデルをダウンロードします。映像は送信しません。')
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    folder=ROOT/'models'; folder.mkdir(exist_ok=True)
    for name,url in MODELS.items():
        path=folder/name
        if path.exists() and not args.force:
            print(name+': already exists'); continue
        tmp=path.with_suffix('.download')
        try:
            with urllib.request.urlopen(url,timeout=60) as response, tmp.open('wb') as target:
                while chunk:=response.read(1024*1024): target.write(chunk)
            if tmp.stat().st_size<10000: raise ValueError('モデルファイルが小さすぎます')
            os.replace(tmp,path)
            print(name+': downloaded')
        finally:
            tmp.unlink(missing_ok=True)

if __name__=='__main__': main()
