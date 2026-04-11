@echo off
REM EduAgent Backend 一键启动脚本
REM 双击此文件即可启动后端，无需手动输入命令

title EduAgent Backend

echo ==============================
echo   EduAgent Backend Starting
echo ==============================
echo.

REM 激活 conda 环境（使用 conda 的初始化脚本）
call D:\dev\anaconda3.0\Scripts\activate.bat D:\dev\anaconda3.0\envs\eduagent

REM 进入后端目录（脚本自身所在目录）
cd /d "%~dp0"

echo [INFO] Conda env: eduagent
echo [INFO] Working dir: %CD%
echo [INFO] Starting uvicorn on http://0.0.0.0:8000
echo.

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

REM 如果 uvicorn 退出，暂停以便查看报错
pause
