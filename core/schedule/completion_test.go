package schedule

import "testing"

func TestAllTasksDone(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{"no tasks", "just text", false},
		{"all checked", "- [x] a\n- [X] b", true},
		{"one open", "- [x] a\n- [ ] b", false},
		{"doing counts as open", "- [x] a\n- [/] b", false},
		{"ordered list", "1. [x] a", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AllTasksDone(tt.content); got != tt.want {
				t.Fatalf("AllTasksDone(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}

func TestResetTasks(t *testing.T) {
	in := "Title\n- [x] a\n- [X] b\n- [/] c\n- [ ] d"
	want := "Title\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d"
	if got := ResetTasks(in); got != want {
		t.Fatalf("ResetTasks = %q, want %q", got, want)
	}
}
