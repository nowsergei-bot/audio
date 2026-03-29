#!/usr/bin/env python3
"""
Транскрибация и сегментация аудио по классам.

Каждый вырезанный сегмент рассчитан на запись одного ребёнка: в начале произносится
имя, в конце — фамилия (ровно два слова, без отчества). Между детьми должна быть
заметная пауза — иначе слова сольются в один сегмент.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf
import torch
import whisper
from tqdm import tqdm

from config import CONFIG

INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
SR = 16000
DEFAULT_FRAME_LENGTH = 2048
DEFAULT_HOP_LENGTH = 512


def _frame_time_start(frame_idx: int, hop_length: int, sample_rate: int) -> float:
    return float(frame_idx * hop_length / sample_rate)


def detect_silence_regions(
    audio: np.ndarray,
    sample_rate: int,
    *,
    silence_threshold: float = 0.01,
    min_silence_duration: float = 0.5,
    frame_length: int = DEFAULT_FRAME_LENGTH,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> list[tuple[float, float]]:
    """Регионы устойчивой тишины по нормализованному RMS (как в спецификации)."""
    if audio.size == 0:
        return []
    y = np.asarray(audio, dtype=np.float32).reshape(-1)
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    peak = float(np.max(rms)) if rms.size else 0.0
    if peak <= 1e-12:
        return [(0.0, float(len(y) / sample_rate))]
    norm = rms / peak
    mask = norm < float(silence_threshold)
    regions: list[tuple[float, float]] = []
    in_silence = False
    start_frame = 0
    n_frames = len(mask)
    for i in range(n_frames):
        silent = bool(mask[i])
        if silent and not in_silence:
            start_frame = i
            in_silence = True
        elif not silent and in_silence:
            t0 = _frame_time_start(start_frame, hop_length, sample_rate)
            t1 = _frame_time_start(i, hop_length, sample_rate)
            if t1 - t0 >= min_silence_duration:
                regions.append((t0, t1))
            in_silence = False
    if in_silence:
        t0 = _frame_time_start(start_frame, hop_length, sample_rate)
        t1 = float(len(y) / sample_rate)
        if t1 - t0 >= min_silence_duration:
            regions.append((t0, t1))
    return regions


def apply_linear_fade_inplace(signal: np.ndarray, sample_rate: int, fade_ms: float) -> None:
    """Линейный fade in/out на концах (10 ms по умолчанию)."""
    n = int(round(sample_rate * fade_ms / 1000.0))
    if n <= 0 or signal.size == 0:
        return
    n = min(n, signal.size // 2)
    if n <= 0:
        return
    ramp_in = np.linspace(0.0, 1.0, n, dtype=np.float32, endpoint=False)
    ramp_out = np.linspace(1.0, 0.0, n, dtype=np.float32, endpoint=False)
    signal[:n] *= ramp_in
    signal[-n:] *= ramp_out


class EnhancedAudioSegmenter:
    """Расширение границ сегмента до тишины и буферы до/после (без обрезки на речи следующего ребёнка)."""

    def __init__(
        self,
        silence_threshold: float = 0.01,
        min_silence_duration: float = 0.5,
        buffer_before: float = 0.1,
        buffer_after: float = 0.3,
        max_segment_duration: float = 5.0,
        fade_ms: float = 10.0,
        frame_length: int = DEFAULT_FRAME_LENGTH,
        hop_length: int = DEFAULT_HOP_LENGTH,
    ) -> None:
        self.silence_threshold = silence_threshold
        self.min_silence_duration = min_silence_duration
        self.buffer_before = buffer_before
        self.buffer_after = buffer_after
        self.max_segment_duration = max_segment_duration
        self.fade_ms = fade_ms
        self.frame_length = frame_length
        self.hop_length = hop_length

    def detect_silence_regions(self, audio: np.ndarray, sample_rate: int) -> list[tuple[float, float]]:
        return detect_silence_regions(
            audio,
            sample_rate,
            silence_threshold=self.silence_threshold,
            min_silence_duration=self.min_silence_duration,
            frame_length=self.frame_length,
            hop_length=self.hop_length,
        )

    def segment_with_silence_buffer(
        self,
        start: float,
        end: float,
        silence_regions: list[tuple[float, float]],
        *,
        prev_segment_end_hint: float = 0.0,
        next_segment_start_hint: float | None = None,
        audio_duration: float | None = None,
        sample_rate: int = SR,
    ) -> tuple[float, float]:
        extended_start = float(start)
        extended_end = float(end)
        best_before: tuple[float, float] | None = None
        for silence_start, silence_end in silence_regions:
            if silence_end <= start and start - silence_end < 1.0:
                if best_before is None or silence_end > best_before[1]:
                    best_before = (silence_start, silence_end)
        if best_before is not None:
            _, silence_end = best_before
            extended_start = max(extended_start - self.buffer_before, silence_end)
        else:
            extended_start = max(0.0, extended_start - self.buffer_before)

        best_after: tuple[float, float] | None = None
        for silence_start, silence_end in silence_regions:
            if silence_start >= end and silence_start - end < 1.0:
                if best_after is None or silence_start < best_after[0]:
                    best_after = (silence_start, silence_end)
        if best_after is not None:
            silence_start, _ = best_after
            extended_end = min(extended_end + self.buffer_after, silence_start)
        else:
            extended_end = extended_end + self.buffer_after

        lo = max(0.0, prev_segment_end_hint + 0.02)
        extended_start = max(extended_start, lo)
        if next_segment_start_hint is not None:
            hi = max(lo, next_segment_start_hint - 0.02)
            extended_end = min(extended_end, hi)

        if extended_end <= extended_start:
            extended_start = float(start)
            extended_end = max(float(end), extended_start + 1.0 / max(sample_rate, 1))
            if audio_duration is not None:
                extended_end = min(extended_end, audio_duration)

        return extended_start, extended_end

    def split_long_segment_at_silence(
        self,
        group: list[dict[str, Any]],
        seg_start: float,
        seg_end: float,
        silence_regions: list[tuple[float, float]],
    ) -> list[tuple[float, float]]:
        """Если сегмент длиннее max_segment_duration — делим по тишине (не режем паузу между двумя словами одного ребёнка)."""
        max_dur = self.max_segment_duration
        if seg_end - seg_start <= max_dur:
            return [(seg_start, seg_end)]
        w0e = float(group[0]["end"])
        wns = float(group[-1]["start"])
        protected_lo, protected_hi = w0e, wns
        mid = (seg_start + seg_end) / 2.0
        log = logging.getLogger(__name__)
        candidates: list[tuple[float, float, float]] = []
        for ss, se in silence_regions:
            if ss < seg_start or se > seg_end:
                continue
            if se - ss < self.min_silence_duration:
                continue
            if len(group) == 2 and ss >= protected_lo - 0.05 and se <= protected_hi + 0.05:
                continue
            split_t = (ss + se) / 2.0
            if split_t <= seg_start + 0.05 or split_t >= seg_end - 0.05:
                continue
            candidates.append((ss, se, split_t))
        if not candidates:
            log.warning(
                "Сегмент %.2f–%.2f с (%.2f с): нет тишины для разделения, обрезка по лимиту",
                seg_start,
                seg_end,
                seg_end - seg_start,
            )
            return [(seg_start, min(seg_end, seg_start + max_dur))]
        _, _, split_t = min(candidates, key=lambda x: abs(x[2] - mid))
        return [(seg_start, split_t), (split_t, seg_end)]

    def segment_ends_in_silence(
        self,
        end_time: float,
        audio: np.ndarray,
        sample_rate: int,
        silence_regions: list[tuple[float, float]],
    ) -> bool:
        tail = 0.08
        win_start = max(0.0, end_time - tail)
        i0 = int(win_start * sample_rate)
        i1 = min(len(audio), int(end_time * sample_rate))
        if i1 <= i0:
            return True
        chunk = np.asarray(audio[i0:i1], dtype=np.float32)
        rms = float(np.sqrt(np.mean(chunk**2)))
        full = np.asarray(audio, dtype=np.float32)
        full_rms = float(np.sqrt(np.mean(full**2)))
        ref = max(full_rms, 1e-6)
        if rms / ref <= max(self.silence_threshold * 4, 0.08):
            return True
        for ss, se in silence_regions:
            if ss - 0.02 <= end_time <= se + 0.02:
                return True
        return False


def resolve_whisper_device(device: str | None) -> str:
    if device and device not in ("auto", ""):
        return device
    return "cuda" if torch.cuda.is_available() else "cpu"


@dataclass
class SegmentInfo:
    index: int
    text: str
    filename: str
    path: str
    start: float
    end: float
    duration: float
    ends_in_silence: bool = True


@dataclass
class FileResult:
    success: bool
    file: str
    class_name: str
    full_text: str
    word_count: int
    segments_formed: int
    segments: list[SegmentInfo] = field(default_factory=list)
    error: str | None = None
    processed_at: str = ""


@dataclass
class ProcessingReport:
    total_files: int
    successful_files: int
    failed_files: int
    total_segments: int
    file_results: list[FileResult]
    started_at: str
    completed_at: str


def setup_logging(log_path: str | Path | None) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if log_path:
        handlers.append(logging.FileHandler(str(log_path), encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
        force=True,
    )


def create_summary_report(report: dict[str, Any]) -> str:
    """Текстовый отчёт (совместимость со старым форматом stats + files)."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("ОТЧЁТ ОБ ОБРАБОТКЕ АУДИО")
    lines.append(f"Создан: {report.get('generated_at', '')}")
    lines.append("=" * 60)
    stats = report.get("stats", {})
    lines.append(f"Успешно обработано файлов: {stats.get('success_count', 0)}")
    lines.append(f"Ошибок: {stats.get('error_count', 0)}")
    lines.append(f"Всего сегментов (имён): {stats.get('total_segments', 0)}")
    lines.append("")
    lines.append("Детали по файлам:")
    lines.append("-" * 60)
    for fr in report.get("files", []):
        status = "OK" if fr.get("success") else "ОШИБКА"
        path = fr.get("path") or fr.get("file", "")
        lines.append(f"[{status}] {path}")
        lines.append(f"  Класс: {fr.get('class_name', '')}")
        if fr.get("success"):
            ft = fr.get("full_text", "") or ""
            lines.append(f"  Текст: {ft[:200]}{'...' if len(ft) > 200 else ''}")
            lines.append(f"  Сегментов: {fr.get('segments_formed', 0)}")
        else:
            lines.append(f"  Ошибка: {fr.get('error', '')}")
        lines.append("")
    return "\n".join(lines)


def build_processing_report(
    file_results: list[FileResult],
    started_at: str,
    completed_at: str,
) -> ProcessingReport:
    ok = sum(1 for f in file_results if f.success)
    fail = len(file_results) - ok
    total_seg = sum(len(f.segments) for f in file_results if f.success)
    return ProcessingReport(
        total_files=len(file_results),
        successful_files=ok,
        failed_files=fail,
        total_segments=total_seg,
        file_results=file_results,
        started_at=started_at,
        completed_at=completed_at,
    )


def save_report(report: ProcessingReport, output_dir: Path | str) -> Path:
    """Сохранение JSON и TXT отчётов."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    completed = report.completed_at or datetime.now().isoformat(timespec="seconds")

    files_json: list[dict[str, Any]] = []
    for f in report.file_results:
        fd = asdict(f)
        fd["segments"] = [asdict(s) for s in f.segments]
        files_json.append(fd)

    legacy: dict[str, Any] = {
        "generated_at": completed,
        "stats": {
            "success_count": report.successful_files,
            "error_count": report.failed_files,
            "total_segments": report.total_segments,
        },
        "files": [
            {
                "path": fr.file,
                "file": fr.file,
                "class_name": fr.class_name,
                "success": fr.success,
                "full_text": fr.full_text,
                "word_count": fr.word_count,
                "segments_formed": fr.segments_formed,
                "error": fr.error,
                "processed_at": fr.processed_at,
                "segments": [asdict(s) for s in fr.segments],
            }
            for fr in report.file_results
        ],
        "processing_report": {
            "started_at": report.started_at,
            "completed_at": report.completed_at,
            "total_files": report.total_files,
        },
    }

    json_path = out / "processing_report.json"
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(legacy, jf, ensure_ascii=False, indent=2)

    txt_lines = [
        "=" * 60,
        "ОТЧЁТ ОБ ОБРАБОТКЕ АУДИО",
        f"Начало: {report.started_at}",
        f"Завершено: {report.completed_at}",
        "=" * 60,
        f"Всего файлов: {report.total_files}",
        f"Успешно: {report.successful_files}",
        f"Ошибок: {report.failed_files}",
        f"Всего сегментов: {report.total_segments}",
        "",
    ]
    for fr in report.file_results:
        txt_lines.append(f"Файл: {fr.file} | класс: {fr.class_name}")
        if fr.success:
            txt_lines.append(f"  сегментов: {fr.segments_formed}, слов: {fr.word_count}")
        else:
            txt_lines.append(f"  ошибка: {fr.error}")
    txt_path = out / "processing_report.txt"
    with open(txt_path, "w", encoding="utf-8") as tf:
        tf.write("\n".join(txt_lines) + "\n")

    return json_path


class NameSegmenter:
    """Whisper + группировка слов в сегменты по паузам (имя в начале, фамилия в конце)."""

    def __init__(
        self,
        whisper_model: str = "base",
        min_words_per_segment: int = 2,
        max_words_per_segment: int = 3,
        max_gap_between_words: float = 0.8,
        *,
        language: str = "ru",
        device: str | None = "auto",
        input_directory: str | None = None,
        output_directory: str | None = None,
        use_enhanced_segmentation: bool = True,
        silence_threshold: float = 0.01,
        min_silence_duration: float = 0.5,
        segment_buffer_before: float = 0.1,
        segment_buffer_after: float = 0.3,
        max_segment_duration: float = 5.0,
        fade_ms: float = 10.0,
    ) -> None:
        self.logger = logging.getLogger(__name__)
        self.whisper_model = whisper_model
        self.min_words_per_segment = min_words_per_segment
        self.max_words_per_segment = max_words_per_segment
        self.max_gap_between_words = max_gap_between_words
        self.language = language
        self.device = resolve_whisper_device(device)
        self.input_directory = input_directory
        self.output_directory = output_directory
        self.use_enhanced_segmentation = use_enhanced_segmentation
        self._enhancer = EnhancedAudioSegmenter(
            silence_threshold=silence_threshold,
            min_silence_duration=min_silence_duration,
            buffer_before=segment_buffer_before,
            buffer_after=segment_buffer_after,
            max_segment_duration=max_segment_duration,
            fade_ms=fade_ms,
        )
        self.model = whisper.load_model(whisper_model, device=self.device)
        self.file_results: list[FileResult] = []

    @classmethod
    def from_config(cls, cfg: dict[str, Any] | None = None) -> NameSegmenter:
        c = dict(cfg or CONFIG)
        return cls(
            whisper_model=c.get("whisper_model", "base"),
            min_words_per_segment=int(c.get("min_words_per_segment", 2)),
            max_words_per_segment=int(c.get("max_words_per_segment", 3)),
            max_gap_between_words=float(c.get("max_gap_between_words", 0.8)),
            language=c.get("language", "ru"),
            device=c.get("device", "auto"),
            input_directory=c.get("input_directory"),
            output_directory=c.get("output_directory"),
            use_enhanced_segmentation=bool(c.get("use_enhanced_segmentation", True)),
            silence_threshold=float(c.get("silence_threshold", 0.01)),
            min_silence_duration=float(c.get("min_silence_duration", 0.5)),
            segment_buffer_before=float(c.get("segment_buffer_before", 0.1)),
            segment_buffer_after=float(c.get("segment_buffer_after", 0.3)),
            max_segment_duration=float(c.get("max_segment_duration", 5.0)),
            fade_ms=float(c.get("fade_ms", 10.0)),
        )

    def _config_dict(self) -> dict[str, Any]:
        return {
            "min_words_per_segment": self.min_words_per_segment,
            "max_words_per_segment": self.max_words_per_segment,
            "max_gap_between_words": self.max_gap_between_words,
            "language": self.language,
        }

    def transcribe_with_timestamps(self, audio_path: Path | str) -> dict[str, Any]:
        """Транскрибация файла с метками слов."""
        y, _sr = librosa.load(str(audio_path), sr=SR, mono=True)
        audio = y.astype(np.float32)
        return self.model.transcribe(
            audio,
            language=self.language,
            word_timestamps=True,
            verbose=False,
        )

    def _transcribe_numpy(self, audio: np.ndarray) -> dict[str, Any]:
        return self.model.transcribe(
            audio.astype(np.float32),
            language=self.language,
            word_timestamps=True,
            verbose=False,
        )

    def _collect_words(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        words: list[dict[str, Any]] = []
        for seg in result.get("segments") or []:
            for w in seg.get("words") or []:
                text = (w.get("word") or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "word": text,
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                    }
                )
        if words:
            return words
        for seg in result.get("segments") or []:
            t = (seg.get("text") or "").strip()
            if t:
                words.append(
                    {
                        "word": t,
                        "start": float(seg["start"]),
                        "end": float(seg["end"]),
                    }
                )
        return words

    def group_words_into_names(self, words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        min_w = self.min_words_per_segment
        max_w = self.max_words_per_segment
        max_gap = self.max_gap_between_words

        if not words:
            return []

        words = sorted(words, key=lambda x: x["start"])
        groups: list[list[dict[str, Any]]] = []
        current = [words[0]]
        for i in range(1, len(words)):
            gap = words[i]["start"] - words[i - 1]["end"]
            if gap > max_gap:
                groups.append(current)
                current = [words[i]]
            else:
                current.append(words[i])
        groups.append(current)

        merged = self._merge_single_word_groups(groups, min_w, max_w)

        final: list[list[dict[str, Any]]] = []
        for g in merged:
            if len(g) > max_w:
                idx = 0
                while idx < len(g):
                    chunk = g[idx : idx + max_w]
                    idx += max_w
                    if len(chunk) < min_w and final:
                        final[-1].extend(chunk)
                    else:
                        final.append(chunk)
            else:
                final.append(g)

        out: list[list[dict[str, Any]]] = []
        for g in final:
            if len(g) >= min_w:
                out.append(g)
            else:
                self.logger.warning(
                    "Пропуск сегмента из %d слов (минимум %d): %s",
                    len(g),
                    min_w,
                    " ".join(x["word"] for x in g),
                )
        return out

    def _merge_single_word_groups(
        self,
        groups: list[list[dict[str, Any]]],
        min_w: int,
        max_w: int,
    ) -> list[list[dict[str, Any]]]:
        if not groups:
            return []
        result = list(groups)
        i = 0
        while i < len(result):
            if len(result[i]) != 1:
                i += 1
                continue
            single = result[i]
            merged_here = False
            if i + 1 < len(result) and len(single) + len(result[i + 1]) <= max_w:
                result[i + 1] = single + result[i + 1]
                result.pop(i)
                merged_here = True
            elif i > 0 and len(result[i - 1]) + len(single) <= max_w:
                result[i - 1].extend(single)
                result.pop(i)
                merged_here = True
            if not merged_here:
                self.logger.warning("Одиночное слово без слияния: %s", single[0]["word"])
                i += 1
        return result

    def clean_text(self, text: str) -> str:
        t = text.strip()
        t = re.sub(r"\s+", "_", t)
        t = INVALID_FILENAME_CHARS.sub("", t)
        t = t.strip("._")
        if not t:
            t = "segment"
        return t[:180]

    def extract_segment_audio(
        self,
        audio_path: Path | str,
        start: float,
        end: float,
    ) -> np.ndarray:
        """Вырезка фрагмента по времени (моно, 16 кГц)."""
        y, sr = librosa.load(str(audio_path), sr=SR, mono=True)
        return self._extract_segment_from_array(y, sr, start, end)

    def _extract_segment_from_array(
        self,
        y: np.ndarray,
        sr: int,
        start: float,
        end: float,
    ) -> np.ndarray:
        i0 = max(0, int(round(start * sr)))
        i1 = min(len(y), int(round(end * sr)))
        if i1 <= i0:
            i1 = min(len(y), i0 + 1)
        return y[i0:i1].copy()

    def process_file(
        self,
        audio_path: Path | str,
        output_dir: Path | str,
        class_name: str | None = None,
    ) -> FileResult:
        """Обработка одного аудиофайла; сегменты в output_dir / class_name /."""
        path = Path(audio_path)
        out_root = Path(output_dir)
        cn = class_name if class_name is not None else path.stem
        now = datetime.now().isoformat(timespec="seconds")
        fr = FileResult(
            success=False,
            file=str(path.resolve()),
            class_name=cn,
            full_text="",
            word_count=0,
            segments_formed=0,
            processed_at=now,
        )

        try:
            y, sr = librosa.load(str(path), sr=SR, mono=True)
            audio = y.astype(np.float32)

            self.logger.info("Транскрибация: %s", path.name)
            result = self._transcribe_numpy(audio)
            fr.full_text = (result.get("text") or "").strip()

            words = self._collect_words(result)
            fr.word_count = len(words)

            name_groups = self.group_words_into_names(words)

            safe_class = self.clean_text(cn)
            class_dir = out_root / safe_class
            class_dir.mkdir(parents=True, exist_ok=True)

            used_names: dict[str, int] = {}
            enhancer = self._enhancer if self.use_enhanced_segmentation else None
            silence_regions: list[tuple[float, float]] = []
            if enhancer is not None:
                silence_regions = enhancer.detect_silence_regions(audio, sr)
            audio_duration = float(len(y) / sr)

            out_index = 0
            for i, group in enumerate(name_groups):
                idx = i + 1
                text_plain = " ".join(w["word"] for w in group).strip()
                raw_start = float(group[0]["start"])
                raw_end = float(group[-1]["end"])

                if enhancer is not None:
                    prev_hint = float(name_groups[i - 1][-1]["end"]) if i > 0 else 0.0
                    next_hint = (
                        float(name_groups[i + 1][0]["start"])
                        if i + 1 < len(name_groups)
                        else None
                    )
                    adj_start, adj_end = enhancer.segment_with_silence_buffer(
                        raw_start,
                        raw_end,
                        silence_regions,
                        prev_segment_end_hint=prev_hint,
                        next_segment_start_hint=next_hint,
                        audio_duration=audio_duration,
                        sample_rate=sr,
                    )
                    time_spans = enhancer.split_long_segment_at_silence(
                        group, adj_start, adj_end, silence_regions
                    )
                else:
                    time_spans = [(raw_start, raw_end)]

                base = self.clean_text(text_plain)
                key = base.lower()
                used_names[key] = used_names.get(key, 0) + 1
                if used_names[key] > 1:
                    base = f"{base}_{used_names[key]}"

                for part_i, (start_t, end_t) in enumerate(time_spans):
                    out_index += 1
                    duration = max(0.0, end_t - start_t)
                    suffix = "" if len(time_spans) == 1 else f"_{part_i + 1}"
                    fname = f"{idx:02d}{suffix}_{base}.wav"
                    safe_fname = self.clean_text(fname.replace(".wav", "")) + ".wav"
                    out_path = class_dir / safe_fname

                    segment_audio = self._extract_segment_from_array(y, sr, start_t, end_t)
                    if enhancer is not None and enhancer.fade_ms > 0:
                        apply_linear_fade_inplace(
                            segment_audio, sr, float(enhancer.fade_ms)
                        )
                    sf.write(str(out_path), segment_audio, sr)

                    ends_ok = True
                    if enhancer is not None:
                        ends_ok = enhancer.segment_ends_in_silence(
                            end_t, y, sr, silence_regions
                        )
                        if not ends_ok:
                            self.logger.warning(
                                "Сегмент %s: конец %.3f с может не попадать в тишину",
                                safe_fname,
                                end_t,
                            )

                    abs_p = str(out_path.resolve())
                    fr.segments.append(
                        SegmentInfo(
                            index=out_index,
                            text=text_plain,
                            filename=safe_fname,
                            path=abs_p,
                            start=start_t,
                            end=end_t,
                            duration=duration,
                            ends_in_silence=ends_ok,
                        )
                    )

            fr.segments_formed = len(fr.segments)

            fr.success = True
            fr.processed_at = datetime.now().isoformat(timespec="seconds")
        except Exception as e:
            fr.error = str(e)
            self.logger.exception("Ошибка обработки %s: %s", path, e)

        self.file_results.append(fr)
        return fr

    def process_directory(self, input_dir: Path | str, output_dir: Path | str) -> None:
        root = Path(input_dir)
        out = Path(output_dir)
        exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
        files = sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in exts)
        if not files:
            self.logger.warning("В каталоге %s нет поддерживаемых файлов.", root)
            return

        for fp in tqdm(files, desc="Файлы", unit="файл"):
            self.process_file(fp, out)


def print_file_banner(index: int, total: int, file_path: Path, class_name: str) -> None:
    tqdm.write("")
    tqdm.write(f"[{index}/{total}]")
    tqdm.write("=" * 60)
    tqdm.write(f"📁 Файл: {file_path.name}")
    tqdm.write(f"🏫 Класс: {class_name}")
    tqdm.write("=" * 60)


def print_file_result(fr: FileResult) -> None:
    if not fr.success:
        tqdm.write(f"❌ Ошибка: {fr.error}")
        return
    tqdm.write("🎤 Транскрибация...")
    tqdm.write(f"📝 Полный текст: {fr.full_text}")
    tqdm.write(f"🔤 Найдено слов: {fr.word_count}")
    tqdm.write(f"👥 Сформировано сегментов: {fr.segments_formed}")
    for s in fr.segments:
        tqdm.write(f"  ✓ #{s.index}: {s.text} ({s.duration:.2f}s)")


def main() -> int:
    cfg = dict(CONFIG)
    setup_logging(cfg.get("log_file"))

    dev = resolve_whisper_device(cfg.get("device"))
    tqdm.write("")
    tqdm.write("=" * 60)
    tqdm.write("🎙️  ТРАНСКРИБАЦИЯ И СЕГМЕНТАЦИЯ АУДИО С ИМЕНАМИ")
    tqdm.write("=" * 60)
    tqdm.write(f"🔧 Используемое устройство: {dev}")
    tqdm.write("⏳ Загрузка модели Whisper (%s)..." % cfg.get("whisper_model", "base"))
    segmenter = NameSegmenter.from_config(cfg)
    tqdm.write("✅ Модель загружена")
    tqdm.write("")

    input_path = Path(cfg["input_directory"])
    output_path = Path(cfg["output_directory"])
    if not input_path.is_dir():
        logging.error("Входная директория не найдена: %s", input_path)
        return 1

    exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
    files = sorted(p for p in input_path.iterdir() if p.is_file() and p.suffix.lower() in exts)
    total = len(files)
    if total == 0:
        tqdm.write("⚠️  Нет аудиофайлов в каталоге.")
        return 0

    tqdm.write("#" * 68)
    tqdm.write(f"🎯 НАЙДЕНО АУДИОФАЙЛОВ: {total}")
    tqdm.write("#" * 68)

    started_at = datetime.now().isoformat(timespec="seconds")
    pbar = tqdm(files, desc="📁 Обработка файлов", unit="файл", file=sys.stdout)
    for i, fp in enumerate(pbar, start=1):
        print_file_banner(i, total, fp, fp.stem)
        fr = segmenter.process_file(fp, output_path)
        print_file_result(fr)

    completed_at = datetime.now().isoformat(timespec="seconds")
    report = build_processing_report(segmenter.file_results, started_at, completed_at)
    save_report(report, output_path)

    tqdm.write("")
    tqdm.write("=" * 60)
    tqdm.write("📊 ИТОГОВАЯ СТАТИСТИКА")
    tqdm.write("=" * 60)
    tqdm.write(f"✅ Успешно: {report.successful_files} файлов")
    tqdm.write(f"❌ Ошибки: {report.failed_files} файлов")
    tqdm.write(f"👥 Всего сегментов: {report.total_segments}")
    tqdm.write("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
