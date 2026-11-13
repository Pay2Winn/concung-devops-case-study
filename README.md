# DevOps case study

**Ứng viên: Nguyễn Tân Tiến**

Repository này chứa **toàn bộ bài nộp Phần 1 và Phần 2**.

| Phần | Nội dung | Tài liệu |
|---|---|---|
| 1 | Đề xuất kiến trúc Jenkins, quản lý pipeline, bảo mật, mở rộng và vận hành | [PDF thuyết trình — 8 trang](DevOps_Architecture_Part1.pdf) |
| 2 | Mã nguồn, cấu hình, hướng dẫn chạy và phân tích Task 0, 4, 5 | [PDF báo cáo — 10 trang](DevOps_CaseStudy_Report.pdf) |

## Phần 2 — Bài thực hành và phân tích tình huống

Phần 2 gồm **Task 0 — Kubernetes Deployment**, **Task 4 — Pipeline Optimization** và **Task 5 — Production Incident**. Số trang trong bảng dưới thuộc báo cáo Phần 2.

| Task | Nội dung | Vị trí |
|---|---|---|
| 0 — Bắt buộc | Đóng gói ứng dụng, Jenkins pipeline, deploy lên Kubernetes bằng Helm và Argo CD | Mã nguồn trong repo; PDF trang 2–5 |
| 4 — Tự chọn | Xác định stage chậm, dùng cache, chạy song song, tối ưu Dockerfile và tái sử dụng image | PDF trang 6–7 |
| 5 — Tự chọn | Điều tra logs/metrics/traces, chọn rollback hoặc sửa lỗi, thông báo và phòng ngừa tái diễn | PDF trang 8–10 |

Task 4 và Task 5 là phân tích tình huống theo đề, không phải số liệu benchmark hoặc sự cố production đã xảy ra.

## 1. Cấu trúc bài nộp

```text
.
├── DevOps_Architecture_Part1.pdf # Phần 1: thuyết trình kiến trúc Jenkins
├── DevOps_CaseStudy_Report.pdf  # Phần 2: báo cáo Task 0, 4, 5
├── docker-compose.yml          # Jenkins Controller, agent và ứng dụng
├── Jenkinsfile                 # Build, test, push image và cập nhật GitOps
├── Dockerfile                  # Image game 2048 chạy bằng Nginx
├── nginx.conf                  # Game, /health và /version
├── tests/smoke.sh               # Kiểm tra HTTP trên container thật
├── helm/demo/                  # Deployment, Service và ConfigMap
├── environments/dev/values.json # Phiên bản image cho môi trường dev
└── lab/                        # Thành phần hỗ trợ dựng và chạy Task 0
    ├── README.md               # Hướng dẫn kind, registry, Jenkins, Argo CD
    ├── .env.example            # Mẫu biến cấu hình agent, không chứa secret thật
    ├── kind/cluster.yaml
    ├── jenkins/agent/Dockerfile
    └── argocd/                 # Application, quyền truy cập và HTTPS của lab
```

Các file bài nộp chính ở thư mục gốc. Cấu hình hỗ trợ dựng môi trường và bằng chứng đã chọn nằm trong **[lab/](lab/README.md)**; không nộp cache, log ngoài bộ bằng chứng, kubeconfig, token hoặc công cụ tải về.

## 2. Ứng dụng demo

Sử dụng game JavaScript **[2048 của Gabriele Cirulli](https://github.com/gabrielecirulli/2048)**, giấy phép MIT. Đây là ứng dụng nguồn mở được dùng làm demo, không phải game tự phát triển.

- Nguồn game được pin tại commit `478b6ec346e3787f589e4af751378d06ded4cbbc`.
- BuildKit lấy source; Dockerfile chỉ copy static assets, không chạy script của repo game.
- Nginx phục vụ game; image giữ lại `LICENSE.txt`. Base image được pin bằng digest.
- Container chạy non-root, filesystem read-only; chỉ `/tmp` cho phép ghi.
- `/health` dùng cho HTTP health check; `/version` trả về commit của repo bài làm và môi trường chạy.

## 3. Chạy nhanh ứng dụng

Cần Docker Desktop ở chế độ **Linux containers**, Docker BuildKit và Internet để tải nguồn/base image. Các lệnh dùng Bash; trên Windows dùng Git Bash. Chạy từ thư mục gốc repo.

```sh
docker compose up -d --build app
curl --fail http://localhost:8082/health
curl --fail http://localhost:8082/version
```

Mở **http://localhost:8082** để chơi. Lệnh này chỉ chạy ứng dụng, không dựng Kubernetes hoặc Jenkins agent.

### Kiểm tra image và cấu hình

Cần thêm Helm để kiểm tra chart. `smoke.sh` tạo container tạm, kiểm tra game, JavaScript, CSS, giấy phép, health check, revision và việc chặn đường dẫn `.git`; khi kết thúc sẽ xóa đúng container vừa tạo.

```sh
docker build --platform=linux/amd64 --build-arg REVISION=local -t concung-2048:local .
MSYS_NO_PATHCONV=1 sh tests/smoke.sh concung-2048:local local
helm lint helm/demo -f environments/dev/values.json
helm template demo helm/demo -f environments/dev/values.json
docker compose --profile agent config --quiet
```

`MSYS_NO_PATHCONV` tránh việc Git Bash đổi đường dẫn Linux truyền cho Docker. Các bước này kiểm tra image, cấu hình và HTTP, không phải test toàn bộ luật chơi của game.

## 4. Luồng pipeline Task 0

1. **Checkout:** lấy commit của repo bài làm; image tag là 12 ký tự đầu của commit SHA, full commit được ghi trong image và `/version`.
2. **Build:** build Docker image một lần từ nguồn đã chọn.
3. **Test:** chạy smoke test trên container thật, lint và render Helm chart.
4. **Push image:** khi `DEPLOY=true`, push vào registry local và lấy digest để định danh nội dung image.
5. **Update GitOps:** cập nhật `image.repository`, `image.tag`, `image.digest` trong `environments/dev/values.json`, commit và push về `main`.
6. **Argo CD sync và smoke test:** Argo CD đọc Git, render Helm chart và sync ứng dụng lên Kubernetes. Jenkins chỉ xác nhận deploy thành công khi Application đạt `Synced/Healthy` tại đúng commit vừa push, game truy cập được và `/version` trả đúng commit nguồn.

Jenkins build/test và push image, sau đó ghi repository/tag/digest vào Git. Argo CD đọc values trong Git, render Helm chart rồi apply lên Kubernetes. Jenkins không giữ kubeconfig; pipeline gọi API Argo CD để xác nhận đúng commit đã deploy.

- Mặc định `DEPLOY=false`: chỉ build/test, không push image, không commit/push Git và không deploy.
- Chỉ bật `DEPLOY=true` trên trusted `main`, sau khi cấu hình registry, Jenkins Credentials và Argo CD, **được chủ repo cho phép commit/push GitHub**.
- Khi `DEPLOY=true`, thiếu cấu hình Argo CD sẽ làm pipeline dừng; không chuyển sang deploy trực tiếp. Commit cập nhật image không tự bật deploy cho lượt chạy sau.
- Pipeline dừng nếu test, xác thực, push hoặc kiểm tra sau deploy thất bại. Không force push/rebase khi remote thay đổi.

**[Hướng dẫn dựng toàn bộ Task 0](lab/README.md)** gồm điều kiện máy, kind, registry, Jenkins Controller/agent, Credentials, Argo CD và các cổng truy cập.

## 5. Cấu hình Kubernetes và rollback

- Helm chart tạo Deployment, Service và ConfigMap trong namespace `concung-demo`, với hai replicas.
- `RollingUpdate`: `maxUnavailable: 0`, `maxSurge: 1`. Hai Pod trên cùng một node không bảo vệ ứng dụng khi node đó lỗi.
- ConfigMap cung cấp `APP_ENV=dev`; thay đổi checksum cấu hình sẽ kích hoạt rollout.
- Có resource requests/limits cho CPU, RAM và startup/readiness/liveness probes; không tự mount Kubernetes API token vào Pod ứng dụng.
- Service dùng NodePort, kind ánh xạ tới `localhost:8083`. Không mở Ingress hoặc cho phép truy cập lab từ Internet.
- Scale bằng `replicaCount` trong values. Chỉ thêm autoscaling khi có số liệu tải và Metrics Server.

**Tag toàn số 0 và digest rỗng trong values là placeholder**, không trỏ tới image đã release. Phải chuẩn bị image tồn tại trong registry trước khi sync ứng dụng.

**Rollback với Argo CD:** khôi phục repository/tag/digest và config ổn định trong Git. Xác nhận Application `Synced/Healthy` tại commit rollback, rồi kiểm tra `/version` và chức năng ứng dụng. Thay đổi thủ công ngoài Git có thể bị Argo CD ghi đè khi sync.

**Nếu chỉ deploy bằng Helm thủ công:** xem `helm history demo -n concung-demo`, chọn revision rồi `helm rollback demo <revision> -n concung-demo --wait`. Không để Helm release và Argo CD cùng quản lý một ứng dụng. Giữ image cũ trong registry trong thời gian cần rollback.

## 6. Xử lý lỗi

| Hiện tượng | Kiểm tra |
|---|---|
| Build không lấy được game | Mạng, GitHub và commit cố định trong Dockerfile |
| Agent offline | Tên/secret agent, WebSocket, `docker compose logs agent` |
| Registry không kết nối được | Container registry, cổng 5001 và mạng `kind` |
| `ImagePullBackOff` | Tag/digest tồn tại, mirror của kind và sự kiện trong `kubectl describe pod` |
| Pod `Pending` | Resource requests, tài nguyên còn trống trên node và chỗ cho Pod mới khi rollout |
| Container restart | Logs của container hiện tại/lần chạy trước, probes, bộ nhớ và quyền ghi `/tmp` |
| Argo CD lỗi TLS hoặc 401/403 | Hostname, CA, thời hạn token và quyền truy cập Application; không tắt xác thực |
| Git push bị từ chối | Remote đã đổi hoặc branch protection; review, không force push |
| `/version` sai | Nhầm cổng Compose/Kubernetes, image cũ hoặc deployment khác |

## 7. Phạm vi kiểm chứng

| Hạng mục | Trạng thái |
|---|---|
| Image Nginx build/chạy bằng Docker Compose | Đã kiểm tra local |
| Game, assets, giấy phép, `/health`, `/version`, chặn `.git` | Smoke test trên container thật đạt |
| Helm lint/render và Docker Compose config | Đạt; kiểm tra lại đường dẫn khi tổ chức repo |
| Jenkins build/test với `DEPLOY=false` | Thành công; có log và ảnh bằng chứng |
| Image Nginx deploy lên Kubernetes | Deploy thành công trên Kubernetes local bằng Helm; có bằng chứng |
| Argo CD sync riêng tại local | `Synced/Healthy`, đúng commit/digest; agent đọc trạng thái qua TLS bằng token chỉ đọc; có bằng chứng |
| Jenkinsfile chạy xuyên suốt với Argo CD | Chưa chạy xác minh với `DEPLOY=true` |
| Rollback image qua Git/Argo CD | Chưa chạy xác minh |
| Task 4, Task 5 và báo cáo PDF | Đã hoàn tất nội dung phân tích |

Đã kiểm tra riêng ba phần: Jenkins build/test, deploy Helm lên Kubernetes và Argo CD sync. Lần kiểm tra Argo dùng commit cố định, override ba Helm parameters của image; values trong Git vẫn là placeholder. Sau khi Argo tiếp quản, dừng thao tác Helm trên cùng tài nguyên. Xem [logs, kết quả và ảnh bằng chứng](lab/evidence/2026-11-12/README.md). Chưa chạy toàn bộ luồng Jenkins–GitHub–Argo CD với `DEPLOY=true`.

**Giới hạn an toàn:** agent mount Docker socket nên có quyền điều khiển Docker host; chỉ chạy mã tin cậy, không chạy pull request từ fork. Jenkins và registry chỉ bind localhost. Registry không có authentication, chỉ dùng trong lab với một pipeline tin cậy push image. Kiểm tra tag trước push không ngăn được hai pipeline ghi cùng lúc; khi có nhiều pipeline cần registry hỗ trợ immutable tags. Không đưa secret, khóa TLS hoặc kubeconfig lên Git.
