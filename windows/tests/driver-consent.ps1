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
        if($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){
            $invoke.Invoke()
        }else{
            # The Windows publisher dialog exposes Install as an accessible pane
            # on Server 2022. Use its visible click point, just as a tester would.
            if(!('DriverTestPointer' -as [type])){
                Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DriverTestPointer {
    [DllImport("user32")] public static extern bool SetCursorPos(int x,int y);
    [DllImport("user32")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
            }
            $rect=$button.Current.BoundingRectangle
            if($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0){continue}
            $point=New-Object System.Windows.Point(($rect.X+$rect.Width/2),($rect.Y+$rect.Height/2))
            $hit=[System.Windows.Automation.AutomationElement]::FromPoint($point)
            if($hit.Current.ProcessId -ne $window.Current.ProcessId -or $hit.Current.Name.Replace('&','').Trim() -ne 'Install'){continue}
            if(![DriverTestPointer]::SetCursorPos([int]$point.X,[int]$point.Y)){continue}
            [DriverTestPointer]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
            [DriverTestPointer]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        }
        Write-Host '::notice::Approved the verified SignPath Foundation driver once in the disposable test VM.'
        return $true
    }
    return $false
}
