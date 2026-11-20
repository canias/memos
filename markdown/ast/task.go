package ast

import (
	east "github.com/yuin/goldmark/extension/ast"
)

// DoingTaskAttribute marks a goldmark task checkbox as in progress. The task
// checkbox parser sets it for the `[/]` marker, and property extraction and the
// markdown renderer read it.
const DoingTaskAttribute = "doing"

// MarkTaskCheckBoxDoing flags a parsed task checkbox as in progress.
func MarkTaskCheckBoxDoing(node *east.TaskCheckBox) {
	node.SetAttributeString(DoingTaskAttribute, true)
}

// IsDoingTaskCheckBox reports whether the task checkbox carries the `[/]`
// in-progress marker instead of the plain todo marker.
func IsDoingTaskCheckBox(node *east.TaskCheckBox) bool {
	if node == nil {
		return false
	}
	_, ok := node.AttributeString(DoingTaskAttribute)
	return ok
}
