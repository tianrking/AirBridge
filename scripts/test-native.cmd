@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b 1
if not exist work mkdir work
cl /nologo /utf-8 /std:c++17 /EHsc /W4 /WX /Icore core\awdl.cpp core\discovery.cpp core\presence.cpp core\bplist.cpp core\http.cpp core\archive.cpp tests\protocol_tests.cpp tests\transfer_tests.cpp /Fo:work\ /Fe:work\protocol_tests.exe
if errorlevel 1 exit /b 1
work\protocol_tests.exe
