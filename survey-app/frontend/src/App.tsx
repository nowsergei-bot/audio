import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import AdminLayout from './layout/AdminLayout';
import PublicLayout from './layout/PublicLayout';
import AdminDashboard from './pages/AdminDashboard';
import SurveyBuilder from './pages/SurveyBuilder';
import SurveyResults from './pages/SurveyResults';
import SurveyAnalytics from './pages/SurveyAnalytics';
import PublicForm from './pages/PublicForm';
import ImportWorkbookPage from './pages/ImportWorkbookPage';
import ExcelAnalyticsPage from './pages/ExcelAnalyticsPage';
import MultiSurveyAnalyticsPage from './pages/MultiSurveyAnalyticsPage';
import AnalyticsModuleLayout from './pages/AnalyticsModuleLayout';
import PedagogicalHubPage from './pages/PedagogicalHubPage';
import PedagogicalAnalyticsLayout from './pages/PedagogicalAnalyticsLayout';
import PedagogicalProgressPage from './pages/PedagogicalProgressPage';
import PedagogicalReviewPage from './pages/PedagogicalReviewPage';
import PedagogicalReportPage from './pages/PedagogicalReportPage';
import PhenomenalLessonsPage from './pages/PhenomenalLessonsPage';
import PhenomenalReportEditorPage from './pages/PhenomenalReportEditorPage';
import PhenomenalReportPublicPage from './pages/PhenomenalReportPublicPage';
import SurveyGroupsAdminPage from './pages/SurveyGroupsAdminPage';
import ImportOldSurveyDataPage from './pages/ImportOldSurveyDataPage';
import AuthPage from './pages/AuthPage';
import QuickSurveyWizard from './pages/QuickSurveyWizard';
import PhotoWallUploadPage from './pages/PhotoWallUploadPage';
import PhotoWallDisplayPage from './pages/PhotoWallDisplayPage';
import PhotoWallTestPage from './pages/PhotoWallTestPage';
import PhotoWallResultsPage from './pages/PhotoWallResultsPage';
import SurveyDirectorPage from './pages/SurveyDirectorPage';
import SurveyDirectorLessonsPage from './pages/SurveyDirectorLessonsPage';
import SurveyDirectorLessonDetailPage from './pages/SurveyDirectorLessonDetailPage';

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
        <Route path="/analytics-excel" element={<Navigate to="/analytics/excel" replace />} />
        <Route path="/analytics-multi-surveys" element={<Navigate to="/analytics/surveys" replace />} />
        <Route path="/analytics" element={<AnalyticsModuleLayout />}>
          <Route index element={<Navigate to="excel" replace />} />
          <Route path="excel" element={<ExcelAnalyticsPage />} />
          <Route path="surveys" element={<MultiSurveyAnalyticsPage />} />
          <Route path="phenomenal" element={<Outlet />}>
            <Route index element={<PhenomenalLessonsPage />} />
            <Route path="report" element={<PhenomenalReportEditorPage />} />
          </Route>
          <Route path="pedagogical" element={<Outlet />}>
            <Route index element={<PedagogicalHubPage />} />
            <Route path=":sessionId" element={<PedagogicalAnalyticsLayout />}>
              <Route index element={<Navigate to="progress" replace />} />
              <Route path="excel" element={<ExcelAnalyticsPage />} />
              <Route path="progress" element={<PedagogicalProgressPage />} />
              <Route path="review" element={<PedagogicalReviewPage />} />
              <Route path="report" element={<PedagogicalReportPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/surveys/groups" element={<SurveyGroupsAdminPage />} />
        <Route path="/import-old-surveys" element={<ImportOldSurveyDataPage />} />
        <Route path="/photo-wall/results" element={<PhotoWallResultsPage />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="/s/:accessLink" element={<PublicForm />} />
        <Route path="/photo-wall" element={<PhotoWallUploadPage />} />
        <Route path="/photo-wall/test" element={<PhotoWallTestPage />} />
        <Route path="/photo-wall/display" element={<PhotoWallDisplayPage />} />
        <Route path="/director/:directorToken/lessons/:lessonKey" element={<SurveyDirectorLessonDetailPage />} />
        <Route path="/director/:directorToken/lessons" element={<SurveyDirectorLessonsPage />} />
        <Route path="/director/:directorToken" element={<SurveyDirectorPage />} />
        <Route path="/phenomenal-report/:token" element={<PhenomenalReportPublicPage />} />
      </Route>
      <Route path="/form/:accessLink" element={<FormAliasRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
