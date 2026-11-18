import { useEffect, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Layout, Menu, Tag, Typography } from 'antd';
import {
  UnorderedListOutlined,
  StarOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { ValuationPage } from './ValuationPage';
import { MergersPage } from './MergersPage';
import { CompanyDetails } from './CompanyDetails';
import { CompanyListPage } from './CompanyListPage';
import {
  companyPath,
  legacyHomePath,
  listReturnPath,
  routePaths,
  valuationPath,
} from './routes';

function HomeRedirect() {
  const location = useLocation();
  return <Navigate replace to={legacyHomePath(location.search)} />;
}
function ListRoute({ favorites = false }: { favorites?: boolean }) {
  const location = useLocation(),
    navigate = useNavigate();
  const from = location.pathname + location.search;
  return (
    <CompanyListPage
      key={location.pathname}
      favorites={favorites}
      onOpen={(ticker) => navigate(companyPath(ticker, from))}
      onValuation={(ticker) => navigate(valuationPath(ticker, from))}
    />
  );
}
function CompanyRoute({ valuation = false }: { valuation?: boolean }) {
  const { ticker } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = listReturnPath(search.get('from'));
  if (!ticker || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
    return <Navigate replace to="/companies" />;
  return valuation ? (
    <ValuationPage
      key={ticker}
      ticker={ticker}
      onBack={() => navigate(returnTo)}
    />
  ) : (
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
export function App() {
  const location = useLocation(),
    navigate = useNavigate();
  const isValuation = Boolean(useMatch(routePaths.valuation));
  const companyRoute = useMatch('/companies/:ticker/*');
  const [collapsed, setCollapsed] = useState(false);
  const activePath = companyRoute
    ? listReturnPath(new URLSearchParams(location.search).get('from')).split(
        '?',
      )[0]
    : location.pathname === '/favorites'
      ? '/favorites'
      : location.pathname === '/mergers'
        ? '/mergers'
        : '/companies';
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header">
        <div className="header-content">
          <Typography.Title level={4} className="app-title">
            Company Research
          </Typography.Title>
          <Tag color="blue">SEC 公司研究</Tag>
        </div>
      </Layout.Header>
      <Layout>
        <Layout.Sider
          theme="light"
          width={160}
          collapsedWidth={64}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          breakpoint="md"
          onBreakpoint={setCollapsed}
          className="app-sidebar"
          trigger={
            <span aria-label={collapsed ? '展开导航' : '收起导航'}>
              {collapsed ? '»' : '«'}
            </span>
          }
        >
          <Menu
            mode="inline"
            selectedKeys={[activePath]}
            onClick={({ key }) => navigate(key)}
            items={[
              {
                key: '/companies',
                label: '公司列表',
                icon: <UnorderedListOutlined />,
              },
              { key: '/favorites', label: '我的收藏', icon: <StarOutlined /> },
              { key: '/mergers', label: '并购套利', icon: <SwapOutlined /> },
            ]}
          />
        </Layout.Sider>
        <Layout className="app-main">
          <Layout.Content
            className={`app-content${isValuation ? ' app-content-valuation' : ''}`}
          >
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path={routePaths.companies} element={<ListRoute />} />
              <Route
                path={routePaths.favorites}
                element={<ListRoute favorites />}
              />
              <Route path={routePaths.mergers} element={<MergersPage />} />
              <Route path={routePaths.detail} element={<CompanyRoute />} />
              <Route
                path={routePaths.valuation}
                element={<CompanyRoute valuation />}
              />
              <Route path="*" element={<Navigate replace to="/companies" />} />
            </Routes>
          </Layout.Content>
          {!isValuation && (
            <Layout.Footer className="app-footer">
              数据来源：
              {location.pathname === '/mergers'
                ? 'FMP / SEC EDGAR'
                : 'SEC EDGAR'}
            </Layout.Footer>
          )}
        </Layout>
      </Layout>
    </Layout>
  );
}
