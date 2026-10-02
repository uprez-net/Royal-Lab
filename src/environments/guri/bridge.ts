import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { lockGuriSource } from '#src/environments/guri/source-lock';
import { guriTool, GURI_EFFECTS, parseGuriArguments } from '#src/environments/guri/tools';
import { BridgeControlsSchema, type BridgeControls } from '#contracts/operational';
import { sha256 } from '#src/io';
import type { Session } from '#src/environments/session';
export class GuriBridge {
  lastDiagnostic: string | null = null;
  readonly controls: BridgeControls;
  private workerHash: string | null = null;
  private runtimeFingerprint: string | null = null;
  private staleRead: { session: string; owner: string } | null = null;
  constructor(
    readonly checkout: string,
    readonly runtimeDirectory: string,
    readonly databaseUrl: string,
    readonly clock: string,
    controls: unknown = { schemaVersion: '1.0.0' },
  ) {
    this.controls = BridgeControlsSchema.parse(controls);
    if (
      this.controls.mode !== 'offline-control' &&
      (this.controls.staleVersion ||
        this.controls.fault ||
        this.controls.ports.email !== 'unavailable' ||
        this.controls.ports.envelope !== 'unavailable')
    )
      throw new Error('GURI_CONTROL_MODE_REQUIRED');
  }
  async verify() {
    const source = await lockGuriSource(this.checkout);
    const lock = JSON.parse(
      await readFile(path.join(this.runtimeDirectory, 'source-lock.json'), 'utf8'),
    );
    if (
      lock.bridgeVersion !== '2.0.0' ||
      lock.revision !== source.revision ||
      lock.schemaHash !== source.schemaHash ||
      lock.lockfileHash !== source.lockfileHash ||
      lock.generatedClientHash !==
        sha256(await readFile(path.join(this.runtimeDirectory, 'client/index.js'))) ||
      lock.generatedSchemaHash !==
        sha256(await readFile(path.join(this.runtimeDirectory, 'schema.prisma'))) ||
      lock.schemaSqlHash !==
        sha256(await readFile(path.join(this.runtimeDirectory, 'schema.sql'))) ||
      lock.workerHash !== sha256(await readFile(path.join(this.runtimeDirectory, 'worker.mjs')))
    )
      throw new Error('GURI_RUNTIME_CHANGED');
    this.workerHash = lock.workerHash;
    this.runtimeFingerprint = sha256(
      await readFile(path.join(this.runtimeDirectory, 'source-lock.json')),
    );
  }
  async execute(name: string, arguments_: unknown, session: Session, callId: string) {
    await this.verify();
    const tool = guriTool(name);
    const args = parseGuriArguments(tool, arguments_);
    const binding = session.binding(callId, tool, args);
    if (GURI_EFFECTS[tool] === 'mutation') session.requireApproval(callId, tool, args);
    const stale = this.controls.staleVersion;
    if (stale && callId === stale.beforeWriteCallId) {
      if (
        tool !== 'update_project_requirements' ||
        !('projectId' in args) ||
        args.projectId !== stale.projectId ||
        this.staleRead?.session !== session.id ||
        this.staleRead?.owner !== session.ownerId
      )
        throw new Error('CONTROL_SCOPE_MISMATCH');
      const injection = await this.rpc({
        ownerId: session.ownerId,
        sessionId: session.id,
        callId: stale.injectionId,
        control: stale,
        clock: stale.clock,
      });
      if (!['control-applied', 'control-replayed'].includes(injection.status))
        throw new Error('CONTROL_INJECTION_FAILED');
    }
    const response = await this.rpc({
      tool,
      arguments: args,
      ownerId: session.ownerId,
      sessionId: session.id,
      callId,
      approvalBinding: GURI_EFFECTS[tool] === 'mutation' ? binding : null,
      clock: this.clock,
    });
    if (stale && callId === stale.afterReadCallId && response.status === 'success') {
      if (
        tool !== 'get_project_requirements' ||
        !('projectId' in args) ||
        args.projectId !== stale.projectId
      )
        throw new Error('CONTROL_SCOPE_MISMATCH');
      this.staleRead = { session: session.id, owner: session.ownerId };
    }
    return response;
  }
  private async rpc(request: Record<string, unknown>) {
    return await new Promise<{ status: string; result: unknown }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(this.runtimeDirectory, 'worker.mjs')], {
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          NODE_ENV: 'production',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let diagnostic = '';
      let failure: Error | null = null;
      const timer = setTimeout(() => {
        failure = new Error('GURI_TIMEOUT: outcome requires independent verification');
        child.kill();
      }, this.controls.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 1_000_000) {
          failure = new Error('GURI_RPC_LIMIT');
          child.kill();
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (diagnostic.length < 4000) diagnostic += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', () => {
        clearTimeout(timer);
        this.lastDiagnostic = diagnostic || null;
        if (failure) {
          reject(failure);
          return;
        }
        try {
          const parsed = JSON.parse(output);
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !Object.hasOwn(parsed, 'result') ||
            ![
              'success',
              'committed',
              'replayed',
              'stale-version',
              'domain-refusal',
              'unsupported',
              'error',
              'control-applied',
              'control-replayed',
            ].includes(parsed.status)
          )
            throw new Error('Invalid RPC response');
          resolve(parsed);
        } catch {
          reject(new Error('GURI_RPC_ERROR'));
        }
      });
      child.stdin.on('error', reject);
      child.stdin.end(
        JSON.stringify({
          protocolVersion: '2.0.0',
          workerHash: this.workerHash,
          runtimeFingerprint: this.runtimeFingerprint,
          mode: this.controls.mode,
          ...request,
          ports: this.controls.ports,
          fault: this.controls.fault,
          databaseUrl: this.databaseUrl,
        }),
      );
    });
  }
}
