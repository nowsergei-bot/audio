#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PyQt6: сегментация аудио (тишина на границах) и экспорт плейлиста QLab."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QAction, QColor, QFont, QKeySequence, QPalette, QTextOption
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSpinBox,
    QStatusBar,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

try:
    import darkdetect
except ImportError:
    darkdetect = None

PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import CONFIG, PROJECT_ROOT as CFG_ROOT  # noqa: E402
from name_segmenter import (  # noqa: E402
    NameSegmenter,
    build_processing_report,
    save_report,
)
from qlab_playlist_generator import (  # noqa: E402
    QLabPlaylistGenerator,
    load_children_dataframe,
)

GUI_SETTINGS_PATH = CFG_ROOT / "gui_settings.json"
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def load_gui_settings() -> None:
    if not GUI_SETTINGS_PATH.is_file():
        return
    try:
        data = json.loads(GUI_SETTINGS_PATH.read_text(encoding="utf-8"))
        for k, v in data.items():
            if k in CONFIG and isinstance(v, (str, int, float, bool)):
                CONFIG[k] = v
    except (OSError, json.JSONDecodeError):
        pass


def save_gui_settings() -> None:
    keys = (
        "input_directory",
        "output_directory",
        "children_list_file",
        "qlab_output_directory",
        "whisper_model",
        "fuzzy_threshold",
        "use_enhanced_segmentation",
    )
    try:
        GUI_SETTINGS_PATH.write_text(
            json.dumps({k: CONFIG.get(k) for k in keys}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def send_macos_notification(title: str, message: str) -> None:
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display notification "{message.replace(chr(34), chr(39))}" '
                f'with title "{title.replace(chr(34), chr(39))}"',
            ],
            capture_output=True,
            check=False,
        )
    except OSError:
        pass


def dock_progress_set_visible(visible: bool) -> None:
    try:
        from AppKit import NSApplication  # type: ignore[import-untyped]

        app = NSApplication.sharedApplication()
        tile = app.dockTile()
        tile.setShowsProgressIndicator_(bool(visible))
    except Exception:
        pass


class CardFrame(QFrame):
    def __init__(self, title: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        lay = QVBoxLayout(self)
        if title:
            t = QLabel(title)
            t.setObjectName("cardTitle")
            lay.addWidget(t)


class SegmentationWorker(QThread):
    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(self, input_dir: Path, output_dir: Path) -> None:
        super().__init__()
        self.input_dir = input_dir
        self.output_dir = output_dir
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        try:
            dock_progress_set_visible(True)
            segmenter = NameSegmenter.from_config(CONFIG)
            segmenter.file_results.clear()
            files = sorted(
                p
                for p in self.input_dir.iterdir()
                if p.is_file() and p.suffix.lower() in AUDIO_EXTS
            )
            if not files:
                self.finished.emit(None)
                return
            started = time.strftime("%Y-%m-%dT%H:%M:%S")
            n = len(files)
            for i, fp in enumerate(files):
                if self._cancel:
                    self.finished.emit(None)
                    return
                segmenter.process_file(fp, self.output_dir)
                self.progress.emit(int(100 * (i + 1) / n), fp.name)
            completed = time.strftime("%Y-%m-%dT%H:%M:%S")
            report = build_processing_report(
                segmenter.file_results, started, completed
            )
            save_report(report, self.output_dir)
            self.finished.emit(report)
        except Exception as e:
            self.error.emit(str(e))
        finally:
            dock_progress_set_visible(False)


class PlaylistWorker(QThread):
    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def run(self) -> None:
        try:
            self.progress.emit(10, "Загрузка списка…")
            gen = QLabPlaylistGenerator.from_config(CONFIG)
            gen.load_children_list()
            self.progress.emit(40, "Сканирование сегментов…")
            gen.scan_audio_segments()
            self.progress.emit(70, "Сопоставление…")
            gen.match_names()
            self.progress.emit(100, "Готово")
            self.finished.emit(gen)
        except Exception as e:
            self.error.emit(str(e))


class AudioLibraryWidget(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.worker: SegmentationWorker | None = None
        self._watcher: QObject | None = None
        self._build()

    def _build(self) -> None:
        root = QVBoxLayout(self)
        card = CardFrame("Библиотека аудиофайлов")
        cl = QVBoxLayout()
        row = QHBoxLayout()
        self.path_edit = QLineEdit(CONFIG.get("input_directory", ""))
        browse = QPushButton("Изменить…")
        browse.clicked.connect(self._browse)
        row.addWidget(self.path_edit, 1)
        row.addWidget(browse)
        cl.addLayout(row)
        self.file_list = QListWidget()
        self.file_list.setMinimumHeight(180)
        cl.addWidget(self.file_list)
        btn_row = QHBoxLayout()
        self.btn_refresh = QPushButton("Обновить")
        self.btn_segment = QPushButton("Нарезать все")
        self.btn_cancel = QPushButton("Отмена")
        self.btn_cancel.setEnabled(False)
        self.btn_refresh.clicked.connect(self.refresh_list)
        self.btn_segment.clicked.connect(self.run_segmentation)
        self.btn_cancel.clicked.connect(self._cancel_run)
        btn_row.addWidget(self.btn_refresh)
        btn_row.addWidget(self.btn_segment)
        btn_row.addWidget(self.btn_cancel)
        cl.addLayout(btn_row)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setTextVisible(True)
        self.progress_label = QLabel("")
        cl.addWidget(self.progress)
        cl.addWidget(self.progress_label)
        self.stats_label = QLabel("")
        cl.addWidget(self.stats_label)
        card.layout().addLayout(cl)
        root.addWidget(card)
        root.addStretch()
        self.refresh_list()
        self._setup_watcher()

    def _setup_watcher(self) -> None:
        try:
            from PyQt6.QtCore import QFileSystemWatcher

            self._watcher = QFileSystemWatcher([self.path_edit.text()])
            self._watcher.directoryChanged.connect(lambda _p: self.refresh_list())
        except Exception:
            self._watcher = None

    def _browse(self) -> None:
        d = QFileDialog.getExistingDirectory(self, "Каталог с аудио", self.path_edit.text())
        if d:
            self.path_edit.setText(d)
            CONFIG["input_directory"] = d
            save_gui_settings()
            if self._watcher:
                try:
                    from PyQt6.QtCore import QFileSystemWatcher

                    if isinstance(self._watcher, QFileSystemWatcher):
                        paths = self._watcher.directories()
                        if paths:
                            self._watcher.removePaths(paths)
                        self._watcher.addPath(d)
                except Exception:
                    pass
            self.refresh_list()

    def refresh_list(self) -> None:
        self.file_list.clear()
        p = Path(self.path_edit.text() or ".")
        if not p.is_dir():
            self.stats_label.setText("Каталог не найден")
            return
        files = sorted(x for x in p.iterdir() if x.is_file() and x.suffix.lower() in AUDIO_EXTS)
        out_root = Path(CONFIG.get("output_directory", ""))
        for f in files:
            status = "⏸️"
            if out_root.is_dir():
                cls_dir = out_root / f.stem
                if cls_dir.is_dir() and any(cls_dir.glob("*.wav")):
                    status = "✅"
            item = QListWidgetItem(f"{status}  {f.name}")
            self.file_list.addItem(item)
        self.stats_label.setText(f"Найдено файлов: {len(files)}")

    def _cancel_run(self) -> None:
        if self.worker and self.worker.isRunning():
            self.worker.cancel()
            self.worker.wait(3000)

    def run_segmentation(self) -> None:
        inp = Path(self.path_edit.text())
        out = Path(CONFIG.get("output_directory", str(CFG_ROOT / "segmented_output")))
        if not inp.is_dir():
            QMessageBox.warning(self, "Ошибка", "Укажите существующий каталог с аудио.")
            return
        CONFIG["input_directory"] = str(inp)
        CONFIG["output_directory"] = str(out)
        save_gui_settings()
        out.mkdir(parents=True, exist_ok=True)
        self.btn_segment.setEnabled(False)
        self.btn_cancel.setEnabled(True)
        self.progress.setValue(0)
        self.worker = SegmentationWorker(inp, out)
        self.worker.progress.connect(self._on_progress)
        self.worker.finished.connect(self._on_done)
        self.worker.error.connect(self._on_error)
        self.worker.start()

    def _on_progress(self, pct: int, name: str) -> None:
        self.progress.setValue(pct)
        self.progress_label.setText(name)

    def _on_done(self, report: Any) -> None:
        self.btn_segment.setEnabled(True)
        self.btn_cancel.setEnabled(False)
        self.progress.setValue(100)
        self.progress_label.setText("")
        self.refresh_list()
        mw = self.window()
        if isinstance(mw, MainWindow):
            mw.statusBar().showMessage("Сегментация завершена", 5000)
        send_macos_notification("Сегментация", "Обработка аудио завершена")
        if report is not None:
            QMessageBox.information(
                self,
                "Готово",
                f"Сегментов: {getattr(report, 'total_segments', 0)}",
            )

    def _on_error(self, msg: str) -> None:
        self.btn_segment.setEnabled(True)
        self.btn_cancel.setEnabled(False)
        QMessageBox.critical(self, "Ошибка", msg)


class ChildrenListWidget(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._df: Any = None
        self._build()

    def _build(self) -> None:
        root = QVBoxLayout(self)
        card = CardFrame("Список детей")
        cl = QVBoxLayout()
        top = QHBoxLayout()
        self.btn_paste = QPushButton("Вставить из буфера")
        self.btn_load = QPushButton("Загрузить файл…")
        self.btn_paste.clicked.connect(self._paste)
        self.btn_load.clicked.connect(self._load_file)
        top.addWidget(self.btn_paste)
        top.addWidget(self.btn_load)
        cl.addLayout(top)
        row_f = QHBoxLayout()
        row_f.addWidget(QLabel("Фильтр класса:"))
        self.filter_class = QLineEdit()
        self.filter_class.setPlaceholderText("например 5А")
        self.filter_class.textChanged.connect(self._apply_filter)
        row_f.addWidget(self.filter_class)
        row_f.addWidget(QLabel("Поиск:"))
        self.search = QLineEdit()
        self.search.textChanged.connect(self._apply_filter)
        row_f.addWidget(self.search, 1)
        cl.addLayout(row_f)
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["№", "Фамилия", "Имя", "Класс", "Статус"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        cl.addWidget(self.table)
        self.match_label = QLabel("Загрузите список")
        cl.addWidget(self.match_label)
        card.layout().addLayout(cl)
        root.addWidget(card)

    def _paste(self) -> None:
        app = QApplication.instance()
        if not app:
            return
        text = app.clipboard().text()
        if not text.strip():
            return
        try:
            import pandas as pd

            self._df = pd.read_csv(io.StringIO(text), sep=r"\t|;", engine="python", dtype=str)
            self._normalize_df()
        except Exception:
            try:
                import pandas as pd

                self._df = pd.read_csv(io.StringIO(text), dtype=str)
                self._normalize_df()
            except Exception as e:
                QMessageBox.warning(self, "Буфер", f"Не удалось разобрать таблицу: {e}")

    def _load_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Список детей",
            str(Path(CONFIG.get("children_list_file", "")).parent),
            "Документы (*.docx *.xlsx *.xls *.csv);;Все файлы (*)",
        )
        if not path:
            return
        CONFIG["children_list_file"] = path
        save_gui_settings()
        try:
            self._df = load_children_dataframe(Path(path))
            self._fill_table()
            self._update_match_counts()
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", str(e))

    def _normalize_df(self) -> None:
        from qlab_playlist_generator import _map_header_to_column

        if self._df is None:
            return
        rename = {}
        for c in self._df.columns:
            std = _map_header_to_column(str(c))
            if std:
                rename[c] = std
        self._df = self._df.rename(columns=rename)
        req = {"number", "surname", "name", "class_name"}
        if not req.issubset(set(self._df.columns)):
            QMessageBox.warning(
                self,
                "Колонки",
                f"Нужны: №, фамилия, имя, класс. Есть: {list(self._df.columns)}",
            )
            return
        if "notes" not in self._df.columns:
            self._df["notes"] = ""
        tmp = Path(tempfile.mkdtemp()) / "paste.csv"
        self._df.to_csv(tmp, index=False, encoding="utf-8-sig")
        CONFIG["children_list_file"] = str(tmp)
        self._fill_table()
        self._update_match_counts()

    def _fill_table(self) -> None:
        if self._df is None:
            return
        self.table.setRowCount(0)
        for _, row in self._df.iterrows():
            r = self.table.rowCount()
            self.table.insertRow(r)
            self.table.setItem(r, 0, QTableWidgetItem(str(row.get("number", ""))))
            self.table.setItem(r, 1, QTableWidgetItem(str(row.get("surname", ""))))
            self.table.setItem(r, 2, QTableWidgetItem(str(row.get("name", ""))))
            self.table.setItem(r, 3, QTableWidgetItem(str(row.get("class_name", ""))))
            self.table.setItem(r, 4, QTableWidgetItem("—"))
        self._apply_filter()

    def _apply_filter(self) -> None:
        fc = self.filter_class.text().strip().lower()
        q = self.search.text().strip().lower()
        for r in range(self.table.rowCount()):
            vis = True
            if fc:
                cls_it = self.table.item(r, 3)
                if cls_it and fc not in cls_it.text().lower():
                    vis = False
            if vis and q:
                parts = [
                    (self.table.item(r, c).text().lower() if self.table.item(r, c) else "")
                    for c in range(4)
                ]
                if q not in " ".join(parts):
                    vis = False
            self.table.setRowHidden(r, not vis)

    def _update_match_counts(self) -> None:
        try:
            gen = QLabPlaylistGenerator.from_config(CONFIG)
            gen.load_children_list()
            gen.scan_audio_segments()
            gen.match_names()
            ok = 0
            by_num: dict[int, bool] = {}
            for row in gen.playlist_rows:
                if row.matched_path:
                    by_num[row.child_number] = True
            for ch in gen.children:
                if by_num.get(ch.number):
                    ok += 1
            self.match_label.setText(f"Найдено совпадений: {ok}/{len(gen.children)}")
            num_to_ok = {n: True for n in by_num}
            for r in range(self.table.rowCount()):
                it = self.table.item(r, 0)
                if not it:
                    continue
                try:
                    n = int(float(it.text().replace(",", ".")))
                except ValueError:
                    continue
                st = "✅" if num_to_ok.get(n) else "⚠️"
                self.table.setItem(r, 4, QTableWidgetItem(st))
        except Exception as e:
            self.match_label.setText(f"Совпадения: — ({e})")


class QLabPlaylistWidget(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._gen: QLabPlaylistGenerator | None = None
        self.worker: PlaylistWorker | None = None
        self._build()

    def _build(self) -> None:
        root = QVBoxLayout(self)
        card = CardFrame("Плейлист для QLab")
        cl = QVBoxLayout()
        fmt_row = QHBoxLayout()
        fmt_row.addWidget(QLabel("Формат:"))
        self.fmt = QComboBox()
        self.fmt.addItems(["CSV", "JSON", "CUE", "AppleScript"])
        self.fmt.currentIndexChanged.connect(self._preview)
        fmt_row.addWidget(self.fmt)
        self.chk_abs = QCheckBox("Абсолютные пути")
        self.chk_abs.setChecked(True)
        self.chk_abs.toggled.connect(self._preview)
        self.chk_dur = QCheckBox("Длительность")
        self.chk_dur.setChecked(True)
        self.chk_dur.toggled.connect(self._preview)
        self.chk_notes = QCheckBox("Заметки с классом")
        self.chk_notes.setChecked(True)
        self.chk_notes.toggled.connect(self._preview)
        fmt_row.addWidget(self.chk_abs)
        fmt_row.addWidget(self.chk_dur)
        fmt_row.addWidget(self.chk_notes)
        cl.addLayout(fmt_row)
        out_row = QHBoxLayout()
        self.out_edit = QLineEdit(CONFIG.get("qlab_output_directory", ""))
        self.out_btn = QPushButton("Папка…")
        self.out_btn.clicked.connect(self._browse_out)
        out_row.addWidget(QLabel("Папка:"))
        out_row.addWidget(self.out_edit, 1)
        out_row.addWidget(self.out_btn)
        cl.addLayout(out_row)
        btn_row = QHBoxLayout()
        self.btn_build = QPushButton("Собрать предпросмотр")
        self.btn_export = QPushButton("Экспортировать")
        self.btn_qlab = QPushButton("QLab: сценарий")
        self.btn_build.clicked.connect(self.run_build)
        self.btn_export.clicked.connect(self._export)
        self.btn_qlab.clicked.connect(self._open_qlab)
        btn_row.addWidget(self.btn_build)
        btn_row.addWidget(self.btn_export)
        btn_row.addWidget(self.btn_qlab)
        cl.addLayout(btn_row)
        self.preview = QTextEdit()
        self.preview.setReadOnly(True)
        self.preview.setFont(QFont("Menlo", 11))
        self.preview.setWordWrapMode(QTextOption.WrapMode.NoWrap)
        cl.addWidget(self.preview, 1)
        card.layout().addLayout(cl)
        root.addWidget(card)

    def _browse_out(self) -> None:
        d = QFileDialog.getExistingDirectory(self, "Папка плейлиста", self.out_edit.text())
        if d:
            self.out_edit.setText(d)
            CONFIG["qlab_output_directory"] = d
            save_gui_settings()

    def run_build(self) -> None:
        CONFIG["qlab_output_directory"] = self.out_edit.text()
        self.btn_build.setEnabled(False)
        self.worker = PlaylistWorker()
        self.worker.progress.connect(lambda _p, m: self.preview.setPlainText(m))
        self.worker.finished.connect(self._on_built)
        self.worker.error.connect(self._on_err)
        self.worker.start()

    def _on_built(self, gen: Any) -> None:
        self.btn_build.setEnabled(True)
        self._gen = gen
        self._preview()

    def _on_err(self, msg: str) -> None:
        self.btn_build.setEnabled(True)
        QMessageBox.critical(self, "Ошибка", msg)

    def _preview(self) -> None:
        if not self._gen:
            return
        fmt = self.fmt.currentText().lower()
        lines: list[str] = []
        for i, row in enumerate(self._gen.playlist_rows, start=1):
            name = self._gen._cue_display_name(row)
            path = row.matched_path or ""
            if not self.chk_abs.isChecked() and path:
                try:
                    path = str(Path(path).relative_to(CFG_ROOT))
                except ValueError:
                    pass
            dur = f"{row.duration:.2f}" if self.chk_dur.isChecked() and path else ""
            notes = row.class_name
            if self.chk_notes.isChecked() and row.notes:
                notes = f"{notes} {row.notes}".strip()
            if fmt == "csv":
                lines.append(f"{i}\t{name}\t{path}\t{dur}\t{notes}")
            elif fmt == "json":
                lines.append(
                    json.dumps(
                        {
                            "number": str(i),
                            "name": name,
                            "file": path,
                            "duration": row.duration if path else 0,
                            "notes": notes,
                        },
                        ensure_ascii=False,
                    )
                )
            else:
                lines.append(f"{i}. {name}  →  {path}")
        self.preview.setPlainText("\n".join(lines[:500]) + ("\n…" if len(lines) > 500 else ""))

    def _export(self) -> None:
        if not self._gen:
            QMessageBox.information(self, "Экспорт", "Сначала нажмите «Собрать предпросмотр».")
            return
        out = Path(self.out_edit.text())
        out.mkdir(parents=True, exist_ok=True)
        CONFIG["qlab_output_directory"] = str(out)
        save_gui_settings()
        g = self._gen
        fmt = self.fmt.currentText().lower()
        try:
            if fmt == "csv":
                p = g.export_csv(out / "playlist.csv")
            elif fmt == "json":
                p = g.export_json(out / "qlab_workspace.json")
            elif fmt == "cue":
                p = g.export_cue(out / "playlist.cue")
            else:
                p = g.export_applescript(out / "build_qlab_playlist.applescript")
                n_audio = sum(1 for r in g.playlist_rows if r.matched_path)
                if n_audio == 0:
                    QMessageBox.warning(
                        self,
                        "AppleScript",
                        "В плейлисте нет ни одного файла (пустые пути в CSV). "
                        "QLab нечего создавать — проверьте список детей и папку сегментов.",
                    )
            g.generate_report(out / "matching_report.txt")
            msg = f"Сохранено:\n{p}"
            if p.suffix.lower() == ".applescript":
                msg += (
                    "\n\nВ той же папке: build_qlab_playlist.paths.txt, .names.txt, .colors.txt (UTF-8). "
                    "Переносите их вместе со сценарием — без них русские имена и пути не подставятся."
                )
            QMessageBox.information(self, "Экспорт", msg)
            send_macos_notification("QLab", f"Экспорт: {p.name}")
        except Exception as e:
            QMessageBox.critical(self, "Экспорт", str(e))

    def _open_qlab(self) -> None:
        """QLab не открывает CSV/JSON как документ — только workspace .qlab5 или ручной импорт."""
        out = Path(self.out_edit.text())
        if not out.is_dir():
            QMessageBox.warning(self, "QLab", "Укажите существующую папку экспорта.")
            return
        ascript = out / "build_qlab_playlist.applescript"
        if not ascript.is_file():
            QMessageBox.information(
                self,
                "QLab",
                "Файл build_qlab_playlist.applescript не найден.\n\n"
                "Важно: QLab не умеет открывать playlist.csv командой «Открыть» — "
                "отсюда и ошибка Could not open … playlist.csv.\n\n"
                "Сделайте так:\n"
                "• В списке формата выберите AppleScript и нажмите «Экспортировать» "
                "(или добавьте applescript в export_formats в config).\n"
                "• Затем снова нажмите «QLab: сценарий» — откроется сценарий в «Редакторе сценариев».\n\n"
                "CSV удобен для таблиц; для автозагрузки кью в QLab нужен именно AppleScript.",
            )
            subprocess.run(["open", str(out)], check=False)
            return
        subprocess.run(["open", "-a", "Script Editor", str(ascript)], check=False)
        subprocess.run(
            ["osascript", "-e", 'tell application "QLab" to activate'],
            capture_output=True,
            check=False,
        )
        QMessageBox.information(
            self,
            "QLab",
            "Открыт build_qlab_playlist.applescript.\n\n"
            "1) В QLab откройте workspace и щёлкните внутри нужного cue list "
            "(лучше выделите любой кью — новые появятся ниже).\n"
            "2) В «Редакторе сценариев» нажмите «Запустить» (▶).\n\n"
            "Если кью не появлялись: переэкспортируйте AppleScript после обновления программы "
            "(старый сценарий использовал устаревший синтаксис).",
        )


class SettingsWidget(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._build()

    def _build(self) -> None:
        lay = QVBoxLayout(self)
        card = CardFrame("Настройки")
        g = QGridLayout()
        r = 0
        g.addWidget(QLabel("Whisper model:"), r, 0)
        self.whisper = QLineEdit(str(CONFIG.get("whisper_model", "base")))
        g.addWidget(self.whisper, r, 1)
        r += 1
        g.addWidget(QLabel("Fuzzy порог:"), r, 0)
        self.fuzzy = QSpinBox()
        self.fuzzy.setRange(50, 100)
        self.fuzzy.setValue(int(CONFIG.get("fuzzy_threshold", 80)))
        g.addWidget(self.fuzzy, r, 1)
        r += 1
        self.enh = QCheckBox("Улучшенная сегментация (тишина, буферы, fade)")
        self.enh.setChecked(bool(CONFIG.get("use_enhanced_segmentation", True)))
        g.addWidget(self.enh, r, 0, 1, 2)
        r += 1
        save = QPushButton("Сохранить в gui_settings.json")
        save.clicked.connect(self._save)
        g.addWidget(save, r, 0, 1, 2)
        card.layout().addLayout(g)
        lay.addWidget(card)
        lay.addStretch()

    def _save(self) -> None:
        CONFIG["whisper_model"] = self.whisper.text().strip() or "base"
        CONFIG["fuzzy_threshold"] = self.fuzzy.value()
        CONFIG["use_enhanced_segmentation"] = self.enh.isChecked()
        save_gui_settings()
        QMessageBox.information(self, "Настройки", "Сохранено.")


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self._theme_override: bool | None = None
        load_gui_settings()
        self.setWindowTitle("Audio Segmentation & QLab Playlist")
        self.setMinimumSize(900, 700)
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        tabs = QTabWidget()
        self.tab_audio = AudioLibraryWidget()
        self.tab_children = ChildrenListWidget()
        self.tab_playlist = QLabPlaylistWidget()
        self.tab_settings = SettingsWidget()
        tabs.addTab(self.tab_audio, "Аудиофайлы")
        tabs.addTab(self.tab_children, "Список детей")
        tabs.addTab(self.tab_playlist, "Плейлист QLab")
        tabs.addTab(self.tab_settings, "Настройки")
        layout.addWidget(tabs)
        self.setStatusBar(QStatusBar())
        self._build_menu()
        self._apply_theme()

    def _build_menu(self) -> None:
        act_quit = QAction("Выход", self)
        act_quit.setShortcut(QKeySequence.StandardKey.Quit)
        act_quit.triggered.connect(QApplication.quit)
        self.menuBar().addAction(act_quit)
        act_theme = QAction("Переключить тему", self)
        act_theme.triggered.connect(self._toggle_theme)
        self.menuBar().addAction(act_theme)

    def _theme_is_dark(self) -> bool:
        if self._theme_override is not None:
            return self._theme_override
        if darkdetect and darkdetect.isDark():
            return True
        return False

    def _apply_theme(self) -> None:
        dark = self._theme_is_dark()
        app = QApplication.instance()
        if not app:
            return
        if dark:
            app.setStyleSheet(self._stylesheet_dark())
            pal = QPalette()
            pal.setColor(QPalette.ColorRole.Window, QColor("#1C1C1E"))
            pal.setColor(QPalette.ColorRole.WindowText, QColor("#FFFFFF"))
            pal.setColor(QPalette.ColorRole.Base, QColor("#2C2C2E"))
            pal.setColor(QPalette.ColorRole.Text, QColor("#FFFFFF"))
            app.setPalette(pal)
        else:
            app.setStyleSheet(self._stylesheet_light())
            app.setPalette(app.style().standardPalette())

    def _toggle_theme(self) -> None:
        cur = self._theme_is_dark()
        self._theme_override = not cur
        self._apply_theme()

    def _stylesheet_light(self) -> str:
        return """
            QMainWindow, QWidget { background-color: #F2F2F7; color: #1D1D1F; }
            QFrame#card {
                background-color: #FFFFFF; border-radius: 12px;
                border: 1px solid #E5E5EA; padding: 12px;
            }
            QLabel#cardTitle { font-weight: 600; font-size: 14px; color: #1D1D1F; }
            QTabWidget::pane { border: none; background: #FFFFFF; border-radius: 12px; }
            QTabBar::tab { padding: 10px 18px; border-radius: 8px; margin: 4px; }
            QTabBar::tab:selected { background-color: #007AFF; color: white; }
            QPushButton {
                background-color: #007AFF; color: white; border: none;
                border-radius: 8px; padding: 8px 16px; font-weight: 500;
            }
            QPushButton:hover { background-color: #0056CC; }
            QPushButton:pressed { background-color: #004499; }
            QProgressBar { border: none; border-radius: 4px; background: #E5E5EA; height: 10px; }
            QProgressBar::chunk { background-color: #007AFF; border-radius: 4px; }
            QLineEdit, QTextEdit, QComboBox {
                border: 1px solid #D1D1D6; border-radius: 8px; padding: 6px;
                background: #FFFFFF;
            }
            QTableWidget { border: none; border-radius: 12px; gridline-color: #E5E5EA; }
            QTableWidget::item:selected { background-color: #007AFF; color: white; }
        """

    def _stylesheet_dark(self) -> str:
        return """
            QMainWindow, QWidget { background-color: #1C1C1E; color: #FFFFFF; }
            QFrame#card {
                background-color: #2C2C2E; border-radius: 12px;
                border: 1px solid #3A3A3C; padding: 12px;
            }
            QLabel#cardTitle { font-weight: 600; font-size: 14px; color: #FFFFFF; }
            QTabWidget::pane { border: none; background: #2C2C2E; border-radius: 12px; }
            QTabBar::tab { padding: 10px 18px; border-radius: 8px; margin: 4px; color: #98989D; }
            QTabBar::tab:selected { background-color: #0A84FF; color: white; }
            QPushButton {
                background-color: #0A84FF; color: white; border: none;
                border-radius: 8px; padding: 8px 16px; font-weight: 500;
            }
            QPushButton:hover { background-color: #409CFF; }
            QProgressBar { border: none; border-radius: 4px; background: #3A3A3C; height: 10px; }
            QProgressBar::chunk { background-color: #0A84FF; border-radius: 4px; }
            QLineEdit, QTextEdit, QComboBox {
                border: 1px solid #48484A; border-radius: 8px; padding: 6px;
                background: #3A3A3C; color: #FFFFFF;
            }
            QTableWidget { border: none; border-radius: 12px; gridline-color: #48484A; }
            QTableWidget::item:selected { background-color: #0A84FF; color: white; }
        """

def main() -> int:
    load_gui_settings()
    app = QApplication(sys.argv)
    app.setOrganizationName("AudioSeg")
    app.setApplicationName("AudioSegmentationQLab")
    w = MainWindow()
    w.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
