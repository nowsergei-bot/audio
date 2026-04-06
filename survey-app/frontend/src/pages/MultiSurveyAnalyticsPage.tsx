import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSurveyGroups, listSurveys, postMultiSurveyAnalytics } from '../api/client';
import PulseLoadingDashboard from '../components/PulseLoadingDashboard';
import ResultQuestionCard from '../components/ResultQuestionCard';
import AnimatedNumber from '../components/AnimatedNumber';
import { adminStagger, adminStaggerItem } from '../motion/adminMotion';
import { SURVEY_STATUS_LABEL_RU } from '../lib/labels';
import type { MultiSurveyAnalyticsPayload, Survey, SurveyGroup } from '../types';

const MAX_SELECTION = 10;

function formatNarrative(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function sourceLabel(source: string): string {
  if (source === 'llm_multi') return 'Сводка нейросети: выводы, объединение вопросов, выбор диаграмм';
  if (source === 'llm_multi_partial') return 'Частично: темы и графики — модель; основной текст — автосводка';
  if (source === 'heuristic_multi') return 'Автосводка без нейросети';
  return source;
}

export default function MultiSurveyAnalyticsPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [surveyGroups, setSurveyGroups] = useState<SurveyGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<MultiSurveyAnalyticsPayload | null>(null);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setListErr(null);
    try {
      const data = await listSurveys();
      setSurveys(data);
      try {
        const groups = await getSurveyGroups();
        setSurveyGroups(groups);
      } catch {
        setSurveyGroups([]);
      }
    } catch (e) {
      setListErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const visibleSurveys = useMemo(() => {
    if (!groupFilter) return surveys;
    if (groupFilter === '__none__') return surveys.filter((s) => !s.survey_group_id);
    const gid = Number(groupFilter);
    return surveys.filter((s) => s.survey_group_id === gid);
  }, [surveys, groupFilter]);

  useEffect(() => {
    setSelected(new Set());
    setResult(null);
    setRunErr(null);
  }, [groupFilter]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTION) next.add(id);
      return next;
    });
    setResult(null);
    setRunErr(null);
  };

  const selectAllVisible = () => {
    const next = new Set<number>();
    for (const s of visibleSurveys.slice(0, MAX_SELECTION)) next.add(s.id);
    setSelected(next);
    setResult(null);
    setRunErr(null);
  };

  const clearSelection = () => {
    setSelected(new Set());
    setResult(null);
    setRunErr(null);
  };

  async function run() {
    if (selected.size === 0) {
      setRunErr('Отметьте хотя бы один опрос.');
      return;
    }
    setRunning(true);
    setRunErr(null);
    try {
      const payload = await postMultiSurveyAnalytics([...selected]);
      setResult(payload);
    } catch (e) {
      setResult(null);
      const msg = e instanceof Error ? e.message : 'Ошибка запроса';
      const timeoutHint =
        /504|502|gateway timeout|timed out|таймаут|пустой или неполный ответ|Unexpected end of JSON/i.test(
          msg,
        )
          ? ' Если это таймаут: возьмите меньше опросов за один запрос; на Cloud Function выставьте execution-timeout 120–180s и при API Gateway — лимит интеграции не ниже таймаута функции. После смены настроек создайте новую версию функции.'
          : '';
      setRunErr(msg + timeoutHint);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page admin-dash-page multi-survey-analytics-page">
      <motion.header
        className="card admin-dash-hero glass-surface"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="admin-dash-kicker">Модуль аналитики · опросы</p>
        <h1 className="admin-dash-title">Сводка по нескольким опросам</h1>
        <p className="muted admin-dash-lead">
          Выберите до {MAX_SELECTION} волн одного и того же (или разных) опроса. При настроенном LLM на функции модель объединяет похожие
          вопросы, формулирует выводы (не только цифры), отбирает до 8 ключевых диаграмм и выдаёт структурированную записку. Без ключа —
          автоматический разбор по каждому опросу и топовые графики по объёму ответов.
        </p>
      </motion.header>

      <motion.section
        className="card glass-surface multi-survey-analytics-select"
        variants={adminStagger}
        initial="hidden"
        animate="show"
      >
        <div className="multi-survey-analytics-toolbar">
          <div className="multi-survey-analytics-toolbar-left">
            <h2 className="admin-dash-h2 admin-dash-h2--flush">Опросы</h2>
            <label className="multi-survey-analytics-group-filter">
              <span className="muted">Раздел</span>
              <select
                className="excel-analytics-select"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                aria-label="Фильтр по разделу опросов"
              >
                <option value="">Все разделы</option>
                <option value="__none__">Без раздела</option>
                {surveyGroups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                    {g.curator_name ? ` · ${g.curator_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="multi-survey-analytics-actions">
            <motion.button type="button" className="btn" onClick={() => void refreshList()} whileTap={{ scale: 0.97 }}>
              Обновить список
            </motion.button>
            <motion.button type="button" className="btn" onClick={selectAllVisible} whileTap={{ scale: 0.97 }}>
              Первые {MAX_SELECTION}
            </motion.button>
            <motion.button type="button" className="btn" onClick={clearSelection} whileTap={{ scale: 0.97 }}>
              Снять выделение
            </motion.button>
            <motion.button
              type="button"
              className="btn primary"
              disabled={running || selected.size === 0}
              onClick={() => void run()}
              whileTap={{ scale: 0.97 }}
            >
              {running ? 'Сбор данных…' : 'Построить сводку и аналитику'}
            </motion.button>
          </div>
        </div>
        {listErr && <p className="err">{listErr}</p>}
        {runErr && <p className="err">{runErr}</p>}
        {loadingList ? (
          <PulseLoadingDashboard />
        ) : surveys.length === 0 ? (
          <p className="muted">Нет опросов. Создайте опрос на главной админки.</p>
        ) : visibleSurveys.length === 0 ? (
          <p className="muted">В выбранном разделе нет опросов. Смените фильтр или назначьте раздел в «Разделы опросов».</p>
        ) : (
          <ul className="multi-survey-analytics-list">
            {visibleSurveys.map((s) => {
              const isOn = selected.has(s.id);
              const disabled = !isOn && selected.size >= MAX_SELECTION;
              return (
                <motion.li
                  key={s.id}
                  className={`multi-survey-analytics-row${isOn ? ' multi-survey-analytics-row--on' : ''}`}
                  variants={adminStaggerItem}
                >
                  <label className="multi-survey-analytics-label">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={disabled}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="multi-survey-analytics-title">{s.title || `Опрос #${s.id}`}</span>
                    <span className="muted multi-survey-analytics-meta">
                      {SURVEY_STATUS_LABEL_RU[s.status] ?? s.status} · id {s.id}
                      {s.survey_group?.name ? ` · ${s.survey_group.name}` : ''}
                    </span>
                  </label>
                  <Link to={`/surveys/${s.id}/analytics`} className="multi-survey-analytics-link">
                    Аналитика опроса
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        )}
      </motion.section>

      {result && (
        <motion.section
          className="card glass-surface multi-survey-analytics-result"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="multi-survey-analytics-result-head">
            <h2 className="admin-dash-h2 admin-dash-h2--flush">Сводка</h2>
            <span
              className={`ai-insights-source ai-insights-source--${
                result.source === 'llm_multi' || result.source === 'llm_multi_partial' ? 'llm_hybrid' : 'heuristic'
              }`}
            >
              {sourceLabel(result.source)}
            </span>
          </div>
          {result.llm_fallback?.hint_ru && (
            <p className="muted multi-survey-llm-fallback" role="status">
              {result.llm_fallback.hint_ru}
            </p>
          )}
          <p className="multi-survey-analytics-grand muted">
            Всего анкет по выборке:{' '}
            <strong className="multi-survey-analytics-grand-num">
              <AnimatedNumber value={result.grand_total_responses} duration={0.9} />
            </strong>
          </p>
          <div className="multi-survey-analytics-table-wrap">
            <table className="multi-survey-analytics-table">
              <thead>
                <tr>
                  <th>Опрос</th>
                  <th>Статус</th>
                  <th>Вопросов</th>
                  <th>Ответов</th>
                </tr>
              </thead>
              <tbody>
                {result.surveys.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/surveys/${row.id}/results`}>{row.title || `#${row.id}`}</Link>
                    </td>
                    <td>{SURVEY_STATUS_LABEL_RU[row.status] ?? row.status}</td>
                    <td>{row.question_count}</td>
                    <td>{row.total_responses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.source !== 'heuristic_multi' && result.narrative && (
            <div className="ai-insights-narrative multi-survey-analytics-narrative">
              <h3 className="ai-insights-section-title">Текстовая аналитика</h3>
              <div className="ai-insights-narrative-inner">
                {result.narrative_sections && result.narrative_sections.length > 0
                  ? result.narrative_sections.map((sec, i) => (
                      <div key={i} className="multi-survey-narrative-block">
                        <h4 className="multi-survey-narrative-heading">{sec.heading}</h4>
                        <p className="ai-insights-narrative-p">{sec.body}</p>
                      </div>
                    ))
                  : formatNarrative(result.narrative).map((para, i) => (
                      <p key={i} className="ai-insights-narrative-p">
                        {para}
                      </p>
                    ))}
              </div>
            </div>
          )}

          {result.highlight_questions && result.highlight_questions.length > 0 && (
            <div className="multi-survey-highlights">
              <h3 className="ai-insights-section-title">Ключевые диаграммы</h3>
              <p className="muted multi-survey-highlights-lead">
                Подбор по смыслу и важности для выводов (при LLM) или по объёму ответов (авторежим). Ссылка на опрос — в подписи карточки.
              </p>
              <div className="multi-survey-highlights-grid">
                {result.highlight_questions.map((hq, index) => (
                  <div key={`${hq.survey_id}-${hq.question.question_id}`} className="multi-survey-highlight-wrap">
                    <div className="multi-survey-highlight-meta">
                      <Link to={`/surveys/${hq.survey_id}/analytics`} className="multi-survey-highlight-survey-link">
                        {hq.survey_title || `Опрос #${hq.survey_id}`}
                      </Link>
                      {hq.chart_rationale ? (
                        <p className="muted multi-survey-highlight-why">{hq.chart_rationale}</p>
                      ) : null}
                    </div>
                    <ResultQuestionCard q={hq.question} index={index} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.merged_themes && result.merged_themes.length > 0 && (
            <div className="multi-survey-merged">
              <h3 className="ai-insights-section-title">Объединённые темы по вопросам</h3>
              <p className="muted multi-survey-merged-lead">
                Схожие формулировки из разных волн сведены в одну линию; ref вида <code>id_Qвопрос</code> — опрос и вопрос в базе.
              </p>
              <ul className="multi-survey-merged-list">
                {result.merged_themes.map((t, i) => (
                  <li key={i} className="multi-survey-merged-card glass-surface">
                    <h4 className="multi-survey-merged-title">{t.theme_title}</h4>
                    {t.refs.length > 0 && (
                      <p className="multi-survey-merged-refs muted">
                        {t.refs.map((ref, j) => (
                          <span key={j} className="multi-survey-merged-ref">
                            {ref}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="multi-survey-merged-synthesis">{t.synthesis}</p>
                    {t.takeaway ? <p className="multi-survey-merged-takeaway">{t.takeaway}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.source === 'heuristic_multi' && result.narrative && (
            <div className="ai-insights-narrative multi-survey-analytics-narrative">
              <h3 className="ai-insights-section-title">Текстовая аналитика</h3>
              <div className="ai-insights-narrative-inner">
                {formatNarrative(result.narrative).map((para, i) => (
                  <p key={i} className="ai-insights-narrative-p">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          )}
        </motion.section>
      )}
    </div>
  );
}
