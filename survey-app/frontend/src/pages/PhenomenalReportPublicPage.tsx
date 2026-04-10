import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicPhenomenalReport, type PublicPhenomenalReportPayload } from '../api/client';
import PhenomenalBlockCompetencyPanel from '../lib/phenomenalLessons/PhenomenalBlockCompetencyPanel';
import PhenomenalCompetencyCharts from '../lib/phenomenalLessons/PhenomenalCompetencyCharts';
import { effectiveReviewParts } from '../lib/phenomenalLessons/parentReviewFormat';
import {
  phenomenalBlockHeadingTitle,
  type PhenomenalReportBlockDraft,
  type PhenomenalReportDraft,
  type PhenomenalReportReviewLine,
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
    reviews: b.reviews.map((r) => ({
      id: r.id,
      text: r.text,
      fromMergedParent: r.fromMergedParent,
      fromPulse: r.fromPulse,
      respondentName: r.respondentName,
      overallRating: r.overallRating,
      comments: r.comments,
    })),
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
        <p className="muted" style={{ fontSize: '0.86rem', marginTop: '0.45rem', lineHeight: 1.45 }}>
          {data.survey_linked
            ? 'Комментарии с Пульса подставляются по совпадению класса, учителя и шифра урока.'
            : 'Опрос на Пульсе к отчёту не привязан — блок «Пульс» будет пустым.'}
        </p>
      </header>

      <section className="card glass-surface phenomenal-competency-section phenomenal-public-aggregate-chart" style={{ marginTop: '1rem' }}>
        <PhenomenalCompetencyCharts mode="draft" draft={draftForCharts} />
      </section>

      {data.blocks.map((block, bi) => {
        const pulse = data.parent_pulse_comments[block.id] ?? [];
        const bDraft = toBlockDraft(block);
        return (
          <article key={block.id} className="card glass-surface phenomenal-report-block phenomenal-public-lesson-card" style={{ marginTop: '1rem' }}>
            <h2 className="phenomenal-report-block-title">{phenomenalBlockHeadingTitle(bDraft, bi)}</h2>
            <div className="phenomenal-report-block-top phenomenal-public-block-top">
              <div className="phenomenal-report-block-fields">
                <div className="phenomenal-public-meta-grid" aria-label="Данные урока из черновика">
                  <dl className="phenomenal-public-dl phenomenal-public-dl--cell">
                    <dt>Шифр урока / класс</dt>
                    <dd className="phenomenal-public-prose">{block.lessonCode || '—'}</dd>
                  </dl>
                  <dl className="phenomenal-public-dl phenomenal-public-dl--cell">
                    <dt>ФИО ведущих</dt>
                    <dd className="phenomenal-public-prose">{block.conductingTeachers || '—'}</dd>
                  </dl>
                  <dl className="phenomenal-public-dl phenomenal-public-dl--cell">
                    <dt>Предметы</dt>
                    <dd className="phenomenal-public-prose">
                      {block.subjects?.trim() ? block.subjects : 'Не указано в чек-листе'}
                    </dd>
                  </dl>
                  <dl className="phenomenal-public-dl phenomenal-public-dl--cell">
                    <dt>Оценка методики (/10)</dt>
                    <dd className="phenomenal-public-prose">{block.methodologicalScore || '—'}</dd>
                  </dl>
                  {block.parentClassLabel ? (
                    <dl className="phenomenal-public-dl phenomenal-public-dl--cell">
                      <dt>Класс (опрос родителей, Пульс)</dt>
                      <dd className="phenomenal-public-prose">{block.parentClassLabel}</dd>
                    </dl>
                  ) : null}
                </div>
              </div>
              <div className="phenomenal-report-block-chart phenomenal-public-block-chart">
                <PhenomenalBlockCompetencyPanel source="block" block={bDraft} variant="public" />
              </div>
            </div>
            {block.teacherNotes ? (
              <section className="phenomenal-public-teacher-notes">
                <h3 className="phenomenal-report-section-title">Выводы педагога (из Excel)</h3>
                <div className="phenomenal-public-prose phenomenal-public-prose--notes">{block.teacherNotes}</div>
              </section>
            ) : null}
            <section className="phenomenal-report-parents-panel phenomenal-public-parents-panel">
              <h3 className="phenomenal-report-section-title">Отзывы родителей</h3>
              {block.reviews.length === 0 ? (
                <p className="phenomenal-public-empty-hint">Для этого урока в черновике нет строк отзывов.</p>
              ) : (
                <ul className="phenomenal-public-reviews">
                  {block.reviews.map((r) => {
                    const parts = effectiveReviewParts(r as PhenomenalReportReviewLine);
                    const hasStruct = parts.name || parts.rating || parts.comments;
                    return (
                      <li key={r.id} className="phenomenal-public-review-item">
                        {hasStruct ? (
                          <div className="phenomenal-public-review-structured">
                            {parts.name ? (
                              <p className="phenomenal-public-review-block">
                                <span className="phenomenal-public-review-label">ФИО</span>
                                <span className="phenomenal-public-review-value phenomenal-public-prose">{parts.name}</span>
                              </p>
                            ) : null}
                            {parts.rating ? (
                              <p className="phenomenal-public-review-block">
                                <span className="phenomenal-public-review-label">Общая оценка</span>
                                <span className="phenomenal-public-review-value phenomenal-public-prose">{parts.rating}</span>
                              </p>
                            ) : null}
                            {parts.comments ? (
                              <p className="phenomenal-public-review-block phenomenal-public-review-comments">
                                <span className="phenomenal-public-review-label">Комментарии</span>
                                <span className="phenomenal-public-review-value phenomenal-public-prose">{parts.comments}</span>
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="phenomenal-public-review-fallback phenomenal-public-prose">{r.text || '—'}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className="phenomenal-public-pulse-panel">
              <h3 className="phenomenal-report-section-title">Комментарии родителей (Пульс)</h3>
              {pulse.length === 0 ? (
                <p className="phenomenal-public-empty-hint">Нет комментариев с Пульса по этому уроку.</p>
              ) : (
                <ul className="phenomenal-pulse-comments">
                  {pulse.map((c, i) => (
                    <li key={`${block.id}-p-${i}`} className="phenomenal-pulse-comments-item">
                      <strong className="phenomenal-pulse-q">{c.question}</strong>
                      <div className="phenomenal-public-prose phenomenal-pulse-comments-body">{c.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </article>
        );
      })}
    </div>
  );
}
