# Content schema cho VFuture Studio

Có hai điểm vào:

- [content.schema.json](./content.schema.json) — dùng khi gửi **cả thư mục** schema, vì file này tham chiếu các file bên cạnh bằng `$ref` tương đối.
- [content-standalone.schema.json](./content-standalone.schema.json) — **một file duy nhất, tự đủ**. Mọi `$ref` đều trỏ vào `$defs` bên trong chính file đó, nên gửi riêng file này cho công cụ tạo JSON vẫn dùng được.

Bộ schema này được xuất từ Zod schema hiện có của content engine, với bốn loại payload phục vụ soạn khóa học. Studio hiện hỗ trợ chỉnh sửa JSON thủ công cho manifest và từng bài, hiển thị chẩn đoán cấu trúc/ngữ nghĩa, lưu bản nháp, nhập/xuất JSON và xem trước khóa học; quyền xuất bản vẫn do ứng dụng kiểm soát.

| Nội dung | `kind` | Schema | Trường nội dung chính |
| --- | --- | --- | --- |
| Cả khóa học | `course` | [course.json](./course.json) | `modules[].items[]` |
| Một bài học | `lesson` | [lesson.json](./lesson.json) | `blocks[]` |
| Một đề thi | `exam` | [exam.json](./exam.json) | `sections[].questions[]` |
| Một bài tập | `assignment` | [assignment.json](./assignment.json) | `instructions`, `submission` |

## Quy tắc dùng

- Payload độc lập có `schemaVersion: 1`, `kind`, `id` và các trường bắt buộc của loại tài liệu.
- ID dùng chữ thường a–z, số và dấu gạch ngang, tối đa 64 ký tự. Giữ ID ổn định khi sửa tài liệu.
- Tiêu đề và nội dung hỗ trợ chuỗi hoặc bản dịch `{ "vi": "…", "en": "…" }` tại các trường cho phép bản địa hóa.
- Nội dung văn bản dùng block và inline, ví dụ `{ "type": "paragraph", "content": [{ "text": "Xin chào" }] }`.
- JSON cả khóa nên chứa bài đầy đủ trong `modules[].items[]` để tự đủ dữ liệu. Bài lồng trong khóa dùng `type: "lesson" | "exam" | "assignment"`, không thêm `kind`, `schemaVersion` hay `$schema` vào bài lồng.
- Manifest cũng cho phép tham chiếu bài bằng `type` và `id`, nhưng khi đó phải cung cấp tài liệu bài tương ứng; một JSON manifest chỉ có tham chiếu không phải khóa học đầy đủ.
- Không thêm các trường không có trong schema. Không đưa trạng thái Lưu/Xuất bản vào payload; đó là trạng thái của ứng dụng.
- Media dùng asset ID có thật trong thư viện hoặc URL HTTPS theo schema.

## Ngôn ngữ nội dung và giao diện

`languages` khai báo các bản ngôn ngữ nội dung thực sự có trong khóa; `defaultLanguage` phải nằm trong danh sách này. Ngôn ngữ giao diện của học viên được chọn riêng. Nếu khóa không có bản nội dung theo ngôn ngữ giao diện, trình học dùng bản `defaultLanguage`; ứng dụng không tự dịch nội dung.

Ví dụ `course.json` chỉ có tiếng Việt (`languages: ["vi"]`, `defaultLanguage: "vi"`) và vẫn dùng được với giao diện tiếng Anh. Chỉ khai báo `["vi", "en"]` khi tác giả cung cấp nội dung cho cả hai ngôn ngữ. Khi dùng AI, nêu rõ ngôn ngữ nội dung và cấu hình khóa đích.

Các endpoint JSON Schema cần đuôi `.json`, ví dụ `/api/v1/schema/v1/course.json`.

## Ví dụ

- [Một bài học](./examples/lesson.json)
- [Một đề thi](./examples/exam.json)
- [Một bài tập](./examples/assignment.json)
- [Cả khóa học chứa đủ ba loại bài](./examples/course.json)
- [Đề kiểm tra dạng quiz](./examples/quiz-exam.json)
- [Quiz luyện tập trong bài học](./examples/quiz-lesson.json)

Mọi ví dụ trên đều được kiểm tra tự động bằng Ajv (Draft 2020-12) với cả schema theo từng loại lẫn bundle tự đủ, và bằng validator Zod thật của content engine.

JSON Schema kiểm tra cấu trúc. Content engine vẫn phải kiểm tra thêm các quy tắc như ID trùng, tham chiếu, đáp án, ngôn ngữ và điều kiện xuất bản. Các hàm refinement của Zod không được biểu diễn đầy đủ trong JSON Schema xuất ra.

Kiểm tra mẫu khóa bằng validator thật của dự án:

```sh
npm run content:validate -- docs/studio/content-schema/examples/course.json --lang vi
```

## Sinh lại và kiểm tra

Nguồn chuẩn là `src/content-engine/schema/`; mọi file JSON trong thư mục này và trong `public/schemas/v1/` đều là **sản phẩm sinh ra**, không sửa tay.

```sh
npm run schema:export   # ghi lại toàn bộ file schema
npm run schema:check    # sinh lại trong bộ nhớ và so với từng file đã commit
```

`schema:check` so sánh **tất cả** sản phẩm sinh ra — sáu file public, bốn file theo loại ở đây, `content.schema.json` và `content-standalone.schema.json` — nên một thay đổi schema chưa xuất lại sẽ hỏng CI thay vì âm thầm publish schema cũ.

Hai tài liệu hướng dẫn có nhúng sẵn bundle tự đủ ở cuối file để gửi trọn một file cho AI: [QUIZ-AI-INSTRUCTIONS.md](./QUIZ-AI-INSTRUCTIONS.md) và `json schema.md` ở thư mục gốc. `schema:export` chỉ ghi lại **khối JSON trong fence** của hai file đó, không đụng tới một chữ nào của phần hướng dẫn; `schema:check` báo lỗi khi khối đó lệch với schema hiện tại. Một bản nhúng cũ nguy hiểm hơn một file cũ, vì nó dạy AI sinh ra trường mà engine đã từ chối.

## Những gì JSON Schema không kiểm tra được

Schema chỉ ràng buộc phần biểu diễn được. Các quy tắc sau vẫn do content engine kiểm tra lúc chạy, và một tài liệu hợp lệ theo schema vẫn có thể bị từ chối:

- ID duy nhất trong từng phạm vi riêng: module/mục/kỹ năng trong manifest; block trong một bài học; section trong một đề; câu hỏi trong một quiz hoặc đề; lựa chọn, blank, nhóm phân loại và item thứ tự trong chính danh sách của nó. Mọi mục khai báo trong manifest phải có tài liệu đi kèm.
- Đáp án phải trỏ tới ID có thật trong cùng câu hỏi (lựa chọn, blank, nhóm phân loại, thứ tự).
- Tham chiếu tới asset, ngân hàng câu hỏi, tài nguyên, kỹ năng và cơ hội phải giải được.
- Bản đồ ngôn ngữ phải phủ `defaultLanguage` của khóa.
- URL media và nhúng phải thuộc host được cho phép.
- Renderer đích phải hỗ trợ mọi loại câu hỏi trong tài liệu.
- Biểu thức chính quy của `short_answer` phải biên dịch được bằng engine không quay lui có giới hạn.

Danh sách này được xuất kèm mã nguồn tại `RUNTIME_ONLY_RULES` trong `src/content-engine/schema/json-schema.ts`.
