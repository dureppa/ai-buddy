package store

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/jackc/pgx/v5"
)

// ChatTurn holds a row lock across generation so history cannot interleave.
// A failed generation commits the question, without inventing an assistant reply.
func (s *Store) ChatTurn(ctx context.Context, profile string, msg buddy.ChatMessage, generate func(string, []buddy.HistoryMessage) (buddy.ChatReply, error)) (buddy.ChatReply, error) {
	select {
	case s.chatSlots <- struct{}{}:
	case <-ctx.Done():
		return buddy.ChatReply{}, ctx.Err()
	}
	defer func() { <-s.chatSlots }()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return buddy.ChatReply{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	conversation := msg.ConversationID
	if conversation == "" {
		err = tx.QueryRow(ctx, `INSERT INTO conversations(profile_id) VALUES($1) RETURNING id::text`, profile).Scan(&conversation)
	} else {
		err = tx.QueryRow(ctx, `SELECT id::text FROM conversations WHERE id=$1 AND profile_id=$2 FOR UPDATE`, conversation, profile).Scan(&conversation)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.ChatReply{}, buddy.ErrNotFound
	}
	if err != nil {
		return buddy.ChatReply{}, buddy.ErrInvalidInput
	}
	rows, err := tx.Query(ctx, `SELECT CASE sender WHEN 'buddy' THEN 'assistant' ELSE 'user' END, content FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`, conversation)
	if err != nil {
		return buddy.ChatReply{}, err
	}
	history := []buddy.HistoryMessage{}
	for rows.Next() {
		var h buddy.HistoryMessage
		if err = rows.Scan(&h.Role, &h.Content); err != nil {
			rows.Close()
			return buddy.ChatReply{}, err
		}
		history = append(history, h)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return buddy.ChatReply{}, err
	}
	slices.Reverse(history)
	_, err = tx.Exec(ctx, `INSERT INTO messages(conversation_id,sender,content,page_url) VALUES($1,'user',$2,NULLIF($3,''))`, conversation, msg.Text, msg.PageURL)
	if err != nil {
		return buddy.ChatReply{}, err
	}
	reply, modelErr := generate(conversation, history)
	if modelErr == nil {
		refs, marshalErr := json.Marshal(reply.References)
		if marshalErr != nil {
			return buddy.ChatReply{}, marshalErr
		}
		_, err = tx.Exec(ctx, `INSERT INTO messages(conversation_id,sender,kind,content,refs) VALUES($1,'buddy','answer',$2,$3)`, conversation, reply.Text, refs)
		if err != nil {
			return buddy.ChatReply{}, err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, conversation); err != nil {
		return buddy.ChatReply{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return buddy.ChatReply{}, err
	}
	return reply, modelErr
}

func (s *Store) Conversation(ctx context.Context, profile, id string) ([]buddy.HistoryMessage, error) {
	var own bool
	if err := s.q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversations WHERE id=$1 AND profile_id=$2)`, id, profile).Scan(&own); err != nil {
		return nil, buddy.ErrInvalidInput
	}
	if !own {
		return nil, buddy.ErrNotFound
	}
	rows, err := s.q.Query(ctx, `SELECT CASE sender WHEN 'buddy' THEN 'assistant' ELSE 'user' END,content,refs FROM messages WHERE conversation_id=$1 ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []buddy.HistoryMessage{}
	for rows.Next() {
		var h buddy.HistoryMessage
		if err = rows.Scan(&h.Role, &h.Content, &h.References); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
