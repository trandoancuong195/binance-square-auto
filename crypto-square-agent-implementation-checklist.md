# CRYPTO SQUARE AGENT — IMPLEMENTATION CHECKLIST

## 1. Mục tiêu

Xây dựng một hệ thống tự động:

1. Lấy dữ liệu thị trường Binance.
2. Tìm các token đang hot/trending.
3. Phân tích kỹ thuật từ dữ liệu gốc.
4. Render lại chart thành hình ảnh.
5. Kiểm tra lịch sử bài viết và series đã đăng.
6. AI quyết định:
   - Tạo bài mới.
   - Tiếp tục series cũ.
   - Cập nhật thesis.
   - Bỏ qua nếu không đủ giá trị.
7. AI viết bài theo format Binance Square.
8. Lưu draft.
9. Sau khi hệ thống ổn định mới bật auto-publish lên Binance Square.

---

# 2. Kiến trúc tổng thể

```text
n8n
  ↓
Crypto Agent API
  ↓
Market Scanner
  ↓
Technical Analysis
  ↓
PostgreSQL Memory
  ↓
Series / Decision Engine
  ↓
AI Writer
  ↓
Chart Renderer
  ↓
Quality Gate
  ↓
Draft / Binance Square
```

### Phân chia trách nhiệm

#### n8n
- Schedule workflow.
- Trigger scan.
- Gọi API service.
- Điều phối các bước.
- Retry khi lỗi.
- Notification.
- Sau này trigger publish.

#### Node.js / TypeScript Service
- Binance market API.
- Trend scanner.
- Technical indicators.
- Support / resistance.
- Series engine.
- Memory retrieval.
- AI integration.
- Chart rendering.
- Binance Square publishing.

#### PostgreSQL
- Posts.
- Series.
- Market snapshots.
- Agent memory.
- Post performance.

---

# 3. Cấu trúc project

```text
crypto-square-agent/

├── app/
│   ├── src/
│   │   ├── ai/
│   │   ├── api/
│   │   ├── binance/
│   │   ├── chart/
│   │   ├── indicators/
│   │   ├── memory/
│   │   ├── scanner/
│   │   ├── series/
│   │   ├── db/
│   │   ├── config/
│   │   └── index.ts
│   │
│   ├── output/
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
│
├── postgres/
│
├── backup/
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

# 4. Các file nên tạo từ IDE

## 4.1 Core

```text
app/src/index.ts
app/src/config/env.ts
app/src/config/constants.ts
```

## 4.2 Database

```text
app/src/db/client.ts
app/src/db/schema.sql
app/src/db/migrations/
```

## 4.3 Binance

```text
app/src/binance/client.ts
app/src/binance/ticker.ts
app/src/binance/klines.ts
app/src/binance/futures.ts
app/src/binance/types.ts
```

## 4.4 Scanner

```text
app/src/scanner/index.ts
app/src/scanner/trend-score.ts
app/src/scanner/filters.ts
app/src/scanner/types.ts
```

## 4.5 Indicators

```text
app/src/indicators/index.ts
app/src/indicators/trend.ts
app/src/indicators/support-resistance.ts
app/src/indicators/volume.ts
app/src/indicators/types.ts
```

## 4.6 Memory

```text
app/src/memory/index.ts
app/src/memory/repository.ts
app/src/memory/context-builder.ts
app/src/memory/types.ts
```

## 4.7 Series

```text
app/src/series/index.ts
app/src/series/decision-engine.ts
app/src/series/repository.ts
app/src/series/types.ts
```

## 4.8 AI

```text
app/src/ai/client.ts
app/src/ai/prompts.ts
app/src/ai/writer.ts
app/src/ai/decision.ts
app/src/ai/types.ts
```

## 4.9 Chart

```text
app/src/chart/index.ts
app/src/chart/render.ts
app/src/chart/template.ts
app/src/chart/types.ts
```

## 4.10 API

```text
app/src/api/routes.ts
app/src/api/scanner.routes.ts
app/src/api/analysis.routes.ts
app/src/api/memory.routes.ts
app/src/api/series.routes.ts
app/src/api/post.routes.ts
```

---

# 5. Environment Variables

Tạo:

```text
app/.env
```

Ví dụ:

```env
NODE_ENV=development
PORT=3100

DATABASE_URL=postgresql://crypto_agent:CHANGE_ME@localhost:5433/crypto_agent

BINANCE_BASE_URL=https://api.binance.com
BINANCE_FUTURES_URL=https://fapi.binance.com

OPENAI_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=

BINANCE_SQUARE_OPENAPI_KEY=

MIN_TREND_SCORE=75
MAX_TOKENS_PER_SCAN=5

POST_COOLDOWN_HOURS=6
MAX_POSTS_PER_DAY=8
```

Không commit `.env`.

---

# 6. .gitignore

```gitignore
node_modules/
dist/
.env

output/*
!output/.gitkeep

postgres/
backup/

*.log
.DS_Store
```

---

# 7. Dependencies

## Runtime

```bash
npm install express pg axios dotenv zod dayjs technicalindicators puppeteer lightweight-charts
```

## Dev

```bash
npm install -D typescript tsx @types/node @types/express
```

Có thể bổ sung sau:

```bash
npm install openai
npm install @google/generative-ai
```

Tùy model AI sử dụng.

---

# 8. Scripts trong package.json

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",
    "scan": "tsx src/scanner/run.ts"
  }
}
```

---

# 9. Database cần chuẩn bị

## 9.1 posts

Lưu tất cả bài đã tạo / đã đăng.

Các field chính:

```text
id
symbol
series_id
timeframe
post_type
title
content
market_price
trend_score
square_post_id
square_url
chart_paths
metadata
status
published_at
created_at
```

Status:

```text
DRAFT
APPROVED
PUBLISHED
FAILED
```

---

# 10. Series

Table:

```text
series
```

Field chính:

```text
id
symbol
slug
title
status
stage
thesis
bull_trigger
bear_trigger
invalidation_price
next_watch
started_at
last_updated_at
closed_at
```

Series stages:

```text
WATCHING
BREAKOUT_ATTEMPT
BREAKOUT_CONFIRMED
RETEST
CONTINUATION
INVALIDATED
CLOSED
```

---

# 11. Market Snapshot

Lưu dữ liệu tại thời điểm phân tích.

```text
market_snapshots
```

Field:

```text
symbol
timeframe
price

change_15m
change_1h
change_4h
change_24h

volume_ratio

rsi

ema20
ema50
ema200

macd

atr

funding_rate

open_interest
oi_change_1h

support
resistance

raw_data

created_at
```

---

# 12. Agent Memory

Phase 1 chưa cần vector database.

Table:

```text
agent_memory
```

Field:

```text
id
symbol
memory_type
content
importance
metadata
created_at
expires_at
```

Các memory type:

```text
THESIS
MARKET_EVENT
POST_SUMMARY
SERIES_UPDATE
LESSON
```

Sau này mới thêm:

```text
pgvector
embedding
semantic search
```

---

# 13. Post Performance

Table:

```text
post_performance
```

Field:

```text
post_id
views
likes
comments
shares
engagement_rate
captured_at
```

Phase đầu có thể chưa triển khai.

---

# 14. Phase 1 — Health API

Việc đầu tiên cần hoàn thành:

```text
GET /health
```

Response:

```json
{
  "status": "ok",
  "service": "crypto-square-agent"
}
```

Mục tiêu:

- Express chạy được.
- `.env` load được.
- TypeScript chạy được.
- Sau này n8n có thể gọi service.

---

# 15. Phase 2 — Binance Market Client

Implement:

```text
binance/client.ts
```

Các API cần có:

```text
24h ticker
klines
funding rate
open interest
long/short data
```

Phase đầu ưu tiên:

```text
24h ticker
klines
```

---

# 16. Market Scanner

Flow:

```text
Fetch Binance ticker
        ↓
Filter USDT pairs
        ↓
Remove stablecoin pairs
        ↓
Filter low volume
        ↓
Calculate preliminary score
        ↓
Sort
        ↓
Top 20
        ↓
Load detailed data
        ↓
Trend Score
        ↓
Top 5
```

---

# 17. Token Filtering

Loại:

```text
Stablecoins
Leveraged tokens
Pairs không đủ thanh khoản
Pairs mới chưa đủ candle
```

Có thể whitelist market:

```text
USDT
```

---

# 18. Trend Score V1

Bắt đầu đơn giản:

```text
Volume Spike          25%
Price Momentum        20%
Open Interest         15%
Breakout              15%
Trade Activity        10%
Volatility            10%
Funding                5%
```

Score:

```text
0 - 100
```

Rules:

```text
< 50    IGNORE

50-65   WATCH

65-75   CANDIDATE

75-85   ANALYZE

>= 85   HIGH_PRIORITY
```

---

# 19. Technical Indicators

Cần implement:

```text
EMA20
EMA50
EMA200

RSI14

MACD

ATR

Volume SMA
Volume Ratio
```

Sau đó:

```text
Swing High
Swing Low
Support
Resistance
Breakout Detection
Trend Detection
```

---

# 20. Timeframes

MVP:

```text
15m
1h
4h
```

Không cần gửi toàn bộ candle cho AI.

Node service phải tự tính trước.

---

# 21. Analysis Output chuẩn

Backend nên tạo một object thống nhất:

```json
{
  "symbol": "BTCUSDT",

  "price": 0,

  "change": {
    "15m": 0,
    "1h": 0,
    "4h": 0,
    "24h": 0
  },

  "trend": {
    "15m": "neutral",
    "1h": "bullish",
    "4h": "bullish"
  },

  "technical": {
    "rsi": 0,
    "ema20": 0,
    "ema50": 0,
    "ema200": 0,
    "atr": 0
  },

  "volume": {
    "ratio": 0
  },

  "derivatives": {
    "funding": 0,
    "openInterest": 0,
    "oiChange1h": 0
  },

  "levels": {
    "support": [],
    "resistance": []
  },

  "trendScore": 0
}
```

AI chỉ phân tích object đã chuẩn hóa này.

---

# 22. Save Market Snapshot

Sau mỗi analysis đủ điều kiện:

```text
analysis result
    ↓
market_snapshots
```

Mục tiêu:

Có thể xem lại chính xác trạng thái thị trường khi agent viết bài.

---

# 23. Memory Retrieval

Trước khi AI viết:

```text
Get recent posts
+
Get active series
+
Get previous thesis
```

Ví dụ:

```text
3 recent posts

1-3 active series

latest relevant snapshot
```

Không load toàn bộ database.

---

# 24. Agent Context Builder

Input:

```text
Current market

Recent posts

Active series

Previous thesis
```

Output:

```json
{
  "market": {},
  "recentPosts": [],
  "activeSeries": [],
  "previousThesis": null
}
```

---

# 25. Decision Engine

Chỉ cho phép:

```text
NEW_POST
CONTINUE_SERIES
UPDATE_SERIES
SKIP
```

Không cho AI tự trả action khác.

Response:

```json
{
  "decision": "CONTINUE_SERIES",
  "seriesId": 12,
  "reason": "...",
  "importance": 0.85
}
```

Validate response bằng Zod.

---

# 26. Rule-based Filter trước AI

Một số việc không cần AI.

Ví dụ:

```text
trendScore < threshold
=> SKIP
```

Hoặc:

```text
vừa đăng cùng token
+
không có biến động mới đáng kể
=> SKIP
```

---

# 27. Major Market Change

Có thể định nghĩa V1:

```text
Price move > 3%

OR

OI change > 10%

OR

Breakout

OR

Support broken

OR

Funding extreme
```

Có thể chỉnh sau dựa trên thực tế.

---

# 28. Series Continuity

Ví dụ series:

```text
BTC Breakout Watch
```

Stage:

```text
WATCHING
    ↓
BREAKOUT_ATTEMPT
    ↓
BREAKOUT_CONFIRMED
    ↓
RETEST
    ↓
CONTINUATION
```

Nếu thất bại:

```text
INVALIDATED
    ↓
CLOSED
```

Agent phải hiểu bài mới có phải continuation hay không.

---

# 29. AI Writer

AI không được tính indicator.

AI chỉ nhận dữ liệu có sẵn.

Prompt phải yêu cầu:

```text
Không bịa số liệu.

Phân biệt FACT và INTERPRETATION.

Không lặp lại nội dung cũ nếu không cần.

Nếu thesis trước đã xảy ra:
phải cập nhật kết quả.

Nếu thesis cũ sai:
phải ghi nhận invalidation.

Nếu không có dữ liệu đủ giá trị:
SKIP.
```

---

# 30. AI Output

Nên dùng structured output:

```json
{
  "decision": "CONTINUE_SERIES",

  "series": {
    "stage": "BREAKOUT_CONFIRMED",
    "newThesis": "...",
    "nextWatch": []
  },

  "post": {
    "title": "",
    "hook": "",
    "content": "",
    "tags": []
  }
}
```

---

# 31. Format bài Binance Square

Mục tiêu hiện tại:

```text
Tiếng Việt

Khoảng 1.200–1.500 ký tự

Professional

Có cảm xúc nhưng không giật tít quá mức
```

Cấu trúc:

```text
Hook

Giá / thời điểm

Trend

Volume

Technical Structure

Derivatives

Support / Resistance

Bullish Scenario

Bearish Scenario

Risk
```

---

# 32. Chart Renderer

Không lấy screenshot trực tiếp Binance.

Flow:

```text
OHLCV
 ↓
Lightweight Charts
 ↓
HTML
 ↓
Puppeteer
 ↓
PNG
```

Output:

```text
app/output/BTCUSDT/YYYY-MM-DD/
```

Ví dụ:

```text
1h.png
4h.png
```

---

# 33. Chart V1

Chỉ cần:

```text
Candlestick

EMA20
EMA50
EMA200

Volume

Support

Resistance
```

Header:

```text
Symbol
Current Price
24h %
Trend Score
Timeframe
```

Không nên nhồi quá nhiều indicator vào hình đầu tiên.

---

# 34. API Endpoints

Tối thiểu:

```text
GET  /health

POST /scanner/run

POST /analyze/:symbol

GET  /memory/:symbol

POST /agent/decide/:symbol

POST /chart/:symbol

POST /post/generate/:symbol

POST /post/publish/:id
```

Phase MVP chưa cần implement publish ngay.

---

# 35. Scanner Endpoint

```text
POST /scanner/run
```

Response:

```json
{
  "tokens": [
    {
      "symbol": "BTCUSDT",
      "trendScore": 90
    }
  ]
}
```

---

# 36. Analyze Endpoint

```text
POST /analyze/BTCUSDT
```

Result:

```text
Market data
Technical indicators
Derivatives
Support / resistance
Trend score
```

Sau đó save `market_snapshots`.

---

# 37. Generate Post Endpoint

```text
POST /post/generate/BTCUSDT
```

Flow:

```text
Load analysis
 ↓
Load memory
 ↓
Load series
 ↓
Decision
 ↓
Generate content
 ↓
Render chart
 ↓
Save DRAFT
```

---

# 38. Draft Mode

Trong giai đoạn đầu:

```text
AI generate
    ↓
Save DRAFT
    ↓
STOP
```

Không auto-post.

Mục đích:

- Kiểm tra token scanner.
- Kiểm tra indicator.
- Kiểm tra S/R.
- Kiểm tra continuity.
- Kiểm tra bài viết.
- Kiểm tra chart.

---

# 39. Quality Gate

Sau khi MVP ổn:

```text
Market significance    25
Technical clarity      20
New information        20
Series relevance       15
Writing quality        10
Risk disclosure         5
Chart quality           5
```

Total:

```text
100
```

Có thể chỉ publish:

```text
>= 75
```

---

# 40. Duplicate Protection

Không đăng lại cùng narrative.

Check:

```text
symbol
series
recent posts
content similarity
time
market state
```

Ví dụ:

```text
ETH vừa đăng 1 giờ trước
+
market không thay đổi đáng kể
=> SKIP
```

---

# 41. Posting Cooldown

Config V1:

```text
BTC / ETH:
3 giờ

Altcoin:
6 giờ
```

Global:

```text
5-8 posts / day
```

Có thể bypass khi:

```text
Major Market Event
```

---

# 42. PostgreSQL Local Development

Tạo:

```text
docker-compose.yml
```

Dùng:

```text
PostgreSQL + pgvector
```

Phase đầu pgvector chưa cần sử dụng nhưng nên dùng image hỗ trợ sẵn để dễ mở rộng.

---

# 43. Docker Compose cần có

Service:

```text
postgres
```

Config:

```text
database
username
password
volume
localhost port
```

Không expose PostgreSQL trực tiếp ra public Internet khi deploy VPS.

---

# 44. Local Workflow Test

Trước khi đưa VPS:

```text
[ ] npm install chạy thành công

[ ] npm run dev chạy được

[ ] GET /health OK

[ ] PostgreSQL connect OK

[ ] Binance API connect OK

[ ] Scanner trả token

[ ] Indicator tính được

[ ] Snapshot save được DB

[ ] Memory query được

[ ] Series query được

[ ] AI response validate được

[ ] Chart PNG render được

[ ] Draft lưu DB được
```

---

# 45. n8n Workflow MVP

Sau khi service deploy VPS:

```text
Schedule Trigger
      ↓
POST /scanner/run
      ↓
Split Out
      ↓
IF trendScore >= threshold
      ↓
POST /analyze/:symbol
      ↓
GET /memory/:symbol
      ↓
POST /agent/decide/:symbol
      ↓
Switch
 ┌────┼────────────┐
 │    │            │
SKIP NEW       CONTINUE
 │    │            │
END  └──────┬─────┘
            ↓
      Generate Post
            ↓
       Render Chart
            ↓
        Save Draft
```

---

# 46. n8n Schedule

Giai đoạn đầu:

```text
30 phút / lần
```

Sau khi ổn:

```text
15 phút / lần
```

Không nên scan quá thường xuyên ngay từ đầu.

---

# 47. Publish Workflow — Phase sau

```text
Draft
 ↓
Quality Gate
 ↓
Duplicate Check
 ↓
Cooldown Check
 ↓
Publish Binance Square
 ↓
Save square_post_id
 ↓
Update Series
 ↓
Save Memory
```

---

# 48. Binance Square Integration

Khi hệ thống draft ổn định mới implement.

Node service nên đảm nhiệm publish.

n8n chỉ gọi:

```text
POST /post/publish/:id
```

Không nên để n8n trực tiếp giữ toàn bộ logic publish.

---

# 49. Deployment Structure trên VPS

Sau khi local hoàn tất:

```text
/opt/crypto-square-agent

├── app/
├── postgres/
├── backup/
└── docker-compose.yml
```

Node service:

```text
PM2
```

PostgreSQL:

```text
Docker
```

n8n:

```text
giữ nguyên hệ thống hiện có
```

---

# 50. Deployment Checklist

```text
[ ] Upload source lên VPS

[ ] npm install

[ ] Tạo .env production

[ ] chmod 600 .env

[ ] Docker PostgreSQL running

[ ] DB migration chạy thành công

[ ] Node service chạy

[ ] PM2 startup

[ ] GET /health từ VPS OK

[ ] n8n gọi được Node service

[ ] Scanner production OK

[ ] Chart Chromium/Puppeteer OK

[ ] AI key OK

[ ] Draft DB OK
```

---

# 51. Security Checklist

```text
[ ] Không commit .env

[ ] Không expose PostgreSQL public

[ ] Không expose internal Node API public nếu không cần

[ ] API key lưu qua env

[ ] Không log API key

[ ] Không lưu secret vào n8n workflow JSON nếu tránh được

[ ] Backup database

[ ] Rotate Binance Square key nếu bị lộ
```

---

# 52. Backup

Backup cần có:

```text
PostgreSQL
```

Không nhất thiết backup:

```text
chart PNG cũ
```

nếu có thể regenerate.

Có thể giữ chart trong:

```text
7-30 ngày
```

rồi cleanup tự động.

---

# 53. Logging

Backend nên log:

```text
scan_id

symbol

trend_score

decision

series_id

post_id

AI model

publish status

error
```

Không log:

```text
API keys
password
full secrets
```

---

# 54. Phase triển khai đề xuất

## Phase 1 — Foundation

```text
[ ] Project structure
[ ] TypeScript
[ ] Express
[ ] PostgreSQL
[ ] /health
```

---

## Phase 2 — Market Scanner

```text
[ ] Binance ticker
[ ] Filters
[ ] Trend Score V1
[ ] Top candidates
```

---

## Phase 3 — Analysis Engine

```text
[ ] Klines
[ ] EMA
[ ] RSI
[ ] MACD
[ ] ATR
[ ] Volume ratio
[ ] Trend
[ ] S/R
```

---

## Phase 4 — Futures

```text
[ ] Funding
[ ] Open Interest
[ ] OI Change
[ ] Long / Short
```

---

## Phase 5 — Memory

```text
[ ] Posts repository
[ ] Market snapshots
[ ] Recent posts
[ ] Active series
[ ] Context builder
```

---

## Phase 6 — Series Engine

```text
[ ] NEW_POST
[ ] CONTINUE_SERIES
[ ] UPDATE_SERIES
[ ] SKIP
[ ] Series stages
[ ] Invalidation
```

---

## Phase 7 — AI

```text
[ ] AI client
[ ] Decision prompt
[ ] Writer prompt
[ ] Structured response
[ ] Zod validation
```

---

## Phase 8 — Chart

```text
[ ] Lightweight Charts template
[ ] Puppeteer
[ ] 1H image
[ ] 4H image
[ ] Support / resistance
[ ] EMA
```

---

## Phase 9 — Draft Mode

```text
[ ] Generate content
[ ] Generate image
[ ] Save DRAFT
[ ] Manual review
```

Chạy trong vài ngày trước khi publish tự động.

---

## Phase 10 — n8n

```text
[ ] Schedule
[ ] Scanner request
[ ] Split tokens
[ ] Analyze
[ ] Decision
[ ] Generate
[ ] Draft
[ ] Error handling
```

---

## Phase 11 — Auto Publish

Chỉ bật sau khi draft mode ổn định.

```text
[ ] Quality Gate
[ ] Duplicate detection
[ ] Cooldown
[ ] Binance Square API
[ ] Update post status
[ ] Update series
[ ] Save memory
```

---

# 55. MVP Definition of Done

MVP được xem là hoàn thành khi:

```text
n8n chạy mỗi 30 phút
        ↓
scanner tìm token hot
        ↓
lấy 15m / 1h / 4h
        ↓
technical analysis
        ↓
save snapshot
        ↓
load lịch sử token
        ↓
NEW / CONTINUE / SKIP
        ↓
AI viết bài
        ↓
render PNG
        ↓
save DRAFT
```

Không yêu cầu auto-post trong MVP.

---

# 56. Sau MVP

Sau khi hệ thống ổn định có thể thêm:

```text
pgvector

semantic memory

news ingestion

on-chain data

post performance tracking

engagement learning

automatic series prioritization

automatic topic selection

Telegram approval

Binance Square auto publish
```

---

# 57. Nguyên tắc quan trọng

## AI không tính dữ liệu thị trường

Các dữ liệu sau phải do code tính:

```text
RSI
EMA
MACD
ATR
Volume
Open Interest
Funding
Support
Resistance
Trend Score
```

AI chỉ:

```text
Interpret
Compare
Reason about continuity
Write content
```

---

# 58. Agent phải trả lời được 5 câu hỏi

Trước mỗi bài:

```text
1. Tôi đã đăng gì về token này?

2. Tôi đang theo dõi thesis / series nào?

3. Kịch bản cũ đã xảy ra chưa?

4. Market hiện tại có thay đổi đáng kể không?

5. Tôi nên:
   - tạo bài mới,
   - tiếp tục series,
   - update thesis,
   - hay không đăng?
```

Nếu hệ thống làm tốt 5 câu này thì agent mới bắt đầu có continuity giống một analyst thực sự.

---

# 59. Thứ tự bắt đầu coding

Bắt đầu theo thứ tự:

```text
1. Project structure
2. package.json
3. TypeScript
4. Express /health
5. PostgreSQL
6. Database schema
7. Binance client
8. Scanner
9. Trend Score
10. Indicators
11. Snapshot
12. Memory
13. Series
14. AI Decision
15. AI Writer
16. Chart
17. Draft
18. n8n
19. Quality Gate
20. Binance Square Publish
```

Không nên nhảy trực tiếp vào AI hoặc auto-post trước khi scanner + database + continuity ổn định.
