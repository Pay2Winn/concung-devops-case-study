# Bằng chứng kiểm thử local — 2026-11-12

## Phạm vi

Đây là **ba phần kiểm chứng riêng**: Jenkins chạy build/test với `DEPLOY=false`; image được đẩy vào registry local và triển khai **thủ công bằng Helm** lên kind; sau đó **Argo CD tiếp quản và đồng bộ** cùng tài nguyên bằng cấu hình local có Helm parameters ghi đè image. Không chạy pipeline `DEPLOY=true`, không commit/push values lên GitHub trong các lượt kiểm thử. Kết quả này **không chứng minh Jenkins–GitHub–Argo CD triển khai xuyên suốt**.

- Mã nguồn: `b4996d3031048f4d2f41e57b52a143301cdf18fa`.
- Image: `localhost:5001/concung-2048:b4996d303104`.
- Digest: `sha256:d3a1458514a94adfdf2226806be67baa822bef7324bd1472e29efde8a449c6ae`.
- Cluster/context: `kind-concung-demo`; namespace: `concung-demo`; Helm release: `demo`.
- Ngày kiểm thử: 2026-11-12. Thời điểm có hậu tố `Z` trong JSON/log dùng UTC.
- Mã chạy, Jenkinsfile và Helm chart local khớp commit trên. Các thay đổi tài liệu chưa commit không nằm trong checkout Jenkins.

## Kết quả

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Jenkins Controller/agent | Controller 0 executor; agent `docker-agent` online, 1 executor | `jenkins-agents.json` |
| Xác thực Jenkins | Truy cập ẩn danh bị từ chối; có đăng nhập mới đọc được | `jenkins-security.json` |
| Jenkins build #2 | `SUCCESS`, `DEPLOY=false`; thời gian 7.654 giây, có cache từ build #1 | `jenkins-build.json`, `jenkins-build-2.png`, `jenkins-parameters.png` |
| Build/test | Build image, smoke test và Helm lint/render đạt; log có timestamp | `jenkins-console.log` |
| Stage triển khai | Load configuration, Push image, Update GitOps và Wait Argo CD đều bị bỏ qua | `jenkins-console.log` |
| Registry local | Push/pull và smoke test image lấy từ registry đạt | `local-deployment.log` |
| Kubernetes | Helm install đạt; 2/2 Pod Ready, 0 restart tại thời điểm kiểm tra; digest khớp | `kubernetes-checks.json`, `kubernetes-status.txt` |
| HTTP qua Kubernetes | `/health`, `/version`, assets và giấy phép trả 200; `/.git/config` bị chặn với 403 | `browser-smoke.json`, `kubernetes-checks.json` |
| Chơi game | 20 phím mũi tên; điểm từ 0 lên 76; trạng thái bàn chơi thay đổi | `browser-smoke.json`, `game-kubernetes-desktop.png` |
| Màn hình hẹp | 390 px, không tràn ngang; tải lại vẫn giữ điểm 76, các ô nằm trong bàn | `browser-smoke.json`, `game-kubernetes-mobile.png` |
| Argo CD | v3.6.1; `Synced/Healthy`, sync `Succeeded`, đúng full commit; ba tài nguyên giữ nguyên mã định danh | `argocd-result.json`, `argocd-application.png` |
| Quyền Argo CD | Token `jenkins` có hạn hai giờ; đọc đúng Application, không sync/update/delete hoặc đọc ứng dụng khác | `argocd-security.json`, `argocd-result.json` |
| Kiểm tra từ agent | Xác minh chứng chỉ; đọc đúng revision trước/sau kiểm tra `/version` và game | `argocd-agent-check.json`, `argocd-agent-check.log` |

Jenkins 2.580.2; Docker CLI trong agent 27.5.1; Docker server 29.9.2; Helm trong agent 3.17.3. Phiên bản và plugin thực tế nằm trong `tool-versions.json`, `jenkins-plugins.json`.

## Ghi chú khi đọc log

- Thông báo `403 Forbidden` trong smoke test là kết quả mong đợi khi kiểm tra đường dẫn riêng tư, không phải lỗi build.
- Jenkins có cảnh báo chọn Git installation và dùng `Default`; checkout vẫn thành công. Không xóa cảnh báo khỏi log.
- Lần bootstrap đầu bị lỗi kiểu mảng Git Tool; đã sửa cấu hình lab trước khi hai build chạy thành công. Không sửa Jenkinsfile để né lỗi.
- Build #1 tự động thành công nhưng không xuất tham số trong phản hồi API. Build #2 được gọi với `DEPLOY=false` rõ ràng và là bằng chứng chính.
- Một số kiểm tra bổ sung ban đầu sai kỳ vọng/mã thu thập: đòi 404 thay vì 403 và gọi `Response.status` như hàm. Đã sửa bộ kiểm tra rồi chạy lại; không sửa ứng dụng để tạo kết quả đạt.
- Đường dẫn tuyệt đối của workspace trong log Helm đã thay bằng `<repository>`; không thay kết quả lệnh.

## Phạm vi lượt Argo CD

- Đọc repo GitHub thật và chart tại commit cố định nêu trên; Application local dùng ba parameters `image.repository`, `image.tag`, `image.digest`. Values gốc trong Git vẫn là chỗ giữ. Cấu hình kiểm thử: `argocd-application.local.json`.
- Đồng bộ thủ công qua Argo CD, không prune/force/replace, không bật tự đồng bộ. Deployment, Service và ConfigMap không bị xóa/tạo lại; hai Pod vẫn sẵn sàng, không restart. Helm dừng thao tác; bản ghi release chỉ giữ làm lịch sử.
- Kiểm tra từ container agent bằng `docker exec` chạy phần shell tương đương bước chờ/kiểm chứng trong Jenkinsfile; **không phải một build Jenkins triển khai**. Không cấp kubeconfig hoặc quyền ghi GitHub cho Jenkins.
- Bảo mật tầng truyền tải (TLS) xác minh tên máy và cơ quan cấp chứng chỉ (CA) lab trên host và agent, không bỏ kiểm tra. Riêng ảnh giao diện đi qua proxy chỉ bind `127.0.0.1:8444`, proxy xác minh TLS tới Argo CD; không dùng ảnh để chứng minh TLS của trình duyệt.
- Ảnh đã che hai trường tác giả commit chứa email riêng; không thay trạng thái hoặc revision. Bản chụp chưa che không nằm trong bộ nộp.
- Bộ thu thập ban đầu kỳ vọng trường `revision` ở phản hồi manifests, nhưng giao diện thực tế chỉ trả `manifests`. Đã sửa kiểm tra: revision được đối chiếu trên Application và kết quả sync.

## Giới hạn

Chưa kiểm chứng Jenkins `DEPLOY=true`, cập nhật values trong Git bởi Jenkins, rollback, cập nhật rolling giữa hai phiên bản hoặc cử chỉ cảm ứng. Hai replica cùng một node không chứng minh tính sẵn sàng cao khi node hỏng. Thời gian build có cache không phải phép đo hiệu năng chuẩn.

Bộ này chỉ gồm cấu hình kiểm thử, log, JSON và ảnh đã chọn; không gồm mật khẩu, secret agent, cookie đăng nhập, khóa riêng hoặc kubeconfig. Không sao chép toàn bộ thư mục `.runtime` vào bài nộp.

## Kiểm tra lại bộ bằng chứng

Cần Node.js, không cần cài thư viện:

```sh
node lab/evidence/2026-11-12/verify-evidence.mjs
```

Lệnh kiểm tra các kết quả đã lưu, sự khớp commit/digest và danh sách checksum; **không chạy lại Jenkins hoặc triển khai Kubernetes**. Các địa chỉ localhost trong log chỉ hoạt động trên máy đang giữ lab.
