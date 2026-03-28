"""Тесты генератора плейлиста QLab (без реальных аудио каталогов)."""

from __future__ import annotations

import json
from pathlib import Path

from qlab_playlist_generator import PlaylistCueRow, QLabPlaylistGenerator


def test_filename_to_label() -> None:
    g = QLabPlaylistGenerator(
        children_list_file=Path("x.csv"),
        audio_segments_dir=Path("seg"),
        output_directory=Path("out"),
    )
    assert g.filename_to_label("01_Иван_Петров") == "Иван Петров"
    assert g.filename_to_label("Иван_Петров") == "Иван Петров"


def test_calculate_match_score() -> None:
    g = QLabPlaylistGenerator(
        children_list_file=Path("x.csv"),
        audio_segments_dir=Path("seg"),
        output_directory=Path("out"),
    )
    assert g.calculate_match_score("Иван Петров", "иван петров") == 100
    assert g.calculate_match_score("Иван Петров", "Петров Иван") >= 90


def test_match_names_order_and_threshold(tmp_path: Path) -> None:
    csv_path = tmp_path / "children.csv"
    csv_path.write_text(
        "№,Фамилия,Имя,Класс,Примечание\n"
        "1,Петров,Иван,5A_test,\n"
        "2,Сидорова,Мария,5A_test,\n",
        encoding="utf-8-sig",
    )

    seg_dir = tmp_path / "segmented_output" / "5A_test"
    seg_dir.mkdir(parents=True)
    # минимальные wav-файлы
    import numpy as np
    import soundfile as sf

    for name, stem in [
        ("01_Иван_Петров.wav", "01_Иван_Петров"),
        ("02_Мария_Сидорова.wav", "02_Мария_Сидорова"),
    ]:
        p = seg_dir / name
        sf.write(str(p), np.zeros(800, dtype=np.float32), 16000)

    gen = QLabPlaylistGenerator(
        children_list_file=csv_path,
        audio_segments_dir=tmp_path / "segmented_output",
        output_directory=tmp_path / "qlab_out",
        fuzzy_threshold=80,
    )
    gen.load_children_list()
    gen.scan_audio_segments()
    rows = gen.match_names()

    assert len(rows) == 2
    assert rows[0].matched_path
    assert rows[1].matched_path
    assert rows[0].q_color == "none"
    assert "Иван" in rows[0].matched_file or "иван" in rows[0].matched_file.lower()


def test_export_formats(tmp_path: Path) -> None:
    gen = QLabPlaylistGenerator(
        children_list_file=tmp_path / "c.csv",
        audio_segments_dir=tmp_path / "s",
        output_directory=tmp_path / "out",
    )
    gen.playlist_rows = [
        PlaylistCueRow(
            child_number=1,
            surname="Петров",
            name="Иван",
            class_name="5A",
            notes="",
            matched_file="01.wav",
            matched_path=str((tmp_path / "01.wav").resolve()),
            duration=1.5,
            match_score=100,
            q_color="red",
            cue_name_suffix=" [1/2]",
        )
    ]
    gen.export_csv(tmp_path / "playlist.csv")
    gen.export_json(tmp_path / "w.json")
    gen.export_cue(tmp_path / "p.cue")
    gen.export_applescript(tmp_path / "q.applescript")
    csv_text = (tmp_path / "playlist.csv").read_text(encoding="utf-8")
    assert "Q Color" in csv_text
    assert "red" in csv_text
    data = json.loads((tmp_path / "w.json").read_text(encoding="utf-8"))
    assert data["workspace"]["cues"][0]["name"] == "Иван Петров [1/2]"
    assert data["workspace"]["cues"][0]["qColor"] == "red"
    assert "FILE" in (tmp_path / "p.cue").read_text(encoding="utf-8")
    raw = (tmp_path / "q.applescript").read_bytes()
    assert raw[:3] == b"\xef\xbb\xbf"
    ascript = (tmp_path / "q.applescript").read_text(encoding="utf-8-sig")
    assert "com.figure53.qlab.5" in ascript
    assert 'make type "audio"' in ascript
    assert "last item of (selected as list)" in ascript
    assert "POSIX file onePath" in ascript
    assert "set q name of newCue to item i of nameLines" in ascript
    assert "q list name" not in ascript
    names_txt = (tmp_path / "q.names.txt").read_text(encoding="utf-8")
    assert "Иван" in names_txt or "Петров" in names_txt
    assert (tmp_path / "q.paths.txt").is_file()
    assert (tmp_path / "q.colors.txt").is_file()


def test_load_docx_compact_three_columns(tmp_path: Path) -> None:
    from docx import Document

    d = Document()
    t = d.add_table(rows=3, cols=3)
    t.rows[0].cells[0].text = "1"
    t.rows[0].cells[1].text = "5А"
    t.rows[0].cells[2].text = "Иван Петров"
    t.rows[1].cells[0].text = ""
    t.rows[1].cells[1].text = ""
    t.rows[1].cells[2].text = "Мария Сидорова"
    t.rows[2].cells[0].text = "2"
    t.rows[2].cells[1].text = "6Б"
    t.rows[2].cells[2].text = "Пётр Иванов"
    p = tmp_path / "list.docx"
    d.save(str(p))

    from qlab_playlist_generator import load_children_dataframe

    df = load_children_dataframe(p)
    assert len(df) == 3
    assert df.iloc[0]["name"] == "Иван"
    assert df.iloc[0]["surname"] == "Петров"
    assert df.iloc[0]["class_name"] == "5А"
    assert df.iloc[1]["class_name"] == "5А"
    assert df.iloc[1]["name"] == "Мария"
    assert df.iloc[2]["class_name"] == "6Б"


def test_match_names_duplicates_all_red(tmp_path: Path) -> None:
    csv_path = tmp_path / "children.csv"
    csv_path.write_text(
        "№,Фамилия,Имя,Класс,Примечание\n"
        "1,Петров,Иван,5A_test,\n",
        encoding="utf-8-sig",
    )
    seg_dir = tmp_path / "segmented_output" / "5A_test"
    seg_dir.mkdir(parents=True)
    import numpy as np
    import soundfile as sf

    for name in ("01_Иван_Петров.wav", "02_Иван_Петров.wav"):
        p = seg_dir / name
        sf.write(str(p), np.zeros(800, dtype=np.float32), 16000)

    gen = QLabPlaylistGenerator(
        children_list_file=csv_path,
        audio_segments_dir=tmp_path / "segmented_output",
        output_directory=tmp_path / "qlab_out",
        fuzzy_threshold=80,
    )
    gen.load_children_list()
    gen.scan_audio_segments()
    rows = gen.match_names()
    assert len(rows) == 2
    assert all(r.q_color == "red" for r in rows)
    assert rows[0].cue_name_suffix == " [1/2]"
    assert rows[1].cue_name_suffix == " [2/2]"
