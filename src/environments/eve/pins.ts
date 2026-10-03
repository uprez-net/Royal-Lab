import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';
import type { EveDeployment } from '#contracts/eve';

const exec = promisify(execFile);

// Derive Royal Eve deployment pins from the committed tree of a product
// checkout (git objects, not the working tree), and check that the profile's
// model, case tools and never-approve list still hold at that commit. Read-only:
// nothing in the checkout is changed and no environment file is loaded.
const PROMPT =
  /^agent\/(instructions\.md|instructions\/.+|skills\/.+|subagents\/[^/]+\/(instructions\.md|instructions\/.+|skills\/.+))$/;
const TOOL = /^agent\/(tools\/.+|subagents\/[^/]+\/tools\/.+)$/;

export async function deriveEvePins(checkout: string, commit: string, deployment: EveDeployment) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('EVE_PIN_COMMIT_INVALID');
  const git = async (...args: string[]) =>
    (await exec('git', ['-C', checkout, ...args], { windowsHide: true, maxBuffer: 64 << 20 }))
      .stdout;
  const resolved = (await git('rev-parse', `${commit}^{commit}`)).trim();
  if (resolved !== commit) throw new Error('EVE_PIN_COMMIT_NOT_FOUND');
  const tree = (await git('ls-tree', '-r', commit, 'agent'))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { path: path!, blob: meta!.split(' ')[2]! };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const prompts = tree.filter((item) => PROMPT.test(item.path));
  const tools = tree.filter((item) => TOOL.test(item.path));
  if (!prompts.length || !tools.length) throw new Error('EVE_PIN_TREE_UNEXPECTED');
  const show = (file: string) => git('show', `${commit}:${file}`);
  const findings: string[] = [];
  const model = (await show('lib/agent/model.ts')).match(/OPERATIONS_MODEL\s*=\s*"([^"]+)"/)?.[1];
  if (model !== deployment.model)
    findings.push(`Model at commit is ${JSON.stringify(model)}, profile pins ${deployment.model}`);
  for (const item of deployment.supportedCases)
    if (
      !tools.some(
        (entry) =>
          entry.path
            .split('/')
            .at(-1)!
            .replace(/\.tsx?$/, '') === item.tool,
      )
    )
      findings.push(`Case ${item.id} tool ${item.tool} not found in the tool catalogue`);
  const fixtures = await show('evals/data/fixtures.ts');
  const block = fixtures.match(/NEVER_APPROVE_ON_STAGING\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  const productList = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!).sort();
  const profileList = [...deployment.neverApprove].sort();
  if (stableJson(productList) !== stableJson(profileList))
    findings.push(
      `Never-approve list differs: product ${productList.join(',')} vs profile ${profileList.join(',')}`,
    );
  return {
    agentCommit: commit,
    promptsHash: sha256(stableJson(prompts)),
    toolCatalogueHash: sha256(stableJson(tools)),
    counts: { promptFiles: prompts.length, toolFiles: tools.length },
    model: model ?? null,
    findings,
  };
}
