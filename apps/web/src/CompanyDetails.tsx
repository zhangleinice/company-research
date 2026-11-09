import { useEffect, useState, useRef } from 'react';
import { Alert, Button, Card, Space, Spin, Typography, message } from 'antd';
import type {
  CompanyDetail,
  FinancialMode,
  CompanyUpdateState,
} from '@company-research/shared';
import { fetchCompanyDetail, setCompanyFavorite, companyUpdate } from './api';
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
  const [update, setUpdate] = useState<CompanyUpdateState | null>(null);
  const [starting, setStarting] = useState(false);
  const [messageApi, messageContext] = message.useMessage();
  const observedRunning = useRef(false);
  const lastUpdateError = useRef('');
  const [aiRevision, setAiRevision] = useState(0);
  const posting = useRef(false);
  const updating =
    !update ||
    starting ||
    update?.status === 'QUEUED' ||
    update?.status === 'GENERATING';
  const reloadCached = async (signal?: AbortSignal) => {
    const current = await fetchCompanyDetail(identifier, signal);
    if (!signal?.aborted) {
      setDetail(current);
      setAiRevision((x) => x + 1);
    }
  };
  const cik = detail?.cik;
  useEffect(() => {
    if (!cik) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let signature = '';
    const poll = async (initialize = false) => {
      try {
        const next = await companyUpdate(
          cik,
          initialize ? 'initialize' : 'status',
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setUpdate(next);
        lastUpdateError.current = '';
        const running =
          next.status === 'GENERATING' || next.status === 'QUEUED';
        if (running) observedRunning.current = true;
        else if (observedRunning.current) {
          observedRunning.current = false;
          if (next.status === 'READY') void messageApi.success('更新成功');
          else if (next.status === 'FAILED' || next.status === 'PARTIAL')
            void messageApi.error(
              next.status === 'PARTIAL'
                ? '部分更新失败，已有有效数据已保留'
                : '更新失败，已有有效数据已保留',
            );
        }
        const nextSignature = JSON.stringify(next.progress);
        if (
          (signature && signature !== nextSignature) ||
          (!signature && next.progress)
        )
          await reloadCached(controller.signal);
        signature = nextSignature;
        if (next.status === 'GENERATING' || next.status === 'QUEUED')
          timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (!controller.signal.aborted) {
          const text = e instanceof Error ? e.message : '更新状态读取失败';
          if (lastUpdateError.current !== text) void messageApi.error(text);
          lastUpdateError.current = text;
          timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // The loop reads cache only; a new explicit update starts a fresh status loop.
  }, [cik, starting]);
  async function updateData() {
    if (!cik || updating || posting.current) return;
    posting.current = true;
    setStarting(true);
    lastUpdateError.current = '';
    try {
      const next = await companyUpdate(cik, 'start');
      observedRunning.current =
        next.status === 'QUEUED' || next.status === 'GENERATING';
      setUpdate(next);
    } catch (e) {
      void messageApi.error(e instanceof Error ? e.message : '更新请求失败');
    } finally {
      posting.current = false;
      setStarting(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
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
      {messageContext}
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
      {loading && !detail && (
        <Card>
          <Space>
            <Spin />
            <Typography.Text>
              正在读取公司数据；首次访问需要从 SEC 获取并保存财务数据…
            </Typography.Text>
          </Space>
        </Card>
      )}
      {updating && update?.progress && (
        <Alert
          type="info"
          title="正在更新，继续展示已保存的数据"
          description={
            update?.progress && (
              <Space wrap>
                {(['financials', 'filing', 'business', 'management'] as const)
                  .map(
                    (stage) => [stage, update.progress!.stages[stage]] as const,
                  )
                  .map(([stage, result]) => (
                    <Typography.Text key={stage}>
                      {
                        (
                          {
                            financials: '财务数据',
                            filing: '10-K 年报',
                            business: '业务概述',
                            management: '管理层与风险',
                          } as Record<string, string>
                        )[stage]
                      }
                      ：
                      {
                        (
                          {
                            PENDING: '等待',
                            RUNNING: '更新中',
                            SUCCESS: '成功',
                            FAILED: '失败',
                            SKIPPED: '跳过',
                          } as Record<string, string>
                        )[result.status]
                      }
                      {result.error ? `（${result.error}）` : ''}
                    </Typography.Text>
                  ))}
              </Space>
            )
          }
        />
      )}
      {detail && (
        <CompanyResearchSections
          detail={detail}
          onUpdate={updateData}
          updating={updating}
          revision={aiRevision}
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
