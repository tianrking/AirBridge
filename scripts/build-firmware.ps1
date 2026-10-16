param([string]$BuildDirectory='work/s', [switch]$PresenceTx)
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
& $idfPython (Join-Path $env:IDF_PATH 'tools\idf.py') -C (Join-Path $projectRoot 'firmware') -B $buildPath -D "AIRBRIDGE_PRESENCE_TX=$($PresenceTx.IsPresent.ToString().ToUpperInvariant())" build
if ($LASTEXITCODE -ne 0) { throw 'ESP-IDF build failed.' }
