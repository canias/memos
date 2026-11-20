package extensions

import (
	"regexp"

	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"

	mast "github.com/usememos/memos/markdown/ast"
)

// taskListRegexp matches task list markers. Like GitHub, `[x]` and `[X]` are
// checked and `[ ]` is unchecked; Memos adds `[/]` for in-progress items.
var taskListRegexp = regexp.MustCompile(`^\[([ \txX/])\]\s*`)

type taskCheckBoxParser struct{}

// TaskListExtension replaces the stock task list extension so checkboxes keep
// parsing as goldmark's TaskCheckBox while the third `[/]` state is recognized.
var TaskListExtension goldmark.Extender = &taskListExtension{}

type taskListExtension struct{}

// Extend implements goldmark.Extender. The checkbox parser must take
// precedence over the link parser.
func (*taskListExtension) Extend(markdown goldmark.Markdown) {
	markdown.Parser().AddOptions(
		parser.WithInlineParsers(util.Prioritized(newTaskCheckBoxParser(), 0)),
	)
}

func newTaskCheckBoxParser() parser.InlineParser {
	return &taskCheckBoxParser{}
}

func (*taskCheckBoxParser) Trigger() []byte {
	return []byte{'['}
}

// Parse mirrors the stock task checkbox parser: the checkbox must be the first
// inline of the first paragraph of a list item.
func (*taskCheckBoxParser) Parse(parent gast.Node, block text.Reader, _ parser.Context) gast.Node {
	// Given AST structure must be like
	// - List
	//   - ListItem         : parent.Parent
	//     - TextBlock      : parent
	//       (current line)
	if parent.Parent() == nil || parent.Parent().FirstChild() != parent {
		return nil
	}
	if parent.HasChildren() {
		return nil
	}
	if _, ok := parent.Parent().(*gast.ListItem); !ok {
		return nil
	}
	line, _ := block.PeekLine()
	match := taskListRegexp.FindSubmatchIndex(line)
	if match == nil {
		return nil
	}
	value := line[match[2]:match[3]][0]
	block.Advance(match[1])
	switch value {
	case 'x', 'X':
		return east.NewTaskCheckBox(true)
	case '/':
		node := east.NewTaskCheckBox(false)
		mast.MarkTaskCheckBoxDoing(node)
		return node
	default:
		return east.NewTaskCheckBox(false)
	}
}
