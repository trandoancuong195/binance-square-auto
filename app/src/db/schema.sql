CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  analysis JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snapshots_symbol_time ON market_snapshots(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS series (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  stage TEXT NOT NULL CHECK (stage IN ('WATCHING','BREAKOUT_ATTEMPT','BREAKOUT_CONFIRMED','RETEST','CONTINUATION','INVALIDATED','CLOSED')),
  thesis TEXT NOT NULL,
  bias TEXT NOT NULL DEFAULT 'neutral' CHECK (bias IN ('bullish','bearish','neutral')),
  bull_trigger DOUBLE PRECISION,
  bear_trigger DOUBLE PRECISION,
  invalidation_price DOUBLE PRECISION,
  next_watch JSONB NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_series_per_symbol ON series(symbol) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  series_id BIGINT REFERENCES series(id),
  snapshot_id BIGINT NOT NULL REFERENCES market_snapshots(id),
  timeframe TEXT NOT NULL DEFAULT '1h',
  post_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  market_price DOUBLE PRECISION NOT NULL,
  trend_score DOUBLE PRECISION NOT NULL,
  square_post_id TEXT UNIQUE,
  square_url TEXT,
  chart_paths JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PUBLISHED','FAILED')),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id)
);
CREATE INDEX IF NOT EXISTS posts_symbol_time ON posts(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_status_time ON posts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('THESIS','MARKET_EVENT','POST_SUMMARY','SERIES_UPDATE','LESSON')),
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS memory_symbol_time ON agent_memory(symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS post_performance (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id),
  views BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  engagement_rate DOUBLE PRECISION,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  result JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
