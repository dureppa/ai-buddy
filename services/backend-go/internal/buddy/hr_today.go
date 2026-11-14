package buddy

type HREvent struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Detail  string `json:"detail"`
	Service string `json:"service"`
}

type HRToday struct {
	Events      []HREvent `json:"events"`
	Unavailable []string  `json:"unavailable"`
}
