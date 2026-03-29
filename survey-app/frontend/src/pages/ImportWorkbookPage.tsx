import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postSurveyFromWorkbook } from '../api/client';
import { fadeIn } from '../motion/resultsMotion';

export default function ImportWorkbookPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (!f.name.toLowerCase().endsWith('.xlsx')) {
        setErr('Нужен файл .xlsx');
        return;
      }
      setErr(null);
      setBusy(true);
      try {
        const { survey } = await postSurveyFromWorkbook(f);
        navigate(`/surveys/${survey.id}/edit`, { replace: true });
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : 'Не удалось создать опрос');
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page import-workbook-page" {...fadeIn}>
        <motion.header
          className="card import-workbook-hero glass-surface"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="admin-dash-kicker">Пульс · дашборд</p>
          <h1 className="admin-dash-title">Новый опрос из Excel</h1>
          <p className="muted admin-dash-lead">
            Загрузите файл: будет создан <strong>черновик опроса</strong> (не опубликован). Вопросы и ответы
            формируются автоматически по первому листу. Проверьте типы вопросов в редакторе и при необходимости
            опубликуйте опрос.
          </p>
        </motion.header>

        <motion.section
          className="card import-workbook-drop glass-surface"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <h2 className="admin-dash-h2">Файл .xlsx</h2>
          <p className="muted">До 12 листов, ограничения по строкам/столбцам — как при обычной загрузке таблицы.</p>
          <label className="btn primary import-workbook-file-btn">
            {busy ? 'Обработка…' : 'Выбрать Excel и создать опрос'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              disabled={busy}
              onChange={(ev) => void onPick(ev)}
            />
          </label>
          {err && <p className="err import-workbook-err">{err}</p>}
        </motion.section>
      </motion.div>
    </MotionConfig>
  );
}
