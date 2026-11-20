@echo off
chcp 65001 >nul
title 互动小说播放器 - 开发服务器
cd /d "%~dp0"
echo 正在启动开发服务器，浏览器打开 http://127.0.0.1:5173/ 即可游玩
echo 按 Ctrl+C 可停止服务
start "" http://127.0.0.1:5173/
npm run dev
pause
