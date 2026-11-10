import { useEffect, useState } from 'react';
import { Layout, Menu, Tag, Typography } from 'antd';
import { UnorderedListOutlined, StarOutlined } from '@ant-design/icons';
import { CompanyDetails } from './CompanyDetails';
import { CompanyListPage } from './CompanyListPage';
import { companyPath, readRoute } from './routes';

function currentRoute() {
  return readRoute(new URL(window.location.href));
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (window.location.pathname === '/') {
      const legacy = currentRoute();
      window.history.replaceState(
        null,
        '',
        legacy.ticker ? companyPath(legacy.ticker, '/companies') : '/companies',
      );
      setRoute(currentRoute());
    }
    const handler = () => setRoute(currentRoute());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, '', path);
    setRoute(currentRoute());
    window.scrollTo(0, 0);
  }
  const activePath = route.ticker
    ? route.returnTo.split('?')[0]
    : route.listPath;
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
              {
                key: '/favorites',
                label: '我的收藏',
                icon: <StarOutlined />,
              },
            ]}
          />
        </Layout.Sider>
        <Layout className="app-main">
          <Layout.Content className="app-content">
            {route.ticker ? (
              <CompanyDetails
                key={route.ticker}
                identifier={route.ticker}
                backLabel={
                  activePath === '/favorites' ? '返回我的收藏' : '返回公司列表'
                }
                onBack={() => navigate(route.returnTo)}
              />
            ) : (
              <CompanyListPage
                key={route.listPath}
                favorites={route.listPath === '/favorites'}
                onOpen={(ticker) =>
                  navigate(
                    companyPath(
                      ticker,
                      window.location.pathname + window.location.search,
                    ),
                  )
                }
              />
            )}
          </Layout.Content>
          <Layout.Footer className="app-footer">
            数据来源：SEC EDGAR
          </Layout.Footer>
        </Layout>
      </Layout>
    </Layout>
  );
}
