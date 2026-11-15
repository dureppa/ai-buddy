package buddy

// ChecklistContext describes the visible client plan, never server completion evidence.
type ChecklistContext struct {
	Status string             `json:"status"`
	Task   *SelectionResource `json:"task,omitempty"`
}

func (c *ChecklistContext) Valid() bool {
	switch c.Status {
	case "completed", "unavailable":
		return c.Task == nil
	case "in_progress":
		return c.Task != nil && c.Task.Kind == "task" && (&Selection{Text: "task", Resource: c.Task}).Valid()
	default:
		return false
	}
}
