#requires -Version 7
<#
.SYNOPSIS
    Runs the E10 eval: questions x variants x runs through headless Claude Code.
.PARAMETER Variants
    M0 (no MCP), M1 (two Postgres MCP Pro instances), M2 (eShop.Mcp).
.PARAMETER Password
    Password of the mcp_readonly role. Default: env MCP_READONLY_PASSWORD.
    It is used for the reseed and put into the M1 connection strings (environment only, never into a file).
.PARAMETER Questions
    Optional list of question ids, for a dry run or to resume (for example q05,q06).
#>
param(
    [string[]]$Variants = @('M0', 'M1', 'M2'),
    [int]$Runs = 1,
    [string]$Model = 'sonnet',
    [string[]]$Questions = @(),
    [string]$Password = $env:MCP_READONLY_PASSWORD,
    [string]$ResultsDir = ''
)

$ErrorActionPreference = 'Stop'
# `pwsh -File` passes a comma list as one string; split it.
$Variants = @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Questions = @($Questions | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if (-not $Password) { throw 'Pass -Password or set MCP_READONLY_PASSWORD (AppHost user-secret Parameters:mcp-readonly-password).' }

$claude = $env:CLAUDE_EXE
if (-not $claude) {
    $claude = 'C:\Users\user\.vscode\extensions\anthropic.claude-code-2.1.322-win32-x64\resources\native-binary\claude.exe'
}
if (-not (Test-Path $claude)) {
    # The versioned VS Code path is gone after an extension update: use claude from PATH.
    $claude = 'claude'
}
$evalDir = $PSScriptRoot
$repo = Resolve-Path (Join-Path $evalDir '..\..')

# Fresh seed: OrderDate values are relative to the seeding moment.
& (Join-Path $evalDir 'setup-db.ps1') -Password $Password

# M1 image is pinned by digest in config/m1.json (Postgres MCP Pro 1.6.0).
# M1 connection strings (the Postgres MCP Pro container reaches the host through host.docker.internal).
$container = (docker ps --filter 'ancestor=ankane/pgvector' --format '{{.Names}}' | Select-Object -First 1)
$hostPort = ((docker port $container 5432/tcp) | Select-Object -First 1) -replace '^.*:', ''
$env:PG_CATALOG_URI = "postgresql://mcp_readonly:$Password@host.docker.internal:$hostPort/catalogdb"
$env:PG_ORDERING_URI = "postgresql://mcp_readonly:$Password@host.docker.internal:$hostPort/orderingdb"

$selected = Get-Content -Raw (Join-Path $evalDir 'questions.json') | ConvertFrom-Json
if ($Questions.Count -gt 0) { $selected = $selected | Where-Object { $Questions -contains $_.id } }
$template = Get-Content -Raw (Join-Path $evalDir 'prompt.md')

$allowed = @{
    M0 = 'Read,Grep,Glob'
    M1 = 'Read,Grep,Glob,mcp__pgcatalog,mcp__pgordering'
    M2 = 'Read,Grep,Glob,mcp__eshop'
}
# Read(path) deny rules also apply to Grep and Glob (Grep(path)/Glob(path) rules would not match, see the permissions docs).
# They keep the agent from reading the answers in eval/ and tests/. src/ stays readable.
$disallowed = 'Bash,PowerShell,Write,Edit,WebFetch,WebSearch,mcp__eshop__cancel_order,Read(./eval/**),Read(./tests/**)'

if (-not $ResultsDir) { $ResultsDir = Join-Path $evalDir ("results\" + (Get-Date -Format 'yyyy-MM-dd-HHmm')) }
Write-Output "Results: $ResultsDir"

Push-Location $repo
try {
    foreach ($v in $Variants) {
        $outDir = Join-Path $ResultsDir $v
        New-Item -ItemType Directory -Force $outDir | Out-Null
        $config = Join-Path $evalDir "config\$($v.ToLower()).json"
        foreach ($q in $selected) {
            $prompt = $template.Replace('{question}', $q.question)
            for ($r = 1; $r -le $Runs; $r++) {
                $file = Join-Path $outDir "$($q.id)-$r.jsonl"
                Write-Output "[$v] $($q.id) run $r"
                $null | & $claude -p $prompt --model $Model --output-format stream-json --verbose `
                    --strict-mcp-config --mcp-config $config `
                    --allowedTools $allowed[$v] --disallowedTools $disallowed > $file 2> "$file.err"
            }
        }
    }
}
finally {
    Pop-Location
    # Postgres MCP Pro containers can outlive a finished claude.exe; stop any that are left.
    docker ps -q --filter 'ancestor=crystaldba/postgres-mcp' | ForEach-Object { docker stop -t 1 $_ | Out-Null }
}
Write-Output "Done. Grade with: pwsh eval/mcp/grade.ps1 -ResultsDir $ResultsDir"
