"""Общие фикстуры: мок Whisper, чтобы не грузить модель при тестах."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def segmenter():
    with patch("name_segmenter.whisper.load_model", return_value=MagicMock()):
        from name_segmenter import NameSegmenter

        from config import CONFIG

        yield NameSegmenter.from_config(dict(CONFIG))
