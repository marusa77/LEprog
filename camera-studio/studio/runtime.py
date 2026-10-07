import os
from pathlib import Path
from studio.config import ROOT

def prepare():
    tcl=ROOT/'.runtime'/'tk'/'tcl'
    for name,folder in [('TCL_LIBRARY','tcl_library'),('TK_LIBRARY','tk_library')]:
        if (tcl/folder).exists(): os.environ.setdefault(name,str(tcl/folder))
    cache=ROOT/'.runtime'/'matplotlib'
    cache.mkdir(parents=True,exist_ok=True)
    os.environ.setdefault('MPLCONFIGDIR',str(cache))
