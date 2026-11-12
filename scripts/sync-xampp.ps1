param(
    [string]$Destination = 'C:\xampp\htdocs\BiteRush'
)

$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$destinationPath = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\')

if ([string]::Equals($sourcePath, $destinationPath, [System.StringComparison]::OrdinalIgnoreCase) -or
    $destinationPath.StartsWith($sourcePath + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
    $sourcePath.StartsWith($destinationPath + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The XAMPP destination must be separate from the canonical workspace.'
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$excludedDirectories = @(
    (Join-Path $sourcePath '.git'),
    (Join-Path $sourcePath '.venv'),
    (Join-Path $sourcePath '.qodo')
)

& robocopy $sourcePath $destinationPath /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS `
    /XD $excludedDirectories /XF config.php
if ($LASTEXITCODE -ge 8) {
    throw "XAMPP sync failed with Robocopy exit code $LASTEXITCODE."
}

Write-Output "Synced BiteRush from $sourcePath to $destinationPath. Existing api\config.php was preserved."
