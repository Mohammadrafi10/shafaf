# Upload webhost/ to remote server via FTP (anonymous, replace existing).
# Usage: .\scripts\upload-webhost.ps1
#        .\scripts\upload-webhost.ps1 -RemotePath "/webhost"
# Anonymous root = /var/www/uploads on server → upload to FTP "/" (default).
# 550? On server ensure: anon_upload_enable=YES, anon_mkdir_write_enable=YES, write_enable=YES; dir chown ftp:ftp, chmod 775.

param(
    [string]$HostName = "76.13.42.156",
    [string]$RemotePath = "/",
    [string]$FtpUser = "anonymous",
    [string]$FtpPassword = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WebhostPath = Join-Path $ProjectRoot "webhost"
if (-not (Test-Path $WebhostPath)) {
    Write-Error "webhost folder not found at $WebhostPath"
    exit 1
}

$baseUri = [Uri]"ftp://$HostName/"
$credentials = New-Object System.Net.NetworkCredential($FtpUser, $FtpPassword)

function Ensure-FtpDirectory {
    param([string]$path)
    if ([string]::IsNullOrWhiteSpace($path) -or $path -eq "/") { return }
    $segments = $path.TrimStart('/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    $current = ""
    foreach ($seg in $segments) {
        $current = $current + "/" + $seg
        $uri = [Uri]::new($baseUri, $current.TrimStart('/'))
        try {
            $req = [System.Net.FtpWebRequest]::Create($uri)
            $req.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
            $req.Credentials = $credentials
            $req.UseBinary = $true
            $req.UsePassive = $true
            $req.KeepAlive = $false
            $req.GetResponse().Close()
        } catch {
            $code = $_.Exception.Response.StatusCode
            if ($code -eq 550) { continue }
            throw
        }
    }
}

function Send-FtpFile {
    param([string]$localPath, [string]$remoteRelativePath)
    $remoteDir = [System.IO.Path]::GetDirectoryName($remoteRelativePath).Replace("\", "/")
    $remoteFile = [System.IO.Path]::GetFileName($remoteRelativePath)
    $base = $RemotePath.TrimEnd('/')
    $relativePath = if ($remoteDir) { "$base/$remoteDir/$remoteFile" } else { "$base/$remoteFile" }
    $relativePath = $relativePath.TrimStart('/').Replace("//", "/")
    $dirToEnsure = if ($remoteDir) { "$base/$remoteDir" } else { $base }
    Ensure-FtpDirectory -path $dirToEnsure.TrimStart('/')
    $uri = [Uri]::new($baseUri, $relativePath)
    $req = [System.Net.FtpWebRequest]::Create($uri)
    $req.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
    $req.Credentials = $credentials
    $req.UseBinary = $true
    $req.UsePassive = $true
    $req.KeepAlive = $false
    $fileBytes = [System.IO.File]::ReadAllBytes($localPath)
    $req.ContentLength = $fileBytes.Length
    try {
        $reqStream = $req.GetRequestStream()
        try { $reqStream.Write($fileBytes, 0, $fileBytes.Length) } finally { $reqStream.Close() }
        $req.GetResponse().Close()
    } catch {
        $resp = $_.Exception.Response
        $msg = if ($resp) { "FTP $($resp.StatusCode) $($resp.StatusDescription)" } else { $_.Exception.Message }
        Write-Error "Upload failed for $remoteRelativePath : $msg"
        throw
    }
}

# Collect all files (excluding config.local.php, config.local.php.example, and .env)
$filesToUpload = @()
$exclude = @("config.local.php", "config.local.php.example", ".env")
Get-ChildItem -Path $WebhostPath -Recurse -File | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    $rel = $_.FullName.Substring($WebhostPath.Length).TrimStart('\', '/')
    $filesToUpload += @{ Local = $_.FullName; Relative = $rel }
}

if ($filesToUpload.Count -eq 0) {
    Write-Host "No files to upload (excluding config.local.php, config.local.php.example, .env)."
    exit 0
}

Write-Host "Uploading $($filesToUpload.Count) file(s) to ftp://$HostName$RemotePath (anonymous, replace)..."
foreach ($f in $filesToUpload) {
    Write-Host "  $($f.Relative)"
    Send-FtpFile -localPath $f.Local -remoteRelativePath $f.Relative
}
Write-Host "Done. URL: http://${HostName}$RemotePath/ (or your domain)"
