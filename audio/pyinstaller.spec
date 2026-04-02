# -*- mode: python ; coding: utf-8 -*-
# Сборка: cd audio && source .venv/bin/activate && pip install -r requirements-build.txt && pyinstaller pyinstaller.spec
# PyInstaller выполняет spec через exec() — __file__ недоступен; путь к spec задаётся переменной SPEC.
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

SPEC_DIR = Path(os.path.dirname(os.path.abspath(SPEC)))

block_cipher = None

datas: list = []
binaries: list = []
hiddenimports: list = []

for pkg in ("whisper", "tiktoken"):
    try:
        datas += collect_data_files(pkg)
    except Exception:
        pass

try:
    hiddenimports += collect_submodules("whisper")
except Exception:
    hiddenimports.append("whisper")

for pkg in ("torch", "PyQt6"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

hiddenimports += [
    "librosa",
    "soundfile",
    "pandas",
    "openpyxl",
    "docx",
    "thefuzz",
    "Levenshtein",
    "numpy",
    "darkdetect",
    "AppKit",
    "objc",
]

a = Analysis(
    [str(SPEC_DIR / "main_gui.py")],
    pathex=[str(SPEC_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AudioSegmentationQLab",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="AudioSegmentationQLab",
)

app = BUNDLE(
    coll,
    name="AudioSegmentationQLab.app",
    icon=None,
    bundle_identifier="com.audioseg.qlab",
    info_plist={
        "NSHighResolutionCapable": True,
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleName": "AudioSegmentationQLab",
    },
)
