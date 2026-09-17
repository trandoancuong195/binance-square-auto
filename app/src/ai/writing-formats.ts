// Formats change both the writing instructions and the actual assembled paragraphs.
// Every format retains the evidence, two conditional scenarios and concrete risk.
export const WRITING_FORMAT_IDS = ['observation', 'question_answer', 'checklist', 'debate', 'evidence_first', 'scenario_map', 'risk_first', 'timeframe_lens'] as const;
export type WritingFormatId = typeof WRITING_FORMAT_IDS[number];
type Field = 'hook' | 'interpretation' | 'bullishScenario' | 'bearishScenario' | 'risk';
type Block = { fields: readonly Field[]; prefix?: string; separator?: string };
type Format = { name: string; instruction: string; blocks: readonly Block[] };

export const WRITING_FORMATS: Record<WritingFormatId, Format> = {
  observation: {
    name: 'Ghi chép bên chart',
    instruction: 'Kể một quan sát hiện tại: hook là chi tiết khiến người xem dừng lại, interpretation nối liền để giải thích. Hai kịch bản viết như hai khả năng trong cùng một đoạn, tránh lặp cấu trúc câu. risk chốt bằng điều còn cần quan sát. Không dựng trải nghiệm cá nhân hoặc sự kiện ngoài snapshot.',
    blocks: [{ fields: ['hook', 'interpretation'] }, { fields: ['bullishScenario', 'bearishScenario'] }, { fields: ['risk'] }],
  },
  question_answer: {
    name: 'Một câu hỏi, một lời giải',
    instruction: 'hook đặt một câu hỏi cụ thể mà dữ liệu hiện tại có thể trả lời, kết bằng dấu hỏi. interpretation trả lời thẳng rồi giải thích bằng chứng và giới hạn của nó. Hai kịch bản nối tiếp câu trả lời. risk kết bằng điều chưa biết, không thêm câu hỏi câu tương tác. Không tự chèn nhãn Hỏi/Đáp vì code đã thêm.',
    blocks: [{ fields: ['hook'], prefix: 'Hỏi: ' }, { fields: ['interpretation'], prefix: 'Đáp: ' }, { fields: ['bullishScenario', 'bearishScenario'] }, { fields: ['risk'] }],
  },
  checklist: {
    name: 'Danh sách theo dõi',
    instruction: 'hook nêu vấn đề cần theo dõi, không mở bằng một danh sách số liệu. interpretation là một dấu hiệu hiện có; bullishScenario là điều kiện củng cố hướng tăng; bearishScenario là điều kiện củng cố hướng giảm. Ba trường này thành ba dòng gạch đầu dòng, mỗi dòng tự đứng được. risk kết bằng một điểm dễ đọc sai. Không tự thêm bullet hoặc số thứ tự.',
    blocks: [{ fields: ['hook'] }, { fields: ['interpretation', 'bullishScenario', 'bearishScenario'], prefix: '• ', separator: '\n• ' }, { fields: ['risk'] }],
  },
  debate: {
    name: 'Hai phía của vùng giá',
    instruction: 'hook giới thiệu vùng giá đang cần kiểm chứng, không bịa tranh luận hoặc tâm lý đám đông. bullishScenario và bearishScenario trình bày lần lượt điều kiện có lợi cho mỗi phía. interpretation cân lại bằng chứng sau hai kịch bản; risk kết bằng điều quyết định nhận định. Không tự thêm nhãn Hai phía hoặc Hướng tăng/giảm.',
    blocks: [{ fields: ['hook'] }, { fields: ['bullishScenario'], prefix: 'Hướng tăng: ' }, { fields: ['bearishScenario'], prefix: 'Hướng giảm: ' }, { fields: ['interpretation', 'risk'] }],
  },
  evidence_first: {
    name: 'Bắt đầu từ bằng chứng',
    instruction: 'interpretation được đặt đầu bài: mở thẳng bằng một dữ kiện đáng chú ý trong chart, không lời dẫn. hook nằm sau, giải thích tại sao dữ kiện này đáng quan tâm; không mở lại bài hoặc lặp số liệu. bearishScenario rồi bullishScenario là hai cách kiểm chứng. risk khép lại bằng giới hạn của bằng chứng.',
    blocks: [{ fields: ['interpretation'] }, { fields: ['hook'] }, { fields: ['bearishScenario', 'bullishScenario'] }, { fields: ['risk'] }],
  },
  scenario_map: {
    name: 'Bản đồ điều kiện',
    instruction: 'hook và interpretation cùng dựng bối cảnh thật ngắn để dành phần chính cho hai nhánh điều kiện. bullishScenario bắt đầu bằng điều kiện hướng tăng, bearishScenario bằng điều kiện hướng giảm; mỗi nhánh nói rõ điều gì cần xác nhận. risk kết bằng mốc hoặc tín hiệu khiến phải xem xét lại. Không tự thêm mũi tên hoặc nhãn vì code đã thêm.',
    blocks: [{ fields: ['hook', 'interpretation'] }, { fields: ['bullishScenario'], prefix: '↑ ' }, { fields: ['bearishScenario'], prefix: '↓ ' }, { fields: ['risk'] }],
  },
  risk_first: {
    name: 'Đọc giới hạn trước tín hiệu',
    instruction: 'risk nằm đầu bài: mở bằng giới hạn cụ thể của tín hiệu đang có, không cảnh báo chung hoặc giật gân. hook nối ngay để nêu câu chuyện đáng quan tâm dù còn giới hạn. interpretation giải thích dữ liệu thật sự cho biết gì. Hai kịch bản ở cuối nêu điều kiện kiểm chứng, không chốt bằng lời khuyên giao dịch.',
    blocks: [{ fields: ['risk', 'hook'] }, { fields: ['interpretation'] }, { fields: ['bullishScenario', 'bearishScenario'] }],
  },
  timeframe_lens: {
    name: 'Đổi góc nhìn theo khung',
    instruction: 'hook bắt đầu bằng quan sát trên khung bốn giờ, interpretation chuyển sang một giờ và giải thích chúng đồng thuận hay khác nhau theo dữ liệu. Không cố dựng mâu thuẫn khi hai khung đồng thuận. Hai kịch bản theo sau với điều kiện cụ thể; risk kết bằng giới hạn của khung ngắn. Không tự thêm nhãn khung vì code đã thêm.',
    blocks: [{ fields: ['hook'], prefix: 'Khung rộng: ' }, { fields: ['interpretation'], prefix: 'Nhìn gần: ' }, { fields: ['bullishScenario', 'bearishScenario'] }, { fields: ['risk'] }],
  },
};

export function assembleFormat(post: Record<Field | 'title', string> & { tags: string[] }, format: WritingFormatId): string {
  const body = WRITING_FORMATS[format].blocks.map(block =>
    (block.prefix ?? '') + block.fields.map(field => post[field]).join(block.separator ?? ' '));
  return [post.title, ...body, post.tags.join(' ')].join('\n\n');
}
