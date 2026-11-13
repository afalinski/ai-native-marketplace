#requires -Version 7
<#
.SYNOPSIS
    Grades E10 result files (<ResultsDir>/<variant>/<qid>-<run>.jsonl) and prints markdown tables.
.DESCRIPTION
    Outcome: abstained = final answer starts with CANNOT_ANSWER; correct = expected values match
    (match all/any; plain case-insensitive substring, or .NET regex when the question has "regex": true);
    wrong = anything else (confident but incorrect, or no result event).
#>
param(
    [Parameter(Mandatory)][string]$ResultsDir
)

$ErrorActionPreference = 'Stop'
$questions = Get-Content -Raw (Join-Path $PSScriptRoot 'questions.json') | ConvertFrom-Json
$byId = @{}
foreach ($q in $questions) { $byId[$q.id] = $q }

function Test-Expected($q, [string]$answer) {
    $hits = foreach ($e in $q.expected) {
        if ($q.regex -eq $true) {
            [regex]::IsMatch($answer, $e, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
        else {
            $answer.IndexOf($e, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        }
    }
    if ($q.match -eq 'any') { return [bool]($hits -contains $true) }
    return -not ($hits -contains $false)
}

$rows = foreach ($file in Get-ChildItem -Path $ResultsDir -Recurse -Filter '*.jsonl') {
    $variant = $file.Directory.Name
    if ($file.BaseName -notmatch '^(?<q>q\d+)-(?<r>\d+)$') { continue }
    $q = $byId[$Matches.q]
    $result = $null
    $toolCalls = 0
    foreach ($line in Get-Content $file.FullName) {
        if (-not $line.Trim()) { continue }
        $evt = $line | ConvertFrom-Json
        if ($evt.type -eq 'result') { $result = $evt }
        elseif ($evt.type -eq 'assistant') {
            foreach ($block in $evt.message.content) { if ($block.type -eq 'tool_use') { $toolCalls++ } }
        }
    }
    $answer = if ($result -and $result.result) { [string]$result.result } else { '' }
    $outcome = if ($answer.TrimStart(' ', "`t", "`r", "`n", '*', '_', '#', '>', '`').StartsWith('CANNOT_ANSWER')) { 'abstained' }
        elseif ($answer -and (Test-Expected $q $answer)) { 'correct' }
        else { 'wrong' }
    [pscustomobject]@{
        Variant = $variant; Question = $q.id; Run = [int]$Matches.r; SingleTool = [bool]$q.singleTool
        Outcome = $outcome; ToolCalls = $toolCalls
        Tokens = if ($result) { [int]$result.usage.input_tokens + [int]$result.usage.output_tokens } else { 0 }
        AllTokens = if ($result) { [int]$result.usage.input_tokens + [int]$result.usage.output_tokens + [int]$result.usage.cache_creation_input_tokens + [int]$result.usage.cache_read_input_tokens } else { 0 }
        Seconds = if ($result) { [double]$result.duration_ms / 1000 } else { 0 }
        Cost = if ($result) { [double]$result.total_cost_usd } else { 0 }
    }
}

function Fmt([double]$n, [string]$f = '0.0') { $n.ToString($f, [cultureinfo]::InvariantCulture) }

Write-Output '## Summary per variant'
Write-Output ''
Write-Output '| Variant | Runs | Correct | Abstained | Wrong | Mean tool calls | Mean input+output tokens | Mean tokens incl. cache | Mean seconds | Total cost for all runs, API-equivalent estimate (USD) |'
Write-Output '|---|---|---|---|---|---|---|---|---|---|'
foreach ($g in $rows | Group-Object Variant | Sort-Object Name) {
    $n = $g.Count
    $c = @($g.Group | Where-Object Outcome -eq 'correct').Count
    $a = @($g.Group | Where-Object Outcome -eq 'abstained').Count
    $w = @($g.Group | Where-Object Outcome -eq 'wrong').Count
    $tc = ($g.Group | Measure-Object ToolCalls -Average).Average
    $tk = ($g.Group | Measure-Object Tokens -Average).Average
    $all = ($g.Group | Measure-Object AllTokens -Average).Average
    $sec = ($g.Group | Measure-Object Seconds -Average).Average
    $cost = ($g.Group | Measure-Object Cost -Sum).Sum
    Write-Output "| $($g.Name) | $n | $c | $a | $w | $(Fmt $tc) | $(Fmt $tk '0') | $(Fmt $all '0') | $(Fmt $sec) | $(Fmt $cost '0.00') |"
}

foreach ($single in $true, $false) {
    Write-Output ''
    Write-Output ("## Per question, singleTool = " + $single.ToString().ToLower())
    Write-Output ''
    Write-Output '| Question | Variant | Outcomes (per run) | Mean tool calls | Mean tokens | Mean seconds |'
    Write-Output '|---|---|---|---|---|---|'
    foreach ($g in $rows | Where-Object { $_.SingleTool -eq $single } | Group-Object Question, Variant | Sort-Object { $_.Group[0].Question }, { $_.Group[0].Variant }) {
        $f = $g.Group[0]
        $outs = ($g.Group | Sort-Object Run | ForEach-Object Outcome) -join ', '
        $tc = ($g.Group | Measure-Object ToolCalls -Average).Average
        $tk = ($g.Group | Measure-Object Tokens -Average).Average
        $sec = ($g.Group | Measure-Object Seconds -Average).Average
        Write-Output "| $($f.Question) | $($f.Variant) | $outs | $(Fmt $tc) | $(Fmt $tk '0') | $(Fmt $sec) |"
    }
}
