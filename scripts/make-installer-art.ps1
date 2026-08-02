# יוצר את תמונות המיתוג של המתקין (BMP 24-bit) בצבעי NF-Blaze, עם System.Drawing.
Add-Type -AssemblyName System.Drawing

$bg1  = [System.Drawing.Color]::FromArgb(20, 25, 34)    # #141922
$bg2  = [System.Drawing.Color]::FromArgb(12, 15, 20)    # #0c0f14
$acc1 = [System.Drawing.Color]::FromArgb(240, 160, 75)  # #f0a04b
$acc2 = [System.Drawing.Color]::FromArgb(224, 138, 46)  # #e08a2e
$text = [System.Drawing.Color]::FromArgb(232, 232, 234) # #e8e8ea
$muted= [System.Drawing.Color]::FromArgb(139, 149, 165) # #8b95a5
$outDir = Join-Path $PSScriptRoot '..\build'

function New-Bmp([int]$w, [int]$h, [scriptblock]$draw) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'ClearTypeGridFit'
  & $draw $g $w $h
  $g.Dispose()
  return $bmp
}

function Draw-RoundRect($g, $x, $y, $w, $h, $r, $brush) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r, $r, 180, 90)
  $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
  $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
  $p.CloseFigure()
  $g.FillPath($brush, $p)
  $p.Dispose()
}

# ---- Sidebar 164x314 (מסכי פתיחה/סיום) ----
$side = New-Bmp 164 314 {
  param($g, $w, $h)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bg1, $bg2, 90)
  $g.FillRectangle($grad, $rect)
  # פס אקסנט עליון
  $accGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0,0,$w,4)), $acc1, $acc2, 0)
  $g.FillRectangle($accGrad, 0, 0, $w, 4)
  # ריבוע לוגו NF
  $accBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(46,60,72,72)), $acc1, $acc2, 45)
  Draw-RoundRect $g 46 60 72 72 18 $accBrush
  $fLogo = New-Object System.Drawing.Font('Segoe UI', 26, [System.Drawing.FontStyle]::Bold)
  $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26,18,6))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('NF', $fLogo, $darkBrush, (New-Object System.Drawing.RectangleF(46,60,72,72)), $sf)
  # שם המוצר
  $fName = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
  $tBrush = New-Object System.Drawing.SolidBrush($text)
  $g.DrawString('NF-Blaze', $fName, $tBrush, (New-Object System.Drawing.RectangleF(0,150,$w,26)), $sf)
  # תיאור
  $fSub = New-Object System.Drawing.Font('Segoe UI', 8.5)
  $mBrush = New-Object System.Drawing.SolidBrush($muted)
  $g.DrawString('AI System Builder', $fSub, $mBrush, (New-Object System.Drawing.RectangleF(0,180,$w,20)), $sf)
  # פס אקסנט תחתון
  $g.FillRectangle($accGrad, 0, $h-4, $w, 4)
}
$side.Save((Join-Path $outDir 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$side.Dispose()

# ---- Header 150x57 (מסכים פנימיים, פינה עליונה) ----
$head = New-Bmp 150 57 {
  param($g, $w, $h)
  $g.Clear($bg1)
  $accBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(10,13,32,32)), $acc1, $acc2, 45)
  Draw-RoundRect $g 10 13 32 32 9 $accBrush
  $fLogo = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26,18,6))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('NF', $fLogo, $darkBrush, (New-Object System.Drawing.RectangleF(10,13,32,32)), $sf)
  $fName = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $tBrush = New-Object System.Drawing.SolidBrush($text)
  $sfL = New-Object System.Drawing.StringFormat; $sfL.LineAlignment = 'Center'
  $g.DrawString('NF-Blaze', $fName, $tBrush, (New-Object System.Drawing.RectangleF(50,13,95,32)), $sfL)
}
$head.Save((Join-Path $outDir 'installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$head.Dispose()

Get-ChildItem (Join-Path $outDir 'installer*.bmp') | ForEach-Object { "$($_.Name): $([math]::Round($_.Length/1KB,1)) KB" }
