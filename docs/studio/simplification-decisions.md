# Studio tối giản — quyết định ngày 2026-09-06

This document describes retained source behavior and its source-era validation. Independent Academy infrastructure and production cutover are pending; use [the current deployment runbook](../deployment.md) for release status.

Trạng thái: đã chốt qua phỏng vấn; đây là yêu cầu thiết kế, chưa phải mô tả UI đã triển khai.

- Điều hướng Studio chỉ giữ Khóa học và Thư viện media. Các mục khác chuyển sang khu Quản trị; giữ nguyên quyền truy cập theo vai trò.
- Mở Studio vào danh sách khóa học, chọn khóa để soạn.
- Trình soạn có ba cột luôn hiện trên desktop: cây nội dung, JSON payload, preview.
- Cây nội dung hỗ trợ thêm, đổi tên, sắp xếp và xóa bài; đồng bộ với JSON.
- Bỏ chế độ form. JSON là cách sửa nội dung chính.
- Nhận JSON từng bài học, đề thi, bài tập và cả khóa học.
- Nhập cả khóa: chọn Tạo khóa mới hoặc Thay nội dung khóa đang mở; xem tóm tắt thay đổi trước khi áp dụng.
- Preview tự cập nhật khi JSON hợp lệ. Khi lỗi, báo lỗi và giữ preview hợp lệ gần nhất.
- Lưu nháp lưu toàn bộ thay đổi trong khóa đang mở. Không tự động lưu.
- Rời trang khi chưa lưu: Lưu / Bỏ thay đổi / Ở lại.
- Xuất bản riêng, áp dụng cho toàn bộ bản nháp đã lưu của khóa; kiểm tra lỗi và xác nhận trước khi xuất bản.
- Lịch sử phiên bản và xuất JSON nằm trong menu “…”.
- Bỏ hẳn nút công cụ prompt; cung cấp tài liệu content schema và JSON mẫu bên ngoài trình soạn.

## Đề xuất kỹ thuật cần giữ khi triển khai

- Lưu toàn khóa phải tránh lưu một phần rồi báo thành công; kiểm tra xung đột phiên bản.
- Nếu JSON lỗi, không tự ghi đè bằng thao tác cây nội dung; yêu cầu sửa lỗi trước thao tác ảnh hưởng tài liệu đó.
- Preview phải thể hiện rõ đang hiển thị bản hợp lệ trước đó khi JSON hiện tại lỗi.
- Nếu còn thay đổi chưa lưu, hướng dẫn lưu trước khi xuất bản.
- Xóa nội dung đã có dữ liệu học tập cần chính sách bảo toàn tham chiếu và lịch sử.
- Bố cục mobile và chi tiết chuyển các mục sang Quản trị chưa được chốt.
