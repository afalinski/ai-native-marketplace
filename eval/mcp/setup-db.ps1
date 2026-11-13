#requires -Version 7
<#
.SYNOPSIS
    Prepares the eval databases: read-only role + fixed seed data. Idempotent.
.PARAMETER Password
    Password for the mcp_readonly role (the AppHost user-secret Parameters:mcp-readonly-password).
#>
param(
    [Parameter(Mandatory)][string]$Password
)

$ErrorActionPreference = 'Stop'

$container = (docker ps --filter 'ancestor=ankane/pgvector' --format '{{.Names}}' | Select-Object -First 1)
if (-not $container) {
    throw 'No running container with image ankane/pgvector. Start the AppHost first: dotnet run --project src/eShop.AppHost -- --McpEval=true'
}

# The Aspire postgres container requires a password for the superuser, even locally.
$superPassword = (docker exec $container printenv POSTGRES_PASSWORD)

function Invoke-Psql {
    param([string]$Database, [string]$File, [string[]]$ExtraArgs = @())
    Get-Content -Raw $File | docker exec -i -e "PGPASSWORD=$superPassword" $container `
        psql -U postgres -d $Database -v ON_ERROR_STOP=1 -q @ExtraArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "psql failed for $File in $Database" }
}

$dir = $PSScriptRoot
foreach ($db in 'catalogdb', 'orderingdb') {
    Invoke-Psql -Database $db -File (Join-Path $dir 'create-readonly-role.sql') -ExtraArgs @('-v', "mcp_password=$Password")
}
Invoke-Psql -Database 'catalogdb' -File (Join-Path $dir 'seed-catalog.sql')
Invoke-Psql -Database 'orderingdb' -File (Join-Path $dir 'seed-ordering.sql')

$count = ('SELECT count(*) FROM ordering.orders WHERE "Id" BETWEEN 9001 AND 9099;' |
    docker exec -i -e "PGPASSWORD=$superPassword" $container psql -U postgres -d orderingdb -t -A).Trim()
Write-Output "Seed OK: $count orders"
