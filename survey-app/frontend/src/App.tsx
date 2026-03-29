import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import AdminLayout from './layout/AdminLayout';
import PublicLayout from './layout/PublicLayout';
import AdminDashboard from './pages/AdminDashboard';
import SurveyBuilder from './pages/SurveyBuilder';
import SurveyResults from './pages/SurveyResults';
import PublicForm from './pages/PublicForm';
import ImportWorkbookPage from './pages/ImportWorkbookPage';

function FormAliasRedirect() {
  const { accessLink } = useParams();
  return <Navigate to={`/s/${accessLink ?? ''}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<AdminDashboard />} />
        <Route path="/surveys/new" element={<SurveyBuilder />} />
        <Route path="/surveys/:id/edit" element={<SurveyBuilder />} />
        <Route path="/surveys/:id/results" element={<SurveyResults />} />
        <Route path="/import-workbook" element={<ImportWorkbookPage />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="/s/:accessLink" element={<PublicForm />} />
      </Route>
      <Route path="/form/:accessLink" element={<FormAliasRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
