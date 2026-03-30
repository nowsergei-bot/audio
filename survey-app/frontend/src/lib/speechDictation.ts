/** Минимальные типы для Web Speech API (Chrome / Safari / Edge). */

export type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionError) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

export interface SpeechRecognitionError {
  error: string;
  message?: string;
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechDictationSupported(): boolean {
  return getSpeechRecognitionConstructor() != null;
}
