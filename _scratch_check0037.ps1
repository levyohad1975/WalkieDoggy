$path = 'C:\actions-runner\_work\WalkieDoggy\WalkieDoggy\supabase\migrations\0037_deactivate_push_on_member_removal.sql'
$bytes = [System.IO.File]::ReadAllBytes($path)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$lf = [string][char]10
$needle = 'update users' + $lf + '  set removed_at = now()'
$idx = $text.IndexOf($needle)
Write-Output 'idx result:'
Write-Output $idx
$idx2 = $text.IndexOf('update users')
Write-Output 'idx2 result:'
Write-Output $idx2
$snippet = $text.Substring($idx2, 60)
$snippet2 = $snippet.Replace([char]13,'R').Replace([char]10,'N')
Write-Output 'snippet:'
Write-Output $snippet2
