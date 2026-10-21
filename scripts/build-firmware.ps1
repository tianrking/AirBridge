param([string]$BuildDirectory='work/s', [switch]$PresenceTx, [switch]$Ipv6Link, [switch]$NativeService, [switch]$FullCalibration, [switch]$LegacyRate1M, [switch]$IbssBeacon, [switch]$PublicBuild, [switch]$RoundDisplay,
    [ValidatePattern('^(?:[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})?$')][string]$ProbePeer='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if (-not $env:IDF_PATH) { $env:IDF_PATH='C:\esp\v6.1\esp-idf' }
$idfPython='C:\Espressif\tools\python\v6.1\venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $idfPython)) { throw 'Activate the ESP-IDF 6.1 Python environment first.' }
$env:IDF_TOOLS_PATH='C:\Espressif'
$env:IDF_PYTHON_ENV_PATH=Split-Path (Split-Path $idfPython -Parent) -Parent
$env:IDF_PYTHON_CHECK_CONSTRAINTS='no'
$env:ESP_ROM_ELF_DIR='C:\Espressif\tools\esp-rom-elfs\20241011'
$env:PATH='C:\Espressif\tools\cmake\4.0.3\bin;C:\Espressif\tools\ninja\1.12.1;C:\Espressif\tools\xtensa-esp-elf\esp-15.2.0_20251204\xtensa-esp-elf\bin;'+$env:PATH
$env:PYTHONUTF8='1'
$env:ESP_IDF_VERSION='6.1'
$buildPath=if ([IO.Path]::IsPathRooted($BuildDirectory)) {$BuildDirectory} else {Join-Path $projectRoot $BuildDirectory}
if (-not $PublicBuild) {
& $idfPython (Join-Path $PSScriptRoot 'set-calibration-profile.py') (Join-Path $projectRoot 'firmware\sdkconfig') $(if($FullCalibration){'full'}else{'partial'})
if ($LASTEXITCODE -ne 0) { throw 'SDK calibration profile update failed.' }
}
New-Item -ItemType Directory -Force -Path $buildPath | Out-Null
$sdkConfig = if($PublicBuild) {Join-Path $buildPath 'sdkconfig'} else {Join-Path $projectRoot 'firmware\sdkconfig'}
$roundArguments=@("-DAIRBRIDGE_ROUND_DISPLAY=$($RoundDisplay.IsPresent.ToString().ToUpperInvariant())")
if ($RoundDisplay) {
  if (-not $PublicBuild -or -not $NativeService) { throw 'Round display requires -PublicBuild -NativeService.' }
  $roundArguments += "-DSDKCONFIG_DEFAULTS=$projectRoot/firmware/sdkconfig.defaults;$projectRoot/firmware/round/sdkconfig.defaults"
}
& $idfPython (Join-Path $env:IDF_PATH 'tools\idf.py') -C (Join-Path $projectRoot 'firmware') -B $buildPath @roundArguments -D "SDKCONFIG=$sdkConfig" -D "AIRBRIDGE_PUBLIC_BUILD=$($PublicBuild.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_PRESENCE_TX=$($PresenceTx.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_IPV6_LINK=$($Ipv6Link.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_NATIVE_SERVICE=$($NativeService.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_RAW_RATE_1M=$($LegacyRate1M.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_IBSS_BEACON=$($IbssBeacon.IsPresent.ToString().ToUpperInvariant())" -D "AIRBRIDGE_PROBE_PEER=$ProbePeer" build
if ($LASTEXITCODE -ne 0) { throw 'ESP-IDF build failed.' }
