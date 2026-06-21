param(
  [int]$Port = 5050,
  [switch]$SkipWebhooks
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $Workspace ".tools"
$LogsDir = Join-Path $ToolsDir "logs"
$Cloudflared = Join-Path $ToolsDir "cloudflared.exe"
$EnvPath = Join-Path $Workspace ".env"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TunnelOut = Join-Path $LogsDir "local-tunnel-$Timestamp.out.log"
$TunnelErr = Join-Path $LogsDir "local-tunnel-$Timestamp.err.log"
$DevOut = Join-Path $LogsDir "local-panel-$Timestamp.out.log"
$DevErr = Join-Path $LogsDir "local-panel-$Timestamp.err.log"

function Write-Step($Message) {
  Write-Output "==> $Message"
}

function Read-EnvFile($Path) {
  $values = @{}
  if (!(Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*#" -or $line -notmatch "=") {
      continue
    }
    $index = $line.IndexOf("=")
    if ($index -lt 1) {
      continue
    }
    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Set-EnvValue($Path, $Key, $Value) {
  $lines = @()
  if (Test-Path -LiteralPath $Path) {
    $lines = @(Get-Content -LiteralPath $Path)
  }

  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") {
      $lines[$i] = "$Key=$Value"
      $found = $true
    }
  }

  if (!$found) {
    $lines += "$Key=$Value"
  }

  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Stop-WorkspaceProcess($Name, $CommandPattern) {
  try {
    Get-CimInstance Win32_Process -Filter "name = '$Name'" |
      Where-Object { $_.CommandLine -like $CommandPattern } |
      ForEach-Object {
        Write-Step "Parando processo $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {
    Write-Warning "Nao consegui consultar processos via CIM: $($_.Exception.Message)"
  }
}

function Stop-WorkspaceNodeApps() {
  try {
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
      Where-Object {
        $_.CommandLine -like "*$Workspace*" -and
        (
          $_.CommandLine -match "vite" -or
          $_.CommandLine -match "production-server\.mjs" -or
          $_.CommandLine -match "@tanstack"
        )
      } |
      ForEach-Object {
        Write-Step "Fechando painel antigo do projeto no PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {
    Write-Warning "Nao consegui consultar processos Node via CIM: $($_.Exception.Message)"
  }
}

function Stop-PortListener($Port) {
  $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  $pids = @()
  foreach ($line in netstat -ano) {
    if ($line -match $pattern) {
      $pids += [int]$Matches[1]
    }
  }
  $pids | Select-Object -Unique | ForEach-Object {
    Write-Step "Liberando porta $Port no PID $_"
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForTunnelUrl($ErrLog, $OutLog) {
  $pattern = "https://[-a-z0-9]+\.trycloudflare\.com"
  $deadline = (Get-Date).AddSeconds(90)
  do {
    foreach ($path in @($ErrLog, $OutLog)) {
      if (Test-Path -LiteralPath $path) {
        $content = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
        if ([string]::IsNullOrWhiteSpace($content)) {
          continue
        }
        $match = [regex]::Match($content, $pattern)
        if ($match.Success) {
          return $match.Value
        }
      }
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "Nao consegui obter a URL do Cloudflare Tunnel. Veja o log: $ErrLog"
}

function Wait-ForHttp($Url, $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

function ConvertTo-Base64UrlSha256($Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $hash = $sha.ComputeHash($bytes)
  return [Convert]::ToBase64String($hash).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Set-TelegramWebhook($Label, $Token, $Namespace, $Url, $AllowedUpdates) {
  if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Warning "$Label sem token no .env; pulando webhook."
    return
  }

  $secret = ConvertTo-Base64UrlSha256 "$Namespace`:$Token"
  $body = @{
    url = $Url
    secret_token = $secret
    allowed_updates = $AllowedUpdates
    drop_pending_updates = $false
  } | ConvertTo-Json -Depth 4

  $endpoint = "https://api.telegram.org/bot$Token/setWebhook"
  $response = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
  if (!$response.ok) {
    throw "Telegram recusou o webhook do $Label"
  }
  Write-Step "$Label conectado em $Url"
}

New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

if (!(Test-Path -LiteralPath $Cloudflared)) {
  throw "cloudflared.exe nao encontrado em $Cloudflared"
}

if (!(Test-Path -LiteralPath $EnvPath)) {
  throw ".env nao encontrado em $EnvPath"
}

Write-Step "Parando painel/tunel antigos"
Stop-WorkspaceProcess "cloudflared.exe" "*$Workspace*cloudflared.exe*"
Stop-WorkspaceNodeApps
Stop-PortListener $Port
Start-Sleep -Seconds 2

Write-Step "Subindo Cloudflare Tunnel para localhost:$Port"
$tunnelProcess = Start-Process -FilePath $Cloudflared `
  -ArgumentList @("tunnel", "--url", "http://localhost:$Port", "--no-autoupdate") `
  -WorkingDirectory $Workspace `
  -RedirectStandardOutput $TunnelOut `
  -RedirectStandardError $TunnelErr `
  -WindowStyle Hidden `
  -PassThru

$publicUrl = Wait-ForTunnelUrl $TunnelErr $TunnelOut
Write-Step "URL publica nova: $publicUrl"
Set-EnvValue $EnvPath "PUBLIC_BASE_URL" $publicUrl

Write-Step "Subindo painel em http://localhost:$Port"
$devProcess = Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev", "--", "--host", "0.0.0.0", "--port", "$Port") `
  -WorkingDirectory $Workspace `
  -RedirectStandardOutput $DevOut `
  -RedirectStandardError $DevErr `
  -WindowStyle Hidden `
  -PassThru

if (!(Wait-ForHttp "http://localhost:$Port/" 90)) {
  throw "O painel nao respondeu em http://localhost:$Port. Veja o log: $DevErr"
}

if (!(Wait-ForHttp $publicUrl 60)) {
  Write-Warning "O painel local respondeu, mas a URL publica ainda nao respondeu. O Cloudflare pode demorar alguns segundos."
}

if (!$SkipWebhooks) {
  Write-Step "Reconectando webhooks dos bots"
  $envValues = Read-EnvFile $EnvPath
  Set-TelegramWebhook "Bot de vendas" `
    $envValues["TELEGRAM_BOT_TOKEN"] `
    "telegram-webhook" `
    "$publicUrl/api/public/telegram/webhook" `
    @("message", "channel_post", "callback_query", "my_chat_member", "chat_join_request")
  Set-TelegramWebhook "UpMidias" `
    $envValues["IMAGE_BOT_TOKEN"] `
    "telegram-image-webhook" `
    "$publicUrl/api/public/telegram/image-webhook" `
    @("message", "callback_query", "my_chat_member")
  & node (Join-Path $Workspace "scripts/reconnect-sales-clones.mjs") $publicUrl
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Nao foi possivel reconectar um ou mais clones do bot Bruna."
  }
}

Write-Output ""
Write-Output "Pronto."
Write-Output "Painel: http://localhost:$Port/bots"
Write-Output "URL publica atual: $publicUrl"
Write-Output "Logs do painel: $DevOut"
Write-Output "Logs do tunel:  $TunnelErr"
