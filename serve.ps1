param([int]$Port = 5500)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $root"
Write-Host "Open http://localhost:$Port  (press Ctrl+C to stop)"
$mime = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".json"="application/json"; ".webmanifest"="application/manifest+json"; ".svg"="image/svg+xml"; ".png"="image/png"; ".jpg"="image/jpeg"; ".ico"="image/x-icon"; ".woff2"="font/woff2"; ".txt"="text/plain" }
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath)
    if ($p.EndsWith("/")) { $p += "index.html" }
    $full = [IO.Path]::GetFullPath((Join-Path $root ($p.TrimStart("/").Replace("/", "\"))))
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $c.Response.ContentType = $mime[$ext] } else { $c.Response.ContentType = "application/octet-stream" }
      $c.Response.Headers.Add("Cache-Control", "no-store")
      $b = [IO.File]::ReadAllBytes($full)
      $c.Response.ContentLength64 = $b.Length
      $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch { $c.Response.StatusCode = 500 }
  $c.Response.Close()
}
