package api

import (
	"testing"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func int32Ptr(v int32) *int32 { return &v }

func TestRollRecurringMemo(t *testing.T) {
	const day = int64(24 * 3600)
	start := int64(1_700_000_000)

	t.Run("completed recurring memo resets tasks and advances", func(t *testing.T) {
		memo := &store.Memo{
			Content: "- [x] a\n- [x] b",
			Payload: &storepb.MemoPayload{Recurrence: &storepb.MemoPayload_Recurrence{EveryNDays: int32Ptr(2), NextRunTs: start}},
		}
		rollover := rollRecurringMemo(memo)
		if rollover == nil {
			t.Fatal("expected rollover")
		}
		if memo.Content != "- [ ] a\n- [ ] b" {
			t.Fatalf("content = %q", memo.Content)
		}
		if want := start + 2*day; rollover.CreatedTs != want || memo.Payload.Recurrence.NextRunTs != want {
			t.Fatalf("next run = %d, want %d", rollover.CreatedTs, want)
		}
	})

	t.Run("open task keeps the memo as is", func(t *testing.T) {
		memo := &store.Memo{
			Content: "- [x] a\n- [ ] b",
			Payload: &storepb.MemoPayload{Recurrence: &storepb.MemoPayload_Recurrence{EveryNDays: int32Ptr(1), NextRunTs: start}},
		}
		if rollRecurringMemo(memo) != nil || memo.Content != "- [x] a\n- [ ] b" {
			t.Fatal("memo with an open task must not roll over")
		}
	})

	t.Run("ordinary memo is untouched", func(t *testing.T) {
		memo := &store.Memo{Content: "- [x] a", Payload: &storepb.MemoPayload{}}
		if rollRecurringMemo(memo) != nil {
			t.Fatal("non-recurring memo must not roll over")
		}
	})
}
