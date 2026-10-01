import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { lockGuriSource } from '#src/environments/guri/source-lock';
import { guriTool, GURI_TOOL_SCHEMAS } from '#src/environments/guri/tools';
import { sha256 } from '#src/io';
import type { Session } from '#src/environments/session';
export class GuriBridge {
  lastDiagnostic: string | null = null;
  constructor(
    readonly checkout: string,
    readonly runtimeDirectory: string,
    readonly databaseUrl: string,
    readonly clock: string,
  ) {}
  async verify() {
    const source = await lockGuriSource(this.checkout);
    const lock = JSON.parse(
      await readFile(path.join(this.runtimeDirectory, 'source-lock.json'), 'utf8'),
    );
    if (
      lock.revision !== source.revision ||
      lock.schemaHash !== source.schemaHash ||
      lock.workerHash !== sha256(await readFile(path.join(this.runtimeDirectory, 'worker.mjs')))
    )
      throw new Error('GURI_RUNTIME_CHANGED');
  }
  async execute(name: string, arguments_: unknown, session: Session, callId: string) {
    await this.verify();
    const tool = guriTool(name);
    const args = GURI_TOOL_SCHEMAS[tool].parse(arguments_);
    const binding = session.binding(callId, tool, args);
    if (tool === 'create_lead_task') session.requireApproval(callId, tool, args);
    return await new Promise<{ status: string; result: unknown }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(this.runtimeDirectory, 'worker.mjs')], {
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let diagnostic = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('GURI_TIMEOUT: outcome requires independent verification'));
      }, 20_000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 1_000_000) {
          child.kill();
          reject(new Error('GURI_RPC_LIMIT'));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (diagnostic.length < 4000) diagnostic += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        this.lastDiagnostic = diagnostic || null;
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error('GURI_RPC_ERROR'));
        }
      });
      child.stdin.on('error', reject);
      child.stdin.end(
        JSON.stringify({
          tool,
          arguments: args,
          ownerId: session.ownerId,
          sessionId: session.id,
          callId,
          approvalBinding: tool === 'create_lead_task' ? binding : null,
          databaseUrl: this.databaseUrl,
          clock: this.clock,
        }),
      );
    });
  }
}
