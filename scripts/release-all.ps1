#requires -Version 7.0
<#
.SYNOPSIS
  One-click build + GitHub / Gitee / GitCode release for nuaa-oj-vscode.

.DESCRIPTION
  - Reads the version from package.json unless -Version is supplied.
  - Optionally compiles and packages the VSIX.
  - Commits (with -CommitMessage) if the worktree is dirty, tags and pushes GitHub.
  - Creates/updates the GitHub release and uploads the VSIX.
  - Pushes the tag/branch to Gitee, creates/updates the Gitee release and uploads
    the VSIX through Gitee's attach_files API.
  - Creates/updates the GitCode release and uploads the VSIX if the GitCode
    mirror has already synced. GitCode image repositories cannot accept a git
    push, so if the mirror is behind the script prints the web sync URL and
    asks you to re-run after clicking Sync.

.EXAMPLE
  pwsh -File .\scripts\release-all.ps1 -Notes "修复若干问题"

.EXAMPLE
  pwsh -File .\scripts\release-all.ps1 -SkipBuild -SkipGitHub -SkipGitee `
    -Version 1.10.22 -Notes "只补 GitCode release"

.NOTES
  Required once:
    gh auth login
    gitee auth login            # PAT, projects permission
    gitcode auth login --web
  Gitee token is read from -GiteeToken, $env:GITEE_TOKEN, or `gitee auth token`.
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$Notes,
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$GitHubRepo = "Buger2008/nuaa-oj-vscode",
  [string]$GiteeRepo = "buger2008/nuaa-oj-vscode",
  [string]$GitCodeRepo = "buger2008/nuaa-oj-vscode",
  [string]$GiteeToken,
  [string]$GitCodeCli = "$env:LOCALAPPDATA\gitcode-cli\bin\gitcode.exe",
  [string]$CommitMessage,
  [bool]$SyncGiteeBranch = $true,
  [int]$MirrorWaitSeconds = 0,
  [switch]$SkipBuild,
  [switch]$SkipGitHub,
  [switch]$SkipGitee,
  [switch]$SkipGitCode,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$script:Failures = [System.Collections.Generic.List[string]]::new()

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}
function Write-Ok([string]$Message) { Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-Warn2([string]$Message) { Write-Host "    WARN $Message" -ForegroundColor Yellow }
function Add-Failure([string]$Message) {
  $script:Failures.Add($Message) | Out-Null
  Write-Host "    FAIL $Message" -ForegroundColor Red
}
function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}
function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$IgnoreExitCode,
    [switch]$Quiet
  )
  if (-not $Quiet) {
    Write-Host ("    > {0} {1}" -f (Split-Path $FilePath -Leaf), ($ArgumentList -join " ")) -ForegroundColor DarkGray
  }
  & $FilePath @ArgumentList 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $IgnoreExitCode) {
    throw "$FilePath failed with exit code $code"
  }
  return $code
}
function Get-RemoteHead([string]$RemoteUrl) {
  $lines = & git ls-remote $RemoteUrl HEAD 2>$null
  if (-not $lines) { return "" }
  return (($lines | Select-Object -First 1) -split "`t")[0].Trim()
}
function Invoke-GiteeApi {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [object]$Body
  )
  $url = "https://gitee.com/api/v5/repos/$GiteeRepo$Path"
  $sep = if ($url.Contains("?")) { "&" } else { "?" }
  $url = "$url${sep}access_token=$GiteeToken"
  $p = @{
    Method = $Method
    Uri = $url
    Headers = @{ Accept = "application/json" }
    SkipHttpErrorCheck = $true
    TimeoutSec = 60
  }
  if ($null -ne $Body) {
    $p.ContentType = "application/json"
    $p.Body = ($Body | ConvertTo-Json -Depth 5 -Compress)
  }
  $r = Invoke-WebRequest @p
  if ([int]$r.StatusCode -ge 400) {
    throw "Gitee API $Method $Path -> HTTP $($r.StatusCode): $($r.Content)"
  }
  if ([string]::IsNullOrWhiteSpace($r.Content)) { return $null }
  return $r.Content | ConvertFrom-Json
}

# ---------------------------------------------------------------- inputs
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  throw "package.json not found under RepoRoot=$RepoRoot"
}
Push-Location $RepoRoot
try {
  $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
  if (-not $Version) { $Version = [string]$pkg.version }
  if (-not $Version) { throw "Cannot determine version" }
  if (-not $Notes) { $Notes = [string]$env:RELEASE_NOTES }
  if (-not $Notes) { $Notes = $Version }
  $extName = [string]$pkg.name
  $vsix = Join-Path $RepoRoot "$extName-$Version.vsix"

  Write-Host "Release target:" -ForegroundColor White
  Write-Host "  repo      : $RepoRoot"
  Write-Host "  version   : $Version"
  Write-Host "  vsix      : $vsix"
  Write-Host "  GitHub    : $GitHubRepo"
  Write-Host "  Gitee     : $GiteeRepo"
  Write-Host "  GitCode   : $GitCodeRepo"

  if ($DryRun) { Write-Ok "DryRun only"; return }

  # ------------------------------------------------------------ git state
  Write-Step "Git worktree"
  $dirty = @(& git status --porcelain)
  if ($dirty.Count -gt 0) {
    if (-not $CommitMessage) {
      throw "Worktree is dirty. Commit first or pass -CommitMessage `"...`"."
    }
    Invoke-Native git @("add", "-A")
    Invoke-Native git @("-c", "user.name=Buger", "-c", "user.email=buger7852008@163.com", "commit", "-m", $CommitMessage)
  }
  $sha = (& git rev-parse HEAD).Trim()
  Write-Ok "HEAD $sha"

  # ------------------------------------------------------------ build
  if (-not $SkipBuild) {
    Write-Step "Build TypeScript + VSIX"
    Assert-Command npx
    Invoke-Native npx @("tsc", "-p", "./")
    Invoke-Native npx @("vsce", "package", "--no-dependencies", "--allow-missing-repository")
  }
  if (-not (Test-Path $vsix)) {
    throw "VSIX missing: $vsix (run without -SkipBuild first)"
  }
  $vsixSize = (Get-Item $vsix).Length
  Write-Ok "$(Split-Path $vsix -Leaf) ($vsixSize bytes)"

  if (-not $SkipGitHub) {
    # ---------------------------------------------------------- GitHub
    Write-Step "GitHub: tag + push + release"
    Assert-Command git
    Assert-Command gh

    # Local tag, force so a rerun after an amend points at the new HEAD.
    Invoke-Native git @("tag", "-f", $Version)

    $pushed = $false
    for ($i = 1; $i -le 30; $i++) {
      Write-Host "    push attempt $i/30" -ForegroundColor DarkGray
      & git push origin "HEAD:refs/heads/main" 2>&1 | ForEach-Object { Write-Host $_ }
      $pushCode = $LASTEXITCODE
      if ($pushCode -eq 0) {
        $remote = Get-RemoteHead "origin"
        if ($remote -eq $sha) { $pushed = $true; break }
      }
      Start-Sleep -Seconds 6
    }
    if (-not $pushed) { throw "GitHub push failed after 30 attempts" }
    Write-Ok "GitHub main = $sha"

    # Tag is cheap; force update it too.
    & git push origin "+refs/tags/$Version:refs/tags/$Version" 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "GitHub tag push failed (release may still auto-create it)" }

    $ghView = & gh release view $Version -R $GitHubRepo --json tagName,assets 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $ghView) {
      Invoke-Native gh @("release", "create", $Version, "-R", $GitHubRepo, "--title", $Version, "--notes", $Notes, "--target", $sha)
      Write-Ok "GitHub release created"
    } else {
      Invoke-Native gh @("release", "edit", $Version, "-R", $GitHubRepo, "--title", $Version, "--notes", $Notes) -IgnoreExitCode
      Write-Ok "GitHub release exists"
    }

    $assetsJson = & gh release view $Version -R $GitHubRepo --json assets 2>$null
    $assetNames = @()
    if ($assetsJson) {
      $assetNames = @(($assetsJson | ConvertFrom-Json).assets | ForEach-Object { $_.name })
    }
    if ($assetNames -contains (Split-Path $vsix -Leaf)) {
      Write-Ok "GitHub asset already present"
    } else {
      $uploaded = $false
      for ($i = 1; $i -le 12; $i++) {
        Write-Host "    gh release upload attempt $i/12" -ForegroundColor DarkGray
        & gh release upload $Version $vsix --clobber -R $GitHubRepo 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0) {
          Start-Sleep -Seconds 2
          $again = & gh release view $Version -R $GitHubRepo --json assets 2>$null
          if ($again) {
            $names = @(($again | ConvertFrom-Json).assets | ForEach-Object { $_.name })
            if ($names -contains (Split-Path $vsix -Leaf)) { $uploaded = $true; break }
          }
        }
        Start-Sleep -Seconds 5
      }
      if ($uploaded) {
        Write-Ok "GitHub asset uploaded"
      } else {
        Add-Failure "GitHub release exists but asset upload failed. Open https://github.com/$GitHubRepo/releases/edit/$Version and drag $(Split-Path $vsix -Leaf)"
      }
    }
  }

  if (-not $SkipGitee) {
    # ---------------------------------------------------------- Gitee
    Write-Step "Gitee: sync + tag + release + asset"
    if (-not $GiteeToken) { $GiteeToken = [string]$env:GITEE_TOKEN }
    if (-not $GiteeToken) {
      Assert-Command gitee
      $GiteeToken = (gitee auth token 2>$null | Out-String).Trim()
    }
    if (-not $GiteeToken) {
      throw "Gitee token missing. Run `gitee auth login`, set GITEE_TOKEN, or pass -GiteeToken."
    }

    $giteeUrl = "https://oauth2:$GiteeToken@gitee.com/$GiteeRepo.git"

    # Gitee mirror does not sync tags automatically; push the tag explicitly.
    # NOTE: git wants the remote URL BEFORE the refspec.
    & git push $giteeUrl "+refs/tags/$Version:refs/tags/$Version" 2>&1 |
      ForEach-Object { Write-Host ($_ -replace [regex]::Escape($GiteeToken), "***") }
    if ($LASTEXITCODE -ne 0) { Add-Failure "Gitee tag push failed; release tag may be missing" }

    if ($SyncGiteeBranch) {
      # This is faster and more deterministic than waiting for the web mirror.
      & git push $giteeUrl "HEAD:refs/heads/main" 2>&1 |
        ForEach-Object { Write-Host ($_ -replace [regex]::Escape($GiteeToken), "***") }
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "Gitee main synced"
      } else {
        Write-Warn2 "Gitee branch push rejected (protected branch?). Click Sync on https://gitee.com/$GiteeRepo"
      }
    }

    $release = $null
    try {
      $release = Invoke-GiteeApi -Method GET -Path "/releases/tags/$Version"
    } catch {
      $release = $null
    }
    if (-not $release) {
      $release = Invoke-GiteeApi -Method POST -Path "/releases" -Body @{
        tag_name = $Version
        name = $Version
        body = $Notes
        target_commitish = $sha
        prerelease = $false
      }
      Write-Ok "Gitee release created (id=$($release.id))"
    } else {
      $release = Invoke-GiteeApi -Method PATCH -Path "/releases/$($release.id)" -Body @{
        tag_name = $Version
        name = $Version
        body = $Notes
        prerelease = $false
      }
      Write-Ok "Gitee release updated (id=$($release.id))"
    }

    $assetName = Split-Path $vsix -Leaf
    $attachments = @()
    try {
      $attachments = @(Invoke-GiteeApi -Method GET -Path "/releases/$($release.id)/attach_files?per_page=100")
    } catch { $attachments = @() }
    $already = $attachments | Where-Object { $_.name -eq $assetName -and [int64]$_.size -eq $vsixSize } | Select-Object -First 1
    if ($already) {
      Write-Ok "Gitee asset already present (id=$($already.id))"
    } else {
      $attachUrl = "https://gitee.com/api/v5/repos/$GiteeRepo/releases/$($release.id)/attach_files?access_token=$GiteeToken"
      $attachOut = & curl.exe -sS -f -X POST -F "file=@$vsix" $attachUrl 2>&1
      $attachText = ($attachOut | Out-String) -replace [regex]::Escape($GiteeToken), "***"
      if ($LASTEXITCODE -ne 0 -or $attachText -match '"message"') {
        Add-Failure "Gitee asset upload failed: $attachText"
      } else {
        $uploaded = $attachText | ConvertFrom-Json
        Write-Ok "Gitee asset uploaded (id=$($uploaded.id))"
      }
    }
  }

  if (-not $SkipGitCode) {
    # ---------------------------------------------------------- GitCode
    Write-Step "GitCode: mirror check + release + asset"
    $gc = $GitCodeCli
    if (-not (Test-Path $gc)) {
      $cmd = Get-Command gitcode -ErrorAction SilentlyContinue
      if ($cmd) { $gc = $cmd.Source } else { $gc = $null }
    }
    if (-not $gc) {
      Add-Failure "GitCode CLI not found. Install it or pass -GitCodeCli <path>."
    } else {
      $gcHead = Get-RemoteHead "https://gitcode.com/$GitCodeRepo.git"
      if ($gcHead -ne $sha) {
        if ($MirrorWaitSeconds -gt 0) {
          Write-Warn2 "GitCode mirror is at $gcHead, waiting up to $MirrorWaitSeconds sec for $sha ..."
          $deadline = (Get-Date).AddSeconds($MirrorWaitSeconds)
          while ((Get-Date) -lt $deadline -and $gcHead -ne $sha) {
            Start-Sleep -Seconds 20
            $gcHead = Get-RemoteHead "https://gitcode.com/$GitCodeRepo.git"
            Write-Host "    GitCode HEAD: $gcHead" -ForegroundColor DarkGray
          }
        }
      }

      if ($gcHead -ne $sha) {
        Add-Failure "GitCode mirror is not synced (HEAD=$gcHead, expected=$sha). Open https://gitcode.com/$GitCodeRepo and click Sync, then rerun: pwsh -File .\scripts\release-all.ps1 -Version $Version -SkipBuild -SkipGitHub -SkipGitee"
      } else {
        Write-Ok "GitCode main = $sha"
        $gcView = & $gc release view $Version -R $GitCodeRepo --json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $gcView) {
          Invoke-Native $gc @("release", "create", $Version, "-R", $GitCodeRepo, "--title", $Version, "--notes", $Notes, "--target", $sha, "--no-interactive")
          Write-Ok "GitCode release created"
        } else {
          Write-Ok "GitCode release exists"
        }
        Invoke-Native $gc @("release", "upload", $Version, $vsix, "-R", $GitCodeRepo, "--no-interactive") -IgnoreExitCode
        $gcCheck = & $gc release view $Version -R $GitCodeRepo --json 2>$null
        if ($LASTEXITCODE -eq 0 -and $gcCheck) {
          Write-Ok "GitCode release/assets refreshed"
        } else {
          Add-Failure "GitCode release verification failed"
        }
      }
    }
  }

  # ------------------------------------------------------------ summary
  Write-Step "Summary"
  Write-Host "  version : $Version"
  Write-Host "  commit  : $sha"
  Write-Host "  vsix    : $vsix ($vsixSize bytes)"
  if ($script:Failures.Count -eq 0) {
    Write-Host "  result  : ALL OK" -ForegroundColor Green
    exit 0
  } else {
    Write-Host "  result  : COMPLETED WITH $($script:Failures.Count) ISSUE(S)" -ForegroundColor Yellow
    foreach ($f in $script:Failures) { Write-Host "    - $f" -ForegroundColor Yellow }
    exit 1
  }
}
finally {
  Pop-Location
}
