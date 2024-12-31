@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
%1 mshta vbscript:CreateObject("Shell.Application").ShellExecute("cmd.exe","/c %~s0 ::","","runas",1)(window.close)&&exit
cd /d "%~dp0"
if not "%1"=="::" (
    exit /b
)

set "exePath=%~dp0jomo_novel_manager.exe"
setlocal enabledelayedexpansion
set "port=3000"
netsh advfirewall firewall show rule name="jomo_novel_manager" >nul 2>&1
if %errorlevel% equ 0 (
    echo Found existing firewall rule
    echo Deleting rule...
    netsh advfirewall firewall delete rule name="jomo_novel_manager" >nul 2>&1
    if %errorlevel% equ 0 (
        echo Rule deleted successfully
        echo Run this script again to add the rule
    )
) else (
    echo Adding firewall rule...
    netsh advfirewall firewall add rule name="jomo_novel_manager" dir=in action=allow program="%exePath%" enable=yes profile=any protocol=TCP localport=%port%
    if %errorlevel% equ 0 (
        echo Firewall rule added successfully
        echo You can now access the application through LAN
        echo Run this script again to remove the rule
    )
)
echo.
pause
endlocal
