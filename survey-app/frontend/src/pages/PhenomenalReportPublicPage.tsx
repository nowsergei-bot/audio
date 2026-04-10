import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicPhenomenalReport, type PublicPhenomenalReportPayload } from '../api/client';
import PhenomenalBlockCompetencyPanel from '../lib/phenomenalLessons/PhenomenalBlockCompetencyPanel';
import PhenomenalCompetencyCharts from '../lib/phenomenalLessons/PhenomenalCompetencyCharts';
import {
  phenomenalBlockHeadingTitle,
  type PhenomenalReportBlockDraft,
  type PhenomenalReportDraft,
} from '../lib/phenomenalLessons/reportDraftTypes';

function toBlockDraft(b: PublicPhenomenalReportPayload['blocks'][number]): PhenomenalReportBlockDraft {
  return {
    id: b.id,
    sourceTeacherRowIndex: null,
    lessonCode: b.lessonCode,
    conductingTeachers: b.conductingTeachers,
    subjects: b.subjects,
    methodologicalScore: b.methodologicalScore,
    teacherNotes: b.teacherNotes,
    observerName: '',
    parentClassLabel: b.parentClassLabel ?? '',
    rubricOrganizational: b.rubricOrganizational,
    rubricGoalSetting: b.rubricGoalSetting,
    rubricTechnologies: b.rubricTechnologies,
    rubricInformation: b.rubricInformation,
    rubricGeneralContent: b.rubricGeneralContent,
    rubricCultural: b.rubricCultural,
    rubricReflection: b.rubricReflection,
    reviews: b.reviews.map((r) => ({ ...r })),
  };
}

export default function PhenomenalReportPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicPhenomenalReportPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = token?.trim();
    if (!raw) {
      setErr('Нет ссылки');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await getPublicPhenomenalReport(raw);
        if (!cancelled) {
          setData(d);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const draftForCharts = useMemo((): PhenomenalReportDraft | null => {
    if (!data) return null;
    return {
      title: data.title,
      periodLabel: data.period_label,
      blocks: data.blocks.map(toBlockDraft),
      updatedAt: new Date().toISOString(),
      surveyId: null,
    };
  }, [data]);

  if (err && !data) {
    return (
      <div className="page phenomenal-report-public-page">
        <section className="card glass-surface" style={{ marginTop: '1rem' }}>
          <h1 className="admin-dash-title">Отчёт недоступен</h1>
          <p className="err">{err}</p>
        </section>
      </div>
    );
  }

  if (!data || !draftForCharts) {
    return (
      <div className="page phenomenal-report-public-page">
        <p className="muted" style={{ marginTop: '1.5rem' }}>
          Загрузка…
        </p>
      </div>
    );
  }

  return (
    <div className="page phenomenal-report-public-page">
      <header className="card glass-surface" style={{ marginTop: '1rem' }}>
        <h1 className="admin-dash-title">{data.title}</h1>
        {data.period_label ? <p className="muted admin-dash-lead">{data.period_label}</p> : null}
        <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.5rem' }}>
          {data.survey_linked
            ? 'Комментарии родителей с Пульса подгружаются при открытии страницы (по уроку: класс, учитель, шифр).'
            : 'К этому отчёту не привязан опрос на Пульсе — блоки комментариев родителей пустые.'}
        </p>
      </header>

      <section className="card glass-surface phenomenal-competency-section" style={{ marginTop: '1rem' }}>
        <PhenomenalCompetencyCharts mode="draft" draft={draftForCharts} />
      </section>

      {data.blocks.map((block, bi) => {
        const pulse = data.parent_pulse_comments[block.id] ?? [];
        const bDraft = toBlockDraft(block);
        return (
          <article key={block.id} className="card glass-surface phenomenal-report-block" style={{ marginTop: '1rem' }}>
            <h2 className="phenomenal-report-block-title">{phenomenalBlockHeadingTitle(bDraft, bi)}</h2>
            <div className="phenomenal-report-block-top">
              <div className="phenomenal-report-block-fields">
                <dl className="phenomenal-public-dl">
                  <div>
                    <dt>Шифр / класс</dt>
                    <dd>{block.lessonCode || '—'}</dd>
                  </div>
                  <div>
                    <dt>ФИО ведущих</dt>
                    <dd>{block.conductingTeachers || '—'}</dd>
                  </div>
                  <div>
                    <dt>Предметы</dt>
                    <dd>{block.subjects || '—'}</dd>
                  </div>
                  {block.parentClassLabel ? (
                    <div>
                      <dt>Класс (опрос родителей)</dt>
                      <dd>{block.parentClassLabel}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <div className="phenomenal-report-block-chart">
                <PhenomenalBlockCompetencyPanel source="block" block={bDraft} variant="editorSidebar" />
              </div>
            </div>
            {block.teacherNotes ? (
              <div style={{ marginTop: '0.75rem' }}>
                <h3 className="phenomenal-merge-subtitle">Выводы педагога</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{block.teacherNotes}</p>
              </div>
            ) : null}
            <h3 className="phenomenal-merge-subtitle" style={{ marginTop: '1rem' }}>
              Отзывы в отчёте
            </h3>
            {block.reviews.length === 0 ? (
              <p className="muted">Нет строк в черновике.</p>
            ) : (
              <ul className="phenomenal-public-reviews">
                {block.reviews.map((r) => (
                  <li key={r.id}>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="phenomenal-merge-subtitle" style={{ marginTop: '1rem' }}>
              Комментарии родителей (Пульс)
            </h3>
            {pulse.length === 0 ? (
              <p className="muted">Нет текстовых ответов по этому уроку или опрос не сопоставлен.</p>
            ) : (
              <ul className="phenomenal-pulse-comments">
                {pulse.map((c, i) => (
                  <li key={`${block.id}-p-${i}`}>
                    <strong className="phenomenal-pulse-q">{c.question}</strong>
                    <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>{c.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
