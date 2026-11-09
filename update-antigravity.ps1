$targetDir = "$env:USERPROFILE\.antigravity-ide\extensions\fromeroc9.testform-dsl-1.0.1"
if (Test-Path $targetDir) {
    Copy-Item -Path "dist\*" -Destination "$targetDir\dist\" -Recurse -Force
    Copy-Item -Path "package.json" -Destination "$targetDir\package.json" -Force
    if (Test-Path "assets") {
        Copy-Item -Path "assets\*" -Destination "$targetDir\assets\" -Recurse -Force
    }
    if (Test-Path "syntaxes") {
        Copy-Item -Path "syntaxes\*" -Destination "$targetDir\syntaxes\" -Recurse -Force
    }
    if (Test-Path "snippets") {
        Copy-Item -Path "snippets\*" -Destination "$targetDir\snippets\" -Recurse -Force
    }
    Write-Host "Antigravity IDE extension updated successfully in $targetDir"
} else {
    Write-Warning "Target directory $targetDir not found."
}
