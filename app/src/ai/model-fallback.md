# Model fallback

AI_MODEL là model chính; AI_FALLBACK_MODELS là danh sách dự phòng phân tách dấu phẩy, tối đa bốn model dự phòng. Bỏ khoảng trắng và model trùng, giữ thứ tự. Để trống để chỉ dùng model chính.

Ví dụ Gemini (cùng AI_BASE_URL và AI_API_KEY):
```env
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.5-flash-lite
AI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite
```

Các model trên có free tier theo [bảng giá Google](https://ai.google.dev/gemini-api/docs/pricing) kiểm tra ngày 2026-09-16. Đây không phải chế độ ép miễn phí: giá tính theo tier/project của API key, model phải khả dụng cho project và còn quota. Fallback không tăng quota chung của project. Không tự chuyển provider hoặc đổi key.

Chuyển model khi HTTP 404/408/429/500/502/503/504, timeout/reset/lỗi mạng tạm thời, hoặc output vẫn sai JSON/schema sau hai lần thử. HTTP 502/503/504 giữ retry tạm thời tối đa ba request như cũ trước khi đổi model. HTTP 400/401/403, lỗi chứng chỉ, lỗi cấu hình và content_filter dừng ngay. Không tăng số token hoặc giảm kiểm tra schema để chấp nhận output lỗi. Mỗi model được thử tối đa một lượt trong danh sách; model mới bắt đầu với input gốc, không mang JSON sai của model trước.

Log ai_model_fallback có from_model/to_model/code; ai_response_received có model; ai_models_exhausted khi hết danh sách. metadata.aiModel và draft_created.ai_model ghi model thực sự tạo ra output thành công. Lượt viết tiếp theo lại bắt đầu từ AI_MODEL, chưa có cooldown liên lượt.

Build: npm run build. Kiểm tra giả lập không DB và không gọi provider: node verify-ai-fallback.mjs. Các trường hợp gồm primary success, quota/model unavailable/server error/timeout, lỗi xác thực, schema sai, hết danh sách, chặn nội dung, loại trùng và tương thích complete cũ.

Sau deploy, restart PM2 để nạp cấu hình mới. Không cần migration DB. Việc qua schema của writer không đảm bảo vượt mọi kiểm tra quality sau đó; quality gate ở bước sau vẫn có thể từ chối draft.
