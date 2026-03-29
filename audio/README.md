# Аудио → транскрипция → сегменты → плейлист QLab

Единое приложение на Python 3.10+: Whisper режет записи по классам на файлы «имя + фамилия», затем по списку детей (Excel/CSV) строит плейлист для QLab с нечётким сопоставлением имён.

## Установка

```bash
cd /path/to/project
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Для GPU: [PyTorch с CUDA](https://pytorch.org/). В `config.py` параметр `DEVICE` может быть `auto`, `cuda` или `cpu`.

Для **m4a** / части **mp3** в системе нужен **ffmpeg**.

## Структура проекта

| Путь | Назначение |
|------|------------|
| `audio_files/` | Исходные записи по классам (`5A.wav`, `5B_класс.mp3` — имя файла = папка сегментов) |
| `segmented_output/` | WAV по классам, `processing_report.json` / `.txt` |
| `children_list.csv` | Порядок выступлений: №, Фамилия, Имя, Класс, Примечание (можно `.xlsx`) |
| `qlab_playlist/` | `playlist.csv`, `qlab_workspace.json`, `playlist.cue`, `matching_report.txt` |

## Настройка (`config.py`)

Заданы `PROJECT_ROOT`, пути `AUDIO_INPUT_DIR`, `SEGMENTED_OUTPUT_DIR`, `CHILDREN_LIST_FILE`, `QLAB_OUTPUT_DIR`, Whisper, порог fuzzy (`FUZZY_THRESHOLD`), форматы экспорта (`EXPORT_FORMATS`), словарь `CONFIG` для скриптов.

## Запуск

**1. Только сегментация**

```bash
python name_segmenter.py
```

**2. Только плейлист QLab** (после появления `segmented_output/`)

```bash
python qlab_playlist_generator.py
```

**3. Весь пайплайн**

```bash
python pipeline.py
```

## Программный API

```python
from pathlib import Path
from name_segmenter import NameSegmenter, build_processing_report, save_report
from config import CONFIG

seg = NameSegmenter.from_config(CONFIG)
seg.process_directory(Path(CONFIG["input_directory"]), Path(CONFIG["output_directory"]))
from datetime import datetime
rep = build_processing_report(seg.file_results, datetime.now().isoformat(), datetime.now().isoformat())
save_report(rep, CONFIG["output_directory"])
```

```python
from qlab_playlist_generator import QLabPlaylistGenerator
from config import CONFIG

g = QLabPlaylistGenerator.from_config(CONFIG)
g.generate_playlist()
g.export_csv(g.output_directory / "playlist.csv")
```

## Форматы списка детей

Колонки (имена гибкие, см. `load_children_dataframe`): №, Фамилия, Имя, Класс, Примечание. Класс в таблице сопоставляется с **именем папки** в `segmented_output` (например `5A` и `5A_класс` — по fuzzy).

## Экспорт QLab

- **CSV**: `Cue Number`, `Cue Name`, `File Path` (абсолютный), `Duration`, `Notes`
- **JSON**: `workspace.version`, `cues[]` с полями `name`, `file`, `duration`, `notes`
- **CUE**: `FILE` с абсолютным путём, `TITLE` — ФИО

## Тесты

```bash
python -m pytest tests/ -v
```

Whisper в тестах не загружается (мок).
