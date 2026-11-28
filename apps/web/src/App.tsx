import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { MergersPage } from './pages/MergerArbitrage/index';
import { CompanyDetails } from './pages/CompanyDetail/index';
import { ListRoute } from './pages/CompanyList/index';
import { FavoritesPage } from './pages/Favorites/index.js';
import { AppLayout } from './layouts/AppLayout/index';
import {
  legacyHomePath,
  listReturnPath,
  routePaths,
  legacyValuationPath,
} from './utils/routes';
function HomeRedirect() {
  const location = useLocation();
  return <Navigate replace to={legacyHomePath(location.search)} />;
}
function CompanyRoute() {
  const { ticker } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = listReturnPath(search.get('from'));
  if (!ticker || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
    return <Navigate replace to="/companies" />;
  return (
    <CompanyDetails
      key={ticker}
      identifier={ticker}
      backLabel={
        returnTo.split('?')[0] === '/favorites'
          ? '返回我的收藏'
          : '返回公司列表'
      }
      onBack={() => navigate(returnTo)}
    />
  );
}
function LegacyValuationRedirect() {
  const { ticker } = useParams();
  const location = useLocation();
  if (!ticker || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
    return <Navigate replace to="/companies" />;
  return <Navigate replace to={legacyValuationPath(ticker, location.search)} />;
}
export function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path={routePaths.companies} element={<ListRoute />} />
        <Route path={routePaths.favorites} element={<FavoritesPage />} />
        <Route path={routePaths.mergers} element={<MergersPage />} />
        <Route path={routePaths.detail} element={<CompanyRoute />} />
        <Route
          path={routePaths.valuation}
          element={<LegacyValuationRedirect />}
        />
        <Route path="*" element={<Navigate replace to="/companies" />} />
      </Routes>
    </AppLayout>
  );
}
