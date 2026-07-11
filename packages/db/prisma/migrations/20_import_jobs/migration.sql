-- Excel 导入异步任务：提交（dryRun=false）改为在 API 进程内后台执行，
-- 请求入队后立即返回 jobId，前端轮询本表获取状态与结果（ImportResult）。
-- 避免长事务占用 HTTP 连接，被前置代理的空闲/读超时切断（socket hang up）。

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL,
  result JSONB NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX import_jobs_ledger_id_idx ON import_jobs(ledger_id);
