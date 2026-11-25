param(
    [string]$BackupDirectory = (Join-Path $env:USERPROFILE 'Documents\BiteRushBackups'),
    [string]$Database = 'biterush',
    [string]$MySqlHost = '127.0.0.1',
    [int]$MySqlPort = 3306,
    [string]$MySqlUser = 'root',
    [string]$MySqlDumpPath = 'C:\xampp\mysql\bin\mysqldump.exe',
    [string]$DefaultsFile
)

$ErrorActionPreference = 'Stop'

if ($Database -notmatch '^[A-Za-z0-9_]+$') {
    throw 'Database must contain only letters, numbers, and underscores.'
}
if ($MySqlPort -lt 1 -or $MySqlPort -gt 65535) {
    throw 'MySQL port must be between 1 and 65535.'
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$backupRoot = [System.IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\')
if ([string]::Equals($projectRoot, $backupRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $backupRoot.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backups must be stored outside the BiteRush project directory.'
}

$defaultsPath = $null
if ($DefaultsFile) {
    $defaultsPath = [System.IO.Path]::GetFullPath($DefaultsFile)
    if ([string]::Equals($projectRoot, $defaultsPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $defaultsPath.StartsWith($projectRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Store the MySQL defaults file outside the BiteRush project directory.'
    }
}

if (-not (Test-Path -LiteralPath $MySqlDumpPath -PathType Leaf)) {
    $mysqlDumpCommand = Get-Command mysqldump.exe -ErrorAction SilentlyContinue
    if (-not $mysqlDumpCommand) {
        throw 'mysqldump.exe was not found. Set -MySqlDumpPath to its location.'
    }
    $MySqlDumpPath = $mysqlDumpCommand.Source
}
if ($defaultsPath -and -not (Test-Path -LiteralPath $defaultsPath -PathType Leaf)) {
    throw 'The MySQL defaults file was not found.'
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backupPath = Join-Path $backupRoot ("BiteRush-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null
$dumpPath = Join-Path $backupPath "$Database.sql"
$errorPath = Join-Path $backupPath 'mysqldump-error.log'

try {
    $arguments = @()
    if ($defaultsPath) {
        $arguments += "--defaults-extra-file=$defaultsPath"
    } else {
        $arguments += @(
            "--host=$MySqlHost",
            "--port=$MySqlPort",
            "--user=$MySqlUser"
        )
    }
    $arguments += @(
        '--single-transaction',
        '--routines',
        '--triggers',
        '--databases',
        $Database,
        "--result-file=$dumpPath"
    )
    $argumentString = ($arguments | ForEach-Object {
        '"' + ([string]$_).Replace('"', '\"') + '"'
    }) -join ' '

    $process = Start-Process -FilePath $MySqlDumpPath `
        -ArgumentList $argumentString `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardError $errorPath
    if ($process.ExitCode -ne 0) {
        $details = if (Test-Path -LiteralPath $errorPath) {
            (Get-Content -LiteralPath $errorPath -Raw).Trim()
        } else {
            'No diagnostic output was returned.'
        }
        throw "mysqldump failed with exit code $($process.ExitCode). $details"
    }
    if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or
        (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
        throw 'mysqldump completed without producing a database dump.'
    }
    if (Test-Path -LiteralPath $errorPath -PathType Leaf) {
        if ((Get-Item -LiteralPath $errorPath).Length -eq 0) {
            Remove-Item -LiteralPath $errorPath
        }
    }

    $productUploads = Join-Path $projectRoot 'uploads\products'
    if (Test-Path -LiteralPath $productUploads -PathType Container) {
        $uploadsBackup = Join-Path $backupPath 'uploads'
        New-Item -ItemType Directory -Path $uploadsBackup | Out-Null
        Copy-Item -LiteralPath $productUploads -Destination $uploadsBackup -Recurse
    }

    Write-Output "Database and product image backup created at $backupPath"
} catch {
    if (Test-Path -LiteralPath $backupPath) {
        Remove-Item -LiteralPath $backupPath -Recurse -Force
    }
    throw
}
