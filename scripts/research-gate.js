#!/usr/bin/env node
// Offline evidence gate. It checks the record, not the truth of web claims or production readiness.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DAY = 86400000;
const validLead = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const KINDS = ['official-docs', 'release', 'model-card', 'license', 'security', 'benchmark', 'discovery'];
const GATES = ['quality', 'performance', 'security', 'license', 'integration', 'recovery', 'observability'];
const text = x => typeof x === 'string' && x.trim().length > 0;
const list = x => Array.isArray(x) ? x : [];
const label = x => typeof x === 'string' ? x : '[invalid]';
const timestamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
function httpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}

function template({ projectId, briefVersion, lead, topic, now = new Date() }) {
  return {
    schemaVersion: 1, projectId, briefVersion, lead, topic, researchedAt: now.toISOString(),
    status: 'draft', applicability: 'required', notApplicableReason: '',
    policy: { environmentRef: '', hardware: '', requireLocalOpen: false, exceptions: [] },
    discovery: { catalogCheckedAt: null, sourceCommit: null, notes: '' },
    sources: [], candidates: [], comparison: '', singleCandidateReason: '', selectedCandidate: '',
    decision: '', unverified: [], releaseGates: GATES.map(id => ({ id, metric: '', target: '', method: '', owner: '' })),
    review: { by: lead, reviewedAt: null, verdict: 'pending', notes: '' }
  };
}

function validate(record, { projectId, briefVersion, lead, now = new Date() } = {}) {
  const errors = [], warnings = [];
  const need = (ok, message) => { if (!ok) errors.push(message); };
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(nowMs)) return { ok: false, status: 'FAIL', errors: ['Invalid validation clock'], warnings };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, status: 'FAIL', errors: ['Record must be an object'], warnings };
  need(record.schemaVersion === 1, 'schemaVersion must be 1');
  for (const key of ['projectId', 'briefVersion', 'topic']) need(text(record[key]), key + ' is required');
  need(validLead(record.lead), 'Accountable lead needs a stable identifier (letters, digits, _, . or -; at most 80 characters)');
  need(text(projectId) && record.projectId === projectId, 'Expected projectId is required and must match');
  need(text(briefVersion) && record.briefVersion === briefVersion, 'Expected briefVersion is required and must match');
  if (lead) need(record.lead === lead, 'Expected lead does not match');
  function fresh(value, label, days) {
    const at = timestamp(value);
    need(Number.isFinite(at), label + ' must be an ISO timestamp with timezone');
    if (Number.isFinite(at)) {
      need(at <= nowMs + 300000, label + ' is in the future');
      need(nowMs - at <= days * DAY, label + ' is stale; recheck the primary source');
    }
    return at;
  }
  const researchAt = fresh(record.researchedAt, 'researchedAt', 7);
  const review = record.review || {};
  need(review.by === record.lead, 'The accountable Lead must review the research');
  need(text(review.notes), 'Lead review needs an explanation');
  const reviewAt = fresh(review.reviewedAt, 'review.reviewedAt', 7);
  need(reviewAt >= researchAt, 'Review must follow the research record');
  if (record.applicability === 'not-applicable') {
    need(record.status === 'not-applicable' && review.verdict === 'not-applicable', 'Not-applicable needs an explicit Lead verdict');
    need(text(record.notApplicableReason), 'Explain why this task has no AI/technology design decision');
    warnings.push('Not-applicable is a Lead attestation, not automatic scope detection.');
  } else {
    need(record.applicability === 'required', 'applicability must be required or not-applicable');
    need(record.status === 'design-ready' && review.verdict === 'design-ready', 'Research and Lead review must be design-ready');
    need(text(record.policy?.environmentRef) && text(record.policy?.hardware), 'Record environment policy and actual or explicitly declared hardware');
    need(typeof record.policy?.requireLocalOpen === 'boolean', 'policy.requireLocalOpen must explicitly state whether a local/open stack is required');
    need(Array.isArray(record.policy?.exceptions), 'policy.exceptions must list existing authorized exceptions (empty is allowed)');
    for (const e of list(record.policy?.exceptions)) need(e && ['id', 'authority', 'scope'].every(k => text(e[k])), 'Each policy exception needs id, authority and scope');
    const discovery = record.discovery;
    need(discovery && typeof discovery === 'object' && !Array.isArray(discovery) && text(discovery.notes), 'Explain catalog provenance, age or unavailability in discovery.notes');
    if (discovery?.catalogCheckedAt != null) need(Number.isFinite(timestamp(discovery.catalogCheckedAt)) && timestamp(discovery.catalogCheckedAt) <= nowMs + 300000, 'Invalid catalog checked timestamp');
    if (discovery?.sourceCommit != null) need(text(discovery.sourceCommit), 'Catalog commit must be a string or null');
    const sources = new Map();
    for (const s of list(record.sources)) {
      if (!s || typeof s !== 'object') { need(false, 'Invalid source'); continue; }
      const sid = label(s.id);
      need(text(s.id) && !sources.has(s.id), 'Source ids must be unique and nonempty');
      sources.set(s.id, s);
      need(httpsUrl(s.url), 'Source ' + sid + ' needs an HTTPS citation without credentials');
      need(KINDS.includes(s.kind), 'Source ' + sid + ' has an unknown kind');
      const at = fresh(s.checkedAt, 'Source ' + sid, ['license', 'security', 'release'].includes(s.kind) ? 1 : 7);
      need(at <= reviewAt, 'Source ' + sid + ' was checked after Lead review; review again');
      need(text(s.finding), 'Source ' + sid + ' needs the claim it supports');
      if (s.publishedAt) {
        const published = text(s.publishedAt) ? Date.parse(s.publishedAt) : NaN;
        need(Number.isFinite(published) && published <= nowMs, 'Source ' + sid + ' publication date is invalid or future');
        need(published <= at, 'Source ' + sid + ' publication cannot follow its check timestamp');
      }
    }
    const candidates = list(record.candidates), ids = new Set();
    need(candidates.length >= 2 || (candidates.length === 1 && text(record.singleCandidateReason)), 'Compare alternatives, or explain the single feasible candidate');
    need(text(record.comparison) && text(record.decision), 'Record the tradeoff comparison and decision');
    for (const c of candidates) {
      if (!c || typeof c !== 'object') { need(false, 'Invalid candidate'); continue; }
      const cid = label(c.id);
      need(text(c.id) && !ids.has(c.id), 'Candidate ids must be unique and nonempty'); ids.add(c.id);
      for (const key of ['name', 'version', 'fit', 'limitations', 'hardware']) need(text(c[key]), 'Candidate ' + cid + ' needs ' + key);
      need(text(c.version) && !/^(latest|main|master|unknown)$/i.test(c.version.trim()), 'Candidate ' + cid + ' needs an exact artifact version or revision');
      need(['osi-software', 'open-weights', 'source-available', 'proprietary', 'mixed'].includes(c.openness), 'Classify candidate ' + cid + ' openness explicitly');
      need(['offline', 'local-network', 'hybrid', 'cloud'].includes(c.locality), 'Classify candidate ' + cid + ' network requirements');
      const refs = list(c.sourceIds).map(id => sources.get(id));
      need(refs.length > 0 && refs.every(Boolean), 'Candidate ' + cid + ' has missing source references');
      need(refs.some(s => s && ['official-docs', 'model-card'].includes(s.kind)), 'Candidate ' + cid + ' needs primary technical evidence');
      need(refs.some(s => s && s.kind === 'release'), 'Candidate ' + cid + ' needs a current release/revision check');
      const license = c.license || {}, licenseSource = sources.get(license.sourceId);
      for (const key of ['software', 'weights', 'data', 'assessment']) need(text(license[key]), 'Candidate ' + cid + ' license needs ' + key + ' (use explained N/A where appropriate)');
      need(licenseSource?.kind === 'license', 'Candidate ' + cid + ' needs an artifact-specific license source');
      need(['compatible', 'restricted', 'unknown'].includes(license.review), 'Candidate ' + cid + ' needs a license review status');
      if (c.id === record.selectedCandidate) {
        need(license.review === 'compatible', 'Selected artifact license is unresolved or incompatible');
        if (record.policy?.requireLocalOpen && (['cloud', 'hybrid'].includes(c.locality) || ['source-available', 'proprietary', 'mixed'].includes(c.openness))) {
          need(text(c.exceptionRef) && list(record.policy?.exceptions).some(e => e && e.id === c.exceptionRef && text(e.authority) && text(e.scope)), 'Selected nonlocal or restricted stack needs an existing scoped exception reference');
        }
      }
    }
    need(text(record.selectedCandidate) && ids.has(record.selectedCandidate), 'Selected candidate must exist');
    const gates = list(record.releaseGates);
    for (const id of GATES) {
      const g = gates.find(x => x && x.id === id);
      need(g && ['metric', 'target', 'method', 'owner'].every(k => text(g[k])), 'Define measurable release gate: ' + id);
    }
    need(Array.isArray(record.unverified), 'List unverified claims explicitly (empty is allowed)');
    for (const u of list(record.unverified)) {
      need(u && text(u.claim) && text(u.resolution) && text(u.owner) && typeof u.blocksDesign === 'boolean', 'Each unverified claim needs a resolution, owner and blocksDesign boolean');
      need(u?.blocksDesign !== true, 'Resolve design-blocking unknowns before marking design-ready');
    }
    warnings.push('PASS validates evidence structure, freshness and Lead attestation only. Sources, license interpretation and claims require human/Lead inspection; release tests are plans until measured.');
  }
  return { ok: !errors.length, status: errors.length ? 'FAIL' : 'PASS', checkedAt: now.toISOString(), errors, warnings };
}

function args(argv) {
  const opts = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const key = argv[i].slice(2); if (!['project', 'brief', 'lead', 'topic', 'out'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown or missing option: ' + argv[i]); opts[key] = argv[++i]; }
    else positional.push(argv[i]);
  }
  return { opts, positional };
}
function main(argv) {
  const { opts, positional } = args(argv), [command, file] = positional;
  if (command === 'init') {
    if (!opts.project || !opts.brief || !validLead(opts.lead) || !opts.topic || !opts.out) throw new Error('init needs --project ID --brief VERSION --lead LEAD_ID --topic TEXT --out FILE');
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(template({ projectId: opts.project, briefVersion: opts.brief, lead: opts.lead, topic: opts.topic }), null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ created: path.resolve(opts.out), status: 'draft' }));
  } else if (command === 'check' && file) {
    const stat = fs.statSync(file); if (stat.size > 2 * 1024 * 1024) throw new Error('Research packet exceeds 2 MiB');
    const body = fs.readFileSync(file, 'utf8');
    const result = { ...validate(JSON.parse(body), { projectId: opts.project, briefVersion: opts.brief, lead: opts.lead }), sha256: hash(body), file: path.resolve(file) };
    console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
  } else throw new Error('Usage: research-gate.js init [options] | check FILE --project ID --brief VERSION [--lead ID]');
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { validate, template, hash, GATES };
