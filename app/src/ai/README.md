# Viết bài và biểu đồ theo dữ liệu

## Chọn phong cách
Hai lớp độc lập: NEW_POST / CONTINUE_SERIES / UPDATE_SERIES / INVALIDATED điều khiển ngữ cảnh series; price / volume / oi / positioning điều khiển góc kể chuyện và bảng màu.

- price luôn khả dụng.
- volume khi volume ratio 1h >= 1.2.
- oi khi |OI thay đổi 1h| >= 2% và có ít nhất hai mẫu lịch sử.
- positioning khi long/short >= 1.5 hoặc <= 0.67 và có ít nhất hai mẫu lịch sử.

Chọn ổn định theo symbol + asOf trong các phong cách đủ dữ liệu, tránh phong cách bài gần nhất nếu có lựa chọn khác. Ba bố cục thay đổi thứ tự hai kịch bản hoặc vị trí đoạn rủi ro. Metadata lưu editorialStyle; chart dùng cùng phong cách. Khi DB_CONTEXT_ENABLED=false, không có lịch sử để tránh lặp, vẫn chọn dựa trên snapshot.

Giọng văn trò chuyện, góc nhìn cá nhân ở mức quan sát, không giả vờ có vị thế đầu tư. Tối đa hai emoji, hài hước nhẹ khi phù hợp; INVALIDATED phải nghiêm túc. Bỏ các nhãn mục cứng và bảng số liệu dài trong bài AI. Luôn giữ hai kịch bản có điều kiện và rủi ro. Không suy diễn tin tức/MA99/khung tuần hoặc coi thay đổi 24h là phân tích nến ngày.

## Số liệu trong câu
AI dùng placeholder trong inlineFacts, ví dụ: “{{asset}} đang quanh {{price}} USDT, còn hỗ trợ một giờ ở {{hour_support}}”. Backend thay bằng giá từ snapshot, từ chối placeholder lạ và chữ số AI tự gõ trong văn xuôi. Quarter/hour/fourhour tương ứng 15m/1h/4h. Chỉ số EMA fast/medium/slow tương ứng 20/50/200.

Schema lưu trữ chấp nhận số trong bài đã render để review/approve tương thích; kiểm tra nguồn placeholder nằm tại writeDraft. Kiểm tra độ dài trường sau thay thế và tổng bài theo limits.ts (700–1.000 ký tự, mục tiêu 850). Cách này kiểm soát giá trị số, không chứng minh mọi diễn giải của AI là chính xác. Tin tức, số liệu cơ bản và MA99 chưa có nguồn nên chưa được bổ sung.

AI chỉ nhận tối đa bốn mẫu gần nhất mỗi chuỗi phái sinh và hai trích đoạn lịch sử (400 ký tự/đoạn), không gửi toàn bộ chuỗi 48 mẫu/chart/metadata. Vẫn tối đa hai lần tạo output; log prompt_type gồm ngữ cảnh:phong cách và prompt_tokens từ nhà cung cấp.

## Dữ liệu và chart
Binance client lấy tối đa 48 mẫu theo giờ từ openInterestHist và globalLongShortAccountRatio, kiểm tra giá trị, thứ tự, khoảng cách và độ mới. OI change vẫn tính từ hai mẫu cuối; dữ liệu lỗi để null/missing. Các trường history tùy chọn để snapshot cũ vẫn đọc được. Long/short là tỷ lệ tài khoản, không phải tỷ trọng khối lượng vị thế hoặc dự báo hướng giá.

Mỗi draft mới có ba ảnh: 1h.png, 4h.png và dashboard.png. Hai ảnh kỹ thuật dùng theme theo phong cách; dashboard gồm giá spot dạng đường, volume dạng cột, OI dạng đường, long/short dạng cột chồng. Dữ liệu đều theo thời gian UTC, không nội suy chuỗi thiếu; panel dưới hai mẫu ghi chưa có dữ liệu. Panel liên quan phong cách được đưa lên trước.

Review hỗ trợ index 0/1/2. API xóa ảnh chấp nhận đúng ba tên file này và vẫn kiểm tra phạm vi output. n8n dùng toàn bộ chart_paths nên nhận ba ảnh, vẫn chỉ một bài mỗi lượt trending.

## Cấu hình và triển khai
AI_WRITER_ENABLED=true mới áp dụng prompt. Chế độ false giữ draft dữ liệu. DB_CONTEXT_ENABLED=true mặc định đọc lịch sử/series/thesis; false bỏ ba truy vấn ngữ cảnh nhưng vẫn cần PostgreSQL cho snapshot/draft/pipeline/review.

Deploy toàn bộ các file source đã thay đổi và app/public/review.js rồi build/restart PM2 trên VPS. Không cần migration hoặc dependency mới. Snapshot/bài cũ không tự cập nhật; tạo snapshot mới để thấy lịch sử phái sinh và chart mới.

Đã kiểm chứng chart không DB trên Windows ngày 2026-09-15: npm run build thành công; lấy dữ liệu BTCUSDT thật (299 nến mỗi khung, 48 mẫu OI, 48 mẫu long/short); render đủ 12 PNG cho bốn theme và thêm trường hợp thiếu phái sinh. Kiểm tra chữ ký PNG/kích thước, mở ảnh kỹ thuật và dashboard để kiểm tra hiển thị; bổ sung chú giải màu Long/Short rồi build/render lại thành công từ snapshot đã lưu.

Chạy lại từ thư mục app:
```bash
npm run build
node verify-charts.mjs
```
Runner dùng phân tích/render trực tiếp, không import DB client, không gọi AI, không đăng bài. File analysis.json, PNG và report.json lưu trong output/verification-<timestamp>. Có thể dùng `node verify-charts.mjs --snapshot <đường-dẫn-analysis.json>` để render lại dữ liệu đã lưu mà không gọi Binance. Bốn theme được ép chọn để kiểm tra khả năng render; không có nghĩa snapshot đủ điều kiện biên tập cho cả bốn phong cách.

Báo cáo lần cuối: output/verification-2026-09-15T10-25-06-733Z/report.json. Chưa kiểm chứng AI viết bài, API trending, lưu/duyệt DB hoặc cleanup DB trong lần chạy này.

## Model dự phòng
AI_FALLBACK_MODELS cấu hình danh sách model dự phòng theo thứ tự sau AI_MODEL. Giới hạn hai lần sửa output áp dụng cho từng model; khi hết danh sách thì báo lỗi. Xem [model-fallback.md](model-fallback.md) để biết lỗi nào được chuyển model, cấu hình Gemini free tier và kiểm chứng không DB.

Đã chạy build và 14 kiểm tra giả lập fallback thành công ngày 2026-09-16; không gọi provider thật, không dùng DB. metadata.aiModel ghi model thực tế thành công.

Thay đổi prompt ngắn: mục tiêu 850 ký tự cho bài hoàn chỉnh, một luận điểm chính và hai đến ba số liệu. Giọng hòa đồng, xưng mình khi tự nhiên; gộp hướng dẫn giọng văn để tránh lặp và mâu thuẫn. Lần chỉnh prompt/giới hạn này chưa chạy build hoặc gọi AI kiểm chứng; kết quả kiểm chứng trước đó không xác nhận chất lượng prompt mới.
