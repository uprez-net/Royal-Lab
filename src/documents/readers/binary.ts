import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { boundedBytes, READER_LIMITS, UnitSchema } from '#src/documents/normalize';

const Reply = z.strictObject({
  parser: z.string(),
  units: z.array(UnitSchema),
  gaps: z.array(z.string()),
});
export interface BinaryParser {
  image: string;
  imageId: string;
  timeoutMs?: number | undefined;
}
export function parserDockerArguments(config: BinaryParser, name: string): string[] {
  if (!/^sha256:[a-f0-9]{64}$/.test(config.imageId))
    throw new Error('PARSER_UNPINNED: image ID must be immutable');
  return [
    'run',
    '--rm',
    '--name',
    name,
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=65534:65534',
    '--memory=256m',
    '--memory-swap=256m',
    '--cpus=1',
    '--pids-limit=32',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    '-i',
    config.imageId,
  ];
}
export async function readBinary(bytes: Uint8Array, mediaType: string, config: BinaryParser) {
  boundedBytes(bytes);
  const name = `royal-parser-${randomUUID()}`;
  const args = parserDockerArguments(config, name);
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const fail = (message: string) => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new Error(message));
        }
      };
      const timer = setTimeout(
        () => fail('PARSER_TIMEOUT: isolated worker exceeded its deadline'),
        config.timeoutMs ?? 20_000,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) > READER_LIMITS.normalizedBytes * 2)
          fail('PARSER_LIMIT: worker output too large');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        fail('PARSER_UNAVAILABLE: Docker worker could not start');
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        code === 0
          ? resolve(stdout)
          : reject(new Error(`PARSER_ERROR: worker exited ${code}; ${stderr.slice(0, 300)}`));
      });
      child.stdin.on('error', () => fail('PARSER_ERROR: worker input closed'));
      child.stdin.end(
        JSON.stringify({ mediaType, content: Buffer.from(bytes).toString('base64') }),
      );
    });
    return Reply.parse(JSON.parse(raw));
  } finally {
    // Kill only the uniquely named worker created for this request, including after client timeout.
    await new Promise<void>((resolve) => {
      const cleanup = spawn('docker', ['rm', '-f', name], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => {
        cleanup.kill();
        resolve();
      }, 5000);
      cleanup.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
      cleanup.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
