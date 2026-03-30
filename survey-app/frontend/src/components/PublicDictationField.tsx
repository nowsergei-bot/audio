import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSpeechRecognitionConstructor,
  isSpeechDictationSupported,
  type SpeechRecognitionInstance,
} from '../lib/speechDictation';

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Многострочное поле (текстовый вопрос) или одна строка («Другое»). */
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Язык распознавания (BCP-47). */
  lang?: string;
};

export default function PublicDictationField({
  value,
  onChange,
  multiline = true,
  placeholder,
  className = '',
  inputClassName = '',
  lang = 'ru-RU',
}: Props) {
  const supported = isSpeechDictationSupported();
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;
    setHint(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const t = event.results[i][0].transcript.trim();
          if (!t) continue;
          const cur = String(valueRef.current);
          const sep = cur && !/\s$/.test(cur) ? ' ' : '';
          onChangeRef.current(cur + sep + t);
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') return;
      if (event.error === 'not-allowed') {
        setHint('Разрешите доступ к микрофону в настройках браузера.');
      } else {
        setHint('Не удалось распознать речь. Попробуйте ещё раз.');
      }
      stop();
    };
    recognition.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setHint('Диктовка недоступна в этом браузере.');
    }
  }, [lang, stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const field = multiline ? (
    <textarea
      className={inputClassName}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ) : (
    <input
      type="text"
      className={inputClassName || 'public-other-input'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );

  return (
    <div className={`public-dictation-wrap ${className}`.trim()}>
      {field}
      {supported && (
        <div className="public-dictation-toolbar">
          <button
            type="button"
            className={`public-dictation-mic${listening ? ' is-active' : ''}`}
            onClick={() => toggle()}
            aria-pressed={listening}
            aria-label={listening ? 'Остановить диктовку' : 'Наговорить ответ'}
            title={listening ? 'Остановить' : 'Наговорить ответ'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"
              />
            </svg>
          </button>
          {listening && <span className="public-dictation-status">Слушаю… нажмите ещё раз, чтобы остановить</span>}
        </div>
      )}
      {hint && <p className="public-dictation-hint err">{hint}</p>}
    </div>
  );
}
