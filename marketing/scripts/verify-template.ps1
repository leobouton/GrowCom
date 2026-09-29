# Vérifie les formules du modèle Excel contre le moteur de calcul (Windows + Excel requis).
# Ouvre le fichier en lecture seule, change le mode de paliers et le CA initial, fait recalculer Excel,
# puis compare chaque commission aux valeurs attendues (scripts/template-expectations.json, produit par le moteur).
# Lancer : powershell -ExecutionPolicy Bypass -File scripts/verify-template.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$workbookPath = Join-Path $root 'public\modele\grille-de-commissionnement-growcom.xlsx'
$expected = Get-Content (Join-Path $PSScriptRoot 'template-expectations.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$failures = 0
$checks = 0
try {
  $workbook = $excel.Workbooks.Open($workbookPath, 0, $true)
  $grid = $workbook.Worksheets.Item('Grille')
  $sales = $workbook.Worksheets.Item('Ventes')
  foreach ($scenario in $expected.scenarios) {
    $grid.Range('B10').Value2 = [double]$scenario.prior
    foreach ($mode in $scenario.commissions.PSObject.Properties) {
      $grid.Range('B9').Value2 = $mode.Name
      $excel.CalculateFull()
      $values = $mode.Value
      for ($i = 0; $i -lt $values.Count; $i++) {
        $row = 6 + $i
        $actual = [double]$sales.Range("H$row").Value2
        $want = [double]$values[$i]
        $checks++
        if ([math]::Abs($actual - $want) -gt 0.005) {
          $failures++
          Write-Output ("FAIL  CA initial {0} | {1} | vente {2} : Excel {3} / moteur {4}" -f $scenario.prior, $mode.Name, ($i + 1), $actual, $want)
        }
      }
    }
  }
  $workbook.Close($false)
} finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [GC]::Collect()
}
if ($failures -eq 0) { Write-Output "OK  $checks commissions Excel identiques au moteur" } else { Write-Output "$failures / $checks écarts"; exit 1 }
