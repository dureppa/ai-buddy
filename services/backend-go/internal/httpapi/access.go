package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type accessRequestDTO struct {
	ID          string `json:"id"`
	Number      string `json:"number"`
	ServiceName string `json:"service_name"`
	Status      string `json:"status"`
}

func toAccessDTO(r buddy.AccessRequest) accessRequestDTO {
	return accessRequestDTO{ID: r.ID, Number: r.Number, ServiceName: r.ServiceName, Status: r.Status}
}

func toAccessListDTO(reqs []buddy.AccessRequest) []accessRequestDTO {
	dto := make([]accessRequestDTO, 0, len(reqs))
	for _, r := range reqs {
		dto = append(dto, toAccessDTO(r))
	}
	return dto
}

func (a *API) handleListAccessRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	reqs, err := a.access.List(r.Context(), p.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAccessListDTO(reqs))
}

func (a *API) handleConfirmAccessRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	req, err := a.access.Confirm(r.Context(), r.PathValue("draft_id"), p.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAccessDTO(req))
}
