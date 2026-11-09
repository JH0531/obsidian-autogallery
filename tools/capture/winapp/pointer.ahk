; Pointer and modifier control for the capture layer.
;
; winapp 0.7.1 can click and drag at screen coordinates but cannot move the
; pointer without pressing a button, so hover states (gallery handles, inset
; alignment arrows) have no CLI path. This script does exactly two things:
;
;   AutoHotkey64.exe pointer.ahk move 1200 640 [speed]
;   AutoHotkey64.exe pointer.ahk down Shift | up Shift | allup
;
; Everything else (click, drag, keys, recording) stays in winapp.

#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon

; AutoHotkey v2 defaults Mouse commands to CLIENT coordinates. winapp works in
; physical screen pixels, so a move to 1293,628 landed at client 1293,628 --
; offset by the window origin and therefore over the wrong element entirely.
CoordMode "Mouse", "Screen"

; The script must speak the same coordinate space as winapp, which is physical
; screen pixels (per-monitor aware).
DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")

args := A_Args
mode := args.Length >= 1 ? args[1] : ""

if (mode = "move") {
    if (args.Length < 3)
        ExitApp 1
    x := Integer(args[2])
    y := Integer(args[3])
    ; Speed 0 moves instantly (SetCursorPos), non-zero glides through
    ; mouse_event steps. Both raise :hover once CoordMode is Screen; the glide
    ; is what makes a recorded approach look human.
    speed := args.Length >= 4 ? Integer(args[4]) : 2
    MouseMove x, y, speed
    ExitApp 0
}

if (mode = "focus") {
    if WinExist("ahk_exe Obsidian.exe")
        WinActivate
    ExitApp 0
}

if (mode = "down" || mode = "up") {
    if (args.Length < 2)
        ExitApp 1
    Send "{" args[2] " " mode "}"
    ExitApp 0
}

if (mode = "pos") {
    MouseGetPos &mx, &my
    FileAppend mx "," my, "*"
    ExitApp 0
}

if (mode = "allup") {
    for k in ["Shift", "Ctrl", "Alt", "LWin", "RWin"]
        Send "{" k " up}"
    ExitApp 0
}

ExitApp 1
