$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adbPath = Join-Path $sdkRoot 'platform-tools\adb.exe'
$emulatorPath = Join-Path $sdkRoot 'emulator\emulator.exe'
if (!(Test-Path $adbPath) -or !(Test-Path $emulatorPath)) { throw 'Existing Android SDK/emulator is required; no installation was attempted.' }
$health = Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health'
if ($health.status -ne 'ok') { throw 'Local SmartTrade API is not healthy.' }
$devices = & $adbPath devices
if (!($devices -match 'emulator-\d+\s+device')) {
    $avds = & $emulatorPath -list-avds
    if ($avds -notcontains 'Pixel_10_Pro') { throw 'The existing Pixel_10_Pro AVD was not found.' }
    Start-Process -FilePath $emulatorPath -ArgumentList '-avd', 'Pixel_10_Pro' -WindowStyle Hidden
    $deadline = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 2
        $devices = & $adbPath devices
    } until (($devices -match 'emulator-\d+\s+device') -or (Get-Date) -gt $deadline)
}
$matchesFound = @($devices | Where-Object { $_ -match '^emulator-\d+\s+device' })
if ($matchesFound.Count -ne 1) { throw 'Exactly one running Android emulator is required.' }
$deviceId = ($matchesFound[0] -split '\s+')[0]
& $adbPath -s $deviceId reverse tcp:8000 tcp:8000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'API port forwarding failed.' }
& $adbPath -s $deviceId reverse tcp:8081 tcp:8081 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Metro port forwarding failed.' }
$runtime = & $adbPath -s $deviceId shell pm list packages host.exp.exponent
if (!$runtime) { throw 'The approved SDK-compatible Expo Go runtime is missing; no automatic installation attempted.' }
$env:ANDROID_HOME = $sdkRoot
$env:EXPO_OFFLINE = '1'
if (Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue) {
    $status = Invoke-WebRequest 'http://127.0.0.1:8081/status'
    $statusText = if ($status.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($status.Content) } else { [string]$status.Content }
    if ($statusText -notmatch 'packager-status:running') { throw 'Port 8081 is occupied by an unrecognized server.' }
    & $adbPath -s $deviceId shell am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8081' host.exp.exponent | Out-Null
} else {
    Set-Location (Join-Path $projectRoot 'apps\mobile')
    & npm.cmd run android -- --localhost --port 8081
}
