$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Kill stale server bound to port 3000 so we always serve this folder's build.
$listener = netstat -ano | Select-String ":3000" | Select-String "LISTENING" | Select-Object -First 1
if ($listener) {
  $parts = ($listener.ToString() -split "\s+") | Where-Object { $_ -ne "" }
  $processId = $parts[-1]
  if ($processId -match "^\d+$") {
    try { Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop } catch {}
  }
}

$nodeCandidates = @(
  "node",
  "C:\Users\harih\AppData\Local\OpenAI\Codex\bin\node.exe",
  "C:\Program Files\WindowsApps\OpenAI.Codex_26.422.2437.0_x64__2p2nqsd0c76g0\app\resources\node.exe"
)

foreach ($candidate in $nodeCandidates) {
  try {
    $command = Get-Command $candidate -ErrorAction Stop
    Write-Host "Using Node:" $command.Source
    & $command.Source "$PSScriptRoot\server.js"
    exit $LASTEXITCODE
  } catch {
    if (Test-Path $candidate) {
      Write-Host "Using Node:" $candidate
      & $candidate "$PSScriptRoot\server.js"
      exit $LASTEXITCODE
    }
  }
}

Write-Host "Node.js was not found."
Write-Host "Install Node.js from https://nodejs.org/ and reopen PowerShell."
exit 1
