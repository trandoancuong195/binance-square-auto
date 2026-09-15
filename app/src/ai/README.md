# Prompt viết bài

`writer.ts` chọn đúng một ngữ cảnh, không gọi AI để quyết định có viết hay không:

| Prompt | Điều kiện |
| --- | --- |
| INVALIDATED | Luận điểm của series đã bị vô hiệu theo nến đóng 1h; ưu tiên cao nhất |
| NEW_POST | Không có series được chọn |
| UPDATE_SERIES | Có series và kế hoạch yêu cầu cập nhật |
| CONTINUE_SERIES | Các trường hợp còn lại khi có series |

`prompts.ts` ghép hợp đồng JSON và giọng văn chung với hướng dẫn của ngữ cảnh đã chọn. Văn phong chuyên nghiệp, trẻ trung; tối đa một ví von hài hước nhẹ nếu phù hợp. Phần rủi ro nghiêm túc, bài vô hiệu luận điểm không đùa về thua lỗ.

Đầu vào AI chỉ gồm bằng chứng thị trường, series được chọn, tối đa hai trích đoạn lịch sử (mỗi đoạn tối đa 400 ký tự), mức giá hợp lệ, stage hợp lệ và ngân sách ký tự. Ưu tiên trích phần nhận định từ output đã lưu; bản nháp chỉ có dữ liệu được loại khỏi lịch sử gửi AI. Không gửi toàn bộ metadata, đường dẫn chart, ID, điểm thành phần hoặc bản sao fixedFacts. Khung 1h giữ đầy đủ chỉ báo; các khung khác giữ xu hướng, giá, biến động, RSI, volume, hỗ trợ/kháng cự và tín hiệu breakout.

Context đầy đủ vẫn được dùng tại backend. Độ dài bài hoàn chỉnh tiếp tục dùng `limits.ts`; writer trừ trước số ký tự của số liệu, nhãn và xuống dòng để gửi ngân sách văn xuôi cho AI. Kiểm tra schema, độ dài, chuyển stage, bias và mức giá vẫn áp dụng. Khi cần sửa output, client gửi lại lỗi và JSON trước đó, tối đa hai lần tạo output.

Log `ai_response_received` bổ sung `prompt_type`, `request_characters` và `prompt_tokens` (null nếu nhà cung cấp không trả usage). Dùng token thực tế để so sánh chi phí; số ký tự không tương đương số token. Chưa có đo lường mức tiết kiệm bằng yêu cầu AI thực tế.

Các prompt chỉ được sử dụng khi `AI_WRITER_ENABLED=true`. Thay đổi này không tự bật lại bước viết AI đang tạm tắt.

Phản hồi sửa lỗi chữ số gồm ví dụ cách diễn đạt khung thời gian/chỉ báo. Lỗi khóa dư trả danh sách khóa hợp lệ lấy từ schema, không ghi lại tên khóa lạ của AI. Lỗi mức vô hiệu chỉ rõ bias, giá tham chiếu hiện tại và một số mức hợp lệ hoặc null; không tự đổi bias, xóa chữ số hay sửa giá để ép output vượt kiểm tra. Vẫn giới hạn hai lần tạo output, nên AI không tuân thủ sau lần sửa vẫn trả `AI_OUTPUT_INVALID`.

## Bật/tắt lịch sử từ DB

Đặt `DB_CONTEXT_ENABLED=true` (mặc định) trong `app/.env` để đọc lịch sử bài viết, series đang hoạt động và luận điểm trước như hiện tại. Đặt `DB_CONTEXT_ENABLED=false` để `buildContext` bỏ qua cả ba truy vấn này, trả lịch sử/series rỗng và luận điểm null. Log `db_context_bypassed` ghi nhận bước bị bỏ qua. Draft mới được lập kế hoạch theo `NEW_POST`, dựa trên dữ liệu thị trường hiện tại.

Cờ này chỉ điều khiển dữ liệu lịch sử đưa vào ngữ cảnh viết, không phải chế độ chạy không có PostgreSQL. `DATABASE_URL` vẫn bắt buộc; snapshot, khóa chống chạy đồng thời, kiểm tra draft trùng, lưu draft và review vẫn sử dụng DB. Một snapshot đã có draft vẫn trả draft hiện có. Khởi động lại ứng dụng sau khi đổi cờ. Cờ độc lập với `AI_WRITER_ENABLED`.
