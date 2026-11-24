# The Google Play upload key for SoferBooks Library, and the release bundle signed with it (play-store/README.md).
# The key is made once, in Documents\SoferBooks Library signing key (never in git); the password is typed here,
# by the owner, and is not written anywhere. Run again for a later release: it only signs.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE 'Documents\SoferBooks Library signing key'
$ks = Join-Path $dir 'soferbooks-library-upload.keystore'
$jbr = 'C:\Program Files\Android\Android Studio\jbr\bin'
$src = Join-Path $PSScriptRoot '..\android\app\build\outputs\bundle\release\app-release.aab'
$out = Join-Path $PSScriptRoot 'SoferBooks-Library-1.0.0-1.aab'

New-Item -ItemType Directory -Force $dir | Out-Null
if (Test-Path $ks) {
  Write-Host "The upload key is there already: $ks"
} else {
  Write-Host ''
  Write-Host 'Creating the upload key. Choose a password you will keep, and type it twice.' -ForegroundColor Cyan
  & (Join-Path $jbr 'keytool.exe') -genkeypair -keystore $ks -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Sofer Books LLC, O=Sofer Books LLC, C=US'
  if ($LASTEXITCODE) { throw 'keytool failed: no key made' }
}

Copy-Item $src $out -Force
Write-Host ''
# (the password kept by save-key-password.ps1, encrypted for this Windows account: no typing)
$kept = Join-Path $dir 'upload-password.dpapi'
if (Test-Path $kept) {
  Write-Host 'Signing the bundle with the kept password.' -ForegroundColor Cyan
  $secure = Get-Content $kept | ConvertTo-SecureString
  $env:SOFERBOOKS_UPLOAD_PASS = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  try {
    & (Join-Path $jbr 'jarsigner.exe') -keystore $ks -storepass:env SOFERBOOKS_UPLOAD_PASS -sigalg SHA256withRSA -digestalg SHA-256 $out upload
  } finally { Remove-Item Env:\SOFERBOOKS_UPLOAD_PASS -ErrorAction SilentlyContinue }
} else {
  Write-Host 'Signing the bundle. Type the same password.' -ForegroundColor Cyan
  & (Join-Path $jbr 'jarsigner.exe') -keystore $ks -sigalg SHA256withRSA -digestalg SHA-256 $out upload
}
if ($LASTEXITCODE) { throw 'jarsigner failed: the bundle is not signed' }

& (Join-Path $jbr 'jarsigner.exe') -verify $out | Select-Object -Last 1
& (Join-Path $jbr 'keytool.exe') -printcert -jarfile $out | Select-String 'SHA256:'
Write-Host ''
Write-Host "Done: $out" -ForegroundColor Green
