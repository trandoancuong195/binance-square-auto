# Crypto Square Agent

MVP tạo bản nháp Binance Square tiếng Việt từ dữ liệu Binance, có phân tích kỹ thuật, lịch sử nhận định, series và chart 1h/4h. Backend dùng Node.js/TypeScript, PostgreSQL và Puppeteer. n8n gọi pipeline theo lịch.

**Trạng thái thay đổi gần nhất:** đã cập nhật source để viết bài cho toàn bộ token trending do scanner trả về, bỏ bước AI quyết định viết/bỏ qua. Thay đổi này chưa được build, test hoặc chạy tích hợp ở máy local theo yêu cầu chỉ viết code; cần upload và kiểm tra trên VPS.

## Phạm vi

**Tạm bỏ AI Writer:** `AI_WRITER_ENABLED=false` là mặc định hiện tại. Luồng vẫn phân tích, render chart và lưu `DRAFT` chứa số liệu, với `metadata.writerMode=data_only`; không gọi AI, không chạy kiểm tra độ dài văn xuôi và không giả lập nội dung phân tích. Bản nháp này chưa thể duyệt hoặc cập nhật series/memory. Đặt `AI_WRITER_ENABLED=true` trong `app/.env` rồi restart để bật lại AI cho lần tạo bài tiếp theo; các draft dữ liệu cũ không tự được viết lại. Muốn tạo bài AI cho cùng token ngay, tạo snapshot mới qua `/analyze/:symbol` rồi gọi generate với snapshotId mới, hoặc đợi snapshot cache hết hạn.

- Scanner lọc thị trường spot USDT đang giao dịch; loại stablecoin/leveraged token theo danh sách trong `config/constants.ts`, thanh khoản thấp và lịch sử nến không đủ. Danh sách loại cần cập nhật khi có tài sản mới.
- Phân tích 15m/1h/4h bằng nến đã đóng: EMA20/50/200, RSI14, MACD12/26/9, ATR14, volume ratio, swing support/resistance và breakout.
- Futures cùng symbol: funding, OI hiện tại, thay đổi OI qua hai mẫu 1h, tỷ lệ tài khoản long/short. Token không có hợp đồng tương ứng được ghi thiếu dữ liệu; không tự chuyển sang hợp đồng `1000...`.
- Lưu snapshot với toàn bộ OHLCV và kết quả tính toán. AI chỉ nhận bản tóm tắt không có mảng nến.
- Mọi token trending do scanner trả về đều được đưa vào luồng viết bài. Code xác định loại bài `NEW_POST`, `CONTINUE_SERIES` hoặc `UPDATE_SERIES`; không gọi AI decision và không trả `SKIP` trong luồng generate.
- AI viết văn xuôi; code chèn số liệu. Kiểm tra JSON, độ dài 1.200–3.500 ký tự (mục tiêu bài ngắn gọn khoảng 1.350), mức giá có nguồn, chuyển stage, lặp nội dung và một số tuyên bố lợi nhuận. Giới hạn dùng chung trong `app/src/ai/limits.ts`; `series.nextWatch` có 1–3 mục. Khi đầu ra không đạt schema, lần thử sau nhận JSON trước đó và lỗi cụ thể để sửa.
- Chart PNG được dựng từ dữ liệu bằng Lightweight Charts, không chụp Binance.
- Trang `/review` xem chart/nội dung, duyệt hoặc loại draft. Khóa API không lưu trong localStorage.
- Pipeline chạy nền, có mã lượt chạy, idempotency key, khóa chống chạy trùng và kết quả từng token trong PostgreSQL.
- **Không tự đăng.** Endpoint publish trả `501 PUBLISH_DISABLED`; không lưu hoặc sử dụng Binance Square key trong MVP.

## Cấu trúc

```text
app/
  src/
    ai/           Client tương thích chat/completions, prompt, schema, quality gate
    api/          API nội bộ và xác thực
    binance/      Spot/futures client, kiểm tra dữ liệu và backoff
    chart/        Puppeteer + Lightweight Charts
    config/       Biến môi trường và hằng số
    db/           Pool, schema và migration
    indicators/   Công thức chỉ báo
    memory/       Snapshot, truy vấn lịch sử và context
    scanner/      Chọn ứng viên, phân tích và Trend Score
    series/       Xác định loại bài bằng code và duyệt cập nhật series
    agent.ts      Tạo draft
    pipeline.ts   Lượt chạy nền
    index.ts      HTTP server
  public/         Trang duyệt bài
  output/         Chart, phân theo symbol/ngày/snapshot
n8n/              Workflow mẫu chưa kích hoạt
scripts/          Backup PostgreSQL trên Linux
docker-compose.yml
ecosystem.config.cjs
```

## Chuẩn bị local

Yêu cầu Node.js 22+, npm, Docker Compose và một AI provider hỗ trợ `POST /chat/completions` cùng `response_format: {"type":"json_object"}`. Chọn model có khả năng trả JSON. Chưa kiểm chứng tương thích provider cụ thể.

Từ thư mục dự án, PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item app/.env.example app/.env
```

Sửa cấu hình:

1. Trong `.env` ở gốc: đặt `POSTGRES_PASSWORD` riêng.
2. Trong `app/.env`: sửa `DATABASE_URL` cho khớp. Ký tự đặc biệt trong mật khẩu URL phải được percent-encode.
3. Đặt `INTERNAL_API_KEY` ngẫu nhiên, ít nhất 24 ký tự, không dùng giá trị mẫu.
4. Điền `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. Base URL bao gồm phần đường dẫn phiên bản API nếu provider yêu cầu; không thêm `/chat/completions`.
5. Giữ `HOST=127.0.0.1` khi chạy local. Chỉ đổi sang địa chỉ private phù hợp nếu n8n cần truy cập từ máy/container khác.

Các lệnh bên dưới là hướng dẫn để chạy sau khi bạn sẵn sàng; chưa được thực thi trong lần bàn giao này:

```powershell
docker compose up -d postgres
Set-Location app
npm.cmd install
npm.cmd run db:migrate
npm.cmd run dev
```

`npm install` sẽ tải Chromium qua Puppeteer. Nếu dùng Chromium đã cài, cấu hình `PUPPETEER_EXECUTABLE_PATH`; host phải có các thư viện hệ thống và sandbox phù hợp. Code không tắt sandbox Chromium.

Truy cập `http://127.0.0.1:3100/review`, nhập `INTERNAL_API_KEY` và kết nối. Trang sẽ báo nếu database hoặc cấu hình AI chưa sẵn sàng. Health chỉ xác nhận HTTP server; `/ready` mới kiểm tra bảng database.

Chưa cung cấp lockfile vì chưa cài dependencies. Sau lần cài và kiểm tra thành công, lưu `app/package-lock.json` để cố định dependency graph.

## Luồng MVP

```text
n8n / trang duyệt
  → POST /pipeline/run (trả 202 và run ID)
  → scanner, shortlist và phân tích chi tiết
  → chọn tất cả token đạt MIN_TREND_SCORE trong tập đã phân tích, lưu snapshot
  → đọc bài gần đây + active series + thesis
  → code xác định bài mới / tiếp nối / cập nhật series
  → AI writer + kiểm tra nội dung
  → PNG 1h/4h
  → lưu DRAFT
  → người dùng duyệt
  → APPROVED + cập nhật series/memory
```

Endpoint generate tự điều phối phân tích/memory/writer/chart. AI chỉ được gọi ở bước viết nội dung, tối đa hai lần thử nếu đầu ra không đạt schema; retry HTTP tạm thời vẫn áp dụng riêng. Workflow n8n chỉ gọi pipeline và đọc tiến trình.

Lượt chạy có lỗi một số token vẫn tiếp tục xử lý token còn lại và giữ draft đã tạo được, nhưng trạng thái tổng là `FAILED` để n8n hiển thị lỗi. `result.scanErrors` và `result.results` ghi kết quả, `total`/`processed` ghi tiến độ. Không có ứng viên trending thì lượt chạy có thể thành công với không draft. Nội dung không đạt kiểm tra báo `POST_QUALITY_INVALID`, không trả quyết định `SKIP`.

## Quy tắc dữ liệu và tính điểm

- Mỗi khung tải tối đa 300 nến, loại nến chưa đóng và yêu cầu ít nhất 250 nến liên tục. EMA dùng SMA làm giá trị khởi tạo; RSI/ATR dùng Wilder smoothing. Mọi biến động khung thời gian tính từ hai giá đóng cửa gần nhất.
- Volume ratio = volume nến đóng mới nhất / trung bình 20 nến trước, không đưa chính nến hiện tại vào mẫu nền.
- Hỗ trợ/kháng cự từ swing với hai nến mỗi phía trong lịch sử gần đây; gộp mức cách nhau dưới khoảng 0,2%, lấy tối đa ba mức mỗi phía.
- Breakout = đóng cửa 1h vượt đỉnh 20 nến trước và volume ratio >= 1,2; support broken tương tự cho đáy. Đây là quy tắc V1, không phải mô hình đã hiệu chỉnh bằng backtest.
- Snapshot giữ riêng giá ticker và giá nến đã đóng. Chart có các nến đã đóng; header hiển thị giá ticker lấy trong lượt phân tích. `asOf` là thời điểm bắt đầu phân tích, không phải đảm bảo tất cả nguồn được lấy cùng một mili giây.
- Dữ liệu funding/OI không có hoặc lỗi trả `null` và liệt kê lý do trong `unavailable`/`warnings`. Không thay bằng số không trong nội dung bài.

Trend Score là điểm mức độ đáng chú ý, không biểu thị hướng tăng hoặc xác suất lợi nhuận. Mỗi hệ số bên dưới được chặn trong `[0,1]`, nhân trọng số rồi cộng:

| Thành phần | Trọng số | Hệ số V1 |
|---|---:|---|
| Volume spike | 25 | `(volumeRatio - 1) / 3` |
| Price momentum | 20 | `abs(change24h) / 15` |
| OI | 15 | `abs(oiChange1h) / 15` |
| Breakout / support broken | 15 | Có tín hiệu = 1, không có = 0 |
| Trade activity | 10 | `trades24h / 500000` |
| Volatility | 10 | `ATR1h / close1h / 0.03` |
| Funding | 5 | `abs(fundingRate) / 0.001` |

Phần futures thiếu không được cộng điểm, cũng không chia lại trọng số để nâng điểm. `scoreCoverage` cho biết tỷ lệ trọng số có dữ liệu; token spot-only có tối đa 80 điểm. Có thể cần điều chỉnh `MIN_TREND_SCORE` sau khi quan sát thực tế.

Scanner lấy shortlist dựa trên `abs(change24h) * log10(quoteVolume)`, sau đó phân tích đầy đủ. Token có active series được thêm vào tập phân tích. Tất cả token trong tập này có `trendScore >= MIN_TREND_SCORE` được trả về, sắp xếp theo điểm giảm dần; không cắt tiếp còn top 5. Token đang có series nhưng chưa đạt ngưỡng không tự tạo draft qua scanner.

"Tất cả token trending" ở đây là tất cả token đạt ngưỡng trong tập scanner đã phân tích. `SCANNER_SHORTLIST` vẫn giới hạn số ứng viên ban đầu (mặc định 20, tối đa 50), ngoài các token có active series. Pipeline xử lý toàn bộ danh sách trả về, không giới hạn số draft theo lượt/ngày. Snapshot hết hạn trong lúc chờ được làm mới trước khi viết bài; token đã được chọn vẫn được viết dù điểm mới giảm.

Gọi trực tiếp `/post/generate/:symbol` là yêu cầu viết bài cho symbol đó, không kiểm tra lại ngưỡng trending hoặc cooldown. Các kiểm tra symbol, dữ liệu, JSON, nội dung và chart vẫn áp dụng.

## Draft, series và chống lặp

- Draft chỉ chứa đề xuất cập nhật series trong metadata. Tạo draft không sửa thesis chính thức.
- Duyệt draft là giao dịch database: tạo/cập nhật series, tăng version, lưu memory và chuyển `APPROVED`. Duyệt lại cùng bài không cập nhật hai lần.
- Chỉ có một active series mỗi symbol trong MVP. Draft tham chiếu version cũ bị từ chối duyệt; hãy loại draft đó và tạo lại với snapshot mới.
- `APPROVED` là đã duyệt nội bộ, **chưa đăng Binance Square**. Trường `published_at` và `square_post_id` vẫn trống.
- Invalidation kiểm tra giá nến 1h đã đóng theo bias: bullish xuống dưới mức vô hiệu, bearish lên trên mức vô hiệu. Series neutral không đặt mức vô hiệu. `INVALIDATED` hoặc `CLOSED` sẽ đóng series khi duyệt.
- Bài gần đây được đọc gồm cả draft và approved để AI viết tiếp đúng ngữ cảnh. Bài đã loại (`FAILED`) không được dùng làm lịch sử nội dung.
- Không áp dụng cooldown, giới hạn draft/ngày hoặc giới hạn draft/lượt. Những biến cũ `POST_COOLDOWN_HOURS`, `BTC_ETH_COOLDOWN_HOURS`, `MAX_POSTS_PER_DAY`, `MAX_TOKENS_PER_SCAN` trong `.env` không còn được sử dụng, có thể xóa.
- Nội dung tương tự bài gần đây chỉ được ghi nhận trong `quality.warnings` và hiển thị khi duyệt; không chặn lưu draft. Mỗi lượt quét mới có thể tạo bài mới cho cùng token.
- Cùng snapshot đã có bài sẽ trả bài đó, không gọi AI lại. Muốn tạo lại bài đã loại, tạo snapshot mới bằng analyze hoặc đợi snapshot cache hết hạn.
- Quality Gate hiện kiểm tra nội dung và tính điểm heuristic. Các draft vượt kiểm tra cứng được lưu để duyệt kể cả điểm dưới 75. Điểm >=75 cũng không kích hoạt publish. Chất lượng hình ảnh/nhận định vẫn cần con người kiểm tra.

## API

Các endpoint dữ liệu yêu cầu header `X-API-Key`. `/health` và tài nguyên trang review không yêu cầu khóa; trang không lấy được dữ liệu trước khi xác thực.

| Method | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/health` | HTTP liveness |
| GET | `/ready` | Kiểm tra database và tình trạng cấu hình AI |
| POST | `/scanner/run` | Quét đồng bộ, trả symbol, điểm và snapshotId |
| POST | `/analyze/:symbol` | Phân tích và lưu snapshot mới |
| GET | `/memory/:symbol` | Bài gần đây, active series, thesis |
| POST | `/agent/decide/:symbol` | Tương thích endpoint cũ: xác định loại bài bằng code, không gọi AI hoặc trả SKIP |
| POST | `/chart/:symbol` | Render chart từ snapshot |
| POST | `/post/generate/:symbol` | Toàn bộ luồng tạo draft |
| GET | `/posts?status=DRAFT&limit=20` | Danh sách bài; phân trang `before` |
| GET | `/posts/:id` | Chi tiết bài |
| GET | `/posts/:id/charts/0` | PNG 1h; index 1 là 4h |
| DELETE | `/posts/:id/charts` | Xóa file chart của bài và xóa chart_paths; gọi sau khi dịch vụ ngoài đăng thành công |
| POST | `/posts/:id/approve` | Duyệt và cập nhật series/memory |
| POST | `/posts/:id/reject` | Loại draft |
| POST | `/pipeline/run` | Khởi động lượt chạy nền |
| POST | `/posts/trending` | Khởi động/poll cùng requestKey; chọn token điểm cao nhất và trả tối đa một bài mỗi lượt cho n8n |
| GET | `/pipeline/runs` | Hai mươi lượt gần nhất |
| GET | `/pipeline/runs/:id` | Trạng thái và kết quả lượt chạy |
| POST | `/post/publish/:id` | Chưa triển khai, luôn trả 501 |

`/agent/decide`, `/chart`, `/post/generate` nhận body `{ "snapshotId": "123" }` hoặc `{}`. Snapshot hết hạn sau 15 phút mặc định. Nếu chỉ định ID hết hạn thì báo lỗi, không âm thầm đổi dữ liệu. Generate không chỉ định ID sẽ lấy snapshot mới nhất còn hiệu lực hoặc phân tích mới.

`/pipeline/run` nhận `{ "requestKey": "a-unique-run-key" }`. Retry cùng key trả lại lượt chạy cũ. Muốn chạy lại một lượt đã lỗi, dùng key mới. Không chạy song song hai pipeline.

## n8n

Để nối vào workflow đăng bài bên ngoài, dùng `POST /posts/trending` và mẫu [crypto-square-trending-workflow.json](n8n/crypto-square-trending-workflow.json). Endpoint trả 202 trong lúc tạo bài; gọi lại cùng requestKey đến khi `done:true`, rồi tách `posts` cho node đăng. Không tự đăng hoặc đánh dấu PUBLISHED; việc chống đăng trùng ở dịch vụ bên ngoài cần lưu post ID. Chi tiết cấu hình, retry và giới hạn tại [trending-endpoint.md](n8n/trending-endpoint.md).

1. Import `n8n/crypto-square-draft-workflow.json`.
2. Tạo credential loại **Header Auth**, tên header `X-API-Key`, giá trị lấy từ `app/.env`.
3. Chọn credential đó trong hai node `Start pipeline` và `Read run`.
4. Đổi URL ở cả hai node sang địa chỉ Node service mà n8n truy cập được. Nếu n8n trong container, `127.0.0.1` là chính container; cần cấu hình mạng private và `HOST` phù hợp.
5. Workflow mẫu dùng các node Schedule Trigger, HTTP Request, Wait, IF và Stop And Error; cần kiểm tra tương thích với phiên bản n8n đang dùng khi import.
6. Chạy thủ công để kiểm tra trước khi bật lịch. Lịch là 30 phút/lần; poll mỗi 30 giây, dừng báo lỗi sau 30 phút nếu chưa hoàn thành.
7. Gắn Error Workflow/notification vào n8n hiện có nếu cần. Bản mẫu không gửi tin nhắn bên ngoài.

Không nhúng khóa bí mật vào workflow JSON. Workflow import mặc định chưa active.

## VPS sau khi local đã được kiểm tra

Đưa source vào `/opt/crypto-square-agent`, cấu hình hai `.env` và PostgreSQL như local. Sau khi được phép chạy build:

```bash
cd /opt/crypto-square-agent
docker compose up -d postgres
cd app
npm install
npm run db:migrate
npm run build
cd ..
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Làm theo lệnh setup mà PM2 in ra cho tài khoản hệ thống. Giữ database bind loopback, API trong mạng private hoặc sau reverse proxy HTTPS; không gửi API key qua mạng công cộng bằng HTTP. Không commit/log `.env`. Production cần Chromium và thư viện hệ thống tương ứng.

Backup trên Linux: `bash scripts/backup.sh`. File SQL nén được ghi vào `backup/` với quyền riêng tư qua umask. Đặt lịch backup và kiểm tra restore theo môi trường triển khai. Chart cũ và snapshot hiện chưa tự cleanup; cần chính sách lưu trữ trước khi chạy dài hạn. Không xóa PNG đang cần duyệt.

## Phần để giai đoạn sau

- Binance Square publishing và cơ chế xác thực/upload ảnh thực tế, cần xác minh API/quyền tài khoản trước khi tích hợp.
- Semantic memory/pgvector, news, on-chain, thống kê tương tác và Telegram approval.
- Hiệu chỉnh scanner/quality score trên dữ liệu thực tế; đánh giá diễn giải AI và thuật ngữ tiếng Việt.
- Kiểm tra build, hành vi database, retry/idempotency, race khi duyệt, công thức chỉ báo, chart và workflow n8n khi bạn cho phép chạy kiểm tra.
