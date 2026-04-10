import { useParams } from 'react-router-dom';
import DirectorResultsView from '../components/DirectorResultsView';

export default function SurveyDirectorPage() {
  const { directorToken: rawToken } = useParams();
  const directorToken = rawToken ? decodeURIComponent(rawToken) : '';

  if (!directorToken) {
    return (
      <div className="page director-survey-page director-survey-page--narrow">
        <p className="err">Некорректная ссылка</p>
      </div>
    );
  }

  return <DirectorResultsView directorToken={directorToken} showLessonsHubLink />;
}
