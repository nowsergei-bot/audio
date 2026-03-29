import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { adminStagger, adminStaggerItem, templateCardHover } from '../motion/adminMotion';
import { SURVEY_TEMPLATES, templateCategories } from '../data/surveyTemplates';

function questionWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'вопросов';
  if (m10 === 1) return 'вопрос';
  if (m10 >= 2 && m10 <= 4) return 'вопроса';
  return 'вопросов';
}

type Props = {
  onPickTemplate: (templateId: string) => void;
};

export default function TemplateGallery({ onPickTemplate }: Props) {
  const categories = useMemo(() => templateCategories(), []);
  const [cat, setCat] = useState('Все');

  const filtered = useMemo(() => {
    if (cat === 'Все') return SURVEY_TEMPLATES;
    return SURVEY_TEMPLATES.filter((t) => t.category === cat);
  }, [cat]);

  return (
    <div className="page admin-templates-page">
      <motion.header
        className="card admin-templates-hero"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="admin-templates-kicker">Пульс · с чего начнём</p>
        <h1 className="admin-templates-title">Шаблоны опросов</h1>
        <p className="muted admin-templates-lead">
          Выберите готовый сценарий с вопросами на русском или начните с чистого листа — всё можно изменить перед
          сохранением.
        </p>
        <motion.button
          type="button"
          className="btn admin-templates-blank-btn"
          onClick={() => onPickTemplate('blank')}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          ✨ Пустой опрос — собрать самим
        </motion.button>
      </motion.header>

      <div className="admin-templates-filters" role="tablist" aria-label="Категории шаблонов">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={cat === c}
            className={`admin-templates-filter${cat === c ? ' admin-templates-filter--active' : ''}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <motion.ul
        className="admin-templates-grid"
        variants={adminStagger}
        initial="hidden"
        animate="show"
        key={cat}
      >
        {filtered.map((t) => (
          <motion.li key={t.id} className="admin-templates-cell" variants={adminStaggerItem}>
            <motion.article
              className="admin-template-card card"
              variants={templateCardHover}
              initial="rest"
              whileHover="hover"
              whileTap="tap"
            >
              <div className="admin-template-card-top">
                <span className="admin-template-emoji" aria-hidden>
                  {t.emoji}
                </span>
                <span className="admin-template-category">{t.category}</span>
              </div>
              <h2 className="admin-template-title">{t.title}</h2>
              <p className="admin-template-desc muted">{t.description}</p>
              <p className="admin-template-meta muted">
                {t.questions.length} {questionWord(t.questions.length)}
              </p>
              <motion.button
                type="button"
                className="btn primary admin-template-cta"
                onClick={() => onPickTemplate(t.id)}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                Использовать шаблон
              </motion.button>
            </motion.article>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
