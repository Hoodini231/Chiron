import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import AnalysisPage from './pages/AnalysisPage';
import CapturePage from './pages/capture/CapturePage';
import ResultsPage from './pages/ResultsPage';

const router = createHashRouter([
  { path: '/', element: <Navigate to="/capture" replace /> },
  {
    path: '/capture',
    element: <CapturePage />,
  },
  {
    path: '/results/:id?',
    element: <ResultsPage />,
  },
  {
    path: '/analysis/:id',
    element: <AnalysisPage />,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
