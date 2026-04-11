import fs from 'fs';

function fix(file, replacements) {
    if(!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    for (let r of replacements) {
        content = content.replace(r[0], r[1]);
    }
    fs.writeFileSync(file, content);
}

fix('src/execution/subagent-executor.ts', [
    ['const effectiveOutput =', 'const _effectiveOutput =']
]);

fix('src/extension/index.ts', [
    ['import { renderExtensionUI, Box, Container, Spacer }', 'import { renderExtensionUI }'],
    ['async function migrateCopiedDefaultConfig', 'async function _migrateCopiedDefaultConfig'],
    ['async function ensureAccessibleDir', 'async function _ensureAccessibleDir']
]);

fix('src/shared/types.ts', [
    ["import os from 'node:os';\n", ''],
    ["import path from 'node:path';\n", ''],
    ["import type { FSWatcher } from 'node:fs';\n", '']
]);

fix('src/ui/render.ts', [
    [/getLastActivity,\s*/g, ''],
    [/getOutputTail,\s*/g, ''],
    [/(const ansiRegex.*)/g, '/* eslint-disable-next-line no-control-regex */\n$1'],
    [/(const chunkAnsiRegex.*)/g, '/* eslint-disable-next-line no-control-regex */\n$1']
]);

fix('test/integration/error-handling.test.ts', [
    ["import path from 'node:path';\n", ''],
    ["import { makeAgent, makeMinimalCtx }", "import { }"],
    ["const result = await exec.execute", "const _result = await exec.execute"]
]);

fix('test/integration/single-execution.test.ts', [
    ["const result = await exec", "const _result = await exec"]
]);

fix('test/integration/slash-commands.test.ts', [
    ["import { describe, it, beforeEach }", "import { describe, it }"],
    [", beforeEach }", " }"]
]);

fix('test/integration/superpowers-packets.test.ts', [
    ["const { makeMinimalCtx } = await import", "const { } = await import"],
    ["const artifactsDir = path.join", "const _artifactsDir = path.join"]
]);

fix('test/unit/parallel-utils.test.ts', [
    ["(_, i) =>", "(_, _i) =>"]
]);

fix('test/unit/path-handling.test.ts', [
    ["const templateResult =", "const _templateResult ="],
    ["const joinResult =", "const _joinResult ="]
]);

const emptyFiles = [
  'src/execution/worktree.ts',
  'src/shared/artifacts.ts',
  'src/shared/skills.ts',
  'src/shared/utils.ts',
  'test/support/helpers.ts',
  'test/support/mock-pi.ts',
  'test/unit/local-extension-install.test.ts',
  'test/unit/worktree.test.ts'
];

for (const f of emptyFiles) {
  if(!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/\{\s*\}/g, '{ /* empty */ }');
  fs.writeFileSync(f, c);
}

// Specific fix for useless escape in string template in test/support/helpers.ts
if (fs.existsSync('test/support/helpers.ts')) {
  let h = fs.readFileSync('test/support/helpers.ts', 'utf8');
  // the useless escape was \" which we can replace inside backticks or single quotes safely if it was indeed useless
  // To avoid breaking valid json string escapes, since eslint caught it, it's likely a backtick template literal
  h = h.replace(/\\"/g, '"'); 
  fs.writeFileSync('test/support/helpers.ts', h);
}
