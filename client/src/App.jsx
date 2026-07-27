import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken, getUser } from './lib/auth'
import { isAdminUser } from './lib/nav'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import InspectionList from './pages/InspectionList'
import NewInspection from './pages/NewInspection'
import CustomInspectionBuilder from './pages/CustomInspectionBuilder'
import MiscInspectionBuilder from './pages/MiscInspectionBuilder'
import InspectionForm from './pages/InspectionForm'
import InspectionDetail from './pages/InspectionDetail'
import NCRList from './pages/NCRList'
import NCRDetail from './pages/NCRDetail'
import MyInspections from './pages/MyInspections'
import QualityAlerts from './pages/QualityAlerts'
import Reports from './pages/Reports'
import Admin from './pages/Admin'
import InjectorTests from './pages/InjectorTests'
import Drawings from './pages/Drawings'
import NotFound from './pages/NotFound'

// Guards protected routes: requires a valid app JWT (obtained after Entra sign-in).
// If no token is present, redirect to /login — Login.jsx will then detect whether
// there is an active MSAL session and either exchange it for a token automatically
// or prompt the user to sign in.
function PrivateRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

// Redirects already-authenticated users away from /login to the dashboard.
function PublicRoute({ children }) {
  return getToken() ? <Navigate to="/" replace /> : children
}

// Guards admin-only pages (e.g. Injector Tests). A non-admin who types the URL
// is sent back to the dashboard; the matching API routes reject them too, so
// the data is protected even if this check is bypassed.
function AdminRoute({ children }) {
  return isAdminUser(getUser()) ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="my-inspections" element={<MyInspections />} />
          <Route path="inspections" element={<InspectionList />} />
          <Route path="inspections/new" element={<NewInspection />} />
          <Route path="inspections/new/custom" element={<CustomInspectionBuilder />} />
          <Route path="inspections/new/misc" element={<MiscInspectionBuilder />} />
          <Route path="inspections/:id" element={<InspectionDetail />} />
          <Route path="inspections/:id/edit" element={<InspectionForm />} />
          <Route path="ncrs" element={<NCRList />} />
          <Route path="ncrs/:id" element={<NCRDetail />} />
          <Route path="quality-alerts" element={<QualityAlerts />} />
          <Route path="drawings" element={<Drawings />} />
          <Route path="reports" element={<Reports />} />
          <Route path="admin" element={<Admin />} />
          <Route
            path="injector-tests"
            element={
              <AdminRoute>
                <InjectorTests />
              </AdminRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}