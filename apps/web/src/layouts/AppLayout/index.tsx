import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { Layout, Menu, Tag, Typography } from 'antd';
import {
  UnorderedListOutlined,
  StarOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { listReturnPath } from '../../utils/routes';
export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation(),
    navigate = useNavigate();
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
            className={`app-content${companyRoute ? ' app-content-company' : ''}`}
          >
            {children}
          </Layout.Content>
          <Layout.Footer className="app-footer">
            数据来源：
            {location.pathname === '/mergers' ? 'FMP / SEC EDGAR' : 'SEC EDGAR'}
          </Layout.Footer>
        </Layout>
      </Layout>
    </Layout>
  );
}
