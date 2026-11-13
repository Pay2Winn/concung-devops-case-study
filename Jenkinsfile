pipeline {
    agent { label 'docker-agent' }
    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timestamps()
        timeout(time: 25, unit: 'MINUTES')
    }
    parameters {
        booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Push image and update GitOps on trusted main')
    }
    environment {
        IMAGE_REPOSITORY = 'localhost:5001/concung-2048'
    }
    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm
                script {
                    env.SOURCE_REVISION = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    if (!(env.SOURCE_REVISION ==~ /[a-f0-9]{40}/)) { error 'Invalid source commit' }
                    env.IMAGE_TAG = env.SOURCE_REVISION.take(12)
                    env.IMAGE_REF = "${env.IMAGE_REPOSITORY}:${env.IMAGE_TAG}"
                    env.LOCAL_IMAGE = "concung-2048:${env.SOURCE_REVISION}"
                    if (params.DEPLOY && (env.CHANGE_ID || env.BRANCH_NAME != 'main')) {
                        error 'Deploy only from trusted main in a Multibranch Pipeline'
                    }
                }
            }
        }
        stage('Build') {
            steps {
                sh '''
                    docker build --pull --platform=linux/amd64 --provenance=false --sbom=false \
                        --build-arg REVISION="$SOURCE_REVISION" -t "$LOCAL_IMAGE" .
                '''
            }
        }
        stage('Test') {
            steps {
                sh 'sh tests/smoke.sh "$LOCAL_IMAGE" "$SOURCE_REVISION"'
                sh 'helm lint helm/demo -f environments/dev/values.json && helm template demo helm/demo -f environments/dev/values.json >/dev/null'
            }
        }
        stage('Load configuration & snapshot') {
            when { expression { params.DEPLOY } }
            steps {
                withFolderProperties {
                    script {
                        ['GITOPS_CREDENTIALS_ID', 'ARGOCD_SERVER', 'ARGOCD_CREDENTIALS_ID', 'ARGOCD_CA_CREDENTIALS_ID', 'SMOKE_URL'].each { key ->
                            def value = env[key]?.trim()
                            if (!value || value == 'null') { error "${key} is required in Folder Properties" }
                            env[key] = value
                        }
                    }
                }
                script {
                    if (!(env.ARGOCD_SERVER ==~ /[a-zA-Z0-9.-]+(:[0-9]+)?/)) { error 'ARGOCD_SERVER must be host[:port]' }
                    if (!(env.SMOKE_URL ==~ /https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?/)) { error 'SMOKE_URL must be an HTTP(S) origin without credentials' }
                }
                dir('gitops') {
                    git branch: 'main', credentialsId: env.GITOPS_CREDENTIALS_ID, url: 'https://github.com/Pay2Winn/concung-devops-case-study.git'
                    script { env.GITOPS_BASE = sh(script: 'git rev-parse HEAD', returnStdout: true).trim() }
                    sh 'test "$GITOPS_BASE" = "$SOURCE_REVISION"'
                }
            }
        }
        stage('Push image') {
            when { expression { params.DEPLOY } }
            steps {
                sh '''
                    set -eu
                    mkdir -p .runtime
                    if docker pull --platform=linux/amd64 "$IMAGE_REF" 2>.runtime/pull-error; then
                        test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_REF")" = "$SOURCE_REVISION"
                    else
                        # ponytail: one trusted writer; unknown registry errors stop deployment.
                        grep -Eiq 'manifest unknown|name unknown' .runtime/pull-error || { cat .runtime/pull-error >&2; exit 1; }
                        docker tag "$LOCAL_IMAGE" "$IMAGE_REF"
                        docker push "$IMAGE_REF"
                        docker pull --platform=linux/amd64 "$IMAGE_REF"
                    fi
                    sh tests/smoke.sh "$IMAGE_REF" "$SOURCE_REVISION"
                '''
                script {
                    env.IMAGE_DIGEST = sh(script: '''
                        docker image inspect "$IMAGE_REF" | jq -er --arg prefix "$IMAGE_REPOSITORY@" '
                            [.[0].RepoDigests[] | select(startswith($prefix)) | split("@")[1]] | unique |
                            if length == 1 then .[0] else error("Expected one registry digest") end'
                    ''', returnStdout: true).trim()
                    if (!(env.IMAGE_DIGEST ==~ /sha256:[a-f0-9]{64}/)) { error 'Invalid image digest' }
                }
            }
        }
        stage('Update GitOps') {
            when { expression { params.DEPLOY } }
            steps {
                dir('gitops') {
                    withCredentials([gitUsernamePassword(credentialsId: env.GITOPS_CREDENTIALS_ID, gitToolName: 'Default')]) {
                        sh '''
                            set -eu
                            git fetch --no-tags origin main
                            test "$(git rev-parse FETCH_HEAD)" = "$GITOPS_BASE"
                            values=environments/dev/values.json
                            jq --arg repository "$IMAGE_REPOSITORY" --arg tag "$IMAGE_TAG" --arg digest "$IMAGE_DIGEST" \
                                '.image = {repository: $repository, tag: $tag, digest: $digest}' "$values" > "$values.tmp"
                            mv "$values.tmp" "$values"
                            helm lint helm/demo -f "$values"
                            helm template demo helm/demo -f "$values" >/dev/null
                            git diff --check
                            git add -- "$values"
                            if ! git diff --cached --quiet; then
                                git -c user.name=jenkins -c user.email=jenkins@example.invalid commit -m "Deploy 2048 ${SOURCE_REVISION}"
                            fi
                            git push origin HEAD:refs/heads/main
                        '''
                    }
                    script { env.DEPLOY_REVISION = sh(script: 'git rev-parse HEAD', returnStdout: true).trim() }
                }
            }
        }
        stage('Wait Argo CD & smoke test') {
            when { expression { params.DEPLOY } }
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                withCredentials([
                    string(credentialsId: env.ARGOCD_CREDENTIALS_ID, variable: 'ARGOCD_AUTH_TOKEN'),
                    file(credentialsId: env.ARGOCD_CA_CREDENTIALS_ID, variable: 'ARGOCD_CA_FILE')
                ]) {
                    sh '''
                        set -eu
                        set +x
                        application() {
                            curl --fail --silent --show-error --max-time 15 --cacert "$ARGOCD_CA_FILE" \
                                -H "Authorization: Bearer $ARGOCD_AUTH_TOKEN" \
                                "https://$ARGOCD_SERVER/api/v1/applications/concung-demo?refresh=normal"
                        }
                        healthy() {
                            jq -e -s --arg revision "$DEPLOY_REVISION" '
                                length == 1 and .[0].status.sync.revision == $revision and .[0].status.sync.status == "Synced" and .[0].status.health.status == "Healthy"' >/dev/null
                        }
                        while :; do
                            status=$(application)
                            if printf '%s' "$status" | healthy; then break; fi
                            sleep 5
                        done
                        version=$(curl --fail --silent --show-error --max-time 15 "$SMOKE_URL/version")
                        test -n "$version"
                        printf '%s' "$version" | jq -e --arg revision "$SOURCE_REVISION" '.revision == $revision'
                        page=$(curl --fail --silent --show-error --max-time 15 "$SMOKE_URL/")
                        case "$page" in *2048*) ;; *) exit 1;; esac
                        status=$(application)
                        printf '%s' "$status" | healthy
                    '''
                }
            }
        }
    }
    post {
        success { echo 'Checks passed; deployment is requested only when DEPLOY=true.' }
        failure { echo 'FAILED: inspect the stage. Roll back by restoring the previous image in Git.' }
    }
}
