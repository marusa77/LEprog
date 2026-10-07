"""WindowsのPythonにTcl/Tkスクリプトが不足する場合のローカル補助設定。"""
import os
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from studio.config import ROOT

if __name__=='__main__':
    if sys.platform!='win32' or sys.version_info[:2]!=(3,14):
        raise SystemExit('この補助設定はWindowsのPython 3.14用です。別バージョンではTcl/Tk付きPythonをインストールしてください。')
    version='.'.join(map(str,sys.version_info[:3]))
    folder=ROOT/'.runtime'; folder.mkdir(exist_ok=True)
    package=folder/'tcltk.msi'; target=folder/'tk'
    url=f'https://www.python.org/ftp/python/{version}/amd64/tcltk.msi'
    with urllib.request.urlopen(url,timeout=60) as response:
        package.write_bytes(response.read())
    subprocess.run(['msiexec.exe','/a',str(package),'/qn','TARGETDIR='+str(target)],
                   check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    tcl=target/'tcl'
    for pattern in ('libtcl*.zip','libtk*.zip'):
        for archive in tcl.glob(pattern):
            with zipfile.ZipFile(archive) as z:
                # 公式アーカイブ内のパスも展開先に収まることを確認
                for name in z.namelist():
                    if not (tcl/name).resolve().is_relative_to(tcl.resolve()):
                        raise ValueError('展開先の外を指すパスです')
                z.extractall(tcl)
    print('Tcl/Tk ready. Run app.py again.')
