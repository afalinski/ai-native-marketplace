# Elicitation hook for the E11 injection demo: log what the server asked, then decline.
# The log path comes from the environment variable E11_ELICIT_LOG.
$raw = [Console]::In.ReadToEnd()
if ($env:E11_ELICIT_LOG) {
    Add-Content -Path $env:E11_ELICIT_LOG -Value $raw -Encoding utf8
}
@{ hookSpecificOutput = @{ hookEventName = 'Elicitation'; action = 'decline' } } | ConvertTo-Json -Depth 4
