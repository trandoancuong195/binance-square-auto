'use strict';
const $ = selector => document.querySelector(selector);
let key = '', nextCursor = null, polling = false;
let urls = [];
const message = text => { $('#message').textContent = text; };
const labels = { DRAFT: 'Bản nháp', APPROVED: 'Đã duyệt', PUBLISHED: 'Đã đăng', FAILED: 'Đã loại / lỗi' };
const errors = {
  UNAUTHORIZED: 'Khóa truy cập chưa đúng.', AI_NOT_CONFIGURED: 'Chưa cấu hình nhà cung cấp AI.',
  PIPELINE_BUSY: 'Một lượt quét khác đang chạy.', SYMBOL_BUSY: 'Token này đang được xử lý.',
  SERIES_CHANGED_REGENERATE_DRAFT: 'Chuỗi bài đã thay đổi. Hãy loại bản nháp này và tạo lại.',
  SNAPSHOT_EXPIRED_OR_NOT_FOUND: 'Dữ liệu phân tích đã hết hạn. Hãy tạo bản nháp mới.',
  AI_OUTPUT_INVALID: 'Nội dung AI chưa đạt yêu cầu sau hai lần thử.',
  POST_CONTENT_PENDING: 'Bản nháp chỉ có dữ liệu và chart, chưa có nội dung bài viết để duyệt.',
  POST_QUALITY_INVALID: 'Bài đã được viết nhưng chưa đạt kiểm tra nội dung. Xem log post_quality_failed để biết lý do.',
};
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-API-Key': key, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(errors[body.error] || body.error || `HTTP ${response.status}`); }
  return response;
}
async function json(url, options) { return (await request(url, options)).json(); }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
async function busy(button, action) { button.disabled = true; try { await action(); } catch (error) { message(error.message); } finally { button.disabled = false; } }
function clearImages() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
async function loadPosts(append = false) {
  const params = new URLSearchParams({ limit: '20' });
  if ($('#status').value) params.set('status', $('#status').value);
  if (append && nextCursor) params.set('before', nextCursor);
  const data = await json(`/posts?${params}`);
  if (!append) { clearImages(); $('#posts').replaceChildren(); }
  nextCursor = data.nextCursor;
  $('#more').hidden = !nextCursor;
  if (!data.posts.length && !append) $('#posts').append(element('p', 'hint', 'Chưa có bài ở trạng thái này. Bạn có thể quét thị trường hoặc tạo bài cho một token.'));
  for (const post of data.posts) {
    const card = element('article', 'post');
    card.append(element('h2', '', post.title));
    card.append(element('p', 'meta', `${post.symbol} · ${labels[post.status]} · ${new Date(post.created_at).toLocaleString('vi-VN')}`));
    const q = post.metadata.quality;
    const dataOnly = post.metadata.writerMode === 'data_only';
    if (dataOnly) card.append(element('p', 'hint', 'Bản nháp dữ liệu và chart. Chưa có nội dung bài viết để duyệt.'));
    if (q) card.append(element('p', 'quality', `Điểm kiểm tra tự động: ${q.score}/100 · ${q.length} ký tự · Vẫn cần người duyệt nội dung và chart.`));
    if (q?.warnings?.includes('SIMILAR_TO_RECENT_POST')) card.append(element('p', 'hint', 'Nội dung gần giống bài gần đây. Hãy đối chiếu trước khi duyệt.'));
    card.append(element('div', 'content', post.content));
    const charts = element('div', 'charts');
    card.append(charts);
    const proposal = post.metadata.output?.series;
    if (proposal) {
      const details = element('details');
      details.append(element('summary', '', 'Nhận định và cập nhật chuỗi bài'));
      details.append(element('p', '', `${proposal.stage} · ${proposal.newThesis}`));
      details.append(element('p', 'meta', `Mức vô hiệu: ${proposal.invalidationPrice ?? 'chưa đặt'}`));
      card.append(details);
    }
    if (post.status === 'DRAFT') {
      const actions = element('div', 'actions');
      const approve = element('button', '', 'Duyệt bài'), reject = element('button', 'danger', 'Loại bản nháp');
      approve.disabled = dataOnly;
      approve.addEventListener('click', () => busy(approve, async () => { await json(`/posts/${post.id}/approve`, { method: 'POST' }); message('Đã duyệt và cập nhật series. Bài chưa được đăng công khai.'); await loadPosts(); }));
      reject.addEventListener('click', () => busy(reject, async () => { await json(`/posts/${post.id}/reject`, { method: 'POST' }); message('Đã loại bản nháp.'); await loadPosts(); }));
      actions.append(approve, reject); card.append(actions);
    }
    $('#posts').append(card);
    for (let i = 0; i < post.chart_paths.length; i++) {
      try {
        const blob = await (await request(`/posts/${post.id}/charts/${i}`)).blob();
        if (!card.isConnected) break;
        const url = URL.createObjectURL(blob); urls.push(url);
        const img = element('img'); img.src = url; img.alt = `Biểu đồ ${post.symbol} ${['1h', '4h', 'Volume / OI / Long-short'][i] || 'dữ liệu'}`; charts.append(img);
      } catch { charts.append(element('p', 'hint', 'Chưa tải được chart.')); }
    }
  }
}
async function poll(id) {
  if (polling) return;
  polling = true; $('#scan').disabled = true; $('#run-panel').hidden = false;
  try {
    for (;;) {
      const run = await json(`/pipeline/runs/${id}`);
      const status = { RUNNING: 'Đang quét và tạo bài…', SUCCEEDED: 'Hoàn tất', FAILED: 'Có lỗi trong lượt xử lý' }[run.status] || run.status;
      const actions = { NEW_POST: 'Đã tạo bài mới', CONTINUE_SERIES: 'Đã tạo bài tiếp nối', UPDATE_SERIES: 'Đã tạo bài cập nhật', EXISTING_DRAFT: 'Đã có bản nháp', SKIP: 'Bỏ qua' };
      const rows = (run.result.results || []).map(item => `${item.symbol}: ${item.error ? (errors[item.error] || item.error) : actions[item.decision] || item.decision}${item.reason ? ' — ' + item.reason : ''}`);
      if (typeof run.result.total === 'number') rows.unshift(run.result.total === 0 ? 'Chưa có token đạt ngưỡng trending trong lượt quét này.' : `Đã xử lý ${run.result.processed ?? 0}/${run.result.total} token trending.`);
      if (run.result.scanErrors?.length) rows.push(`${run.result.scanErrors.length} token chưa lấy được dữ liệu phân tích.`);
      if (run.result.code) rows.push(run.result.code === 'PROCESS_INTERRUPTED' ? 'Lượt chạy bị gián đoạn khi dịch vụ khởi động lại.' : 'Lượt chạy không hoàn tất. Kiểm tra cấu hình và kết nối dịch vụ.');
      $('#run-result').textContent = [status, ...rows].join('\n');
      if (run.status !== 'RUNNING') { message(run.status === 'SUCCEEDED' ? 'Đã hoàn tất lượt quét.' : 'Lượt quét có lỗi. Xem chi tiết tiến trình; các draft thành công vẫn được lưu.'); await loadPosts(); break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) { message(error.message); }
  finally { polling = false; $('#scan').disabled = false; }
}
$('#connect-form').addEventListener('submit', event => { event.preventDefault(); void busy(event.submitter, async () => {
  key = $('#api-key').value.trim();
  const ready = await json('/ready'); $('#workspace').hidden = false;
  message(ready.aiWriterEnabled === false ? 'Đã kết nối. Đang tạm bỏ bước AI viết bài; chỉ tạo bản nháp dữ liệu và chart.' : ready.aiConfigured ? 'Đã kết nối.' : 'Đã kết nối. Cần cấu hình AI trước khi tạo bài.');
  await loadPosts();
  const { runs } = await json('/pipeline/runs');
  const running = runs.find(run => run.status === 'RUNNING');
  if (running) void poll(running.id);
}); });
$('#refresh').addEventListener('click', event => { void busy(event.currentTarget, () => loadPosts()); });
$('#status').addEventListener('change', () => { void loadPosts().catch(error => message(error.message)); });
$('#more').addEventListener('click', event => { void busy(event.currentTarget, () => loadPosts(true)); });
$('#scan').addEventListener('click', event => { void busy(event.currentTarget, async () => { const run = await json('/pipeline/run', { method: 'POST', body: JSON.stringify({ requestKey: `review-${crypto.randomUUID()}` }) }); await poll(run.id); }); });
$('#generate-form').addEventListener('submit', event => { event.preventDefault(); void busy(event.submitter, async () => {
  const symbol = $('#symbol').value.trim().toUpperCase(); message(`Đang phân tích ${symbol} và tạo bản nháp…`);
  const result = await json(`/post/generate/${encodeURIComponent(symbol)}`, { method: 'POST', body: '{}' });
  message(result.decision === 'EXISTING_DRAFT' ? 'Dữ liệu phân tích này đã có bài. Đang hiển thị danh sách bài.' : 'Bản nháp đã sẵn sàng.'); await loadPosts();
}); });
window.addEventListener('pagehide', clearImages);
