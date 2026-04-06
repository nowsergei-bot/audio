import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { refineWordCloudForDisplay } from '../lib/wordCloudDisplay';
import type { TextWordCloudWord } from '../types';

type Props = {
  words: TextWordCloudWord[];
  onSelectWord: (word: string) => void;
  /** На странице директора слова только для обзора, без перехода к комментариям. */
  interactive?: boolean;
};

export default function CommentsWordCloud({ words, onSelectWord, interactive = true }: Props) {
  const displayWords = useMemo(() => refineWordCloudForDisplay(words), [words]);
  if (!words.length) return null;
  if (!displayWords.length) {
    return (
      <motion.section
        className="card results-word-cloud-card glass-surface"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        aria-label="Облако слов по свободным ответам"
      >
        <h2 className="results-word-cloud-title">Облако слов</h2>
        <p className="muted results-word-cloud-lead">
          Значимых слов для облака не осталось после отсечения служебных слов — смысл смотрите в ответах респондентов ниже.
        </p>
      </motion.section>
    );
  }
  const max = Math.max(1, ...displayWords.map((w) => w.count));

  return (
    <motion.section
      className="card results-word-cloud-card glass-surface"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Облако слов по свободным ответам"
    >
      <h2 className="results-word-cloud-title">Облако слов</h2>
      <p className="muted results-word-cloud-lead">
        {interactive
          ? 'Собрано из всех текстовых ответов опроса. Нажмите слово — откроется список комментариев с этим словом.'
          : 'Ключевые слова из свободных ответов (по частоте). Детали — в формулировках респондентов ниже.'}
      </p>
      <div className="results-word-cloud-inner">
        {displayWords.map((w, i) => {
          const t = w.count / max;
          const fontRem = 0.78 + t * 1.45;
          const style = { fontSize: `${fontRem}rem` } as const;
          const cls = interactive ? 'results-word-cloud-tag' : 'results-word-cloud-tag results-word-cloud-tag--static';
          if (!interactive) {
            return (
              <motion.span
                key={`${w.text}-${i}`}
                className={cls}
                style={style}
                initial={false}
              >
                <span className="results-word-cloud-tag-label">{w.text}</span>
                <span className="results-word-cloud-count">{w.count}</span>
              </motion.span>
            );
          }
          return (
            <motion.button
              key={`${w.text}-${i}`}
              type="button"
              className={cls}
              style={style}
              onClick={() => onSelectWord(w.text)}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              <span className="results-word-cloud-tag-label">{w.text}</span>
              <span className="results-word-cloud-count">{w.count}</span>
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}
