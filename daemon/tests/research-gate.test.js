const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validate, template, hash, GATES } = require('../../scripts/research-gate');

const now = new Date('2026-09-26T03:00:00Z');
const options = { projectId: 'thai-retrieval', briefVersion: 'v2', lead: 'engineering-lead', now };
function packet() {
  const p = template({ ...options, topic: 'Thai retrieval', now: new Date('2026-09-26T01:00:00Z') });
  p.status = 'design-ready';
  p.policy.environmentRef = 'workspace/project-policy.md';
  p.policy.hardware = 'Declared test workstation; verify available memory before benchmarking';
  p.discovery.notes = 'Synthetic test; no live catalog was fetched.';
  p.sources = [
    { id: 'docs', kind: 'official-docs', url: 'https://example.org/docs', finding: 'Synthetic fixture: offline retrieval supported', checkedAt: '2026-09-26T01:10:00Z' },
    { id: 'release', kind: 'release', url: 'https://example.org/releases/1.2', finding: 'Synthetic fixture version 1.2', checkedAt: '2026-09-26T01:15:00Z' },
    { id: 'license', kind: 'license', url: 'https://example.org/1.2/license', finding: 'Synthetic fixture MIT software license', checkedAt: '2026-09-26T01:20:00Z' }
  ];
  p.candidates = ['baseline', 'challenger'].map(id => ({
    id, name: id, version: '1.2', openness: 'osi-software', locality: 'offline',
    fit: 'Local document retrieval', limitations: 'Thai quality unmeasured', hardware: 'CPU baseline; measure target workload',
    sourceIds: ['docs', 'release'], license: { software: 'MIT (synthetic)', weights: 'N/A: no model in fixture', data: 'User corpus rights separately reviewed', sourceId: 'license', review: 'compatible', assessment: 'Synthetic fixture only' }
  }));
  p.comparison = 'Retain the baseline until the challenger demonstrates better retrieval at the same latency.';
  p.selectedCandidate = 'baseline'; p.decision = 'Design around baseline interfaces and a measured evaluation contract.';
  p.releaseGates = GATES.map(id => ({ id, metric: id + ' contract', target: 'All specified cases pass', method: 'Run the project acceptance suite', owner: 'evaluator' }));
  p.review = { by: 'engineering-lead', reviewedAt: '2026-09-26T02:00:00Z', verdict: 'design-ready', notes: 'Synthetic fixture' };
  return p;
}
const check = p => validate(p, options);

test('current scoped evidence passes without pretending to certify production', () => {
  const result = check(packet());
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.match(result.warnings.join(' '), /release tests are plans/);
});
test('new draft cannot pass without actual evidence', () => {
  const result = check(template({ ...options, topic: 'Thai retrieval', now }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('design-ready')));
});
test('research from a different project or requirements revision cannot authorize this design', () => {
  for (const key of ['projectId', 'briefVersion', 'lead']) {
    const p = packet(); p[key] = 'different';
    assert.equal(check(p).ok, false, key);
  }
  assert.equal(validate(packet(), { now }).ok, false, 'Expected binding cannot be omitted');
});
test('same-week catalog and technical evidence cannot compensate for stale release/license/security', () => {
  for (const kind of ['release', 'license', 'security']) {
    const p = packet(); p.sources.push({ id: 'stale-' + kind, kind, url: 'https://example.org/fact', finding: 'old evidence', checkedAt: '2026-09-24T02:00:00Z' });
    assert.ok(check(p).errors.some(e => e.includes('stale')), kind);
  }
});
test('technical evidence and reviews expire after seven days', () => {
  const p = packet(); p.sources[0].checkedAt = '2026-09-18T02:00:00Z';
  assert.equal(check(p).ok, false);
  assert.equal(validate(packet(), { ...options, now: new Date('2026-10-05T03:00:00Z') }).ok, false);
});
test('future dates and review preceding research/source checks fail', () => {
  for (const edit of [
    p => p.researchedAt = '2026-10-01T00:00:00Z',
    p => p.review.reviewedAt = '2026-09-26T00:00:00Z',
    p => p.sources[0].checkedAt = '2026-09-26T02:30:00Z',
    p => p.sources[0].publishedAt = '2026-09-26T02:30:00Z',
    p => p.sources[0].publishedAt = '2027-01-01'
  ]) { const p = packet(); edit(p); assert.equal(check(p).ok, false); }
});
test('discovery-only sources, aliases and missing license evidence are insufficient', () => {
  for (const edit of [
    p => p.sources.forEach(s => s.kind = 'discovery'),
    p => p.candidates[0].version = 'latest',
    p => p.candidates[0].license.sourceId = 'missing',
    p => p.candidates[0].sourceIds = ['missing'],
    p => p.candidates[0].license.review = 'unknown'
  ]) { const p = packet(); edit(p); assert.equal(check(p).ok, false); }
});
test('URLs containing credentials or non-HTTPS schemes are rejected', () => {
  for (const url of ['file:///secret', 'javascript:alert(1)', 'https://user:password@example.org']) {
    const p = packet(); p.sources[0].url = url; assert.equal(check(p).ok, false);
  }
});
test('selected nonlocal/restricted options need scoped existing exception evidence', () => {
  const p = packet(); p.policy.requireLocalOpen = true; p.candidates[0].locality = 'hybrid';
  assert.equal(check(p).ok, false);
  p.candidates[0].exceptionRef = 'owner-decision-123';
  p.policy.exceptions = [{ id: 'owner-decision-123', authority: 'Synthetic owner decision reference', scope: 'Synthetic selected service for this project' }];
  assert.equal(check(p).ok, true);
  p.candidates[0].license.review = 'restricted';
  assert.equal(check(p).ok, false, 'Exception does not resolve incompatible license');
});

test('lead identity and local/open requirements come from the project rather than a fixed office roster', () => {
  const p = packet(); p.lead = p.review.by = 'design.review-42';
  p.candidates[0].locality = 'cloud'; p.candidates[0].openness = 'proprietary';
  assert.equal(validate(p, { ...options, lead: p.lead }).ok, true);
  p.policy.requireLocalOpen = true;
  assert.equal(validate(p, { ...options, lead: p.lead }).ok, false);
  p.policy.requireLocalOpen = 'false';
  assert.equal(validate(p, { ...options, lead: p.lead }).ok, false);
  for (const lead of ['', '../lead', 'has spaces', 'a'.repeat(81)]) {
    p.lead = p.review.by = lead;
    assert.equal(validate(p, { ...options, lead }).ok, false);
  }
});
test('comparison and full task release plan are required', () => {
  const p = packet(); p.candidates.pop();
  assert.equal(check(p).ok, false);
  p.singleCandidateReason = 'Synthetic constrained environment has one installed candidate';
  assert.equal(check(p).ok, true);
  p.releaseGates.pop(); assert.equal(check(p).ok, false);
});
test('missing selected candidate and duplicate references fail', () => {
  for (const edit of [
    p => p.selectedCandidate = 'absent',
    p => p.sources.push(p.sources[0]),
    p => p.candidates.push(p.candidates[0])
  ]) { const p = packet(); edit(p); assert.equal(check(p).ok, false); }
});
test('proportionate not-applicable record still requires current Lead review and scope', () => {
  const p = template({ ...options, topic: 'Correct punctuation only', now });
  p.applicability = p.status = 'not-applicable'; p.notApplicableReason = 'Only punctuation; no technology selection or design change.';
  p.review = { by: 'engineering-lead', reviewedAt: now.toISOString(), verdict: 'not-applicable', notes: 'Reviewed punctuation-only scope.' };
  assert.equal(check(p).ok, true);
  p.notApplicableReason = ''; assert.equal(check(p).ok, false);
});
test('malformed records fail without a parser crash', () => {
  for (const value of [null, [], 'text', 7, {}, { ...packet(), sources: [null], candidates: [null] }]) assert.equal(check(value).ok, false);
});
test('malformed field types and padded mutable aliases fail without throwing', () => {
  for (const edit of [
    p => p.sources[0].id = { toString: null },
    p => p.sources[0].publishedAt = { toString: null },
    p => p.candidates[0].id = { toString: null },
    p => p.candidates[0].version = { toString: null },
    p => p.candidates[0].version = ' main ',
    p => p.policy.exceptions = [null],
    p => delete p.discovery,
    p => delete p.review.notes,
    p => p.unverified = [{ claim: 'Unknown required capability', resolution: 'Check official docs', owner: 'engineering-lead', blocksDesign: true }]
  ]) { const p = packet(); edit(p); assert.equal(check(p).ok, false); }
  assert.equal(validate(packet(), { ...options, now: new Date('invalid') }).ok, false);
});
test('evidence hash changes when its decision changes', () => {
  const p = packet(), before = hash(JSON.stringify(p)); p.decision = 'different';
  assert.notEqual(hash(JSON.stringify(p)), before);
});
test('CLI creates non-overwriting drafts and returns failing exit status for a draft', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-research-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'packet.json'), cli = path.resolve(__dirname, '../../scripts/research-gate.js');
  const args = [cli, 'init', '--project', 'p', '--brief', 'v1', '--lead', 'engineering-lead', '--topic', 'test', '--out', file];
  assert.equal(spawnSync(process.execPath, args).status, 0);
  assert.equal(spawnSync(process.execPath, args).status, 1);
  const result = spawnSync(process.execPath, [cli, 'check', file, '--project', 'p', '--brief', 'v1'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'FAIL');
});
