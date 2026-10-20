import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const sourceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const packager = join(root, 'scripts', 'Package-DshTavernImage.ps1')
const finalizer = join(root, 'scripts', 'Finalize-DshTavernImage-Release.ps1')
const powershell = process.env.POWERSHELL_EXE || 'powershell.exe'

async function runPowerShell(args) {
  return execFileAsync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    windowsHide: true,
    timeout: 90_000,
  })
}

test('published offline packager creates a clean installer bundle matching the source version', async t => {
  if (process.platform !== 'win32') return t.skip('PowerShell packaging tests run on Windows')

  const directory = await mkdtemp(join(tmpdir(), 'dsh-tavern-image-package-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const output = join(directory, 'dsh-tavern-image-install.zip')
  const standaloneSource = join(directory, 'dsh-tavern-image-source.zip')
  const extracted = join(directory, 'bundle')
  const source = join(directory, 'source')
  const sourceExtracted = join(directory, 'source-files')
  const expandScript = join(directory, 'expand.ps1')
  const inspectScript = join(directory, 'inspect-source.ps1')
  await writeFile(expandScript, [
    'param([string]$ArchivePath,[string]$DestinationPath)',
    'Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force',
  ].join('\n'))
  await writeFile(inspectScript, '\uFEFF' + [
    'param([string]$ArchivePath)',
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)',
    'try {',
    '  $names = @($archive.Entries | ForEach-Object { $_.FullName })',
    '  if (-not $names.Count) { throw "source archive is empty" }',
    '  foreach ($name in $names) {',
    '    if ($name.Contains([char]92)) { throw "entry uses a backslash: $name" }',
    '    if (-not $name.StartsWith("dsh-tavern-image/")) { throw "entry outside source root: $name" }',
    '  }',
    '  if (-not ($names | Where-Object { $_ -match "[^\x00-\x7F]" })) { throw "missing a non-ASCII source filename" }',
    '  foreach ($expected in @("dsh-tavern-image/lib/vendor/NOTICE.md", "dsh-tavern-image/世界书-通用生图规则.json", "dsh-tavern-image/世界书-角色与服装库.json")) {',
    '    if (-not ($names -contains $expected)) { throw "missing expected source entry: $expected" }',
    '  }',
    '  if ($names -contains "dsh-tavern-image/worldbook-outfits.json") { throw "user data must not be packaged" }',
    '} finally { $archive.Dispose() }',
].join('\n'))
  const manifestArchiveScript = join(directory, 'create-manifest-archive.ps1')
  await writeFile(manifestArchiveScript, [
    'param([string]$ArchivePath,[string]$ManifestJson)',
    'Add-Type -AssemblyName System.IO.Compression',
    '$stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)',
    '$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)',
    'try {',
    '  $entry = $archive.CreateEntry("dsh-tavern-image/package.json")',
    '  $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))',
    '  try { $writer.Write($ManifestJson) } finally { $writer.Dispose() }',
    '} finally { $archive.Dispose(); $stream.Dispose() }',
  ].join('\n'))

  await runPowerShell(['-File', packager, '-OutputPath', output, '-SourceOutputPath', standaloneSource])
  await runPowerShell(['-File', inspectScript, '-ArchivePath', standaloneSource])
  await runPowerShell(['-File', expandScript, '-ArchivePath', output, '-DestinationPath', extracted])
  for (const file of ['install-plugin.ps1', 'Install-DshTavernImage.cmd', 'dsh-tavern-image-source.zip']) {
    assert.ok(await stat(join(extracted, file)))
  }
  await runPowerShell(['-File', expandScript, '-ArchivePath', join(extracted, 'dsh-tavern-image-source.zip'), '-DestinationPath', sourceExtracted])

  const releaseSourceExtracted = join(directory, 'release-source-files')
  await runPowerShell(['-File', expandScript, '-ArchivePath', standaloneSource, '-DestinationPath', releaseSourceExtracted])

  const packageRoot = join(sourceExtracted, 'dsh-tavern-image')
  const standalonePackageRoot = join(releaseSourceExtracted, 'dsh-tavern-image')
  assert.equal(JSON.parse(await readFile(join(standalonePackageRoot, 'package.json'), 'utf8')).version, sourceManifest.version)

  const sumsPath = join(directory, 'SHA256SUMS')
  const wrongTagOutput = join(directory, 'wrong-tag-output')
  await assert.rejects(
    runPowerShell(['-File', finalizer, '-Tag', 'v' + sourceManifest.version + '-wrong', '-SourceZipPath', standaloneSource, '-InstallZipPath', output, '-OutputDirectory', wrongTagOutput]),
    error => /Git tag/.test(error.stderr || '')
  )
  const invalidApiValues = [
    ['missing', undefined],
    ['string', '1'],
    ['fraction', 1.5],
    ['zero', 0],
    ['above-safe-integer', 9007199254740992],
  ]
  for (const [caseName, apiVersion] of invalidApiValues) {
    const caseDirectory = join(directory, 'invalid-api-' + caseName)
    await mkdir(caseDirectory, { recursive: true })
    const invalidSource = join(caseDirectory, 'dsh-tavern-image-source.zip')
    const compatibility = apiVersion === undefined ? {} : { tavernApiVersion: apiVersion }
    const invalidManifest = JSON.stringify({ version: sourceManifest.version, dsh: { compatibility } })
    await runPowerShell(['-File', manifestArchiveScript, '-ArchivePath', invalidSource, '-ManifestJson', invalidManifest])
    await assert.rejects(
      runPowerShell(['-File', finalizer, '-Tag', 'v' + sourceManifest.version, '-SourceZipPath', invalidSource, '-InstallZipPath', output, '-OutputDirectory', join(caseDirectory, 'out')]),
      error => /tavernApiVersion/.test(error.stderr || '')
    )
  }
  await runPowerShell(['-File', finalizer, '-Tag', 'v' + sourceManifest.version, '-SourceZipPath', standaloneSource, '-InstallZipPath', output, '-OutputDirectory', directory])
  const checksumLines = (await readFile(sumsPath, 'utf8')).trim().split(/\r?\n/)
  assert.equal(checksumLines.length, 2)
  const expectedFiles = new Map([[standaloneSource, 'dsh-tavern-image-source.zip'], [output, 'dsh-tavern-image-install.zip']])
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    assert.ok(match, 'invalid sha256sum line: ' + line)
    const file = [...expectedFiles.entries()].find(([, name]) => name === match[2])?.[0]
    assert.ok(file, 'unexpected checksum entry: ' + match[2])
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), match[1])
    expectedFiles.delete(file)
  }
  assert.equal(expectedFiles.size, 0)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-tavern-image')
  assert.equal(manifest.version, '2.9.1')
  assert.equal(manifest.version, sourceManifest.version)
  const installedPatch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
  assert.match(installedPatch, /id: dsh-tavern-image\s+name: dsh-tavern-image/)
  assert.doesNotMatch(installedPatch, /name: dsh-tavern-comfy/)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(await stat(join(packageRoot, 'scripts', 'install-plugin.ps1')))
  assert.ok(await stat(join(packageRoot, 'scripts', 'Install-DshTavernImage.cmd')))
  assert.ok(await stat(join(packageRoot, 'scripts', 'Package-DshTavernImage.ps1')))
  const entries = await readdir(packageRoot)
  for (const privateFile of ['config.json', 'definitions.json', 'worldbook.json', 'tests', 'node_modules']) {
    assert.ok(!entries.includes(privateFile), `source archive must exclude ${privateFile}`)
  }
})
