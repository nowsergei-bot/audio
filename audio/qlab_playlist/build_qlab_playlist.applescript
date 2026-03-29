-- QLab 5: keep this .applescript next to .paths.txt, .names.txt, .colors.txt (UTF-8).
-- Open workspace, click in cue list, then Run in Script Editor.
-- 2026-03-28T17:57:10

tell application id "com.figure53.qlab.5"
	activate
	delay 0.4
	tell front workspace
		set pathsFile to "/Users/sergejnovozilov/Documents/audio/qlab_playlist/build_qlab_playlist.paths.txt"
		set namesFile to "/Users/sergejnovozilov/Documents/audio/qlab_playlist/build_qlab_playlist.names.txt"
		set colorsFile to "/Users/sergejnovozilov/Documents/audio/qlab_playlist/build_qlab_playlist.colors.txt"
		set rawPaths to do shell script "cat " & quoted form of pathsFile
		set rawNames to do shell script "cat " & quoted form of namesFile
		set rawColors to do shell script "cat " & quoted form of colorsFile
		set pathLines to paragraphs of rawPaths
		set nameLines to paragraphs of rawNames
		set colorLines to paragraphs of rawColors
		set np to count of pathLines
		set nn to count of nameLines
		set nc to count of colorLines
		if np is not equal to nn or np is not equal to nc then
			display dialog "Sidecar line count mismatch (paths/names/colors)." buttons {"OK"} default button 1 with title "QLab"
		else
			set failCount to 0
			repeat with i from 1 to np
				set onePath to item i of pathLines
				if (length of onePath) > 0 then
					try
						make type "audio"
						set newCue to last item of (selected as list)
						set file target of newCue to POSIX file onePath
						set q name of newCue to item i of nameLines
						set q color of newCue to item i of colorLines
					on error errMsg
						log "QLab cue " & i & ": " & errMsg
						set failCount to failCount + 1
					end try
					delay 0.05
				end if
			end repeat
			if failCount > 0 then log "QLab: failed " & failCount & " cue(s) (see log above)"
		end if
	end tell
end tell
