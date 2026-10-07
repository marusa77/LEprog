$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$cameraPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $cameraPython)) { throw '先にREADMEのインストール手順を実行してください。' }
& $cameraPython app.py
