import { useParams } from 'react-router-dom';
import DirectorResultsView from '../components/DirectorResultsView';

export default function SurveyDirectorLessonDetailPage() {
  const { directorToken: rawToken, lessonKey: rawLesson } = useParams();
  const directorToken = rawToken ? decodeURIComponent(rawToken) : '';
  const lessonKey = rawLesson ? decodeURIComponent(rawLesson).trim() : '';

  if (!directorToken || !lessonKey) {
    return (
      <div className="page director-survey-page director-survey-page--narrow">
        <p className="err">Некорректная ссылка</p>
      </div>
    );
  }

  return <DirectorResultsView directorToken={directorToken} lessonKey={lessonKey} />;
}
