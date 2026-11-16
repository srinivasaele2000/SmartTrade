[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$ApkPath
)

$ErrorActionPreference = 'Stop'
if ($ApkPath -and !$SkipBuild) { throw '-ApkPath requires -SkipBuild.' }
$project = Split-Path $PSScriptRoot
$mobile = Join-Path $project 'apps\mobile'
$version = (Get-Content -Raw -LiteralPath (Join-Path $mobile 'package.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'Invalid mobile package version.' }
$output = Join-Path $project 'client-presentation\apk'
$apiUrl = 'http://189.72.155.44/api/v1'
$vps = 'root@189.72.155.44'
$releaseDir = '/opt/smarttrade/releases/apk'
$filename = 'SmartTrade-latest.apk'

$sdk = $env:ANDROID_HOME
if (!$sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (!$sdk) {
    $adb = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($adb) { $sdk = Split-Path (Split-Path $adb.Source) }
    else { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
$sdk = (Resolve-Path -LiteralPath $sdk).Path
$tools = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and
        (Test-Path (Join-Path $_.FullName 'aapt.exe')) -and
        (Test-Path (Join-Path $_.FullName 'apksigner.bat')) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$tools) { throw 'Android SDK Build Tools with aapt and apksigner are required.' }

$packageName = ((Get-Content -Raw -LiteralPath (Join-Path $mobile 'app.json')) | ConvertFrom-Json).expo.android.package
if (!$ApkPath) { $ApkPath = Join-Path $output "SmartTrade-$version-prod-arm64-release.apk" }
$candidate = $ApkPath
if (!$SkipBuild) {
    $signingNames = @('SMARTTRADE_ANDROID_KEYSTORE', 'SMARTTRADE_ANDROID_STORE_PASSWORD',
        'SMARTTRADE_ANDROID_KEY_ALIAS', 'SMARTTRADE_ANDROID_KEY_PASSWORD')
    $buildEnv = @{
        EXPO_PUBLIC_API_URL = $apiUrl
        EXPO_PUBLIC_ENABLE_DEMO_ROLES = 'false'
        EXPO_NO_DOTENV = '1'
        NODE_ENV = 'production'
        ANDROID_HOME = $sdk
        ANDROID_SDK_ROOT = $sdk
    }
    $configured = @($signingNames | Where-Object { [Environment]::GetEnvironmentVariable($_, 'Process') })
    if ($configured.Count -eq 0) {
        $signingDir = Join-Path $project 'local-secrets\android'
        $credentials = Get-Content -Raw -LiteralPath (Join-Path $signingDir 'signing.json') | ConvertFrom-Json
        $buildEnv.SMARTTRADE_ANDROID_KEYSTORE = (Resolve-Path -LiteralPath (Join-Path $signingDir 'smarttrade-local.jks')).Path
        $buildEnv.SMARTTRADE_ANDROID_STORE_PASSWORD = $credentials.storePassword
        $buildEnv.SMARTTRADE_ANDROID_KEY_ALIAS = $credentials.alias
        $buildEnv.SMARTTRADE_ANDROID_KEY_PASSWORD = $credentials.keyPassword
    } elseif ($configured.Count -ne $signingNames.Count) {
        throw 'Set all four existing SMARTTRADE_ANDROID signing environment variables.'
    }

    $previousEnv = @{}
    Push-Location (Join-Path $mobile 'android')
    try {
        foreach ($name in $buildEnv.Keys) {
            $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $buildEnv[$name], 'Process')
        }
        # The JS bundle depends on the API URL and demo flag, which Gradle does not track as task inputs.
        & .\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --rerun-tasks --console=plain --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
        $candidate = Join-Path (Get-Location).Path 'app\build\outputs\apk\release\app-release.apk'
    } finally {
        foreach ($name in $previousEnv.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], 'Process')
        }
        Pop-Location
    }
}

$artifact = Get-Item -LiteralPath $candidate
if ($artifact.PSIsContainer -or !$artifact.Length) { throw 'The APK is missing or empty.' }
& (Join-Path $tools.FullName 'apksigner.bat') verify $artifact.FullName
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$badging = & (Join-Path $tools.FullName 'aapt.exe') dump badging $artifact.FullName
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the APK manifest.' }
$details = $badging -join "`n"
if ($details -notmatch "(?m)^package: name='$([regex]::Escape($packageName))'[^\r\n]*versionName='$([regex]::Escape($version))'" -or
    $details -match '(?m)^application-debuggable' -or $details -notmatch "(?m)^native-code:\s+'arm64-v8a'\s*$") {
    throw "Expected a non-debuggable ARM64 APK for $packageName at version $version."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($artifact.FullName)
try {
    $entry = $zip.GetEntry('assets/index.android.bundle')
    if (!$entry) { throw 'The APK does not contain a standalone JS bundle.' }
    $stream = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::ASCII)
    try {
        if (!$stream.ReadToEnd().Contains($apiUrl)) { throw "The APK bundle does not contain the required VPS API URL ($apiUrl)." }
    } finally { $stream.Dispose() }
} finally { $zip.Dispose() }

if (!$SkipBuild) {
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    Copy-Item -LiteralPath $artifact.FullName -Destination $ApkPath -Force
    $artifact = Get-Item -LiteralPath $ApkPath
}
$meta = Join-Path ([IO.Path]::GetTempPath()) ("smarttrade-apk-" + [guid]::NewGuid() + ".json")
$staging = $null
try {
    $metadata = [ordered]@{
        version = $version
        filename = $filename
        sizeBytes = $artifact.Length
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText($meta, ($metadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $staging = (& ssh $vps "mkdir -p '$releaseDir' && mktemp -d '$releaseDir/.apk-upload.XXXXXXXX'") -join ''
    if ($LASTEXITCODE -ne 0 -or $staging -notmatch "^$([regex]::Escape($releaseDir))/\.apk-upload\.[A-Za-z0-9]{8}$") {
        $staging = $null
        throw 'Could not create the VPS staging directory.'
    }
    & scp $artifact.FullName "${vps}:${staging}/$filename"
    if ($LASTEXITCODE -ne 0) { throw 'APK upload failed.' }
    & scp $meta "${vps}:${staging}/apk-meta.json"
    if ($LASTEXITCODE -ne 0) { throw 'APK metadata upload failed.' }
    $apkHash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $metaHash = (Get-FileHash -LiteralPath $meta -Algorithm SHA256).Hash.ToLowerInvariant()
    $publish = "cd '$staging' && printf '%s\n' '$apkHash  $filename' '$metaHash  apk-meta.json' | sha256sum -c - && " +
        "chmod 644 '$filename' apk-meta.json && exec 9<'$releaseDir' && flock -x 9 && " +
        "mv -fT '$filename' '$releaseDir/$filename' && mv -fT apk-meta.json '$releaseDir/apk-meta.json'"
    & ssh $vps $publish
    if ($LASTEXITCODE -ne 0) { throw 'The VPS did not finish promoting the APK and metadata.' }
    Write-Output "Published $($artifact.FullName) to http://189.72.155.44/downloads/$filename"
} finally {
    if ($staging) { & ssh $vps "rm -f '$staging/$filename' '$staging/apk-meta.json' && rmdir '$staging'" }
    if (Test-Path -LiteralPath $meta) { Remove-Item -LiteralPath $meta }
}
