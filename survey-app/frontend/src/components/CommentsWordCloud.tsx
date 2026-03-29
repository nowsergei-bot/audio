import { motion } from 'framer-motion';
import type { TextWordCloudWord } from '../types';

type Props = {
  words: TextWordCloudWord[];
  onSelectWord: (word: string) => void;
};

export default function CommentsWordCloud({ words, onSelectWord }: Props) {
  if (!words.length) return null;
  const max = Math.max(1, ...words.map((w) => w.count));

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
        Собрано из всех текстовых ответов опроса. Нажмите слово — откроется список комментариев с этим словом.
      </p>
      <div className="results-word-cloud-inner">
        {words.map((w, i) => {
          const t = w.count / max;
          const fontRem = 0.72 + t * 1.35;
          const opacity = 0.45 + t * 0.55;
          return (
            <motion.button
              key={`${w.text}-${i}`}
              type="button"
              className="results-word-cloud-tag"
              style={{ fontSize: `${fontRem}rem`, opacity }}
              onClick={() => onSelectWord(w.text)}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              {w.text}
              <span className="results-word-cloud-count">{w.count}</span>
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}
