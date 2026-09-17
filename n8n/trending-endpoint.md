# Lấy bài trending để đăng từ n8n

`POST /posts/trending` yêu cầu header `X-API-Key` và body:

```json
{ "requestKey": "n8n-trending-12345" }
```

Lần đầu khởi động pipeline quét trending và xếp ứng viên theo hai lớp: Trend Score của lượt hiện tại và lịch sử symbol đã được `/posts/trending` chọn thành công. Endpoint ưu tiên token điểm cao nhất chưa được chọn trong thời gian cooldown. Nếu mọi ứng viên đều đang cooldown, token lâu chưa được chọn nhất được ưu tiên và token vừa xuất hiện gần nhất bị đẩy xuống cuối khi còn lựa chọn khác. Trường hợp scanner chỉ có một token đạt ngưỡng thì token đó vẫn có thể lặp lại.

`post` là bài duy nhất sẵn sàng cho node đăng; `posts` vẫn chứa tối đa một phần tử để tương thích workflow cũ. Pipeline chỉ tạo đến khi có một bài dùng được. Nếu ứng viên đầu lỗi AI/chart, pipeline thử ứng viên kế tiếp, mặc định tối đa ba token. Endpoint `/pipeline/run` riêng vẫn xử lý toàn bộ danh sách như trước và không dùng quy tắc luân phiên này.

Cấu hình trong `app/.env`:

```dotenv
TRENDING_SYMBOL_COOLDOWN_HOURS=12
TRENDING_MAX_CANDIDATE_ATTEMPTS=3
```

Cooldown dựa trên các lượt `/posts/trending` trước đã tạo được `postId`, không phụ thuộc việc dịch vụ bên ngoài có cập nhật trạng thái PUBLISHED hay không. Đặt cooldown bằng `0` để luôn ưu tiên Trend Score; giới hạn số lần thử hợp lệ là 1–10.

Khi đang chạy, trả HTTP 202: `done:false`, `post:null`, `posts:[]`, `retryAfterSeconds:30`. Đợi 30 giây rồi POST lại cùng endpoint, cùng requestKey. Backend dùng lượt chạy cũ thay vì tạo thêm lượt mới. Không tạo requestKey bằng thời gian hiện tại bên trong vòng poll. Với lượt cũ từng tạo nhiều bài, endpoint chỉ chọn post đầu tiên; nếu ảnh bài đó đã xóa thì trả rỗng, không chuyển sang bài kế tiếp khi poll lại.

Khi kết thúc, trả HTTP 200 với `done:true`, `status:SUCCEEDED|FAILED`, `hasPosts`, `post`, `posts`, `selection` và `result`. Bài có `id`, `symbol`, `title`, `content`, `chart_paths`, `status`, `dedupeKey`. Không có trending thì `post:null` và `posts:[]`; lỗi từng token nằm trong `result.results`. `selection` cho biết chiến lược, cooldown, lịch sử symbol gần đây và thứ tự ứng viên đã thử; cùng dữ liệu này cũng nằm trong `result.selection` để lưu trọn kết quả lượt chạy. Một lượt FAILED vẫn có thể trả bài đã tạo thành công nếu scanner gặp lỗi ở token khác.

Chỉ trả bài AI đã qua quality gate, có nội dung và chart, còn DRAFT/APPROVED, chưa có square_post_id. Cần bật `AI_WRITER_ENABLED=true`; nếu tắt trả `AI_WRITER_DISABLED`. `DB_CONTEXT_ENABLED=false` vẫn dùng được, nhưng PostgreSQL vẫn cần cho pipeline/draft.

### Chart và nội dung cho n8n

Luồng `/posts/trending` tự chọn bộ template dựa trên dữ liệu snapshot, truyền kế hoạch ảnh cho AI viết bài, render PNG rồi trả nội dung cùng ảnh. Không cần gọi riêng `/chart`, `/post/generate` hoặc duyệt thủ công. Mỗi bài mới có 2–3 ảnh: một dashboard (`market`, `derivatives` hoặc `timeframes`) và một hoặc hai chart kỹ thuật 1h/4h. Bài cũ có một ảnh vẫn được chấp nhận; API từ chối bài vượt ba ảnh, danh sách ảnh trùng hoặc rỗng.

Trong cả `post` và `posts[0]`, `imageCount` là số ảnh thực tế trong `chart_paths`, `chartPlan` là kế hoạch đã lưu cùng bài (null với bài cũ chưa có metadata này). n8n tiếp tục dùng `content`, `chart_paths` và `dedupeKey` như trước. Duyệt ảnh theo mảng `chart_paths`: số lượng/thứ tự thay đổi theo kế hoạch, không mặc định index 0/1/2 luôn là 1h/4h/dashboard.

Lượt mới gặp bài cũ không còn đủ điều kiện trả về (ảnh đã xóa, quá ba ảnh, bài bị loại, đã ghi nhận đăng, data-only hoặc không đạt quality gate) sẽ ghi `TRENDING_POST_NOT_READY` trong `result.results` và thử ứng viên tiếp theo trong giới hạn cấu hình. Poll lại cùng requestKey vẫn ghim bài đã chọn, không đổi sang bài khác sau khi ảnh bị xóa. Kiểm tra này xét danh sách đường dẫn trong database, không kiểm tra file trên đĩa hoặc xác nhận đăng thành công bên Binance.

## Nối workflow hiện có

Import `crypto-square-trending-workflow.json`. Chọn credential Header Auth (`X-API-Key`) trong node `Fetch trending posts`. URL mẫu dùng `http://host.docker.internal:3100/posts/trending`, giữ nguyên cách kết nối Docker hiện có. URL là chuỗi URL thuần, không phải cú pháp link Markdown.

Luồng: lịch 45 phút → HTTP → IF done → nếu chưa xong đợi 30 giây rồi gọi lại; nếu xong lấy `post` thành một item. Nối node cuối `Posts for publishing` vào node đăng bài của bạn. Item giữ `$json.content` và `$json.chart_paths`, nên vẫn dùng ánh xạ `/data/charts/` nếu thư mục output đã được mount đúng vào container n8n. Không cần gọi `/posts/4` cố định nữa. Node cuối không trả item khi `post` là null, nên node đăng không chạy. Poll dừng báo lỗi sau 45 phút; backend có thể vẫn chạy, tiếp tục truy vấn bằng requestKey cũ để lấy kết quả.

Workflow không nhúng credential, không tự kích hoạt lịch và không chạy lệnh đăng. Bật lịch sau khi chạy thử có chủ đích. Theo dõi `result` của HTTP để phát hiện lỗi một phần.

## Retry và đăng trùng

requestKey chống tạo trùng lượt, không chứng minh bài đã đăng thành công ở Binance. Gọi lại một lượt đã hoàn tất trả lại đúng `post` cũ. Node đăng cần lưu/kiểm tra `dedupeKey` hoặc `id` trong kho trạng thái bền vững; không tự retry node đăng khi chưa biết lần trước đã thành công hay chưa. Lượt lịch mới có requestKey mới sẽ áp dụng cooldown/luân phiên symbol. Endpoint không cập nhật PUBLISHED hay series và không gọi Binance để đăng bài.

Không chèn trực tiếp nội dung AI vào mã shell bằng heredoc có delimiter cố định: nội dung có thể đóng heredoc. Khi tích hợp script đăng, truyền dữ liệu qua file JSON hoặc đối số được escape đúng. Đưa khóa API vào credential của n8n thay vì export trong workflow; thay khóa đã chia sẻ trong hội thoại và cập nhật credential.

## Xóa ảnh sau khi đăng thành công

Nối một HTTP Request vào nhánh thành công của node đăng: method `DELETE`, URL `http://host.docker.internal:3100/posts/POST_ID/charts`, cùng credential Header Auth, không cần body. POST_ID là `id` nội bộ lấy từ item `Posts for publishing`, không phải ID bài trên Binance. Nếu dùng item linking, expression URL là `{{ 'http://host.docker.internal:3100/posts/' + $('Posts for publishing').item.json.id + '/charts' }}`. Xử lý từng bài (Loop Over Items với batch 1 nếu node đăng chạy gộp); giữ đúng ID đi cùng nội dung/ảnh.

Chỉ gọi sau khi script xác nhận upload/đăng thành công, không nối nhánh lỗi `continueErrorOutput`. Nếu script thoát mã 0 nhưng trả lỗi nghiệp vụ trong stdout, thêm IF kiểm tra kết quả thực của script trước khi xóa. Nếu API xóa lỗi, retry riêng node xóa, không chạy lại node đăng.

Response có `postId`, `deleted`, `alreadyMissing`, `chart_paths:[]`, `alreadyCleaned`. Gọi lại an toàn khi file đã xóa. API lấy đường dẫn từ DB, chỉ xóa PNG 1h/4h/dashboard đúng symbol/snapshot bên trong OUTPUT_DIR, không xóa thư mục và từ chối symlink ở đường dẫn chart. Sau khi xóa, trang review không còn ảnh và `/posts/trending` không trả bài đó vì chart_paths rỗng. File mount ở `/data/charts` cũng biến mất nếu đó là bind mount của cùng OUTPUT_DIR; file sao chép riêng không bị xóa.

API không xác minh trạng thái trên Binance, không đổi status/PUBLISHED và không cập nhật series. Việc gọi API sau đăng thành công do n8n điều phối. Không có migration DB; cần deploy `app/src/chart/cleanup.ts` cùng routes và build/restart ứng dụng.

## Deploy source

Cập nhật source (gồm `app/src/pipeline.ts`, `app/src/api/trending.ts`, `app/src/trending-post.ts` và các thay đổi chart/writer), build trên VPS rồi restart PM2. Workflow trending hiện có dùng mảng `chart_paths` không cần đổi: node `Posts for publishing` chỉ nhận tối đa một bài mỗi lượt lịch 45 phút. Không có thay đổi schema/migration cho endpoint này. Chưa chạy build/test hay đăng thử trong lần triển khai source này.
