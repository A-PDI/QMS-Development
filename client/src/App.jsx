import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken, getUser } from './lib/auth'
import { canAccessRoute } from './lib/nav'
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
import NCRView from './pages/NCRView'
import NCREditor from './pages/NCREditor'
import MyInspections from './pages/MyInspections'
import QualityAlerts from './pages/QualityAlerts'
import Reports from './pages/Reports'
import Admin from './pages/Admin'
import InjectorTests from './pages/InjectorTests'
import InjectorReports from './pages/InjectorReports'
import Drawings from './pages/Drawings'

// E-sign pages pull in pdf.js (~400 kB), so they load on first use only.
const EsignList = lazy(() => import('./pages/esign/EsignList'))
const EsignNew = lazy(() => import('./pages/esign/EsignNew'))
const EsignEditor = lazy(() => import('./pages/esign/EsignEditor'))
const EsignDetail = lazy(() => import('./pages/esign/EsignDetail'))
const EsignInbox = lazy(() => import('./pages/esign/EsignInbox'))
const SignDocument = lazy(() => import('./pages/SignDocument'))

function Lazy({ children }) {
  return (
    <Suspense fallback={<div className="py-24 text-center text-sm text-gray-400">Loading…</div>}>
      {children}
    </Suspense>
  )
}
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

// Guards restricted pages using the SAME rule as the sidebar (lib/nav.js), so
// a page can never be hidden from the menu but reachable by URL. Injector Tests
// is admin-only; a user without the role is sent back to the dashboard, and the
// matching API routes reject them too.
function RoleRoute({ path, children }) {
  return canAccessRoute(path, getUser()) ? children : <Navigate to="/" replace />
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
        {/* Public: signers open this from their e-mail without an account. */}
        <Route path="/sign/:token" element={<Lazy><SignDocument /></Lazy>} />
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
          <Route path="ncrs/new" element={<NCREditor />} />
          <Route path="ncrs/:id" element={<NCRView />} />
          <Route path="ncrs/:id/edit" element={<NCREditor />} />
          <Route path="quality-alerts" element={<QualityAlerts />} />
          <Route path="drawings" element={<Drawings />} />
          <Route path="esign" element={<RoleRoute path="/esign"><Lazy><EsignList /></Lazy></RoleRoute>} />
          <Route path="esign/new" element={<RoleRoute path="/esign"><Lazy><EsignNew /></Lazy></RoleRoute>} />
          <Route path="esign/inbox" element={<Lazy><EsignInbox /></Lazy>} />
          <Route path="esign/:id" element={<RoleRoute path="/esign"><Lazy><EsignDetail /></Lazy></RoleRoute>} />
          <Route path="esign/:id/edit" element={<RoleRoute path="/esign"><Lazy><EsignEditor /></Lazy></RoleRoute>} />
          <Route path="reports" element={<Reports />} />
          <Route path="admin" element={<Admin />} />
          <Route
            path="injector-tests"
            element={
              <RoleRoute path="/injector-tests">
                <InjectorTests />
              </RoleRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
          <Route path="injector-reports" element={<RoleRoute path="/injector-reports"><InjectorReports /></RoleRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
