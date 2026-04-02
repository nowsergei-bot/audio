"""Общая конфигурация: пути, Whisper, сегментация, QLab."""

from __future__ import annotations

import sys
from pathlib import Path


def _project_root() -> Path:
    """Каталог данных: рядом с .app (портабельная папка) или Application Support."""
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable).resolve()
        if sys.platform == "darwin":
            # .../MyFolder/App.app/Contents/MacOS/App → MyFolder (запись рядом с бандлом)
            if exe.parent.name == "MacOS" and exe.parent.parent.name == "Contents":
                sibling = exe.parent.parent.parent.parent
                ap = str(sibling)
                if ap not in ("/Applications", "/System/Applications", "/"):
                    return sibling
            base = Path.home() / "Library/Application Support/AudioSegmentationQLab"
            base.mkdir(parents=True, exist_ok=True)
            return base
        # Windows / Linux: папка с exe (onedir)
        return exe.parent
    return Path(__file__).resolve().parent


PROJECT_ROOT = _project_root()

AUDIO_INPUT_DIR = PROJECT_ROOT / "audio_files"
SEGMENTED_OUTPUT_DIR = PROJECT_ROOT / "segmented_output"
CHILDREN_LIST_FILE = PROJECT_ROOT / "children_list.csv"
QLAB_OUTPUT_DIR = PROJECT_ROOT / "qlab_playlist"

WHISPER_MODEL = "base"
WHISPER_LANGUAGE = "ru"
# Ожидаемый формат речи: одно имя в начале фразы и одна фамилия в конце (один ребёнок на сегмент).
# Отчеств нет — только два слова.
MIN_WORDS_PER_SEGMENT = 2
MAX_WORDS_PER_SEGMENT = 2
MAX_GAP_BETWEEN_WORDS = 0.8

# Улучшенная нарезка: границы по тишине, буферы, fade, лимит длины
USE_ENHANCED_SEGMENTATION = True
SILENCE_THRESHOLD = 0.01
MIN_SILENCE_DURATION = 0.5
SEGMENT_BUFFER_BEFORE = 0.1
SEGMENT_BUFFER_AFTER = 0.3
MAX_SEGMENT_DURATION = 5.0
FADE_MS = 10.0

FUZZY_THRESHOLD = 80
EXPORT_FORMATS: list[str] = ["csv", "json", "cue", "applescript"]
CLASS_FILTER: str | None = None

LOG_FILE = PROJECT_ROOT / "segmentation.log"

# "auto" | "cuda" | "cpu"
DEVICE: str = "auto"

CONFIG: dict = {
    "input_directory": str(AUDIO_INPUT_DIR),
    "output_directory": str(SEGMENTED_OUTPUT_DIR),
    "audio_segments_dir": str(SEGMENTED_OUTPUT_DIR),
    "whisper_model": WHISPER_MODEL,
    "min_words_per_segment": MIN_WORDS_PER_SEGMENT,
    "max_words_per_segment": MAX_WORDS_PER_SEGMENT,
    "max_gap_between_words": MAX_GAP_BETWEEN_WORDS,
    "use_enhanced_segmentation": USE_ENHANCED_SEGMENTATION,
    "silence_threshold": SILENCE_THRESHOLD,
    "min_silence_duration": MIN_SILENCE_DURATION,
    "segment_buffer_before": SEGMENT_BUFFER_BEFORE,
    "segment_buffer_after": SEGMENT_BUFFER_AFTER,
    "max_segment_duration": MAX_SEGMENT_DURATION,
    "fade_ms": FADE_MS,
    "language": WHISPER_LANGUAGE,
    "log_file": str(LOG_FILE),
    "device": DEVICE,
    "children_list_file": str(CHILDREN_LIST_FILE),
    "qlab_output_directory": str(QLAB_OUTPUT_DIR),
    "class_audio_directory": "",
    "fuzzy_threshold": FUZZY_THRESHOLD,
    "export_formats": EXPORT_FORMATS,
    "class_filter": CLASS_FILTER,
}
