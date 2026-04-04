import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import AdminLayout from './layout/AdminLayout';
import PublicLayout from './layout/PublicLayout';
import AdminDashboard from './pages/AdminDashboard';
import SurveyBuilder from './pages/SurveyBuilder';
import SurveyResults from './pages/SurveyResults';
import SurveyAnalytics from './pages/SurveyAnalytics';
import PublicForm from './pages/PublicForm';
import ImportWorkbookPage from './pages/ImportWorkbookPage';
import ExcelAnalyticsPage from './pages/ExcelAnalyticsPage';
import ImportOldSurveyDataPage from './pages/ImportOldSurveyDataPage';
import AuthPage from './pages/AuthPage';
import QuickSurveyWizard from './pages/QuickSurveyWizard';
import PhotoWallUploadPage from './pages/PhotoWallUploadPage';
import PhotoWallDisplayPage from './pages/PhotoWallDisplayPage';
import PhotoWallTestPage from './pages/PhotoWallTestPage';
import PhotoWallResultsPage from './pages/PhotoWallResultsPage';
import SurveyDirectorPage from './pages/SurveyDirectorPage';

function FormAliasRedirect() {
  const { accessLink } = useParams();
  return <Navigate to={`/s/${accessLink ?? ''}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<AdminDashboard />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/surveys/new" element={<SurveyBuilder />} />
        <Route path="/surveys/quick" element={<QuickSurveyWizard />} />
        <Route path="/surveys/:id/edit" element={<SurveyBuilder />} />
        <Route path="/surveys/:id/results" element={<SurveyResults />} />
        <Route path="/surveys/:id/analytics" element={<SurveyAnalytics />} />
        <Route path="/import-workbook" element={<ImportWorkbookPage />} />
        <Route path="/analytics-excel" element={<ExcelAnalyticsPage />} />
        <Route path="/import-old-surveys" element={<ImportOldSurveyDataPage />} />
        <Route path="/photo-wall/results" element={<PhotoWallResultsPage />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="/s/:accessLink" element={<PublicForm />} />
        <Route path="/photo-wall" element={<PhotoWallUploadPage />} />
        <Route path="/photo-wall/test" element={<PhotoWallTestPage />} />
        <Route path="/photo-wall/display" element={<PhotoWallDisplayPage />} />
        <Route path="/director/:directorToken" element={<SurveyDirectorPage />} />
      </Route>
      <Route path="/form/:accessLink" element={<FormAliasRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
