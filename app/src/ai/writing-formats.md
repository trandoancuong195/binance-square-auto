# Format bài viết

`writer.ts` chọn format trước khi gọi AI. `writing-formats.ts` định nghĩa cả hướng dẫn viết lẫn cách ghép các trường thành bài hoàn chỉnh; `prompts.ts` dùng cùng định danh format. Luồng `/posts/trending` gọi writer hiện tại nên tự áp dụng cho bài mới, không cần đổi node đăng n8n.

| Format | Bố cục |
| --- | --- |
| observation | Quan sát và giải thích → hai khả năng trong một đoạn → điểm cần theo dõi |
| question_answer | Câu hỏi → lời giải → hai kịch bản → điều chưa biết |
| checklist | Mở vấn đề → ba dòng bằng chứng/điều kiện → điểm dễ đọc sai |
| debate | Bối cảnh → hướng tăng → hướng giảm → cân bằng chứng và rủi ro |
| evidence_first | Bằng chứng → ý nghĩa → giảm rồi tăng → giới hạn |
| scenario_map | Bối cảnh → nhánh ↑ → nhánh ↓ → điều kiện xem xét lại |
| risk_first | Giới hạn tín hiệu → câu chuyện → bằng chứng → hai kịch bản |
| timeframe_lens | Khung rộng → nhìn gần → hai kịch bản → giới hạn khung ngắn |

Chọn bằng seed từ symbol/thời điểm snapshot, loại format trong tối đa ba bài gần đây của context khi có lựa chọn khác. `timeframe_lens` chỉ đủ điều kiện khi chart thể hiện cả 1h/4h và góc bài là price/volume. Không chọn lại format trong lần AI retry sửa schema. Việc chọn phụ thuộc context: cùng snapshot với lịch sử khác có thể chọn khác; bài đã lưu được luồng generate trả lại như cũ.

Code ghi format vào `metadata.output.post.format`, không cần migration hoặc trường response mới. Schema cho phép thiếu format để đọc bài cũ. `assemble()` dùng format đã lưu nếu có, còn bài cũ giữ cách ghép cũ. Lịch sử cũ chưa lưu format hoặc context bị tắt sẽ không có thông tin để tránh lặp format; seed vẫn tạo sự đa dạng theo snapshot. Đây là chống lặp trong lịch sử được context cung cấp, không phải thống kê toàn bộ bài đã đăng trên Binance.

Mọi format giữ nguyên bằng chứng, hai kịch bản có điều kiện và rủi ro. Ngân sách ký tự dùng chính assembler của format để tính cả nhãn, bullet, dấu cách và xuống dòng, rồi kiểm tra lại nội dung sau khi thay placeholder. Giữ giới hạn độ dài và các kiểm tra số liệu/series hiện có. AI nhận phần mở và kết của bài gần đây để tránh sao chép cách diễn đạt; đây là hướng dẫn viết, chưa phải bộ chặn trùng ngữ nghĩa.

Không thay đổi kế hoạch chart hoặc giới hạn tối đa ba ảnh. Chưa chạy build/test hoặc tạo bài AI thật để đánh giá chất lượng văn phong.
