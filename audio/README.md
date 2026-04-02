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

## Standalone-приложение (macOS, без Python на целевом Mac)

Сборка выполняется **один раз** на компьютере с Python (у вас):

```bash
cd audio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./build_mac_app.sh
```

В `dist/` появится `AudioSegmentationQLab.app` (размер большой: PyTorch + Whisper). Его можно копировать на другой Mac — **интерпретатор Python там не нужен**.

**Установщик в виде DMG** (удобно переслать одним файлом):

```bash
./build_mac_app.sh    # сначала сборка .app
./build_dmg.sh        # образ dist/AudioSegmentationQLab-1.0.0.dmg
```

Версию в имени файла можно задать: `AUDIOSEG_VERSION=1.2.0 ./build_dmg.sh`. На другом Mac пользователь открывает `.dmg`, перетаскивает приложение в **Программы** (или в свою папку). В образе также лежит **`Установить ffmpeg.command`**: двойной щелчок откроет Терминал и выполнит `brew install ffmpeg` (если установлен Homebrew; иначе предложит открыть brew.sh).

**Куда класть файлы:** удобно положить `AudioSegmentationQLab.app` в отдельную папку (например «Концерт_2025»). Рядом с `.app` в **этой же папке** приложение создаст/использует `audio_files/`, `segmented_output/`, `qlab_playlist/`, `children_list.csv` и настройки. Если запускать только из **Программы** (`/Applications`), данные уйдут в `~/Library/Application Support/AudioSegmentationQLab/`.

Первый запуск нарезки **скачивает модель Whisper** в `~/.cache/whisper` (нужны интернет и свободное место). На целевом Mac по-прежнему нужен **ffmpeg** для части форматов: `brew install ffmpeg`.

Если macOS блокирует запуск неизвестного разработчика: ПКМ по приложению → **Открыть**. Для распространения без предупреждений обычно нужна подпись Apple Developer.

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
