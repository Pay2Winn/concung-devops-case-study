# Hướng dẫn chạy Task 0 trên máy local

Thư mục này chứa các thành phần hỗ trợ dựng môi trường: kind, Jenkins agent và Argo CD. File bài nộp chính và cách chạy riêng ứng dụng nằm tại [README gốc](../README.md).

**Tất cả lệnh bên dưới chạy từ thư mục gốc repository**, không phải từ `lab/`. Các khối lệnh tạo/chỉnh sửa tài nguyên chỉ dành cho máy lab riêng; không dùng kubeconfig hoặc cluster công ty.

## Điều kiện

- Docker Desktop ở chế độ Linux containers, Bash/Git Bash, Git, Helm, kind và kubectl.
- Internet để tải image/nguồn; dự trù khoảng 8 GB RAM cho toàn bộ lab.
- Các cổng host còn trống: 8081 (Jenkins), 8082 (game Compose), 8083 (game Kubernetes), 8443 (Argo CD), 5001 (registry).
- Kiểm tra `kind get clusters`, `docker ps -a`, `docker volume ls` và `docker network ls` trước khi tạo. Tên `concung-demo`, `concung-registry`, volume `concung-registry-data` không được thuộc tài nguyên khác. Nếu lab đã có, kiểm tra và dùng lại; không xóa tài nguyên để ép chạy.

Jenkins agent dùng Docker socket nên có quyền điều khiển Docker host. Chỉ chạy mã tin cậy, không chạy pull request từ fork và không mở Jenkins hoặc registry ra Internet.

## 1. Tạo kind và registry

**Khối sau tạo tài nguyên local mới**, chỉ chạy một lần cho lab mới. Nếu lệnh lỗi, dừng và kiểm tra trước khi tiếp tục.

```sh
mkdir -p .runtime
# Không ghi đè kubeconfig lab đã có.
test ! -e .runtime/kubeconfig || exit 1
docker volume create --label io.concung.case-study=true concung-registry-data
docker run -d --restart=unless-stopped --name concung-registry \
  --label io.concung.case-study=true -p 127.0.0.1:5001:5000 \
  -v concung-registry-data:/var/lib/registry registry:2.8.3
kind create cluster --name concung-demo --config lab/kind/cluster.yaml \
  --kubeconfig "$PWD/.runtime/kubeconfig" --wait 120s
docker network connect kind concung-registry
printf '[host."http://concung-registry:5000"]\n  capabilities = ["pull", "resolve"]\n' | \
  MSYS_NO_PATHCONV=1 docker exec -i concung-demo-control-plane sh -ec \
  'mkdir -p /etc/containerd/certs.d/localhost:5001; tee /etc/containerd/certs.d/localhost:5001/hosts.toml'
```

Mỗi terminal mới đặt kubeconfig riêng, không thay file mặc định của máy:

```sh
export KUBECONFIG="$PWD/.runtime/kubeconfig"
kubectl --context kind-concung-demo get nodes
```

Host và Jenkins dùng Docker daemon local để push `localhost:5001/concung-2048`. Node kind kéo cùng tên image qua mirror `concung-registry:5000`. Registry không xác thực, host port chỉ bind `127.0.0.1`; container trong mạng lab vẫn truy cập được. Không dùng cho production.

## 2. Chuẩn bị image và kiểm tra Kubernetes

Working tree phải sạch để image khớp commit đã lưu. Tag là 12 ký tự đầu mã SHA của **repo bài làm**, không phải commit game upstream. Registry chỉ có một người/pipeline tin cậy ghi image; kiểm tra tag chưa tồn tại trước khi push, không ghi đè tag cũ. Lỗi mạng/quyền không được xem là image chưa tồn tại.

```sh
test -z "$(git status --porcelain)" || exit 1
SOURCE_REVISION=$(git rev-parse HEAD)
IMAGE_TAG=$(git rev-parse --short=12 HEAD)
IMAGE="localhost:5001/concung-2048:$IMAGE_TAG"
# Chỉ tạo mới khi registry xác nhận tag chưa tồn tại (HTTP 404).
code=$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' \
  "http://localhost:5001/v2/concung-2048/manifests/$IMAGE_TAG") || exit 1
test "$code" = 404 || { printf 'Dung: registry tra HTTP %s; khong ghi de tag.\n' "$code" >&2; exit 1; }
docker build --platform=linux/amd64 --provenance=false --sbom=false \
  --build-arg REVISION="$SOURCE_REVISION" -t "$IMAGE" .
MSYS_NO_PATHCONV=1 sh tests/smoke.sh "$IMAGE" "$SOURCE_REVISION"
docker push "$IMAGE"
docker pull "$IMAGE"
docker image inspect --format '{{json .RepoDigests}}' "$IMAGE"
```

Lấy `sha256:...` thuộc đúng repository `localhost:5001/concung-2048` từ kết quả inspect; không dùng digest ví dụ. Chọn **một** trong hai cách quản lý ứng dụng sau.

### Cách A — Helm thủ công, không dùng Argo CD cho ứng dụng

Chỉ dùng khi app **chưa được Argo CD quản lý**. Thay `<digest-thuc-te>` bằng digest vừa lấy.

```sh
helm upgrade --install demo helm/demo --namespace concung-demo --create-namespace \
  --kube-context kind-concung-demo \
  --set-string image.tag="$IMAGE_TAG" --set-string image.digest="sha256:<digest-thuc-te>" \
  --wait --timeout 180s
kubectl --context kind-concung-demo -n concung-demo get deployment,pods,svc
curl --fail http://localhost:8083/version
```

Kiểm tra `/version` trả đúng full commit nguồn, Pod Ready và game truy cập được. Cách này kiểm tra ứng dụng trên Kubernetes, **không thay thế việc chạy Jenkinsfile**.

### Cách B — Argo CD, dùng cho Jenkinsfile hiện tại

Không chạy khối `helm upgrade` ở cách A lên cùng tài nguyên. Cập nhật `environments/dev/values.json` bằng repository/tag/digest thật vừa chuẩn bị, review rồi commit/push `main` **khi chủ repo đã cho phép**. Không commit secret. Tag toàn số 0 ban đầu chỉ là placeholder; không bật sync với image đó.

Sau đó chuẩn bị Jenkins ở mục 3 và Argo CD ở mục 4. Jenkinsfile dùng cách B khi `DEPLOY=true`; không tự chuyển sang cách A nếu Argo CD chưa sẵn sàng.

## 3. Jenkins Controller và agent

```sh
docker compose up -d jenkins
# Chỉ xem mật khẩu local, không đưa đầu ra lên Git hoặc báo cáo.
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Mở http://localhost:8081, hoàn tất setup, tạo tài khoản quản trị và bật xác thực. Cài các plugin Pipeline, Git, GitHub Branch Source, Credentials Binding, Timestamper và Folder Properties. Đặt executor của built-in node bằng **0**.

1. Tạo permanent agent tên/label `docker-agent`, một executor, remote root `/home/jenkins/agent`, kết nối inbound qua WebSocket.
2. Chép mẫu ở `lab/.env.example` thành `.env` **tại thư mục gốc**, điền `JENKINS_AGENT_SECRET` từ Jenkins. Không ghi đè `.env` có sẵn; file này đã được Git bỏ qua.
3. Sau khi cluster kind tạo mạng `kind`, chạy:

```sh
test ! -e .env || exit 1
cp lab/.env.example .env
# Sửa .env, điền secret thật của agent trước khi chạy lệnh tiếp theo.
```

```sh
docker compose --profile agent up -d --build agent
```

Image agent tại `lab/jenkins/agent/Dockerfile` có Docker CLI, Helm, Git, curl, jq và chứng chỉ CA. Agent chạy root để truy cập Docker socket, chỉ dành cho lab tin cậy; Docker daemon local có thể giữ cache.

Tạo Folder chứa **Multibranch Pipeline**, nguồn repo này, nhánh `main`, script path `Jenkinsfile`. Cấu hình Git Tool tên `Default`. Đặt các biến sau trong Folder Properties; giá trị token/mật khẩu/chứng chỉ nằm trong Jenkins Credentials, không nằm trong property hoặc Git.

| Folder Property | Giá trị/cách chuẩn bị |
|---|---|
| `GITOPS_CREDENTIALS_ID` | ID credential username/password: GitHub username và token có Contents read/write chỉ cho repo này |
| `ARGOCD_SERVER` | `concung-demo-control-plane:30443` |
| `ARGOCD_CREDENTIALS_ID` | ID credential Secret text chứa token Argo CD chỉ đọc Application |
| `ARGOCD_CA_CREDENTIALS_ID` | ID credential Secret file chứa CA tin cậy của Argo CD |
| `SMOKE_URL` | `http://concung-demo-control-plane:30080` |

Scan branch và chạy `DEPLOY=false` trước: chỉ build/test, không cần deploy Credentials và không push. Sau khi hoàn thành mục 4, mới bật `DEPLOY=true` trên trusted `main`. Jenkins push image vào registry local, commit/push values lên GitHub; Argo CD đọc values để deploy. Jenkins xác nhận đúng commit đã `Synced/Healthy` và smoke test pass. Branch protection có thể chặn push trực tiếp; cấp quyền theo chính sách repo, không force push để vượt bảo vệ.

## 4. Argo CD và kết nối triển khai

Jenkins tạo image/cập nhật Git; Argo CD đọc Git để triển khai ứng dụng. Chuẩn bị Argo CD theo [hướng dẫn cài đặt chính thức](https://argo-cd.readthedocs.io/en/stable/getting_started/), dùng một release còn được hỗ trợ.

Các bước cấu hình thủ công cần hoàn tất trên **đúng cluster lab**:

1. Cài vào namespace `argocd`. Tải manifest vào thư mục mới, riêng dưới `.runtime/`; đọc quyền và tài nguyên trước khi apply. Lệnh kubectl dùng `--context kind-concung-demo`.
2. Tạo Secret TLS `argocd-server-tls` trong namespace `argocd`. Chứng chỉ phải có SAN `localhost` và `concung-demo-control-plane`; ký bằng CA mà Jenkins có thể tin cậy. Khóa riêng giữ local, không đưa vào Git/Jenkins.
3. Apply cấu hình dành cho bản cài lab mới:

   ```sh
   kubectl --context kind-concung-demo apply -f lab/argocd/lab.yaml
   ```

   File này đặt HTTPS NodePort 30443 và tài khoản `jenkins` chỉ đọc Application `concung-demo/concung-demo`. Không dùng để ghi đè cấu hình Argo CD dùng chung. Đổi mật khẩu admin mặc định, cấp token có hạn cho tài khoản `jenkins`; lưu token và CA bằng Credentials ở mục 3. Truy cập https://localhost:8443 và xác minh chứng chỉ; không dùng `--insecure`.
4. Xác nhận `main` trên GitHub có `helm/demo/` và values trỏ tới image **đã push, tồn tại** theo mục 2B. Repo public nên Argo không cần Git write token. Sau đó tạo Application:

   ```sh
   kubectl --context kind-concung-demo apply -f lab/argocd/demo.yaml
   ```

5. Xác nhận Application `concung-demo` đạt `Synced/Healthy` tại đúng commit cấu hình vừa push. Kiểm tra game và full source commit tại `/version`. Application bật auto-sync/self-heal, không bật auto-prune và không có deletion finalizer. Argo CD render chart; không chạy `helm upgrade` lên cùng ứng dụng.

Để kiểm tra deploy, Jenkins dùng token chỉ đọc Application và CA công khai, không dùng kubeconfig hay khóa TLS. Pipeline so Git revision trong trạng thái Argo CD với commit values vừa push; `Healthy` ở commit cũ không được tính là deploy thành công.

## 5. Cổng truy cập và xử lý lỗi

| Dịch vụ | Trên host | Từ Jenkins agent |
|---|---|---|
| Jenkins | http://localhost:8081 | `http://jenkins:8080` |
| Game Compose | http://localhost:8082 | Không dùng làm bằng chứng Kubernetes |
| Game Kubernetes | http://localhost:8083 | `http://concung-demo-control-plane:30080` |
| Argo CD | https://localhost:8443 | `https://concung-demo-control-plane:30443` |
| Registry | `localhost:5001` qua Docker CLI | Cùng Docker daemon của host |

- **Compose app chạy nhưng agent lỗi mạng:** agent cần external network `kind`; dựng cluster trước. Có thể chạy riêng app/Jenkins mà không bật profile agent.
- **Agent offline:** kiểm tra tên, label, secret và WebSocket; `docker compose logs agent`.
- **ImagePullBackOff:** kiểm tra image/tag/digest tồn tại, registry và mirror `hosts.toml`; xem sự kiện Pod.
- **TLS/401/403:** kiểm tra SAN, CA, hạn token và quyền đúng Application; không bỏ xác thực.
- **Git push bị từ chối:** remote thay đổi hoặc branch protection; dừng để review, không force/rebase.
- **Sai phiên bản:** so full commit tại `/version`, image digest và Git revision Argo; phân biệt cổng 8082 với 8083.

Phạm vi đã kiểm chứng, rollback và phân tích Task 4/5 nằm tại [README gốc](../README.md) và [báo cáo PDF](../DevOps_CaseStudy_Report.pdf). Hướng dẫn này không có nghĩa toàn bộ tích hợp đã được chạy xác minh.
