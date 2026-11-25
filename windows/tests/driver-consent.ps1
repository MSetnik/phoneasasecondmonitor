# Only used by the installer UI test on a fresh GitHub-hosted Windows VM.
# Exercise the ordinary one-time user choice. A different signer or a warning
# about an unknown publisher must remain an unapproved installation.
function Confirm-TestDriverPublisher {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:PASM_RUNNER_KIND -ne 'github-hosted') { return $false }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root=[System.Windows.Automation.AutomationElement]::RootElement
    $condition=[System.Windows.Automation.Condition]::TrueCondition
    $windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
    foreach($window in $windows){
        if($window.Current.Name -ne 'Windows Security'){continue}
        $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
        $names=@($all | ForEach-Object {$_.Current.Name})
        if(!$script:reportedDriverDialog){Write-Host ("::notice::Windows driver dialog: " + (($names | Where-Object {$_} | Select-Object -Unique) -join ' / '));$script:reportedDriverDialog=$true}
        if(!($names -match 'SignPath Foundation') -or !($names -match 'install this device software')){continue}
        $button=$all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name.Replace('&','').Trim() -eq 'Install'} | Select-Object -First 1
        if(!$button){continue}
        foreach($choice in ($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox})){
            if($choice.Current.Name -notlike '*Always trust*'){return $false}
            $toggle=$choice.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            if($toggle.Current.ToggleState -eq 'On'){$toggle.Toggle()}
            if($toggle.Current.ToggleState -ne 'Off'){return $false}
        }
        $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Host '::notice::Approved the verified SignPath Foundation driver once in the disposable test VM.'
        return $true
    }
    return $false
}
