import fs from 'fs';

function fix(file, replacements) {
    if(!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    for (let r of replacements) {
        content = content.replace(r[0], r[1]);
    }
    fs.writeFileSync(file, content);
}

fix('install.mjs', [
    [/(catch\s*\(\s*)err(\s*\))/g, '$1_err$2']
]);

fix('src/execution/config-validation.ts', [
    [/SuperpowersCommandPreset,\s*/g, ''],
    [/SuperpowersWorktreeSettings\s*\} from/g, '} from']
]);

fix('src/execution/settings.ts', [
    [/normalizeSkillInput,\s*/g, '']
]);

fix('src/execution/subagent-executor.ts', [
    [/\s*fs,\s*/g, ' '],
    [/buildRequestedModeError,\s*/g, ''],
    [/const shareEnabled =/g, 'const _shareEnabled =']
]);

const emptyFiles = [
  'src/execution/jsonl-writer.ts',
  'src/execution/pi-spawn.ts',
  'src/execution/run-history.ts',
  'src/execution/single-output.ts'
];

for (const f of emptyFiles) {
  if(!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/\{\s*\}/g, '{ /* empty */ }');
  fs.writeFileSync(f, c);
}
