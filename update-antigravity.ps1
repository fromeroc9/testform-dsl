$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

$extDir = "$env:USERPROFILE\.antigravity-ide\extensions"
$targetDir = "$extDir\fromeroc9.testform-dsl-$version"

# Create directory if it does not exist
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

# Copy compiled extension assets
Copy-Item -Path "dist" -Destination "$targetDir\" -Recurse -Force
Copy-Item -Path "package.json" -Destination "$targetDir\package.json" -Force
if (Test-Path "language-configuration.json") {
    Copy-Item -Path "language-configuration.json" -Destination "$targetDir\language-configuration.json" -Force
}
if (Test-Path "schemas") {
    Copy-Item -Path "schemas" -Destination "$targetDir\" -Recurse -Force
}
if (Test-Path "assets") {
    Copy-Item -Path "assets" -Destination "$targetDir\" -Recurse -Force
}
if (Test-Path "syntaxes") {
    Copy-Item -Path "syntaxes" -Destination "$targetDir\" -Recurse -Force
}
if (Test-Path "snippets") {
    Copy-Item -Path "snippets" -Destination "$targetDir\" -Recurse -Force
}

# Update extensions.json in .antigravity-ide
$extJsonPath = "$extDir\extensions.json"
if (Test-Path $extJsonPath) {
    try {
        $json = Get-Content $extJsonPath -Raw | ConvertFrom-Json
        $filtered = @($json | Where-Object { $_.identifier.id -ne 'fromeroc9.testform-dsl' })
        
        $entry = [PSCustomObject]@{
            identifier = [PSCustomObject]@{
                id = "fromeroc9.testform-dsl"
            }
            version = $version
            location = [PSCustomObject]@{
                '$mid' = 1
                path = "/c:/Users/flavi/.antigravity-ide/extensions/fromeroc9.testform-dsl-$version"
                scheme = "file"
            }
            relativeLocation = "fromeroc9.testform-dsl-$version"
            metadata = [PSCustomObject]@{
                installedTimestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                pinned = $false
                source = "vsix"
            }
        }
        $filtered += $entry
        $filtered | ConvertTo-Json -Depth 10 | Set-Content $extJsonPath -Encoding utf8
    } catch {
        Write-Warning "Could not update extensions.json: $_"
    }
}

# Remove from .obsolete if present
$obsoletePath = "$extDir\.obsolete"
if (Test-Path $obsoletePath) {
    try {
        $obs = Get-Content $obsoletePath -Raw | ConvertFrom-Json
        if ($obs."fromeroc9.testform-dsl-$version") {
            $obs.PSObject.Properties.Remove("fromeroc9.testform-dsl-$version")
            $obs | ConvertTo-Json | Set-Content $obsoletePath -Encoding utf8
        }
    } catch {}
}

Write-Host "Antigravity IDE extension updated and registered successfully in $targetDir"
