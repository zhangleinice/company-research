import { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import { fetchCompanyDetail, setCompanyFavorite } from './api';
import { CompanyResearchSections } from './analysis/CompanyResearchSections';

export function CompanyDetails({
  identifier,
  onBack,
}: {
  identifier: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<FinancialMode>('annual');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    fetchCompanyDetail(identifier, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '公司数据获取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identifier, revision]);
  async function favorite() {
    if (!detail) return;
    setSaving(true);
    try {
      await setCompanyFavorite(detail.cik, !detail.isFavorite);
      setDetail({ ...detail, isFavorite: !detail.isFavorite });
    } catch (error) {
      setError(error instanceof Error ? error.message : '收藏失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <Space wrap>
        <Button onClick={onBack}>← 返回公司列表</Button>
        <Typography.Title level={3} className="detail-title">
          {detail?.name ?? identifier}
        </Typography.Title>
      </Space>
      {error && (
        <Alert
          type="error"
          showIcon
          title="操作未完成"
          description={error}
          action={
            <Button onClick={() => setRevision((x) => x + 1)}>重试获取</Button>
          }
        />
      )}
      {loading && (
        <Card>
          <Space>
            <Spin />
            <Typography.Text>
              正在读取公司数据；首次访问需要从 SEC 获取并保存财务数据…
            </Typography.Text>
          </Space>
        </Card>
      )}
      {detail && (
        <CompanyResearchSections
          detail={detail}
          mode={mode}
          saving={saving}
          onFavorite={favorite}
          onModeChange={setMode}
          onReload={() => setRevision((value) => value + 1)}
        />
      )}
    </Space>
  );
}
