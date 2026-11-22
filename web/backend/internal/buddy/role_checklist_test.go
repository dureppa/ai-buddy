package buddy

import (
	"errors"
	"slices"
	"testing"
)

func TestRoleChecklistMatchesExpectedCurrentID(t *testing.T) {
	marks := roleMarks("olga", nil)
	if _, err := updateRoleMarks("olga", marks, nil, "practice-memo", true, true); !errors.Is(err, ErrStaleChecklist) {
		t.Fatalf("noncurrent task: %v", err)
	}
	marks, err := updateRoleMarks("olga", marks, nil, "dev-principles", true, true)
	if err != nil {
		t.Fatal(err)
	}
	marks, err = updateRoleMarks("olga", marks, nil, "avito-numbers", true, true)
	if err != nil || !slices.Contains(marks, "avito-numbers") || slices.Contains(marks, "practice-memo") {
		t.Fatalf("wrong completion: %v %v", marks, err)
	}
	if _, err := updateRoleMarks("olga", marks, nil, "avito-numbers", true, true); !errors.Is(err, ErrStaleChecklist) {
		t.Fatalf("stale click: %v", err)
	}
	if _, err := updateRoleMarks("olga", marks, nil, "internship-survey-first", true, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("survey accepted directly: %v", err)
	}
	if _, err := updateRoleMarks("olga", marks, nil, "consent-news", true, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy task accepted: %v", err)
	}
}

func TestAdditionalInternsHaveDistinctInitialProgress(t *testing.T) {
	profiles := []string{"delivery-ivan", "delivery-elena", "travel-pavel", "travel-sofia", "autoteca-egor", "autoteca-alisa", "help-mark", "help-eva"}
	expected := []int{11, 23, 34, 45, 57, 68, 77, 86}
	for i, profile := range profiles {
		progress := checklistProgress(profile, roleMarks(profile, nil), nil, nil)
		if progress.Percent != expected[i] {
			t.Errorf("%s: got %d%%, want %d%%", profile, progress.Percent, expected[i])
		}
		if len(roleMarks(profile, []string{})) != 0 {
			t.Errorf("%s: saved progress must take precedence", profile)
		}
	}
}
