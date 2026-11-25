# Exercise the ordinary one-time publisher prompt in a disposable Windows VM.
# A warning about an unknown publisher must remain unapproved.
function Confirm-TestDriverPublisher {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:PASM_RUNNER_KIND -ne 'github-hosted') { return $false }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root=[System.Windows.Automation.AutomationElement]::RootElement
    $condition=[System.Windows.Automation.Condition]::TrueCondition
    foreach($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)){
        if($window.Current.Name -ne 'Windows Security'){continue}
        $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
        $names=@($all | ForEach-Object {$_.Current.Name})
        $text=$names -join ' / '
        if($text -notmatch 'Would you like to install this device software\?' -or $text -notmatch 'Always trust software from "SignPath Foundation"'){continue}
        $button=$null
        $choice=$null
        foreach($control in $all){
            $name=$control.Current.Name.Replace('&','').Trim()
            if($name -eq 'Install'){$button=$control}
            if($name -like 'Always trust software from "SignPath Foundation"*'){$choice=$control}
        }
        if(!$button -or !$choice){continue}
        $detail="Install control: $($button.Current.ControlType.ProgrammaticName) enabled=$($button.Current.IsEnabled); choice: $($choice.Current.ControlType.ProgrammaticName)"
        if(!$script:reportedDriverDialog){Write-Host "::notice::$detail";$script:reportedDriverDialog=$true}
        $toggle=$null
        if(!$choice.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$toggle)){continue}
        if($toggle.Current.ToggleState.ToString() -eq 'On'){$toggle.Toggle();return $false}
        if($toggle.Current.ToggleState.ToString() -ne 'Off' -or !$button.Current.IsEnabled){continue}
        $invoke=$null
        if(!$button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){continue}
        $invoke.Invoke()
        Write-Host '::notice::Approved the verified SignPath Foundation driver once in the disposable test VM.'
        return $true
    }
    return $false
}
