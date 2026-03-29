"""Автотесты логики сегментации (Whisper мокается)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf

from name_segmenter import (
    EnhancedAudioSegmenter,
    FileResult,
    NameSegmenter,
    SegmentInfo,
    build_processing_report,
    create_summary_report,
    detect_silence_regions,
    save_report,
)


@pytest.fixture
def segmenter():
    with patch("name_segmenter.whisper.load_model", return_value=MagicMock()):
        from config import CONFIG

        yield NameSegmenter.from_config(dict(CONFIG))


class TestCleanText:
    def test_cyrillic_preserved(self, segmenter: NameSegmenter) -> None:
        assert segmenter.clean_text("Иван Петров") == "Иван_Петров"

    def test_strips_invalid_filename_chars(self, segmenter: NameSegmenter) -> None:
        assert segmenter.clean_text('A/B:C') == "ABC"

    def test_empty_becomes_segment(self, segmenter: NameSegmenter) -> None:
        assert segmenter.clean_text("   ") == "segment"

    def test_truncates_long_string(self, segmenter: NameSegmenter) -> None:
        long = "а" * 300
        assert len(segmenter.clean_text(long)) == 180


class TestExtractSegmentAudio:
    def test_extracts_slice_from_wav_file(self, segmenter: NameSegmenter, tmp_path: Path) -> None:
        wav = tmp_path / "t.wav"
        y = np.zeros(32000, dtype=np.float32)
        sf.write(str(wav), y, 16000)
        out = segmenter.extract_segment_audio(wav, 0.5, 1.0)
        assert len(out) == 8000

    def test_zero_length_expands_to_one_sample(self, segmenter: NameSegmenter, tmp_path: Path) -> None:
        wav = tmp_path / "t.wav"
        y = np.ones(16000, dtype=np.float32)
        sf.write(str(wav), y, 16000)
        out = segmenter.extract_segment_audio(wav, 0.5, 0.5)
        assert len(out) == 1


class TestCollectWords:
    def test_word_level(self, segmenter: NameSegmenter) -> None:
        result = {
            "segments": [
                {
                    "words": [
                        {"word": " Иван ", "start": 0.0, "end": 0.3},
                        {"word": "Петров", "start": 0.4, "end": 0.8},
                    ]
                }
            ]
        }
        words = segmenter._collect_words(result)
        assert len(words) == 2
        assert words[0]["word"] == "Иван"
        assert words[1]["word"] == "Петров"

    def test_fallback_whole_segment(self, segmenter: NameSegmenter) -> None:
        result = {"segments": [{"text": "Иван Петров", "start": 1.0, "end": 2.0, "words": None}]}
        words = segmenter._collect_words(result)
        assert len(words) == 1
        assert words[0]["word"] == "Иван Петров"


class TestSilenceAndEnhancer:
    def test_detect_silence_all_quiet(self) -> None:
        y = np.zeros(16000 * 2, dtype=np.float32)
        reg = detect_silence_regions(y, 16000, min_silence_duration=0.3)
        assert reg
        assert reg[0][0] == 0.0
        assert reg[0][1] >= 1.9

    def test_segment_buffer_caps_at_next_silence(self) -> None:
        enh = EnhancedAudioSegmenter(buffer_before=0.1, buffer_after=0.3)
        sil = [(1.0, 1.6), (2.5, 3.0)]
        s, e = enh.segment_with_silence_buffer(
            0.5,
            1.2,
            sil,
            next_segment_start_hint=2.4,
            audio_duration=10.0,
            sample_rate=16000,
        )
        assert s >= 0.0
        assert e <= 2.38


class TestGroupWordsIntoNames:
    def test_three_children_by_pause(self, segmenter: NameSegmenter) -> None:
        w = [
            {"word": "Иван", "start": 0.0, "end": 0.4},
            {"word": "Петров", "start": 0.45, "end": 0.9},
            {"word": "Мария", "start": 2.0, "end": 2.5},
            {"word": "Сидорова", "start": 2.55, "end": 3.0},
            {"word": "Алексей", "start": 4.0, "end": 4.4},
            {"word": "Смирнов", "start": 4.45, "end": 5.0},
        ]
        groups = segmenter.group_words_into_names(w)
        assert len(groups) == 3
        assert [x["word"] for x in groups[0]] == ["Иван", "Петров"]
        assert [x["word"] for x in groups[1]] == ["Мария", "Сидорова"]
        assert [x["word"] for x in groups[2]] == ["Алексей", "Смирнов"]

    def test_empty_returns_empty(self, segmenter: NameSegmenter) -> None:
        assert segmenter.group_words_into_names([]) == []

    def test_sorts_by_start(self, segmenter: NameSegmenter) -> None:
        w = [
            {"word": "B", "start": 1.0, "end": 1.2},
            {"word": "A", "start": 0.0, "end": 0.5},
        ]
        groups = segmenter.group_words_into_names(w)
        assert len(groups) == 1
        assert [x["word"] for x in groups[0]] == ["A", "B"]


class TestCreateSummaryReport:
    def test_contains_stats_and_paths(self) -> None:
        report = {
            "generated_at": "2026-01-01T12:00:00",
            "stats": {
                "success_count": 2,
                "error_count": 1,
                "total_segments": 5,
            },
            "files": [
                {
                    "path": "/a.wav",
                    "class_name": "5A",
                    "success": True,
                    "full_text": "Иван",
                    "segments_formed": 1,
                    "error": None,
                },
                {
                    "path": "/b.wav",
                    "class_name": "5B",
                    "success": False,
                    "full_text": "",
                    "segments_formed": 0,
                    "error": "fail",
                },
            ],
        }
        txt = create_summary_report(report)
        assert "Успешно обработано файлов: 2" in txt
        assert "Ошибок: 1" in txt
        assert "[OK]" in txt
        assert "[ОШИБКА]" in txt
        assert "fail" in txt


class TestSaveReport:
    def test_writes_json_and_txt(self, segmenter: NameSegmenter, tmp_path: Path) -> None:
        segmenter.file_results = [
            FileResult(
                success=True,
                file="/x/a.wav",
                class_name="5A",
                full_text="Иван Петров",
                word_count=2,
                segments_formed=1,
                segments=[
                    SegmentInfo(
                        index=1,
                        text="Иван Петров",
                        filename="01_Иван_Петров.wav",
                        path="/abs/01_Иван_Петров.wav",
                        start=0.0,
                        end=1.0,
                        duration=1.0,
                    )
                ],
            )
        ]
        rep = build_processing_report(segmenter.file_results, "t0", "t1")
        json_path = save_report(rep, tmp_path)
        assert json_path == tmp_path / "processing_report.json"
        assert (tmp_path / "processing_report.txt").exists()
        data = json.loads(json_path.read_text(encoding="utf-8"))
        assert data["stats"]["success_count"] == 1
        assert data["stats"]["total_segments"] == 1
        assert data["files"][0]["segments"][0]["text"] == "Иван Петров"


class TestProcessFileIntegration:
    def test_saves_wav_segments(self, tmp_path: Path) -> None:
        wav_path = tmp_path / "5A_test.wav"
        y = np.zeros(int(16000 * 2.0), dtype=np.float32)
        sf.write(str(wav_path), y, 16000)

        transcribe_result = {
            "text": "Иван Петров Мария Сидорова",
            "segments": [
                {
                    "words": [
                        {"word": "Иван", "start": 0.1, "end": 0.4},
                        {"word": "Петров", "start": 0.45, "end": 0.9},
                        {"word": "Мария", "start": 2.0, "end": 2.4},
                        {"word": "Сидорова", "start": 2.45, "end": 2.9},
                    ]
                }
            ],
        }

        out_root = tmp_path / "out"
        cfg = {
            "output_directory": str(out_root),
            "whisper_model": "base",
            "min_words_per_segment": 2,
            "max_words_per_segment": 2,
            "max_gap_between_words": 0.8,
            "language": "ru",
            "device": "cpu",
        }

        with patch("name_segmenter.whisper.load_model", return_value=MagicMock()):
            seg = NameSegmenter.from_config(cfg)

            def _fake(_audio: np.ndarray) -> dict:
                return transcribe_result

            seg._transcribe_numpy = _fake  # type: ignore[method-assign]

            fr = seg.process_file(wav_path, out_root)

        assert fr.success
        assert fr.segments_formed == 2
        class_dir = out_root / "5A_test"
        assert class_dir.is_dir()
        assert len(list(class_dir.glob("*.wav"))) == 2
