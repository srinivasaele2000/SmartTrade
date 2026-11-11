param([ValidatePattern('^[A-Za-z0-9._-]+\.apk$')][string]$OutputName = 'SmartTrade-0.1.0-usb-arm64-release.apk')
$ErrorActionPreference = 'Stop'
Push-Location
try {
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $projectRoot
$privateDir = Join-Path $PWD 'local-secrets\android'
New-Item -ItemType Directory -Force $privateDir | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $privateDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect signing directory.' }
$credentialsPath = Join-Path $privateDir 'signing.json'
if (!(Test-Path $credentialsPath)) {
    $passwordBytes = [byte[]]::new(48)
    [Security.Cryptography.RandomNumberGenerator]::Fill($passwordBytes)
    $password = [Convert]::ToBase64String($passwordBytes)
    @{storePassword=$password;keyPassword=$password;alias='smarttrade-local'} | ConvertTo-Json | Set-Content -LiteralPath $credentialsPath
}
$credentials = Get-Content -Raw $credentialsPath | ConvertFrom-Json
$env:SMARTTRADE_ANDROID_KEYSTORE = Join-Path $privateDir 'smarttrade-local.jks'
$env:SMARTTRADE_ANDROID_STORE_PASSWORD = $credentials.storePassword
$env:SMARTTRADE_ANDROID_KEY_PASSWORD = $credentials.keyPassword
$env:SMARTTRADE_ANDROID_KEY_ALIAS = $credentials.alias
if (!(Test-Path $env:SMARTTRADE_ANDROID_KEYSTORE)) {
    & keytool -genkeypair -keystore $env:SMARTTRADE_ANDROID_KEYSTORE -storetype JKS -alias $env:SMARTTRADE_ANDROID_KEY_ALIAS -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=SmartTrade Local Testing, O=SmartTrade, C=IN' -storepass:env SMARTTRADE_ANDROID_STORE_PASSWORD -keypass:env SMARTTRADE_ANDROID_KEY_PASSWORD 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
}
$usbEnv = Join-Path $privateDir 'usb-build.env'
if (!(Test-Path $usbEnv)) { 'EXPO_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1' | Set-Content -LiteralPath $usbEnv }
foreach ($line in Get-Content $usbEnv) {
    if ($line -match '^EXPO_PUBLIC_API_URL=(.+)$') { $env:EXPO_PUBLIC_API_URL = $Matches[1] }
    if ($line -match '^(EXPO_PUBLIC_ENABLE_DEMO_ROLES|EXPO_PUBLIC_DEMO_(BUYER|DEALER|COMPANY|STAFF|SERVICE_PROVIDER|JOB_SEEKER|EMPLOYER)_MOBILE)=([+0-9a-z]*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[3], 'Process')
    }
}
$env:EXPO_NO_DOTENV = '1'
$env:NODE_ENV = 'production'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Set-Location apps\mobile\android
& .\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'Android release build failed; no installation attempted.' }
$output = Join-Path $projectRoot 'client-presentation\apk'
New-Item -ItemType Directory -Force $output | Out-Null
$apk = Join-Path $output $OutputName
if (Test-Path $apk) { throw 'Output already exists; preserve it before making another build.' }
Copy-Item -LiteralPath app\build\outputs\apk\release\app-release.apk -Destination $apk
Write-Output "APK created: $apk"
} finally {
    Pop-Location
}
