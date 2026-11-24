# Keeps the Play upload key's password for the owner, so it is never lost and signing needs no typing
# (owner, 2026-11-24: "make a place for it ... i will prob lose it").
# The owner types it here once; it is checked against the key, then saved encrypted with Windows' protection for
# this Windows account (DPAPI) beside the key: only this account on this PC can read it back. Nothing else sees it.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE 'Documents\SoferBooks Library signing key'
$ks = Join-Path $dir 'soferbooks-library-upload.keystore'
$file = Join-Path $dir 'upload-password.dpapi'
$keytool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
if (-not (Test-Path $ks)) { throw "No upload key at $ks" }

$secure = Read-Host -AsSecureString 'Type the upload key password (nothing shows as you type)'
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
# (checked: the key opens with it)
$env:SOFERBOOKS_UPLOAD_PASS = $plain
& $keytool -list -keystore $ks -storepass:env SOFERBOOKS_UPLOAD_PASS -alias upload *> $null
$ok = ($LASTEXITCODE -eq 0)
Remove-Item Env:\SOFERBOOKS_UPLOAD_PASS
$plain = $null
if (-not $ok) { Write-Host 'That is not the key''s password: nothing saved. Run this again.' -ForegroundColor Red; exit 1 }

$secure | ConvertFrom-SecureString | Set-Content -Path $file -Encoding ASCII
Write-Host "Saved, encrypted for your Windows account: $file" -ForegroundColor Green
Write-Host 'Signing will use it from now on. (On another computer it cannot be read: keep the password in a password manager or on paper too.)'
