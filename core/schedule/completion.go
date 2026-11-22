package schedule

import "regexp"

// taskBoxPattern matches a Markdown task box at the start of a list item:
// "- [ ]", "- [x]", "- [X]" or the doing marker "- [/]".
var taskBoxPattern = regexp.MustCompile(`(?m)^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX/])\]`)

// AllTasksDone reports whether the content has at least one task box and every
// task box is checked. A doing ([/]) or open ([ ]) task keeps the memo open.
func AllTasksDone(content string) bool {
	matches := taskBoxPattern.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return false
	}
	for _, m := range matches {
		if m[2] != "x" && m[2] != "X" {
			return false
		}
	}
	return true
}

// ResetTasks returns the content with every task box unchecked, so a completed
// recurring memo starts its next occurrence with all tasks open.
func ResetTasks(content string) string {
	return taskBoxPattern.ReplaceAllStringFunc(content, func(match string) string {
		sub := taskBoxPattern.FindStringSubmatch(match)
		return sub[1] + "[ ]"
	})
}

// AdvanceMemoRecurrence returns the memo's next occurrence after `afterTs`, given
// the rule and the start the memo's recurrence was first set from.
func AdvanceMemoRecurrence(startTs int64, everyNDays *int32, weekdayMask *int32, afterTs int64) (int64, error) {
	return NextRunAfter(startTs, everyNDays, weekdayMask, afterTs)
}
