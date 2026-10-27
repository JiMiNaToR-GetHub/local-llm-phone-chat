$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$gpu = (Get-Counter '\GPU Engine(*)\Utilization Percentage').CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum
$vram = (Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage').CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum
$out = @{
    cpu = [math]::Round($cpu, 1)
    gpu = [math]::Round($gpu, 1)
    vram = [math]::Round($vram / 1GB, 1)
}
Write-Output ($out | ConvertTo-Json -Compress)
