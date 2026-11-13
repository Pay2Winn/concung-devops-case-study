import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ponytail: verifies saved local evidence, not a fresh deployment; rerun the lab for live proof.
const directory = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
const json = name => JSON.parse(read(name));
const build = json('jenkins-build.json');
const deployment = json('deployment-result.json');
const kubernetes = json('kubernetes-checks.json');
const browser = json('browser-smoke.json');
const consoleText = read('jenkins-console.log');
assert.equal(build.result, 'SUCCESS');
assert.equal(build.building, false);
assert(build.actions.flatMap(a => a.parameters ?? []).some(p => p.name === 'DEPLOY' && p.value === false));
assert.equal(build.actions.find(a => a.lastBuiltRevision)?.lastBuiltRevision.SHA1, deployment.sourceRevision);
assert.match(deployment.sourceRevision, /^[a-f0-9]{40}$/);
assert.match(deployment.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(deployment.method, 'Manual Helm; not Jenkins deploy');
assert.equal(deployment.context, 'kind-concung-demo');
assert(consoleText.includes('PASS: game, assets, license, health, revision and private path'));
assert(consoleText.includes('1 chart(s) linted, 0 chart(s) failed'));
assert(/\[2026-11-12T[\d:.]+Z\]/.test(consoleText));
for (const stage of ['Load configuration & snapshot', 'Push image', 'Update GitOps', 'Wait Argo CD & smoke test']) {
  assert(consoleText.includes(`Stage "${stage}" skipped due to when conditional`));
}
assert.equal(kubernetes.deployment.readyReplicas, 2);
assert.equal(kubernetes.deployment.availableReplicas, 2);
assert.equal(kubernetes.pods.length, 2);
for (const pod of kubernetes.pods) {
  assert.equal(pod.ready, true);
  assert.equal(pod.restartCount, 0);
  assert(pod.imageID.endsWith('@' + deployment.digest));
  assert.equal(pod.version.revision, deployment.sourceRevision);
  assert.equal(pod.version.environment, 'dev');
}
assert.equal(kubernetes.http['/health'].status, 200);
assert.equal(kubernetes.http['/version'].body.revision, deployment.sourceRevision);
assert.equal(browser.http['/version'].body.revision, deployment.sourceRevision);
assert.equal(browser.http['/.git/config'].status, 403);
assert.equal(browser.stateChanged, true);
assert(browser.after.score > browser.before.score);
assert.equal(browser.mobile.noHorizontalOverflow, true);
assert.equal(browser.mobile.tilesWithinBoardAfterReload, true);
assert(json('jenkins-plugins.json').plugins.some(p => p.shortName === 'timestamper' && p.active));
assert.equal(json('jenkins-security.json').anonymousStatus, 403);
assert.equal(json('jenkins-security.json').authenticatedStatus, 200);
const argo = json('argocd-result.json');
assert.equal(argo.githubWrite, false);
assert.equal(argo.helmOperationsFrozen, true);
assert.equal(argo.tlsVerified, true);
assert.equal(argo.sourceRevision, deployment.sourceRevision);
assert.equal(argo.imageDigest, deployment.digest);
assert.equal(argo.application.sync, 'Synced');
assert.equal(argo.application.health, 'Healthy');
assert.equal(argo.application.operationPhase, 'Succeeded');
assert.equal(argo.application.syncRevision, deployment.sourceRevision);
assert.equal(argo.application.operationRevision, deployment.sourceRevision);
assert.equal(argo.application.resources.length, 3);
assert(argo.application.resources.every(r => r.status === 'Synced'));
assert.equal(argo.resourceIdentities.length, 3);
assert(argo.resourceIdentities.every(r => r.preserved));
const parameters = Object.fromEntries(argo.application.source.helm.parameters.map(p => [p.name, p.value]));
assert.equal(parameters['image.tag'], deployment.sourceRevision.slice(0, 12));
assert.equal(parameters['image.digest'], deployment.digest);
assert.equal(argo.http.version.revision, deployment.sourceRevision);
assert.equal(argo.pods.length, 2);
assert(argo.pods.every(p => p.ready && p.imageID.endsWith('@' + deployment.digest)));
for (const [permission, value] of Object.entries(argo.permissions)) {
  assert.equal(value, permission === 'get:concung-demo/concung-demo' ? 'yes' : 'no');
}
const agent = json('argocd-agent-check.json');
assert.equal(agent.certificateVerified, true);
assert.equal(agent.revision, deployment.sourceRevision);
assert.equal(agent.statusBeforeAndAfterSmoke, 'Synced/Healthy');
assert.equal(agent.exitCode, 0);
assert(read('argocd-agent-check.log').includes('PASS: actual Jenkins agent verified TLS'));
const hashes = json('sha256.json');
assert.deepEqual(Object.keys(hashes).sort(), fs.readdirSync(directory).filter(n => n !== 'sha256.json').sort());
for (const [name, expected] of Object.entries(hashes)) {
  assert.equal(path.basename(name), name, 'Manifest paths must be simple filenames');
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex'), expected, name);
}
console.log('PASS: saved Jenkins build/test, separate Helm/Argo checks, revision/digest, browser checks and checksums');
