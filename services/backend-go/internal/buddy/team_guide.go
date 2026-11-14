package buddy

type TeamGuideCard struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type TeamGuide struct {
	Status string          `json:"status"`
	Cards  []TeamGuideCard `json:"cards,omitempty"`
}

type TeamGuideBrief struct {
	Team    string `json:"team"`
	Product string `json:"product"`
	Brief   string `json:"brief"`
}
