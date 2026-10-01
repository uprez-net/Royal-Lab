import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { discover, type DiscoveredTask } from '#tasks/discover';
import { preflight } from '#tasks/validate';
import { lint } from '#fixtures/lint';
import { sydneyTime } from '#fixtures/clock';
import { readJson } from '#src/io';
import path from 'node:path';

const colors = {
  accent: '#AD9BFF',
  gold: '#F1C77D',
  muted: '#8C95AA',
  ink: '#E9EDF6',
  good: '#80D5B5',
  border: '#39405A',
};
const menu = ['Overview', 'Case library', 'Validate suites', 'Check fixtures', 'Configuration'];
export const cleanTerminalText = (text: string) =>
  text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export function wrapTerminalText(text: string, columns: number): string[] {
  return cleanTerminalText(text)
    .split('\n')
    .flatMap((line) => {
      const characters = [...line.replace(/\t/g, '  ')];
      const lines: string[] = [];
      while (characters.length > columns) {
        const prefix = characters.slice(0, columns).join('');
        const boundary = prefix.lastIndexOf(' ');
        const length = boundary > columns / 2 ? boundary : columns;
        lines.push(characters.splice(0, length).join(''));
        if (characters[0] === ' ') characters.shift();
      }
      lines.push(characters.join(''));
      return lines;
    });
}
function Badge({ children, color = colors.accent }: { children: React.ReactNode; color?: string }) {
  return (
    <Box marginRight={2}>
      <Text color={color}>● </Text>
      <Text color={colors.muted}>{children}</Text>
    </Box>
  );
}
function Stat({ value, label, compact }: { value: string; label: string; compact: boolean }) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={colors.border}
      paddingX={2}
      paddingY={compact ? 0 : 1}
    >
      <Text color={colors.gold} bold>
        {value}
      </Text>
      <Text color={colors.muted}>{label}</Text>
    </Box>
  );
}
export function Workbench({
  root,
  terminalWidth,
  terminalHeight,
}: {
  root: string;
  terminalWidth?: number;
  terminalHeight?: number;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [width, setWidth] = useState(terminalWidth ?? stdout.columns ?? 100);
  const [height, setHeight] = useState(terminalHeight ?? stdout.rows ?? 30);
  const [active, setActive] = useState(0);
  const [caseIndex, setCaseIndex] = useState(0);
  const [tasks, setTasks] = useState<DiscoveredTask[]>([]);
  const [definitionCount, setDefinitionCount] = useState(28);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready. Your workbench is offline.');
  const [checks, setChecks] = useState<string[]>([]);
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    const resize = () => {
      setWidth(terminalWidth ?? stdout.columns ?? 100);
      setHeight(terminalHeight ?? stdout.rows ?? 30);
    };
    stdout.on('resize', resize);
    discover(root)
      .then(setTasks)
      .catch((e: unknown) => setNotice(cleanTerminalText(String(e))));
    readJson(path.join(root, 'scope/catalogue.json'))
      .then((data) => setDefinitionCount((data as { definitions: unknown[] }).definitions.length))
      .catch(() => {});
    return () => {
      stdout.off('resize', resize);
    };
  }, [root, stdout, terminalWidth, terminalHeight]);
  const runCheck = async (fixtures: boolean) => {
    setBusy(true);
    setScroll(0);
    setNotice(fixtures ? 'Checking fictional worlds…' : 'Checking every selected case…');
    try {
      if (fixtures) {
        const result = await lint(root);
        setChecks(
          result.valid
            ? [
                'PASS  Privacy patterns',
                'PASS  Entity references',
                'PASS  Version conflicts',
                'REVIEW  Human business review remains pending',
              ]
            : result.findings.map((f) => `FAIL  ${f.file}: ${f.rule}`),
        );
      } else {
        const results = await Promise.all(
          ['development', 'held-out'].map((split) => preflight(root, `suites/${split}.json`)),
        );
        setChecks(
          results.flatMap((r) => [
            `${r.valid ? 'PASS' : 'FAIL'}  ${r.suite.id} / offline integrity`,
            ...r.cases.map(
              (c) => `  ${c.status.toUpperCase()}  ${c.taskId}${c.reason ? `: ${c.reason}` : ''}`,
            ),
            ...r.errors,
          ]),
        );
      }
      setNotice('Checks complete. Integrity checks do not produce model scores.');
    } catch (e: unknown) {
      setChecks([`FAIL  ${cleanTerminalText(String(e))}`]);
      setNotice('Check failed. Review the evidence.');
    } finally {
      setBusy(false);
    }
  };
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (busy) return;
    if (key.escape) {
      setDetail(false);
      setScroll(0);
      setChecks([]);
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      setActive((n) => (n + (key.leftArrow ? menu.length - 1 : 1)) % menu.length);
      setDetail(false);
      setScroll(0);
      setChecks([]);
      return;
    }
    if (key.upArrow || key.downArrow || input === 'j' || input === 'k') {
      const direction = key.upArrow || input === 'k' ? -1 : 1;
      if (detail)
        setScroll((n) =>
          Math.max(0, Math.min(n + direction, wrappedDetails.length - availableLines)),
        );
      else if (active === 1)
        setCaseIndex((n) => Math.max(0, Math.min(tasks.length - 1, n + direction)));
      else if ((active === 2 || active === 3) && checks.length > 0)
        setScroll((n) => Math.max(0, Math.min(n + direction, checkLines.length - checkLineCount)));
      else setActive((n) => (n + direction + menu.length) % menu.length);
    }
    if (key.return) {
      if (active === 1) setDetail(true);
      if (active === 2 || active === 3) void runCheck(active === 3);
    }
  });
  const narrow = width < 85;
  const compact = height < 34;
  const selected = tasks[caseIndex]?.task;
  const availableLines = Math.max(5, height - (narrow ? 16 : 14));
  const casesPerPage = Math.max(1, Math.floor(availableLines / 3));
  const firstCase = Math.max(0, caseIndex - casesPerPage + 1);
  const contentColumns = Math.max(10, Math.min(width - 1, 124) - (narrow ? 8 : 34));
  const detailLines = selected
    ? [
        selected.id,
        '',
        selected.instruction,
        '',
        `Clock: ${sydneyTime(selected.clock).localDate} ${sydneyTime(selected.clock).localTime} Sydney`,
        `Profile: ${selected.profiles.join(', ')}   World: ${selected.worldId}`,
        '',
        'SOURCE PACK',
        ...selected.inputs.map((i) => `  ${i.id} → ${i.path}`),
        '',
        'DELIVERABLES',
        ...selected.deliverables.map((d) => `  ${d.path} — ${d.description}`),
        '',
        'Review: DRAFT • Execution: not available yet',
      ]
    : [];
  const wrappedDetails = detailLines.flatMap((line) => wrapTerminalText(line, contentColumns));
  const checkLines = checks.flatMap((line) => wrapTerminalText(line, contentColumns));
  const checkLineCount = Math.max(1, availableLines - 3);
  return (
    <Box width={Math.max(20, Math.min(width - 1, 124))} flexDirection="column" paddingX={1}>
      <Box paddingY={compact ? 0 : 1} justifyContent="space-between">
        <Box flexDirection="column">
          <Text color={colors.accent} bold>
            R O Y A L <Text color={colors.gold}>/ L A B</Text>
          </Text>
          <Text color={colors.muted}>The construction intelligence workbench</Text>
        </Box>
        {!narrow && (
          <Box alignItems="center">
            <Text color={colors.gold}>PRIVATE · v0.1</Text>
          </Box>
        )}
      </Box>
      <Box marginBottom={compact ? 0 : 1}>
        <Badge>NSW residential</Badge>
        <Badge color={colors.good}>Offline authoring</Badge>
        {!narrow && <Badge color={colors.gold}>Foundation</Badge>}
      </Box>
      <Box flexDirection={narrow ? 'column' : 'row'}>
        <Box
          flexDirection={narrow ? 'row' : 'column'}
          width={narrow ? undefined : 24}
          marginRight={narrow ? 0 : 2}
          borderStyle="round"
          borderColor={colors.border}
          paddingX={1}
          paddingY={narrow || compact ? 0 : 1}
        >
          {menu.map((item, i) => (
            <Box key={item} marginRight={narrow ? 1 : 0} paddingY={narrow || compact ? 0 : 1}>
              <Text bold={active === i} color={active === i ? colors.accent : colors.muted}>
                {active === i ? '› ' : '  '}
                {narrow ? ['Home', 'Cases', 'Validate', 'Fixtures', 'Setup'][i] : item}
              </Text>
            </Box>
          ))}
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          minHeight={Math.min(18, availableLines + 3)}
          borderStyle="round"
          borderColor={colors.border}
          paddingX={2}
          paddingY={compact ? 0 : 1}
        >
          <Text color={colors.ink} bold wrap="truncate-end">
            {detail && selected ? cleanTerminalText(selected.title) : menu[active]}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {active === 0 && (
              <>
                {!compact && (
                  <Text color={colors.muted}>From evidence to dependable builder decisions.</Text>
                )}
                <Box marginY={compact ? 0 : 1} gap={1}>
                  <Stat
                    value={String(definitionCount)}
                    label="task definitions"
                    compact={compact}
                  />
                  <Stat value={String(tasks.length)} label="draft cases" compact={compact} />
                  {!narrow && <Stat value="57" label="audited tools" compact={compact} />}
                </Box>
                <Text color={colors.ink}>Documents Fixed tools Royal Eve</Text>
                <Text color={colors.muted}>Separate experiments. Shared evidence standards.</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color={colors.gold}>NEXT Review synthetic cases and business policy</Text>
                  {!compact && (
                    <Text color={colors.muted}>
                      Candidate execution and grading arrive in later issues.
                    </Text>
                  )}
                  <Text color={colors.muted}>No model runs or scores have been recorded.</Text>
                </Box>
              </>
            )}
            {active === 1 &&
              !detail &&
              tasks.slice(firstCase, firstCase + casesPerPage).map(({ task }) => (
                <Box key={task.id} flexDirection="column" marginBottom={1}>
                  <Text
                    color={selected?.id === task.id ? colors.accent : colors.ink}
                    wrap="truncate-end"
                  >
                    {selected?.id === task.id ? '› ' : '  '}
                    {task.definitionId} {cleanTerminalText(task.title)}
                  </Text>
                  <Text color={colors.muted}> {task.worldId} · draft · documents</Text>
                </Box>
              ))}
            {active === 1 &&
              detail &&
              wrappedDetails.slice(scroll, scroll + availableLines).map((line, i) => (
                <Text key={i} color={colors.muted}>
                  {cleanTerminalText(line)}
                </Text>
              ))}
            {(active === 2 || active === 3) && (
              <>
                <Text color={colors.muted}>
                  {active === 2
                    ? 'Preflight every selected case. Never silently skip a fixture.'
                    : 'Check synthetic identities, references and frozen worlds.'}
                </Text>
                <Box marginY={1}>
                  <Text color={colors.accent}>
                    {busy
                      ? '◌ Working…'
                      : checks.length
                        ? 'Enter recheck · ↑↓ scroll results'
                        : 'Press Enter to check'}
                  </Text>
                </Box>
                {checkLines.slice(scroll, scroll + checkLineCount).map((line, i) => (
                  <Text
                    key={i}
                    color={
                      line.startsWith('FAIL')
                        ? 'red'
                        : line.startsWith('PASS')
                          ? colors.good
                          : colors.muted
                    }
                  >
                    {cleanTerminalText(line)}
                  </Text>
                ))}
              </>
            )}
            {active === 4 && (
              <>
                <Text color={colors.good}>Ready now: no keys, database or deployment needed.</Text>
                <Box marginY={1} flexDirection="column">
                  <Text color={colors.ink}>When model execution is added:</Text>
                  <Text color={colors.muted}> Candidate provider + exact model/settings</Text>
                  <Text color={colors.muted}> Provider credential configured locally</Text>
                  <Text color={colors.muted}> Judge models + candidate/judge spend caps</Text>
                  <Text color={colors.muted}> Named reviewer + approved policy/case packs</Text>
                </Box>
                <Text color={colors.gold}>Setup guide → docs/configuration.md</Text>
              </>
            )}
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.muted}>{cleanTerminalText(notice)}</Text>
      </Box>
      <Box marginY={compact ? 0 : 1}>
        <Text color={colors.accent}>
          {narrow
            ? '↑↓ move · Tab section · Enter open · Esc back · q quit'
            : '↑↓ navigate   Tab / ←→ section   Enter inspect / check   Esc back   q quit'}
        </Text>
      </Box>
    </Box>
  );
}
export async function launchTui(root: string) {
  const app = render(<Workbench root={root} />, {
    alternateScreen: true,
    incrementalRendering: true,
  });
  await app.waitUntilExit();
}
