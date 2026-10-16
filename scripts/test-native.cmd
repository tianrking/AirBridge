@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b 1
if not exist work mkdir work
cl /nologo /std:c++17 /EHsc /W4 /WX /Icore core\awdl.cpp core\discovery.cpp core\presence.cpp tests\protocol_tests.cpp /Fo:work\ /Fe:work\protocol_tests.exe
if errorlevel 1 exit /b 1
work\protocol_tests.exe
