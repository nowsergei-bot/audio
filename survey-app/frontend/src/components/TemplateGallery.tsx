import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminStagger, adminStaggerItem, templateCardHover } from '../motion/adminMotion';
import { listSurveyTemplates, templateCategories } from '../data/surveyTemplates';

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
  onCreateTemplate?: () => void;
};

export default function TemplateGallery({ onPickTemplate, onCreateTemplate }: Props) {
  const categories = useMemo(() => templateCategories(), []);
  const [cat, setCat] = useState('Все');
  const templates = useMemo(() => listSurveyTemplates(), []);

  const filtered = useMemo(() => {
    if (cat === 'Все') return templates;
    return templates.filter((t) => t.category === cat);
  }, [cat, templates]);

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
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.6rem' }}>
          <motion.button
            type="button"
            className="btn admin-templates-blank-btn"
            onClick={() => onPickTemplate('blank')}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            ✨ Пустой опрос — собрать самим
          </motion.button>
          {onCreateTemplate && (
            <motion.button
              type="button"
              className="btn"
              onClick={onCreateTemplate}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              ➕ Создать шаблон
            </motion.button>
          )}
        </div>
      </motion.header>

      <section className="card glass-surface" style={{ marginTop: '1rem' }}>
        <p className="admin-templates-kicker" style={{ marginBottom: '0.25rem' }}>
          Подгрузка данных из старых опросов
        </p>
        <h2 className="admin-templates-title admin-templates-title--section">Инфографика по вашим данным</h2>
        <p className="muted" style={{ marginTop: 0, maxWidth: '48rem' }}>
          Если у вас уже есть Excel с ответами (из Google Forms, анкеты, прошлых мероприятий) — можно загрузить его в существующий опрос и сразу
          получить страницу результатов с аналитикой.
        </p>
        <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link to="/import-old-surveys" className="btn primary">
            Подгрузить ответы в существующий опрос
          </Link>
        </div>
      </section>

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
