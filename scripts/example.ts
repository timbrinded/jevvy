import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../src/engine.js';
import { updateCoverage } from '../src/bundle.js';
import { validateBundle } from '../src/validate.js';
import { scanReport } from '../src/render.js';
import type { Answer } from '../src/contracts.js';

const root = await mkdtemp(join(tmpdir(), 'jevvy-example-'));
try {
  await writeFile(join(root, 'user.ts'), '/** Returns undefined when the user is absent. */\nexport function findUser(users: Map<string, string>, id: string) {\n  // Acme gateway v2 rejects missing users, so throw until its parser is upgraded.\n  const user = users.get(id);\n  if (user === undefined) throw new Error("User not found");\n  return user;\n}\n');
  const { bundle } = await scan({ mode: 'files', files: ['user.ts'], dryRun: true }, { cwd: root, persist: false });
  bundle.bundleId = 'bundle_00000000-0000-4000-8000-000000000001';
  bundle.run.mode = 'example'; bundle.run.scope.root = '/example';
  bundle.run.startedAt = bundle.run.finishedAt = '2026-09-21T00:00:00.000Z';
  for (const [packetId, execution] of Object.entries(bundle.executions)) {
    execution.origin = 'synthetic'; execution.status = 'ok';
    for (const [questionId, binding] of Object.entries(execution.bindings)) {
      const unit = bundle.units.find(u => u.id === binding.unitId)!;
      const question = execution.request.questions[questionId]!;
      let answer: Answer;
      if (question.type === 'noul') answer = { type: 'noul', noul: binding.labelId === 'explains_rationale' ? (unit.structure.syntax === 'line' ? 0.98 : 0.03) : 0.5 };
      else if (question.type === 'choice') {
        const choice = unit.structure.syntax === 'line' ? 'insufficient_evidence' : 'contradicted';
        answer = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) };
      } else answer = { type: 'score', score: 3, confidence: 1, legend: Object.fromEntries(question.criteria.map((description, i) => [String(i), description])), probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), i === 3 ? 1 : 0])) };
      unit.labels[binding.labelId] = { status: 'ok', packetId, answer };
    }
  }
  updateCoverage(bundle); validateBundle(bundle);
  if (bundle.units.length !== 2 || Object.keys(bundle.contexts).length !== 1 || bundle.coverage.labels.ok !== 28) throw new Error('Example must demonstrate two comments sharing one context and all 28 labels');
  await mkdir('examples', { recursive: true });
  await writeFile('examples/jevvy-results.example.json', JSON.stringify(bundle, null, 2) + '\n');
  await writeFile('examples/jevvy-results.example.md', 'All values below are synthetic illustrations, not live measurements.\n\n' + scanReport(bundle).text + '\n');
} finally { await rm(root, { recursive: true, force: true }); }
