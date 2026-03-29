#!/usr/bin/env python3
"""
Полный пайплайн: транскрибация и сегментация → генерация плейлиста QLab.
"""

from __future__ import annotations

import sys

from tqdm import tqdm

from config import CONFIG


def main() -> int:
    tqdm.write("")
    tqdm.write("🚀 ЗАПУСК ПОЛНОГО ПАЙПЛАЙНА (сегментация → QLab)")
    tqdm.write("")

    import name_segmenter as ns

    rc = ns.main()
    if rc != 0:
        return rc

    tqdm.write("")
    import qlab_playlist_generator as qg

    return qg.main()


if __name__ == "__main__":
    raise SystemExit(main())
