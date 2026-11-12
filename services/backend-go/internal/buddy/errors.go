package buddy

import "errors"

var (
	ErrInvalidInput    = errors.New("запрос не соответствует схеме")
	ErrUnauthenticated = errors.New("требуется действующая сессия")
	ErrForbidden       = errors.New("нет прав на действие")
	ErrNotFound        = errors.New("ресурс отсутствует или недоступен")
	ErrExpiredDraft    = errors.New("срок подтверждения истёк, подготовьте заявку заново")
	ErrUnavailable     = errors.New("зависимый сервис временно недоступен")
)
